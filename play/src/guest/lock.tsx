//! The locked phone (wave 26, R1; CONTRACTS C2): while the story's `lock:`
//! header holds for this guest (`GuestView.locked`, or a `403 locked` answer
//! the snapshot hasn't caught up with), the windows give way to one screen:
//! the title bar, a ⛔ QUARANTINED card, the NOW objective (Find Gerald) read
//! as a card, a read-only copy of the Installation Wizard's thread (its
//! instructions name Bathroom Mode), and only the buttons that still work —
//! 🎟 Show my pass and the story's `restricted: allow` buttons (Bathroom
//! Mode / Back from the bathroom). No composer, no menus, no cards, no
//! wallet, no Start menu. The moments layer still shows over it (the capture
//! big, the glitch takeover). Its own lazy chunk (`lock-lazy.tsx`): it is
//! never in the guest's first load.

import { useArmButtons } from "../arm.ts";
import { Icon } from "../chrome/icons.tsx";
import { taskbarButtonClass } from "../chrome/taskbar.tsx";
import { MomentsAndPins } from "../moments/pins-rail.tsx";
import { MessageBubble } from "../stream/bubble.tsx";
import type { Channel, ChatMessage, Interaction, ObjectiveView } from "../types.ts";
import { ObjectiveCard } from "../ui/objective.tsx";
import { NowBar } from "./frame.tsx";

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

export interface LockScreenProps {
  title: string;
  objective: ObjectiveView | null;
  /** The guest's rooms: the thread is picked from them (`lockThread`). */
  rooms: readonly Channel[];
  interactions: readonly Interaction[];
  me: string;
  pins: ChatMessage[];
  paused: boolean;
  conn: "live" | "reconnecting" | "offline";
  onPass: () => void;
  onAct: (i: Interaction) => void;
}

export function LockScreen({ title, objective, rooms, interactions, me, pins, paused, conn, onPass, onAct }: LockScreenProps) {
  const arm = useArmButtons();
  const thread = lockThread(rooms);
  const lines = thread !== null ? lockLines(thread.messages) : [];
  return (
    <>
      <NowBar objectives={objective !== null ? [objective] : []} fallback={title} onOpen={() => {}} sub="🔒 captured" tone="alarm" paused={paused} />
      <MomentsAndPins pins={pins} me={me} />
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
      <nav className="taskbar lock-bar" aria-label="Taskbar">
        <button type="button" className={taskbarButtonClass({ primary: true, stacked: true })} aria-label="Pass" title="Show your pass" onClick={onPass}>
          <span className="taskbar-icon" aria-hidden>
            <Icon name="pass" size={20} />
          </span>
          <span className="taskbar-label">Pass</span>
        </button>
        <div className={`taskbar-tray ${conn}`} role="group" aria-label="Tray" />
      </nav>
    </>
  );
}
