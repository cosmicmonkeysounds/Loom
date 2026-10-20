//! The performer (character) app (wave 13): a Win95 window for the night.
//! Top: the NOW card (the character's live objective, one line). Middle:
//! the rooms (staff rooms pinned, Readouts, the house) or the open room.
//! Bottom: the host dock (host booths) and the taskbar — ⊞ Start, the big
//! 📷 Scan, 🗂 Guests, the tray. A scan opens the guest's card at once;
//! everything a performer can do to a guest lives on that card.

import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { ActionRow, InviteSheet, PickerSheet, SessionEnded, useWide } from "../ui/primitives.tsx";
import { Shell, SpaceList } from "../rooms/list.tsx";
import type { WidgetHook } from "../stream/bubble.tsx";
import { ChannelView, MessageThread } from "../stream/channel-view.tsx";
import { HelpSheet } from "../help.tsx";
import { usePlayHost } from "../host.ts";
import { WalletActionsProvider, useWalletClock } from "../wallet.tsx";
import { AvatarsContext, avatarLookup } from "../avatars.ts";
import { useDocumentTitle } from "../session/shared.ts";
import { INBOX, usePrimeSession } from "../session/prime.ts";
import type { Action, Channel, ChatMessage } from "../types.ts";
import { usePush } from "../push.ts";
import { PushCard } from "../push-card.tsx";
import { opensHome } from "../room.ts";
import { activePins } from "../pins.ts";
import { boothAlertFilter } from "../alerts.ts";
import { HostDock } from "../host/dock.tsx";
import { MomentsLayer, MomentsProvider, type MomentsInput } from "../moments/provider.tsx";
import { Taskbar } from "../chrome/taskbar.tsx";
import { useKeyboardOpen } from "../chrome/keyboard.ts";
import { WALLET_ROOM } from "../rooms/spaces.ts";
import { useWakeLock } from "../wake-lock.ts";
import { GuestCard, type CardSeed } from "./card.tsx";
import { GuestsSheet } from "./guests.tsx";
import { AlertsSheet, KnowsSheet, PowersSheet, StartHeader, boothPill, boothStartItems, type BoothSheet } from "./header.tsx";
import { PrimeLogin } from "./login.tsx";
import { boothFoldable, boothHost, boothSidebar, closedGate, guestsWaiting, soonest, viewPaused } from "./model.ts";
import { boothMomentFeed } from "./moments-feed.ts";
import { Icon } from "../chrome/icons.tsx";
import { BoothIcon } from "./icons.tsx";
import { NowCard } from "./now-card.tsx";
import { ReadoutsView } from "./readouts.tsx";
import { CLOSED_PASS_MS, ScannerScreen } from "./scanner.tsx";
import { BoothTray } from "./tray.tsx";
import { showClockOf } from "../show-clock.ts";

/**
 * A guest's thread as the booth shows it: its rows come from several rooms,
 * so each wears its room's name as a chip — except the booth's own DM with
 * the guest (`dm:<Character>`), whose room name is the character's own
 * ("DOOR DEE Encarta: Is the party open yet?" read as the booth's name
 * tagging the guest's line). Those rows wear no chip: the DM is the
 * thread itself (an empty title; `booth.css` hides the empty chip).
 */
export function guestThreadView(c: Channel, character: string): Channel {
  const own = `dm:${character}`;
  if (character === "" || !c.messages.some((m) => m.channel === own)) return c;
  return { ...c, messages: c.messages.map((m) => (m.channel === own ? dmRow(m) : m)) };
}

/** One relabelled row per message, kept: the stream sees the same object every render. */
const dmRows = new WeakMap<ChatMessage, ChatMessage>();
function dmRow(m: ChatMessage): ChatMessage {
  let row = dmRows.get(m);
  if (row === undefined) {
    row = { ...m, title: "" };
    dmRows.set(m, row);
  }
  return row;
}

/** The room a performer lands in wide: the broadcast feed. */
export function boothHome(list: Channel[]): string | null {
  return list.find((c) => c.id === "__feed")?.id ?? list[0]?.id ?? null;
}

/** The booth's frame: owns the keyboard rule (the taskbar and the NEXT bar
 *  step aside while a text field in the frame has focus). Its own
 *  component, so the listener attaches when the frame mounts (after sign-in). */
function BoothFrame({ children, clocked = false }: { children: (keyboard: boolean) => ReactNode; clocked?: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const keyboard = useKeyboardOpen(frame as RefObject<HTMLElement>); // React 19 types (the editor) widen the ref with null
  return (
    // `clocked`: the show clock or a countdown sits in the tray — a narrow phone's Guests drops its word for it.
    <div className={`app-frame booth-frame${clocked ? " clocked" : ""}`} ref={frame}>
      {children(keyboard)}
    </div>
  );
}

/** What sits over the booth: the scanner, the Guests list, or one guest's card. */
type Layer = { kind: "scan" } | { kind: "guests" } | { kind: "card"; id: string; seed?: CardSeed } | null;

export function PerformerApp({ onLeave }: { onLeave: () => void }) {
  const host = usePlayHost();
  const s = usePrimeSession();
  const wide = useWide();
  const [sheet, setSheet] = useState<BoothSheet | null>(null);
  const [help, setHelp] = useState(false);
  const [layer, setLayer] = useState<Layer>(null);
  const [people, setPeople] = useState<Channel | null>(null);
  const [picking, setPicking] = useState(false);
  const wake = useWakeLock(host.storage);
  // The just-closed pass, ignored for a moment: kept for the sign-in, not
  // per scanner opening, so leaving and reopening the scanner with the pass
  // still held up never re-fires its scan.
  const passGate = useMemo(() => closedGate(CLOSED_PASS_MS), []);
  // The guest whose card is (or was last) open: the moments layer drops
  // readouts about them inside the hold (the card showed them) and lets
  // every other booth readout through.
  const cardGuest = useRef<string | null>(null);
  useDocumentTitle(s.auth?.title);
  // K-31a: the server-room (patch-bay) alarm + the late list on a locked phone.
  const push = usePush(s.auth?.character ? { base: `/e/${encodeURIComponent(s.auth.eventId)}`, token: s.auth.token } : null, "booth");
  // Everyone's profile pictures, for every tile in the booth.
  const avatars = useMemo(() => avatarLookup(s.auth?.eventId ?? null, s.view?.avatars), [s.auth?.eventId, s.view?.avatars]);
  const t = s.threads;
  const signedIn = s.auth !== null && s.ready;
  const activeId = t.activeId;
  const home = boothHome(t.list);
  // What the moments layer reads (`moments-feed.ts`): staff-room lines from
  // someone else raise a balloon, a burst of same-kind readouts is one sticky.
  const character0 = s.auth?.character ?? "";
  const staffKey = (s.view?.staffRooms ?? []).join("\n");
  const guestKey = (s.view?.guests ?? []).map((g) => `${g.id}\t${g.name}`).join("\n");
  const momentFeed = useMemo(() => {
    const guests = s.view?.guests ?? [];
    const byId = new Map(guests.map((g) => [g.id, g.name]));
    return boothMomentFeed(s.messages, { character: character0, staffRooms: new Set(s.view?.staffRooms ?? []), guestName: (id) => byId.get(id) ?? null, names: guests.map((g) => g.name) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.messages, character0, staffKey, guestKey]);
  // The approver's queue countdowns tick between snapshots, as the guest
  // wallet's do (a quiet stretch pushes no view).
  const walletClock = useWalletClock(s.view?.clock, s.view?.wallet);
  useEffect(() => {
    if (opensHome(signedIn, wide, activeId, home, s.roomLinkPending) && home !== null) t.open(home);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, wide, activeId, home, s.roomLinkPending]);
  // The scanner or the Guests list opening shows no card yet: the last
  // card's guest is not on screen, so an alert about them is news again.
  useEffect(() => {
    if (layer?.kind === "scan" || layer?.kind === "guests") cardGuest.current = null;
  }, [layer?.kind]);
  // A notification's `?room=scanner` link (the old Scanner room's readouts)
  // opens Readouts, where those readouts live now.
  useEffect(() => {
    if (activeId === "__scanner") t.open(INBOX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  if (!s.auth) return host.embedded ? <SessionEnded notice={s.notice} /> : <PrimeLogin session={s} />;
  const admin = s.auth.admin;
  // C4: the latest view says whether this booth is a host (an older server's: the sign-in's answer).
  const isHost = boothHost(s.auth, s.view);
  const pill = boothPill({ admin, host: isHost });
  const token = s.auth.token;
  const character = s.auth.character;
  // The 🗂 Guests badge: guests whose typed line to this character waits unread.
  const waiting = guestsWaiting(t.list, character);
  const guests = s.view?.guests ?? [];
  const guestByName = (name: string) => guests.find((g) => g.name === name || g.id === name) ?? null;
  const mod = admin ? { setHidden: (seq: number, hidden: boolean) => void s.setHidden(seq, hidden) } : undefined;
  // Cards the story deals to this character (`show … to <Character>`): the
  // booth answers them like a guest, through `/api/prime/widget`.
  const widgets: WidgetHook = { answer: (seq, r) => void s.answerWidget(seq, r).catch(() => {}), answered: s.widgetAnswers };
  const openCard = (guestId: string, seed?: CardSeed) => {
    cardGuest.current = guestId;
    setLayer({ kind: "card", id: guestId, ...(seed !== undefined ? { seed } : {}) });
  };
  const openCardByName = (name: string) => {
    const g = guestByName(name);
    if (g) openCard(g.id);
  };
  const openThread = (guestId: string) => {
    setLayer(null);
    t.open(`guest:${guestId}`);
  };

  let stage: ReactElement | null = null;
  if (t.active) {
    const active = t.active;
    // The broadcast feed posts to the room (lobby); guest threads keep their
    // id (the server maps `guest:<id>` to this character's DM with that guest).
    const postChannel = active.id === "__feed" ? "lobby" : active.id;
    if (active.kind === "scanner") {
      stage = null; // redirected to Readouts (above)
    } else if (t.activeThreadRoot !== null) {
      stage = (
        <MessageThread
          channel={active}
          rootSeq={t.activeThreadRoot}
          onClose={t.closeThread}
          moderate={mod}
          onSend={(text, parentSeq) => s.say(postChannel, text, parentSeq)}
        />
      );
    } else if (active.id === INBOX) {
      stage = <ReadoutsView channel={active} wide={wide} onBack={t.back} guests={guests} onGuest={(id) => openCard(id)} widgets={widgets} />;
    } else if (active.id === "quests" || active.id === "codex" || active.id === "wallet") {
      // The character's own pinned Quest Log / Codex / Wallet: read-only
      // rooms whose cards the booth answers (sharing stays on the guest
      // card; Approve / Deny live on the wallet cards).
      stage = <ChannelView channel={active} wide={wide} onBack={t.back} moderate={mod} onOpenThread={t.openThread} widgets={widgets} />;
    } else if (active.kind === "guest") {
      const gid = active.id.slice("guest:".length);
      stage = (
        <ChannelView
          channel={guestThreadView(active, character)}
          wide={wide}
          onBack={t.back}
          showChannel
          moderate={mod}
          onOpenThread={t.openThread}
          onSend={(text) => s.say(active.id, text)}
          onPerson={openCardByName}
          pins={activePins(active.messages)}
          headerActions={
            <button className="w95-btn booth-head-btn" title="This guest's card" onClick={() => openCard(gid)}>
              <BoothIcon name="card" /> Card
            </button>
          }
        />
      );
    } else if (active.id.startsWith("cast:")) {
      // A private line to an agent-voiced character (the server maps
      // `cast:<id>` onto its DM thread with this performer).
      stage = <ChannelView channel={active} wide={wide} onBack={t.back} moderate={mod} onOpenThread={t.openThread} onSend={(text) => s.say(active.id, text)} widgets={widgets} />;
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
          onSend={(text) => s.say(postChannel, text)}
          onPerson={openCardByName}
          onPeople={() => setPeople(active)}
          pins={activePins(active.messages)}
          footer={actions.length > 0 ? <ActionRow actions={actions} /> : undefined}
        />
      );
    }
  }

  const side = (
    <SpaceList
      spaces={boothSidebar(t.spaces, { character, activeId: t.activeId })}
      activeId={t.activeId}
      onOpen={t.open}
      fold={boothFoldable}
      header={<PushCard push={push} booth title={s.auth?.title} why="the server-room alarm and the late list reach you even with the phone locked." />}
      empty="No rooms yet."
    />
  );

  // The moments layer (wave 13), capped and filtered for a booth.
  const moments: MomentsInput = {
    role: "booth",
    me: character,
    // The room open now: a guest's line in the thread being read is no balloon.
    here: t.activeId,
    session: s.auth.token,
    messages: momentFeed,
    alerts: s.alerts,
    alertLevel: s.view?.alertLevel,
    objectives: s.view?.objectives,
    phase: s.view?.night?.phase,
    clock: s.view?.clock,
    // A readout's room is the booth's own `dm:<Character>`: that is Readouts here.
    openRoom: (id) => t.open(id === `dm:${character}` ? INBOX : id),
    filter: boothAlertFilter(character),
    sound: host.sound,
    cardGuest: () => cardGuest.current,
  };
  const start = boothStartItems({
    character,
    admin,
    host: isHost,
    knows: s.view?.codex?.length ?? 0,
    wake,
    embedded: host.embedded,
    onHelp: () => setHelp(true),
    onSheet: setSheet,
    onSignOut: () => {
      push.release();
      s.leave();
      onLeave();
    },
  });

  return (
    <MomentsProvider {...moments}>
      <AvatarsContext.Provider value={avatars}>
        <WalletActionsProvider value={{ view: s.view?.wallet ?? null, me: null, clock: walletClock, approve: (id) => void s.walletApprove(id), deny: (id) => void s.walletDeny(id) }}>
          <div className="root">
            <BoothFrame clocked={showClockOf(s.view) !== null || soonest(s.view?.countdowns, s.view?.clock ?? null) !== null}>
              {(keyboard) => (
                <>
              <NowCard objectives={s.view?.objectives} interactions={s.view?.interactions ?? []} character={character} pill={pill} closeKey={activeId} session={token} compact={keyboard} paused={viewPaused(s.view)} />
              {/* The sticky banner flows under the NOW card (the booth's title bar). */}
              <MomentsLayer />
              <Shell side={side} stage={stage} wide={wide} placeholder="Pick a room — or 📷 Scan a pass." />
              {/* No `hidden` here: the dock owns its keyboard rule. A field in
                  the room hides it; one in the host console hides only its
                  NEXT bar, never the drawer the host is typing in. */}
              <div className="booth-dock">
                <HostDock session={s} wide={wide} openCard={(id) => openCard(id)} />
              </div>
              {!keyboard && (
                <Taskbar
                  start={start}
                  startHeader={<StartHeader s={s} />}
                  buttons={[
                    { id: "scan", label: "Scan", icon: <Icon name="scan" />, primary: true, title: "Scan a guest's pass", tour: "scan", onClick: () => setLayer({ kind: "scan" }), active: layer?.kind === "scan" },
                    { id: "guests", label: "Guests", icon: <Icon name="people" />, title: `Every guest (${guests.length}), searchable`, tour: "guests", badge: waiting, onClick: () => setLayer({ kind: "guests" }), active: layer?.kind === "guests" },
                  ]}
                  tray={<BoothTray view={s.view} onWallet={() => t.open(WALLET_ROOM)} />}
                  conn={s.connected ? "live" : "reconnecting"}
                />
              )}
                </>
              )}
            </BoothFrame>
            {layer?.kind === "scan" && <ScannerScreen session={s} admin={admin} gate={passGate} onClose={() => setLayer(null)} onOpenThread={openThread} onCardGuest={(id) => (cardGuest.current = guestByName(id)?.id ?? id)} />}
            {layer?.kind === "guests" && <GuestsSheet view={s.view} onPick={(id) => openCard(id)} onClose={() => setLayer(null)} />}
            {layer?.kind === "card" && (
              <GuestCard key={layer.id} session={s} guestId={layer.id} seed={layer.seed} admin={admin} onClose={() => setLayer(null)} onOpenThread={() => openThread(layer.id)} />
            )}
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
                onPick={(id) => openCard(id)}
                onClose={() => setPeople(null)}
                empty="Nobody is standing here."
              />
            )}
            {sheet === "knows" && <KnowsSheet session={s} onClose={() => setSheet(null)} />}
            {sheet === "powers" && <PowersSheet session={s} onClose={() => setSheet(null)} />}
            {sheet === "alerts" && <AlertsSheet session={s} push={push} onClose={() => setSheet(null)} />}
            {help && <HelpSheet role="performer" onClose={() => setHelp(false)} />}
          </div>
        </WalletActionsProvider>
      </AvatarsContext.Provider>
    </MomentsProvider>
  );
}
