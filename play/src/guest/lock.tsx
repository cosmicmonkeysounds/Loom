//! The locked phone (wave 26, R1; CONTRACTS C2): while the story's `lock:`
//! header holds for this guest (`GuestView.locked`, or a `403 locked` answer
//! the snapshot hasn't caught up with), the windows give way to one screen:
//! the title bar, a ⛔ QUARANTINED card, the NOW objective (Find Gerald) read
//! as a card, a read-only copy of the Installation Wizard's thread (its
//! instructions name Bathroom Mode), and only the buttons that still work —
//! 🎟 Show my pass and the story's `restricted: allow` buttons (Bathroom
//! Mode / Back from the bathroom). No composer, no menus, no cards, no
//! wallet, no Start menu. Its own lazy chunk: it is never in the guest's
//! first load. The frame around it — the title bar, the moments layer (the
//! capture big, the glitch takeover) and the Pass-only taskbar — is eager
//! (`LockFrame` in `lock-lazy.tsx`), so a chunk still loading or one that
//! won't load never costs the guest their pass or the moments.

import { useArmButtons } from "../arm.ts";
import { MessageBubble } from "../stream/bubble.tsx";
import type { Channel, ChatMessage, Interaction, ObjectiveView } from "../types.ts";
import { ObjectiveCard } from "../ui/objective.tsx";

/** The thread a locked phone keeps reading: the reinstallation's own. */
export const LOCK_THREAD = "dm:Installation Wizard";

// DRAFT w26 (R1): the lock screen's card.
export const LOCK_HEAD = "⛔ QUARANTINED";
// DRAFT w26 (R1): the lock screen's card.
export const LOCK_TEXT = "This program is being reinstalled. Everything else on this phone is locked until it's done.";

/** The thread shown read-only: the Installation Wizard's DM, else (a story
 *  without one) the DM that spoke last; null when there is none. */
export function lockThread(list: readonly Channel[]): Channel | null {
  const own = list.find((c) => c.id === LOCK_THREAD);
  if (own !== undefined) return own;
  let best: Channel | null = null;
  let last = -1;
  for (const c of list) {
    if (c.kind !== "dm") continue;
    const seq = c.messages[c.messages.length - 1]?.seq ?? -1;
    if (seq > last) {
      best = c;
      last = seq;
    }
  }
  return best;
}

/** What a read-only copy keeps: the lines, never a card, a menu or a reply. */
export function lockLines(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => (m.kind === "line" || m.kind === "narration") && m.widget === undefined && m.parentSeq == null);
}

/** The buttons that still work: the live `restricted: allow` ones the view kept. */
export function lockButtons(interactions: readonly Interaction[]): Interaction[] {
  return interactions.filter((i) => i.live !== false);
}

/** The lock screen's body (the part between the title bar and the taskbar). */
export interface LockScreenProps {
  objective: ObjectiveView | null;
  /** The guest's rooms: the thread is picked from them (`lockThread`). */
  rooms: readonly Channel[];
  interactions: readonly Interaction[];
  onPass: () => void;
  onAct: (i: Interaction) => void;
}

export function LockScreen({ objective, rooms, interactions, onPass, onAct }: LockScreenProps) {
  const arm = useArmButtons();
  const thread = lockThread(rooms);
  const lines = thread !== null ? lockLines(thread.messages) : [];
  return (
    <main className="lock-screen" aria-label="This phone is locked">
      <section className="lock-card w95-window" role="status">
        <h2 className="lock-head">{LOCK_HEAD}</h2>
        <p className="lock-text">{LOCK_TEXT}</p>
        <div className="lock-actions">
          <button type="button" className="choice primary lock-btn" onClick={onPass}>
            🎟 Show my pass
          </button>
          {lockButtons(interactions).map((i) => (
            <button key={i.id} type="button" className={`choice lock-btn${arm.armed === i.id ? " armed" : ""}`} onClick={() => arm.tap(i.id, i.arm, () => onAct(i))}>
              {arm.armed === i.id ? "Tap again" : i.label}
            </button>
          ))}
        </div>
      </section>
      {objective !== null && <ObjectiveCard objective={{ ...objective, buttons: [] }} />}
      {thread !== null && lines.length > 0 && (
        <section className="lock-thread" aria-label={thread.title}>
          <h3 className="lock-thread-head">{thread.title}</h3>
          <div className="lock-lines">
            {lines.map((m) => (
              <MessageBubble key={m.seq} msg={m} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
