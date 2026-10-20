//! The card tray (wave 13): the live cards waiting on you — a CAPTCHA, a
//! poll, a 📝 fact, a 💬 answer — docked above the composer like the
//! decision box, so a room still reads as a conversation and the card can't
//! scroll away. The stream keeps a one-line receipt (`settled.ts`). One card
//! shows at a time (‹ 1 of 3 ›); the bar folds the card to one line.
//!
//! The tray never takes the room over: it opens for a card you haven't seen
//! yet, comes back folded once you have (a 📝 fact card re-dealt all through
//! the hunt is the same card), and folds while you type in the composer.

import { useEffect, useState } from "react";
import { usePlayHost } from "../host.ts";
import type { ChatMessage } from "../types.ts";
import { WIDGETS, WidgetHost } from "../widgets.tsx";
import type { WidgetHook } from "./bubble.tsx";
import { trayCaption } from "./settled.ts";

/** Which card this is, across re-deals: a `supersedes` kind (the 📝 fact
 *  card) is one card per room, whatever its seq; anything else is its seq. */
export function trayCardKey(m: Pick<ChatMessage, "seq" | "channel" | "widget">): string {
  const kind = m.widget?.kind;
  return kind !== undefined && WIDGETS[kind]?.supersedes === true ? `${m.channel}\u0000${kind}` : String(m.seq);
}

/** The card the tray leads with: the one a receipt asked for, else (and when
 *  that card has left the tray) the newest. */
export function trayIndex(cards: readonly Pick<ChatMessage, "seq">[], focus: number | null): number {
  const at = focus !== null ? cards.findIndex((c) => c.seq === focus) : -1;
  return at >= 0 ? at : Math.max(0, cards.length - 1);
}

/** Cards each pane's tray has already shown open (keyed by its crawl, one
 *  per host): a re-entry starts folded on them. */
const shownByHost = new WeakMap<object, Set<string>>();

/** The card keys a host's trays have shown open (`trayCardKey`). */
export function trayShown(crawl: object): Set<string> {
  let shown = shownByHost.get(crawl);
  if (shown === undefined) shownByHost.set(crawl, (shown = new Set()));
  return shown;
}

export function CardTray({
  cards,
  widgets,
  focus,
  onFocus,
  composing = false,
}: {
  /** The room's live cards, oldest first (`trayCards`). */
  cards: readonly ChatMessage[];
  widgets: WidgetHook;
  /** The card a receipt asked for (a seq), if any. */
  focus: number | null;
  onFocus: (seq: number | null) => void;
  /** The composer has focus: fold, so the conversation keeps the room. */
  composing?: boolean;
}) {
  const host = usePlayHost();
  const seen = trayShown(host.crawl);
  // The newest card leads; a receipt's tap jumps to its card and opens it.
  const index = trayIndex(cards, focus);
  const card = cards[index];
  const [open, setOpen] = useState(() => card !== undefined && !seen.has(trayCardKey(card)));
  useEffect(() => {
    if (focus !== null) setOpen(true);
  }, [focus]);
  // Folding lets go of the receipt's ask, so its next tap opens it again.
  const fold = () => {
    setOpen(false);
    if (focus !== null) onFocus(null);
  };
  useEffect(() => {
    if (composing) fold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composing]);
  // A new card (not a re-deal of one you've seen) opens the tray again.
  const key = card !== undefined ? trayCardKey(card) : null;
  useEffect(() => {
    if (key !== null && !seen.has(key) && !composing) setOpen(true);
    // `composing` is read, not watched: typing never re-opens it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, seen]);
  useEffect(() => {
    if (open && card !== undefined) seen.add(trayCardKey(card));
  }, [open, card, seen]);
  if (card === undefined) return null;
  const n = cards.length;
  const step = (d: number) => onFocus(cards[(index + d + n) % n]!.seq);
  return (
    <section className={`stream-tray ${open ? "open" : ""}`} aria-label="Waiting for your answer">
      <div className="stream-tray-bar">
        <button type="button" className="stream-tray-title" aria-expanded={open} onClick={() => (open ? fold() : setOpen(true))}>
          <span className="stream-tray-caption">{trayCaption(card)}</span>
          <span className="stream-tray-fold" aria-hidden>
            {open ? "▾" : "▴"}
          </span>
        </button>
        {n > 1 && (
          <span className="stream-tray-pager">
            <button type="button" className="stream-tray-step" aria-label="Previous card" onClick={() => step(-1)}>
              ‹
            </button>
            <span className="stream-tray-count">
              {index + 1} of {n}
            </span>
            <button type="button" className="stream-tray-step" aria-label="Next card" onClick={() => step(1)}>
              ›
            </button>
          </span>
        )}
      </div>
      {open && (
        <div className="stream-tray-body">
          <WidgetHost
            key={card.seq}
            card={card.widget!}
            seed={card.seq}
            answered={null}
            viewer={widgets.viewer ?? null}
            onAnswer={(r) => {
              widgets.answer(card.seq, r);
              onFocus(null);
            }}
          />
        </div>
      )}
    </section>
  );
}
