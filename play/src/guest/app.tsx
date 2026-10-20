//! The guest (participant) app (moved out of `guest.tsx` in wave 13) — a
//! Discord/MSN-style chat over the live story: a sidebar of rooms, the
//! open room on the stage, the story's cards docked in the conversation.

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ActionRow, InviteSheet, PickerSheet, SessionEnded, useWide } from "../ui/primitives.tsx";
import { AlertBanner } from "../moments/banner.tsx";
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
import type { Action, Channel } from "../types.ts";
import { usePush } from "../push.ts";
import { PushCard } from "../push-card.tsx";
import { opensHome } from "../room.ts";
import { redeemErrorText, shareTargets } from "../codex.ts";
import { activePins, activeTakeover } from "../pins.ts";
import { Takeover } from "../takeover.tsx";
import { CountdownStrip } from "../countdown.tsx";
import { LinkLanding, ScanSheet, landingLink, type GuestScan } from "../guest-scan.tsx";
import { GuestRegister } from "./register.tsx";
import { IdentityCard, PassSheet, PeopleSheet, ProfileSheet } from "./sheets.tsx";

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
    if (landing !== null && !joinAnyway && landingLink(window.location.search) !== null) return <LinkLanding link={landing} title={landingTitle} notice={s.notice} onJoin={() => setJoinAnyway(true)} onPerformer={onLeave} />;
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
          items={shareTargets(st.people ?? [], (st.codex ?? []).find((e) => e.id === sharing.entry)).map((p) => ({ id: p.id, label: p.name, sub: p.kind === "character" ? "character" : (p.faction ?? "guest"), avatar: true }))}
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
