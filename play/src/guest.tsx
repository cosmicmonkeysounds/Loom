//! The guest (participant) app — a Discord/MSN-style chat over the live
//! story: a sidebar of rooms (the one you're standing in first, who's in
//! each), the open room on the stage, and the story's cards (a decision, a
//! CAPTCHA) docked right in the conversation. Composed entirely from the
//! shared chat primitives; this file only supplies the registration screen,
//! the identity card, and the sheets for out-of-band actions: the pass and
//! the People directory. The Codex (knowledge as a currency) and the Quest
//! Log are pinned rooms at the top of the sidebar, not sheets: the Codex's
//! composer takes codes, and every quest is a card with its own thread.

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  ActionRow,
  AlertBanner,
  CardActionsProvider,
  ChannelView,
  ConnDot,
  connLabel,
  GroupPill,
  InviteSheet,
  MessageThread,
  PersonAvatar,
  PickerSheet,
  PinnedRail,
  Sheet,
  SessionEnded,
  Shell,
  SpaceList,
  WakeLockToggle,
  useWide,
} from "./chat.tsx";
import { CutsceneStage } from "./cutscene.tsx";
import { PassQr } from "./pass-qr.tsx";
import { useOfflineFor } from "./client.ts";
import { HelpSheet } from "./help.tsx";
import { usePlayHost } from "./host.ts";
import { AvatarsContext, avatarLookup, avatarUrl, hitNote, hitPickable, initialPick, orderPicker, rowNote, rowPickable, rowTitle, type PictureChoice, type PictureChoices, type ProgramHit } from "./avatars.ts";
import { claimFromSearch, registerErrorText } from "./claim.ts";
import { PictureGrid } from "./picture-pick.tsx";
import { codeFromUrl, defectTargets, fetchPictures, pendingWidget, personalStream, searchPrograms, useDocumentTitle, useGuestSession, useIdentities, useLandingBrand, type GuestSession } from "./session.ts";
import { Tutorial, tourResult, tutorialSteps } from "./tutorial.tsx";
import { CODEX_ROOM, WALLET_ROOM, withThe } from "./threads.ts";
import { BalancePill, FreezeSheet, OfferSheet, PeopleAmountSheet, StimulusSheet, WalletActionsProvider, WalletFooter, frozenUntil, guestWalletActions, useWalletClock, type WalletSheet } from "./wallet.tsx";
import type { Action, Channel, PersonCard } from "./types.ts";
import { usePush, type Push } from "./push.ts";
import { PushCard, PushRow } from "./push-card.tsx";
import { opensHome } from "./room.ts";
import { redeemErrorText } from "./codex.ts";
import { activePins, activeTakeover } from "./pins.ts";
import { Takeover } from "./takeover.tsx";
import { ARM_LINE, useArmButtons } from "./arm.ts";
import { CountdownStrip } from "./countdown.tsx";
import { LinkLanding, ScanSheet, landingLink, type GuestScan } from "./guest-scan.tsx";

function GuestRegister({ session }: { session: GuestSession }) {
  const host = usePlayHost();
  const [code, setCode] = useState(codeFromUrl);
  // An invitation's `?claim=` opens its reserved program to this guest: kept
  // for the whole join (the picker and the register both carry it).
  const [claim] = useState(() => (host.ownsPage ? claimFromSearch(window.location.search) : null));
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProgramHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const eventTitle = useLandingBrand().title;
  // The code opens the picker: the story's unclaimed programs, with their
  // pictures, and (when the server has the program directory) a search.
  // Scanned before the director opened the doors: there is nobody to be
  // yet. Say so, and ask again until there is.
  const { ids, busy: serverBusy, refresh } = useIdentities(code, (r) => r.doorsOpen === false, claim);
  const resolved = ids !== null && ids !== "loading" && ids.kind === "ok" ? ids : null;
  const closed = resolved !== null && resolved.doorsOpen === false;
  const fallback = ids !== null && ids !== "loading" && ids.kind === "unavailable" ? ids : null;
  const programs = resolved === null ? [] : orderPicker(resolved.identities);
  // Having picked a program, the guest picks its picture (when there is
  // more than one to choose from).
  const [picking, setPicking] = useState<{ name: string; wiki?: string; options: PictureChoice[]; selected: string | null } | null>(null);
  const go = async (name: string, wiki?: string, picture?: string) => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      await session.register(name, code.trim(), wiki, picture, claim);
    } catch (e) {
      setErr(registerErrorText(e));
      setPicking(null);
      refresh(); // someone may have just taken it — refresh the list
      if (hits !== null) setHits(null);
    } finally {
      setBusy(false);
    }
  };
  const pick = async (name: string, wiki?: string) => {
    if (busy || resolved === null) return;
    setBusy(true);
    setErr("");
    let options: PictureChoice[] = [];
    let as = name;
    try {
      const r = await fetchPictures(resolved.eventId, code.trim(), wiki !== undefined ? { wiki } : { name }, claim);
      options = r.options;
      as = r.name;
    } catch {
      // no options to show (an older server, the directory offline): just join
    } finally {
      setBusy(false);
    }
    if (options.length <= 1) return void go(name, wiki, options[0]?.key);
    setPicking({ name: as, ...(wiki !== undefined ? { wiki } : {}), options, selected: initialPick(options) });
  };
  const search = async () => {
    if (resolved === null || searching) return;
    const query = q.trim();
    if (query === "") return;
    setSearching(true);
    setErr("");
    try {
      setHits(await searchPrograms(resolved.eventId, code.trim(), query));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSearching(false);
    }
  };
  const picture = (key: string | null) => (resolved !== null && key !== null ? avatarUrl(resolved.eventId, key) : null);
  return (
    <div className="hero">
      <div className="glyph">🎟️</div>
      <h1>{resolved?.title ?? fallback?.title ?? eventTitle ?? "Loom"}</h1>
      {session.notice && <p className="notice">{session.notice}</p>}
      <p className="sub">Enter the code from your host, then pick the program you are tonight.</p>
      {claim !== null && <p className="pick-hint">Your invitation saved your program for you — pick it below.</p>}
      <input
        placeholder="Event code (from the host)"
        value={code}
        autoFocus={code === ""}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setCode(e.target.value)}
      />
      {ids === "loading" && <p className="pick-hint">Looking up the program list…</p>}
      {ids !== null && ids !== "loading" && ids.kind === "unknown" && <p className="pick-hint">That code doesn't open anything. Check it with your host.</p>}
      {fallback !== null && (
        <>
          <p className="pick-hint">The code is good, but the server couldn't send the program list — {fallback.error}. It may need a restart. You can still join by name:</p>
          <input placeholder="What do they call you?" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void go(name.trim() || "Guest")} />
          <button className="choice primary" onClick={() => void go(name.trim() || "Guest")} disabled={busy}>
            {busy ? "Joining…" : "Join →"}
          </button>
        </>
      )}
      {serverBusy && (
        <p className="pick-hint" role="status">
          The server is busy — trying again in a moment.
        </p>
      )}
      {closed && (
        <p className="pick-hint" role="status">
          The doors aren't open yet — hang on, this page refreshes by itself.
        </p>
      )}
      {resolved !== null && !closed && picking !== null && (
        <div className="cast-pick" role="group" aria-label={`Your picture as ${picking.name}`}>
          <div className="sheet-h">Your picture as {picking.name}</div>
          <p className="pick-hint">Pick the one that looks most like you.</p>
          <PictureGrid eventId={resolved.eventId} options={picking.options} selected={picking.selected} onSelect={(key) => setPicking({ ...picking, selected: key })} disabled={busy} />
          <button className="choice primary" disabled={busy} onClick={() => void go(picking.name, picking.wiki, picking.selected ?? undefined)}>
            {busy ? "Uploading…" : `Be ${picking.name} →`}
          </button>
          <button className="choice ghost" disabled={busy} onClick={() => setPicking(null)}>
            ← Pick another program
          </button>
        </div>
      )}
      {resolved !== null && !closed && picking === null && (
        <div className="cast-pick" role="group" aria-label="Which program are you?">
          <div className="sheet-h">Which program are you?</div>
          {programs.length === 0 && <p className="pick-hint">{resolved.search ? "Every named program is taken — search for another below." : "No programs left to pick — ask your host."}</p>}
          <div className="pick-grid">
            {programs.map((r) => (
              <button
                key={r.name}
                type="button"
                className={`choice pick ghost ${rowPickable(r) ? "" : "claimed"} ${!r.claimed && r.reserved === true ? "reserved" : ""}`}
                disabled={busy || !rowPickable(r)}
                title={rowTitle(r)}
                onClick={() => void pick(r.name)}
              >
                <PersonAvatar name={r.name} size="lg" src={picture(r.avatar)} />
                <span className="pick-label">
                  {r.name}
                  {rowNote(r) !== null && <span className="pick-sub"> · {rowNote(r)}</span>}
                </span>
              </button>
            ))}
          </div>
          {resolved.search && (
            <>
              <div className="sheet-h">Something else?</div>
              <div className="pick-search">
                <input
                  placeholder="Any software — e.g. NHL 97, Winamp…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void search()}
                  aria-label="Search the program directory"
                />
                <button type="button" className="choice ghost" onClick={() => void search()} disabled={searching || q.trim() === ""}>
                  {searching ? "…" : "Search"}
                </button>
              </div>
              {hits !== null && hits.length === 0 && <p className="pick-hint">Nothing in the directory by that name. Try another spelling.</p>}
              {hits !== null && hits.length > 0 && (
                <div className="pick-results" role="list">
                  {hits.map((h) => (
                    <button
                      key={h.name}
                      type="button"
                      role="listitem"
                      className={`choice pick ghost ${hitPickable(h) ? "" : "claimed"}`}
                      disabled={busy || !hitPickable(h)}
                      onClick={() => void pick(h.name, h.name)}
                    >
                      <PersonAvatar name={h.name} size="lg" src={picture(h.avatar)} />
                      <span className="pick-label">
                        {h.name}
                        <span className="pick-desc">{hitNote(h)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {busy && <p className="pick-hint">Uploading…</p>}
      {err && <div className="err">{err}</div>}
    </div>
  );
}

/** Switch your profile picture to another of your program's — opened on
 *  demand, so the pass sheet never waits on the directory. */
function PictureChanger({ session, eventId }: { session: GuestSession; eventId: string }) {
  const [state, setState] = useState<PictureChoices | "closed" | "loading">("closed");
  const [err, setErr] = useState("");
  const open = async () => {
    setState("loading");
    setErr("");
    try {
      setState(await session.pictures());
    } catch (e) {
      setErr((e as Error).message);
      setState("closed");
    }
  };
  const choose = async (key: string) => {
    if (state === "closed" || state === "loading" || key === state.avatar) return;
    setErr("");
    try {
      setState(await session.setPicture(key));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  if (state === "closed" || state === "loading") {
    return (
      <>
        <button className="choice ghost" disabled={state === "loading"} onClick={() => void open()}>
          {state === "loading" ? "Finding pictures…" : "🖼️ Change your picture"}
        </button>
        {err && <div className="err">{err}</div>}
      </>
    );
  }
  return (
    <>
      <div className="sheet-h">Your picture</div>
      {state.options.length === 0 ? (
        <p className="pick-hint">No other pictures for your program.</p>
      ) : (
        <PictureGrid eventId={eventId} options={state.options} selected={initialPick(state.options, state.avatar)} onSelect={(key) => void choose(key)} />
      )}
      {err && <div className="err">{err}</div>}
    </>
  );
}

/** Out-of-band actions: show your pass, the story's own interactions, switch
 *  sides, or leave. */
function ProfileSheet({ session, push, onClose, onLeave }: { session: GuestSession; push: Push; onClose: () => void; onLeave: () => void }) {
  const faction = session.status?.faction ?? null;
  // One switch-sides button per other public group — driven by the story's
  // declared groups, not a baked-in pair; none while restricted.
  const others = defectTargets(session.status);
  // The story's `who: guest` INTERACTIONs — buttons the story itself declares
  // (an `arm: true` one arms on the first tap and fires on the second).
  const interactions = session.status?.interactions ?? [];
  const arm = useArmButtons();
  return (
    <Sheet title="Your pass" onClose={onClose}>
      {session.me && (
        <div className="pass">
          <PassQr alt="QR" text={session.me.id} />
          <div className="bigid">{session.me.id}</div>
          <div className="muted">Show this to a performer to be scanned.</div>
        </div>
      )}
      {session.me && <PictureChanger session={session} eventId={session.me.eventId} />}
      <WakeLockToggle />
      <PushRow push={push} />
      {interactions.length > 0 && <div className="sheet-h">Things you can do</div>}
      {interactions.map((i) => (
        <button
          key={i.id}
          className={`choice ${arm.armed === i.id ? "armed" : ""}`}
          title={i.description ?? undefined}
          aria-pressed={arm.armed === i.id || undefined}
          onClick={() =>
            arm.tap(i.id, i.arm, () => {
              onClose(); // the reply banners over the app, not behind the sheet
              void session.act(i.id, i.label).catch(() => {});
            })
          }
        >
          {i.label}
          {arm.armed === i.id && <span className="arm-line">{ARM_LINE}</span>}
        </button>
      ))}
      {faction &&
        others.map((other) => (
          <button key={other} className="choice ghost" onClick={() => void session.defect(other)}>
            Leave {withThe(faction)} for {withThe(other)}
          </button>
        ))}
      <button
        className="choice danger"
        onClick={() => {
          push.release();
          session.leave();
          onLeave();
        }}
      >
        Leave the event
      </button>
    </Sheet>
  );
}

/** Just the pass — the QR a performer scans — for when the app is on rails
 *  and the rest of the menu is out of reach. */
function PassSheet({ me, onClose }: { me: { id: string; name: string }; onClose: () => void }) {
  return (
    <Sheet title="🎟️ Your pass" onClose={onClose}>
      <div className="pass">
        <PassQr alt="QR" text={me.id} />
        <div className="bigid">{me.id}</div>
        <div className="muted">{me.name} · show this to a performer to be scanned.</div>
      </div>
    </Sheet>
  );
}

/** One directory row: a name, a kind, where they are, and what you know of them. */
function PersonRow({ card, onMessage }: { card: PersonCard; onMessage: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="people-row">
      <div className="people-top">
        <PersonAvatar name={card.name} size="sm" kind={card.kind} />
        {/* The name gets the whole line; its tags sit under it, so a phone
            never squeezes "Password Manager" down to "Pass…". */}
        <div className="people-id">
          <span className="name">{card.name}</span>
          <span className="people-tags">
            {card.faction && <GroupPill group={card.faction} />}
            {card.location && <span className="people-where">📍 {card.location}</span>}
          </span>
        </div>
        <button className="choice ghost" onClick={onMessage} aria-label={`Message ${card.name}`}>
          💬
        </button>
      </div>
      {card.known.length > 0 && (
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
      {people.length > 0 && <div className="people-unknown">What your Codex holds about someone shows under their name. Tap 💬 to message them.</div>}
      {/* The other programs first — they are who a guest is looking for. */}
      {guests.length > 0 && <div className="codex-about">Guests</div>}
      {guests.map((p) => (
        <PersonRow key={p.id} card={p} onMessage={() => open(p)} />
      ))}
      {cast.length > 0 && <div className="codex-about">Characters</div>}
      {cast.map((p) => (
        <PersonRow key={p.id} card={p} onMessage={() => open(p)} />
      ))}
    </Sheet>
  );
}

/** The identity card at the top of the sidebar: who you are, where you are. */
function IdentityCard({ s, onPeople, onHelp, onProfile, onWallet, onScan }: { s: GuestSession; onPeople: () => void; onHelp: () => void; onProfile: () => void; onWallet: () => void; onScan: () => void }) {
  const st = s.status;
  const captured = st?.captured ?? false;
  const restricted = st?.restricted ?? false;
  const where = captured ? "🔒 captured" : restricted ? "⛔ restricted" : st?.location ? `📍 ${st.location}` : "📍 nowhere yet";
  return (
    <header className={`inbox-head ${captured ? "trapped" : ""} ${restricted ? "restricted" : ""}`}>
      <div className="me" data-tour="me">
        <PersonAvatar name={s.me?.name ?? "?"} />
        <div className="me-body">
          <div className="who">
            <strong>{s.me?.name}</strong> <GroupPill group={st?.faction ?? null} />
          </div>
          <div className="me-sub">
            <span>{where}</span>
            {st?.wallet ? <BalancePill view={st.wallet} onOpen={onWallet} /> : <span>⭐ {st?.score ?? 0}</span>}
            <ConnDot connected={s.connected} label={connLabel(s.connected)} />
          </div>
        </div>
      </div>
      <div className="hud">
        <button className="icon-btn" title="Scan a code on the wall" aria-label="Scan a code" onClick={onScan}>
          📷
        </button>
        <button className="icon-btn" title="People" onClick={onPeople} data-tour="people">
          👥
        </button>
        <button className="icon-btn" title="Help" onClick={onHelp} data-tour="help">
          ?
        </button>
        <button className="icon-btn" title="Your pass & settings" onClick={onProfile} data-tour="pass">
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

/**
 * Is the app on rails? While the story has the guest in a `cutscene`
 * location, yes. When the story moves them on, the stage stays until they
 * press Continue (so the last lines aren't cut off mid-crawl) — unless the
 * page was opened fresh, in which case there is nothing to finish.
 */
export function useCutscene(inCutscene: boolean): { showing: boolean; over: boolean; leave: () => void } {
  const seen = useRef(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (inCutscene) {
      seen.current = true;
      setDone(false);
    }
  }, [inCutscene]);
  const showing = inCutscene || (seen.current && !done);
  return { showing, over: showing && !inCutscene, leave: () => setDone(true) };
}

export function GuestApp({ onLeave }: { onLeave: () => void }) {
  const host = usePlayHost();
  const s = useGuestSession();
  const wide = useWide();
  const [profile, setProfile] = useState(false);
  const [sharing, setSharing] = useState<{ entry: string; title: string } | null>(null);
  const [people, setPeople] = useState<ReadonlySet<string> | "all" | null>(null);
  const [help, setHelp] = useState(false);
  const [inviting, setInviting] = useState(false);
  // K-11: the Codex box says so when the redeem throttle answers 429.
  const [codexNote, setCodexNote] = useState<string | null>(null);
  // The Wallet room's sheets: Send / Request / Trade a fact / Stimulus.
  const [walletSheet, setWalletSheet] = useState<WalletSheet | null>(null);
  // 📷 Scan: a wall code read in this session (never a new tab).
  const [scanning, setScanning] = useState(false);
  // A codex / check-in link opened with no session here: the landing says
  // to type it in the app the guest joined with, unless they pick Join.
  const [landing] = useState(() => (host.ownsPage ? landingLink(window.location.search) : null));
  const [joinAnyway, setJoinAnyway] = useState(false);
  const landingTitle = useLandingBrand().title;
  const rootRef = useRef<HTMLDivElement>(null);
  useDocumentTitle(s.me?.title);
  // K-31a: `!` alerts + a character's DMs on a locked phone.
  const push = usePush(s.me ? { base: `/e/${encodeURIComponent(s.me.eventId)}`, token: s.me.token } : null);
  const t = s.threads;
  const st = s.status;
  // Everyone's profile pictures (a program's Wikipedia image, an authored
  // `avatar:`), for every tile in the app.
  const avatars = useMemo(() => avatarLookup(s.me?.eventId ?? null, st?.avatars), [s.me?.eventId, st?.avatars]);
  // The wallet's countdowns tick between snapshots (a freeze's thaw, a held
  // transfer's auto-approve), off the snapshot clock + the wall time since.
  const walletClock = useWalletClock(st?.clock, st?.wallet);
  const cut = useCutscene(st?.cutscene === true);
  const offline = useOfflineFor(s.connected);
  // The story's guided tour, once dealt and until answered — never over a
  // cutscene (it waits for the guest to step into the app).
  const tour = !cut.showing && s.me !== null ? pendingWidget(s.messages, "tutorial", new Set(s.widgetAnswers.keys())) : null;
  const tourSeq = tour?.seq ?? null;
  // On a wide screen the stage is never blank: open the natural room.
  const signedIn = s.me !== null && s.ready;
  const activeId = t.activeId;
  const home = homeChannel(t.list);
  useEffect(() => {
    if (opensHome(signedIn, wide, activeId, home, s.roomLinkPending) && home !== null) t.open(home);
    // `t` is rebuilt each render; the ids are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, wide, activeId, home, s.roomLinkPending]);
  // What the cutscene stage shows is read: stepping into the app, the
  // rooms it came from (The Uploader's thread) carry no backlog badges.
  const staged = cut.showing && s.me !== null ? personalStream(s.messages, s.me.id) : null;
  const stagedMax = staged !== null && staged.length > 0 ? staged[staged.length - 1]!.seq : -1;
  useEffect(() => {
    if (staged !== null && stagedMax >= 0) t.markRead(staged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedMax]);
  // The tour walks the sidebar: on a phone, come back to it first.
  useEffect(() => {
    if (tourSeq !== null && !wide && activeId !== null) t.back();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourSeq, wide]);
  if (!s.me) {
    if (host.embedded) return <SessionEnded notice={s.notice} />;
    // Only while the link is still in the address bar: once it redeemed
    // (and was stripped), leaving the event lands on the join screen.
    if (landing !== null && !joinAnyway && landingLink(window.location.search) !== null) return <LinkLanding link={landing} title={landingTitle} onJoin={() => setJoinAnyway(true)} onPerformer={onLeave} />;
    return <GuestRegister session={s} />;
  }

  const captured = st?.captured ?? false;
  const banner = s.alert ? <AlertBanner text={s.alert.text} onDismiss={s.dismissAlert} /> : null;
  // The sticky notices still up for this guest (their own feed + DM
  // threads) — rendered above everything, outside the greyed containers.
  const pins = activePins(t.list.flatMap((c) => c.messages));
  // A `!!` pin covers the whole app — from every received message, so a
  // restricted guest whose list hides the lobby still sees it.
  const takeover = <Takeover pin={activeTakeover(s.messages.values())} />;
  const restricted = st?.restricted ?? false;
  // The story's guest-facing clocks (`countdown: … for guests`), ticking
  // under the room header — and under the identity card on a phone's room
  // list, so the clock is never one tap away.
  const clocks = <CountdownStrip countdowns={st?.countdowns} clock={st?.clock} paused={st?.paused === true} stamp={st} />;
  // A scanned codex code redeems like a typed one (the Codex room answers a
  // wrong code itself); a room's sign checks in and opens that room.
  const onScanned = async (scan: Exclude<GuestScan, { kind: "note" }>): Promise<string | null> => {
    if (scan.kind === "checkin") {
      await s.checkin(scan.at);
      return null;
    }
    t.open(CODEX_ROOM);
    try {
      await s.redeem(scan.code);
      setCodexNote(null);
    } catch (e) {
      setCodexNote(redeemErrorText(e));
    }
    return null;
  };
  const scanButton = (
    <button type="button" className="choice composer-scan" title="Scan a code on the wall" aria-label="Scan a code" onClick={() => setScanning(true)}>
      📷
    </button>
  );
  const widgets = {
    answer: (seq: number, r: Parameters<GuestSession["answerWidget"]>[1]) => void s.answerWidget(seq, r).catch(() => {}),
    answered: s.widgetAnswers,
    viewer: { id: s.me.id, name: s.me.name },
  };

  // Until the first snapshot + backlog land, say so rather than flash an
  // empty shell (a new guest's first sight may be a cutscene).
  if (!s.ready || st === null) {
    return (
      <div className="root">
        <div className="hero">
          <div className="glyph">📡</div>
          <p className="sub">Connecting…</p>
        </div>
      </div>
    );
  }

  if (cut.showing) {
    const dock = t.list.find((c) => c.decision !== null)?.decision ?? null;
    const where = st.location !== null ? (t.list.find((c) => c.id === `loc:${st.location}`)?.title ?? st.location) : null;
    return (
      <div className="root cut-root">
        <CutsceneStage
          messages={staged ?? []}
          title={st.title ?? s.me.title}
          where={cut.over ? null : where}
          decision={dock}
          widgets={widgets}
          over={cut.over}
          onContinue={cut.leave}
          onPass={() => setProfile(true)}
          alert={s.alert}
          onDismissAlert={s.dismissAlert}
          offline={offline}
        />
        {profile && <PassSheet me={{ id: s.me.id, name: s.me.name }} onClose={() => setProfile(false)} />}
        {takeover}
      </div>
    );
  }

  let stage: ReactElement | null = null;
  if (t.active) {
    const active = t.active;
    if (t.activeThreadRoot !== null) {
      stage = (
        <MessageThread
          channel={active}
          rootSeq={t.activeThreadRoot}
          onClose={t.closeThread}
          onSend={(text, parentSeq) => s.say(active.id, text, parentSeq)}
        />
      );
    } else {
      // A membership-gated room the guest belongs to can invite + leave.
      const gated = active.kind === "private" || active.kind === "group" || active.kind === "dm";
      // The Codex's composer takes codes; the Quest Log and the Wallet take
      // nothing (their cards open their threads). Everywhere else, you talk.
      const send =
        active.kind === "codex"
          ? (text: string) =>
              void s.redeem(text).then(
                () => setCodexNote(null),
                (e: unknown) => setCodexNote(redeemErrorText(e)),
              )
          : active.kind === "quests" || active.kind === "wallet"
            ? undefined
            : (text: string) => s.say(active.id, text);
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
          onSend={send}
          widgets={widgets}
          onPeople={() => setPeople(new Set((active.people ?? []).map((p) => p.id)))}
          strip={clocks}
          composerExtra={active.kind === "codex" ? scanButton : undefined}
          footer={
            active.kind === "codex" && codexNote !== null ? (
              <p className="notice" role="status">
                {codexNote}
              </p>
            ) : active.kind === "wallet" && st.wallet ? (
              <WalletFooter view={st.wallet} open={setWalletSheet} restricted={restricted} clock={walletClock} />
            ) : roomActions.length > 0 ? (
              <ActionRow actions={roomActions} />
            ) : undefined
          }
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
      header={
        <>
          <IdentityCard s={s} onPeople={() => setPeople("all")} onHelp={() => setHelp(true)} onProfile={() => setProfile(true)} onWallet={() => t.open(WALLET_ROOM)} onScan={() => setScanning(true)} />
          {!wide && clocks}
        </>
      }
      empty="Quiet… for now."
    />
  );

  const tourSteps = tour
    ? tutorialSteps({
        title: st.title ?? s.me.title ?? "the story",
        hasCodex: (st.codexTotal ?? 0) > 0,
        hasQuests: (st.questTotal ?? 0) > 0,
        hasWallet: st.wallet !== undefined,
        hasPeople: (st.people?.length ?? 0) > 0,
        hasActions: (st.interactions?.length ?? 0) > 0,
        bathroom: tour.widget?.params["bathroom"] ?? null,
      })
    : [];

  // The other guests, for the wallet's pickers (never me, never a character).
  const meId = s.me.id;
  const walletPeople = (st.people ?? []).filter((p) => p.kind === "guest" && p.id !== meId).map((p) => ({ id: p.id, name: p.name }));
  return (
    <AvatarsContext.Provider value={avatars}>
    <CardActionsProvider value={{ shareCodex: (entry, title) => setSharing({ entry, title }) }}>
    <WalletActionsProvider value={guestWalletActions(st.wallet ?? null, s.me.id, walletClock, restricted, s.wallet)}>
    <div className={`root ${captured ? "trapped-bg" : ""} ${restricted ? "restricted-bg" : ""}`} ref={rootRef}>
      {banner}
      <PinnedRail pins={pins} />
      <PushCard push={push} title={st.title ?? s.me.title} why="the house can reach you when your phone is locked: alarms, and messages from the characters." />
      <Shell side={side} stage={stage} wide={wide} placeholder="Pick a room on the left. The one you're standing in is at the top." />
      {tour && (
        <Tutorial
          steps={tourSteps}
          root={rootRef}
          guide={tour.widget?.params["guide"] ?? null}
          onFinish={() => widgets.answer(tour.seq, tourResult(tourSteps, null))}
          onSkip={(step) => widgets.answer(tour.seq, tourResult(tourSteps, step))}
        />
      )}
      {inviting && t.active && (
        <InviteSheet
          title={`Invite to ${t.active.title}`}
          people={st?.roster ?? []}
          onPick={(id) => void s.inviteToChannel(id, t.active!.id)}
          onClose={() => setInviting(false)}
        />
      )}
      {profile && <ProfileSheet session={s} push={push} onClose={() => setProfile(false)} onLeave={onLeave} />}
      {sharing && (
        <PickerSheet
          title={`Share “${sharing.title}” with…`}
          items={(st.people ?? []).map((p) => ({ id: p.id, label: p.name, sub: p.kind === "character" ? "character" : (p.faction ?? "guest"), avatar: true }))}
          onPick={(id) => void s.shareCodex(sharing.entry, id)}
          onClose={() => setSharing(null)}
          empty="Nobody else is here yet."
        />
      )}
      {people !== null && <PeopleSheet session={s} only={people === "all" ? undefined : people} onClose={() => setPeople(null)} />}
      {help && <HelpSheet role="guest" onClose={() => setHelp(false)} />}
      {scanning && <ScanSheet meId={s.me.id} onScan={onScanned} onClose={() => setScanning(false)} />}
      {st.wallet && (walletSheet === "send" || walletSheet === "request" || walletSheet === "grant") && (
        <PeopleAmountSheet
          mode={walletSheet}
          view={st.wallet}
          people={walletPeople}
          onDone={(id, n) => void (walletSheet === "send" ? s.wallet.send(id, n) : walletSheet === "grant" ? s.wallet.grant(id, n) : s.wallet.request(id, n))}
          onClose={() => setWalletSheet(null)}
        />
      )}
      {st.wallet && walletSheet === "offer" && (
        <OfferSheet
          view={st.wallet}
          people={walletPeople}
          codex={(st.codex ?? []).map((e) => ({ id: e.id, title: e.title }))}
          onDone={(to, entry, side, n) => void s.wallet.offer(to, entry, side, n)}
          onClose={() => setWalletSheet(null)}
          frozen={frozenUntil(st.wallet, walletClock) !== null}
        />
      )}
      {st.wallet && walletSheet === "stimulus" && <StimulusSheet view={st.wallet} onDone={(n) => void s.wallet.stimulus(n)} onClose={() => setWalletSheet(null)} />}
      {st.wallet && walletSheet === "freeze" && (
        <FreezeSheet view={st.wallet} people={walletPeople} clock={walletClock} onDone={(id) => void s.wallet.freeze(id)} onClose={() => setWalletSheet(null)} />
      )}
      {takeover}
    </div>
    </WalletActionsProvider>
    </CardActionsProvider>
    </AvatarsContext.Provider>
  );
}
