//! The card tray (wave 13): the live cards waiting on you — a CAPTCHA, a
//! poll, a 📝 fact, a 💬 answer — docked above the composer like the
//! decision box, so a room still reads as a conversation and the card can't
//! scroll away. The stream keeps a one-line receipt (`settled.ts`). One card
//! shows at a time (‹ 1 of 3 ›); the bar folds the card to one line.

import { useEffect, useState } from "react";
import type { ChatMessage } from "../types.ts";
import { WidgetHost } from "../widgets.tsx";
import type { WidgetHook } from "./bubble.tsx";
import { trayCaption } from "./settled.ts";

export function CardTray({
  cards,
  widgets,
  focus,
  onFocus,
}: {
  /** The room's live cards, oldest first (`trayCards`). */
  cards: readonly ChatMessage[];
  widgets: WidgetHook;
  /** The card a receipt asked for (a seq), if any. */
  focus: number | null;
  onFocus: (seq: number | null) => void;
}) {
  const [open, setOpen] = useState(true);
  // The newest card leads; a receipt's tap jumps to its card and opens it.
  const index = Math.max(0, focus !== null ? cards.findIndex((c) => c.seq === focus) : cards.length - 1);
  const card = cards[Math.min(index, cards.length - 1)];
  useEffect(() => {
    if (focus !== null) setOpen(true);
  }, [focus]);
  if (card === undefined) return null;
  const n = cards.length;
  const step = (d: number) => onFocus(cards[(index + d + n) % n]!.seq);
  return (
    <section className={`stream-tray ${open ? "open" : ""}`} aria-label="Waiting for your answer">
      <div className="stream-tray-bar">
        <button type="button" className="stream-tray-title" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
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
