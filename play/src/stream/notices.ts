//! The stream's items (wave 13): sender runs, with GENERATOR barks taken out
//! (they live in the ticker) and runs of per-person notices about other
//! people ("✅ Ada's answer is accepted.", `broadcast "~…"`) collapsed into
//! one line — "✅ 12 · 🤷 3", tap to expand. Pure — `notices.test.ts`.

import type { ChatMessage } from "../types.ts";
import { groupRuns, type MessageRun } from "./runs.ts";

export type StreamItem = { type: "run"; key: number; run: MessageRun } | { type: "notices"; key: number; messages: ChatMessage[] };

/** Does a notice name this viewer (their name as a whole word, any case)?
 *  A notice about you is news, never folded in with everyone else's. */
export function namesViewer(text: string, me: string | null | undefined): boolean {
  const name = me?.trim();
  if (name === undefined || name === "") return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

/**
 * A stream's rows from its top-level messages: barks out, notice runs
 * folded. `me` is the viewer's name: a notice naming them stays its own row
 * (and ends the run around it).
 */
export function streamItems(roots: readonly ChatMessage[], me?: string | null): StreamItem[] {
  const items: StreamItem[] = [];
  let plain: ChatMessage[] = [];
  let notices: ChatMessage[] = [];
  const flushPlain = () => {
    for (const run of groupRuns(plain)) items.push({ type: "run", key: run.messages[0]!.seq, run });
    plain = [];
  };
  const flushNotices = () => {
    if (notices.length === 0) return;
    // A lone notice reads as itself; two or more fold into one line.
    if (notices.length === 1) plain.push(notices[0]!);
    else {
      flushPlain();
      items.push({ type: "notices", key: notices[0]!.seq, messages: notices });
    }
    notices = [];
  };
  for (const m of roots) {
    if (m.ambient) continue;
    if (m.notice !== undefined && !m.alert && !namesViewer(m.text, me)) {
      notices.push(m);
      continue;
    }
    flushNotices();
    plain.push(m);
  }
  flushNotices();
  flushPlain();
  return items;
}

/** What a folded run holds, for its line: "5 transfers between others"
 *  when every one moves coin between two people (`A → B: …`), else
 *  "n updates about others". */
export function noticeNoun(messages: readonly ChatMessage[]): string {
  const n = messages.length;
  if (n > 0 && messages.every((m) => /\S\s*(?:→|⇄)\s*\S/u.test(m.text))) return `${n} ${n === 1 ? "transfer" : "transfers"} between others`;
  return `${n} ${n === 1 ? "update" : "updates"} about others`;
}

/** "✅ 12 · 🤷 3": each notice key (its leading glyph) with its count, in the order they first came. */
export function noticeSummary(messages: readonly ChatMessage[]): string {
  const counts = new Map<string, number>();
  for (const m of messages) {
    const k = m.notice || "•";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => `${k} ${n}`).join(" · ");
}

/** The newest GENERATOR bark in a stream, for the ticker (null when none). */
export function latestAmbient(messages: readonly ChatMessage[]): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.ambient) return messages[i]!;
  return null;
}
