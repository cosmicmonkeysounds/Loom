//! The pinned rail (wave 13, the moments lane): the sticky notices still up
//! (`pin "…"`), folded to one line — "📌 <text>" for one, "📌 3 · <text>"
//! for several — that opens on a tap into the full list, newest last. The
//! folded line reads the newest alert pin (`pin "!…"`) when one is up — the
//! instruction a marked guest must follow is never behind a tap — else the
//! newest pin; an alert pin turns the line yellow. Nothing to show → nothing.

import { useState } from "react";
import type { ChatMessage } from "../types.ts";

export function PinnedRail({ pins }: { pins: ChatMessage[] }) {
  const [open, setOpen] = useState(false);
  if (pins.length === 0) return null;
  const alerts = pins.filter((m) => m.alert === true);
  const alert = alerts.length > 0;
  const shown = alert ? alerts[alerts.length - 1]! : pins[pins.length - 1]!;
  const said = /[.!?…]$/u.test(shown.text.trim()) ? shown.text.trim() : `${shown.text.trim()}.`;
  const label = pins.length === 1 ? "1 pinned notice" : `${pins.length} pinned notices`;
  return (
    <div className={`moments-pins ${alert ? "alert" : ""}`} role="status">
      <button type="button" className="moments-pins-head" aria-expanded={open} aria-label={`${label}${open ? "." : `: ${said}`} ${open ? "Tap to fold." : "Tap to read."}`} onClick={() => setOpen((o) => !o)}>
        <span className="moments-pins-count" aria-hidden>
          📌{pins.length > 1 ? ` ${pins.length}` : ""}
        </span>
        <span className="moments-pins-line">{open ? label : shown.text}</span>
        <span className="moments-pins-caret" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>
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
