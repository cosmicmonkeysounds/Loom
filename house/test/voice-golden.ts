//! The voice link's conformance vectors (`test/fixtures/voice-mulaw.json`)
//! — written by `scripts/goldens.ts`, checked for drift by
//! `voice.test.ts`, copied into the Godot project's `test/golden/` by
//! `scripts/sync.ts` for `net/voice_codec.gd`. One JSON record per line,
//! each tagged with its `kind`:
//!
//! - `constants` — the wire constants.
//! - `encode` `{x, byte}` — floats (edges, tiny values, a sweep) → μ-law.
//! - `decode` `{byte, x}` — all 256 bytes → floats (exact: `linear / 32768`).
//! - `rms` `{samples, dbfs}` (`null` = −Infinity).
//! - `resample` `{from, to, chunks, input, output}` — `input` fed to one
//!   `Resampler` in pieces of `chunks` samples; `output` = the outputs
//!   joined (Float32 values).
//! - `gate` `{steps: [{dbfs, now, hold?}], sent}` — one `VoiceGate`: before
//!   each step `holdUntil(hold)` when set, then `push(i, dbfs, now)`;
//!   `sent` = every chunk index sent, in order.
//! - `jitter` `{buffered, target, max, plan}`.
//! - `voiceOn` `{spot, on}` — each of the show map's terminals.
//! - `hearsTerminals` `{p, floor, room, heard}` — on the show map (floor +
//!   room = `locate`); then one `players` `{players}` (the same listeners
//!   as sessions) and per terminal `hearsPlayers` `{spot, heard}` over them.

import { join } from "node:path";
import {
  Resampler,
  VOICE_CHUNK_BYTES,
  VOICE_CHUNK_MS,
  VOICE_CODEC,
  VOICE_FRESH_MS,
  VOICE_GATE_DBFS,
  VOICE_HANG_MS,
  VOICE_JITTER_MAX_MS,
  VOICE_JITTER_TARGET_MS,
  VOICE_MAX_BYTES,
  VOICE_MAX_PLAYERS,
  VOICE_MAX_TERMINALS,
  VOICE_MIN_BYTES,
  VOICE_MIN_GAIN,
  VOICE_PLAYER_REACH_M,
  VOICE_RATE,
  VOICE_TAIL_MS,
  VOICE_TERMINAL_REACH_M,
  VoiceGate,
  hearsPlayers,
  hearsTerminals,
  jitterPlan,
  locate,
  mulawByte,
  mulawLinear,
  rmsDbfs,
  voiceOn,
} from "../src/index.ts";
import type { HouseMap, Vec3 } from "../src/index.ts";
import { FIXTURES, SHOW_HOUSE, jsonLines, loadHouse } from "./golden.ts";

/** The vectors' file (a fixture, not a map: `goldenMaps` skips `voice-*`). */
export const VOICE_GOLDEN = join(FIXTURES, "voice-mulaw.json");

/** The encode inputs: the edges, values near each segment edge, tiny values, a sweep. */
export function encodeInputs(): number[] {
  const xs = new Set<number>([0, -0, 1, -1, 1.5, -1.5, 0.5, -0.5, 0.98, -0.98, 0.99, -0.99]);
  for (const t of [1e-6, 1e-5, 3e-5, 6e-5, 6.2e-5, 1e-4, 1.22e-4, 2.44e-4, 5e-4, 1e-3]) xs.add(t).add(-t);
  // Each segment's first step (biased 14-bit 64 · 2^k − 33, scaled), ± one quantum.
  for (let k = 0; k < 8; k++) {
    const m = 64 * 2 ** k - 33;
    for (const d of [-1, 0, 1]) xs.add((m + d) / 8192).add(-(m + d) / 8192);
  }
  // Rounding ties: half a 14-bit step.
  for (const s of [1.5, 2.5, 100.5, 4000.5]) xs.add(s / 8192).add(-s / 8192);
  for (let i = 0; i <= 200; i++) xs.add(Math.round((i / 100 - 1) * 1e6) / 1e6);
  return [...xs];
}

/** A deterministic test tone, Float32-exact. */
export function tone(n: number, rate: number, hz = 440, amp = 0.6): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.fround(Math.round(amp * Math.sin((2 * Math.PI * hz * i) / rate) * 1e4) / 1e4));
  return out;
}

function resampleCase(from: number, to: number, chunks: number[]): Record<string, unknown> {
  const input = tone(chunks.reduce((a, b) => a + b, 0), from);
  const r = new Resampler(from, to);
  const output: number[] = [];
  let at = 0;
  for (const c of chunks) {
    output.push(...r.push(input.slice(at, at + c)));
    at += c;
  }
  return { kind: "resample", from, to, chunks, input, output };
}

/** Gate scripts: the times are a 200 ms chunk clock. */
function gateCases(): Array<{ steps: Array<{ dbfs: number | null; now: number; hold?: number }> }> {
  const loud = -20;
  const quiet = -60;
  const at = (levels: number[], holds: Record<number, number> = {}) =>
    levels.map((dbfs, i) => ({ dbfs, now: i * VOICE_CHUNK_MS, ...(holds[i] !== undefined ? { hold: holds[i] } : {}) }));
  return [
    { steps: at([quiet, quiet, loud, quiet, quiet, quiet, quiet]) },
    { steps: at([loud, loud, quiet, loud, quiet, quiet, quiet, quiet]) },
    { steps: at([quiet, loud, quiet, quiet, loud, loud, loud, quiet], { 3: 900 }) },
    { steps: at([-41.9, -42, -42.1, -41, quiet]) },
    { steps: [{ dbfs: null, now: 0 }, { dbfs: loud, now: 200 }] },
  ];
}

function runGate(steps: Array<{ dbfs: number | null; now: number; hold?: number }>): number[] {
  const gate = new VoiceGate<number>();
  const sent: number[] = [];
  steps.forEach((s, i) => {
    if (s.hold !== undefined) gate.holdUntil(s.hold);
    sent.push(...gate.push(i, s.dbfs ?? -Infinity, s.now));
  });
  return sent;
}

const db = (v: number): number | null => (Number.isFinite(v) ? v : null);

/** The show map's hearing queries: listeners on every floor, the spawn, a stair. */
export function hearingPoses(): Vec3[] {
  return [
    [-4.5, 0, 26.3], // the spawn (the tent)
    [-3, 0, 2], // the optical drive
    [-1, 0, 12], // the hall
    [6, 0, 7], // the desktop, by the TV
    [-6, 0, 9], // the steam room
    [4, 0, 13], // the start bar
    [-4, 0, 20], // the backyard
    [3, -2.7, 25], // the server room
    [-6, -2.7, 14], // the ram
    [-1, 2.8, 12], // upstairs
    [-1, 2.8, 26], // the graphics card
    [40, 0, 40], // nowhere
  ];
}

function hearing(house: HouseMap): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const t of house.terminals) out.push({ kind: "voiceOn", spot: t.id, on: voiceOn(house, t) });
  const players = hearingPoses().map((p, i) => {
    const at = locate(house, p);
    return { session: `s${String(i).padStart(2, "0")}`, p, floor: at.floor, room: at.room };
  });
  for (const pl of players) out.push({ kind: "hearsTerminals", p: pl.p, floor: pl.floor, room: pl.room, heard: hearsTerminals(house, pl) });
  out.push({ kind: "players", players });
  for (const t of house.terminals) out.push({ kind: "hearsPlayers", spot: t.id, heard: hearsPlayers(house, t, players) });
  return out;
}

/** The vectors file's contents. */
export function voiceGoldenFile(house: HouseMap = loadHouse(SHOW_HOUSE)): string {
  const records: Record<string, unknown>[] = [
    {
      kind: "constants",
      VOICE_RATE,
      VOICE_CHUNK_MS,
      VOICE_CHUNK_BYTES,
      VOICE_MAX_BYTES,
      VOICE_MIN_BYTES,
      VOICE_CODEC,
      VOICE_TERMINAL_REACH_M,
      VOICE_PLAYER_REACH_M,
      VOICE_MAX_TERMINALS,
      VOICE_MAX_PLAYERS,
      VOICE_GATE_DBFS,
      VOICE_HANG_MS,
      VOICE_TAIL_MS,
      VOICE_FRESH_MS,
      VOICE_MIN_GAIN,
      VOICE_JITTER_TARGET_MS,
      VOICE_JITTER_MAX_MS,
    },
  ];
  for (const x of encodeInputs()) records.push({ kind: "encode", x, byte: mulawByte(x) });
  for (let b = 0; b < 256; b++) records.push({ kind: "decode", byte: b, x: mulawLinear(b) / 32768 });
  for (const samples of [[], [0, 0, 0], [0.5, -0.5], [1, 1, 1, 1], tone(160, VOICE_RATE, 440, 0.01)]) {
    records.push({ kind: "rms", samples, dbfs: db(rmsDbfs(samples)) });
  }
  records.push(
    resampleCase(48000, VOICE_RATE, [300, 7, 250, 1]),
    resampleCase(44100, VOICE_RATE, [441, 1, 200]),
    resampleCase(VOICE_RATE, 48000, [100, 3, 60]),
    resampleCase(VOICE_RATE, 44100, [100, 1, 50]),
  );
  for (const g of gateCases()) records.push({ kind: "gate", steps: g.steps, sent: runGate(g.steps) });
  for (const buffered of [-50, 0, 20, 200, 400, 401, 900]) {
    for (const [target, max] of [[VOICE_JITTER_TARGET_MS, VOICE_JITTER_MAX_MS], [250, 400]] as const) {
      records.push({ kind: "jitter", buffered, target, max, plan: jitterPlan(buffered, { targetMs: target, maxMs: max }) });
    }
  }
  records.push(...hearing(house));
  return jsonLines(records);
}
