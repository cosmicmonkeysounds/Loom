//! The pinned rail (wave 13, the moments lane): the sticky notices still up
//! (`pin "…"`), folded to one line — "📌 <text>" for one, "📌 3 · <text>"
//! for several — that opens on a tap into the full list, newest last. The
//! folded line reads the guest's own pin (one addressed to them: "GO TO THE
//! INTERNET. You are marked…") when one is up, else the newest alert pin
//! (`pin "!…"`) — the instruction a marked guest must follow is never
//! behind a tap — else the newest pin; an alert pin turns the line yellow.
//! The guest's own pin and an alert pin wrap rather than cut off.
//!
//! One strip above the room (recheck, finish review #1): while the guest's
//! own pin is up, a sticky moment does not stack a second yellow bar over
//! it — it folds into a "+n" on the pin (`MomentsAndPins`), and a tap on
//! that shows it. Nothing to show → nothing.

import { useEffect, useState } from "react";
import { Icon } from "../chrome/icons.tsx";
import type { ChatMessage } from "../types.ts";
import { MomentsLayer, useStickyMoment } from "./provider.tsx";

/** Is this pin addressed to the viewer (not the whole room)? */
export function isOwnPin(m: ChatMessage, me: string | null | undefined): boolean {
  return me != null && Array.isArray(m.audience) && m.audience.includes(me);
}

/** The pin the folded rail reads: the viewer's own (alert first), else the newest alert pin, else the newest. */
export function shownPin(pins: readonly ChatMessage[], me?: string | null): ChatMessage | null {
  if (pins.length === 0) return null;
  const newest = (list: readonly ChatMessage[]) => (list.length > 0 ? list[list.length - 1]! : null);
  const own = pins.filter((m) => isOwnPin(m, me));
  return newest(own.filter((m) => m.alert === true)) ?? newest(own) ?? newest(pins.filter((m) => m.alert === true)) ?? newest(pins);
}

export function PinnedRail({ pins, me, fold }: { pins: ChatMessage[]; me?: string | null; fold?: { count: number; onOpen: () => void } }) {
  const [open, setOpen] = useState(false);
  const shown = shownPin(pins, me);
  if (shown === null) return null;
  const alert = shown.alert === true || pins.some((m) => m.alert === true);
  // The guest's own pin and an alert pin are read whole: they wrap, never cut off.
  const wrap = shown.alert === true || isOwnPin(shown, me);
  const said = /[.!?…]$/u.test(shown.text.trim()) ? shown.text.trim() : `${shown.text.trim()}.`;
  const label = pins.length === 1 ? "1 pinned notice" : `${pins.length} pinned notices`;
  const more = fold !== undefined && fold.count > 0 ? fold : null;
  return (
    <div className={`moments-pins ${alert ? "alert" : ""}`} role="status">
      <div className="moments-pins-row">
        <button type="button" className="moments-pins-head" aria-expanded={open} aria-label={`${label}${open ? "." : `: ${said}`} ${open ? "Tap to fold." : "Tap to read."}`} onClick={() => setOpen((o) => !o)}>
          <span className="moments-pins-count" aria-hidden>
            <Icon name="pin" />
            {pins.length > 1 ? ` ${pins.length}` : ""}
          </span>
          <span className={`moments-pins-line${wrap && !open ? " wrap" : ""}`}>{open ? label : shown.text}</span>
          <span className="moments-pins-caret" aria-hidden>
            {open ? "▴" : "▾"}
          </span>
        </button>
        {more !== null && (
          <button type="button" className="w95-btn moments-pins-more" aria-label={more.count === 1 ? "1 more notice — show it" : `${more.count} more notices — show them`} onClick={more.onOpen}>
            +{more.count}
          </button>
        )}
      </div>
      {open && (
        <ul className="moments-pins-list">
          {pins.map((m) => (
            <li key={m.seq} className={`moments-pin ${m.alert ? "alert" : ""}`}>
              {m.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The waiting stickies that only repeat the pin the rail shows in full (a
 *  `!` pin is a moment too): its own `m:<seq>` (pure). */
export function stickiesOnRail(pins: readonly ChatMessage[], me: string | null | undefined, keys: readonly string[]): string[] {
  const shown = shownPin(pins, me);
  if (shown === null || !(shown.alert === true || isOwnPin(shown, me))) return [];
  return keys.filter((k) => k === `m:${shown.seq}`);
}

/** Should the sticky fold into the pin's "+n" (pure): the viewer's own pin
 *  is up, a sticky is waiting, and the viewer has not asked to see it. */
export function foldsSticky(pins: readonly ChatMessage[], me: string | null | undefined, sticky: { key: string | null; count: number }, opened: string | null): boolean {
  return sticky.key !== null && sticky.count > 0 && sticky.key !== opened && pins.some((m) => isOwnPin(m, me));
}

/**
 * The strip above the guest's room: the moments layer (the sticky in flow)
 * and the pin rail, as one. While the guest's own pin is up, the sticky
 * folds into a "+n" on it; a tap on "+n" shows that sticky (a newer one
 * folds again).
 */
export function MomentsAndPins({ pins, me }: { pins: ChatMessage[]; me: string | null }) {
  const sticky = useStickyMoment();
  const [opened, setOpened] = useState<string | null>(null);
  // A `!` pin's own sticky would repeat the rail's line in a second yellow
  // bar: the rail shows it whole, so it is read (it still chimed on arrival).
  const dup = stickiesOnRail(pins, me, sticky.keys).join("\u0000");
  const { read } = sticky;
  useEffect(() => {
    if (dup !== "") read(dup.split("\u0000"));
  }, [dup, read]);
  const fold = foldsSticky(pins, me, sticky, opened);
  return (
    <>
      <MomentsLayer foldSticky={fold} />
      <PinnedRail pins={pins} me={me} {...(fold ? { fold: { count: sticky.count, onOpen: () => setOpened(sticky.key) } } : {})} />
    </>
  );
}
