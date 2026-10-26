//! The guest (participant) app (moved out of `guest.tsx` in wave 13; the
//! wave 18 frame): the NOW title bar (your picture → Me, the 🔔 →
//! Notifications), one window at a time — Mission (home), Chats, the
//! Notifications bin — or a room opened over it, and the taskbar (Start ·
//! Mission · Chats · Pass · Scan). Every exit lands through `go(nav)`
//! (`guest/nav.ts`); the lobby is the far-away 📜 Chat log, never a default
//! room and never an exit.

import { useSystemBack } from "../back-gesture.ts";
import { badgeLinkText, type BadgeLink } from "../rejoin.ts";
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { ActionRow, InviteSheet, PickerSheet, SessionEnded, Sheet, useWide } from "../ui/primitives.tsx";
import { MomentsAndPins } from "../moments/pins-rail.tsx";
import { Shell } from "../rooms/list.tsx";
import { CardActionsProvider } from "../stream/bubble.tsx";
import { ChannelView, MessageThread } from "../stream/channel-view.tsx";
import { codexUnseen } from "../stream/codex-seen.ts";
import { CutsceneStage } from "../cutscene.tsx";
import { useOfflineFor } from "../client.ts";
import { LazyHelpSheet as HelpSheet } from "../help-lazy.tsx";
import { usePlayHost } from "../host.ts";
import { AvatarsContext, avatarLookup } from "../avatars.ts";
import { KnownNamesProvider, knownNames } from "../rooms/names.ts";
import { useDocumentTitle, useLandingBrand } from "../session/shared.ts";
import { pendingWidget, personalStream } from "../session/channels.ts";
import { useGuestSession, type GuestSession } from "../session/guest.ts";
import { Tutorial, tourResult, tutorialSteps } from "../tutorial.tsx";
import { CODEX_ROOM } from "../rooms/spaces.ts";
import { chatSections, chatsDot, crewRoomGone } from "../rooms/chats.ts";
import { WalletActionsProvider, WalletFooter, frozenUntil, guestWalletActions, useWalletClock, type WalletSheet } from "../wallet.tsx";
import { LazyFreezeSheet as FreezeSheet, LazyOfferSheet as OfferSheet, LazyPeopleAmountSheet as PeopleAmountSheet, LazyStimulusSheet as StimulusSheet } from "../wallet-sheets-lazy.tsx";
import type { Action, Interaction } from "../types.ts";
import { usePush } from "../push.ts";
import { redeemErrorText, shareTargets } from "../codex.ts";
import { activePins, activeTakeover } from "../pins.ts";
import { Takeover } from "../takeover.tsx";
import { LinkLanding, landingLink } from "../guest-scan.tsx";
import type { GuestScan } from "../guest-scan-sheet.tsx";
import { LazyScanSheet as ScanSheet } from "../guest-scan-sheet-lazy.tsx";
import { LazyScanDone, loadScanDone, settled } from "../scan-done-lazy.tsx";
import { BellButton, MomentsLayer, MomentsProvider, type MomentsInput } from "../moments/provider.tsx";
import { GuestRegister, PictureChanger } from "./register.tsx";
import { FullPass } from "../chrome/pass.tsx";
import { PeopleSheet } from "./sheets.tsx";
import { CountdownTray } from "../chrome/countdown-tray.tsx";
import { ShowClockTray } from "../chrome/show-clock-tray.tsx";
import { showClockOf } from "../show-clock.ts";
import { useKeyboardOpen } from "../chrome/keyboard.ts";
import { Taskbar, TrayItem } from "../chrome/taskbar.tsx";
import { Icon, IconTitle } from "../chrome/icons.tsx";
import { actLine, missionLine, titleFallback } from "../chrome/title-bar.tsx";
import { useArmButtons } from "../arm.ts";
import { AlertsBalloon, AlertsSheet, BalanceTray, GuestStartHeader, MeButton, NowBar, guestStartItems, guestTaskbarButtons, liveCardsOf, objectiveButton, pushOffered, startSidesOf, useStartWake, whereLine } from "./frame.tsx";
import { lobbyNav, type ExitContext, type Nav } from "../moments/exits.ts";
import { pressedWindow, questRootsOf, useGuestNav, type GuestWindow } from "./nav.ts";
import { LazyMission } from "./mission-lazy.tsx";
import { ChatsWindow } from "./chats.tsx";
import { LazyMeSheet as MeSheet } from "./me-lazy.tsx";
import { LazyNotificationsWindow } from "./notifications-lazy.tsx";
import { LazyLockScreen } from "./lock-lazy.tsx";
import { rowClockOf } from "./show-time.ts";
import { prefetchQr } from "../pass-qr.tsx";
import { prefetchFactCard } from "../widgets.tsx";
import { badgesOf, canFoundOf, extOf, lobbyHidden } from "./wire.ts";
import { factionNameOf } from "../sides/mode.ts";
import { SidesContext } from "../sides/context.ts";
import { LazySidesLayer } from "../sides/lazy.tsx";
import type { SidesWhich } from "../sides/index.tsx";
import { registerSidesWidgets } from "../sides/widgets.tsx";

// The doors (`sides`) and the invitation (`invite`) card kinds (CONTRACTS A8).
registerSidesWidgets();
// Mission is the home after sign-in: fetched now, while the join screen
// (or the stream) loads.
LazyMission.prefetch();
// The pass's QR encoder: its own chunk, fetched just after the first paint
// (the pass is one tap away; the arrival's `show pass` card follows soon).
if (typeof window !== "undefined") window.setTimeout(prefetchQr, 1200);
// Wave 26: the 📷 Scan sheet's chunk, just after.
if (typeof window !== "undefined") window.setTimeout(ScanSheet.prefetch, 1600);
// The 📝 fact card's chunk (wave 18b), a little later: it is dealt in the hunts.
if (typeof window !== "undefined") window.setTimeout(prefetchFactCard, 2500);
// Wave 26 (R1): the locked phone's screen, so a capture finds it there.
if (typeof window !== "undefined") window.setTimeout(LazyLockScreen.prefetch, 4000);

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

/**
 * "Take me there" to a room, for the moments layer: none while the story
 * keeps the guest on rails in a cutscene (the room would only change behind
 * the stage, and the moment would close as done); once the story has moved
 * them on (Continue is up) it steps into the app and opens the room.
 */
export function roomExit(cut: { showing: boolean; over: boolean; leave: () => void }, open: (id: string) => void): ((id: string) => void) | undefined {
  if (!cut.showing) return open;
  if (!cut.over) return undefined;
  return (id) => {
    cut.leave();
    open(id);
  };
}

/**
 * The guest frame's root: `.root.app-frame`, the flex column
 * `[title bar][pins][shell][taskbar]`. It owns the keyboard rule — while a
 * text field inside it has focus the taskbar steps aside, so a guest typing
 * to Trabolta keeps the stream — and mounts with the element it measures.
 */
function FrameRoot({ className, frameRef, head, taskbar, children }: { className: string; frameRef: RefObject<HTMLDivElement | null>; head: ReactNode; taskbar: ReactNode; children?: ReactNode }) {
  const typing = useKeyboardOpen(frameRef);
  return (
    <FrameLayout className={className} frameRef={frameRef} head={head} taskbar={taskbar} typing={typing}>
      {children}
    </FrameLayout>
  );
}

/** The frame's layout with the keyboard rule applied (`test/taskbar.test.tsx`):
 *  the head, then the taskbar unless the keyboard is open, then overlays. */
export function FrameLayout({ className, frameRef, head, taskbar, typing, children }: { className: string; frameRef?: RefObject<HTMLDivElement | null>; head: ReactNode; taskbar: ReactNode; typing: boolean; children?: ReactNode }) {
  return (
    <div className={`${className}${typing ? " kbd" : ""}`} ref={frameRef as RefObject<HTMLDivElement> | undefined}>
      {head}
      {!typing && taskbar}
      {children}
    </div>
  );
}


export function GuestApp({ onLeave, badgeLink = null }: { onLeave: () => void; badgeLink?: string | null }) {
  const host = usePlayHost();
  const s = useGuestSession();
  const wide = useWide();
  const [sharing, setSharing] = useState<{ entry: string; title: string } | null>(null);
  const [people, setPeople] = useState<ReadonlySet<string> | "all" | null>(null);
  const [help, setHelp] = useState(false);
  const [inviting, setInviting] = useState(false);
  // K-11: the Codex box says so when the redeem throttle answers 429.
  const [codexNote, setCodexNote] = useState<string | null>(null);
  // The Wallet room's sheets: Send / Request / Trade a fact / Stimulus.
  const [walletSheet, setWalletSheet] = useState<WalletSheet | null>(null);
  // The Me sheet's own sheets.
  const [picturing, setPicturing] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  // Sides & crews: which of its sheets is up (the lazy chunk).
  const [sidesWhich, setSidesWhich] = useState<SidesWhich | null>(null);
  // Wave 23: a printed badge, opened here or scanned in the app — yours
  // links to you (and says so); someone else's is their pass.
  const onBadge = async (badge: string): Promise<BadgeLink> => {
    const r = await s.linkBadge(badge);
    if (r.kind === "theirs") setSidesWhich({ sheet: "recruit", id: r.id });
    else if (r.kind !== "unknown") s.alerts.raise(badgeLinkText(r) ?? "", { quiet: true });
    return r;
  };
  const [badgeWant, setBadgeWant] = useState(badgeLink);
  useEffect(() => {
    if (badgeWant === null || !s.ready) return;
    setBadgeWant(null);
    void onBadge(badgeWant)
      .then((r) => {
        if (r.kind === "unknown") s.alerts.raise(badgeLinkText(r) ?? "", { quiet: true });
      })
      .catch(() => {});
    // `onBadge` is rebuilt each render; the link is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badgeWant, s.ready]);
  const wake = useStartWake();
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
  // The names as the story and the guests spell them (ICQ, VLC): a speaker
  // matching one is never recased by prettyName.
  const names = useMemo(
    () => knownNames([s.me?.name], (st?.people ?? []).map((p) => p.name), (st?.roster ?? []).map((p) => p.name), st?.voiced),
    [s.me?.name, st?.people, st?.roster, st?.voiced],
  );
  // The wallet's countdowns tick between snapshots (a freeze's thaw, a held
  // transfer's auto-approve), off the snapshot clock + the wall time since.
  const walletClock = useWalletClock(st?.clock, st?.wallet);
  const cut = useCutscene(st?.cutscene === true);
  // The arrival room's name stays in the stage's caption until Continue
  // (the story has moved the guest on, but they are still reading it).
  const stageWhere = useRef<string | null>(null);
  const offline = useOfflineFor(s.connected);
  // The story's guided tour, once dealt and until answered — never over a
  // cutscene (it waits for the guest to step into the app).
  const tour = !cut.showing && s.me !== null ? pendingWidget(s.messages, "tutorial", new Set(s.widgetAnswers.keys())) : null;
  const tourSeq = tour?.seq ?? null;
  const signedIn = s.me !== null && s.ready && !cut.showing;

  // --- the window, the room over it, and every exit's `go` ----------------
  const cards = useMemo(() => liveCardsOf(t.list, s.widgetAnswers), [t.list, s.widgetAnswers]);
  const listed = useMemo(() => new Set(t.list.map((c) => c.id)), [t.list]);
  const interactions = st?.interactions ?? [];
  const liveActions = new Set(interactions.filter((i) => i.live !== false).map((i) => i.id));
  // Wave 18b (R12, D18): `lobby: hidden` — no Chat log row; a link to the
  // lobby lands on Notifications, which carries its lines.
  const noLobby = lobbyHidden(st);
  const nav = useGuestNav(
    t,
    () => ({ listed, actions: liveActions, armed: new Set(interactions.filter((i) => i.arm === true).map((i) => i.id)), questRoots: questRootsOf(s.messages.values()), lobbyHidden: noLobby }),
    (id) => {
      const i = interactions.find((x) => x.id === id);
      void s.act(id, i?.label).catch(() => {});
    },
  );
  const ext = extOf(st);
  const exitContext = (window: GuestWindow = nav.window): ExitContext => ({
    listed,
    titles: new Map(t.list.map((c) => [c.id, c.title])),
    open: t.activeThreadRoot === null ? t.activeId : null,
    window,
    cards,
    dms: t.list.filter((c) => c.kind === "dm").map((c) => ({ id: c.id, title: c.title, last: c.messages[c.messages.length - 1]?.seq ?? -1 })),
    actions: liveActions,
    sides: (ext.sides ?? []).length > 0 || canFoundOf(st),
    sideChosen: (ext.sides ?? []).some((x) => x.mine),
    actionLabels: new Map(interactions.map((i) => [i.id, i.label])),
    lobbyHidden: noLobby,
  });
  const arm = useArmButtons();
  const archived = ext.archived;
  const chats = useMemo(
    () => chatSections(t.list, { now: st?.clock ?? 0, cardRooms: new Set(cards.map((c) => c.channel)), ...(archived !== undefined ? { archived: new Set(archived) } : {}), lobbyHidden: noLobby }),
    [t.list, st?.clock, cards, archived, noLobby],
  );
  // Mission's "!" on the taskbar: the NOW objective changed since Mission
  // was last on screen.
  const nowId = st?.objectives?.[0]?.id ?? null;
  const [seenNow, setSeenNow] = useState<string | null>(null);
  const onMission = nav.window === "mission" && t.activeId === null;
  useEffect(() => {
    if (onMission && nowId !== seenNow) setSeenNow(nowId);
  }, [onMission, nowId, seenNow]);
  // The phone's own Back steps back inside the app (NM-F9), when it owns the page.
  useSystemBack(host.ownsPage && signedIn, nav.overlay !== null || t.activeId !== null || nav.window !== "mission", () => {
    if (nav.overlay !== null) nav.setOverlay(null);
    else if (t.activeId !== null) nav.back();
    else nav.go({ to: "mission" });
  });
  // A crew room that left the view (dissolved, or the guest left it) while
  // open: back to Chats with a word, never a dead room titled with its raw
  // id (A3).
  const openRoom = t.activeId;
  const crewGone = openRoom !== null && crewRoomGone(openRoom, st?.channels);
  useEffect(() => {
    if (!crewGone) return;
    nav.go({ to: "chats" });
    s.alerts.raise("That crew was dissolved. Its room is closed.", { quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crewGone]);
  // A notification's link (SW-PLAY-20, §6.4) once in the app — never under the cutscene.
  useEffect(() => {
    if (s.linkNav === null || !signedIn) return;
    nav.go(s.linkNav);
    s.takeLinkNav();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.linkNav, signedIn]);
  // What the cutscene stage shows is read: stepping into the app, the
  // rooms it came from (The Uploader's thread) carry no backlog badges.
  const staged = cut.showing && s.me !== null ? personalStream(s.messages, s.me.id) : null;
  const stagedMax = staged !== null && staged.length > 0 ? staged[staged.length - 1]!.seq : -1;
  useEffect(() => {
    if (staged !== null && stagedMax >= 0) t.markRead(staged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedMax]);
  // A scan done (R1): land where it went — the Codex on its entry, the room
  // checked into (opened even before the snapshot lists it: a hidden place
  // appears once stood in) — then the dialog says so on top. Never under
  // the cutscene: it waits for the guest to step into the app.
  const scanDoneId = signedIn ? (s.scanDone?.id ?? null) : null;
  useEffect(() => {
    const d = s.scanDone;
    if (scanDoneId === null || d === null) return;
    if (d.go.to === "codex") nav.go({ to: "codex", entry: d.go.entry });
    else nav.openRoom(d.go.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanDoneId]);
  // The 📷 sheet open: fetch the scan-done chunk its answer needs.
  useEffect(() => {
    if (nav.overlay === "scan") LazyScanDone.prefetch();
  }, [nav.overlay]);
  // The tour starts on Mission with no room open (§10).
  useEffect(() => {
    if (tourSeq !== null) nav.go({ to: "mission" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourSeq]);
  if (!s.me) {
    if (host.embedded) return <SessionEnded notice={s.notice} />;
    // Only while the link is still in the address bar: once it redeemed
    // (and was stripped), leaving the event lands on the join screen.
    if (landing !== null && !joinAnyway && landingLink(window.location.search) !== null) return <LinkLanding link={landing} title={landingTitle} notice={s.notice} onJoin={() => setJoinAnyway(true)} onPerformer={onLeave} />;
    return <GuestRegister session={s} />;
  }

  const captured = st?.captured ?? false;
  // The sticky notices still up for this guest (their own feed + DM
  // threads) — rendered above everything, outside the greyed containers.
  const pins = activePins(t.list.flatMap((c) => c.messages));
  // A `!!` pin covers the whole app — from every received message, so a
  // restricted guest whose list hides the lobby still sees it.
  const takeover = <Takeover pin={activeTakeover(s.messages.values())} />;
  const restricted = st?.restricted ?? false;
  // A scanned codex code redeems like a typed one, a room's sign checks in,
  // someone else's pass opens the Recruit sheet (wave 18, F3). Wave 18b
  // (R1): a hit, a code already held or a check-in closes the sheet and the
  // "scan done" dialog lands on the entry / the room; a miss or a refusal
  // keeps the sheet open with the reason (the camera keeps reading).
  const onScanned = async (scan: Exclude<GuestScan, { kind: "note" }>): Promise<string | null> => {
    if (scan.kind === "pass") {
      setSidesWhich({ sheet: "recruit", id: scan.id });
      return null;
    }
    if (scan.kind === "badge") {
      try {
        const r = await onBadge(scan.badge);
        return r.kind === "unknown" ? badgeLinkText(r) : null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't link that badge — try again.";
      }
    }
    // The dialog's chunk loads beside the request (the sheet prefetched it).
    let o;
    if (scan.kind === "checkin") {
      const [m, a] = await Promise.all([loadScanDone(), settled(s.checkin(scan.at))]);
      if ("e" in a) return m.scanErrorNote(a.e, "checkin");
      o = m.checkinOutcome(a.r);
    } else {
      const [m, a] = await Promise.all([loadScanDone(), settled(s.redeem(scan.code))]);
      if ("e" in a) return m.scanErrorNote(a.e, "unlock");
      setCodexNote(null);
      o = m.redeemOutcome(a.r);
    }
    if ("note" in o) return o.note;
    s.showScan(o.done);
    return null;
  };
  const scanButton = (
    <button type="button" className="choice composer-scan" title="Scan a code on the wall" aria-label="Scan a code" onClick={() => nav.go({ to: "scan" })}>
      <Icon name="scan" size={20} />
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

  // Continue on the arrival cutscene lands on Mission, no room open (§1.3).
  const leaveCutscene = () => {
    cut.leave();
    nav.go({ to: "mission" });
  };
  // Every exit's `go`: none while on rails in the cutscene; once the story
  // has moved them on (Continue is up) it steps into the app first.
  const go: ((n: Nav) => void) | undefined = !cut.showing
    ? // A Notifications row's exit lands as if taken from Mission: a room
      // opened from the bin returns to Mission on ‹.
      (n: Nav) => nav.go(n, nav.window === "notifications" ? "mission" : undefined)
    : cut.over
      ? (n: Nav) => {
          cut.leave();
          nav.go(n);
        }
      : undefined;
  // A room the old moments engine names: the lobby is never one (G2).
  const openRoomExit = (id: string) => (id === "lobby" ? nav.go(lobbyNav(noLobby)) : nav.go({ to: "room", id }));
  // The moments layer (wave 13): one provider over both the cutscene and the
  // main frame, so the queue, its holds and the beat's blue screen carry
  // across the cutscene → app switch. Wave 18: the moments lane's exits land
  // through `go` (`exitContext` says what the guest lists).
  const moments: MomentsInput = {
    role: "guest",
    me: s.me.id,
    session: s.me.token,
    messages: s.messages,
    alerts: s.alerts,
    alertLevel: st.alertLevel,
    objectives: st.objectives,
    phase: st.night?.phase,
    clock: st.clock,
    // No room exit while on rails in the cutscene.
    openRoom: roomExit(cut, openRoomExit),
    sound: host.sound,
    // The room the guest stands in: its beat lines reach the blue screen.
    here: st.location !== null ? `loc:${st.location}` : null,
    openPass: () => nav.go({ to: "pass" }),
    // A loud objective flashes the NOW bar (below the modal rungs) — not on
    // the cutscene's stage, which has no NOW bar: there it is the banner.
    nowBar: !cut.showing,
    ...(go !== undefined ? { go } : {}),
    exitContext: () => exitContext(),
    // The big rung renders a card inside itself through the same answer path.
    widgets,
    openNotifications: () => nav.go({ to: "notifications" }),
    name: s.me.name,
    sideChosen: (ext.sides ?? []).some((x) => x.mine),
    captured: st.captured,
    lobbyHidden: noLobby,
    // Wave 26 (T2): the story's glitch takes the phone over (locked or not).
    glitch: st.night?.glitch,
    takeover: "full",
  };
  // Both branches below return through `framed`, so the provider is the same
  // element at the root: React keeps the one engine (its queue and holds)
  // when the cutscene hands over to the app.
  const framed = (body: ReactElement) => (
    <KnownNamesProvider value={names}>
      <SidesContext.Provider value={{ view: st, calls: s.sides }}>
        <MomentsProvider {...moments}>{body}</MomentsProvider>
      </SidesContext.Provider>
    </KnownNamesProvider>
  );

  const passing = nav.overlay === "pass";
  if (cut.showing) {
    const dock = t.list.find((c) => c.decision !== null)?.decision ?? s.decision?.decision ?? null;
    const here = st.location !== null ? (t.list.find((c) => c.id === `loc:${st.location}`)?.title ?? st.location) : null;
    if (!cut.over && here !== null) stageWhere.current = here;
    const where = cut.over ? stageWhere.current : here;
    return framed(
      <div className="root cut-root">
        <MomentsLayer />
        <CutsceneStage
          messages={staged ?? []}
          title={st.title ?? s.me.title}
          where={where}
          decision={dock}
          widgets={widgets}
          over={cut.over}
          onContinue={leaveCutscene}
          onPass={() => nav.setOverlay("pass")}
          offline={offline}
        />
        {passing && <FullPass guestId={s.me.id} name={s.me.name} onClose={() => nav.setOverlay(null)} />}
        {takeover}
      </div>,
    );
  }

  // Wave 26 (R1, C2): a locked phone shows only the lock screen (its own chunk).
  if (s.locked) {
    return framed(
      <div className="root app-frame guest-frame trapped-bg locked">
        <LazyLockScreen
          title={st.title ?? s.me.title ?? ""}
          objective={st.objectives?.[0] ?? null}
          rooms={t.list}
          interactions={interactions}
          me={s.me.id}
          pins={pins}
          paused={st.paused === true}
          conn={s.connected ? "live" : offline ? "offline" : "reconnecting"}
          onPass={() => nav.setOverlay("pass")}
          onAct={(i) => void s.act(i.id, i.label).catch(() => {})}
        />
        {passing && <FullPass guestId={s.me.id} name={s.me.name} onClose={() => nav.setOverlay(null)} />}
        {takeover}
      </div>,
    );
  }

  // --- the room over the window --------------------------------------------
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
                (r) => {
                  setCodexNote(null);
                  // A hit or a code already held: the dialog, on the entry.
                  // A miss is answered in the room itself (its ⛔ row).
                  void loadScanDone().then((m) => {
                    const o = m.redeemOutcome(r);
                    if ("done" in o) s.showScan(o.done);
                  });
                },
                (e: unknown) => setCodexNote(redeemErrorText(e)),
              )
          : active.kind === "quests" || active.kind === "wallet"
            ? undefined
            : (text: string) => s.say(active.id, text);
      const roomActions: Action[] = [];
      if (gated && active.member) {
        roomActions.push({ label: "＋ Invite", onClick: () => setInviting(true), tone: "primary" });
        roomActions.push({ label: "Leave room", onClick: () => void s.leaveChannel(active.id), tone: "danger" });
      }
      stage = (
        <ChannelView
          channel={active.id === "lobby" ? { ...active, subtitle: undefined } : active}
          wide={wide}
          meId={s.me.id}
          onBack={nav.back}
          onOpenThread={t.openThread}
          onSend={send}
          widgets={widgets}
          focusCard={nav.focusSeq}
          focusEntry={nav.focusEntry}
          onPeople={() => setPeople(new Set((active.people ?? []).map((p) => p.id)))}
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

  // --- the windows ---------------------------------------------------------
  const objectives = st.objectives ?? [];
  const tourSteps = tour
    ? tutorialSteps({
        title: st.title ?? s.me.title ?? "the story",
        hasCodex: (st.codexTotal ?? 0) > 0,
        hasQuests: (st.questTotal ?? 0) > 0,
        hasWallet: st.wallet !== undefined,
        hasPeople: (st.people?.length ?? 0) > 0,
        hasActions: interactions.length > 0,
        hasObjectives: objectives.length > 0,
        bathroom: tour.widget?.params["bathroom"] ?? null,
      })
    : [];
  const meId = s.me.id;
  const meName = s.me.name;
  // The other guests, for the wallet's pickers (never me, never a character).
  const walletPeople = (st.people ?? []).filter((p) => p.kind === "guest" && p.id !== meId).map((p) => ({ id: p.id, name: p.name, badges: badgesOf(p) }));
  const act = (i: Interaction) => void s.act(i.id, i.label).catch(() => {});
  const renderButton = objectiveButton({ interactions, arm, onPass: () => nav.go({ to: "pass" }), onScan: () => nav.go({ to: "scan" }), onAct: act });
  const codexRoom = t.list.find((c) => c.id === CODEX_ROOM);
  const missionInput = { view: st, list: t.list, cards, decision: s.decision, codexUnseen: codexRoom !== undefined && codexUnseen(host.storage, meId, codexRoom.messages) };
  const here = st.location !== null ? t.list.find((c) => c.id === `loc:${st.location}`) : undefined;
  const peopleHere = (here?.people ?? []).filter((p) => p.id !== meId).length;
  // Start → Factions (wave 18b): offered while you may found one too.
  const startSides = startSidesOf(st);
  const sidesOpen = startSides.sides;
  const windowBody =
    nav.window === "notifications" ? (
      <div className="screen notifications">
        <LazyNotificationsWindow onClose={() => nav.go({ to: "mission" })} timeOf={rowClockOf(st)} />
      </div>
    ) : nav.window === "chats" ? (
      <ChatsWindow chats={chats} activeId={t.activeId} meId={meId} onOpen={(id) => nav.openRoom(id, "chats")} people={st.people} />
    ) : (
      <LazyMission
        input={missionInput}
        countdowns={st.countdowns}
        clock={st.clock}
        stamp={st}
        captured={captured}
        onGo={nav.go}
        renderButton={renderButton}
        onInvite={(invite) => setSidesWhich({ sheet: "answer", invite })}
        peopleHere={peopleHere}
        onPeople={() => setPeople(new Set((here?.people ?? []).filter((p) => p.id !== meId).map((p) => p.id)))}
      />
    );

  // --- the frame: the NOW title bar on top, the taskbar at the foot -------
  const tone = captured ? ("alarm" as const) : restricted ? ("restricted" as const) : undefined;
  const where = whereLine({ captured, restricted, location: st.location });
  const now = objectives[0] ?? null;
  const frozen = st.wallet !== undefined && frozenUntil(st.wallet, walletClock) !== null;
  const start = guestStartItems({
    name: meName,
    faction: st.faction,
    interactions,
    ...startSides,
    people: (st.people?.length ?? 0) > 0,
    open: {
      act,
      sides: () => setSidesWhich({ sheet: "sides" }),
      people: () => setPeople("all"),
      notifications: () => nav.go({ to: "notifications" }),
      help: () => setHelp(true),
      leave: () => {
        push.release();
        s.leave();
        onLeave();
      },
    },
  });
  const tray = (
    <>
      <ShowClockTray clock={showClockOf(st)} yields={(st.countdowns ?? []).length > 0} />
      <CountdownTray countdowns={st.countdowns} clock={st.clock} paused={st.paused === true} stamp={st} />
      {st.wallet !== undefined ? (
        <BalanceTray view={st.wallet} frozen={frozen} onOpen={() => nav.go({ to: "wallet" })} />
      ) : st.score !== 0 ? (
        <TrayItem icon={<Icon name="star" />} text={String(st.score)} title={`Score ${st.score}`} />
      ) : null}
    </>
  );
  const taskbar = (
    <Taskbar
      start={start}
      startHeader={<GuestStartHeader name={meName} faction={factionNameOf(st)} where={where} onMe={() => nav.go({ to: "me" })} />}
      brand={st.title ?? s.me.title ?? undefined}
      buttons={guestTaskbarButtons({
        now,
        pressed: pressedWindow(nav.window),
        chatsDot: chatsDot(chats),
        missionNew: nowId !== null && seenNow !== null && nowId !== seenNow,
        mission: () => nav.tap("mission"),
        chats: () => nav.tap("chats"),
        pass: () => nav.go({ to: "pass" }),
        scan: () => nav.go({ to: "scan" }),
      })}
      tray={tray}
      conn={s.connected ? "live" : offline ? "offline" : "reconnecting"}
    />
  );
  const storyTitle = st.title ?? s.me.title ?? "";
  // The rooms a typed code may name (a sign's room name checks in).
  const scanRooms = t.list.filter((c) => c.kind === "location").map((c) => ({ id: c.id, title: c.title }));
  return framed(
    <AvatarsContext.Provider value={avatars}>
    <CardActionsProvider value={{ shareCodex: (entry, title) => setSharing({ entry, title }) }}>
    <WalletActionsProvider value={guestWalletActions(st.wallet ?? null, s.me.id, walletClock, restricted, s.wallet)}>
    <FrameRoot
      // `guest-frame`: the taskbar stays on top of sheets, the Start menu's
      // catch-all, dialogs and the blue screen (Pass and Scan are one tap
      // from anywhere); not during the tour, which dims everything.
      className={`root app-frame guest-frame ${captured ? "trapped-bg" : ""} ${restricted ? "restricted-bg" : ""}${tour ? " touring" : ""}`}
      frameRef={rootRef}
      taskbar={taskbar}
      head={
        <>
          <NowBar
            objectives={objectives}
            fallback={titleFallback(t.active?.title ?? null, storyTitle)}
            onOpen={() => nav.go({ to: "mission" })}
            sub={where}
            tone={tone}
            paused={st.paused === true}
            act={onMission ? actLine(st.night?.act, missionLine(objectives)) : undefined}
            lead={<MeButton name={meName} onOpen={() => nav.go({ to: "me" })} />}
            trail={<BellButton className="title-bar-bell" onOpen={() => nav.go({ to: "notifications" })} />}
          />
          {/* One strip above the window: the guest's own pin folds a sticky into its "+n". */}
          <MomentsAndPins pins={pins} me={s.me.id} />
          <Shell side={windowBody} stage={stage} wide={wide} placeholder="Pick a chat, or follow your mission." />
        </>
      }
    >
      {!tour && <AlertsBalloon push={push} title={st.title ?? s.me.title} why="the house can reach you when your phone is locked: alarms, and messages from the characters." />}
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
      {nav.overlay === "me" && (
        <MeSheet
          view={st}
          where={where}
          wake={wake}
          push={pushOffered(push)}
          sides={sidesOpen}
          onPass={() => nav.go({ to: "pass" })}
          onPicture={() => {
            nav.setOverlay(null);
            setPicturing(true);
          }}
          onSides={() => {
            nav.setOverlay(null);
            setSidesWhich({ sheet: "sides" });
          }}
          onAlerts={() => {
            nav.setOverlay(null);
            setAlertsOpen(true);
          }}
          onBadge={() => nav.go({ to: "scan" })}
          onClose={() => nav.setOverlay(null)}
        />
      )}
      {(nav.overlay === "sides" || sidesWhich !== null) && (
        <LazySidesLayer
          which={sidesWhich ?? { sheet: "sides" }}
          view={st}
          calls={s.sides}
          openRoom={(id) => {
            setSidesWhich(null);
            nav.go({ to: "room", id });
          }}
          scan={() => {
            setSidesWhich(null);
            nav.go({ to: "scan" });
          }}
          profile={(id) => {
            setSidesWhich(null);
            nav.setOverlay(null);
            setPeople(new Set([id]));
          }}
          show={setSidesWhich}
          onClose={() => {
            setSidesWhich(null);
            if (nav.overlay === "sides") nav.setOverlay(null);
          }}
        />
      )}
      {picturing && (
        <Sheet title={<IconTitle icon="picture">Your picture</IconTitle>} onClose={() => setPicturing(false)}>
          <PictureChanger session={s} eventId={s.me.eventId} />
        </Sheet>
      )}
      {alertsOpen && <AlertsSheet push={push} title={st.title ?? s.me.title} onClose={() => setAlertsOpen(false)} />}
      {sharing && (
        <PickerSheet
          title={`Share “${sharing.title}” with…`}
          items={shareTargets(st.people ?? [], (st.codex ?? []).find((e) => e.id === sharing.entry)).map((p) => ({ id: p.id, label: p.name, sub: p.kind === "character" ? "character" : (p.faction ?? "guest"), avatar: true, badges: badgesOf(p) }))}
          onPick={(id) => void s.shareCodex(sharing.entry, id)}
          onClose={() => setSharing(null)}
          empty="Nobody else is here yet."
        />
      )}
      {people !== null && <PeopleSheet session={s} only={people === "all" ? undefined : people} onClose={() => setPeople(null)} />}
      {help && <HelpSheet role="guest" onClose={() => setHelp(false)} />}
      {s.scanDone !== null && <LazyScanDone done={s.scanDone} onClose={s.clearScan} />}
      {nav.overlay === "scan" && <ScanSheet meId={s.me.id} onScan={onScanned} onClose={() => nav.setOverlay(null)} rooms={scanRooms} />}
      {passing && <FullPass guestId={meId} name={meName} onClose={() => nav.setOverlay(null)} />}
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
    </FrameRoot>
    </WalletActionsProvider>
    </CardActionsProvider>
    </AvatarsContext.Provider>,
  );
}
