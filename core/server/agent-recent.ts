//! What the house tells an agent's worker beyond the thread's lines (wave
//! 12, lane S, contract C1): which of his lines the **story** posted, and
//! the **recent** things the server already holds about him and this
//! speaker. Pure functions over the chat log, the world and the facts
//! ledger — no store, nothing journaled, nothing cached — so the runtime
//! rebuilds both every time it builds a request (at create time and on
//! every refresh while it is queued).
//!
//! Secrecy: a `recent` item carries only what the speaker could see
//! anyway (an entry they gave him, a line he said to the whole house,
//! their marked flag, the TV's chart) or a question id. A gift whose entry
//! is `secret: true` or carries the `▒ HUNT ANSWER` marker is dropped (the
//! share is refused before it lands; this is the second check). A filing
//! is its question id, never the answer, confidence, verdict or ruling.

import type { AgentRecent } from "./agents.ts";
import { CODEX_ROOM, type ChatMessage } from "./chat.ts";
import { CHART_NOBODY, SCREEN_CHARTS } from "./routes/screen.ts";

/** How far back a time-stamped item reaches at least (story ms). */
export const RECENT_WINDOW_MS = 600_000;
export const RECENT_MAX = 6;
export const RECENT_HOUSE_MAX = 2;
export const RECENT_FILING_MAX = 3;
/** The marker every hunt-answer card carries (titi-facts). */
export const HUNT_ANSWER_MARK = "▒ HUNT ANSWER";

/** The switch (C1.6), read on every request: `LOOM_AGENT_RECENT=off` sends
 *  the base branch's request, field for field. */
export function agentRecentOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["LOOM_AGENT_RECENT"] !== "off";
}

export interface StoryTagContext {
  character: string;
  /** The character's authored `hold:` / `busy:` lines. */
  hold: string | null;
  busy: string | null;
  /** Every text the character spoke in a story line (`storyTexts`). */
  storyTexts: ReadonlySet<string>;
}

/** The texts `character` spoke in a line the story posted (an own `beat`
 *  key): the "identical text" catch for a receipt that reached a thread by
 *  a path without a beat. */
export function storyTexts(messages: readonly ChatMessage[], character: string): Set<string> {
  const out = new Set<string>();
  for (const m of messages) if (m.from === character && Object.hasOwn(m, "beat")) out.add(m.text);
  return out;
}

/**
 * Did the story post this line (C1.1)? (a) it carries an own `beat` key
 * (scripted dialogue always does, rules included with `null`; typed chat
 * and a journaled `say` never do); else a director typing as him (`via`)
 * is never the story; else (b) it is his and is exactly his `hold:` or
 * `busy:` line, or (c) it is his and exactly a text he spoke in some story
 * line.
 */
export function storyTag(m: ChatMessage, ctx: StoryTagContext): boolean {
  if (Object.hasOwn(m, "beat")) return true;
  if (m.via !== undefined) return false;
  if (m.from !== ctx.character) return false;
  if (ctx.hold !== null && m.text === ctx.hold) return true;
  if (ctx.busy !== null && m.text === ctx.busy) return true;
  return ctx.storyTexts.has(m.text);
}

export interface RecentInput {
  character: string;
  speaker: { kind: "guest" | "performer"; id: string; name: string };
  /** The whole chat log. */
  messages: readonly ChatMessage[];
  /** `sim.elapsed()` now. */
  storyAt: number;
  /** Story time of his newest free reply in this thread (null: none yet). */
  lastFreeReply: number | null;
  /** A codex entry's definition by id (undefined: unknown — dropped). */
  codex: (entry: string) => { secret: boolean; title: string; text: string } | undefined;
  /** A world path as a display string (null: unset). */
  peek: (path: string) => string | null;
  /** Every participant (the Trust Chart ranks the cleared ones). */
  persons: ReadonlyArray<{ id: string; name: string }>;
  /** The facts ledger's filings (person id, question id, when it was seen). */
  filings: ReadonlyArray<{ person: string; question: string; at: number }>;
}

/** A world value as a display string, as the screen state reads it
 *  (null: unset). */
export function worldString(v: { kind: string; value?: unknown } | null | undefined): string | null {
  if (v === null || v === undefined || v.kind === "null") return null;
  if (v.kind === "string") return String(v.value);
  if (v.kind === "number") return String(v.value);
  if (v.kind === "bool") return v.value === true ? "true" : "false";
  return null;
}

const carriesMark = (s: string | null | undefined): boolean => typeof s === "string" && s.includes(HUNT_ANSWER_MARK);
const named = (v: string | null): boolean => v !== null && v !== "" && v !== CHART_NOBODY;

/**
 * The `recent` list (C1.2): `marked`, `chart`, his house-wide lines
 * (newest 2, newest first), gifts (newest first), filings (newest 3,
 * newest first), at most 6 in all. A time-stamped item counts from the
 * last 10 story-minutes or since his last free reply here, whichever
 * reaches further back. A performer's cast thread gets gifts and house
 * lines only.
 */
export function buildRecent(input: RecentInput): AgentRecent[] {
  const { character, speaker, messages, storyAt } = input;
  const guest = speaker.kind === "guest";
  const since = input.lastFreeReply === null ? -Infinity : Math.min(storyAt - RECENT_WINDOW_MS, input.lastFreeReply);
  const inWindow = (m: ChatMessage) => m.ts >= since;

  const house: AgentRecent[] = [];
  const gifts: AgentRecent[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (!inWindow(m)) continue;
    if (house.length < RECENT_HOUSE_MAX && m.from === character && m.kind === "line" && m.audience === "all" && !m.hidden) {
      house.push({ kind: "house", text: m.text, at: m.ts });
      continue;
    }
    if (m.channel !== CODEX_ROOM.channel || m.kind !== "codex" || m.codex === undefined) continue;
    if (m.audience === "all" || !m.audience.includes(`@${character}`)) continue;
    if (m.codex.via !== "share" || m.codex.from !== speaker.name) continue;
    const def = input.codex(m.codex.entry);
    if (def === undefined || def.secret) continue;
    if (carriesMark(def.title) || carriesMark(def.text) || carriesMark(m.codex.title) || carriesMark(m.text)) continue;
    gifts.push({ kind: "gift", title: m.codex.title, new: true, at: m.ts });
  }

  const out: AgentRecent[] = [];
  if (guest) {
    if (input.peek(`${speaker.id}.marked`) === "true") out.push({ kind: "marked" });
    const chart = chartOf(input);
    if (chart !== null) out.push(chart);
  }
  out.push(...house, ...gifts);
  if (guest) {
    const newest = new Map<string, number>();
    for (const f of input.filings) {
      if (f.person !== speaker.id) continue;
      const at = newest.get(f.question);
      if (at === undefined || f.at > at) newest.set(f.question, f.at);
    }
    const filings = [...newest].sort((a, b) => b[1] - a[1]).slice(0, RECENT_FILING_MAX);
    for (const [question] of filings) out.push({ kind: "filing", question });
  }
  return out.slice(0, RECENT_MAX);
}

/** The speaker's place on the Trust Chart, while it means something: the
 *  slide is up on the TV or the terminals, or the story has called someone
 *  out. Ranked as the screen ranks it (`SCREEN_CHARTS`): cleared persons by
 *  trust, highest first, then by name. */
function chartOf(input: RecentInput): AgentRecent | null {
  const spec = SCREEN_CHARTS[0];
  if (spec === undefined) return null;
  const { speaker, peek } = input;
  if (peek(`${speaker.id}.${spec.only}`) !== "true") return null;
  const top = peek(spec.top);
  const bottom = peek(spec.bottom);
  const showing = peek("Night.screen") === spec.slide || peek("Night.terminals") === spec.slide;
  if (!showing && !named(top) && !named(bottom)) return null;
  const rows: Array<{ id: string; name: string; value: number }> = [];
  for (const p of input.persons) {
    if (peek(`${p.id}.${spec.only}`) !== "true") continue;
    const n = Number(peek(`${p.id}.${spec.value}`) ?? 0);
    rows.push({ id: p.id, name: p.name, value: Number.isFinite(n) ? n : 0 });
  }
  rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const rank = rows.findIndex((r) => r.id === speaker.id) + 1;
  if (rank === 0) return null;
  const called = top === speaker.name ? "top" : bottom === speaker.name ? "bottom" : null;
  return { kind: "chart", rank, of: rows.length, called };
}
