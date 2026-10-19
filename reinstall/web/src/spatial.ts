//! The spatial stream (`GET /api/spatial/stream`, §2.2) folded into a live
//! player table — the one reducer the game (other players as ghosts) and
//! the map page (live dots) share — plus the thin `EventSource` wiring, and
//! the wire helpers for what rides beside the players: the shared King
//! (`kingOf`) and a ghost's profile picture (`avatarUrl`).

import type { DuckSpot, KingState, PlayerState, SpatialFrame, SpatialFrameName } from "@loom/house";

export const FRAME_NAMES: readonly SpatialFrameName[] = ["hello", "join", "poses", "found", "leave", "house", "duck", "reset", "king", "avatar"];

/** Fold one frame into the player table (a new map when anything changed). */
export function applyFrame(players: ReadonlyMap<string, PlayerState>, frame: SpatialFrame): ReadonlyMap<string, PlayerState> {
  switch (frame.event) {
    case "hello":
      return new Map(frame.data.players.map((p) => [p.session, p]));
    case "join": {
      const next = new Map(players);
      next.set(frame.data.player.session, frame.data.player);
      return next;
    }
    case "poses": {
      let next: Map<string, PlayerState> | null = null;
      for (const u of frame.data.players) {
        const cur = players.get(u.session);
        if (cur === undefined) continue;
        next ??= new Map(players);
        next.set(u.session, { ...cur, p: u.p, yaw: u.yaw, pitch: u.pitch, room: u.room, floor: u.floor });
      }
      return next ?? players;
    }
    case "found": {
      const cur = players.get(frame.data.session);
      if (cur === undefined) return players;
      const next = new Map(players);
      next.set(cur.session, { ...cur, found: true });
      return next;
    }
    case "leave": {
      if (!players.has(frame.data.session)) return players;
      const next = new Map(players);
      next.delete(frame.data.session);
      return next;
    }
    case "duck": {
      // A map save moved (or re-dealt) this live player's duck.
      const cur = players.get(frame.data.session);
      if (cur === undefined || !isDuckSpot(frame.data.duck) || sameDuck(cur.duck, frame.data.duck)) return players;
      const next = new Map(players);
      next.set(cur.session, { ...cur, duck: frame.data.duck });
      return next;
    }
    case "avatar": {
      // A live player's picture changed (or its lookup landed).
      const cur = players.get(frame.data.session);
      const avatar = avatarKeyOf(frame.data.avatar);
      if (cur === undefined || avatarKeyOf(cur.avatar) === avatar) return players;
      const next = new Map(players);
      next.set(cur.session, { ...cur, avatar });
      return next;
    }
    case "reset":
      return players.size === 0 ? players : new Map();
    case "house":
    case "king":
      return players;
  }
}

/** A picture key off the wire: a non-empty string, else null (none — an
 *  old server sends no field, which reads as none too). */
export function avatarKeyOf(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** A ghost's picture URL: the event's public `/api/avatar/<key>` (same
 *  origin as this app), null without a key. */
export function avatarUrl(base: string, key: unknown): string | null {
  const k = avatarKeyOf(key);
  return k === null ? null : `${base}/api/avatar/${encodeURIComponent(k)}`;
}

/**
 * The shared King off the wire (`hello.king`, a `king` frame, the map GET):
 * a well-formed `KingState`, `null` when the server says there is none (no
 * King on the map), `undefined` when it says nothing — an old server with
 * no shared King, where the tablet offers no hit and he just stands.
 */
export function kingOf(v: unknown): KingState | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "object" || v === null) return null;
  const k = v as Record<string, unknown>;
  const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (typeof k["id"] !== "string" || !num(k["hp"]) || !num(k["max"])) return null;
  const hp = Math.max(0, k["hp"]);
  return { id: k["id"], hp, max: Math.max(1, k["max"]), fallen: k["fallen"] === true || hp <= 0 };
}

/** A well-formed duck spot off the wire (`{id, room, pos: Vec3}`). */
export function isDuckSpot(v: unknown): v is DuckSpot {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  return typeof d["id"] === "string" && typeof d["room"] === "string" && Array.isArray(d["pos"]) && d["pos"].length === 3 && d["pos"].every((n) => typeof n === "number" && Number.isFinite(n));
}

/** The same spot: same id, room and position (what the server compares). */
export function sameDuck(a: DuckSpot, b: DuckSpot): boolean {
  return a.id === b.id && a.room === b.room && a.pos[0] === b.pos[0] && a.pos[1] === b.pos[1] && a.pos[2] === b.pos[2];
}

/**
 * The duck a game should move to: `incoming` (off its own map GET, or a
 * `duck` frame for its own session) when it is well-formed and differs
 * from the one it hunts; null to leave Gerald where he is.
 */
export function duckToAdopt(current: DuckSpot, incoming: unknown): DuckSpot | null {
  return isDuckSpot(incoming) && !sameDuck(current, incoming) ? incoming : null;
}

/**
 * The map version a frame announces: a `house` frame's (a director saved),
 * or a `hello`'s (every (re)connect — so a `house` frame lost while the
 * stream was down is caught up on reconnect, §2.2). Null for every other
 * frame, and for a blank version.
 */
export function houseVersionOf(frame: SpatialFrame): string | null {
  const v = frame.event === "house" ? frame.data.version : frame.event === "hello" ? frame.data.houseVersion : null;
  return typeof v === "string" && v !== "" ? v : null;
}

/** Decode one SSE message into a frame (null when it isn't one of ours). */
export function decodeFrame(event: string, data: string): SpatialFrame | null {
  if (!(FRAME_NAMES as readonly string[]).includes(event)) return null;
  try {
    return { event, data: JSON.parse(data) } as SpatialFrame;
  } catch {
    return null;
  }
}

export interface SpatialStreamHandle {
  close(): void;
}

/** The slice of `EventSource` the stream uses (a fake one in tests). */
export interface SpatialSource {
  readyState: number;
  onopen: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  addEventListener(type: string, fn: (e: Event) => void): void;
  close(): void;
}

/** `EventSource.CLOSED` (not a global under node). */
const CLOSED = 2;
/** The first reopen after a refused stream, doubling to `REOPEN_MAX_MS`. */
export const REOPEN_MS = 1000;
export const REOPEN_MAX_MS = 15_000;

/** How long to wait before reopening after `attempt` refusals in a row. */
export function reopenDelay(attempt: number): number {
  return Math.min(REOPEN_MAX_MS, REOPEN_MS * 2 ** Math.max(0, attempt));
}

/** A probe status that means the stream will never come back: the token is
 *  refused (401 / 403) or the event is gone (404). Anything else — a 502
 *  from the proxy while loom restarts, a 503 while it boots, no answer at
 *  all — is worth another try. */
export function streamGone(status: number | null): boolean {
  return status === 401 || status === 403 || status === 404;
}

/**
 * Open the stream. `onFrame` gets every decoded frame; `onState` whether
 * the stream is up. `EventSource` reconnects on its own after a dropped
 * connection (the server re-sends `hello`, so the table heals), but any
 * non-200 answer closes it for good — and behind a proxy a restart is a
 * 502, not a refused connection. So a closed stream asks `probe` (the HTTP
 * status of a cheap read with the same token, null when unreachable): a
 * refused token or a gone event reports `onDead`; anything else reopens on
 * a capped backoff (1 s, 2 s, 4 s … 15 s), reset once a stream opens.
 * Without a probe, a stream that never opened reports `onDead` at once.
 */
export function openSpatialStream(
  url: string,
  handlers: { onFrame: (f: SpatialFrame) => void; onState?: (up: boolean) => void; onDead?: () => void },
  opts: { probe?: () => Promise<number | null>; source?: (url: string) => SpatialSource } = {},
): SpatialStreamHandle {
  const source = opts.source ?? ((u: string) => new EventSource(u) as SpatialSource);
  let es: SpatialSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let opened = false;
  let alive = true;
  const dead = () => {
    alive = false;
    handlers.onDead?.();
  };
  const open = () => {
    const me = source(url);
    es = me;
    for (const name of FRAME_NAMES) {
      me.addEventListener(name, (e) => {
        const f = decodeFrame(name, (e as MessageEvent<string>).data);
        if (f !== null) handlers.onFrame(f);
      });
    }
    me.onopen = () => {
      opened = true;
      attempt = 0;
      handlers.onState?.(true);
    };
    me.onerror = () => {
      handlers.onState?.(false);
      // Not CLOSED: the browser retries the drop by itself.
      if (me.readyState !== CLOSED || !alive) return;
      me.close();
      const probe = opts.probe;
      if (probe === undefined) {
        // Never opened and the browser gave up: the server refused us.
        if (!opened) return dead();
        retry = setTimeout(open, reopenDelay(attempt++));
        return;
      }
      void probe().then(
        (status) => {
          if (!alive) return;
          if (streamGone(status)) return dead();
          retry = setTimeout(open, reopenDelay(attempt++));
        },
        () => {
          if (alive) retry = setTimeout(open, reopenDelay(attempt++));
        },
      );
    };
  };
  open();
  return {
    close: () => {
      alive = false;
      clearTimeout(retry);
      es?.close();
    },
  };
}
