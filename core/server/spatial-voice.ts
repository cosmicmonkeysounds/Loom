//! The **voice link** (wave 19, `docs/loom-reinstall.md` §2.4): the wall
//! terminals' microphones are heard in the reinstallation games at each
//! terminal's screen, and the players' headsets on the terminals near them.
//! Transport-free (an injected clock and world, like `SpatialHub` and
//! `CamStore`): memory only, never journaled, never on disk, no ring — a
//! chunk is fanned out the moment it lands to the listener streams that can
//! hear its source, with a gain, and forgotten.
//!
//! Who hears whom is `@loom/house`'s one rule (`hearsTerminals` /
//! `hearsPlayers`), recomputed by `route()` on every spatial flush, map swap
//! and listener (dis)connect. Each listener learns `listen {on}` (is its own
//! mic wanted?) and `bye {from}` (a source it was hearing went out of
//! earshot) from the diffs.

import { VOICE_CHUNK_MS, VOICE_CODEC, VOICE_FRESH_MS, VOICE_MAX_BYTES, VOICE_MIN_BYTES, VOICE_RATE, hearsPlayers, hearsTerminals, voiceOn } from "@loom/house";
import type { HouseMap, Vec3 } from "@loom/house";

/** A voice stream's SSE queue cap: past it (and stalled 15 s) the stream is dropped. */
export const VOICE_SSE_CAP = 512 * 1024;
/** A listener holding more than this unsent skips `voice` frames until it
 *  catches up (≈ 3 s of one source): late audio is worse than a gap. */
export const VOICE_LAG_BYTES = 64 * 1024;
/** A voice stream's keep-alive comment interval. */
export const VOICE_PING_MS = 15_000;

/** Where a chunk comes from: a terminal's mic (by spot) or a player's headset (by session). */
export type VoiceSource = { kind: "terminal"; spot: string } | { kind: "player"; session: string };

/** One open listener stream: a terminal at its spot, or a game session. */
export interface VoiceListener {
  id: string;
  kind: "terminal" | "player";
  /** The terminal's spot (`kind: "terminal"`). */
  spot?: string;
  /** The game session's public id (`kind: "player"`). */
  session?: string;
  send(event: string, data: unknown): void;
  /** End the stream (the session is over, the story reset). */
  close(): void;
}

/** A player as the relay routes them (the hub's `PlayerState` fits). */
export interface VoiceRoutePlayer {
  session: string;
  name?: string;
  p: Vec3;
  floor?: string;
  room?: string | null;
}

/** What `route()` reads: the map, the joined players, and whether a session is still alive. */
export interface VoiceWorld {
  house: HouseMap | null;
  players: ReadonlyArray<VoiceRoutePlayer>;
  /** False once a session ended (its listener stream is closed). */
  live(session: string): boolean;
}

/** The stream's frames (`event:` name → `data:`). */
export interface VoiceFrames {
  hello: { codec: typeof VOICE_CODEC; rate: number; chunkMs: number; as: "terminal" | "player"; spot?: string; session?: string; listen: boolean };
  listen: { on: boolean };
  voice: { from: string; kind: "terminal" | "player"; spot?: string; session?: string; name?: string; gain: number; seq: number; data: string };
  bye: { from: string };
}

/** The upload's answer: `listening` = someone can hear this source now;
 *  `dropped` = the chunk was not fanned out (nobody hears it, or a stale seq). */
export interface VoiceUploadResult {
  listening: boolean;
  dropped: boolean;
}

/** A parsed upload, or why it is refused (400). */
export type VoiceUpload = { ok: true; seq: number; spot: string | null; bytes: Buffer } | { ok: false; status: 400; error: string };

/** The source key on the wire (`voice.from`, `bye.from`). */
export function voiceFrom(src: VoiceSource): string {
  return src.kind === "terminal" ? `t:${src.spot}` : `s:${src.session}`;
}

/** A listener's own source key: what its device's mic would be. */
function ownFrom(l: VoiceListener): string {
  return l.kind === "terminal" ? `t:${l.spot ?? ""}` : `s:${l.session ?? ""}`;
}

/**
 * Validate an upload's query + raw body: `seq` a non-negative integer,
 * `spot` (a terminal; absent for a game) ≤ 80 characters, the body
 * `VOICE_MIN_BYTES` … `VOICE_MAX_BYTES` of μ-law. (The body cap itself is
 * the reader's: past it the router answers 413 before this runs.)
 */
export function parseVoiceUpload(params: URLSearchParams, body: Buffer): VoiceUpload {
  const rawSeq = params.get("seq") ?? "";
  const seq = /^\d{1,15}$/u.test(rawSeq) ? Number(rawSeq) : NaN;
  if (!Number.isSafeInteger(seq)) return { ok: false, status: 400, error: "seq is a non-negative integer" };
  const rawSpot = params.get("spot");
  const spot = rawSpot === null ? null : rawSpot.trim();
  if (spot !== null && (spot === "" || spot.length > 80)) return { ok: false, status: 400, error: "spot is a terminal id" };
  if (body.length < VOICE_MIN_BYTES || body.length > VOICE_MAX_BYTES) {
    return { ok: false, status: 400, error: `a chunk is ${VOICE_MIN_BYTES}–${VOICE_MAX_BYTES} bytes of μ-law at ${VOICE_RATE} Hz` };
  }
  return { ok: true, seq, spot, bytes: body };
}

interface Listening {
  l: VoiceListener;
  /** Sources this stream hears now → their gain. */
  hearing: Map<string, number>;
  /** Sources that delivered at least one chunk since the route formed (a
   *  `bye` is only worth sending for these). */
  heard: Set<string>;
  /** The last `listen` told (null: not greeted yet — `hello` carries it). */
  listen: boolean | null;
}

/** The fan-out: listener streams, who hears whom, and each source's last seq. */
export class VoiceRelay {
  private readonly now: () => number;
  private readonly world: () => VoiceWorld;
  private readonly listeners = new Map<string, Listening>();
  /** Source key → listener id → gain (the inverse of each `hearing`). */
  private routes = new Map<string, Map<string, number>>();
  /** Source key → the last seq kept and when. */
  private readonly seqs = new Map<string, { seq: number; at: number }>();
  /** Spot id → its name on the map (a terminal's `voice.name`). */
  private spotNames = new Map<string, string>();
  /** Session id → the program's name. */
  private playerNames = new Map<string, string>();

  constructor(opts: { world: () => VoiceWorld; now?: () => number }) {
    this.world = opts.world;
    this.now = opts.now ?? Date.now;
  }

  /** Open a listener: routed at once, then greeted with `hello` (its `listen` included). */
  connect(l: VoiceListener): void {
    this.listeners.set(l.id, { l, hearing: new Map(), heard: new Set(), listen: null });
    this.route();
  }

  /** A listener's stream closed. */
  disconnect(id: string): void {
    if (!this.listeners.delete(id)) return;
    this.route();
  }

  /** Close every listener (a story reset, `dispose()`) and forget every seq. */
  reset(): void {
    const all = [...this.listeners.values()];
    this.listeners.clear();
    this.routes.clear();
    this.seqs.clear();
    for (const x of all) x.l.close();
  }

  /** Open listener streams. */
  get size(): number {
    return this.listeners.size;
  }

  /** Is this source heard by anyone right now? */
  wants(src: VoiceSource): boolean {
    return (this.routes.get(voiceFrom(src))?.size ?? 0) > 0;
  }

  /** Who this listener hears now, source key → gain (tests + tooling). */
  hearing(id: string): Map<string, number> {
    return new Map(this.listeners.get(id)?.hearing ?? []);
  }

  /**
   * Recompute who hears whom from the world: a player's stream hears the
   * terminals `hearsTerminals` names, a terminal's the players
   * `hearsPlayers` names (a terminal never hears a terminal, a player never
   * a player, so nothing hears itself). A player stream whose session ended
   * is closed. Then the diffs go out: `hello` to a new stream, `listen` to
   * one whose own mic became (un)wanted, `bye` for a source that was heard
   * and no longer is.
   */
  route(): void {
    const w = this.world();
    const house = w.house;
    for (const x of [...this.listeners.values()]) {
      if (x.l.kind === "player" && !w.live(x.l.session ?? "")) {
        this.listeners.delete(x.l.id);
        x.l.close();
      }
    }
    this.spotNames = new Map((house?.terminals ?? []).map((t) => [t.id, t.name]));
    this.playerNames = new Map(w.players.filter((p) => p.name !== undefined).map((p) => [p.session, p.name!]));
    const routes = new Map<string, Map<string, number>>();
    const next = new Map<string, Map<string, number>>();
    for (const x of this.listeners.values()) {
      const hear = new Map<string, number>();
      if (house !== null) {
        if (x.l.kind === "player") {
          const me = w.players.find((p) => p.session === x.l.session);
          if (me !== undefined) for (const t of hearsTerminals(house, me)) hear.set(`t:${t.spot}`, t.gain);
        } else if (x.l.spot !== undefined && voiceOn(house, x.l.spot)) {
          for (const p of hearsPlayers(house, x.l.spot, w.players)) hear.set(`s:${p.session}`, p.gain);
        }
      }
      next.set(x.l.id, hear);
      for (const [from, gain] of hear) {
        let to = routes.get(from);
        if (to === undefined) routes.set(from, (to = new Map()));
        to.set(x.l.id, gain);
      }
    }
    this.routes = routes;
    for (const x of this.listeners.values()) {
      const hear = next.get(x.l.id)!;
      for (const from of x.hearing.keys()) {
        if (hear.has(from) || !x.heard.has(from)) continue;
        x.heard.delete(from);
        x.l.send("bye", { from } satisfies VoiceFrames["bye"]);
      }
      for (const from of [...x.heard]) if (!hear.has(from)) x.heard.delete(from);
      x.hearing = hear;
      const on = (routes.get(ownFrom(x.l))?.size ?? 0) > 0;
      if (x.listen === null) {
        const hello: VoiceFrames["hello"] = {
          codec: VOICE_CODEC,
          rate: VOICE_RATE,
          chunkMs: VOICE_CHUNK_MS,
          as: x.l.kind,
          ...(x.l.kind === "terminal" ? { spot: x.l.spot } : { session: x.l.session }),
          listen: on,
        };
        x.l.send("hello", hello);
      } else if (on !== x.listen) x.l.send("listen", { on } satisfies VoiceFrames["listen"]);
      x.listen = on;
    }
  }

  /**
   * One chunk from a source. A seq at or below the last kept one is stale
   * and dropped — unless the source has been quiet for `VOICE_FRESH_MS`
   * (a reloaded terminal counts from 0 again). Nobody hearing it: dropped
   * too, never stored. Otherwise every listener that hears it gets one
   * `voice` frame with its own gain.
   */
  upload(src: VoiceSource, seq: number, bytes: Uint8Array): VoiceUploadResult {
    const from = voiceFrom(src);
    const now = this.now();
    const last = this.seqs.get(from);
    const to = this.routes.get(from);
    const listening = (to?.size ?? 0) > 0;
    if (last !== undefined && seq <= last.seq && now - last.at < VOICE_FRESH_MS) return { listening, dropped: true };
    this.seqs.set(from, { seq, at: now });
    if (to === undefined || to.size === 0) return { listening: false, dropped: true };
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
    const name = src.kind === "terminal" ? this.spotNames.get(src.spot) : this.playerNames.get(src.session);
    const base = src.kind === "terminal" ? { from, kind: src.kind, spot: src.spot } : { from, kind: src.kind, session: src.session };
    for (const [id, gain] of to) {
      const x = this.listeners.get(id);
      if (x === undefined) continue;
      x.heard.add(from);
      const frame: VoiceFrames["voice"] = { ...base, ...(name !== undefined ? { name } : {}), gain, seq, data };
      x.l.send("voice", frame);
    }
    return { listening: true, dropped: false };
  }

  /** Sources that sent within `VOICE_FRESH_MS` ("talking"), source key → seq. */
  talking(): Map<string, number> {
    const now = this.now();
    const out = new Map<string, number>();
    for (const [from, s] of this.seqs) if (now - s.at <= VOICE_FRESH_MS) out.set(from, s.seq);
    return out;
  }
}
