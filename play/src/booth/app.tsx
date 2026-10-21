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
import { storyNow } from "../clock.ts";
import type { PrimeSession } from "../session/prime.ts";
import type { PrimeActResult } from "../types.ts";
import { ClippyCueBar } from "./cue-bar.tsx";
import { DoorWindow } from "./door.tsx";
import { boardRowCount, nowRow } from "./now-card.tsx";
import { PlayerSelect } from "./pick/select.tsx";
import { RowsWindow } from "./pick/rows.tsx";
import { boothPopOutAdapter, coveredElsewhere, doorQueue, pickLayout, wizardSteps, type AdapterCtx, type DoorEntry } from "./popouts/model.ts";
import { PopOutHost, PopOutScope, usePopOuts } from "./popouts/rung.ts";
import { bindDraft, useBoothPopOuts, type BoothOpeners } from "./popouts/use-booth-popouts.ts";
import { WaitingWindow } from "./waiting.tsx";
import { WantedBoard } from "./wanted/board.tsx";
import { boothView, globalButtonsOf, looseWanted, mayPress, wantedOf, type BoothMessage, type BoothObjective } from "./wire.ts";
import { HostDock } from "../host/dock.tsx";

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

/** The Wanted board, for the host lane's Needs row (§7.1: read-only on a host). */
export { WantedBoard } from "./wanted/board.tsx";

/** The room a performer lands in wide: Readouts (wave 18, G2: the house's
 *  broadcast feed is the far-away Chat log, never a default room). */
export function boothHome(list: Channel[]): string | null {
  return list.find((c) => c.id === INBOX)?.id ?? list.find((c) => c.id !== "__feed" && c.id !== "__scanner")?.id ?? list[0]?.id ?? null;
}

/** The booth's frame: owns the keyboard rule (the taskbar and the NEXT bar
 *  step aside while a text field in the frame has focus). Its own
 *  component, so the listener attaches when the frame mounts (after sign-in). */
function BoothFrame({ children, clocked = false, alarmed = false }: { children: (keyboard: boolean) => ReactNode; clocked?: boolean; alarmed?: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const keyboard = useKeyboardOpen(frame as RefObject<HTMLElement>); // React 19 types (the editor) widen the ref with null
  return (
    // `clocked`: the show clock or a countdown sits in the tray — a narrow phone's Guests drops its word for it.
    <div className={`app-frame booth-frame${clocked ? " clocked" : ""}${alarmed ? " alarmed" : ""}`} ref={frame}>
      {children(keyboard)}
    </div>
  );
}

/** What sits over the booth: the scanner, the Guests list, one guest's card,
 *  or (wave 18) the Wanted board, a picker, the door queue, the 🔔 Waiting window. */
type Layer =
  | { kind: "scan"; guest?: string; caption?: string }
  | { kind: "guests" }
  | { kind: "card"; id: string; seed?: CardSeed; confront?: "rescan" }
  | { kind: "wanted"; fresh: string[] }
  | { kind: "pick"; objective: string; opened: BoothObjective }
  | { kind: "door" }
  | { kind: "waiting" }
  | null;


const BOARD_KEY = (token: string) => `loom.booth.board.${token}`;

/** Runs the pop-out driver inside the rung's provider (signed in only). */
function PopOutDriver(p: Parameters<typeof useBoothPopOuts>[0]) {
  useBoothPopOuts(p);
  return null;
}

export function PerformerApp({ onLeave }: { onLeave: () => void }) {
  const s = usePrimeSession();
  // The guest whose card is (or was last) open: the moments layer drops
  // readouts about them inside the hold (the card showed them) and lets
  // every other booth readout through; a pop-out about them waits (§2.2 rule 7).
  const cardGuest = useRef<string | null>(null);
  return (
    <PopOutScope session={s.auth?.token ?? null} cardGuest={() => cardGuest.current}>
      <BoothApp onLeave={onLeave} s={s} cardGuest={cardGuest} />
    </PopOutScope>
  );
}

function BoothApp({ onLeave, s, cardGuest }: { onLeave: () => void; s: PrimeSession; cardGuest: { current: string | null } }) {
  const host = usePlayHost();
  const wide = useWide();
  const rung = usePopOuts();
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
  // Wave 18 (§4.12): what a pop-out (or the open confrontation) covers never reaches the moments layer.
  const wantedKey = (wantedOf(s.view) ?? []).map((w) => w.id).join("\n");
  const adapterCtx: AdapterCtx = { wanted: wantedOf(s.view), openGuest: () => (layer?.kind === "card" || layer?.kind === "scan" ? cardGuest.current : null), guestName: (id) => s.view?.guests.find((g) => g.id === id)?.name ?? null };
  const adapterRef = useRef(adapterCtx);
  adapterRef.current = adapterCtx;
  const momentFeed = useMemo(() => {
    const guests = s.view?.guests ?? [];
    const byId = new Map(guests.map((g) => [g.id, g.name]));
    return boothMomentFeed(s.messages, {
      character: character0,
      staffRooms: new Set(s.view?.staffRooms ?? []),
      guestName: (id) => byId.get(id) ?? null,
      names: guests.map((g) => g.name),
      covered: (m) => coveredElsewhere(m as BoothMessage, adapterRef.current),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.messages, character0, staffKey, guestKey, wantedKey]);
  // Wave 18: story time now (the view's clock plus the wall time since it arrived).
  const clockAt = useRef({ clock: s.view?.clock, at: Date.now() });
  if (clockAt.current.clock !== s.view?.clock) clockAt.current = { clock: s.view?.clock, at: Date.now() };
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const storyMs = storyNow(clockAt.current.clock, clockAt.current.at, Date.now(), !viewPaused(s.view)) ?? 0;
  // Who claimed what, first seen when (the board's "claimed 11 min ago", the take-over clock).
  const claimSeen = useRef(new Map<string, { by: string; at: number }>());
  for (const w of wantedOf(s.view) ?? []) {
    const was = claimSeen.current.get(w.id);
    if (w.claimedBy === null) claimSeen.current.delete(w.id);
    else if (was === undefined || was.by !== w.claimedBy) claimSeen.current.set(w.id, { by: w.claimedBy, at: storyMs });
  }
  // Clippy's own fire (PLAYER SELECT opens at once after it) and the bar's arm.
  const ownFire = useRef<number | null>(null);
  const armCue = useRef<((id: string) => void) | null>(null);
  const targetKey = useRef<string | null>(null);
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
    if (layer?.kind === "scan" || layer?.kind === "guests" || layer?.kind === "wanted") cardGuest.current = null;
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
  // Wave 18: the Wanted board (C6) and the door queue (the `!!🚪` readouts).
  const wanted = wantedOf(s.view);
  const loose = looseWanted(s.view).length;
  const doors = doorQueue(s.messages.values() as Iterable<BoothMessage>, boothView(s.view)?.guests ?? []);
  const guestByName = (name: string) => guests.find((g) => g.name === name || g.id === name) ?? null;
  const mod = admin ? { setHidden: (seq: number, hidden: boolean) => void s.setHidden(seq, hidden) } : undefined;
  // Cards the story deals to this character (`show … to <Character>`): the
  // booth answers them like a guest, through `/api/prime/widget`.
  const widgets: WidgetHook = { answer: (seq, r) => void s.answerWidget(seq, r).catch(() => {}), answered: s.widgetAnswers };
  const openCard = (guestId: string, seed?: CardSeed, confront?: "rescan") => {
    cardGuest.current = guestId;
    setLayer({ kind: "card", id: guestId, ...(seed !== undefined ? { seed } : {}), ...(confront !== undefined ? { confront } : {}) });
  };
  // Wave 18: the windows a pop-out, the NOW row and the tray open.
  const placeTitle = (loc: string | null) => (loc === null ? null : (s.view?.channels.find((c) => c.id === `loc:${loc}`)?.title ?? loc));
  const openBoard = () => {
    const token0 = s.auth?.token ?? "";
    let last = -1;
    try {
      last = host.storage.load<number>(BOARD_KEY(token0)) ?? -1;
    } catch {
      /* a private window */
    }
    const fresh = (wantedOf(s.view) ?? []).filter((w) => !w.captured && w.markedAt > last).map((w) => w.id);
    try {
      host.storage.save(BOARD_KEY(token0), storyMs);
    } catch {
      /* kept in memory */
    }
    setLayer({ kind: "wanted", fresh });
  };
  const openScan = (guest?: string, name?: string) => setLayer({ kind: "scan", ...(guest !== undefined ? { guest } : {}), ...(name !== undefined ? { caption: `📷 Scan ${name}'s pass` } : {}) });
  const openPick = (objective: string) => {
    const o = (s.view?.objectives ?? []).find((x) => x.id === objective) as BoothObjective | undefined;
    // Its "PLAYER SELECT is ready" pop-out is answered by opening it — or,
    // when the objective has ended, by saying so (NM-F7: the button did
    // nothing at all).
    const prefix = `pick:${objective}:`;
    for (const k of [rung.current?.key, ...rung.tray.map((x) => x.key)]) if (k !== undefined && k.startsWith(prefix)) rung.retire(k);
    if (o === undefined) {
      s.alerts.raise("That's over now: the list closed with its objective.", { quiet: true });
      return;
    }
    setLayer({ kind: "pick", objective, opened: o });
  };
  const openers: BoothOpeners = {
    act: (n, g) => s.act(n, g ?? null),
    card: (g, c) => openCard(g, undefined, c),
    scan: openScan,
    board: openBoard,
    door: () => setLayer({ kind: "door" }),
    pick: openPick,
    cue: (id) => armCue.current?.(id),
  };
  const pressGlobal = (id: string) =>
    s.act(id, null).then(
      (r: PrimeActResult) => {
        const line = [...(r.said ?? []).map((l) => l.text), ...(r.replies ?? []), ...(r.staff ?? [])].find((t) => t.trim() !== "");
        s.alerts.raise(r.refused === true ? `Not done: ${line ?? "the story took no action on this right now."}` : (line ?? "✔ Sent"), { quiet: true });
      },
      (e: unknown) => s.alerts.raise(e instanceof Error ? e.message : String(e), { quiet: true }),
    );
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
    // Wave 18 (§2.3): the booth's big moments and `!` readouts become pop-outs.
    popOutAdapter: boothPopOutAdapter(adapterCtx, (d) => bindDraft(d, openers, rung.defer)),
    openCard: (guestId: string) => openCard(guestId),
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
            <BoothFrame clocked={showClockOf(s.view) !== null || soonest(s.view?.countdowns, s.view?.clock ?? null) !== null} alarmed={(wanted !== null && loose > 0) || rung.tray.length + rung.queued > 0}>
              {(keyboard) => (
                <>
              <NowCard
                objectives={s.view?.objectives}
                interactions={s.view?.interactions ?? []}
                character={character}
                pill={pill}
                closeKey={activeId}
                session={token}
                compact={keyboard}
                paused={viewPaused(s.view)}
                // The board row is for a booth that may claim (an Antivirus);
                // a host keeps its picker row and reads the LED (BN-F6, §12.6).
                row={nowRow((s.view?.objectives ?? [])[0] as BoothObjective | undefined, { wanted: boardRowCount(loose, wanted !== null, mayPress(s.view?.interactions, "claim_escort", character)), interactions: s.view?.interactions ?? [], globals: globalButtonsOf(s.view), placeTitle })}
                rowActions={{
                  onBoard: openBoard,
                  onTarget: (tg) => {
                    const key = targetKey.current;
                    if (key !== null && (rung.current?.key === key || rung.tray.some((x) => x.key === key))) rung.restore(key);
                    else openCard(tg.id);
                  },
                  onPick: openPick,
                  onGlobal: pressGlobal,
                }}
              />
              {/* The sticky banner flows under the NOW card (the booth's title bar). */}
              <MomentsLayer />
              <Shell side={side} stage={stage} wide={wide} placeholder="Pick a room — or 📷 Scan a pass." />
              {/* No `hidden` here: the dock owns its keyboard rule. A field in
                  the room hides it; one in the host console hides only its
                  NEXT bar, never the drawer the host is typing in. */}
              {/* Wave 18 (§2.2 rule 5): a pop-out floats just above the dock, no scrim. */}
              <div className="booth-popout-anchor">
                <PopOutHost />
              </div>
              <div className="booth-dock">
                <ClippyCueBar session={s} now={storyMs} countdowns={s.view?.countdowns} armRef={armCue} onFired={(at) => (ownFire.current = at)} />
                <HostDock session={s} wide={wide} openCard={(id) => openCard(id)} openWanted={openBoard} />
              </div>
              {!keyboard && (
                <Taskbar
                  start={start}
                  startHeader={<StartHeader s={s} />}
                  buttons={[
                    { id: "scan", label: "Scan", icon: <Icon name="scan" />, primary: true, title: "Scan a guest's pass", tour: "scan", onClick: () => setLayer({ kind: "scan" }), active: layer?.kind === "scan" },
                    { id: "guests", label: "Guests", icon: <Icon name="people" />, title: `Every guest (${guests.length}), searchable`, tour: "guests", badge: waiting, onClick: () => setLayer({ kind: "guests" }), active: layer?.kind === "guests" },
                  ]}
                  tray={<BoothTray view={s.view} onWallet={() => t.open(WALLET_ROOM)} loose={wanted !== null ? loose : null} waiting={rung.tray.length + rung.queued} onBoard={openBoard} onWaiting={() => setLayer({ kind: "waiting" })} />}
                  conn={s.connected ? "live" : "reconnecting"}
                />
              )}
                </>
              )}
            </BoothFrame>
            <PopOutDriver session={s} open={openers} now={storyMs} placeTitle={placeTitle} ownFireAt={() => ownFire.current} targetKey={targetKey} />
            {layer?.kind === "scan" && (
              <ScannerScreen session={s} admin={admin} gate={passGate} caption={layer.caption} onBoard={openBoard} onClose={() => setLayer(null)} onOpenThread={openThread} onCardGuest={(id) => (cardGuest.current = guestByName(id)?.id ?? id)} />
            )}
            {layer?.kind === "guests" && <GuestsSheet view={s.view} me={character} session={token} now={storyMs} onPick={(id) => openCard(id)} onClose={() => setLayer(null)} />}
            {layer?.kind === "card" && (
              <GuestCard key={layer.id} session={s} guestId={layer.id} seed={layer.seed} admin={admin} confront={layer.confront} onBoard={openBoard} onClose={() => setLayer(null)} onOpenThread={() => openThread(layer.id)} />
            )}
            {layer?.kind === "wanted" && (
              <WantedBoard
                wanted={wanted ?? []}
                me={character}
                now={storyMs}
                placeTitle={placeTitle}
                readOnly={!mayPress(s.view?.interactions, "claim_escort", character)}
                canRelease={mayPress(s.view?.interactions, "release_escort", character)}
                canTakeOver={mayPress(s.view?.interactions, "take_over_escort", character)}
                fresh={new Set(layer.fresh)}
                claimedAt={(id) => claimSeen.current.get(id)?.at ?? null}
                onClaim={(id) => s.act("claim_escort", id)}
                onRelease={(id) => s.act("release_escort", id)}
                onTakeOver={(id) => s.act("take_over_escort", id)}
                onScan={(id, name) => openScan(id, name)}
                onCard={(id) => openCard(id)}
                onClose={() => setLayer(null)}
              />
            )}
            {layer?.kind === "pick" && (() => {
              const live = (s.view?.objectives ?? []).find((x) => x.id === layer.objective) as BoothObjective | undefined;
              const o = live ?? layer.opened;
              const ints = s.view?.interactions ?? [];
              const press = (id: string, guest: string) => s.act(id, guest);
              return pickLayout(layer.opened, ints) === "steps" ? (
                <PlayerSelect objective={o} steps={wizardSteps(layer.opened, ints)} guests={guests} press={press} onClose={() => setLayer(null)} onLater={() => setLayer(null)} />
              ) : (
                <RowsWindow objective={live} opened={layer.opened} interactions={ints} guests={guests} placeTitle={placeTitle} wanted={wanted !== null ? loose : null} press={press} onCard={(id) => openCard(id)} onBoard={openBoard} onClose={() => setLayer(null)} />
              );
            })()}
            {layer?.kind === "door" && (
              <DoorWindow
                queue={doors}
                now={storyMs}
                me={character}
                canClaim={mayPress(s.view?.interactions, "claim_door", character)}
                onClaim={(e: DoorEntry) => void s.act("claim_door", e.id).finally(() => openScan(e.id, e.name))}
                onScan={(e) => (e !== null ? openScan(e.id, e.name) : openScan())}
                onCard={(id) => openCard(id)}
                onClose={() => setLayer(null)}
              />
            )}
            {layer?.kind === "waiting" && <WaitingWindow onClose={() => setLayer(null)} />}
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
