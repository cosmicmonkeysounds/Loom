//! The booth's identity card and its settings sheet (moved out of
//! `performer.tsx` in wave 13).

import { useState } from "react";
import { ConnDot, GroupPill, PersonAvatar, Sheet, WakeLockToggle, connLabel, plural } from "../ui/primitives.tsx";
import { approvalBadge } from "../wallet.tsx";
import type { PrimeSession } from "../session/prime.ts";
import type { Push } from "../push.ts";
import { PushRow } from "../push-card.tsx";

/** Inline "elevate me to admin" + what your character knows + sign-out. */
export function PerformerSheet({ session, push, onClose, onLeave }: { session: PrimeSession; push: Push; onClose: () => void; onLeave: () => void }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  return (
    <Sheet title={`🎭 ${session.auth?.character}`} onClose={onClose} tall>
      {!session.auth?.admin && (
        <>
          <div className="sheet-h">Add moderator powers</div>
          <input type="password" placeholder="Moderator passcode" value={pass} onChange={(e) => setPass(e.target.value)} />
          <button
            className="choice primary"
            onClick={async () => {
              try {
                await session.becomeAdmin(pass);
                onClose();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Become an admin
          </button>
          {err && <div className="err">{err}</div>}
        </>
      )}
      <WakeLockToggle />
      <PushRow push={push} booth />
      {session.auth?.admin && <div className="muted pad">You hold moderator powers — hide/show messages, and every admin-only interaction the story declares.</div>}
      {(session.view?.codex?.length ?? 0) > 0 && (
        <>
          <div className="sheet-h">📓 What {session.auth?.character} knows</div>
          <div className="muted pad">Share any of these from a guest's card — one guest at a time. Knowledge is the currency.</div>
          {(session.view?.codexTotal ?? 0) > 0 && <div className="muted pad">Also a room: 📓 Codex, under Pinned.</div>}
          {session.view!.codex!.map((e) => (
            <div key={e.id} className="codex-entry">
              <div className="codex-entry-head">
                <span className="title">{e.title}</span>
              </div>
              <p className="codex-text">{e.text}</p>
            </div>
          ))}
        </>
      )}
      <button
        className="choice danger"
        onClick={() => {
          push.release();
          session.leave();
          onLeave();
        }}
      >
        Sign out
      </button>
    </Sheet>
  );
}

/** The sidebar identity: the mask you wear tonight. */
export function BoothCard({ s, admin, onHelp, onSheet }: { s: PrimeSession; admin: boolean; onHelp: () => void; onSheet: () => void }) {
  return (
    <header className="inbox-head">
      <div className="me">
        <PersonAvatar name={s.auth?.character ?? "?"} kind="character" />
        <div className="me-body">
          <div className="who">
            🎭 <strong>{s.auth?.character}</strong> {admin && <span className="pill admin">admin</span>}
          </div>
          <div className="me-sub">
            <GroupPill group={s.view?.faction ?? null} />
            <span>{plural(s.view?.guests.length ?? 0, "guest")}</span>
            {approvalBadge(s.view?.wallet) !== null && <span className="wallet-badge">{approvalBadge(s.view?.wallet)}</span>}
            <ConnDot connected={s.connected} label={connLabel(s.connected)} />
          </div>
        </div>
      </div>
      <div className="hud">
        <button className="icon-btn" title="Help" onClick={onHelp}>
          ?
        </button>
        <button className="icon-btn" title="Your character & settings" onClick={onSheet}>
          ☰
        </button>
      </div>
    </header>
  );
}
