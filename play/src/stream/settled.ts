//! How a card sits in the stream once it no longer needs the whole room
//! (wave 13): a live card waiting on you lives in the card tray and leaves
//! a one-line receipt behind; an answered card settles into one line ("🛡️
//! Security check · submitted"); a re-dealt card that a newer one replaced
//! folds. Pure — `settled.test.ts`.

import type { ChatMessage, WidgetCard } from "../types.ts";
import { FACT_CLOSED_NOTE, WIDGETS, cardAsks, factQuestions, widgetLabel, type WidgetResult } from "../widgets.tsx";

/** How a card renders in a stream. */
export type CardForm =
  /** The whole card, inline (an image; the cutscene's live CAPTCHA). */
  | "full"
  /** Live and waiting on the viewer: docked in the tray, a receipt here. */
  | "tray"
  /** One line, tap to see the card. */
  | "settled";

export interface CardFormInput {
  card: WidgetCard;
  answered: WidgetResult | null;
  superseded: boolean;
  /** Can the viewer answer cards here (a guest; a booth for its own)? */
  answerable: boolean;
  /** Live cards dock in a tray (a room); false = inline (the cutscene). */
  tray: boolean;
  /** The pass card settles (out of the cutscene, the pass lives in the taskbar). */
  settlePass: boolean;
}

/** Which form a card takes. */
export function cardForm(p: CardFormInput): CardForm {
  const def = WIDGETS[p.card.kind];
  if (p.card.kind === "pass") return p.settlePass ? "settled" : "full";
  if (def === undefined || !def.answerable) return "full"; // a picture, an unknown kind
  if (p.answered !== null || p.superseded || !cardAsks(p.card)) return "settled";
  if (!p.answerable) return "settled"; // shown to someone else (a booth reading a guest's thread)
  if (def.overlay === true) return "settled"; // the tour answers itself over the app
  return p.tray ? "tray" : "full";
}

/** The glyph a card kind leads with ("📝"). */
export function cardGlyph(card: WidgetCard): string {
  return WIDGETS[card.kind]?.label.split(" ")[0] ?? "🧩";
}

/** The card's own name: its text, else the kind's label ("Security check"). */
export function cardTitle(card: WidgetCard): string {
  if (card.kind === "captcha") return "Security check";
  if (card.kind === "pass") return "Your pass";
  const glyph = cardGlyph(card);
  const text = card.text.trim().replace(new RegExp(`^${escapeRe(glyph)}\\s*`, "u"), "");
  if (text !== "") return text;
  const label = WIDGETS[card.kind]?.label ?? card.kind;
  const bare = label.slice(label.indexOf(" ") + 1);
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** What a settled card says, on one line. */
export function settledLine(p: { card: WidgetCard; answered: WidgetResult | null; superseded: boolean; answerable: boolean }): string {
  const { card, answered } = p;
  const head = `${cardGlyph(card)} ${cardTitle(card)}`;
  if (card.kind === "pass") return `${head} · tap to show it`;
  if (card.kind === "fact" && answered === null && factQuestions(card.params["questions"]).length === 0) return `📝 ${FACT_CLOSED_NOTE}`;
  if (answered !== null) return `${head} · ${answeredText(card, answered)}`;
  if (p.superseded) return `${head} · replaced by a newer card`;
  if (!p.answerable) return `${head} · shown to a guest`;
  if (WIDGETS[card.kind]?.overlay === true) return `${head} · in progress`;
  return head;
}

function answeredText(card: WidgetCard, a: WidgetResult): string {
  switch (card.kind) {
    case "captcha":
      return "submitted";
    case "poll":
      return a["choice"] === undefined ? "answered" : `you chose ${String(a["choice"])}`;
    case "tutorial":
      return a["skipped"] === true ? "skipped" : a["completed"] === true ? "completed" : "answered";
    case "fact": {
      const q = typeof a["question"] === "string" ? factQuestionName(card, a["question"]) : null;
      const sure = typeof a["confidence"] === "number" ? ` · ${a["confidence"]}%` : "";
      return q !== null ? `sent for ${q}${sure}` : `sent${sure}`;
    }
    case "answer":
      return "sent";
    default:
      return "answered";
  }
}

/** What a guest calls a filed question: its label's lead ("Round 1 Q1"),
 *  else the whole label — never the story's internal id ("H1"). */
export function factQuestionName(card: WidgetCard, id: string): string {
  const label = factQuestions(card.params["questions"]).find((q) => q.id === id)?.label;
  if (label === undefined) return /^[A-Z]+\d+$/u.test(id) ? "a question" : id;
  return /^(Round \d+ Q\d+)\b/u.exec(label)?.[1] ?? label;
}

/** The receipt a tray card leaves in the stream. */
export function receiptLine(m: Pick<ChatMessage, "from" | "widget">): string {
  const card = m.widget!;
  const who = m.from !== "" && m.from !== "Narrator" ? `${m.from.replace(/_/g, " ")} asks · ` : "";
  return `${cardGlyph(card)} ${cardTitle(card)} · ${who}answer it below`;
}

/** The tray's caption for a card (glyph, name, who asked). */
export function trayCaption(m: Pick<ChatMessage, "from" | "widget">): string {
  const card = m.widget!;
  const who = m.from !== "" && m.from !== "Narrator" ? ` · ${m.from.replace(/_/g, " ")}` : "";
  return `${cardGlyph(card)} ${cardTitle(card)}${who}`;
}

/** The live cards a room's tray holds, oldest first: answerable, unanswered,
 *  not replaced, not the tour (it answers itself over the app). */
export function trayCards(
  messages: readonly ChatMessage[],
  answered: ReadonlyMap<number, WidgetResult>,
  superseded: ReadonlySet<number>,
): ChatMessage[] {
  return messages.filter(
    (m) =>
      m.kind === "widget" &&
      m.widget !== undefined &&
      m.parentSeq == null &&
      cardForm({ card: m.widget, answered: answered.get(m.seq) ?? null, superseded: superseded.has(m.seq), answerable: true, tray: true, settlePass: true }) === "tray",
  );
}

export { widgetLabel };
