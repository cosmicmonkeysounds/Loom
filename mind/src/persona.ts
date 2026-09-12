//! A persona file: YAML-ish frontmatter + the system prompt.
//!
//! ```
//! ---
//! character: Trabolta
//! model: llama3.2
//! endpoint: http://localhost:11434/v1
//! temperature: 0.9
//! max_tokens: 160
//! variables: truth, untruth, stance, love
//! ---
//! You are TRABOLTA …
//! ```
//!
//! Only flat `key: value` frontmatter is understood — a persona is a
//! prompt with a few knobs, not a config language.

export interface Persona {
  /** The CHARACTER this mind voices (exactly as declared in the story). */
  character: string;
  /** Model name passed to the chat-completions endpoint. */
  model: string;
  /** OpenAI-compatible base URL (`…/v1`). Ollama's default. */
  endpoint: string;
  temperature: number;
  maxTokens: number;
  /** World variables under `<character>.` the model may adjust. */
  variables: string[];
  /** Per-reply clamp on any single adjustment. */
  maxStep: number;
  /** The system prompt (the body under the frontmatter). */
  system: string;
}

export const DEFAULTS = {
  model: "llama3.2",
  endpoint: "http://localhost:11434/v1",
  temperature: 0.8,
  maxTokens: 160,
  maxStep: 15,
} as const;

/** Parse a persona document. Throws when `character:` is missing. */
export function parsePersona(text: string): Persona {
  const t = text.replace(/\r\n/gu, "\n");
  let front: Record<string, string> = {};
  let body = t;
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(t);
  if (m !== null) {
    front = parseFrontmatter(m[1]!);
    body = m[2]!;
  }
  const character = front["character"]?.trim();
  if (!character) throw new Error("persona: frontmatter needs `character: <Name>`");
  const list = (v: string | undefined): string[] =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  const num = (v: string | undefined, d: number): number => {
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) ? n : d;
  };
  return {
    character,
    model: front["model"]?.trim() || DEFAULTS.model,
    endpoint: (front["endpoint"]?.trim() || DEFAULTS.endpoint).replace(/\/+$/u, ""),
    temperature: num(front["temperature"], DEFAULTS.temperature),
    maxTokens: num(front["max_tokens"] ?? front["max-tokens"], DEFAULTS.maxTokens),
    variables: list(front["variables"]),
    maxStep: num(front["max_step"] ?? front["max-step"], DEFAULTS.maxStep),
    system: body.trim(),
  };
}

function parseFrontmatter(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    out[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return out;
}
