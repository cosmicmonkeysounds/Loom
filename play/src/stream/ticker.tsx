//! The ambient ticker (wave 13): GENERATOR barks ("A fan spins up somewhere
//! in the walls.") as one dim line under the room header — the house
//! breathing — never stream rows, never badged. Tap to see the last few.

import { useState } from "react";
import type { ChatMessage } from "../types.ts";

/** How many barks the opened ticker lists. */
export const TICKER_HISTORY = 5;

/** The barks the opened ticker lists under its line, newest first — never
 *  the one the line already shows. */
export function earlierBarks(barks: readonly ChatMessage[]): ChatMessage[] {
  return barks.slice(Math.max(0, barks.length - 1 - TICKER_HISTORY), -1).reverse();
}

export function AmbientTicker({ messages }: { messages: readonly ChatMessage[] }) {
  const [open, setOpen] = useState(false);
  const barks = messages.filter((m) => m.ambient && !m.hidden && m.parentSeq == null);
  const last = barks[barks.length - 1];
  if (last === undefined) return null;
  const recent = earlierBarks(barks);
  return (
    <div className={`stream-ticker ${open ? "open" : ""}`}>
      <button type="button" className="stream-ticker-line" aria-expanded={open} aria-label={`Around the house: ${last.text}`} onClick={() => setOpen((o) => !o)}>
        <span className="stream-ticker-ico" aria-hidden>
          〰
        </span>
        {/* Keyed so a new bark fades in. */}
        <span key={last.seq} className="stream-ticker-text">
          {last.text}
        </span>
      </button>
      {open && recent.length > 0 && (
        <ul className="stream-ticker-list">
          {recent.map((m) => (
            <li key={m.seq}>{m.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
