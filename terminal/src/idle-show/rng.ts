//! The idle show's randomness (wave 17), all seeded: the same terminal name
//! and the same slot always draw the same thing, so the schedule is a pure
//! function a test can pin — and two tablets side by side never show the
//! same ad at the same moment (their names seed them apart).

/** FNV-1a 32 over a string: a terminal name → its seed. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Mix integers into one 32-bit key (a seed and a slot, a seed and a cycle, …). */
export function mix(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h ^= Math.imul((p | 0) >>> 0, 0x85ebca6b) >>> 0;
    h = Math.imul((h << 13) | (h >>> 19), 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** mulberry32: a small, fast, seeded generator of floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One float in [0, 1) for these keys (a stateless roll). */
export function roll(...parts: number[]): number {
  return mulberry32(mix(...parts))();
}

/** An integer in [lo, hi] for these keys. */
export function rollInt(lo: number, hi: number, ...parts: number[]): number {
  return lo + Math.floor(roll(...parts) * (hi - lo + 1));
}

/** A seeded Fisher–Yates shuffle of `0 … n-1`. */
export function permutation(n: number, rand: () => number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  return out;
}

/**
 * The `k`-th draw from `n` items: one shuffle per cycle of `n` draws, so
 * every item comes up once a cycle, in a fresh order each cycle. The head of
 * a cycle never repeats any of the last three of the cycle before (two for a
 * short list; swapped with a middle item) — so no draw repeats a neighbour,
 * nor one up to three back (a schedule may skip a draw or two). Computed
 * from the raw shuffles only (the fix never touches a tail), so it is O(n)
 * and not a walk back through every cycle.
 */
export function drawAt(n: number, k: number, seed: number): number {
  if (n <= 0) return -1;
  if (n === 1) return 0;
  const kk = Math.max(0, Math.floor(k));
  const cycle = Math.floor(kk / n);
  const pos = kk - cycle * n;
  const raw = (c: number) => permutation(n, mulberry32(mix(seed, c, 0x5eed)));
  const perm = raw(cycle);
  const span = n >= 9 ? 3 : n >= 6 ? 2 : 0;
  if (cycle > 0 && span > 0) {
    const prev = raw(cycle - 1);
    const tail = prev.slice(n - span);
    for (let i = 0; i < span; i++) {
      if (!tail.includes(perm[i]!)) continue;
      for (let j = span; j < n - span; j++) {
        if (tail.includes(perm[j]!)) continue;
        const t = perm[i]!;
        perm[i] = perm[j]!;
        perm[j] = t;
        break;
      }
    }
  }
  return perm[pos]!;
}
