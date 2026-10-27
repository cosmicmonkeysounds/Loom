//! The 🤖 Talk card's rules (wave 32, contract C6), as plain decisions.
//! During a talk scene (`HostView.talk`, core's `talk-back.ts` `talkView`)
//! the host Show window carries a card where Task Manager types what
//! Clippy just said out loud, so Trabolta answers him live in the Desktop:
//! a text box + Send, the canned Clippy lines (one tap sends), the canned
//! Trabolta lines (ARM then FIRE: they go out as his own line at once),
//! ⚡ Glitch, and the console's own NEXT. No React here, so every rule is
//! tested on plain values (`test/w32-talk.test.tsx`).

import { TALK_AGENT, TALK_AS, TALK_MAX, TALK_ROOM, type TalkChip, type TalkView } from "../../../core/src/talk-back.ts";
import type { ChatMessage } from "../types.ts";

export { TALK_AGENT, TALK_AS, TALK_MAX, TALK_ROOM };

/** The part whose card stands open: the host who relays Clippy. Every
 *  other host sees it folded with Open (any host may relay if that phone
 *  dies). */
export const TALK_RELAY = "Task Manager";

/** The text box's placeholder. */
export const TALK_PLACEHOLDER = "What did Clippy just say?";

/** How many of the Desktop's newest lines the card shows. */
export const TALK_LINES = 4;

/** Thinking past this long (s) reads as slow: the canned lines are the way out. */
export const TALK_SLOW_S = 12;

/** Is the card open: the host's own fold wins, else open for the relay. */
export function talkOpen(me: string | null | undefined, fold: boolean | undefined): boolean {
  return fold ?? me === TALK_RELAY;
}

/** The folded card's line for the other hosts. */
export function talkFoldedLine(): string {
  return `${TALK_RELAY} is relaying ${TALK_AS}`;
}

/** Trabolta's state, as the card's chip reads it. */
export interface TalkState {
  text: string;
  tone: "thinking" | "slow" | "off" | "asleep" | "ok";
}

/** Seconds since `since` (server wall ms) at `now` (this phone's wall ms),
 *  never negative; null when there's no `since`. */
export function talkSecs(since: number | null, now: number): number | null {
  if (since === null) return null;
  return Math.max(0, Math.floor((now - since) / 1000));
}

/**
 * The state chip: asleep wins (the server refuses Clippy's lines until he
 * wakes), then no mind online, then thinking… with its seconds (slow past
 * `TALK_SLOW_S`), else listening.
 */
export function talkState(talk: Pick<TalkView, "thinking" | "since" | "online" | "awake">, now: number): TalkState {
  if (!talk.awake) return { text: `💤 ${TALK_AGENT} is asleep`, tone: "asleep" };
  if (!talk.online) return { text: "⚠ No mind online — use his canned lines", tone: "off" };
  if (talk.thinking) {
    const s = talkSecs(talk.since, now);
    const slow = s !== null && s >= TALK_SLOW_S;
    return { text: `🤖 thinking…${s !== null ? ` ${s}s` : ""}${slow ? " — tap one of his lines" : ""}`, tone: slow ? "slow" : "thinking" };
  }
  return { text: `👂 ${TALK_AGENT} is listening`, tone: "ok" };
}

/** One line of the room, as the card shows it. */
export interface TalkLine {
  seq: number;
  from: string;
  text: string;
  /** Trabolta's own line (his answers stand out). */
  his: boolean;
}

/** The Desktop's newest spoken lines in the booth's stream (`loc:The
 *  Desktop`, kind `line`, not hidden), oldest first. */
export function talkLines(messages: Iterable<ChatMessage>, n = TALK_LINES): TalkLine[] {
  const room = `loc:${TALK_ROOM}`;
  const out: ChatMessage[] = [];
  for (const m of messages) if (m.channel === room && m.kind === "line" && !m.hidden && m.text.trim() !== "") out.push(m);
  out.sort((a, b) => a.seq - b.seq);
  return out.slice(-n).map((m) => ({ seq: m.seq, from: m.from, text: m.text, his: m.from === TALK_AGENT }));
}

/** A chip's face: its label, else its text. */
export function chipFace(c: TalkChip): string {
  return c.label !== undefined && c.label.trim() !== "" ? c.label : c.text;
}

/** A chip's key on the card (the arm's id for a Trabolta line). */
export function chipKey(side: "clippy" | "trabolta", k: number): string {
  return `${side}:${k}`;
}

/** Can the box send: something typed, within the cap, nothing in flight. */
export function canSend(draft: string, busy: boolean): boolean {
  const t = draft.trim();
  return !busy && t !== "" && t.length <= TALK_MAX;
}

/** The server's refusal words, said kindly. `message` is `ApiError.message`
 *  (the body's `error`), `status` its HTTP status (0: never left the phone). */
export function talkErrorText(message: string, status: number): string {
  switch (message) {
    case "no_talk":
      return "The talk scene is over — nothing was sent.";
    case "asleep":
      return `${TALK_AGENT} is asleep — nothing was sent.`;
    case "closed":
      return "The doors aren't open yet — nothing was sent.";
    case "too_long":
      return `Too long — keep it under ${TALK_MAX} characters.`;
    case "empty":
      return `Type what ${TALK_AS} said first.`;
    case "as":
    case "direction":
      return "The server didn't take that line — try again.";
  }
  if (status === 403 || status === 404) return "This server can't relay yet — tell the director.";
  return status > 0 ? `Not sent — ${message}` : `Not sure it went through — ${message}`;
}

/** What the card says once a line went out. `answer` is the route's body. */
export function talkSentText(as: typeof TALK_AS | typeof TALK_AGENT, answer: Record<string, unknown>): string {
  if (as === TALK_AGENT) return `✓ ${TALK_AGENT} said it`;
  if (answer["online"] === false) return `✓ Sent — no mind online, tap one of his lines`;
  return `✓ ${TALK_AGENT} heard ${TALK_AS}`;
}

/** The ⚡ Glitch press's feedback (the signal's answer). */
export function glitchText(answer: Record<string, unknown>): string {
  if (answer["refused"] === true) return "⚡ No glitch right now — # hosts says why";
  if (answer["moved"] === true) return "⚡ Cues moved — tap again";
  return "✓ ⚡ Glitch";
}

/** The slim bar's 🤖 Talk chip: a talk scene is on and the bar shows (Show
 *  is off screen). */
export function talkChipShown(talk: TalkView | null | undefined, barOn: boolean): boolean {
  return barOn && talk != null;
}
