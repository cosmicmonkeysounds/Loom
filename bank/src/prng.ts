//! The spec'd `<shuffle:>` generator — xorshift64* (spec §10 item 10).
//!
//! Randomness without a specified generator makes golden traces
//! worthless, so the algorithm, the seeding, and the pick rule are all
//! normative here and mirrored bit-for-bit by every engine runtime:
//!
//! - per-site state seeds from `bankSeed ^ fnv1a64(siteKey)`, with the
//!   FNV offset basis substituted for an (astronomically unlikely) zero —
//!   xorshift is stuck at zero;
//! - each execution steps xorshift64* once and keeps the *pre-multiply*
//!   state; the multiplied output's **top 32 bits, mod n** select the
//!   variant, which every runtime can compute in non-negative integer
//!   arithmetic (GDScript ints are signed);
//! - states persist in the save under `shuffles`, keyed like counters
//!   (`siteKey:subject`), as 16-char lowercase hex.

import { fnv1a64 } from "./ids.ts";

export const MASK64 = 0xffffffffffffffffn;
const MULTIPLIER = 0x2545f4914f6cdd1dn;
const NONZERO_FALLBACK = 0xcbf29ce484222325n; // the FNV offset basis

/** Initial state for one shuffle site. Never zero. */
export function shuffleSeed(bankSeed: bigint, siteKey: string): bigint {
  const state = (bankSeed ^ fnv1a64(siteKey)) & MASK64;
  return state === 0n ? NONZERO_FALLBACK : state;
}

/** One xorshift64* step: the new state (store this, never the output). */
export function xorshift64Next(state: bigint): bigint {
  let x = state & MASK64;
  x ^= x >> 12n;
  x = (x ^ (x << 25n)) & MASK64;
  x ^= x >> 27n;
  return x & MASK64;
}

/** The variant a stepped state selects among `n` options. */
export function shufflePick(state: bigint, n: number): number {
  const out = (state * MULTIPLIER) & MASK64;
  return Number((out >> 32n) & 0xffffffffn) % n;
}

export function hex64(value: bigint): string {
  return (value & MASK64).toString(16).padStart(16, "0");
}

export function parseHex64(hex: string): bigint {
  const value = BigInt(`0x${hex === "" ? "0" : hex}`);
  return value & MASK64;
}
