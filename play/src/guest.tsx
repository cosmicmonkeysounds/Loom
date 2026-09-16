//! The guest (participant) app — a Discord/MSN-style chat over the live
//! story: a sidebar of rooms (the one you're standing in first, who's in
//! each), the open room on the stage, and the story's cards (a decision, a
//! CAPTCHA) docked right in the conversation. Composed entirely from the
//! shared chat primitives; this file only supplies the registration screen,
//! the identity card, and the sheets for out-of-band actions: the pass, the
//! Codex (knowledge as a currency), and the People directory.

import { useEffect, useState } from "react";
import {
  ActionRow,
  AlertBanner,
  ChannelView,
  ConnDot,
  GroupPill,
  InviteSheet,
  MessageThread,
  PersonAvatar,
  PickerSheet,
  Sheet,
  Shell,
  SpaceList,
  WIDE,
  useMediaQuery,
} from "./chat.tsx";
import { groupCodex } from "./codex.ts";
import { HelpSheet } from "./help.tsx";
import { codeFromUrl, useDocumentTitle, useGuestSession, useUrlEventTitle, type GuestSession } from "./session.ts";
import type { Action, Channel, CodexEntry, PersonCard } from "./types.ts";

function GuestRegister({ session }: { session: GuestSession }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(codeFromUrl);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const eventTitle = useUrlEventTitle();
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await session.register(name.trim() || "Guest", code.trim());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
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
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void go()}
      />
      <input
        placeholder="Event code (from the host)"
        value={code}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void go()}
      />
      <button className="choice primary" onClick={() => void go()} disabled={busy}>
        {busy ? "Joining…" : "Join →"}
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
    <Sheet title="Your pass" onClose={onClose}>
      {session.me && (
        <div className="pass">
          <img alt="QR" src={`/api/qr?text=${encodeURIComponent(session.me.id)}`} />
          <div className="bigid">{session.me.id}</div>
          <div className="muted">Show this to a performer to be scanned.</div>
        </div>
      )}
      {interactions.length > 0 && <div className="sheet-h">Things you can do</div>}
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
    </Sheet>
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
      <Sheet
        title={
          <>
            📓 Codex <span className="codex-total">{entries.length} of {total}</span>
          </>
        }
        onClose={onClose}
        tall
      >
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
      </Sheet>
      {sharing && (
        <PickerSheet
          title={`Share “${sharing.title}” with…`}
          items={people.map((p) => ({ id: p.id, label: p.name, sub: p.kind === "character" ? "character" : (p.faction ?? "guest"), avatar: true }))}
          onPick={(id) => void session.shareCodex(sharing.id, id)}
          onClose={() => setSharing(null)}
          empty="Nobody else is here yet."
        />
      )}
    </>
  );
}

/** One directory row: a name, a kind, where they are, and what you know of them. */
function PersonRow({ card, onMessage }: { card: PersonCard; onMessage: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="people-row">
      <div className="people-top">
        <PersonAvatar name={card.name} size="sm" kind={card.kind} />
        <span className="name">{card.name}</span>
        <span className="pill kind">{card.kind}</span>
        {card.faction && <GroupPill group={card.faction} />}
        <button className="choice ghost" onClick={onMessage}>
          💬 Message
        </button>
      </div>
      {card.location && <div className="people-where">📍 {card.location}</div>}
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
function PeopleSheet({ session, only, onClose }: { session: GuestSession; only?: ReadonlySet<string>; onClose: () => void }) {
  const all = session.status?.people ?? [];
  const people = only ? all.filter((p) => only.has(p.id)) : all;
  const guests = people.filter((p) => p.kind === "guest");
  const cast = people.filter((p) => p.kind === "character");
  const open = (p: PersonCard) => {
    session.message({ id: p.id, kind: p.kind });
    onClose();
  };
  return (
    <Sheet title={only ? "👥 Who's here" : "👥 People"} onClose={onClose} tall>
      {people.length === 0 && <div className="codex-empty">{only ? "Nobody else is in this room." : "Nobody else is here yet."}</div>}
      {cast.length > 0 && <div className="codex-about">Characters</div>}
      {cast.map((p) => (
        <PersonRow key={p.id} card={p} onMessage={() => open(p)} />
      ))}
      {guests.length > 0 && <div className="codex-about">Guests</div>}
      {guests.map((p) => (
        <PersonRow key={p.id} card={p} onMessage={() => open(p)} />
      ))}
    </Sheet>
  );
}

/** The identity card at the top of the sidebar: who you are, where you are. */
function IdentityCard({ s, onCodex, onPeople, onHelp, onProfile }: { s: GuestSession; onCodex: () => void; onPeople: () => void; onHelp: () => void; onProfile: () => void }) {
  const st = s.status;
  const captured = st?.captured ?? false;
  const codexCount = st?.codex?.length ?? 0;
  const where = captured ? "🔒 captured" : st?.location ? `📍 ${st.location}` : "📍 nowhere yet";
  return (
    <header className={`inbox-head ${captured ? "trapped" : ""}`}>
      <div className="me">
        <PersonAvatar name={s.me?.name ?? "?"} />
        <div className="me-body">
          <div className="who">
            <strong>{s.me?.name}</strong> <GroupPill group={st?.faction ?? null} />
          </div>
          <div className="me-sub">
            <span>{where}</span>
            <span>⭐ {st?.score ?? 0}</span>
            <ConnDot connected={s.connected} label="live" />
          </div>
        </div>
      </div>
      <div className="hud">
        <button className="icon-btn wide" title="Codex — what you know" onClick={onCodex}>
          📓<span className="count">{codexCount}</span>
        </button>
        <button className="icon-btn" title="People" onClick={onPeople}>
          👥
        </button>
        <button className="icon-btn" title="Help" onClick={onHelp}>
          ?
        </button>
        <button className="icon-btn" title="Your pass & settings" onClick={onProfile}>
          ☰
        </button>
      </div>
    </header>
  );
}

/** The room a guest should land in when the app opens wide: where they
 *  stand, else the room asking for a decision, else the story's lobby. */
export function homeChannel(list: Channel[]): string | null {
  return (
    list.find((c) => c.decision || c.needsYou)?.id ??
    list.find((c) => c.here)?.id ??
    list.find((c) => c.kind === "lobby")?.id ??
    list[0]?.id ??
    null
  );
}

export function GuestApp({ onLeave }: { onLeave: () => void }) {
  const s = useGuestSession();
  const wide = useMediaQuery(WIDE);
  const [profile, setProfile] = useState(false);
  const [codex, setCodex] = useState(false);
  const [people, setPeople] = useState<ReadonlySet<string> | "all" | null>(null);
  const [help, setHelp] = useState(false);
  const [inviting, setInviting] = useState(false);
  useDocumentTitle(s.me?.title);
  const t = s.threads;
  // On a wide screen the stage is never blank: open the natural room.
  const signedIn = s.me !== null && s.ready;
  const activeId = t.activeId;
  const home = homeChannel(t.list);
  useEffect(() => {
    if (signedIn && wide && activeId === null && home !== null) t.open(home);
    // `t` is rebuilt each render; the ids are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, wide, activeId, home]);
  if (!s.me) return <GuestRegister session={s} />;

  const st = s.status;
  const captured = st?.captured ?? false;
  const banner = s.alert ? <AlertBanner text={s.alert.text} onDismiss={s.dismissAlert} /> : null;
  const widgets = { answer: (seq: number, r: Parameters<GuestSession["answerWidget"]>[1]) => void s.answerWidget(seq, r).catch(() => {}), answered: s.widgetAnswers };

  let stage: JSX.Element | null = null;
  if (t.active) {
    const active = t.active;
    if (t.activeThreadRoot !== null) {
      stage = (
        <MessageThread
          channel={active}
          rootSeq={t.activeThreadRoot}
          onClose={t.closeThread}
          onSend={(text, parentSeq) => void s.say(active.id, text, parentSeq)}
        />
      );
    } else {
      // A membership-gated room the guest belongs to can invite + leave.
      const gated = active.kind === "private" || active.kind === "group" || active.kind === "dm";
      const roomActions: Action[] = [];
      if (gated && active.member) {
        roomActions.push({ label: "＋ Invite", onClick: () => setInviting(true), tone: "primary" });
        roomActions.push({ label: "🚪 Leave", onClick: () => void s.leaveChannel(active.id), tone: "danger" });
      }
      stage = (
        <ChannelView
          channel={active}
          wide={wide}
          meId={s.me.id}
          onBack={t.back}
          onOpenThread={t.openThread}
          onSend={(text) => void s.say(active.id, text)}
          widgets={widgets}
          onPeople={() => setPeople(new Set((active.people ?? []).map((p) => p.id)))}
          footer={roomActions.length > 0 ? <ActionRow actions={roomActions} /> : undefined}
        />
      );
    }
  }

  const side = (
    <SpaceList
      spaces={t.spaces}
      activeId={t.activeId}
      meId={s.me.id}
      onOpen={t.open}
      header={<IdentityCard s={s} onCodex={() => setCodex(true)} onPeople={() => setPeople("all")} onHelp={() => setHelp(true)} onProfile={() => setProfile(true)} />}
      empty="Quiet… for now."
    />
  );

  return (
    <div className={`root ${captured ? "trapped-bg" : ""}`}>
      {banner}
      <Shell side={side} stage={stage} wide={wide} placeholder="Pick a room on the left. The one you're standing in is at the top." />
      {inviting && t.active && (
        <InviteSheet
          title={`Invite to ${t.active.title}`}
          people={st?.roster ?? []}
          onPick={(id) => void s.inviteToChannel(id, t.active!.id)}
          onClose={() => setInviting(false)}
        />
      )}
      {profile && <ProfileSheet session={s} onClose={() => setProfile(false)} onLeave={onLeave} />}
      {codex && <CodexSheet session={s} onClose={() => setCodex(false)} />}
      {people !== null && <PeopleSheet session={s} only={people === "all" ? undefined : people} onClose={() => setPeople(null)} />}
      {help && <HelpSheet role="guest" onClose={() => setHelp(false)} />}
    </div>
  );
}
