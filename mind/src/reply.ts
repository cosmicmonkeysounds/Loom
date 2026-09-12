//! Reading what the model said back. Small local models are told to
//! answer with one JSON object — `{"say": "…", "adjust": {"truth": 5}}` —
//! and mostly do; when they don't, the whole text is the line and nothing
//! is adjusted. Every adjustment is clamped to `±maxStep`, and only the
//! persona's declared variables are honoured. The story's watchers decide
//! what the numbers *mean*; this file only keeps them sane.

export interface Reply {
  /** What the character says (empty → say nothing). */
  say: string;
  /** Variable → signed delta, clamped, declared-only. */
  adjust: Record<string, number>;
}

/** Parse a raw completion into a reply. Never throws. */
export function parseReply(raw: string, allowed: readonly string[], maxStep: number): Reply {
  const text = raw.trim();
  const json = extractJson(text);
  if (json !== null) {
    const say = typeof json["say"] === "string" ? json["say"].trim() : typeof json["text"] === "string" ? json["text"].trim() : "";
    const adjust = clampAdjust(json["adjust"], allowed, maxStep);
    if (say.length > 0 || Object.keys(adjust).length > 0) return { say, adjust };
  }
  // Not JSON (or empty JSON): the text is the line, minus stray code fences.
  return { say: text.replace(/^```(?:json)?\s*|\s*```$/gu, "").trim(), adjust: {} };
}

/** The first balanced `{…}` object in `text`, parsed; null if none parses. */
export function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const v = JSON.parse(text.slice(start, i + 1)) as unknown;
          return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function clampAdjust(raw: unknown, allowed: readonly string[], maxStep: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim().toLowerCase();
    if (!allowed.includes(key)) continue;
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (!Number.isFinite(n) || n === 0) continue;
    out[key] = Math.max(-maxStep, Math.min(maxStep, Math.round(n)));
  }
  return out;
}

/** Apply a delta to a current value, keeping it inside the world's range. */
export function applyDelta(current: number, delta: number, range: [number, number] = [-100, 100]): number {
  return Math.max(range[0], Math.min(range[1], current + delta));
}
