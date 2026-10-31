//! The wall terminals' **camera feeds** (wave 14, `docs/loom-reinstall.md`
//! §2.3): each terminal uploads a small JPEG of its room ~3 times a second,
//! and the reinstallation games show it as a window where that terminal
//! hangs in the virtual house. Transport-free (an injected clock, like
//! `SpatialHub`): memory only, the latest frame per spot, never journaled,
//! never on disk — a restart simply has no feeds until the next upload.

/** A frame older than this is not served (the terminal went quiet). */
export const CAM_FRESH_MS = 15_000;
/** The largest decoded JPEG a terminal may upload. */
export const CAM_MAX_BYTES = 96 * 1024;
/** Frames from one spot closer together than this are dropped (silently:
 *  the upload answers 200 `{ok, at, dropped: true}` with the kept frame's
 *  time, so a terminal never backs off a harmless burst). */
export const CAM_MIN_GAP_MS = 150;
/** The upload's JSON body cap: base64 of `CAM_MAX_BYTES` (4/3) plus the
 *  envelope. A bigger body is refused 413 before it is parsed. */
export const CAM_BODY_LIMIT = 140 * 1024;
/** (wave 59) A feed's rates are counted over this long. */
export const CAM_RATE_WINDOW_MS = 10_000;

/** One stored frame. */
export interface CamFrame {
  jpeg: Buffer;
  w: number;
  h: number;
  /** Receive time (epoch ms on the store's clock). */
  at: number;
}

/** A feed as the list route reports it. */
export interface CamInfo {
  spot: string;
  at: number;
  w: number;
  h: number;
}

/** (wave 59) A feed's frames per second: what the server took, what the games read. */
export interface CamRate {
  got: number;
  read: number;
}

/** A parsed upload body, or why it is refused. */
export type CamUpload =
  | { ok: true; spot: string; jpeg: Buffer; w: number; h: number }
  | { ok: false; status: 400 | 413; error: string };

/** Base64 alphabet (standard or url-safe), optional padding. */
const BASE64 = /^[A-Za-z0-9+/_-]*={0,2}$/u;

/** A positive integer dimension, sane for a thumbnail. */
function dim(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 4096 ? Math.round(v) : null;
}

/**
 * Validate `{spot, jpeg, w, h}` (jpeg = base64, no `data:` prefix). 400 a
 * bad body, 413 a JPEG over `CAM_MAX_BYTES` decoded. The JPEG must start
 * with the SOI marker (FF D8) — nothing else is ever served as image/jpeg.
 */
export function parseCamUpload(body: Record<string, unknown>): CamUpload {
  const spot = typeof body["spot"] === "string" ? body["spot"].trim() : "";
  const b64 = typeof body["jpeg"] === "string" ? body["jpeg"] : "";
  const w = dim(body["w"]);
  const h = dim(body["h"]);
  if (spot === "" || spot.length > 80 || b64 === "" || w === null || h === null) {
    return { ok: false, status: 400, error: "a frame is {spot, jpeg (base64), w, h}" };
  }
  // Decoded size ≈ 3/4 of the text: refuse the obviously oversized before decoding.
  if (Math.floor((b64.length * 3) / 4) - 2 > CAM_MAX_BYTES) return { ok: false, status: 413, error: `frame too large (max ${CAM_MAX_BYTES} bytes)` };
  if (!BASE64.test(b64)) return { ok: false, status: 400, error: "jpeg is not base64" };
  const jpeg = Buffer.from(b64, "base64");
  if (jpeg.length > CAM_MAX_BYTES) return { ok: false, status: 413, error: `frame too large (max ${CAM_MAX_BYTES} bytes)` };
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return { ok: false, status: 400, error: "jpeg is not a JPEG" };
  return { ok: true, spot, jpeg, w, h };
}

/** The latest frame per terminal spot. */
export class CamStore {
  private readonly frames = new Map<string, CamFrame>();
  private readonly hits = new Map<string, { got: number[]; read: number[] }>();
  private readonly now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
  }

  /** Keep a frame. `dropped` when it came < `CAM_MIN_GAP_MS` after the last
   *  kept one (the kept frame stays; `at` is its time). */
  put(spot: string, jpeg: Buffer, w: number, h: number): { at: number; dropped: boolean } {
    const now = this.now();
    const last = this.frames.get(spot);
    if (last !== undefined && now - last.at >= 0 && now - last.at < CAM_MIN_GAP_MS) return { at: last.at, dropped: true };
    this.frames.set(spot, { jpeg, w, h, at: now });
    this.hit(spot).got.push(now);
    return { at: now, dropped: false };
  }

  private hit(spot: string): { got: number[]; read: number[] } {
    let h = this.hits.get(spot);
    if (h === undefined) this.hits.set(spot, (h = { got: [], read: [] }));
    const from = this.now() - CAM_RATE_WINDOW_MS;
    for (const list of [h.got, h.read]) {
      let i = 0;
      while (i < list.length && list[i]! < from) i++;
      if (i > 0) list.splice(0, i);
    }
    return h;
  }

  /** A game read this spot's frame. */
  noteRead(spot: string): void {
    this.hit(spot).read.push(this.now());
  }

  /** This spot's frames per second over the last `CAM_RATE_WINDOW_MS`. */
  rate(spot: string): CamRate {
    if (!this.hits.has(spot)) return { got: 0, read: 0 };
    const h = this.hit(spot);
    const per = (n: number) => Math.round((n / (CAM_RATE_WINDOW_MS / 1000)) * 10) / 10;
    return { got: per(h.got.length), read: per(h.read.length) };
  }

  /** The latest frame, if fresh. */
  get(spot: string): CamFrame | null {
    const f = this.frames.get(spot);
    if (f === undefined) return null;
    if (this.now() - f.at > CAM_FRESH_MS) {
      this.frames.delete(spot);
      return null;
    }
    return f;
  }

  /** Every fresh feed, by spot id. Stale frames are dropped on the way. */
  list(): CamInfo[] {
    const out: CamInfo[] = [];
    for (const spot of [...this.frames.keys()].sort()) {
      const f = this.get(spot);
      if (f !== null) out.push({ spot, at: f.at, w: f.w, h: f.h });
    }
    return out;
  }

  /** Forget every spot not in `ids` (the map changed: a removed terminal's
   *  feed goes with it). */
  retain(ids: ReadonlySet<string>): void {
    for (const spot of [...this.frames.keys()]) if (!ids.has(spot)) this.frames.delete(spot);
    for (const spot of [...this.hits.keys()]) if (!ids.has(spot)) this.hits.delete(spot);
  }

  get size(): number {
    return this.frames.size;
  }
}
