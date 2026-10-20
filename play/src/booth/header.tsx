//! The booth's Start menu (wave 13): who you are in its banner, and the
//! settings that used to sit behind the old ☰ — Help, Keep my screen on, Get
//! alerts, what the character knows, moderator powers, Sign out (confirmed).

import { useState } from "react";
import { GroupPill, PersonAvatar, Sheet } from "../ui/primitives.tsx";
import type { StartItem } from "../chrome/taskbar.tsx";
import type { PrimeSession } from "../session/prime.ts";
import type { Push } from "../push.ts";
import { PushRow } from "../push-card.tsx";
import type { WakeLock } from "../wake-lock.ts";

/** The pill a booth wears: a passcode admin, or a host part. */
export function boothPill(auth: { admin: boolean; host?: boolean } | null): string | null {
  if (auth === null) return null;
  if (auth.admin) return "admin";
  return auth.host === true ? "host" : null;
}

/** The Start menu's banner: the mask you wear tonight. */
export function StartHeader({ s }: { s: PrimeSession }) {
  const pill = boothPill(s.auth);
  return (
    <div className="booth-start-head">
      <PersonAvatar name={s.auth?.character ?? "?"} kind="character" size="sm" />
      <span className="booth-start-name">{s.auth?.character}</span>
      {pill !== null && <span className="pill admin">{pill}</span>}
      <GroupPill group={s.view?.faction ?? null} />
    </div>
  );
}

export type BoothSheet = "knows" | "powers" | "alerts";

/** The Start menu's items, in order. */
export function boothStartItems({
  character,
  admin,
  host,
  knows,
  wake,
  embedded,
  onHelp,
  onSheet,
  onSignOut,
}: {
  character: string;
  admin: boolean;
  host: boolean;
  /** How many codex entries the character holds. */
  knows: number;
  wake: Pick<WakeLock, "supported" | "on" | "toggle">;
  embedded: boolean;
  onHelp: () => void;
  onSheet: (s: BoothSheet) => void;
  onSignOut: () => void;
}): StartItem[] {
  const items: StartItem[] = [{ id: "help", icon: "❓", label: "Help", onClick: onHelp }];
  if (!embedded && wake.supported) {
    items.push({ id: "wake", icon: wake.on ? "🔆" : "🔅", label: wake.on ? "Screen stays on (tap to allow sleep)" : "Keep my screen on", onClick: wake.toggle });
  }
  if (!embedded) items.push({ id: "alerts", icon: "🔔", label: "Get alerts", onClick: () => onSheet("alerts") });
  if (knows > 0) items.push({ id: "knows", icon: "📓", label: `What ${character} knows`, onClick: () => onSheet("knows") });
  if (!admin && !host) items.push({ id: "powers", icon: "🛡", label: "Add moderator powers", onClick: () => onSheet("powers") });
  items.push({ id: "signout", icon: "🚪", label: "Sign out", danger: true, confirm: `Sign out of ${character}? The part is freed for another phone.`, onClick: onSignOut });
  return items;
}

/** "Add moderator powers": the mod passcode upgrades this booth's token. */
export function PowersSheet({ session, onClose }: { session: PrimeSession; onClose: () => void }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  return (
    <Sheet title="🛡 Add moderator powers" onClose={onClose}>
      <p className="muted pad">The director's passcode turns this booth into an admin booth: hide or show messages, and press another character's buttons.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await session.becomeAdmin(pass);
            onClose();
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <input type="password" placeholder="Moderator passcode" aria-label="Moderator passcode" value={pass} onChange={(e) => setPass(e.target.value)} />
        <button type="submit" className="choice primary">
          Become an admin
        </button>
      </form>
      {err && <div className="err">{err}</div>}
    </Sheet>
  );
}

/** "What <Character> knows": the codex entries it can share from a card. */
export function KnowsSheet({ session, onClose }: { session: PrimeSession; onClose: () => void }) {
  const entries = session.view?.codex ?? [];
  return (
    <Sheet title={`📓 What ${session.auth?.character} knows`} onClose={onClose} tall>
      <p className="muted pad">Share any of these from a guest's card, one guest at a time. Knowledge is the currency.</p>
      {entries.map((e) => (
        <details key={e.id} className="codex-entry">
          <summary className="codex-entry-head">
            <span className="title">{e.title}</span>
          </summary>
          <p className="codex-text">{e.text}</p>
        </details>
      ))}
    </Sheet>
  );
}

/** "Get alerts": Web Push for this booth (the alarm reaches a locked phone). */
export function AlertsSheet({ session, push, onClose }: { session: PrimeSession; push: Push; onClose: () => void }) {
  return (
    <Sheet title="🔔 Get alerts" onClose={onClose}>
      <p className="muted pad">The server-room alarm and the late list reach this phone even when it's locked.</p>
      <PushRow push={push} booth title={session.auth?.title} />
    </Sheet>
  );
}
