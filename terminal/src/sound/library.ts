//! The terminal's sound effects as data (wave 17): every accent a page may
//! make out of the device's own speaker, written as note tables, glides and
//! filtered noise bursts — no audio files. Pure: a recipe is a list of
//! `Part`s in seconds; `bus.ts` schedules them on the page's one
//! `AudioContext`. The story's own `sound X` cues never play here (they are
//! the house speakers', D4) — these are UI clicks, popup dings and
//! cutscene stingers, all original.

/** One oscillator note, optionally gliding to `f2`. Times in seconds from the sound's start. */
export interface TonePart {
  kind: "tone";
  wave: OscillatorType;
  f: number;
  /** Glide to this frequency over the note (exponential). */
  f2?: number;
  at: number;
  dur: number;
  /** Peak gain (before the bus). */
  gain: number;
  /** Rise time to the peak (s); default 8 ms. */
  attack?: number;
  /** Cents of detune (a second voice for width). */
  detune?: number;
  /** Optional lowpass over this note (Hz) — takes the fizz off a saw / square. */
  lowpass?: number;
}

/** A burst of noise through an optional filter, whose cutoff may sweep to `f2`. */
export interface NoisePart {
  kind: "noise";
  at: number;
  dur: number;
  gain: number;
  attack?: number;
  filter?: { type: BiquadFilterType; f: number; f2?: number; q?: number };
}

export type Part = TonePart | NoisePart;

export const SFX_NAMES = [
  "ding",
  "chord",
  "error",
  "critical",
  "exclamation",
  "startup",
  "shutdown",
  "tada",
  "click",
  "popup",
  "close",
  "modem",
  "glitch",
  "type",
  "whoosh",
  "drumroll",
  "fanfare",
  "siren",
  "coin",
  "tick",
  "boom",
  "sparkle",
  "buzz",
  "blip",
  "spin",
  "win",
  "lose",
  "static",
  "heartbeat",
  "chime",
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

export function isSfxName(v: unknown): v is SfxName {
  return typeof v === "string" && (SFX_NAMES as readonly string[]).includes(v);
}

// --- helpers -------------------------------------------------------------------

/** Equal-tempered note → Hz (`"A4"` = 440, sharps only: `"C#5"`). */
export function hz(note: string): number {
  const m = /^([A-G])(#?)(-?\d)$/u.exec(note);
  if (m === null) throw new Error(`bad note ${note}`);
  const semis: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const n = semis[m[1]!]! + (m[2] === "#" ? 1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (n / 12);
}

const tone = (wave: OscillatorType, f: number, at: number, dur: number, gain: number, more: Partial<TonePart> = {}): TonePart => ({ kind: "tone", wave, f, at, dur, gain, ...more });
const noise = (at: number, dur: number, gain: number, filter?: NoisePart["filter"], attack?: number): NoisePart => ({ kind: "noise", at, dur, gain, filter, attack });

/** A run of notes one after another (`[note or Hz, seconds]`). */
function run(wave: OscillatorType, notes: ReadonlyArray<readonly [string | number, number]>, gain: number, from = 0, more: Partial<TonePart> = {}): TonePart[] {
  let t = from;
  return notes.map(([n, d]) => {
    const p = tone(wave, typeof n === "number" ? n : hz(n), t, d, gain, more);
    t += d;
    return p;
  });
}

/** A struck bell: the fundamental plus a quieter inharmonic partial. */
function bell(f: number, at: number, dur: number, gain: number): TonePart[] {
  return [tone("sine", f, at, dur, gain, { attack: 0.004 }), tone("sine", f * 2.76, at, dur * 0.45, gain * 0.22, { attack: 0.002 }), tone("sine", f * 2, at, dur * 0.7, gain * 0.25, { attack: 0.004 })];
}

/** A tiny deterministic rng for the sounds with scatter (same every play). */
function scatter(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// --- the library ---------------------------------------------------------------

/** The house-announcement earcon (`ringChime`): two soft bell tones rising a
 *  fifth, as the house Mac's (`stagehand/alexa`). Kept note for note. */
export const CHIME_PARTS: readonly Part[] = [
  tone("sine", 660, 0, 0.16, 0.3),
  tone("sine", 1320, 0, 0.16, 0.075),
  tone("sine", 990, 0.16, 0.38, 0.3),
  tone("sine", 1980, 0.16, 0.38, 0.075),
];

const RECIPES: Record<SfxName, () => Part[]> = {
  // Win98-ish dialog sounds (original takes, not samples).
  ding: () => bell(hz("D6"), 0, 0.6, 0.32),
  chord: () => [hz("C5"), hz("E5"), hz("G5"), hz("C6")].flatMap((f, i) => [tone("triangle", f, i * 0.012, 0.75, 0.13, { attack: 0.006 }), tone("sine", f * 2, i * 0.012, 0.35, 0.03)]),
  error: () => [...run("triangle", [["E5", 0.11], ["A4", 0.26]], 0.26), noise(0, 0.02, 0.08, { type: "bandpass", f: 2500, q: 2 })],
  critical: () => [tone("square", hz("G3"), 0, 0.5, 0.09, { lowpass: 1800 }), tone("square", hz("G#3"), 0, 0.5, 0.08, { lowpass: 1800 }), tone("sawtooth", hz("D3"), 0.06, 0.45, 0.07, { lowpass: 900 }), noise(0, 0.05, 0.1, { type: "lowpass", f: 1200 })],
  exclamation: () => run("triangle", [["A5", 0.07], ["E6", 0.22]], 0.24, 0, { attack: 0.004 }),
  // A slow swelling chord, the "the machine is on" pad.
  startup: () => [
    ...(["D#4", "A#4", "D#5", "G5", "A#5", "D#6"] as const).flatMap((n, i) => [tone("triangle", hz(n), i * 0.16, 2.6 - i * 0.12, 0.11, { attack: 0.28 }), tone("sine", hz(n), i * 0.16, 2.6 - i * 0.12, 0.05, { attack: 0.35, detune: 9 })]),
    noise(0.7, 1.8, 0.03, { type: "highpass", f: 6000 }, 0.6),
  ],
  shutdown: () => (["A#5", "G5", "D#5", "A#4", "D#4"] as const).flatMap((n, i) => [tone("triangle", hz(n), i * 0.22, 1.4, 0.11, { attack: 0.06 }), tone("sine", hz(n) / 2, i * 0.22, 1.2, 0.04, { attack: 0.1 })]),
  tada: () => [
    ...[hz("C5"), hz("E5"), hz("G5")].map((f) => tone("square", f, 0, 0.12, 0.05, { lowpass: 3200 })),
    ...[hz("C5"), hz("F5"), hz("A5"), hz("C6")].map((f) => tone("square", f, 0.14, 0.8, 0.05, { lowpass: 3600, attack: 0.01 })),
    ...[hz("C5"), hz("F5"), hz("A5")].map((f) => tone("sawtooth", f, 0.14, 0.8, 0.025, { lowpass: 2400, detune: 7 })),
  ],
  // UI.
  click: () => [noise(0, 0.014, 0.22, { type: "bandpass", f: 3200, q: 1.4 }, 0.001), tone("sine", 1800, 0, 0.012, 0.06, { attack: 0.001 })],
  popup: () => [tone("sine", 620, 0, 0.09, 0.22, { f2: 1240, attack: 0.004 }), tone("sine", 1240, 0.09, 0.08, 0.14)],
  close: () => [tone("sine", 900, 0, 0.09, 0.2, { f2: 420, attack: 0.003 }), noise(0, 0.012, 0.06, { type: "bandpass", f: 2500 })],
  // Dial-up: two touch-tone digits, the carrier, then the screech.
  modem: () => [
    tone("sine", 697, 0, 0.11, 0.12),
    tone("sine", 1209, 0, 0.11, 0.12),
    tone("sine", 770, 0.15, 0.11, 0.12),
    tone("sine", 1336, 0.15, 0.11, 0.12),
    tone("sine", 2100, 0.4, 0.42, 0.09),
    ...run("sine", [[1650, 0.08], [1850, 0.08], [1650, 0.08], [1850, 0.08], [1650, 0.08], [1850, 0.08]], 0.08, 0.86),
    noise(1.36, 0.7, 0.12, { type: "bandpass", f: 900, f2: 3200, q: 3 }, 0.02),
    tone("square", 1200, 1.4, 0.6, 0.03, { f2: 2400, lowpass: 3000 }),
  ],
  glitch: () => {
    const r = scatter(7);
    const parts: Part[] = [];
    for (let i = 0; i < 12; i++) parts.push(tone("square", 180 + r() * 2800, i * 0.028, 0.022, 0.06, { attack: 0.001 }));
    parts.push(noise(0.06, 0.08, 0.1, { type: "highpass", f: 2000 }), noise(0.2, 0.05, 0.12, { type: "bandpass", f: 800 }));
    return parts;
  },
  type: () => [noise(0, 0.018, 0.16, { type: "bandpass", f: 2600, q: 1.2 }, 0.001), tone("sine", 190, 0, 0.03, 0.08, { attack: 0.001 })],
  whoosh: () => [noise(0, 0.55, 0.2, { type: "bandpass", f: 350, f2: 3200, q: 1.2 }, 0.22)],
  drumroll: () => {
    const parts: Part[] = [];
    for (let i = 0; i < 36; i++) {
      const at = i * 0.042;
      parts.push(noise(at, 0.05, 0.04 + (0.1 * i) / 36, { type: "bandpass", f: 1800, q: 0.9 }, 0.002));
    }
    parts.push(noise(1.52, 0.9, 0.18, { type: "highpass", f: 3000 }, 0.004), tone("sine", 70, 1.52, 0.4, 0.2, { f2: 45 }));
    return parts;
  },
  fanfare: () => {
    const brass = (n: string, at: number, dur: number) => [tone("sawtooth", hz(n), at, dur, 0.06, { lowpass: 2600, attack: 0.02 }), tone("sawtooth", hz(n), at, dur, 0.04, { lowpass: 2200, attack: 0.03, detune: 8 })];
    return [...brass("G4", 0, 0.11), ...brass("G4", 0.12, 0.11), ...brass("G4", 0.24, 0.11), ...brass("C5", 0.36, 0.34), ...brass("E5", 0.72, 0.16), ...brass("G5", 0.9, 0.16), ...brass("C6", 1.08, 0.8), ...brass("E5", 1.08, 0.8)];
  },
  // Never loud: a wail up and down, twice.
  siren: () => [tone("triangle", 620, 0, 0.42, 0.16, { f2: 1180, attack: 0.04 }), tone("triangle", 1180, 0.42, 0.42, 0.16, { f2: 620 }), tone("triangle", 620, 0.84, 0.42, 0.16, { f2: 1180 }), tone("triangle", 1180, 1.26, 0.45, 0.16, { f2: 620 })],
  coin: () => run("square", [[hz("B5"), 0.07], [hz("E6"), 0.34]], 0.07, 0, { lowpass: 5000 }),
  tick: () => [tone("sine", 1500, 0, 0.016, 0.16, { attack: 0.001 }), noise(0, 0.006, 0.08, { type: "highpass", f: 4000 }, 0.001)],
  boom: () => [tone("sine", 120, 0, 0.9, 0.42, { f2: 38, attack: 0.004 }), noise(0, 0.9, 0.28, { type: "lowpass", f: 600, f2: 70 }, 0.004)],
  sparkle: () => {
    const r = scatter(3);
    return Array.from({ length: 7 }, (_, i) => tone("sine", 2200 + r() * 2600, i * 0.045, 0.18, 0.07, { attack: 0.002 }));
  },
  buzz: () => [tone("square", 110, 0, 0.38, 0.09, { lowpass: 1400 }), tone("square", 116, 0, 0.38, 0.09, { lowpass: 1400 })],
  blip: () => [tone("sine", 880, 0, 0.05, 0.2, { attack: 0.002 })],
  // A spun bottle: ticks that slow down.
  spin: () => {
    const parts: Part[] = [];
    let at = 0;
    for (let i = 0; i < 26; i++) {
      parts.push(tone("sine", 1300, at, 0.014, 0.12, { attack: 0.001 }), noise(at, 0.006, 0.05, { type: "highpass", f: 3500 }, 0.001));
      at += 0.035 + (i / 26) ** 2 * 0.2;
    }
    return parts;
  },
  win: () => run("triangle", [["C5", 0.08], ["E5", 0.08], ["G5", 0.08], ["C6", 0.3]], 0.2),
  lose: () => [...run("triangle", [["G4", 0.24], ["F#4", 0.24], ["F4", 0.24]], 0.18), tone("triangle", hz("E4"), 0.72, 0.7, 0.18, { f2: hz("D#4") })],
  static: () => [noise(0, 0.8, 0.14, { type: "highpass", f: 900 }, 0.02), noise(0.12, 0.03, 0.18, { type: "bandpass", f: 3000 }), noise(0.41, 0.025, 0.16, { type: "bandpass", f: 2000 })],
  heartbeat: () => [tone("sine", 95, 0, 0.13, 0.42, { f2: 48, attack: 0.004 }), tone("sine", 85, 0.24, 0.12, 0.3, { f2: 44, attack: 0.004 })],
  chime: () => CHIME_PARTS.map((p) => ({ ...p })),
};

/** A sound's parts (a fresh copy each call). */
export function recipe(name: SfxName): Part[] {
  return RECIPES[name]();
}

/** How long a sound rings (ms), off its parts. */
export function sfxLength(name: SfxName): number {
  return Math.round(partsLength(recipe(name)) * 1000);
}

/** The end of the last part (s). */
export function partsLength(parts: readonly Part[]): number {
  return parts.reduce((end, p) => Math.max(end, p.at + p.dur), 0);
}
