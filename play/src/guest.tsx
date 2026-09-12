//! The guest (participant) app — a Discord/Telegram-style inbox of
//! conversation threads over the live story. Composed entirely from the
//! shared chat primitives; this file only supplies the registration screen,
//! the inbox header, and the sheets for out-of-band actions: the pass, the
//! Codex (knowledge as a currency), and the People directory.

import { useState } from "react";
import { ActionRow, AlertBanner, Badge, ChannelView, ConnDot, GroupPill, InviteSheet, MessageThread, PickerSheet, SpaceList } from "./chat.tsx";
import { groupCodex } from "./codex.ts";
import { HelpSheet } from "./help.tsx";
import { codeFromUrl, useDocumentTitle, useGuestSession, useUrlEventTitle, type GuestSession } from "./session.ts";
import type { Action, CodexEntry, PersonCard } from "./types.ts";

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

/** One codex entry: a tap unfolds the text; Share… hands it to someone. */
function CodexRow({ entry, onShare }: { entry: CodexEntry; onShare: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="codex-entry">
      <div className="codex-entry-head">
        <button className="title" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "▾" : "▸"} {entry.title}
        </button>
        <button className="link" onClick={onShare}>
          Share…
        </button>
      </div>
      {open && <p className="codex-text">{entry.text}</p>}
    </div>
  );
}

/**
 * The Codex — every piece of lore this guest holds, grouped by who or
 * what it is about, plus the box where a code from a wall or a puzzle is
 * redeemed. Knowledge is the currency: share an entry and the recipient
 * holds it too.
 */
function CodexSheet({ session, onClose }: { session: GuestSession; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sharing, setSharing] = useState<CodexEntry | null>(null);
  const entries = session.status?.codex ?? [];
  const total = session.status?.codexTotal ?? 0;
  const people = session.status?.people ?? [];
  const redeem = async () => {
    const c = code.trim();
    if (c === "") return;
    try {
      const unlocked = await session.redeem(c);
      setMsg(unlocked ? { ok: true, text: `Unlocked: ${unlocked}` } : { ok: false, text: "That code unlocks nothing." });
      if (unlocked) setCode("");
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose}>
        <div className="sheet tall" onClick={(e) => e.stopPropagation()}>
          <div className="codex-head">
            <h2>📓 Codex</h2>
            <span className="codex-total">
              {entries.length} of {total}
            </span>
          </div>
          <div className="codex-redeem">
            <input
              placeholder="Enter a code…"
              value={code}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void redeem()}
            />
            <button className="choice primary" onClick={() => void redeem()}>
              Unlock
            </button>
          </div>
          {msg && <div className={`codex-msg ${msg.ok ? "ok" : "bad"}`}>{msg.text}</div>}
          {entries.length === 0 && <div className="codex-empty">You know nothing yet. Codes are on the walls, in the puzzles, and in people.</div>}
          {groupCodex(entries).map((g) => (
            <div key={g.about}>
              <div className="codex-about">{g.about === "" ? "Lore" : `About ${g.about}`}</div>
              {g.entries.map((e) => (
                <CodexRow key={e.id} entry={e} onShare={() => setSharing(e)} />
              ))}
            </div>
          ))}
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {sharing && (
        <PickerSheet
          title={`Share “${sharing.title}” with…`}
          items={people.map((p) => ({ id: p.id, label: p.name, sub: p.kind === "character" ? "character" : (p.faction ?? "guest") }))}
          onPick={(id) => void session.shareCodex(sharing.id, id)}
          onClose={() => setSharing(null)}
          empty="Nobody else is here yet."
        />
      )}
    </>
  );
}

/** One directory row: a name, a kind, and exactly what you know of them. */
function PersonRow({ card, onMessage }: { card: PersonCard; onMessage: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="people-row">
      <div className="people-top">
        <span className="name">{card.name}</span>
        <span className="pill kind">{card.kind}</span>
        {card.faction && <GroupPill group={card.faction} />}
        <button className="choice ghost" onClick={onMessage}>
          💬 Message
        </button>
      </div>
      {card.known.length > 0 ? (
        <ul className="people-known">
          {card.known.map((e) => (
            <li key={e.id}>
              <button className="link" onClick={() => setOpen((v) => !v)}>
                {e.title}
              </button>
              {open && <p className="codex-text">{e.text}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="people-unknown">You know nothing about them.</div>
      )}
    </div>
  );
}

/** The People directory — everyone here, by name, with limited info unless
 *  more has been shared with you. Message anyone privately. */
function PeopleSheet({ session, onClose }: { session: GuestSession; onClose: () => void }) {
  const people = session.status?.people ?? [];
  const guests = people.filter((p) => p.kind === "guest");
  const cast = people.filter((p) => p.kind === "character");
  const open = (p: PersonCard) => {
    session.message({ id: p.id, kind: p.kind });
    onClose();
  };
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall" onClick={(e) => e.stopPropagation()}>
        <h2>👥 People</h2>
        {people.length === 0 && <div className="codex-empty">Nobody else is here yet.</div>}
        {cast.length > 0 && <div className="codex-about">Characters</div>}
        {cast.map((p) => (
          <PersonRow key={p.id} card={p} onMessage={() => open(p)} />
        ))}
        {guests.length > 0 && <div className="codex-about">Guests</div>}
        {guests.map((p) => (
          <PersonRow key={p.id} card={p} onMessage={() => open(p)} />
        ))}
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
  const [codex, setCodex] = useState(false);
  const [people, setPeople] = useState(false);
  const [help, setHelp] = useState(false);
  const [inviting, setInviting] = useState(false);
  useDocumentTitle(s.me?.title);
  if (!s.me) return <GuestRegister session={s} />;

  const st = s.status;
  const captured = st?.captured ?? false;
  const t = s.threads;
  const banner = s.alert ? <AlertBanner text={s.alert.text} onDismiss={s.dismissAlert} /> : null;

  if (t.active) {
    const active = t.active;
    if (t.activeThreadRoot !== null) {
      return (
        <>
          {banner}
          <MessageThread
            channel={active}
            rootSeq={t.activeThreadRoot}
            onClose={t.closeThread}
            onSend={(text, parentSeq) => void s.say(active.id, text, parentSeq)}
          />
        </>
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
        {banner}
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

  const codexCount = st?.codex?.length ?? 0;
  const header = (
    <header className={`inbox-head ${captured ? "trapped" : ""}`}>
      <div className="who">
        <strong>{s.me.name}</strong> <GroupPill group={st?.faction ?? null} />
      </div>
      <div className="hud">
        <span>⭐ {st?.score ?? 0}</span>
        <span>{captured ? "🔒 captured" : st?.location ? `📍 ${st.location}` : ""}</span>
        <ConnDot connected={s.connected} label="live" />
        <button className="icon-btn wide" title="Codex" onClick={() => setCodex(true)}>
          📓<span className="count">{codexCount}</span>
        </button>
        <button className="icon-btn wide" title="People" onClick={() => setPeople(true)}>
          👥
          <Badge count={0} />
        </button>
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
      {banner}
      <SpaceList spaces={t.spaces} onOpen={t.open} header={header} empty="Quiet… for now." />
      {profile && <ProfileSheet session={s} onClose={() => setProfile(false)} onLeave={onLeave} />}
      {codex && <CodexSheet session={s} onClose={() => setCodex(false)} />}
      {people && <PeopleSheet session={s} onClose={() => setPeople(false)} />}
      {help && <HelpSheet role="guest" onClose={() => setHelp(false)} />}
    </div>
  );
}
