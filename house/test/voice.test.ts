//! The voice link's shared pieces (`src/voice.ts`): the μ-law codec against
//! Sun's reference + the G.711 table, the resampler across chunk
//! boundaries, the gate, the chunker, the jitter plan, D7's `voiceOn` and
//! the who-hears-whom rule; plus the drift check of the Godot vectors.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ChunkAssembler,
  Resampler,
  VOICE_CHUNK_BYTES,
  VOICE_CHUNK_MS,
  VOICE_GATE_DBFS,
  VOICE_RATE,
  VOICE_TAIL_MS,
  VoiceGate,
  hearsPlayers,
  hearsTerminals,
  jitterPlan,
  mulawByte,
  mulawDecode,
  mulawEncode,
  mulawLinear,
  resample,
  rmsDbfs,
  voiceGain,
  voiceOn,
} from "../src/index.ts";
import type { HouseMap, TerminalSpot, Vec3 } from "../src/index.ts";
import { SHOW_HOUSE, SHOW_SHED_HOUSE, loadHouse } from "./golden.ts";
import { VOICE_GOLDEN, tone, voiceGoldenFile } from "./voice-golden.ts";

/** Sun's `linear2ulaw` on a 16-bit sample (the reference implementation). */
function sunUlaw(pcm: number): number {
  const SEG = [0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff, 0x1fff];
  let v = pcm >> 2;
  let mask = 0xff;
  if (v < 0) {
    v = -v;
    mask = 0x7f;
  }
  if (v > 8159) v = 8159;
  v += 0x84 >> 2;
  const seg = SEG.findIndex((e) => v <= e);
  if (seg < 0) return 0x7f ^ mask;
  return ((seg << 4) | ((v >> (seg + 1)) & 0xf)) ^ mask;
}

describe("μ-law", () => {
  it("decodes the G.711 table", () => {
    expect(mulawLinear(0xff)).toBe(0);
    expect(mulawLinear(0x7f)).toBe(0);
    expect(mulawLinear(0xfe)).toBe(8);
    expect(mulawLinear(0x7e)).toBe(-8);
    expect(mulawLinear(0xf0)).toBe(120);
    expect(mulawLinear(0xef)).toBe(132);
    expect(mulawLinear(0x80)).toBe(32124);
    expect(mulawLinear(0x00)).toBe(-32124);
    expect(mulawLinear(0xbf)).toBe(1980);
    // Monotone over each half of the table.
    for (let b = 0x80; b < 0xff; b++) expect(mulawLinear(b)).toBeGreaterThan(mulawLinear(b + 1));
  });

  it("encodes the edges", () => {
    expect([...mulawEncode([0, -0, 1, -1, 2, -2, Number.NaN])]).toEqual([0xff, 0xff, 0x80, 0x00, 0x80, 0x00, 0xff]);
    expect(mulawByte(132 / 32768)).toBe(0xef);
    expect(mulawByte(1e-6)).toBe(0xff);
    // A negative value that rounds to nothing is negative zero.
    expect(mulawByte(-1e-6)).toBe(0x7f);
    expect(mulawLinear(mulawByte(-1e-6))).toBe(0);
  });

  it("matches Sun's linear2ulaw on every 16-bit sample it can represent exactly", () => {
    for (let pcm = -32768; pcm < 32768; pcm += 4) expect(mulawByte(pcm / 32768), String(pcm)).toBe(sunUlaw(pcm));
  });

  it("round-trips every byte (but negative zero) and bounds the error of any float", () => {
    for (let b = 0; b < 256; b++) if (b !== 0x7f) expect(mulawByte(mulawLinear(b) / 32768), b.toString(16)).toBe(b);
    expect(mulawByte(mulawLinear(0x7f) / 32768)).toBe(0xff);
    for (let i = -2000; i <= 2000; i++) {
      const x = i / 2000;
      const back = mulawDecode(mulawEncode([x]))[0]!;
      // Half a quantum (1/16 of a segment) + the rounding: ≤ 5 % of the value, a few 16-bit steps near zero.
      expect(Math.abs(back - x), String(x)).toBeLessThanOrEqual(Math.max(3e-4, Math.abs(x) * 0.05));
    }
  });

  it("decodes into floats in [-1, 1] and encodes typed arrays", () => {
    const all = mulawDecode(Uint8Array.from({ length: 256 }, (_, i) => i));
    expect(Math.max(...all)).toBeCloseTo(32124 / 32768, 9);
    expect(Math.min(...all)).toBeCloseTo(-32124 / 32768, 9);
    expect(mulawEncode(new Float32Array([0.5, -0.5]))).toEqual(Uint8Array.from([mulawByte(0.5), mulawByte(-0.5)]));
  });
});

describe("resampling", () => {
  it("keeps its phase across chunks: any split gives the whole signal's output", () => {
    for (const [from, to] of [[48000, 16000], [44100, 16000], [16000, 48000], [16000, 44100], [22050, 16000]] as const) {
      const input = new Float32Array(tone(5000, from));
      const whole = resample(input, from, to);
      for (const sizes of [[1], [7], [128], [1000, 1, 3999], [4096]]) {
        const r = new Resampler(from, to);
        const parts: number[] = [];
        let at = 0;
        let k = 0;
        while (at < input.length) {
          const n = sizes[k++ % sizes.length]!;
          parts.push(...r.push(input.subarray(at, at + n)));
          at += n;
        }
        expect(parts.length, `${from}→${to} ${sizes}`).toBe(whole.length);
        expect(Float32Array.from(parts)).toEqual(whole);
      }
    }
  });

  it("produces the right number of samples and interpolates linearly", () => {
    expect(resample(new Float32Array(4800), 48000, 16000).length).toBe(1600);
    expect(resample(new Float32Array(4410), 44100, 16000).length).toBe(1600);
    const ramp = Float32Array.from({ length: 4 }, (_, i) => i);
    expect([...resample(ramp, 16000, 48000)]).toEqual([0, 1 / 3, 2 / 3, 1, 4 / 3, 5 / 3, 2, 7 / 3, 8 / 3, 3].map(Math.fround));
    expect([...resample(Float32Array.from([0, 1, 2, 3, 4, 5]), 48000, 16000)]).toEqual([0, 3]);
    expect(resample(ramp, 16000, 16000)).toEqual(ramp);
    expect(resample(ramp, 16000, 16000)).not.toBe(ramp);
  });

  it("keeps a tone's level, and reset starts a new stream", () => {
    const up = resample(new Float32Array(tone(4800, 48000, 440, 0.5)), 48000, 16000);
    expect(rmsDbfs(up)).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1);
    const r = new Resampler(48000, 16000);
    const first = r.push(new Float32Array([1, 2, 3, 4]));
    r.reset();
    expect(r.push(new Float32Array([1, 2, 3, 4]))).toEqual(first);
    expect(() => new Resampler(0, 16000)).toThrow(RangeError);
  });
});

describe("rmsDbfs", () => {
  it("is 0 at full scale, −Infinity for silence or nothing", () => {
    expect(rmsDbfs([1, -1, 1])).toBe(0);
    expect(rmsDbfs([0.5, -0.5])).toBeCloseTo(-6.0206, 3);
    expect(rmsDbfs([0, 0])).toBe(-Infinity);
    expect(rmsDbfs([])).toBe(-Infinity);
    expect(rmsDbfs(new Float32Array(100).fill(0.01))).toBeCloseTo(-40, 6);
  });
});

describe("the gate", () => {
  const at = (i: number): number => i * VOICE_CHUNK_MS;
  const loud = -20;
  const quiet = -70;

  it("opens with one chunk of pre-roll and hangs on for 400 ms", () => {
    const g = new VoiceGate<number>();
    expect(g.push(0, quiet, at(0))).toEqual([]);
    expect(g.push(1, quiet, at(1))).toEqual([]);
    expect(g.push(2, loud, at(2))).toEqual([1, 2]);
    expect(g.isOpen).toBe(true);
    expect(g.push(3, quiet, at(3))).toEqual([3]);
    expect(g.push(4, quiet, at(4))).toEqual([4]);
    expect(g.push(5, quiet, at(5))).toEqual([]);
    expect(g.isOpen).toBe(false);
    // A loud chunk while open extends the hang; no second pre-roll.
    expect(g.push(6, loud, at(6))).toEqual([5, 6]);
    expect(g.push(7, loud, at(7))).toEqual([7]);
  });

  it("needs to be over the gate, not at it", () => {
    const g = new VoiceGate<number>();
    expect(g.push(0, VOICE_GATE_DBFS, 0)).toEqual([]);
    expect(g.push(1, VOICE_GATE_DBFS + 0.1, 200)).toEqual([0, 1]);
    expect(new VoiceGate<number>().push(0, -Infinity, 0)).toEqual([]);
  });

  it("holds in half-duplex: drops chunks, closes, forgets the pre-roll", () => {
    const g = new VoiceGate<number>();
    g.push(0, loud, at(0));
    g.holdUntil(at(2) + VOICE_TAIL_MS); // incoming voice played until 400 ms
    expect(g.holding(at(1))).toBe(true);
    expect(g.push(1, loud, at(1))).toEqual([]);
    expect(g.push(2, quiet, at(2))).toEqual([]);
    expect(g.push(3, loud, at(3))).toEqual([]);
    expect(g.holding(at(4))).toBe(false);
    // The hold only extends.
    g.holdUntil(0);
    expect(g.push(4, loud, at(4))).toEqual([4]);
  });

  it("takes its gate and hang as options; reset closes it", () => {
    const g = new VoiceGate<number>({ gateDbfs: -30, hangMs: 0 });
    expect(g.push(0, -35, 0)).toEqual([]);
    expect(g.push(1, -25, 200)).toEqual([0, 1]);
    expect(g.push(2, -35, 400)).toEqual([]);
    g.push(3, -25, 600);
    g.reset();
    expect(g.isOpen).toBe(false);
    expect(g.push(4, -25, 800)).toEqual([4]);
  });
});

describe("ChunkAssembler", () => {
  it("hands back whole 3200-sample chunks in order and keeps the rest", () => {
    const a = new ChunkAssembler();
    expect(a.size).toBe(VOICE_CHUNK_BYTES);
    const src = Float32Array.from({ length: 8000 }, (_, i) => i);
    const got: Float32Array[] = [];
    for (let at = 0; at < src.length; at += 1234) got.push(...a.push(src.subarray(at, at + 1234)));
    expect(got.map((c) => c.length)).toEqual([3200, 3200]);
    expect(got[0]![0]).toBe(0);
    expect(got[1]![0]).toBe(3200);
    expect(got[1]![3199]).toBe(6399);
    expect(a.pending).toBe(1600);
    // Chunks handed back are never reused.
    a.push(new Float32Array(1600).fill(-1));
    expect(got[1]![0]).toBe(3200);
    a.reset();
    expect(a.pending).toBe(0);
    expect(() => new ChunkAssembler(0)).toThrow(RangeError);
  });

  it("feeds a whole mic pipeline: 48 kHz in, 200 ms μ-law chunks out", () => {
    const r = new Resampler(48000, VOICE_RATE);
    const a = new ChunkAssembler();
    const mic = new Float32Array(tone(48000, 48000));
    const chunks: Uint8Array[] = [];
    for (let at = 0; at < mic.length; at += 4096) for (const c of a.push(r.push(mic.subarray(at, at + 4096)))) chunks.push(mulawEncode(c));
    expect(chunks.length).toBe(5); // 16000 samples (the last one pending)
    expect(chunks.every((c) => c.length === VOICE_CHUNK_BYTES)).toBe(true);
    expect(rmsDbfs(mulawDecode(chunks[2]!))).toBeCloseTo(20 * Math.log10(0.6 / Math.SQRT2), 0);
  });
});

describe("jitterPlan", () => {
  it("starts, queues and skips ahead", () => {
    expect(jitterPlan(0)).toEqual({ action: "start", at: 200, drop: 0, fadeIn: true });
    expect(jitterPlan(-120)).toEqual({ action: "start", at: 200, drop: 0, fadeIn: true });
    expect(jitterPlan(Number.NaN).action).toBe("start");
    expect(jitterPlan(150)).toEqual({ action: "queue", at: 150, drop: 0, fadeIn: false });
    expect(jitterPlan(400)).toEqual({ action: "queue", at: 400, drop: 0, fadeIn: false });
    expect(jitterPlan(650)).toEqual({ action: "skip", at: 200, drop: 450, fadeIn: true });
    expect(jitterPlan(650, { targetMs: 250 })).toEqual({ action: "skip", at: 250, drop: 400, fadeIn: true });
    // A max under the target is the target.
    expect(jitterPlan(300, { targetMs: 300, maxMs: 100 }).action).toBe("queue");
  });
});

// --- who hears whom ------------------------------------------------------------

/** Main (0) + up (3); rooms A, B east of it, the spawn room S west; C upstairs. */
function testHouse(extra: TerminalSpot[] = []): HouseMap {
  const t = (id: string, room: string, pos: Vec3, more: Partial<TerminalSpot> = {}): TerminalSpot => ({ id, name: id, room, pos, yaw: 0, ...more });
  return {
    version: 1,
    name: "voice",
    origin: "test",
    floors: [
      { id: "main", label: "Main", elevation: 0, height: 2.5 },
      { id: "up", label: "Up", elevation: 3, height: 2.5 },
    ],
    rooms: [
      { id: "a", label: "A", floor: "main", poly: [[0, 0], [10, 0], [10, 10], [0, 10]] },
      { id: "b", label: "B", floor: "main", poly: [[10, 0], [30, 0], [30, 10], [10, 10]] },
      { id: "s", label: "Spawn", floor: "main", poly: [[-10, 0], [0, 0], [0, 10], [-10, 10]] },
      { id: "c", label: "C", floor: "up", poly: [[0, 0], [10, 0], [10, 10], [0, 10]] },
    ],
    doors: [],
    stairs: [],
    terminals: [
      t("ta", "a", [5, 1.4, 5]),
      t("tb", "b", [15, 1.4, 5]),
      t("tb2", "b", [25, 1.4, 5]),
      t("tc", "c", [5, 4.4, 5]),
      t("ts", "s", [-5, 1.4, 5]),
      t("ts-on", "s", [-6, 1.4, 5], { voice: true }),
      t("ta-off", "a", [6, 1.4, 5], { voice: false }),
      ...extra,
    ],
    duck: { spots: [{ id: "d", room: "a", pos: [1, 0, 1] }] },
    spawn: { room: "s", pos: [-5, 0, 5], yaw: 0 },
    props: [],
    spaces: {},
  };
}

describe("voiceOn (D7)", () => {
  it("is on unless set off, and off in the spawn room unless set on", () => {
    const h = testHouse();
    expect(["ta", "tb", "tb2", "tc", "ts", "ts-on", "ta-off"].map((id) => voiceOn(h, id))).toEqual([true, true, true, true, false, true, false]);
    expect(voiceOn(h, h.terminals[0]!)).toBe(true);
    expect(voiceOn(h, "nope")).toBe(false);
  });

  it("keeps the tent off on both show variants, with or without the map's flag", () => {
    for (const path of [SHOW_HOUSE, SHOW_SHED_HOUSE]) {
      const h = loadHouse(path);
      const tent = h.terminals.find((t) => t.id === "tent")!;
      expect(tent.room).toBe(h.spawn.room);
      expect(voiceOn(h, "tent"), path).toBe(false);
      delete tent.voice;
      expect(voiceOn(h, "tent"), `${path} unset`).toBe(false);
      for (const t of h.terminals) if (t.id !== "tent") expect(voiceOn(h, t), t.id).toBe(true);
    }
  });
});

describe("hearsTerminals", () => {
  it("hears its own room at full gain, the next room by distance; never the spawn room, the off spot or another floor", () => {
    const h = testHouse();
    const heard = hearsTerminals(h, { p: [5, 0, 6] });
    // tb: d = √101 ≈ 10.05 → 0.5 · (1 − 10.05/12) = 0.0813 → 0.08.
    expect(heard).toEqual([
      { spot: "ta", gain: 1 },
      { spot: "tb", gain: 0.08 },
    ]);
  });

  it("drops a quiet gain and anything out of reach; the spawn room's voice: true is heard", () => {
    const h = testHouse();
    // In S at -5: ts-on is 1 m away, same room. ta is 10 m (0.08); tb 20 m (out).
    expect(hearsTerminals(h, { p: [-5, 0, 5] })).toEqual([
      { spot: "ts-on", gain: 1 },
      { spot: "ta", gain: 0.08 },
    ]);
    // 10.9 m from ta: 0.5 · (1 − 10.9/12) = 0.0458 → 0.05, kept; 11 m → 0.04, dropped.
    expect(voiceGain(10.9, 12, false)).toBe(0.05);
    expect(voiceGain(11, 12, false)).toBe(0.04);
    expect(hearsTerminals(h, { p: [5, 0, 15.9] })).toEqual([{ spot: "ta", gain: 0.05 }]);
    expect(hearsTerminals(h, { p: [5, 0, 16] })).toEqual([]);
    expect(hearsTerminals(h, { p: [5, 0, 17] })).toEqual([]);
  });

  it("hears only its own floor (upstairs hears tc, at full gain in its room)", () => {
    const h = testHouse();
    expect(hearsTerminals(h, { p: [5, 3, 6] })).toEqual([{ spot: "tc", gain: 1 }]);
    // A floor given by the caller wins over the pose.
    expect(hearsTerminals(h, { p: [5, 0, 6], floor: "up", room: "c" })).toEqual([{ spot: "tc", gain: 1 }]);
    // Nowhere (no room): no full gain; 6 m → 0.25.
    expect(hearsTerminals(h, { p: [5, 0, 11] })).toEqual([{ spot: "ta", gain: 0.25 }]);
  });

  it("keeps the 4 nearest", () => {
    const extra = [1, 2, 3, 4].map((i): TerminalSpot => ({ id: `x${i}`, name: "x", room: "a", pos: [5 + i * 0.5, 1.4, 1], yaw: 0 }));
    const heard = hearsTerminals(testHouse(extra), { p: [5, 0, 1] });
    expect(heard.map((r) => r.spot)).toEqual(["x1", "x2", "x3", "x4"]);
    // Ties (all 0.5 m) by id.
    const tied = ["z", "y"].map((id): TerminalSpot => ({ id, name: id, room: "a", pos: [5, 1.4, 4], yaw: 0 }));
    expect(hearsTerminals(testHouse(tied), { p: [5, 0, 4.5] }).map((r) => r.spot).slice(0, 3)).toEqual(["ta", "y", "z"]);
  });
});

describe("hearsPlayers", () => {
  const players = [
    { session: "p1", p: [5, 0, 6] as Vec3 }, // A, 1 m
    { session: "p2", p: [12, 0, 5] as Vec3 }, // B, 7 m
    { session: "p3", p: [5, 3, 5] as Vec3 }, // upstairs
    { session: "p4", p: [14, 0, 5] as Vec3 }, // B, 9 m: out of reach
    { session: "p5", p: [-1, 0, 5] as Vec3 }, // S, 6 m
  ];

  it("hears the players near the spot, on its floor, with the same gain rule at 8 m", () => {
    const h = testHouse();
    // p2: 0.5 · (1 − 7/8) = 0.0625 → 0.06; p5: 0.5 · (1 − 6/8) = 0.125 → 0.13 (rounded half up).
    expect(hearsPlayers(h, "ta", players)).toEqual([
      { session: "p1", gain: 1 },
      { session: "p5", gain: 0.13 },
      { session: "p2", gain: 0.06 },
    ]);
    expect(hearsPlayers(h, "tc", players)).toEqual([{ session: "p3", gain: 1 }]);
  });

  it("hears nobody at a spot with voice off, the spawn room's, or an unknown one", () => {
    const h = testHouse();
    expect(hearsPlayers(h, "ta-off", players)).toEqual([]);
    expect(hearsPlayers(h, "ts", [{ session: "p", p: [-5, 0, 5] }])).toEqual([]);
    expect(hearsPlayers(h, "nope", players)).toEqual([]);
    expect(hearsPlayers(h, "ts-on", [{ session: "p", p: [-5, 0, 5] }])).toEqual([{ session: "p", gain: 1 }]);
  });

  it("keeps the 3 nearest, ties by session; a given floor / room is trusted", () => {
    const h = testHouse();
    const crowd = ["e", "d", "c", "b", "a"].map((session) => ({ session, p: [5, 0, 7] as Vec3 }));
    expect(hearsPlayers(h, "ta", crowd).map((r) => r.session)).toEqual(["a", "b", "c"]);
    expect(hearsPlayers(h, "ta", [{ session: "q", p: [5, 0, 6], floor: "up", room: "c" }])).toEqual([]);
    expect(hearsPlayers(h, "ta", [{ session: "q", p: [5, 0, 6], floor: "main", room: null }])).toEqual([{ session: "q", gain: 0.44 }]);
  });
});

describe("the show map", () => {
  it("a player at the spawn hears no tent terminal, and the tent hears nobody", () => {
    for (const path of [SHOW_HOUSE, SHOW_SHED_HOUSE]) {
      const h = loadHouse(path);
      expect(hearsTerminals(h, { p: h.spawn.pos }).some((r) => r.spot === "tent"), path).toBe(false);
      expect(hearsPlayers(h, "tent", [{ session: "s", p: h.spawn.pos }]), path).toEqual([]);
    }
  });

  it("the server room's player hears the server room's terminal, not the main floor's", () => {
    const h = loadHouse(SHOW_HOUSE);
    const heard = hearsTerminals(h, { p: [3, -2.7, 25] });
    expect(heard[0]).toEqual({ spot: "server-room", gain: 1 });
    const basement = new Set(h.terminals.filter((t) => t.pos[1] < 0).map((t) => t.id));
    expect(heard.every((r) => basement.has(r.spot))).toBe(true);
  });
});

describe("the Godot vectors", () => {
  it("match the committed file (run `pnpm --filter @loom/house goldens` after a deliberate change, then `sync`)", () => {
    expect(existsSync(VOICE_GOLDEN)).toBe(true);
    expect(readFileSync(VOICE_GOLDEN, "utf8")).toBe(voiceGoldenFile());
  });

  it("cover every kind and every byte", () => {
    const rows = readFileSync(VOICE_GOLDEN, "utf8").trim().split("\n").slice(1, -1).map((l) => JSON.parse(l.replace(/,$/, "")) as { kind: string });
    const kinds = new Set(rows.map((r) => r.kind));
    for (const k of ["constants", "encode", "decode", "rms", "resample", "gate", "jitter", "voiceOn", "hearsTerminals", "players", "hearsPlayers"]) expect(kinds.has(k), k).toBe(true);
    expect(rows.filter((r) => r.kind === "decode").length).toBe(256);
    expect(rows.filter((r) => r.kind === "encode").length).toBeGreaterThan(200);
  });
});
