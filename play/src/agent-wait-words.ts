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

/** The server's estimate, counted down since its frame landed: whole
 *  seconds left, or null once it has run out (no time is said rather than
 *  a wrong one) or there is none. */
export function etaLeft(w: Pick<AgentWait, "etaS" | "at">, now: number): number | null {
  const left = w.etaS === null ? 0 : w.etaS - (now - w.at) / 1000;
  return left > 0 ? Math.ceil(left) : null;
}

// DRAFT w42: the strip's words (SIGNOFF-w42.md). `name` is the thread's own
// display name for the character, never a hard-coded one. Three parts: the
// place, the wait (counts down: a screen reader is not told each step) and
// the tail.
export function waitWords(name: string, w: Pick<AgentWait, "position" | "etaS">): [string, string, string] {
  const place = w.position === null ? "You are in line" : w.position === 1 ? "You are next in line" : `You are ${ordinal(w.position)} in line`;
  return [`${name} is answering other programs. ${place}`, w.etaS === null ? "" : `, ${etaWords(w.etaS)}`, ". Please do not move the mouse."];
}

export const waitLine = (name: string, w: Pick<AgentWait, "position" | "etaS">): string => waitWords(name, w).join("");

/** The bar: how far up the line this wait has come (`done` of `total`), or
 *  null with no position. Next in line is full. */
export function waitBar(w: Pick<AgentWait, "position" | "from">): { done: number; total: number } | null {
  if (w.position === null || w.from === null) return null;
  return { done: w.from - w.position + 1, total: w.from };
}
