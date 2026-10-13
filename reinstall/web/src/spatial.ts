//! The spatial stream (`GET /api/spatial/stream`, §2.2) folded into a live
//! player table — the one reducer the game (other players as ghosts) and
//! the map page (live dots) share — plus the thin `EventSource` wiring.

import type { DuckSpot, PlayerState, SpatialFrame, SpatialFrameName } from "@loom/house";

export const FRAME_NAMES: readonly SpatialFrameName[] = ["hello", "join", "poses", "found", "leave", "house", "duck", "reset"];

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
    case "reset":
      return players.size === 0 ? players : new Map();
    case "house":
      return players;
  }
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

/**
 * Open the stream. `onFrame` gets every decoded frame; `onState` whether
 * the stream is up. `EventSource` reconnects on its own after a drop (the
 * server re-sends `hello`, so the table heals); a token the server refuses
 * (401) closes it for good and reports `onDead`.
 */
export function openSpatialStream(
  url: string,
  handlers: { onFrame: (f: SpatialFrame) => void; onState?: (up: boolean) => void; onDead?: () => void },
): SpatialStreamHandle {
  const es = new EventSource(url);
  let opened = false;
  for (const name of FRAME_NAMES) {
    es.addEventListener(name, (e) => {
      const f = decodeFrame(name, (e as MessageEvent<string>).data);
      if (f !== null) handlers.onFrame(f);
    });
  }
  es.onopen = () => {
    opened = true;
    handlers.onState?.(true);
  };
  es.onerror = () => {
    handlers.onState?.(false);
    // Never opened and the browser gave up: the server refused us.
    if (!opened && es.readyState === EventSource.CLOSED) handlers.onDead?.();
  };
  return { close: () => es.close() };
}
