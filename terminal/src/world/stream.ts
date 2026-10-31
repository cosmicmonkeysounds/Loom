//! The terminal's feed of the reinstallation simulation: the event's house
//! map (`GET /api/spatial/house`, refetched when the stream announces a new
//! version) and the spatial stream (`GET /api/spatial/stream?token=&name=` —
//! an `EventSource` can't send headers, so the moderator token rides the
//! query, as the server allows), folded by `state.ts` into a `WorldStore`.
//!
//! A dead stream doesn't leave the last ghosts frozen: after `GRACE_MS`
//! without the stream the players are cleared (an `auto` terminal gives its
//! face back), and a stream the server refused outright is probed — a 401
//! (access revoked) or 404 (the event ended) is reported as `gone` and the
//! terminal stops retrying; anything else retries with backoff.
//!
//! The store is an external store, not React state: the render loop reads
//! `store.snapshot` every frame, and a component re-renders only on what its
//! `useWorld` selector picks — so the 10 Hz pose frames never re-render the
//! piloting screen.

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { buildWalls, validateHouse, type HouseMap, type SpatialFrame, type WallSegment } from "@loom/house";
import showHouse from "../../../core/examples/trapped-in-the-internet/house.json";
import { baseOf, type TerminalConfig } from "../config.ts";
import { EMPTY_WORLD, FRAME_NAMES, decodeFrame, prune, reduce, type WorldState } from "./state.ts";
import { linkStats } from "../link-stats.ts";

export interface HouseInfo {
  house: HouseMap;
  version: string;
  /** `event` / `show` (the server's), or `bundled` — the show's map baked into this build. */
  source: "event" | "show" | "bundled";
  walls: WallSegment[];
}

export interface WorldSnapshot {
  world: WorldState;
  house: HouseInfo | null;
  /** The stream is open. */
  connected: boolean;
  /** The server said for good that this terminal can't watch: its access was revoked, or the event ended. */
  gone: Gone | null;
}

export type Gone = "revoked" | "ended";

/** First reconnect delay after the server refused the stream (ms) — doubled per attempt, capped. */
export const RETRY_MS = 5000;
export const RETRY_MAX_MS = 60_000;
/** Without the stream this long (ms), the players we last knew are dropped. */
export const GRACE_MS = 10_000;

/** The reconnect delay for the `attempt`-th refusal in a row (0-based). */
export function retryDelay(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** Math.max(0, attempt));
}

/** What a refusal's HTTP status means: revoked (401/403), ended (404), else worth retrying. */
export function goneOf(status: number): Gone | null {
  if (status === 401 || status === 403) return "revoked";
  if (status === 404) return "ended";
  return null;
}

/** The show's map, as bundled (null if it ever stops validating). */
export function bundledHouse(): HouseInfo | null {
  const v = validateHouse(showHouse);
  return v.ok && v.house ? { house: v.house, version: "bundled", source: "bundled", walls: buildWalls(v.house) } : null;
}

/** The event's map (mod token); throws on a refusal / network failure / invalid map. */
export async function fetchHouse(config: Pick<TerminalConfig, "eventId" | "token">): Promise<HouseInfo> {
  const res = await fetch(`${baseOf(config)}/api/spatial/house`, { headers: { "x-loom-token": config.token } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { house?: unknown; version?: string; source?: "event" | "show" };
  const v = validateHouse(body.house);
  if (!v.ok || !v.house) throw new Error(`invalid house map: ${v.problems[0] ?? "?"}`);
  return { house: v.house, version: body.version ?? "", source: body.source ?? "show", walls: buildWalls(v.house) };
}

export class WorldStore {
  snapshot: WorldSnapshot = { world: EMPTY_WORLD, house: null, connected: false, gone: null };
  private listeners = new Set<() => void>();

  /** `base` = the event's API base (`/e/<id>`): where the ghosts' pictures are fetched. */
  constructor(readonly base = "") {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  private set(next: Partial<WorldSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const fn of this.listeners) fn();
  }

  dispatch(frame: SpatialFrame, now: number): void {
    const world = reduce(this.snapshot.world, frame, now);
    if (world !== this.snapshot.world) this.set({ world });
  }

  /** Expire old celebrations. */
  tick(now: number): void {
    const world = prune(this.snapshot.world, now);
    if (world !== this.snapshot.world) this.set({ world });
  }

  setHouse(house: HouseInfo): void {
    this.set({ house });
  }

  setConnected(connected: boolean): void {
    if (connected !== this.snapshot.connected) this.set({ connected });
  }

  /** Forget every player (and celebration) — the stream is gone, so they are stale. Keeps the announced map version. */
  clearPlayers(): void {
    const w = this.snapshot.world;
    if (w.players.size === 0 && w.celebrations.length === 0) return;
    this.set({ world: { ...w, players: new Map(), celebrations: [] } });
  }

  setGone(gone: Gone): void {
    if (gone !== this.snapshot.gone) this.set({ gone });
  }

  /** The loaded map is behind what the stream announced (or is only the bundled one). */
  get stale(): boolean {
    const h = this.snapshot.house;
    const v = this.snapshot.world.houseVersion;
    return h === null || h.source === "bundled" || (v !== null && v !== h.version);
  }
}

/** The slice of `EventSource` the feed uses (tests pass a fake). */
export interface FeedSource {
  readyState: number;
  onopen: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  addEventListener(type: string, fn: (e: Event) => void): void;
  close(): void;
}

/** `EventSource.CLOSED` (not a global under node). */
const CLOSED = 2;

export interface FeedOptions {
  url: string;
  /** Ask the server why the stream was refused: the HTTP status, or null when it couldn't be reached. */
  probe: () => Promise<number | null>;
  source?: (url: string) => FeedSource;
  now?: () => number;
}

/**
 * Keep a store fed from the spatial stream: reconnects (the browser's own
 * retry for a dropped connection; ours, with backoff, for a refusal), drops
 * stale players after `GRACE_MS` without the stream, and stops for good on a
 * revoked token / ended event (`store.snapshot.gone`). Returns the closer.
 */
export function openSpatialFeed(store: WorldStore, opts: FeedOptions): () => void {
  const source = opts.source ?? ((url: string) => new EventSource(url) as FeedSource);
  const now = opts.now ?? (() => performance.now());
  let es: FeedSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stale: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let alive = true;
  const armStale = () => {
    if (stale !== undefined) return;
    stale = setTimeout(() => {
      stale = undefined;
      store.clearPlayers();
    }, GRACE_MS);
  };
  const disarmStale = () => {
    clearTimeout(stale);
    stale = undefined;
  };
  const open = () => {
    const me = source(opts.url);
    es = me;
    me.onopen = () => {
      attempt = 0;
      disarmStale();
      store.setConnected(true);
    };
    me.onerror = () => {
      store.setConnected(false);
      armStale();
      linkStats.error(Date.now(), "stream_down");
      // CLOSED = refused (401 / 404 / the server gone mid-handshake); the
      // browser retries every other drop by itself.
      if (me.readyState !== CLOSED || !alive) return;
      me.close();
      void opts.probe().then((status) => {
        if (!alive) return;
        const gone = status !== null ? goneOf(status) : null;
        if (gone !== null) {
          disarmStale();
          store.clearPlayers();
          store.setGone(gone);
          return;
        }
        retry = setTimeout(open, retryDelay(attempt++));
      });
    };
    for (const event of FRAME_NAMES) {
      me.addEventListener(event, (e) => {
        const frame = decodeFrame(event, (e as MessageEvent<string>).data);
        linkStats.received(Date.now());
        if (frame) store.dispatch(frame, now());
      });
    }
  };
  open();
  return () => {
    alive = false;
    clearTimeout(retry);
    disarmStale();
    es?.close();
    store.setConnected(false);
  };
}

/** Open the spatial feed for a terminal (`enabled` false: a closed, empty store). */
export function useSpatialStream(config: TerminalConfig, enabled: boolean): WorldStore {
  const { eventId, token, name } = config;
  const store = useMemo(() => new WorldStore(baseOf({ eventId })), [eventId, token, enabled]);

  // The stream.
  useEffect(() => {
    if (!enabled) return;
    const base = baseOf({ eventId });
    const close = openSpatialFeed(store, {
      url: `${base}/api/spatial/stream?token=${encodeURIComponent(token)}&name=${encodeURIComponent(name)}`,
      probe: () =>
        fetch(`${base}/api/spatial/house`, { headers: { "x-loom-token": token } }).then(
          (r) => r.status,
          () => null,
        ),
    });
    const prune = window.setInterval(() => store.tick(performance.now()), 1000);
    linkStats.watch(1);
    return () => {
      linkStats.watch(-1);
      window.clearInterval(prune);
      close();
    };
  }, [store, enabled, eventId, token, name]);

  // The map: fetched at start, again whenever the stream says it moved (and
  // on every reconnect while only the bundled copy is loaded).
  const houseVersion = useWorld(store, (s) => s.world.houseVersion);
  const connected = useWorld(store, (s) => s.connected);
  useEffect(() => {
    if (!enabled || !store.stale) return;
    let alive = true;
    void fetchHouse({ eventId, token })
      .then((h) => alive && store.setHouse(h))
      .catch(() => {
        if (alive && store.snapshot.house === null) {
          const b = bundledHouse();
          if (b) store.setHouse(b);
        }
      });
    return () => {
      alive = false;
    };
  }, [store, enabled, eventId, token, houseVersion, connected]);

  return store;
}

/** Subscribe to a slice of the world (return a primitive or a reference the store keeps). */
export function useWorld<T>(store: WorldStore, select: (s: WorldSnapshot) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.snapshot));
}
