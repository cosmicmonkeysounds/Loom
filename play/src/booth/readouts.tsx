//! Readouts (wave 13, the old Inbox): what the story told this character —
//! a scan's verdict, a button's answer, the late list, a warning — newest
//! first, kept by the server so a reload keeps them. A readout about a guest
//! opens that guest's card. Cards the story deals to the character (a poll,
//! a fact to judge) render here too and are answered in place.

import type { Channel, ChatMessage, PrimeGuest } from "../types.ts";
import { MessageBubble, type WidgetHook } from "../stream/bubble.tsx";

/** The Readouts room's rows, newest first. */
export function readoutRows(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => !m.hidden && m.parentSeq === null).sort((a, b) => b.seq - a.seq);
}

export function ReadoutsView({
  channel,
  wide,
  onBack,
  guests,
  onGuest,
  widgets,
}: {
  channel: Channel;
  wide: boolean;
  onBack: () => void;
  guests: readonly PrimeGuest[];
  onGuest: (guestId: string) => void;
  widgets?: WidgetHook;
}) {
  const rows = readoutRows(channel.messages);
  const nameOf = (id: string) => guests.find((g) => g.id === id)?.name ?? id;
  return (
    <div className="screen stage">
      <header className="thread-head">
        {!wide && (
          <button className="back" onClick={onBack} aria-label="Back">
            ‹
          </button>
        )}
        <div className="avatar scanner" aria-hidden>
          🖥️
        </div>
        <div className="thread-id">
          <strong>Readouts</strong>
          <span className="muted">what your scans and buttons said</span>
        </div>
      </header>
      <div className="booth-readouts">
        {rows.length === 0 && <p className="booth-none">Nothing yet. Scan a guest's pass: what the story says back lands here, and on their card.</p>}
        <ol className="booth-readout-list">
          {rows.map((m) =>
            m.readout === true || (m.kind !== "widget" && m.kind !== "codex" && m.kind !== "quest" && m.kind !== "wallet") ? (
              <li key={m.seq} className={`booth-readout w95-inset ${m.alert ? "alarm" : ""}`}>
                <p className="booth-readout-text">{m.text}</p>
                {m.about !== undefined && (
                  <button type="button" className="w95-btn booth-readout-guest" onClick={() => onGuest(m.about!)}>
                    🪪 {nameOf(m.about)} ›
                  </button>
                )}
              </li>
            ) : (
              <li key={m.seq} className="booth-readout-card">
                <MessageBubble msg={m} widgets={widgets} />
              </li>
            ),
          )}
        </ol>
      </div>
    </div>
  );
}
