//! How broken Trabolta's voice is right now (wave 56,
//! `docs/loom-w56-contract.md`). One answer for everything that speaks him:
//! the screen state carries a `voiceFx` block, the terminals plan each
//! sentence from it (`terminal/src/speech/glitch.ts`: pace, pitch, voice,
//! stutters) and the house router tears the sound itself up in real time
//! (`stagehand/audio/voicefx.py`). This file only decides *how much*, and it
//! is the one place a director's mode, the night's arc and the major glitches
//! meet.
//!
//! **The level** (0 clean, 1 falling apart) is a curve over `Night.phase`: he
//! is clean until the Trust Chart, frays through the overshare, and goes
//! fast in the Y2K hour, where it also climbs with the clock towards
//! midnight. `Trabolta.composure`, which every crisis of the night knocks
//! down, scales it (±25%), so a rough night sounds rougher. The ending where
//! the programs helped him is clean: the voice healing is the payoff. A
//! reading (the awards, the summary) is capped so that names and numbers get
//! through.
//!
//! **A spike** is a major glitch: it stands over the level for its length,
//! whatever the phase, so the ad hijack at step 7 hits hard and then he snaps
//! back clean. Each kind has its own flavours.
//!
//! **The mode** is the director's: `auto`, `clean` (the kill switch) or
//! `broken` (full, for a rehearsal or a save). A director's shot (one
//! flavour, now) plays in any mode: it is how a flavour is auditioned.
//!
//! Browser-safe, no imports.

/** The flavours of a broken voice. The planner and the router each have one
 *  of everything here (pinned by their tests). */
export const VOICE_FLAVOURS = ["skip", "stall", "overclock", "driver", "packet", "dump", "safe", "loop", "kernel"] as const;
export type VoiceFlavour = (typeof VOICE_FLAVOURS)[number];

/** Each flavour, as the director's buttons name it. */
export const VOICE_FLAVOUR_LABEL: Record<VoiceFlavour, string> = {
  skip: "💿 Scratched disc",
  stall: "⏳ Buffering",
  overclock: "🔥 Overclock",
  driver: "🎭 Wrong driver",
  packet: "📉 Packet loss",
  dump: "🔢 Memory dump",
  safe: "🧊 Safe mode",
  loop: "🔁 Feedback",
  kernel: "👹 Kernel",
};

export const VOICE_FX_MODES = ["auto", "clean", "broken"] as const;
export type VoiceFxMode = (typeof VOICE_FX_MODES)[number];

export function isVoiceFxMode(v: unknown): v is VoiceFxMode {
  return typeof v === "string" && (VOICE_FX_MODES as readonly string[]).includes(v);
}

export function isVoiceFlavour(v: unknown): v is VoiceFlavour {
  return typeof v === "string" && (VOICE_FLAVOURS as readonly string[]).includes(v);
}

/** The arc: the level each phase starts from. A phase not listed is clean. */
export const VOICE_PHASE_LEVEL: Readonly<Record<string, number>> = {
  trust_chart: 0.1,
  beans: 0.2,
  overshare: 0.3,
  y2k: 0.5,
  majority: 0.8,
  final_reveal: 0.85,
  bobbing: 0.85,
  grok_prom: 0.9,
  // He is trying to be understood: the confession stays mostly whole.
  advice: 0.45,
  finale_song: 0.1,
  finale_rave: 0.5,
  // The recount: weak, not wrecked. It reads every program's name.
  finale_killed: 0.3,
  finale_banish: 1,
  finale_hand_jive: 1,
  finale_shutdown: 1,
  finale_help: 0,
};

/** The Y2K hour climbs from its phase's level by this much at midnight. */
export const VOICE_Y2K_CLIMB = 0.3;
/** The Y2K hour's length (`Night.y2k_end`, s). */
export const VOICE_Y2K_S = 3600;
/** `Trabolta.composure`'s start (`cast/trabolta.loom`). */
export const VOICE_COMPOSURE_FULL = 85;
/** While the alarm rings he never sounds better than this. */
export const VOICE_ALARM_FLOOR = 0.85;
/** At his heart, face to face, he never sounds better than this. */
export const VOICE_HEART_FLOOR = 0.4;
/** A reading (awards, the recount) is never worse than this. */
export const VOICE_READING_CAP = 0.2;

export interface VoiceNight {
  phase: string | null;
  /** `Trabolta.composure` (null: a story without one). */
  composure: number | null;
  /** Seconds left on the running countdown (the Y2K hour's). */
  remaining: number | null;
  alarmOn: boolean | null;
  heartStage: string | null;
  /** An award or the recount's summary is up: the words must land. */
  reading: boolean;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** The night's level, before the director's mode. */
export function voiceLevel(n: VoiceNight): number {
  let level = VOICE_PHASE_LEVEL[n.phase ?? ""] ?? 0;
  if (n.phase === "y2k" && n.remaining !== null) level += VOICE_Y2K_CLIMB * clamp01(1 - n.remaining / VOICE_Y2K_S);
  if (level > 0 && n.composure !== null) level *= 0.75 + 0.5 * clamp01(1 - n.composure / VOICE_COMPOSURE_FULL);
  if (n.heartStage === "talk") level = Math.max(level, VOICE_HEART_FLOOR);
  if (n.alarmOn === true) level = Math.max(level, VOICE_ALARM_FLOOR);
  if (n.reading) level = Math.min(level, VOICE_READING_CAP);
  return clamp01(level);
}

export const VOICE_SPIKE_KINDS = ["shot", "hijack", "y2k", "burst", "flicker"] as const;
export type VoiceSpikeKind = (typeof VOICE_SPIKE_KINDS)[number];

/** Each spike: how long it stands, how hard, in which flavours. */
export const VOICE_SPIKES: Readonly<Record<Exclude<VoiceSpikeKind, "shot">, { ms: number; strength: number; flavours: readonly VoiceFlavour[] }>> = {
  // The 📺 ad hijack: the 8 s takeover. Panic.
  hijack: { ms: 8000, strength: 1, flavours: ["overclock", "skip", "dump", "packet"] },
  // "…the Y2K BUG.": the dream takes every screen, and something else speaks.
  y2k: { ms: 12_000, strength: 0.9, flavours: ["kernel", "stall", "loop"] },
  // ⚡ an ad burst (3.6 s on the screens).
  burst: { ms: 3600, strength: 0.8, flavours: ["skip", "packet", "dump"] },
  // ⚡ the lights and screens flicker: a catch in the throat.
  flicker: { ms: 2000, strength: 0.5, flavours: ["packet", "skip"] },
};
/** A director's shot lasts this long. */
export const VOICE_SHOT_MS = 8000;

export interface VoiceSpike {
  /** One per spike: a client plays a key once. */
  key: string;
  kind: VoiceSpikeKind;
  /** Server ms it began. */
  at: number;
  ms: number;
  strength: number;
  flavours: VoiceFlavour[];
}

export interface VoiceFx {
  mode: VoiceFxMode;
  level: number;
  spike: VoiceSpike | null;
}

/** A director's shot: one flavour, now. */
export interface VoiceShot {
  flavour: VoiceFlavour;
  at: number;
}

/** What the screens are doing, as much of it as a spike needs. */
export interface VoiceShots {
  now: number;
  /** The last glitch cue; `light` is an ad burst, else the full takeover. */
  glitch?: { at: number; light?: boolean } | null;
  flicker?: { at: number } | null;
  /** When Clippy's dream takes over (known ahead of time). */
  dreamAt?: number | null;
  shot?: VoiceShot | null;
}

function liveFrom(kind: Exclude<VoiceSpikeKind, "shot">, at: number | null | undefined, now: number): VoiceSpike | null {
  const s = VOICE_SPIKES[kind];
  if (at === null || at === undefined || !(at > 0) || now < at || now - at >= s.ms) return null;
  return { key: `${kind}:${at}`, kind, at, ms: s.ms, strength: s.strength, flavours: [...s.flavours] };
}

/** The spike standing now (the director's, else the biggest), or null. */
export function voiceSpikeOf(o: VoiceShots): VoiceSpike | null {
  const shot = o.shot;
  if (shot !== null && shot !== undefined && o.now >= shot.at && o.now - shot.at < VOICE_SHOT_MS) {
    return { key: `shot:${shot.at}`, kind: "shot", at: shot.at, ms: VOICE_SHOT_MS, strength: 1, flavours: [shot.flavour] };
  }
  const g = o.glitch;
  return (g?.light === true ? null : liveFrom("hijack", g?.at, o.now)) ?? liveFrom("y2k", o.dreamAt, o.now) ?? (g?.light === true ? liveFrom("burst", g.at, o.now) : null) ?? liveFrom("flicker", o.flicker?.at, o.now);
}

/** The screen state's `voiceFx`. `clean` silences the night and its spikes,
 *  never a director's own shot. */
export function voiceFxOf(mode: VoiceFxMode, night: VoiceNight, shots: VoiceShots): VoiceFx {
  const level = mode === "clean" ? 0 : mode === "broken" ? 1 : voiceLevel(night);
  const spike = voiceSpikeOf(mode === "clean" ? { now: shots.now, shot: shots.shot ?? null } : shots);
  return { mode, level: Math.round(level * 100) / 100, spike };
}
