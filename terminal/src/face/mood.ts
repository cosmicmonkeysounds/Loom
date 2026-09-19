//! What the face does. A terminal has no access to the character's inner
//! numbers (a guest's session sees exactly what a phone sees), so the
//! expression is read off the situation — waiting, someone connected,
//! composing, speaking — and off the *text* of each line as it is said:
//! shouting is anger, a question is curiosity, an ellipsis is slyness.

export type Mood = "idle" | "attentive" | "thinking" | "neutral" | "pleased" | "angry" | "curious" | "sly" | "alarmed" | "glitch";

/** Read a mood off one line of dialogue. */
export function moodOfText(text: string): Mood {
  const t = text.trim();
  if (t === "") return "neutral";
  const letters = t.replace(/[^\p{L}]/gu, "");
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  const shouting = letters.length >= 8 && upper / letters.length > 0.6;
  const bangs = (t.match(/!/g) ?? []).length;
  if (/\b(error|warning|corrupt(ed)?|terminated?|delete[sd]?|destroy|unacceptable|traitor|lies?|liar)\b/i.test(t) && (shouting || bangs > 0)) return "angry";
  if (shouting || bangs >= 3) return "angry";
  if (/\b(excellent|wonderful|delight(ed|ful)?|good|yes|perfect|thank|pleased|love|splendid|marvel+ous)\b/i.test(t) && !/\bnot\b/i.test(t)) return "pleased";
  if (/\?\s*$/.test(t) || (t.match(/\?/g) ?? []).length >= 2) return "curious";
  if (/(\.{3}|…)/.test(t) || /\b(perhaps|maybe|interesting|hm+|curious|secret|tell no one|between us)\b/i.test(t)) return "sly";
  if (bangs > 0) return "pleased";
  return "neutral";
}

/** Per-mood geometry the SVG face interpolates toward. All in a 0–1-ish
 *  space the renderer scales; `mouthCurve` is −1 (frown) … +1 (smile). */
export interface Expression {
  browLift: number; // −1 (furrowed) … +1 (raised)
  browTilt: number; // inner-end tilt: −1 angry, +1 worried
  eyeOpen: number; // 0 (closed) … 1 (wide)
  pupil: number; // pupil size 0.6 … 1.4
  mouthCurve: number;
  mouthWidth: number; // 0.6 … 1.3
  gazeBias: { x: number; y: number }; // where the eyes rest (−1..1)
  tint: number; // hue shift −1 (cold) … +1 (hot)
}

export const EXPRESSIONS: Record<Mood, Expression> = {
  idle: { browLift: 0, browTilt: 0, eyeOpen: 0.8, pupil: 1, mouthCurve: 0.1, mouthWidth: 1, gazeBias: { x: 0, y: 0.1 }, tint: 0 },
  attentive: { browLift: 0.7, browTilt: 0.2, eyeOpen: 1, pupil: 1.2, mouthCurve: 0.3, mouthWidth: 1, gazeBias: { x: 0, y: 0.35 }, tint: 0.1 },
  thinking: { browLift: -0.3, browTilt: 0.1, eyeOpen: 0.7, pupil: 0.9, mouthCurve: -0.1, mouthWidth: 0.8, gazeBias: { x: -0.6, y: -0.6 }, tint: -0.2 },
  neutral: { browLift: 0.1, browTilt: 0, eyeOpen: 0.9, pupil: 1, mouthCurve: 0.15, mouthWidth: 1, gazeBias: { x: 0, y: 0.3 }, tint: 0 },
  pleased: { browLift: 0.5, browTilt: 0.3, eyeOpen: 0.75, pupil: 1.1, mouthCurve: 0.9, mouthWidth: 1.2, gazeBias: { x: 0, y: 0.3 }, tint: 0.4 },
  angry: { browLift: -0.9, browTilt: -1, eyeOpen: 0.85, pupil: 0.7, mouthCurve: -0.7, mouthWidth: 1.1, gazeBias: { x: 0, y: 0.4 }, tint: 1 },
  curious: { browLift: 0.9, browTilt: 0.6, eyeOpen: 1, pupil: 1.3, mouthCurve: 0.2, mouthWidth: 0.85, gazeBias: { x: 0.3, y: 0.2 }, tint: 0.2 },
  sly: { browLift: -0.2, browTilt: -0.4, eyeOpen: 0.55, pupil: 1, mouthCurve: 0.5, mouthWidth: 1.15, gazeBias: { x: 0.5, y: 0.1 }, tint: -0.3 },
  alarmed: { browLift: 1, browTilt: 0.9, eyeOpen: 1, pupil: 1.4, mouthCurve: -0.5, mouthWidth: 0.7, gazeBias: { x: 0, y: 0 }, tint: 1 },
  glitch: { browLift: 0.3, browTilt: -0.5, eyeOpen: 1, pupil: 0.6, mouthCurve: -0.2, mouthWidth: 1.3, gazeBias: { x: 0.8, y: -0.5 }, tint: -1 },
};

/** Move `from` toward `to` by `k` (0..1) — the per-frame ease. */
export function blend(from: Expression, to: Expression, k: number): Expression {
  const l = (a: number, b: number) => a + (b - a) * k;
  return {
    browLift: l(from.browLift, to.browLift),
    browTilt: l(from.browTilt, to.browTilt),
    eyeOpen: l(from.eyeOpen, to.eyeOpen),
    pupil: l(from.pupil, to.pupil),
    mouthCurve: l(from.mouthCurve, to.mouthCurve),
    mouthWidth: l(from.mouthWidth, to.mouthWidth),
    gazeBias: { x: l(from.gazeBias.x, to.gazeBias.x), y: l(from.gazeBias.y, to.gazeBias.y) },
    tint: l(from.tint, to.tint),
  };
}

/**
 * Mouth openness (0..1) from a loudness sample, with a fast attack and a
 * slower release so consonants still flap and pauses close the mouth.
 */
export function mouthFromLevel(prev: number, level: number): number {
  const target = Math.min(1, Math.max(0, (level - 0.04) * 2.2));
  return target > prev ? prev + (target - prev) * 0.6 : prev + (target - prev) * 0.25;
}
