//! The guest (participant) app — a Discord/Telegram-style inbox of
//! conversation threads over the live story. Composed entirely from the
//! shared chat primitives; this file only supplies the registration screen,
//! the inbox header, and a profile sheet for out-of-band actions.

import { useState } from "react";
import { ActionRow, ChannelView, ConnDot, GroupPill, InviteSheet, MessageThread, SpaceList } from "./chat.tsx";
import { HelpSheet } from "./help.tsx";
import { codeFromUrl, useDocumentTitle, useGuestSession, useUrlEventTitle, type GuestSession } from "./session.ts";
import type { Action } from "./types.ts";

function GuestRegister({ session }: { session: GuestSession }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(codeFromUrl);
  const [err, setErr] = useState("");
  const eventTitle = useUrlEventTitle();
  const go = async () => {
    try {
      await session.register(name.trim() || "Guest", code.trim());
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="hero">
      <div className="glyph">🎟️</div>
      <h1>{eventTitle ?? "Loom"}</h1>
      {session.notice && <p className="notice">{session.notice}</p>}
      <p className="sub">Enter your name and the code from your host.</p>
      <input
        placeholder="What do they call you?"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      <input
        placeholder="Event code (from the host)"
        value={code}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      <button className="choice primary" onClick={go}>
        Join →
      </button>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

/** Out-of-band actions: show your pass, the story's own interactions, switch
 *  sides, or leave. */
function ProfileSheet({ session, onClose, onLeave }: { session: GuestSession; onClose: () => void; onLeave: () => void }) {
  const faction = session.status?.faction ?? null;
  // One switch-sides button per other public group — driven by the story's
  // declared groups, not a baked-in pair.
  const others = (session.status?.factions ?? []).filter((f) => f !== faction);
  // The story's `who: guest` INTERACTIONs — buttons the story itself declares.
  const interactions = session.status?.interactions ?? [];
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Your pass</h2>
        {session.me && (
          <div className="pass">
            <img alt="QR" src={`/api/qr?text=${encodeURIComponent(session.me.id)}`} />
            <div className="bigid">{session.me.id}</div>
            <div className="muted">Show this to a performer to be scanned.</div>
          </div>
        )}
        {interactions.map((i) => (
          <button key={i.id} className="choice" title={i.description ?? undefined} onClick={() => void session.act(i.id)}>
            {i.label}
          </button>
        ))}
        {faction &&
          others.map((other) => (
            <button key={other} className="choice ghost" onClick={() => void session.defect(other)}>
              Leave the {faction} for the {other}
            </button>
          ))}
        <button
          className="choice danger"
          onClick={() => {
            session.leave();
            onLeave();
          }}
        >
          Leave the event
        </button>
        <button className="link" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

export function GuestApp({ onLeave }: { onLeave: () => void }) {
  const s = useGuestSession();
  const [profile, setProfile] = useState(false);
  const [help, setHelp] = useState(false);
  const [inviting, setInviting] = useState(false);
  useDocumentTitle(s.me?.title);
  if (!s.me) return <GuestRegister session={s} />;

  const st = s.status;
  const captured = st?.captured ?? false;
  const t = s.threads;

  if (t.active) {
    const active = t.active;
    if (t.activeThreadRoot !== null) {
      return (
        <MessageThread
          channel={active}
          rootSeq={t.activeThreadRoot}
          onClose={t.closeThread}
          onSend={(text, parentSeq) => void s.say(active.id, text, parentSeq)}
        />
      );
    }
    // A membership-gated room the guest belongs to can invite + leave.
    const gated = active.kind === "private" || active.kind === "group" || active.kind === "dm";
    const roomActions: Action[] = [];
    if (gated && active.member) {
      roomActions.push({ label: "＋ Invite", onClick: () => setInviting(true), tone: "primary" });
      roomActions.push({ label: "🚪 Leave", onClick: () => void s.leaveChannel(active.id), tone: "danger" });
    }
    return (
      <>
        <ChannelView
          channel={active}
          onBack={t.back}
          onOpenThread={t.openThread}
          onSend={(text) => void s.say(active.id, text)}
          footer={roomActions.length > 0 ? <ActionRow actions={roomActions} /> : undefined}
        />
        {inviting && (
          <InviteSheet
            title={`Invite to ${active.title}`}
            people={st?.roster ?? []}
            onPick={(id) => void s.inviteToChannel(id, active.id)}
            onClose={() => setInviting(false)}
          />
        )}
      </>
    );
  }

  const header = (
    <header className={`inbox-head ${captured ? "trapped" : ""}`}>
      <div className="who">
        <strong>{s.me.name}</strong> <GroupPill group={st?.faction ?? null} />
      </div>
      <div className="hud">
        <span>⭐ {st?.score ?? 0}</span>
        <span>{captured ? "🔒 captured" : st?.location ? `📍 ${st.location}` : ""}</span>
        <ConnDot connected={s.connected} label="live" />
        <button className="icon-btn" title="Help" onClick={() => setHelp(true)}>
          ?
        </button>
        <button className="icon-btn" title="Profile" onClick={() => setProfile(true)}>
          ☰
        </button>
      </div>
    </header>
  );

  return (
    <div className={captured ? "trapped-bg" : ""}>
      <SpaceList spaces={t.spaces} onOpen={t.open} header={header} empty="Quiet… for now." />
      {profile && <ProfileSheet session={s} onClose={() => setProfile(false)} onLeave={onLeave} />}
      {help && <HelpSheet role="guest" onClose={() => setHelp(false)} />}
    </div>
  );
}
