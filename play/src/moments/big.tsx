//! The big moment (wave 18, the moments lane; GUEST-SPEC §5, CONTRACTS C1):
//! the user's "big decisions … need to be large popups that are
//! un-ignorable". A Win95 Setup Wizard over the whole phone, whatever the
//! alert level: a banner with the glyph, a kicker (★ ACHIEVEMENT UNLOCKED,
//! ⚠ VIRUS DETECTED, …), the headline and the body, an install bar that
//! fills over the dead time, the moment's exits and one acknowledge button.
//! No ×, no Escape, no tap-away. A card inside it (the bottle, Help /
//! Thwart, the pickup line) is answered there and closes it; a house cheer
//! closes itself (`autoClose`).

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../chrome/icons.tsx";
import type { WidgetHook } from "../stream/bubble.tsx";
import type { WidgetCard } from "../types.ts";
import { WIDGETS, WidgetHost } from "../widgets.tsx";
import { BIG_DEAD_MS, BIG_SETTLE_MS, bigParts, cheerLabel, kickerOf } from "./big-model.ts";
import { drawnIcon, type Exit } from "./exits.ts";
import type { Queued } from "./model.ts";
import { focusedIn, typingIn } from "../ui/focus.ts";

export { BIG_DEAD_MS } from "./big-model.ts";

export interface BigCard {
  card: WidgetCard;
  seq: number;
  /** The room's title ("It's also in Trabolta's chat."). */
  room: string;
}

/** Is focus in a text field (never steal it: the iOS keyboard would drop)? */
function typing(): boolean {
  return typingIn();
}

export function BigMoment({
  q,
  index,
  total,
  exits,
  onExit,
  onAck,
  card,
  widgets,
}: {
  q: Queued;
  index: number;
  total: number;
  exits: readonly Exit[];
  onExit: (e: Exit) => void;
  onAck: () => void;
  /** The card inside it (an inline kind, with the answer path). */
  card?: BigCard;
  widgets?: WidgetHook | undefined;
}) {
  const m = q.moment;
  const inside = card !== undefined && widgets !== undefined;
  const k = kickerOf(m, { cardInside: inside });
  const parts = bigParts(m.text, m.kind, m.card?.kind);
  const cheer = k.countdown === true && m.autoClose !== undefined;
  const [live, setLive] = useState(cheer);
  const [left, setLeft] = useState(m.autoClose ?? 0);
  const ack = useRef<HTMLButtonElement>(null);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onAck();
  };
  // A big moment must be acknowledged: a text field it opens over loses
  // focus (OD-F1: keys went through it and Enter posted to the room
  // behind). The iOS keyboard dropping is fine here.
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = focusedIn(frame.current) as HTMLElement | null;
    if (el !== null && typingIn(frame.current) && frame.current?.contains(el) !== true) el.blur();
  }, []);
  // The dead time: every button waits 1.2 s (the install bar fills meanwhile).
  useEffect(() => {
    if (cheer) return;
    const t = window.setTimeout(() => setLive(true), BIG_DEAD_MS);
    return () => window.clearTimeout(t);
  }, [cheer]);
  useEffect(() => {
    if (live && !typing()) ack.current?.focus();
  }, [live]);
  // A house cheer counts down and closes itself.
  useEffect(() => {
    if (!cheer || m.autoClose === undefined) return;
    const end = Date.now() + m.autoClose;
    const t = window.setInterval(() => {
      const l = end - Date.now();
      setLeft(l);
      if (l <= 0) finish();
    }, 250);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheer, m.autoClose]);
  // A card answered inside: its settled state shows a moment, then the window closes.
  const answered = inside ? (widgets.answered.get(card.seq) ?? null) : null;
  // Answered here → closes itself; answered elsewhere (the room, another tab) → an OK appears.
  const answeredHere = useRef(false);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (answered === null && !sent) return;
    if (!answeredHere.current) return;
    const t = window.setTimeout(finish, BIG_SETTLE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered !== null, sent]);
  // No Escape, no tap-away: the keys stay inside.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const def = card !== undefined ? WIDGETS[card.card.kind] : undefined;
  const bleed = inside && def?.fullBleed === true;
  // The ack: none while a card waits for its answer (answered elsewhere → OK).
  const ackLabel = inside ? (answered !== null && !answeredHere.current ? "OK" : null) : cheer ? cheerLabel(left) : k.ack;
  const tone = k.kicker.startsWith("⚠") || k.kicker.startsWith("⛔") ? " alarm" : k.kicker.startsWith("★") ? " win" : "";
  // A full-bleed card (the doors) is the whole screen: no caption, no
  // kicker, no footer, no exits — only the card (GN-F9, GUEST-SPEC §9.1).
  return (
    <div ref={frame} className={`moments-big${bleed ? " full-bleed" : ""}${tone}`} role="alertdialog" aria-modal="true" aria-labelledby={`moments-big-${m.key}`} onKeyDown={onKey}>
      <div className="moments-big-window w95-window">
        {!bleed && (
          <div className="w95-titlebar moments-big-caption">
            <span className="w95-title">{m.caption}</span>
          </div>
        )}
        <div className="moments-big-body">
          {!bleed && (
            <div className={`moments-big-banner${inside ? " short" : ""}`} aria-hidden>
              <span className="moments-big-glyph">{parts.glyph}</span>
            </div>
          )}
          {!bleed && (
            <div className="moments-big-kicker">
              <span>{k.kicker}</span>
              {total > 1 && (
                <span className="moments-big-count" aria-label={`${index} of ${total}`}>
                  {index} of {total}
                </span>
              )}
            </div>
          )}
          {!bleed && (
            <>
              <h2 id={`moments-big-${m.key}`} className="moments-big-headline">
                {parts.headline}
              </h2>
              {parts.body !== "" && <p className="moments-big-text">{parts.body}</p>}
            </>
          )}
          {bleed && (
            <h2 id={`moments-big-${m.key}`} className="moments-visually-hidden">
              {parts.headline}
            </h2>
          )}
          {inside && card !== undefined && widgets !== undefined && (
            <div className="moments-big-card">
              <WidgetHost
                card={card.card}
                seed={card.seq}
                viewer={widgets.viewer ?? null}
                answered={answered}
                {...(answered === null
                  ? {
                      onAnswer: (r) => {
                        answeredHere.current = true;
                        setSent(true);
                        widgets.answer(card.seq, r);
                      },
                    }
                  : {})}
              />
            </div>
          )}
          {inside && !bleed && k.footer !== undefined && answered === null && (
            <p className="moments-big-footer">
              {k.footer} It&apos;s also in {card.room}&apos;s chat.
            </p>
          )}
          {k.bar !== null && (
            <div className="moments-big-install">
              <span className="moments-big-install-line">{live ? k.bar.done : k.bar.during}</span>
              <span className="moments-big-bar w95-inset" aria-hidden>
                <span className="moments-big-fill" />
              </span>
            </div>
          )}
          <div className="moments-big-buttons">
            {(bleed ? [] : exits.slice(0, 2)).map((x) => (
              <button key={`${x.nav.to}:${x.label}`} type="button" className="w95-btn moments-big-exit" disabled={!live} onClick={() => live && onExit(x)}>
                {drawnIcon(x) !== null && <Icon name={drawnIcon(x)!} size={16} />}
                <span className="moments-exit-label">{x.label}</span>
              </button>
            ))}
            {ackLabel !== null && (
              <button ref={ack} type="button" className="w95-btn moments-big-ack" disabled={!live} onClick={() => live && finish()}>
                {ackLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
