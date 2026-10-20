//! The guest (participant) app (moved out of `guest.tsx` in wave 13) — a
//! Discord/MSN-style chat over the live story: a sidebar of rooms, the
//! open room on the stage, the story's cards docked in the conversation.

import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { ActionRow, InviteSheet, PickerSheet, SessionEnded, Sheet, useWide } from "../ui/primitives.tsx";
import { PinnedRail } from "../moments/pins-rail.tsx";
import { Shell, SpaceList } from "../rooms/list.tsx";
import { CardActionsProvider } from "../stream/bubble.tsx";
import { ChannelView, MessageThread } from "../stream/channel-view.tsx";
import { CutsceneStage } from "../cutscene.tsx";
import { useOfflineFor } from "../client.ts";
import { HelpSheet } from "../help.tsx";
import { usePlayHost } from "../host.ts";
import { AvatarsContext, avatarLookup } from "../avatars.ts";
import { useDocumentTitle, useLandingBrand } from "../session/shared.ts";
import { pendingWidget, personalStream } from "../session/channels.ts";
import { useGuestSession, type GuestSession } from "../session/guest.ts";
import { Tutorial, tourResult, tutorialSteps } from "../tutorial.tsx";
import { CODEX_ROOM, WALLET_ROOM } from "../rooms/spaces.ts";
import { FreezeSheet, OfferSheet, PeopleAmountSheet, StimulusSheet, WalletActionsProvider, WalletFooter, frozenUntil, guestWalletActions, useWalletClock, type WalletSheet } from "../wallet.tsx";
import type { Action, Channel, Interaction } from "../types.ts";
import { usePush } from "../push.ts";
import { opensHome } from "../room.ts";
import { redeemErrorText, shareTargets } from "../codex.ts";
import { activePins, activeTakeover } from "../pins.ts";
import { Takeover } from "../takeover.tsx";
import { LinkLanding, ScanSheet, landingLink, type GuestScan } from "../guest-scan.tsx";
import { MissedTray, MomentsLayer, MomentsProvider, type MomentsInput } from "../moments/provider.tsx";
import { GuestRegister } from "./register.tsx";
import { FullPass } from "../chrome/pass.tsx";
import { PeopleSheet } from "./sheets.tsx";
import { CountdownTray } from "../chrome/countdown-tray.tsx";
import { useKeyboardOpen } from "../chrome/keyboard.ts";
import { Taskbar, TrayItem } from "../chrome/taskbar.tsx";
import { TitleBar, titleFallback } from "../chrome/title-bar.tsx";
import { defectTargets } from "../session/guest.ts";
import { PictureChanger } from "./register.tsx";
import { AlertsBalloon, AlertsSheet, BalanceTray, GuestStartHeader, ObjectiveSheet, guestStartItems, guestTaskbarButtons, pushOffered, useStartWake, whereLine } from "./frame.tsx";

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
    <div className={className} ref={frameRef as RefObject<HTMLDivElement> | undefined}>
      {head}
      {!typing && taskbar}
      {children}
    </div>
  );
}

export function GuestApp({ onLeave }: { onLeave: () => void }) {
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
  // 📷 Scan: a wall code read in this session (never a new tab).
  const [scanning, setScanning] = useState(false);
  // 🎟 Pass: the full-screen pass, one tap from every screen.
  const [passing, setPassing] = useState(false);
  // The Start menu's sheets, and the NOW title bar's objective sheet.
  const [picturing, setPicturing] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [objectivesOpen, setObjectivesOpen] = useState(false);
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

  // The moments layer (wave 13): one provider over both the cutscene and the
  // main frame, so the queue, its holds and the beat's blue screen carry
  // across the cutscene → app switch.
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
    openRoom: t.open,
    sound: host.sound,
    // The room the guest stands in: its beat lines reach the blue screen.
    here: st.location !== null ? `loc:${st.location}` : null,
    // "Take me there" on the loud "show your pass" objective.
    openPass: () => setPassing(true),
  };
  // Both branches below return through `framed`, so the provider is the same
  // element at the root: React keeps the one engine (its queue and holds)
  // when the cutscene hands over to the app.
  const framed = (body: ReactElement) => <MomentsProvider {...moments}>{body}</MomentsProvider>;

  if (cut.showing) {
    const dock = t.list.find((c) => c.decision !== null)?.decision ?? null;
    const where = st.location !== null ? (t.list.find((c) => c.id === `loc:${st.location}`)?.title ?? st.location) : null;
    return framed(
      <div className="root cut-root">
        <MomentsLayer />
        <CutsceneStage
          messages={staged ?? []}
          title={st.title ?? s.me.title}
          where={cut.over ? null : where}
          decision={dock}
          widgets={widgets}
          over={cut.over}
          onContinue={cut.leave}
          onPass={() => setPassing(true)}
          offline={offline}
        />
        {passing && <FullPass guestId={s.me.id} name={s.me.name} onClose={() => setPassing(false)} />}
        {takeover}
      </div>,
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
      empty="Quiet… for now."
      fold
    />
  );

  const objectives = st.objectives ?? [];
  const tourSteps = tour
    ? tutorialSteps({
        title: st.title ?? s.me.title ?? "the story",
        hasCodex: (st.codexTotal ?? 0) > 0,
        hasQuests: (st.questTotal ?? 0) > 0,
        hasWallet: st.wallet !== undefined,
        hasPeople: (st.people?.length ?? 0) > 0,
        hasActions: (st.interactions?.length ?? 0) > 0,
        hasObjectives: objectives.length > 0,
        bathroom: tour.widget?.params["bathroom"] ?? null,
      })
    : [];

  // The other guests, for the wallet's pickers (never me, never a character).
  const meId = s.me.id;
  const meName = s.me.name;
  const walletPeople = (st.people ?? []).filter((p) => p.kind === "guest" && p.id !== meId).map((p) => ({ id: p.id, name: p.name }));

  // --- the frame: the NOW title bar on top, the taskbar at the foot -------
  const tone = captured ? ("alarm" as const) : restricted ? ("restricted" as const) : undefined;
  const where = whereLine({ captured, restricted, location: st.location });
  const now = objectives[0] ?? null;
  const act = (i: Interaction) => void s.act(i.id, i.label).catch(() => {});
  const frozen = st.wallet !== undefined && frozenUntil(st.wallet, walletClock) !== null;
  const start = guestStartItems({
    name: meName,
    faction: st.faction,
    interactions: st.interactions ?? [],
    defectTo: defectTargets(st),
    wake,
    push: pushOffered(push),
    people: (st.people?.length ?? 0) > 0,
    open: {
      picture: () => setPicturing(true),
      wake: () => wake?.toggle(),
      alerts: () => setAlertsOpen(true),
      people: () => setPeople("all"),
      help: () => setHelp(true),
      act,
      defect: (to) => void s.defect(to),
      leave: () => {
        push.release();
        s.leave();
        onLeave();
      },
    },
  });
  const tray = (
    <>
      <CountdownTray countdowns={st.countdowns} clock={st.clock} paused={st.paused === true} stamp={st} />
      {st.wallet !== undefined ? (
        <BalanceTray view={st.wallet} frozen={frozen} onOpen={() => t.open(WALLET_ROOM)} />
      ) : st.score !== 0 ? (
        <TrayItem icon="⭐" text={String(st.score)} title={`Score ${st.score}`} />
      ) : null}
      <MissedTray />
    </>
  );
  const taskbar = (
    <Taskbar
      start={start}
      startHeader={<GuestStartHeader name={meName} faction={st.faction} where={where} />}
      brand={st.title ?? s.me.title ?? undefined}
      buttons={guestTaskbarButtons({ now, pass: () => setPassing(true), scan: () => setScanning(true) })}
      tray={tray}
      conn={s.connected ? "live" : offline ? "offline" : "reconnecting"}
    />
  );
  // The rooms a typed code may name (a sign's room name checks in).
  const scanRooms = t.list.filter((c) => c.kind === "location").map((c) => ({ id: c.id, title: c.title }));
  return framed(
    <AvatarsContext.Provider value={avatars}>
    <CardActionsProvider value={{ shareCodex: (entry, title) => setSharing({ entry, title }) }}>
    <WalletActionsProvider value={guestWalletActions(st.wallet ?? null, s.me.id, walletClock, restricted, s.wallet)}>
    <FrameRoot
      className={`root app-frame ${captured ? "trapped-bg" : ""} ${restricted ? "restricted-bg" : ""}`}
      frameRef={rootRef}
      taskbar={taskbar}
      head={
        <>
          <TitleBar objectives={objectives} fallback={titleFallback(t.active?.title ?? null, st.title ?? s.me.title ?? null)} onOpen={() => setObjectivesOpen(true)} sub={where} tone={tone} />
          <MomentsLayer />
          <PinnedRail pins={pins} />
          <Shell side={side} stage={stage} wide={wide} placeholder="Pick a room on the left. The one you're standing in is at the top." />
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
      {objectivesOpen && objectives.length > 0 && (
        <ObjectiveSheet
          objectives={objectives}
          interactions={st.interactions ?? []}
          onPass={() => {
            setObjectivesOpen(false);
            setPassing(true);
          }}
          onScan={() => {
            setObjectivesOpen(false);
            setScanning(true);
          }}
          onAct={(i) => {
            setObjectivesOpen(false);
            act(i);
          }}
          onClose={() => setObjectivesOpen(false)}
        />
      )}
      {picturing && (
        <Sheet title="🖼️ Your picture" onClose={() => setPicturing(false)}>
          <PictureChanger session={s} eventId={s.me.eventId} />
        </Sheet>
      )}
      {alertsOpen && <AlertsSheet push={push} title={st.title ?? s.me.title} onClose={() => setAlertsOpen(false)} />}
      {sharing && (
        <PickerSheet
          title={`Share “${sharing.title}” with…`}
          items={shareTargets(st.people ?? [], (st.codex ?? []).find((e) => e.id === sharing.entry)).map((p) => ({ id: p.id, label: p.name, sub: p.kind === "character" ? "character" : (p.faction ?? "guest"), avatar: true }))}
          onPick={(id) => void s.shareCodex(sharing.entry, id)}
          onClose={() => setSharing(null)}
          empty="Nobody else is here yet."
        />
      )}
      {people !== null && <PeopleSheet session={s} only={people === "all" ? undefined : people} onClose={() => setPeople(null)} />}
      {help && <HelpSheet role="guest" onClose={() => setHelp(false)} />}
      {scanning && <ScanSheet meId={s.me.id} onScan={onScanned} onClose={() => setScanning(false)} rooms={scanRooms} />}
      {passing && <FullPass guestId={meId} name={meName} onClose={() => setPassing(false)} />}
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
