//! The performer (character) app (wave 13): a Win95 window for the night.
//! Top: the NOW card (the character's live objective, one line). Middle:
//! the rooms (staff rooms pinned, Readouts, the house) or the open room.
//! Bottom: the host dock (host booths) and the taskbar — ⊞ Start, the big
//! 📷 Scan, 🗂 Guests, the tray. A scan opens the guest's card at once;
//! everything a performer can do to a guest lives on that card.
//!
//! Wave 21 (P1): a player's booth (`PrimeView.player`) takes the guest
//! frame's shape instead — the ▣ MISSION title bar, Mission | Chats as the
//! window, the taskbar `⊞ Start · Mission · Chats · Scan`, no NOW card, no
//! Guests, no host dock and no cue bar (`booth/player.tsx`).
//!
//! Wave 25 (docs/loom-house-desk.md §6.2): a host booth's taskbar reads
//! `⊞ Start · Show · Chats · Desk · Scan`. Show (`host/show.tsx`) is home
//! and stands where the room list was, as a player's Mission does; the NOW
//! card steps aside while it is on screen (its jobs are inside). Chats is
//! the room list; the Desk (`host/windows.tsx`, lazy) is the house desk.
//! The slim NEXT bar shows only while Show is off screen; Guests is in
//! Show's People.
//!
//! Wave 48 (C5): the censor's booth (`PrimeView.filter`) gets the 🔑
//! LANGUAGE pop-out (the driver), the tray's `🔑 n` and the filter window
//! (`booth/filter/`), sharing one `useFilter`. Wave 48b (C13): ⊞ Start's
//! 🔑 Filter strength (its layer, the only way to it), the ⭐ game's heat
//! handed down (`FilterGameContext`) and the burst after a ✂.

import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { ActionRow, InviteSheet, PickerSheet, SessionEnded, useWide } from "../ui/primitives.tsx";
import { Shell, SpaceList } from "../rooms/list.tsx";
import type { WidgetHook } from "../stream/bubble.tsx";
import { ChannelView, MessageThread } from "../stream/channel-view.tsx";
import { StaffHelpSheet } from "../help-staff.tsx";
import { usePlayHost } from "../host.ts";
import { WalletActionsProvider, useWalletClock } from "../wallet.tsx";
import { AvatarsContext, avatarLookup } from "../avatars.ts";
import { useDocumentTitle } from "../session/shared.ts";
import { INBOX, usePrimeSession } from "../session/prime.ts";
import type { Action, Channel, ChatMessage, Interaction } from "../types.ts";
import { usePush } from "../push.ts";
import { PushCard } from "../push-card.tsx";
import { opensHome } from "../room.ts";
import { activePins } from "../pins.ts";
import { boothAlertFilter } from "../alerts.ts";
import { MomentsLayer, MomentsProvider, type MomentsInput } from "../moments/provider.tsx";
import { BoothBadgesProvider, boothBadgeMap } from "./badges.tsx";
import { Taskbar } from "../chrome/taskbar.tsx";
import { useKeyboardOpen } from "../chrome/keyboard.ts";
import { WALLET_ROOM } from "../rooms/spaces.ts";
import { useWakeLock } from "../wake-lock.ts";
import { GuestCard, type CardSeed } from "./card.tsx";
import { GuestsSheet } from "./guests.tsx";
import { AlertsSheet, KnowsSheet, PowersSheet, StartHeader, boothPill, boothStartItems, playerStartItems, type BoothSheet } from "./header.tsx";
import { PrimeLogin } from "./login.tsx";
import { usePhoneVoice } from "../phone-voice.ts";
import { voiceStartItem } from "../chrome/start-menu.tsx";
import { BoothUploadStage, useBoothRails } from "./upload.tsx";
import { useUnlockLink } from "./unlock-link.ts";
import { backFor, boothFoldable, boothHost, boothSidebar, closeTo, closedGate, guestsWaiting, keepsCardGuest, soonest, viewPaused, type Layer } from "./model.ts";
import { boothMine, boothMomentFeed } from "./moments-feed.ts";
import { PeopleSheet } from "./people.tsx";
import { PlayerMission, playerTaskbarButtons } from "./player.tsx";
import { FILTER_ROOM, WANTED_ROOM, playerChats } from "./mission-model.ts";
import { ChatsWindow } from "../guest/chats.tsx";
import { NowBar } from "../guest/frame.tsx";
import { chatsDot } from "../rooms/chats.ts";
import { TitleBar, missionLine } from "../chrome/title-bar.tsx";
import { CODEX_ROOM, QUEST_LOG } from "../rooms/spaces.ts";
import type { Nav } from "../moments/exits.ts";
import { Icon } from "../chrome/icons.tsx";
import { BoothIcon } from "./icons.tsx";
import { LetterCard } from "./letter.tsx";
import { letterOnHome } from "./letter-model.ts";
import { NowCard } from "./now-card.tsx";
import { ReadoutsView } from "./readouts.tsx";
import { CLOSED_PASS_MS, ScannerScreen } from "./scanner.tsx";
import { BoothTray } from "./tray.tsx";
import { showClockOf } from "../show-clock.ts";
import { storyNow } from "../clock.ts";
import type { PrimeSession } from "../session/prime.ts";
import type { PrimeActResult } from "../types.ts";
import { CueBar } from "./cue-bar.tsx";
import { DoorWindow } from "./door.tsx";
import { boardRowCount, nowRow } from "./now-card.tsx";
import { PlayerSelect } from "./pick/select.tsx";
import { RowsWindow } from "./pick/rows.tsx";
import { boothPopOutAdapter, coveredElsewhere, doorClaimer, doorQueue, pickLayout, wizardSteps, type AdapterCtx, type DoorEntry } from "./popouts/model.ts";
import { PopOutHost, PopOutQuiet, PopOutScope, playTone, popOutWaiting, usePopOuts } from "./popouts/rung.ts";
import { useSystemBack } from "../back-gesture.ts";
import { bindDraft, useBoothPopOuts, type BoothOpeners } from "./popouts/use-booth-popouts.ts";
import { WaitingWindow } from "./waiting.tsx";
import { WantedBoard } from "./wanted/board.tsx";
import { boothView, globalButtonsOf, isPlayer, looseWanted, mayPress, wantedOf, type BoothMessage, type BoothObjective } from "./wire.ts";
import { HostConsole, HostDock, isHostBooth } from "../host/dock.tsx";
import { HostShowWindow } from "../host/show.tsx";
import { hostWindowShown, type HostWindow } from "../host/show-model.ts";
import { LazyDeskWindow, hostTaskbarButtons } from "../host/windows.tsx";
import { NowJobs } from "./now-card.tsx";
import { AloudSlot, aloudStartItem, useAloud } from "../aloud/lazy.tsx";
import { CreditsSlot, creditsStartItem, useCredits } from "../credits/lazy.tsx";
import { useFilter } from "./filter/use-filter.ts";
import { FilterWindow } from "./filter/window.tsx";
import { FilterBurst, FilterGameContext } from "./filter/game.tsx";
import { FilterStrengthWindow } from "./filter/strength.tsx";
import { filterStartItem } from "./filter/model.ts";

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
/** What is open over the booth's home, for the phone's Back (wave 47). */
export interface BoothOpen {
  layer: unknown;
  sheet: unknown;
  people: unknown;
  help: boolean;
  credits?: boolean;
  /** A floating pop-out on screen: `later` when it offers Later. */
  popout?: "later" | "stays" | null;
  /** A player's 👥 People list. */
  peopleOpen?: boolean;
  /** A room open over the window (a phone: it covers the home). */
  room?: boolean;
  /** A window other than home on screen (a player's Chats, a host's Chats or Desk). */
  window?: boolean;
  /** Wave 55: the read-aloud pop-up or the teleprompter is up. */
  aloud?: boolean;
}

/** Is something open over the booth's home that the phone's Back should close? */
export function boothAway(open: BoothOpen): boolean {
  return boothBackStep(open) !== null;
}

/**
 * What one press of the phone's Back closes (wave 47): the top thing first
 * (wave 55: the teleprompter, back onto its pop-up, which stays; the credits, a layer, a sheet, a list, a floating pop-out), then the room
 * over the window, then a window that is not home. Never past home: there
 * Back is the browser's again. Before wave 47 a room or Chats was not
 * "away", so Back there left the app mid-show.
 */
export function boothBackStep(open: BoothOpen): "aloud" | "credits" | "layer" | "peopleOpen" | "sheet" | "people" | "help" | "popout" | "room" | "window" | null {
  if (open.aloud === true) return "aloud";
  if (open.credits === true) return "credits";
  if (open.layer !== null) return "layer";
  if (open.peopleOpen === true) return "peopleOpen";
  if (open.sheet !== null) return "sheet";
  if (open.people !== null) return "people";
  if (open.help) return "help";
  if (open.popout != null) return "popout";
  if (open.room === true) return "room";
  if (open.window === true) return "window";
  return null;
}

export function boothHome(list: Channel[]): string | null {
  return list.find((c) => c.id === INBOX)?.id ?? list.find((c) => c.id !== "__feed" && c.id !== "__scanner")?.id ?? list[0]?.id ?? null;
}

/** The booth's frame: owns the keyboard rule (the taskbar and the NEXT bar
 *  step aside while a text field in the frame has focus). Its own
 *  component, so the listener attaches when the frame mounts (after sign-in). */
function BoothFrame({ children, clocked = false, alarmed = false, windowed = false }: { children: (keyboard: boolean) => ReactNode; clocked?: boolean; alarmed?: boolean; windowed?: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const keyboard = useKeyboardOpen(frame as RefObject<HTMLElement>); // React 19 types (the editor) widen the ref with null
  return (
    // `clocked`: the show clock or a countdown sits in the tray — a narrow phone's Guests drops its word for it.
    // `windowed` (wave 26, P2): a player's or a host's windows on the bar — the guest's taskbar rules.
    <div className={boothFrameClass({ clocked, alarmed, windowed })} ref={frame}>
      {children(keyboard)}
    </div>
  );
}

/** The booth frame's classes. Wave 26 (P2): `windowed` (a player's or a
 *  host's window buttons on the bar) takes the guest's taskbar rules
 *  (`css/booth.css` `.booth-frame.windowed`). */
export function boothFrameClass(o: { clocked?: boolean; alarmed?: boolean; windowed?: boolean }): string {
  return `app-frame booth-frame${o.clocked === true ? " clocked" : ""}${o.alarmed === true ? " alarmed" : ""}${o.windowed === true ? " windowed" : ""}`;
}

/** What sits over the booth (`model.ts` `Layer`: a scan or card opened
 *  from a window carries it in `back`, wave 37 C2). */
export type { Layer } from "./model.ts";

/** Wave 37 (C14): does pressing `buttonId` count as this booth's own fire?
 *  A player pressing a button of the NOW objective that names its target
 *  (Clippy's 🎱 on the Bingo caller): PLAYER SELECT then opens at once
 *  instead of popping "PLAYER SELECT is ready" (`pickReadySpec`, 10 s). */
export function ownFireFor(player: boolean, nowObj: BoothObjective | undefined, buttonId: string, interactions: readonly Interaction[]): boolean {
  if (!player || nowObj === undefined) return false;
  return pickLayout(nowObj, interactions) === "target" && nowObj.buttons.includes(buttonId);
}


const BOARD_KEY = (token: string) => `loom.booth.board.${token}`;

/** What a picker over an ended objective says (and openPick, when one is opened late). */
export const PICK_OVER = "That's over now: the list closed with its objective.";
/** Wave 26 (B5): how long an ended PLAYER SELECT stays up (its last reply) before it closes. */
export const PICK_CLOSE_MS = 2500;

/** Wave 26 (B5): is the open layer a PLAYER SELECT whose objective has left
 *  a loaded view? (Rows windows say "Summons over." themselves and stay.) */
export function pickEnded(layer: Layer, objectives: ReadonlyArray<{ id: string }> | undefined, interactions: readonly Interaction[]): boolean {
  if (layer?.kind !== "pick" || objectives === undefined) return false;
  if (pickLayout(layer.opened, interactions) !== "steps") return false;
  return !objectives.some((o) => o.id === layer.objective);
}

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
  // Wave 53 (C2): while the part is on rails the booth is its upload's stage.
  const cut = useBoothRails(s);
  const signOut = () => {
    s.leave();
    onLeave();
  };
  return (
    <PopOutScope session={s.auth?.token ?? null} cardGuest={() => cardGuest.current}>
      {cut.showing ? <BoothUploadStage s={s} over={cut.over} onContinue={cut.leave} onLeave={signOut} /> : <BoothApp onLeave={onLeave} s={s} cardGuest={cardGuest} />}
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
  // Wave 21 (P1): a player's window (Mission or Chats) and its 👥 People list.
  const [pwin, setPwin] = useState<"mission" | "chats">("mission");
  const [peopleOpen, setPeopleOpen] = useState(false);
  // Wave 25: a host's window (Show, Chats or the Desk).
  const [hwin, setHwin] = useState<HostWindow>("show");
  // Wave 37 (C7): NEW MISSION while Mission is on screen is a blink of the
  // title bar (the driver plays the chime), not a pop-out over the card.
  const [missionNews, setMissionNews] = useState<{ id: string; title: string } | null>(null);
  const wake = useWakeLock(host.storage);
  const voice = usePhoneVoice();
  // Wave 48 (C5): the censor's flagged lines, shared by the pop-out, the tray and the window.
  const filter = useFilter(s, host.storage);
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
  // Wave 37 (C6, C8): a player booth, known before sign-in's early return
  // (the same rule as `player` below), and the guests that are this
  // booth's own (its escort claims, the arrivals it took at the door).
  const player0 = s.auth !== null && isPlayer(s.view) && !boothHost(s.auth, s.view) && !s.auth.admin;
  const claimKey = [
    ...(wantedOf(s.view) ?? []).filter((w) => w.claimedBy === character0).map((w) => w.id),
    ...(boothView(s.view)?.guests ?? []).filter((g) => doorClaimer(g) === character0).map((g) => `door:${g.id}`),
  ].join("\n");
  // Wave 37 (C8): `me` + `player`: a player's own `dm:` "… · …" big is its game pop-out.
  const adapterCtx: AdapterCtx = {
    wanted: wantedOf(s.view),
    openGuest: () => (layer?.kind === "card" || layer?.kind === "scan" ? cardGuest.current : null),
    guestName: (id) => s.view?.guests.find((g) => g.id === id)?.name ?? null,
    me: character0,
    player: player0,
    // Wave 47: YOUR GAME IS ON while Mission is on screen is NEW MISSION's
    // blink and the game's chime, never a pop-out over the card it names.
    missionOnScreen: () => player0 && pwin === "mission" && layer === null && t.activeId === null,
    onQuietGame: (game) => {
      playTone(game.tone, host.sound && game.sound !== false);
      const head = s.view?.objectives?.[0];
      if (head !== undefined) setMissionNews({ id: head.id, title: head.title });
    },
  };
  const adapterRef = useRef(adapterCtx);
  adapterRef.current = adapterCtx;
  const momentFeed = useMemo(() => {
    const guests = s.view?.guests ?? [];
    const byId = new Map(guests.map((g) => [g.id, g.name]));
    const wantedNow = wantedOf(s.view) ?? [];
    const rows = boothView(s.view)?.guests ?? [];
    return boothMomentFeed(s.messages, {
      character: character0,
      staffRooms: new Set(s.view?.staffRooms ?? []),
      guestName: (id) => byId.get(id) ?? null,
      names: guests.map((g) => g.name),
      covered: (m) => coveredElsewhere(m as BoothMessage, adapterRef.current),
      // Wave 37 (C6): no quest balloons on a player; a quiet readout about a
      // guest reaches the layer only when the guest is mine.
      player: player0,
      mine: boothMine(wantedNow, (id) => doorClaimer(rows.find((g) => g.id === id)), character0),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.messages, character0, staffKey, guestKey, wantedKey, claimKey, player0]);
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
  // The caller's own fire (PLAYER SELECT opens at once after it) and the bar's arm.
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
  // No card on screen (the scanner or a list opening, or a one-tap × back to
  // a window or the booth): the last card's guest is not in front of you,
  // so a pop-out about them is news again.
  useEffect(() => {
    if (!keepsCardGuest(layer)) cardGuest.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer?.kind]);
  // Wave 26 (B5): PLAYER SELECT closes when its objective leaves the view
  // (one round only), after a beat so the last press's reply shows first.
  const pickGone = pickEnded(layer, s.view?.objectives, s.view?.interactions ?? []);
  useEffect(() => {
    if (!pickGone) return;
    const t = setTimeout(() => {
      setLayer((l) => (l?.kind === "pick" ? null : l));
      s.alerts.raise(PICK_OVER, { quiet: true });
    }, PICK_CLOSE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickGone]);
  // C7: the blink stays 6 s, and never past its headline. (The driver is a
  // child: its onMissionNews for a new headline runs before this updater.)
  useEffect(() => {
    if (missionNews === null) return;
    const t = setTimeout(() => setMissionNews(null), 6000);
    return () => clearTimeout(t);
  }, [missionNews]);
  const headNow = s.view?.objectives?.[0]?.id ?? null;
  useEffect(() => {
    setMissionNews((n) => (n !== null && n.id !== headNow ? null : n));
  }, [headNow]);
  // Wave 58: a codex QR the phone's own camera opened (`?unlock=`).
  useUnlockLink({
    ownsPage: host.ownsPage,
    ready: signedIn && s.view !== null,
    redeem: (code) => s.redeem(code),
    say: (text) => s.alerts.raise(text, { quiet: true }),
    openCodex: () => {
      setLayer(null);
      t.open(CODEX_ROOM);
    },
    view: () => s.view,
  });
  // A notification's `?room=scanner` link (the old Scanner room's readouts)
  // opens Readouts, where those readouts live now.
  useEffect(() => {
    if (activeId === "__scanner") t.open(INBOX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  // The phone's own Back closes the booth's top layer (a card, the board,
  // the scanner, a sheet) instead of leaving the app mid-escort (NMR-2,
  // the booth half of NM-F9); only when the app owns the page.
  // Wave 44 (C7): a player's credits roll, by itself once when the story
  // rolls them live, and from ⊞ Start; it waits while the booth is face to
  // face (the scanner, a card, PLAYER SELECT).
  const credits = useCredits(s.view?.night?.credits?.roll, s.view?.clock);
  // Wave 55: this part's script, over everything; nothing floats while it is up.
  const aloud = useAloud({ messages: s.messages, me: s.view !== null ? `@${s.view.character}` : null, token: s.auth?.token ?? null, storage: host.storage, clock: s.view?.clock, prefetch: true, prompter: s.prompter, post: s.prompterPost });
  const creditsFace = layer?.kind === "scan" || layer?.kind === "card" || layer?.kind === "pick";
  // Wave 47: a room on a phone, a window that isn't home and a floating
  // pop-out are "away" too, so Back steps back inside the app (a room →
  // its window → home) and never leaves it mid-show.
  const player1 = s.auth !== null && isPlayer(s.view) && !boothHost(s.auth, s.view) && !s.auth.admin;
  const hostWins1 = !player1 && s.auth !== null && isHostBooth(s);
  const floating = rung.current !== null && !rung.quieted && rung.activeDock === null ? (rung.current.noLater === true ? "stays" : "later") : null;
  const backOpen: BoothOpen = {
    layer,
    sheet,
    people,
    help,
    credits: credits.open !== null && !creditsFace,
    aloud: aloud.covering,
    peopleOpen,
    popout: floating,
    room: !wide && activeId !== null,
    window: (player1 && pwin !== "mission") || (hostWins1 && hwin !== "show"),
  };
  useSystemBack(host.ownsPage && signedIn, boothAway(backOpen), () => {
    switch (boothBackStep(backOpen)) {
      case "aloud":
        aloud.setOpen(false);
        return;
      case "credits":
        credits.set(null);
        return;
      case "layer":
        setLayer((l) => closeTo(l));
        return;
      case "peopleOpen":
        setPeopleOpen(false);
        return;
      case "sheet":
        setSheet(null);
        return;
      case "people":
        setPeople(null);
        return;
      case "help":
        setHelp(false);
        return;
      case "popout":
        // Back is Later (it waits in 🔔 Waiting); one with no Later stays.
        if (floating === "later" && rung.current !== null) rung.defer(rung.current.key);
        return;
      case "room":
        t.back();
        return;
      case "window":
        if (player1) setPwin("mission");
        else setHwin("show");
        return;
      default:
        return;
    }
  });
  if (!s.auth) return host.embedded ? <SessionEnded notice={s.notice} /> : <PrimeLogin session={s} />;
  const admin = s.auth.admin;
  // C4: the latest view says whether this booth is a host (an older server's: the sign-in's answer).
  const isHost = boothHost(s.auth, s.view);
  const pill = boothPill({ admin, host: isHost });
  // Wave 21 (P1): a player plays the night like a guest. A host never does.
  const player = isPlayer(s.view) && !isHost && !admin;
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
  // Wave 37 (C2): a scan or a card opened from the board, the Door queue, a
  // rows window or 🗂 Guests goes back there on × (`backFor` / `closeTo`).
  const backOf = (l: Layer) => {
    const back = backFor(l, l?.kind === "pick" && pickLayout(l.opened, s.view?.interactions ?? []) === "rows");
    return back !== undefined ? { back } : {};
  };
  const closeLayer = () => setLayer((l) => closeTo(l));
  const openCard = (guestId: string, seed?: CardSeed, confront?: "rescan") => {
    cardGuest.current = guestId;
    setLayer((l) => ({ kind: "card", id: guestId, ...(seed !== undefined ? { seed } : {}), ...(confront !== undefined ? { confront } : {}), ...backOf(l) }));
  };
  // C14: a player's own press of the NOW target's button (🎱) opens PLAYER SELECT at once.
  // The same wall clock `pickReadySpec` compares (`Date.now()`, as CueBar's `onFired`).
  const noteOwnFire = (id: string) => {
    if (ownFireFor(player, (s.view?.objectives ?? [])[0] as BoothObjective | undefined, id, s.view?.interactions ?? [])) ownFire.current = Date.now();
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
    setLayer({ kind: "wanted", fresh, memo: { tab: null, kept: new Set() } });
  };
  // C3: the title bar draws the camera; the caption never repeats it.
  const openScan = (guest?: string, name?: string) => setLayer((l) => ({ kind: "scan", ...(guest !== undefined ? { guest } : {}), ...(name !== undefined ? { caption: `Scan ${name}'s pass` } : {}), ...backOf(l) }));
  const openPick = (objective: string) => {
    const o = (s.view?.objectives ?? []).find((x) => x.id === objective) as BoothObjective | undefined;
    // Its "PLAYER SELECT is ready" pop-out is answered by opening it — or,
    // when the objective has ended, by saying so (NM-F7: the button did
    // nothing at all).
    const prefix = `pick:${objective}:`;
    for (const k of [rung.current?.key, ...rung.tray.map((x) => x.key)]) if (k !== undefined && k.startsWith(prefix)) rung.retire(k);
    if (o === undefined) {
      s.alerts.raise(PICK_OVER, { quiet: true });
      return;
    }
    setLayer({ kind: "pick", objective, opened: o });
  };
  const openers: BoothOpeners = {
    act: (n, g) => {
      noteOwnFire(n);
      return s.act(n, g ?? null);
    },
    card: (g, c) => openCard(g, undefined, c),
    scan: openScan,
    board: openBoard,
    door: () => setLayer({ kind: "door" }),
    pick: openPick,
    cue: (id) => armCue.current?.(id),
    // Wave 21 (P5): NEW MISSION's Go.
    mission: () => {
      setPwin("mission");
      if (t.activeId !== null) t.back();
    },
    // Wave 48 (C5): a refusal keeps the pop-out up (its status line says why).
    censor: (seq) =>
      filter.censor(seq).then((o) => {
        if (o.kind === "refused") throw new Error(o.text);
      }),
    send: (seq) => filter.send(seq),
    letGo: (seq) => filter.letGo(seq),
    filter: () => setLayer({ kind: "filter" }),
  };
  const pressGlobal = (id: string) =>
    s.act(id, null).then(
      (r: PrimeActResult) => {
        // Wave 21 (D4): a player reads plain words — never the staff room's.
        const line = [...(r.said ?? []).map((l) => l.text), ...(r.replies ?? []), ...(player ? [] : (r.staff ?? []))].find((t) => t.trim() !== "");
        if (player) s.alerts.raise(r.refused === true ? "Not now." : (line ?? "✔ Done"), { quiet: true });
        else s.alerts.raise(r.refused === true ? `Not done: ${line ?? "the story took no action on this right now."}` : (line ?? "✔ Sent"), { quiet: true });
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
  const openCodex = () => {
    setLayer(null);
    t.open(CODEX_ROOM);
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

  // Wave 21 (P1, P2, P6): a player's window — Mission (home) or Chats.
  const claimer = mayPress(s.view?.interactions, "claim_escort", character);
  const playerGo = (nav: Nav) => {
    switch (nav.to) {
      case "mission":
      case "chats":
        setPwin(nav.to);
        return;
      case "room":
        if (nav.id === WANTED_ROOM) openBoard();
        else if (nav.id === FILTER_ROOM) setLayer({ kind: "filter" });
        else t.open(nav.id);
        return;
      case "quests":
        t.open(QUEST_LOG);
        return;
      case "codex":
        t.open(CODEX_ROOM);
        return;
      case "wallet":
        t.open(WALLET_ROOM);
        return;
      case "scan":
        setLayer({ kind: "scan" });
        return;
      default:
        return;
    }
  };
  // Wave 25: a host's windows. Show is home; a room covers the window on a
  // phone (the slim NEXT bar then fires from above the taskbar).
  const hostWins = !player && isHostBooth(s);
  const hostShown = hostWins ? hostWindowShown(hwin, wide, t.activeId) : null;
  const hostTap = (w: HostWindow) => {
    setHwin(w);
    // Wide, the room stays beside the window; a phone goes back to it.
    if (!wide && t.activeId !== null) t.back();
  };
  const nowRowOf = () => nowRow((s.view?.objectives ?? [])[0] as BoothObjective | undefined, { wanted: boardRowCount(loose, wanted !== null, mayPress(s.view?.interactions, "claim_escort", character)), interactions: s.view?.interactions ?? [], globals: globalButtonsOf(s.view), placeTitle });
  const nowActions = {
    onBoard: openBoard,
    onTarget: (tg: { id: string }) => {
      const key = targetKey.current;
      if (key !== null && (rung.current?.key === key || rung.tray.some((x) => x.key === key))) rung.restore(key);
      else openCard(tg.id);
    },
    onPick: openPick,
    onGlobal: pressGlobal,
  };
  const hostWindow = !hostWins ? null : hwin === "show" ? (
    <HostShowWindow
      jobs={<NowJobs objectives={s.view?.objectives} interactions={s.view?.interactions ?? []} session={token} row={nowRowOf()} rowActions={nowActions} />}
      jobCount={(s.view?.objectives ?? []).length}
      openGuests={() => setLayer({ kind: "guests" })}
      openPrompter={() => aloud.setOpen(true)}
    />
  ) : hwin === "desk" ? (
    <LazyDeskWindow session={s} />
  ) : null;
  const pChats = player ? playerChats(t.list, { character, now: storyMs, activeId: t.activeId }) : null;
  const playerWindow =
    player && s.view !== null ? (
      pwin === "chats" ? (
        <ChatsWindow chats={pChats!} activeId={t.activeId} meId={character} onOpen={t.open} />
      ) : (
        <PlayerMission
          view={s.view}
          ctx={{ list: t.list, claimer, loose: wanted !== null ? loose : null, filter: filter.view !== null ? filter.waiting.length : null }}
          open={{
            scan: (caption) => setLayer({ kind: "scan", ...(caption !== undefined ? { caption } : {}) }),
            pick: openPick,
            card: (g) => openCard(g),
            global: (id) => void pressGlobal(id),
            go: playerGo,
          }}
        />
      )
    ) : null;
  const playerTap = (target: "mission" | "chats") => {
    setPwin(target);
    if (t.activeId !== null) t.back();
  };
  const side = playerWindow ?? hostWindow ?? (
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
    // Wave 26 (T2): a player's booth gets the guest's takeover; a host's a look-only one.
    glitch: s.view?.night?.glitch,
    // Wave 37 (C13): never over a face-to-face tap (the scanner, a card): look only.
    takeover: player && layer?.kind !== "scan" && layer?.kind !== "card" ? "full" : "light",
    // Wave 37 (C5): one thing at the bottom. A balloon waits (its 8 s not
    // running) while a pop-out is up, and while the scanner, a card or a
    // picker is open (PopOutQuiet hides a held pop-out there, so the layer
    // term covers it).
    balloonsWait: rung.current !== null || layer?.kind === "scan" || layer?.kind === "card" || layer?.kind === "pick",
    // A readout's room is the booth's own `dm:<Character>`: that is Readouts here.
    openRoom: (id) => t.open(id === `dm:${character}` ? INBOX : id),
    filter: boothAlertFilter(character),
    sound: host.sound,
    cardGuest: () => cardGuest.current,
    // Wave 18 (§2.3): the booth's big moments and `!` readouts become pop-outs.
    popOutAdapter: boothPopOutAdapter(adapterCtx, (d) => bindDraft(d, openers, rung.defer)),
    openCard: (guestId: string) => openCard(guestId),
  };
  // Wave 48b (C13): the censor's dial, only here (she has to find it).
  const filterItem = filter.view !== null ? filterStartItem(() => setLayer({ kind: "strength" })) : null;
  const voiceItem = voiceStartItem(voice);
  const start = player
    ? playerStartItems({
        character,
        wake,
        embedded: host.embedded,
        credits: creditsStartItem(s.view?.night?.credits, () => credits.set(Date.now())),
        filter: filterItem,
        voice: voiceItem,
        aloud: aloudStartItem(aloud),
        onHelp: () => setHelp(true),
        onSheet: setSheet,
        onPeople: () => setPeopleOpen(true),
        onSignOut: () => {
          push.release();
          s.leave();
          onLeave();
        },
      })
    : boothStartItems({
    character,
    admin,
    host: isHost,
    knows: s.view?.codex?.length ?? 0,
    wake,
    embedded: host.embedded,
    filter: filterItem,
    voice: voiceItem,
    aloud: aloudStartItem(aloud),
    onHelp: () => setHelp(true),
    onSheet: setSheet,
    onSignOut: () => {
      push.release();
      s.leave();
      onLeave();
    },
  });

  return (
    <FilterGameContext.Provider value={filter.game}>
    <MomentsProvider {...moments}>
      <AvatarsContext.Provider value={avatars}>
        <WalletActionsProvider value={{ view: s.view?.wallet ?? null, me: null, clock: walletClock, approve: (id) => void s.walletApprove(id), deny: (id) => void s.walletDeny(id) }}>
          <BoothBadgesProvider guests={s.view?.guests}>
          <div className="root">
            <BoothFrame clocked={showClockOf(s.view) !== null || soonest(s.view?.countdowns, s.view?.clock ?? null) !== null} alarmed={(wanted !== null && loose > 0) || rung.tray.length + rung.queued > 0} windowed={player || hostWins}>
              {(keyboard) => (
                <HostConsole session={s} wide={wide} openCard={(id) => openCard(id)} openWanted={openBoard} enabled={hostWins} showing={hostShown === "show"} onShow={() => hostTap("show")} keyboardOpen={keyboard}>
              {player ? (
                missionNews !== null ? (
                  // C7: the blink is the existing `.title-bar.flash` (4 × 0.5 s); its line reads "NEW MISSION · …".
                  <TitleBar
                    objectives={s.view?.objectives}
                    fallback={s.view?.title ?? s.auth?.title ?? character}
                    onOpen={() => playerTap("mission")}
                    sub={s.view?.mission?.place != null ? `📍 ${s.view.mission.place}` : undefined}
                    paused={viewPaused(s.view)}
                    act={pwin === "mission" && t.activeId === null ? missionLine(s.view?.objectives) : undefined}
                    // Wave 47: the card under it names the mission; the blink says only that it is new.
                    flash={{ id: missionNews.id, title: missionNews.title, brief: "NEW MISSION" }}
                  />
                ) : (
                  <NowBar
                    objectives={s.view?.objectives}
                    fallback={s.view?.title ?? s.auth?.title ?? character}
                    onOpen={() => playerTap("mission")}
                    sub={s.view?.mission?.place != null ? `📍 ${s.view.mission.place}` : undefined}
                    paused={viewPaused(s.view)}
                    act={pwin === "mission" && t.activeId === null ? missionLine(s.view?.objectives) : undefined}
                  />
                )
              ) : hostShown === "show" ? null : (
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
                row={nowRowOf()}
                rowActions={nowActions}
              />
              )}
              {/* The sticky banner flows under the NOW card (the booth's title bar). */}
              <MomentsLayer />
              {/* Wave 41 (C3): the letter opt-in, on the booth's home only, never over a scan. */}
              {letterOnHome({ player, mission: pwin === "mission", host: hostWins, showOnScreen: hostShown === "show", wide, roomOpen: t.activeId !== null, scanning: layer?.kind === "scan" }) && (
                <LetterCard letter={s.view?.letter} eventId={s.auth?.eventId ?? ""} character={character} save={s.letter} startOpen={wide} />
              )}
              <Shell side={side} stage={stage} wide={wide} placeholder={player ? "Pick a chat, or follow your mission." : "Pick a room — or 📷 Scan a pass."} />
              {/* No `hidden` here: the dock owns its keyboard rule. With the
                  keyboard up the slim NEXT bar steps aside, but the award
                  picker and *Fire anyway?* stay. */}
              {/* Wave 18 (§2.2 rule 5): a pop-out floats just above the dock, no scrim. */}
              <div className="booth-popout-anchor">
                <PopOutHost />
              </div>
              <div className="booth-dock">
                {/* Wave 21 (P1, P7): a player gets neither the cue bar nor the host dock. */}
                {!player && <CueBar session={s} now={storyMs} countdowns={s.view?.countdowns} armRef={armCue} onFired={(at) => (ownFire.current = at)} />}
                {hostWins && <HostDock session={s} wide={wide} openCard={(id) => openCard(id)} openWanted={openBoard} />}
              </div>
              {!keyboard && (
                <Taskbar
                  start={start}
                  startHeader={<StartHeader s={s} />}
                  /* The plain booth's Scan title: DRAFT w58. */
                  buttons={player ? playerTaskbarButtons({ pressed: t.activeId === null || wide ? pwin : null, chatsDot: pChats !== null && chatsDot(pChats), scanOpen: layer?.kind === "scan", mission: () => playerTap("mission"), chats: () => playerTap("chats"), scan: () => setLayer({ kind: "scan" }) }) : hostWins ? hostTaskbarButtons({ pressed: hostShown, chatsBadge: waiting, scanOpen: layer?.kind === "scan", open: hostTap, scan: () => setLayer({ kind: "scan" }) }) : [
                    { id: "scan", label: "Scan", icon: <Icon name="scan" />, primary: true, title: "Scan a pass or a codex QR", tour: "scan", onClick: () => setLayer({ kind: "scan" }), active: layer?.kind === "scan" },
                    { id: "guests", label: "Guests", icon: <Icon name="people" />, title: `Every guest (${guests.length}), searchable`, tour: "guests", badge: waiting, onClick: () => setLayer({ kind: "guests" }), active: layer?.kind === "guests" },
                  ]}
                  tray={<BoothTray view={s.view} onWallet={() => t.open(WALLET_ROOM)} loose={wanted !== null && (!player || claimer) ? loose : null} waiting={popOutWaiting(rung)} onBoard={openBoard} onWaiting={() => setLayer({ kind: "waiting" })} filter={filter.view !== null ? filter.waiting.length : null} onFilter={() => setLayer({ kind: "filter" })} windowed={player || hostWins} />}
                  conn={s.connected ? "live" : "reconnecting"}
                />
              )}
                </HostConsole>
              )}
            </BoothFrame>
            <PopOutDriver
              session={s}
              open={openers}
              now={storyMs}
              placeTitle={placeTitle}
              ownFireAt={() => ownFire.current}
              targetKey={targetKey}
              // C7: Mission on screen (or this objective's PLAYER SELECT) is the instruction: no pop-out, a blink + chime.
              missionShown={(id) => (player && pwin === "mission" && layer === null && t.activeId === null) || (layer?.kind === "pick" && layer.objective === id)}
              onMissionNews={(o) => setMissionNews({ id: o.id, title: o.title })}
              filter={filter}
              filterOpen={layer?.kind === "filter"}
            />
            {layer?.kind === "scan" && (
              <ScannerScreen session={s} admin={admin} gate={passGate} caption={layer.caption} onBoard={openBoard} onClose={closeLayer} onOpenThread={openThread} onPress={noteOwnFire} onOpenCodex={openCodex}
                // C3: 📷 Next guest is door work: an Antivirus at the door, or a scan opened from the Door queue.
                queue={mayPress(s.view?.interactions, "claim_door", character) || layer.back?.kind === "door"}
                onCardGuest={(id) => {
                  cardGuest.current = guestByName(id)?.id ?? id;
                  // The scan landed: the "Scan Winamp's pass" caption has done its job (BN-F16); where it goes back to stays.
                  setLayer((l) => (l?.kind === "scan" && l.caption !== undefined ? { kind: "scan", ...(l.back !== undefined ? { back: l.back } : {}) } : l));
                }} />
            )}
            {layer?.kind === "guests" && <GuestsSheet view={s.view} me={character} session={token} now={storyMs} onPick={(id) => openCard(id)} onClose={closeLayer} />}
            {layer?.kind === "card" && (
              <GuestCard key={layer.id} session={s} guestId={layer.id} seed={layer.seed} admin={admin} confront={layer.confront} onBoard={openBoard} onClose={closeLayer} onOpenThread={() => openThread(layer.id)} onPress={noteOwnFire} />
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
                {...(layer.memo !== undefined ? { memo: layer.memo } : {})}
                claimedAt={(id) => claimSeen.current.get(id)?.at ?? null}
                onClaim={(id) => s.act("claim_escort", id)}
                onRelease={(id) => s.act("release_escort", id)}
                onTakeOver={(id) => s.act("take_over_escort", id)}
                onScan={(id, name) => openScan(id, name)}
                onCard={(id) => openCard(id)}
                onClose={closeLayer}
              />
            )}
            {layer?.kind === "pick" && (() => {
              const live = (s.view?.objectives ?? []).find((x) => x.id === layer.objective) as BoothObjective | undefined;
              const o = live ?? layer.opened;
              const ints = s.view?.interactions ?? [];
              const press = (id: string, guest: string) => s.act(id, guest);
              return pickLayout(layer.opened, ints) === "steps" ? (
                <>
                  {/* Wave 37 (C4): nothing docks inside PLAYER SELECT (NEW MISSION of the same objective included). */}
                  <PopOutQuiet />
                  <PlayerSelect objective={o} steps={wizardSteps(layer.opened, ints)} guests={guests} press={press} player={player} ended={live === undefined} seed={s.lastPressedOn} onClose={closeLayer} onLater={closeLayer} />
                </>
              ) : (
                <RowsWindow objective={live} opened={layer.opened} interactions={ints} guests={guests} placeTitle={placeTitle} wanted={wanted !== null ? loose : null} press={press} onCard={(id) => openCard(id)} onBoard={openBoard} onClose={closeLayer} />
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
                onClose={closeLayer}
              />
            )}
            {layer?.kind === "waiting" && <WaitingWindow onClose={closeLayer} />}
            {layer?.kind === "filter" && <FilterWindow api={filter} now={storyMs} onClose={closeLayer} />}
            {layer?.kind === "strength" && <FilterStrengthWindow api={filter} onClose={closeLayer} />}
            {filter.view !== null && <FilterBurst burst={filter.burst} onDone={filter.clearBurst} />}
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
                items={(() => {
                  const worn = boothBadgeMap(s.view?.guests);
                  return (people.people ?? []).map((p) => ({ id: p.id, label: p.name, sub: p.group ?? undefined, avatar: true, ...(worn.has(p.id) ? { badges: worn.get(p.id)! } : {}) }));
                })()}
                onPick={(id) => openCard(id)}
                onClose={() => setPeople(null)}
                empty="Nobody is standing here."
              />
            )}
            {peopleOpen && (
              <PeopleSheet
                view={s.view}
                claimer={claimer}
                onPick={(id) => {
                  setPeopleOpen(false);
                  openCard(id);
                }}
                onClose={() => setPeopleOpen(false)}
              />
            )}
            {sheet === "knows" && <KnowsSheet session={s} onClose={() => setSheet(null)} />}
            {sheet === "powers" && <PowersSheet session={s} onClose={() => setSheet(null)} />}
            {sheet === "alerts" && <AlertsSheet session={s} push={push} onClose={() => setSheet(null)} />}
            {help && <StaffHelpSheet onClose={() => setHelp(false)} />}
            {player && s.view?.night?.credits && (
              <CreditsSlot c={credits} credits={s.view.night.credits} clock={s.view.clock} eventId={s.auth.eventId} token={token} auto cover={{ face: creditsFace }} />
            )}
            {aloud.covering && <PopOutQuiet />}
            <AloudSlot a={aloud} sound={host.sound} storage={host.storage} />
          </div>
          </BoothBadgesProvider>
        </WalletActionsProvider>
      </AvatarsContext.Provider>
    </MomentsProvider>
    </FilterGameContext.Provider>
  );
}
