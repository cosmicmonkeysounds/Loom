//! The performer (character) app — the same chat shell as the guest,
//! recomposed for the booth: every room is theirs to run, every guest is a
//! conversation, and everything a performer can *do to* a guest (scan,
//! share lore, the story's own buttons, capture/release) lives on that
//! guest's card — never on a permanent panel under every room. A pinned
//! Scanner thread holds the camera + scan readouts.

import { useEffect, useRef, useState } from "react";
import {
  ActionRow,
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
  plural,
  useMediaQuery,
} from "./chat.tsx";
import { HelpSheet } from "./help.tsx";
import { codeFromUrl, resolveCode, useDocumentTitle, usePrimeSession, type PrimeSession } from "./session.ts";
import type { Action, Channel, PrimeGuest } from "./types.ts";

function PrimeLogin({ session }: { session: PrimeSession }) {
  const [passcode, setPasscode] = useState(codeFromUrl);
  const [character, setCharacter] = useState("");
  const [cast, setCast] = useState<string[] | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // A performer code resolves to the story's cast: offer a picker rather
  // than a blank to spell a name into.
  useEffect(() => {
    const code = passcode.trim();
    if (code.length < 4) {
      setCast(null);
      return;
    }
    let alive = true;
    void resolveCode(code).then((r) => {
      if (!alive) return;
      setTitle(r?.title ?? null);
      setCast(r && (r.role === "prime" || r.role === "mod") ? (r.characters ?? []) : null);
    });
    return () => {
      alive = false;
    };
  }, [passcode]);
  const go = async (name = character) => {
    const who = name.trim();
    if (who === "" || busy) return;
    setBusy(true);
    setErr("");
    try {
      await session.login(who, passcode.trim());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="hero">
      <div className="glyph">🎭</div>
      <h1>{title ?? "Performer station"}</h1>
      {session.notice && <p className="notice">{session.notice}</p>}
      <p className="sub">Sign in as your character. You'll speak as them everywhere.</p>
      <input
        type="password"
        placeholder="Performer passcode (from the host)"
        value={passcode}
        autoFocus={passcode === ""}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setPasscode(e.target.value)}
      />
      {cast !== null && cast.length > 0 ? (
        <div className="cast-pick" role="group" aria-label="Who are you tonight?">
          <div className="sheet-h">Who are you tonight?</div>
          {cast.map((c) => (
            <button key={c} className={`choice pick ${character === c ? "primary" : "ghost"}`} disabled={busy} onClick={() => void go(c)}>
              <PersonAvatar name={c} size="sm" kind="character" />
              <span className="pick-label">{c}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <input
            placeholder="Character (as declared in the story)"
            value={character}
            onChange={(e) => setCharacter(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void go()}
          />
          <button className="choice primary" onClick={() => void go()} disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  );
}

function Scanner({ onScan }: { onScan: (id: string) => void }) {
  const [manual, setManual] = useState("");
  const [camOn, setCamOn] = useState(false);
  const [err, setErr] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!camOn) return;
    let stop = () => {};
    let raf = 0;
    (async () => {
      const Detector = (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
      if (!Detector) {
        setErr("Camera scanning isn't supported on this device — type the id.");
        setCamOn(false);
        return;
      }
      try {
        const det = new (Detector as new (o: unknown) => { detect: (v: unknown) => Promise<Array<{ rawValue: string }>> })({ formats: ["qr_code"] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        stop = () => stream.getTracks().forEach((t) => t.stop());
        const tick = async () => {
          try {
            const codes = await det.detect(v);
            if (codes[0]) {
              onScan(codes[0].rawValue);
              setCamOn(false);
              return;
            }
          } catch {
            /* frame skip */
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        setErr("Camera error: " + (e as Error).message);
        setCamOn(false);
      }
    })();
    return () => {
      cancelAnimationFrame(raf);
      stop();
    };
  }, [camOn, onScan]);

  return (
    <div className="card">
      <input placeholder="Guest id (e.g. g-1a2b3c)" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onScan(manual.trim())} />
      <button className="choice primary" onClick={() => onScan(manual.trim())}>
        Scan
      </button>
      <button className="choice ghost" onClick={() => setCamOn((v) => !v)}>
        {camOn ? "Stop camera" : "📷 Use camera"}
      </button>
      {camOn && <video ref={videoRef} playsInline className="cam" />}
      {err && <div className="err">{err}</div>}
    </div>
  );
}

/** The pinned Scanner thread: camera/manual entry + the live scan readouts. */
function ScannerScreen({ session, onBack, wide }: { session: PrimeSession; onBack: () => void; wide: boolean }) {
  const [err, setErr] = useState("");
  const doScan = (id: string) => {
    if (!id) return;
    setErr("");
    void session.scan(id).catch((e) => setErr((e as Error).message));
  };
  return (
    <div className="screen stage">
      <header className="thread-head">
        {!wide && (
          <button className="back" onClick={onBack} aria-label="Back">
            ‹
          </button>
        )}
        <div className="avatar scanner">📷</div>
        <div className="thread-id">
          <strong>Scanner</strong>
          <span className="muted">scan a guest's pass</span>
        </div>
      </header>
      <div className="station">
        <Scanner onScan={doScan} />
        {err && <div className="err">{err}</div>}
        <div className="card">
          <h2>Readouts</h2>
          {session.responses.length === 0 ? (
            <div className="muted pad">Scan a guest to deliver their beat.</div>
          ) : (
            session.responses.map((r) => (
              <div key={r.id} className="readout">
                🖥️ {r.text}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** Inline "elevate me to admin" + what your character knows + sign-out. */
function PerformerSheet({ session, onClose, onLeave }: { session: PrimeSession; onClose: () => void; onLeave: () => void }) {
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
      {session.auth?.admin && <div className="muted pad">You hold moderator powers — hide/show messages, and every admin-only interaction the story declares.</div>}
      {(session.view?.codex?.length ?? 0) > 0 && (
        <>
          <div className="sheet-h">📓 What {session.auth?.character} knows</div>
          <div className="muted pad">Share any of these from a guest's card — one guest at a time. Knowledge is the currency.</div>
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
          session.leave();
          onLeave();
        }}
      >
        Sign out
      </button>
    </Sheet>
  );
}

/**
 * A guest's card — everything a performer can do *to* this guest: scan,
 * share lore, the story's declared performer/admin interactions, and
 * capture/release for stories still on the v3 prison mechanic. Opened from
 * a guest thread's header, a room's who's-here list, or a sender's name.
 */
function GuestCard({
  session,
  guest,
  admin,
  onClose,
  onOpenThread,
}: {
  session: PrimeSession;
  guest: PrimeGuest;
  admin: boolean;
  onClose: () => void;
  onOpenThread: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const lore = session.view?.codex ?? [];
  const where = guest.location ? (session.view?.channels.find((c) => c.id === `loc:${guest.location}`)?.title ?? guest.location) : null;
  const actions: Action[] = [{ label: "📡 Scan this guest", onClick: () => void session.scan(guest.id), tone: "primary" }];
  if (lore.length > 0) actions.push({ label: "📓 Share lore…", onClick: () => setSharing(true) });
  for (const i of session.view?.interactions ?? []) {
    if (i.who === "admin" && !admin) continue;
    actions.push({ label: i.label, onClick: () => void session.act(i.id, guest.id) });
  }
  if (admin && session.view?.legacyCapture) {
    actions.push(
      guest.captured
        ? { label: "🔓 Release", onClick: () => void session.moderate(guest.id, "release") }
        : { label: "🔒 Capture", onClick: () => void session.moderate(guest.id, "capture"), tone: "danger" },
    );
  }
  return (
    <>
      <Sheet
        title={
          <>
            <PersonAvatar name={guest.name} size="sm" /> {guest.name}
          </>
        }
        onClose={onClose}
        tall={actions.length > 5}
      >
        <div className="card-facts">
          <GroupPill group={guest.faction} />
          {where && <span className="pill">📍 {where}</span>}
          {guest.captured && <span className="pill">🔒 captured</span>}
          <span className="pill kind">{guest.id}</span>
        </div>
        <button className="choice" onClick={onOpenThread}>
          💬 Open their thread
        </button>
        <div className="sheet-h">As {session.auth?.character}</div>
        <div className="card-actions">
          <ActionRow actions={actions} />
        </div>
      </Sheet>
      {sharing && (
        <PickerSheet
          title={`Share with ${guest.name}…`}
          items={lore.map((e) => ({ id: e.id, label: e.title, sub: e.about ?? undefined }))}
          onPick={(id) => void session.shareCodex(id, guest.id)}
          onClose={() => setSharing(false)}
        />
      )}
    </>
  );
}

/** The sidebar identity: the mask you wear tonight. */
function BoothCard({ s, admin, onHelp, onSheet }: { s: PrimeSession; admin: boolean; onHelp: () => void; onSheet: () => void }) {
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
            <ConnDot connected={s.connected} label="live" />
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

/** The room a performer lands in wide: the broadcast feed. */
export function boothHome(list: Channel[]): string | null {
  return list.find((c) => c.id === "__feed")?.id ?? list[0]?.id ?? null;
}

export function PerformerApp({ onLeave }: { onLeave: () => void }) {
  const s = usePrimeSession();
  const wide = useMediaQuery(WIDE);
  const [sheet, setSheet] = useState(false);
  const [help, setHelp] = useState(false);
  const [card, setCard] = useState<string | null>(null); // a guest id
  const [people, setPeople] = useState<Channel | null>(null);
  const [picking, setPicking] = useState(false);
  useDocumentTitle(s.auth?.title);
  const t = s.threads;
  const signedIn = s.auth !== null && s.ready;
  const activeId = t.activeId;
  const home = boothHome(t.list);
  useEffect(() => {
    if (signedIn && wide && activeId === null && home !== null) t.open(home);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, wide, activeId, home]);
  if (!s.auth) return <PrimeLogin session={s} />;
  const admin = s.auth.admin;
  const guests = s.view?.guests ?? [];
  const guestByName = (name: string) => guests.find((g) => g.name === name || g.id === name) ?? null;
  const mod = admin ? { setHidden: (seq: number, hidden: boolean) => void s.setHidden(seq, hidden) } : undefined;
  const openCard = (name: string) => {
    const g = guestByName(name);
    if (g) setCard(g.id);
  };

  let stage: JSX.Element | null = null;
  if (t.active) {
    const active = t.active;
    if (active.kind === "scanner") {
      stage = <ScannerScreen session={s} onBack={t.back} wide={wide} />;
    } else {
      // The broadcast feed posts to the room (lobby); guest threads keep their
      // id (the server maps `guest:<id>` to this character's DM with that guest).
      const postChannel = active.id === "__feed" ? "lobby" : active.id;
      if (t.activeThreadRoot !== null) {
        stage = (
          <MessageThread
            channel={active}
            rootSeq={t.activeThreadRoot}
            onClose={t.closeThread}
            moderate={mod}
            onSend={(text, parentSeq) => void s.say(postChannel, text, parentSeq)}
          />
        );
      } else if (active.kind === "guest") {
        const gid = active.id.slice("guest:".length);
        stage = (
          <ChannelView
            channel={active}
            wide={wide}
            onBack={t.back}
            showChannel
            moderate={mod}
            onOpenThread={t.openThread}
            onSend={(text) => void s.say(active.id, text)}
            onPerson={openCard}
            headerActions={
              <button className="icon-btn wide" title="What you can do with this guest" onClick={() => setCard(gid)}>
                ⚡ Actions
              </button>
            }
          />
        );
      } else if (active.id.startsWith("cast:")) {
        // A private line to an agent-voiced character (the server maps
        // `cast:<id>` onto its DM thread with this performer).
        stage = (
          <ChannelView
            channel={active}
            wide={wide}
            onBack={t.back}
            moderate={mod}
            onOpenThread={t.openThread}
            onSend={(text) => void s.say(active.id, text)}
          />
        );
      } else {
        // An authored channel / a location room / the feed: post as the
        // character; a gated room can invite + leave.
        const gated = active.kind === "private" || active.kind === "group" || active.kind === "dm";
        const actions: Action[] = [];
        if (gated) actions.push({ label: "＋ Invite a guest", onClick: () => setPicking(true), tone: "primary" });
        if (gated && active.member) actions.push({ label: "🚪 Leave", onClick: () => void s.leaveChannel(active.id) });
        stage = (
          <ChannelView
            channel={active}
            wide={wide}
            onBack={t.back}
            moderate={mod}
            onOpenThread={t.openThread}
            onSend={(text) => void s.say(postChannel, text)}
            onPerson={openCard}
            onPeople={() => setPeople(active)}
            footer={actions.length > 0 ? <ActionRow actions={actions} /> : undefined}
          />
        );
      }
    }
  }

  const side = (
    <SpaceList
      spaces={t.spaces}
      activeId={t.activeId}
      onOpen={t.open}
      header={<BoothCard s={s} admin={admin} onHelp={() => setHelp(true)} onSheet={() => setSheet(true)} />}
      empty="No guests yet."
    />
  );
  const cardGuest = card !== null ? (guests.find((g) => g.id === card) ?? null) : null;

  return (
    <div className="root">
      <Shell side={side} stage={stage} wide={wide} placeholder="Pick a room, or a guest." />
      {picking && t.active && (
        <InviteSheet
          title={`Invite to ${t.active.title}`}
          people={guests.map((g) => ({ id: g.id, name: g.name }))}
          onPick={(id) => void s.inviteToChannel(id, t.active!.id)}
          onClose={() => setPicking(false)}
        />
      )}
      {people && (
        <PickerSheet
          title={`👥 In ${people.title}`}
          items={(people.people ?? []).map((p) => ({ id: p.id, label: p.name, sub: p.group ?? undefined, avatar: true }))}
          onPick={(id) => setCard(id)}
          onClose={() => setPeople(null)}
          empty="Nobody is standing here."
        />
      )}
      {cardGuest && (
        <GuestCard
          session={s}
          guest={cardGuest}
          admin={admin}
          onClose={() => setCard(null)}
          onOpenThread={() => {
            setCard(null);
            t.open(`guest:${cardGuest.id}`);
          }}
        />
      )}
      {sheet && <PerformerSheet session={s} onClose={() => setSheet(false)} onLeave={onLeave} />}
      {help && <HelpSheet role="performer" onClose={() => setHelp(false)} />}
    </div>
  );
}
