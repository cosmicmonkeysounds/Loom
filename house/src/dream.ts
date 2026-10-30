//! Clippy's dream (wave 49): where a terminal is in the hour-long video, for
//! the terminal that plays it and for the server that hands the same moment
//! to the reinstallation games as that terminal's feed. No state and no
//! clock of its own: a spot's place is a pure function of the spot and the
//! server's time, so a reload lands where the screen was and the games'
//! copy of a wall shows what the wall shows.
//!
//! Each terminal runs the same hour from its own place in it (`dreamOffsetS`,
//! a hash of its map spot, or its name when it has none), so no two screens
//! in the house agree. The media is `scripts/ops/dream-media.sh`'s, outside
//! git and the images: `docs/loom-w49-contract.md` C2.

/** The video's length (s). */
export const DREAM_SECONDS = 3600;
/** The JPEG frames' rate: what the games' terminals poll, about 3 a second. */
export const DREAM_FRAME_FPS = 3;
/** The frames there are (`000001.jpg` …). */
export const DREAM_FRAMES = DREAM_SECONDS * DREAM_FRAME_FPS;
/** Where the set is served, on the event server's own origin. */
export const DREAM_MEDIA = "/media/dream";
/** Mixed into every spot's hash; the best of 5,000 tried: the show's 14 spots
 *  land at least 110 s apart in the hour (`house/test/dream.test.ts` reads
 *  the maps). */
export const DREAM_SALT = "clippy-3764";

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Finish with a round of xorshift-multiply: near-identical names ("ram",
  // "cpu") otherwise land close together in the low bits.
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return h >>> 0;
}

/** This terminal's own head start in the hour (whole seconds, 0 ≤ s < hour). */
export function dreamOffsetS(key: string): number {
  return fnv1a(`${DREAM_SALT}:${key}`) % DREAM_SECONDS;
}

/** Where terminal `key` is in the hour (s) at server time `serverMs`. */
export function dreamPositionS(key: string, serverMs: number): number {
  const s = (serverMs / 1000 + dreamOffsetS(key)) % DREAM_SECONDS;
  return s < 0 ? s + DREAM_SECONDS : s;
}

/** The frame (1-based) terminal `key` shows at `serverMs`. */
export function dreamFrameIndex(key: string, serverMs: number): number {
  return (Math.floor(dreamPositionS(key, serverMs) * DREAM_FRAME_FPS) % DREAM_FRAMES) + 1;
}

/** A frame's file name under `frames/`. */
export function dreamFrameName(index: number): string {
  return `${String(index).padStart(6, "0")}.jpg`;
}
