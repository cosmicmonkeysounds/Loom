// Wave 42b (B5): the words and the bar of a guest's place in an agent's
// line (`agent-wait.ts` keeps the waits). Pure; read by the phone's strip
// (`stream/wait-strip.tsx`, a lazy chunk) and the wall terminal's thread.

import type { AgentWait } from "./agent-wait.ts";

function ordinal(n: number): string {
  const t = n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10;
  return `${n}${t === 1 ? "st" : t === 2 ? "nd" : t === 3 ? "rd" : "th"}`;
}

/** The wait in words: under a minute in 5 s steps (Win98's "5 seconds
 *  remaining"), else whole minutes. */
export function etaWords(s: number): string {
  return s < 60 ? `about ${Math.min(55, Math.max(5, Math.round(s / 5) * 5))} sec` : `about ${Math.round(s / 60)} min`;
}

// DRAFT w42: the strip's words (SIGNOFF-w42.md). `name` is the thread's own
// display name for the character, never a hard-coded one.
export function waitLine(name: string, w: Pick<AgentWait, "position" | "etaS">): string {
  const place = w.position === null ? "You are in line" : w.position === 1 ? "You are next in line" : `You are ${ordinal(w.position)} in line`;
  const eta = w.etaS === null ? "" : `, ${etaWords(w.etaS)}`;
  return `${name} is answering other programs. ${place}${eta}. Please do not move the mouse.`;
}

/** The bar: how far up the line this wait has come (`done` of `total`), or
 *  null with no position. Next in line is full. */
export function waitBar(w: Pick<AgentWait, "position" | "from">): { done: number; total: number } | null {
  if (w.position === null || w.from === null) return null;
  return { done: w.from - w.position + 1, total: w.from };
}
