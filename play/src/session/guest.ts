//! The guest session (moved out of `session.ts` in wave 13): the stream,
//! the snapshot, every guest action, echoed choices, the required decision.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PictureChoices } from "../avatars.ts";
import { maxSeqOf, useAlerts, type Alert, type Alerts } from "../alerts.ts";
import { actFromSearch, withoutAct } from "../act-link.ts";
import { checkinFromSearch, withoutCheckin } from "../checkin.ts";
import { rememberClaim, withoutClaim } from "../claim.ts";
import { ApiError, RequestTimeout, api, useChatStream, withTimeout } from "../client.ts";
import { pmChannelId, shareErrorText, unlockFromSearch, withoutUnlock } from "../codex.ts";
import { usePlayHost } from "../host.ts";
import { phoneAnnounce } from "../phone-voice.ts";
import { SessionRole, eventGone, guestSessionDead, lifecycleDropsSession, lifecycleNotice, performerSessionDead } from "../lifecycle.ts";
import { CODEX_ROOM, channelHead } from "../rooms/spaces.ts";
import { roomOrder } from "../rooms/order.ts";
import { useThreads, type Threads } from "../rooms/threads-state.ts";
import { guestDotOf } from "../stream/badges.ts";
import type { ChatMessage, Decision, GuestView } from "../types.ts";
import { echoOf } from "../../../core/src/pick-echo.ts";
import { useTyping } from "../typing.ts";
import { useAgentWait } from "../agent-wait.ts";
import type { WidgetResult } from "../widgets.tsx";
import type { CheckinAnswer, RedeemAnswer, ScanDone } from "../scan-done.tsx";
import { loadScanDone, settled } from "../scan-done-lazy.tsx";
import { buildGuestChannels, withAgents } from "./channels.ts";
import { NO_ANSWERS, mergeAnswered, registerBody, tokenDead, useLandingBrand, usePerSession, useTheme, type ResolvedCode } from "./shared.ts";
import { linkFromMessage, linkFromSearch, navFromSearch, withoutRoom } from "../room.ts";
import { lobbyHidden } from "../guest/wire.ts";
import type { Nav } from "../moments/exits.ts";
import { guestStreamHandlers } from "./stream-handlers.ts";
import { badgeLinkOf, forgetBadge, storedBadge, type BadgeLink } from "../rejoin.ts";
import type { AdoptedGuest } from "../resume.ts";

interface GuestId {
  id: string;
  name: string;
  /** The capability token registration minted — authorizes every guest call.
   *  The public `id` is broadcast in rosters, so it is NOT a credential. */
  token: string;
  /** Which event this guest joined — every call is scoped to `/e/:eventId`. */
  eventId: string;
  /** The event's display title (from `/api/resolve-code`). */
  title?: string;
}

const GK = "loom.guest";

/** The last `!` alert each role's sign-in has seen (alerts.ts). */
const GUEST_ALERTS = "loom.guest.alerts";

/** A guest sign-in's read marks (threads.ts) and echoed choices. */
const GUEST_READ = "loom.guest.read";
const GUEST_ECHO = "loom.guest.echo";
/** How many echoed choices a sign-in keeps. */
const ECHO_CAP = 200;

/** The guest's pick as their own line in the room the choice docked in,
 *  just after everything already there (a half seq, so the story's answer
 *  — the next real message — lands under it). `ts` is story time like every
 *  server message's (`sim.elapsed()`): the newest message's, never the wall
 *  clock, which reads hours ahead of the story. The text reads the way the
 *  server's own `pick` line will (core's `echoOf`: the tag dropped, a deed
 *  as `[shows …]`), so `withEchoes` can swap one for the other. */
export function choiceEcho(channel: string, text: string, me: { id: string; name: string }, afterSeq: number, ts = 0): ChatMessage {
  const echo = echoOf(text);
  return {
    seq: afterSeq + 0.5,
    channel,
    channelKind: channelHead(channel).kind,
    title: channelHead(channel).title,
    from: me.name,
    kind: "line",
    text: echo.text,
    ts,
    audience: [me.id],
    parentSeq: null,
    hidden: false,
    pick: true,
    ...(echo.action ? { act: true as const } : {}),
  };
}

/** The server's pick lines (wave 28), by room + words → the newest seq. Built once per call. */
export type PickIndex = ReadonlyMap<string, number>;
const pickKey = (channel: string, text: string) => `${channel}\u0000${text}`;
export function pickIndexOf(messages: ReadonlyMap<number, ChatMessage>): PickIndex {
  const ix = new Map<string, number>();
  for (const m of messages.values()) {
    if (m.pick !== true) continue;
    const k = pickKey(m.channel, m.text);
    const was = ix.get(k);
    if (was === undefined || m.seq > was) ix.set(k, m.seq);
  }
  return ix;
}

/** Has the server's own `pick` line (wave 28) for this local echo arrived:
 *  a pick line in the same room with the same words, past the echo's spot?
 *  Pass `index` (`pickIndexOf`) when asking for many echoes. */
export function echoAnswered(echo: ChatMessage, messages: ReadonlyMap<number, ChatMessage>, index: PickIndex = pickIndexOf(messages)): boolean {
  const newest = index.get(pickKey(echo.channel, echo.text));
  return newest !== undefined && newest > Math.floor(echo.seq);
}

/** The echoes the server has not answered yet (kept, stored); answered ones are pruned. */
export function unansweredEchoes(messages: ReadonlyMap<number, ChatMessage>, echoes: readonly ChatMessage[]): ChatMessage[] {
  if (echoes.length === 0) return [];
  const ix = pickIndexOf(messages);
  return echoes.filter((e) => !echoAnswered(e, messages, ix));
}

/** The stream with the guest's echoed choices folded in. An echo the
 *  server's own pick line has answered (wave 28) is dropped, never shown twice. */
export function withEchoes(messages: ReadonlyMap<number, ChatMessage>, echoes: readonly ChatMessage[]): Map<number, ChatMessage> {
  const out = new Map(messages);
  for (const e of unansweredEchoes(messages, echoes)) if (!out.has(e.seq)) out.set(e.seq, e);
  return out;
}

/** Which sign-in the stream's messages belong to. Right after a sign-in
 *  switch the stream still holds the previous identity's messages until its
 *  reset lands (always a new map), so `stale` is that map: until it is
 *  replaced, the stream answers none of the new identity's echoes. */
export interface StreamOwner {
  token: string | null;
  stale: ReadonlyMap<number, ChatMessage> | null;
}

/** The owner as of this render: unchanged for the same token, else a new
 *  one that marks the messages on hand (the old identity's) stale. */
export function streamOwnerOf(was: StreamOwner | null, token: string | null, messages: ReadonlyMap<number, ChatMessage>): StreamOwner {
  return was !== null && was.token === token ? was : { token, stale: messages };
}

/** Do these messages belong to the owner's sign-in (not the one before it)? */
export function streamIsOwners(owner: StreamOwner, messages: ReadonlyMap<number, ChatMessage>): boolean {
  return owner.token !== null && messages !== owner.stale;
}

function loadEchoes(load: <T>(key: string) => T | null, token: string | null): ChatMessage[] {
  if (token === null) return [];
  const raw = load<{ session?: unknown; list?: unknown }>(GUEST_ECHO);
  return raw !== null && raw.session === token && Array.isArray(raw.list) ? (raw.list as ChatMessage[]) : [];
}

function saveEchoes(save: (key: string, value: unknown) => void, token: string, list: ChatMessage[]): ChatMessage[] {
  const kept = list.slice(-ECHO_CAP);
  save(GUEST_ECHO, { session: token, list: kept });
  return kept;
}

// --- guest ------------------------------------------------------------------

/** Where a decision docks when it would have docked in the lobby (wave 18,
 *  G2): on Mission, never the Chat log. */
export const MISSION_DOCK = "mission";

/** The menu a pick was made on (D18): its id, and the option's text. */
export interface ChoiceRef {
  id: number;
  text: string;
}

/** `/api/guest/choose`'s body: the menu's id + the option's text when the
 *  dock knew them (the server answers 409 if the menu moved), else the
 *  index alone (an older server's view). */
export function chooseBody(index: number, menu?: ChoiceRef): { index: number; choice?: number; text?: string } {
  return menu === undefined ? { index } : { index, choice: menu.id, text: menu.text };
}

const sameOptions = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, k) => x === b[k]);

/**
 * The one required decision (if any), and where it docks: the room the
 * story names, or Mission when that would be the lobby (G2 — the lobby is
 * the Chat log now, and no decision ever docks there). A captive's escape
 * docks on Mission too. There is no side chooser here any more: the story
 * opens the sides (the doors, the Sides sheet), and joining is a guest's
 * own act there (GUEST-SPEC §9).
 */
export function requiredDecision(
  status: GuestView | null,
  acts: { choose: (i: number, menu?: ChoiceRef) => void; escape: () => void; join?: (f: string) => void },
): { channel: string; decision: Decision } | null {
  if (!status) return null;
  if (status.pendingChoice) {
    const room = status.decisionChannel ?? "lobby";
    // The menu drawn here (D18): its id and each option's text ride the pick.
    const shown = status.choices?.[0];
    const menuId = shown !== undefined && sameOptions(shown.options, status.pendingChoice) ? shown.id : undefined;
    return {
      channel: room === "lobby" ? MISSION_DOCK : room,
      decision: {
        title: "Your move…",
        options: status.pendingChoice.map((opt, i) => ({ label: opt, onClick: () => acts.choose(i, menuId === undefined ? undefined : { id: menuId, text: opt }) })),
      },
    };
  }
  // A captive may break out from the app — unless their prison is sealed
  // (the story lets them out: a performer, a puzzle, a VR duck).
  if (status.captured && status.canEscape !== false) {
    return {
      channel: MISSION_DOCK,
      decision: {
        title: "You've been captured",
        options: [{ label: "🏃 Make a break for it", onClick: () => acts.escape(), tone: "danger" }],
      },
    };
  }
  return null;
}

/** The sides a guest may defect to from the profile sheet: every other
 *  public group, none while restricted (the server answers 403). */
export function defectTargets(status: GuestView | null): string[] {
  if (!status || status.restricted || !status.faction) return [];
  return (status.factions ?? []).filter((f) => f !== status.faction);
}

/** Wave 26 (R1, C2): the server refused because this phone is locked
 *  (`403 {"error":"locked"}`). The app shows the lock screen — never a toast. */
export function lockedRefusal(e: unknown): boolean {
  return e instanceof ApiError && e.status === 403 && e.message === "locked";
}

/** How long a typed line waits for the server before the composer gives
 *  the Send button back (the words stay in the box). */
export const SAY_TIMEOUT_MS = 15_000;

/** Why a typed message didn't go through, for a quiet banner — the server
 *  names the reason (slow mode's wait, paused doors, a room you can't post
 *  in), and the composer keeps the words so the guest can send them again.
 *  `null` for a session the app is dropping anyway (401, or the unknown-token
 *  404s), which explains itself on the join screen. */
export function sayRefusalText(e: unknown): string | null {
  if (lockedRefusal(e)) return null;
  if (e instanceof RequestTimeout) return "⚠️ No answer yet — check your connection. If your line doesn't show up in the room, send it again.";
  if (!(e instanceof ApiError)) return "⚠️ Not sent — check your connection and try again.";
  if (eventGone(e.status, e.message) || guestSessionDead(e.status, e.message) || performerSessionDead(e.status, e.message)) return null;
  if (e.status === 429) return `⏳ Not sent: ${e.message}. Your message is still in the box.`;
  if (e.status === 409 && /doors are closed/i.test(e.message)) return "⏸ Not sent: the show is paused. Your message is still in the box.";
  if (e.status === 413) return `✂️ Not sent: ${e.message}. Your message is still in the box — shorten it and send again.`;
  return `⛔ Not sent: ${e.message}`;
}

/** What a guest sees after pressing one of the story's buttons: the
 *  story's reply to them, else a plain acknowledgement of the button. */
export function actFeedback(replies: readonly string[] | undefined, label?: string): string {
  const said = (replies ?? []).map((r) => r.trim()).filter((r) => r !== "");
  if (said.length > 0) return said.join(" ");
  return label ? `✔ ${label}` : "✔ Done.";
}

const NONE_OPENED: ReadonlySet<string> = new Set();

export interface GuestSession {
  me: GuestId | null;
  status: GuestView | null;
  /** Wave 26 (R1, C2): the phone is locked — the view says so, or a write
   *  just came back `403 locked` (until the next snapshot). */
  locked: boolean;
  connected: boolean;
  /** The backlog has loaded — the rooms list is real, not a placeholder. */
  ready: boolean;
  /** Why the last session ended under us (the run restarted / went live /
   *  ended) — shown on the join screen until the guest registers again. */
  notice: string | null;
  threads: Threads;
  /** Join as `name` — a program from the picker, or (`wiki`) a directory
   *  title; `claim` = an invitation's token for a reserved program. */
  register: (name: string, code: string, wiki?: string, picture?: string, claim?: string | null) => Promise<void>;
  /** The pictures this guest may switch to (their program's options). */
  pictures: () => Promise<PictureChoices>;
  /** Switch to one of those pictures (a serving key). */
  setPicture: (key: string) => Promise<PictureChoices>;
  join: (faction: string) => Promise<unknown>;
  defect: (to: string) => Promise<unknown>;
  choose: (index: number) => Promise<unknown>;
  escape: () => Promise<unknown>;
  /** Fire one of the story's `who: guest` interactions for yourself; the
   *  story's reply (if any) banners, so it is never lost in the lobby. */
  act: (name: string, label?: string) => Promise<unknown>;
  /** Hybrid chat: type into a channel (a reply carries the root's seq). */
  say: (channel: string, text: string, parentSeq?: number) => Promise<unknown>;
  /** Access control: pull another participant into a membership-gated channel. */
  inviteToChannel: (person: string, channel: string) => Promise<unknown>;
  /** Leave a membership-gated channel. */
  leaveChannel: (channel: string) => Promise<unknown>;
  /** Codex: type (or scan) an unlock code. Resolves to the server's answer
   *  (a hit, a code already held, a miss); rejects with the refusal. */
  redeem: (code: string) => Promise<RedeemAnswer>;
  /** The link of the printed code a typed one is, or null (wave 59). */
  printed: (code: string) => Promise<string | null>;
  /** Check in at a room's sign (its slug, K-13). Resolves to the server's
   *  answer (the story may still keep the guest out: `moved: false`);
   *  rejects with the refusal (captured, on rails, a room not open yet) —
   *  wave 18b: the 📷 sheet says it, so nothing is swallowed here. */
  checkin: (at: string) => Promise<CheckinAnswer>;
  /** The "scan done" dialog up now (wave 18b, R1), until `clearScan`. */
  scanDone: ScanDone | null;
  /** Show the dialog (the app lands on its `go` first). A check-in's reply
   *  lines are recorded as the guest's own answer, so the moments layer
   *  drops the balloon that repeats them. */
  showScan: (done: Omit<ScanDone, "id">) => void;
  clearScan: () => void;
  /** Codex: hand an entry you hold to another participant or a listed character. */
  shareCodex: (entry: string, to: string) => Promise<unknown>;
  /** The wallet (a story with a `currency:`): every call posts to its route;
   *  the server's refusal (insufficient funds, too late…) banners quietly. */
  wallet: {
    send(to: string, amount: number): Promise<unknown>;
    request(from: string, amount: number): Promise<unknown>;
    respond(id: string, accept: boolean): Promise<unknown>;
    offer(to: string, entry: string, side: "buy" | "sell", amount: number): Promise<unknown>;
    accept(id: string): Promise<unknown>;
    decline(id: string): Promise<unknown>;
    cancel(id: string): Promise<unknown>;
    stimulus(amount: number): Promise<unknown>;
    /** The minter's reserve: mint `amount` into one program's account. */
    grant(to: string, amount: number): Promise<unknown>;
    /** The minter's reserve: freeze one program's outgoing coin. */
    freeze(to: string): Promise<unknown>;
    approve(id: string): Promise<unknown>;
    deny(id: string): Promise<unknown>;
  };
  /** Open (creating if needed) a private thread with a guest, or a DM with a character. */
  message: (person: { id: string; kind: "guest" | "character" }) => void;
  /** The alert broadcast that just landed, until dismissed. */
  alert: Alert | null;
  dismissAlert: () => void;
  /** The session's whole `useAlerts` state (wave 13: the moments layer reads it). */
  alerts: Alerts;
  /** Answer a widget card (a CAPTCHA, a poll) the story showed you. */
  answerWidget: (seq: number, result: WidgetResult) => Promise<void>;
  /** Answers given this session, by card seq (the card renders resolved). */
  widgetAnswers: ReadonlyMap<number, WidgetResult>;
  /** Every message delivered to this guest, by seq (the raw stream the
   *  threads are built from — a cutscene reads what is addressed to them). */
  messages: ReadonlyMap<number, ChatMessage>;
  leave: () => void;
  /** Wave 23: become a guest session minted elsewhere (a badge, an
   *  invitation, a host's approval) — the same Person, a fresh token. */
  adopt: (guest: AdoptedGuest) => void;
  /** Wave 23: link a printed badge (scanned or opened) to this guest. */
  linkBadge: (badge: string) => Promise<BadgeLink>;
  /** A notification's link, resolved to where it lands (§6.4), until the
   *  app takes it (`takeLinkNav`) once it is in the app. */
  linkNav: Nav | null;
  takeLinkNav: () => void;
  /** The decision waiting on the guest and where it docks (`MISSION_DOCK`
   *  when it would have been the lobby). */
  decision: { channel: string; decision: Decision } | null;
  /** Wave 18 sides + crews (CONTRACTS C10): each rejects with the server's
   *  reason (an `ApiError`), which the sheet shows. */
  sides: SidesCalls;
}

/** The C10 routes, guest side. */
export interface SidesCalls {
  join(side: string): Promise<unknown>;
  defect(to: string): Promise<unknown>;
  leave(): Promise<unknown>;
  recruit(to: string, side?: string): Promise<unknown>;
  answer(id: string, yes: boolean): Promise<unknown>;
  found(name: string): Promise<{ ok: boolean; crew?: { id: string; name: string } }>;
  invite(to: string): Promise<unknown>;
  /** A founder's leave disbands the faction (wave 18b: `dissolved: true`). */
  leaveCrew(): Promise<{ ok: boolean; dissolved?: boolean }>;
  /** Wave 18b, faction mode: walk into a founded faction from the list. */
  joinCrew(crew: string): Promise<unknown>;
}

/**
 * SW-PLAY-20, wave 18 (§6.4): a tapped notification's `?room=` (a fresh
 * window) or the service worker's `open-room` message (one already open)
 * becomes a `Nav` once signed in with the backlog in — the lobby lands on
 * Mission, an unlisted room on Mission, never a room the guest can't see.
 */
function useGuestLinks(signedIn: boolean, listed: readonly string[], lobbyHidden = false): { nav: Nav | null; take: () => void } {
  const { ownsPage } = usePlayHost();
  // The link waiting to land: its query (`?room=…&entry=…`, `?go=pass`).
  const [want, setWant] = useState<string | null>(() => (ownsPage ? linkFromSearch(window.location.search) : null));
  const [nav, setNav] = useState<Nav | null>(null);
  useEffect(() => {
    if (!ownsPage) return;
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (sw === undefined) return;
    const on = (e: MessageEvent) => {
      const link = linkFromMessage(e.data);
      if (link !== null) setWant(link);
    };
    sw.addEventListener("message", on);
    try {
      sw.startMessages();
    } catch {
      /* fine */
    }
    return () => sw.removeEventListener("message", on);
  }, [ownsPage]);
  useEffect(() => {
    if (want === null || !signedIn) return;
    setWant(null);
    if (ownsPage && linkFromSearch(window.location.search) !== null) {
      try {
        window.history.replaceState(null, "", `${window.location.pathname}${withoutRoom(window.location.search)}`);
      } catch {
        /* fine */
      }
    }
    setNav(navFromSearch(want, listed, lobbyHidden));
    // `listed` is rebuilt each render; the request is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want, signedIn]);
  const take = useCallback(() => setNav(null), []);
  return { nav, take };
}

export function useGuestSession(): GuestSession {
  const host = usePlayHost();
  const { load, save, drop } = host.storage;
  const crawl = host.crawl;
  const [me, setMe] = useState<GuestId | null>(() => {
    const stored = load<GuestId>(GK);
    // A pre-token session can't authorize any call — drop it so the guest
    // re-registers cleanly rather than staring at 401s.
    if (stored && !stored.token) {
      drop(GK);
      return null;
    }
    if (stored && !stored.eventId) stored.eventId = "default"; // migrate pre-multi-event sessions
    return stored;
  });
  const [status, setStatus] = useState<GuestView | null>(null);
  // Wave 26 (R1): a `403 locked` answer locks the screen until the next snapshot says.
  const [locked403, setLocked403] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const base = me ? `/e/${encodeURIComponent(me.eventId)}` : "";
  // EventSource can't set headers, so the capability token rides the URL.
  const url = me ? `${base}/events?role=guest&token=${encodeURIComponent(me.token)}` : null;
  /** The run restarted / went live / ended: this session is dead server-side
   *  (every restart clears guest tokens), so drop it and say why. */
  const dropSession = useCallback((why: string | null) => {
    drop(GK);
    setMe(null);
    setStatus(null);
    setReady(false);
    setNotice(why);
    host.onEnded("guest", why);
  }, [drop, host]);
  // `!` alerts: the mark of the last one seen survives a reconnect's
  // history replay, so one that landed while the screen was off banners on
  // wake (see alerts.ts). The hook needs the stream's messages, the stream
  // needs the hook's `onHistory` — a ref breaks the cycle.
  const alertsRef = useRef<ReturnType<typeof useAlerts> | null>(null);
  const { typing, onTyping } = useTyping(me !== null ? { role: "guest" } : null);
  const { waits, onAgentWait, onWaitsReset } = useAgentWait(me?.id ?? null);
  const { messages, connected } = useChatStream(url, {
    onSnapshot: (v) => {
      setStatus(v as GuestView);
      setLocked403(false);
    },
    onTyping,
    onAgentWait,
    onWaitsReset,
    onAnnounce: (n) => phoneAnnounce(host, n),
    // The crawl decides at arrival (wave 13: a no-op until the stream lane)
    // and the backlog sets its baseline (stream-handlers.ts).
    ...guestStreamHandlers(crawl, me, (list) => {
      alertsRef.current?.onHistory(list);
      setReady(true);
    }),
    onLifecycle: (n) => {
      if (lifecycleDropsSession(n.kind, SessionRole.Guest)) dropSession(lifecycleNotice(n.kind, SessionRole.Guest));
    },
    // The stream closed for good (a dead token — or the proxy's 502 while
    // the server restarts): ask the server. Alive reopens the stream; a run
    // that forgot this token (a restart we slept through) or an event that
    // is gone drops the session and says why.
    probe: () => (me === null ? Promise.resolve(null) : tokenDead(base, "guest", me.token)),
    onDead: (dead) => {
      if (dead) dropSession(lifecycleNotice(dead, SessionRole.Guest));
    },
  });
  const alerts = useAlerts({
    messages,
    clock: status?.clock,
    session: me?.token ?? null,
    storage: host.storage,
    storageKey: GUEST_ALERTS,
    sound: host.sound,
  });
  alertsRef.current = alerts;
  const alert: Alert | null = alerts.alert;

  // Every action is scoped to the event the guest joined (`/e/:eventId/...`)
  // and carries the guest's capability token — the server derives who is
  // acting from the token, never from a client-supplied id. A 401 / "unknown
  // guest" 404 means the run restarted while this phone wasn't listening.
  const post = useCallback(
    async <T,>(path: string, body?: unknown): Promise<T> => {
      try {
        return await api<T>(`${base}${path}`, body, me?.token);
      } catch (e) {
        // Only explain a session we are dropping right now — never overwrite
        // the notice of one a `lifecycle` frame already dropped.
        if (lockedRefusal(e)) setLocked403(true);
        if (e instanceof ApiError && me !== null) {
          if (eventGone(e.status, e.message)) dropSession(lifecycleNotice("ended", SessionRole.Guest));
          else if (guestSessionDead(e.status, e.message)) dropSession(lifecycleNotice("reset", SessionRole.Guest));
        }
        throw e;
      }
    },
    [base, me, dropSession],
  );

  const join = useCallback((faction: string) => post("/api/guest/join", { faction }), [post]);
  const defect = useCallback((to: string) => post("/api/guest/defect", { to }), [post]);
  // The guest's own pick, echoed into the thread as their bubble at once,
  // so the story's answer never reads as a non sequitur. Since wave 28 the
  // server posts the pick as a real line too; `withEchoes` then drops the
  // echo and the effect below prunes it from storage. Kept per sign-in so a
  // reload against an older server keeps it.
  const [echoes, setEchoes] = useState<ChatMessage[]>(() => loadEchoes(load, me?.token ?? null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setEchoes(loadEchoes(load, me?.token ?? null)), [me?.token]);
  const pendingRef = useRef<{ options: string[] | null; channel: string; menus: GuestView["choices"] }>({ options: null, channel: "lobby", menus: undefined });
  pendingRef.current = { options: status?.pendingChoice ?? null, channel: status?.decisionChannel ?? "lobby", menus: status?.choices };
  const choose = useCallback(
    async (index: number, menu?: ChoiceRef) => {
      const { options, menus } = pendingRef.current;
      // The menu's own room when the view names it (the server posts its pick line there).
      const channel = (menu !== undefined ? menus?.find((c) => c.id === menu.id)?.channel : undefined) ?? pendingRef.current.channel;
      const text = menu?.text ?? options?.[index];
      const last = maxSeqOf(messages.values());
      const echo = text !== undefined && me !== null ? choiceEcho(channel, text, me, last, messages.get(last)?.ts ?? 0) : null;
      if (echo !== null) {
        crawl.claim(echo.seq); // your own words never crawl
        setEchoes((prev) => saveEchoes(save, me!.token, [...prev, echo]));
      }
      try {
        return await post("/api/guest/choose", chooseBody(index, menu));
      } catch (e) {
        if (echo !== null) setEchoes((prev) => saveEchoes(save, me!.token, prev.filter((m) => m.seq !== echo.seq)));
        throw e;
      }
    },
    [post, me, messages, crawl, save],
  );
  // Prune (and stop storing) every echo the server's own pick line has answered,
  // but only against this sign-in's own stream: right after a switch the
  // messages are still the previous identity's (`streamOwnerOf`).
  const owner = useRef<StreamOwner | null>(null);
  owner.current = streamOwnerOf(owner.current, me?.token ?? null, messages);
  useEffect(() => {
    if (me === null || !streamIsOwners(owner.current!, messages)) return;
    setEchoes((prev) => {
      const kept = unansweredEchoes(messages, prev);
      return kept.length === prev.length ? prev : saveEchoes(save, me.token, kept);
    });
  }, [messages, me, save]);
  const shown = useMemo(() => withEchoes(messages, echoes), [messages, echoes]);
  // The stream as of the last render, for callbacks that must not re-bind on every message.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const escape = useCallback(() => post("/api/guest/escape", {}), [post]);
  const act = useCallback(
    async (name: string, label?: string) => {
      const r = await post<{ ok: boolean; replies?: string[] }>("/api/guest/act", { name });
      alertsRef.current?.raise(actFeedback(r.replies, label), { quiet: true });
      return r;
    },
    [post],
  );
  // A refused line banners why and rejects, so the composer keeps the text.
  const say = useCallback(
    async (channel: string, text: string, parentSeq?: number) => {
      try {
        return await withTimeout(post("/api/guest/say", { channel, text, parentSeq }), SAY_TIMEOUT_MS);
      } catch (e) {
        const why = sayRefusalText(e);
        if (why !== null) alertsRef.current?.raise(why, { quiet: true });
        throw e;
      }
    },
    [post],
  );
  const register = useCallback(async (name: string, code: string, wiki?: string, picture?: string, claim?: string | null) => {
    // Resolve the short event code to its event, then register there.
    const { eventId, title } = await api<ResolvedCode>("/api/resolve-code", { code });
    // Wave 23: a blank badge scanned on the way in links to this program.
    const badge = storedBadge(host.storage, code);
    const r = await api<{ id: string; name: string; token: string }>(
      `/e/${encodeURIComponent(eventId)}/api/guest/register`,
      { ...registerBody(name, code, wiki, picture, claim), ...(badge !== null ? { badge } : {}) },
    );
    forgetBadge(host.storage);
    const m: GuestId = { id: r.id, name: r.name, token: r.token, eventId, title };
    crawl.reset();
    save(GK, m);
    setMe(m);
    setNotice(null);
    // Kept for a re-join after a cut session (beside loom.guest, the
    // guest's own secret)…
    rememberClaim(host.storage, code, claim);
    // …and out of the address bar once in.
    if (claim && host.ownsPage) {
      try {
        window.history.replaceState(null, "", `${window.location.pathname}${withoutClaim(window.location.search)}`);
      } catch {
        /* fine */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pictures = useCallback(() => post<PictureChoices>("/api/guest/picture", {}), [post]);
  const setPicture = useCallback((picture: string) => post<PictureChoices>("/api/guest/picture", { picture }), [post]);
  const leave = useCallback(() => {
    drop(GK);
    setMe(null);
    setStatus(null);
    setReady(false);
    setNotice(null);
    host.onEnded("guest", null);
  }, [drop, host]);

  const adopt = useCallback(
    (guest: AdoptedGuest) => {
      const m: GuestId = { id: guest.id, name: guest.name, token: guest.token, eventId: guest.eventId, ...(guest.title !== undefined ? { title: guest.title } : {}) };
      crawl.reset();
      save(GK, m);
      setMe(m);
      setNotice(null);
    },
    [crawl, save],
  );
  const linkBadge = useCallback(
    async (badge: string): Promise<BadgeLink> => {
      try {
        const r = await post<Record<string, unknown>>("/api/guest/badge", { badge });
        forgetBadge(host.storage);
        return badgeLinkOf(200, r) ?? { kind: "unknown" };
      } catch (e) {
        const hit = e instanceof ApiError ? badgeLinkOf(e.status, e.data) : null;
        if (hit !== null) return hit;
        throw e;
      }
    },
    [post],
  );

  const inviteToChannel = useCallback(
    (person: string, channel: string) => post("/api/guest/channel/invite", { person, channel }),
    [post],
  );
  const leaveChannel = useCallback((channel: string) => post("/api/guest/channel/leave", { channel }), [post]);

  // --- codex + people ---
  const redeem = useCallback((code: string) => post<RedeemAnswer>("/api/guest/codex/redeem", { code }), [post]);
  const printed = useCallback((code: string) => post<{ hit: { url: string } | null }>("/api/guest/printed", { code }).then((r) => r.hit?.url ?? null), [post]);
  // The "scan done" dialog: one at a time, the newest wins.
  const [scanDone, setScanDone] = useState<ScanDone | null>(null);
  const scanIds = useRef(0);
  const showScan = useCallback((done: Omit<ScanDone, "id">) => {
    if (done.go.to === "room") for (const line of done.body.split("\n")) alertsRef.current?.raise(line, { quiet: true, silent: true });
    scanIds.current += 1;
    setScanDone({ ...done, id: scanIds.current });
  }, []);
  const clearScan = useCallback(() => setScanDone(null), []);
  // A refused share banners the server's reason (and resolves null), so it
  // never looks like a share that worked.
  const shareCodex = useCallback(
    async (entry: string, to: string): Promise<unknown> => {
      try {
        return await post("/api/guest/codex/share", { entry, to });
      } catch (e) {
        const why = lockedRefusal(e) ? null : shareErrorText(e);
        if (why !== null) alertsRef.current?.raise(why, { quiet: true });
        return null;
      }
    },
    [post],
  );
  // The wallet routes: the server's refusal is the whole story (it names
  // the reason), so it banners quietly instead of throwing at a button.
  const walletCall = useCallback(
    async (sub: string, body: Record<string, unknown>): Promise<unknown> => {
      try {
        return await post(`/api/guest/wallet/${sub}`, body);
      } catch (e) {
        if (e instanceof ApiError) {
          if (!lockedRefusal(e)) alertsRef.current?.raise(e.message, { quiet: true });
          return null;
        }
        throw e;
      }
    },
    [post],
  );
  const wallet = useMemo(
    () => ({
      send: (to: string, amount: number) => walletCall("send", { to, amount }),
      request: (from: string, amount: number) => walletCall("request", { from, amount }),
      respond: (id: string, accept: boolean) => walletCall("respond", { id, accept }),
      offer: (to: string, entry: string, side: "buy" | "sell", amount: number) => walletCall("offer", { to, entry, side, amount }),
      accept: (id: string) => walletCall("accept", { id }),
      decline: (id: string) => walletCall("decline", { id }),
      cancel: (id: string) => walletCall("cancel", { id }),
      stimulus: (amount: number) => walletCall("stimulus", { amount }),
      grant: (to: string, amount: number) => walletCall("grant", { to, amount }),
      freeze: (to: string) => walletCall("freeze", { to }),
      approve: (id: string) => walletCall("approve", { id }),
      deny: (id: string) => walletCall("deny", { id }),
    }),
    [walletCall],
  );
  // A wall QR's link carries `?unlock=<code>`: redeem it once we're signed
  // in and the doors are open, then drop it from the URL so a reload
  // doesn't try again.
  const [openCodex, setOpenCodex] = useState(false);
  const pendingUnlock = useRef<string | null>(host.ownsPage ? unlockFromSearch(window.location.search) : null);
  useEffect(() => {
    const code = pendingUnlock.current;
    if (code === null || me === null || status === null) return;
    pendingUnlock.current = null;
    try {
      window.history.replaceState(null, "", `${window.location.pathname}${withoutUnlock(window.location.search)}`);
    } catch {
      /* fine */
    }
    // A hit or a code already held: the dialog, on its entry. A miss opens
    // the Codex, where the room's own ⛔ row says so.
    void Promise.all([loadScanDone(), settled(redeem(code))]).then(
      ([m, a]) => {
        // A locked phone (403 locked) shows the lock screen, never a toast (C2).
        if ("e" in a) return lockedRefusal(a.e) ? undefined : alertsRef.current?.raise(m.scanErrorNote(a.e, "unlock"), { quiet: true });
        const o = m.redeemOutcome(a.r);
        if ("done" in o) showScan(o.done);
        else setOpenCodex(true);
      },
      () => setOpenCodex(true),
    );
  }, [me, status, redeem, showScan]);

  // Widgets: one answer per card. The server refuses a second (409), and
  // the snapshot lists the cards already answered so a reload renders them
  // resolved (the result itself isn't replayed — an empty record marks it).
  // Per sign-in: a new session (a re-join after a restart) starts clean (B2).
  const [widgetAnswers, setWidgetAnswers] = usePerSession(me?.token ?? null, NO_ANSWERS);
  const answeredList = status?.answered;
  useEffect(() => {
    if (answeredList === undefined || answeredList.length === 0) return;
    setWidgetAnswers((prev) => {
      if (answeredList.every((seq) => prev.has(seq))) return prev;
      const next = new Map(prev);
      for (const seq of answeredList) if (!next.has(seq)) next.set(seq, {});
      return next;
    });
  }, [answeredList]);
  // The same, in this render: the state above lands a render later, after
  // the children's effects (the moments sweep) have run.
  const answeredNow = useMemo(() => mergeAnswered(widgetAnswers, answeredList), [widgetAnswers, answeredList]);
  const answerWidget = useCallback(
    async (seq: number, result: WidgetResult) => {
      setWidgetAnswers((prev) => new Map(prev).set(seq, result));
      // An invitation was answered on its own route (`recruit/answer`), which
      // settles the card server-side: no second post (GN-F10's 409).
      if (messagesRef.current.get(seq)?.widget?.kind === "invite") return;
      try {
        await post("/api/guest/widget", { seq, result });
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) {
          setWidgetAnswers((prev) => {
            const next = new Map(prev);
            next.delete(seq);
            return next;
          });
        }
        throw e;
      }
    },
    [post],
  );

  const [opened, setOpened] = usePerSession(me?.token ?? null, NONE_OPENED);
  const dock = requiredDecision(status, { choose: (i, m) => void choose(i, m), escape: () => void escape() });
  const threads = useThreads(
    withAgents(buildGuestChannels(shown, dock, status, opened, new Set(answeredNow.keys())), status, typing, waits),
    { store: host.storage, slot: GUEST_READ, session: me?.token ?? null },
    { me: me !== null ? { id: me.id, name: me.name, booth: false } : undefined, unread: guestDotOf, order: roomOrder },
  );
  const message = useCallback(
    (person: { id: string; kind: "guest" | "character" }) => {
      if (me === null) return;
      const id = person.kind === "character" ? `dm:${person.id}` : pmChannelId(me.id, person.id);
      setOpened((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      threads.open(id);
    },
    [me, threads],
  );
  // A wall QR's code missed: open the Codex, where its ⛔ row says so.
  useEffect(() => {
    if (!openCodex) return;
    setOpenCodex(false);
    threads.open(CODEX_ROOM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCodex]);
  const checkin = useCallback((at: string) => post<CheckinAnswer>("/api/guest/checkin", { at }), [post]);
  // A room's sign carries `?checkin=<slug>` (K-13): check in once signed in
  // with the doors open, then open that room's chat — or banner why not
  // (captured, still on rails, a room the story hasn't opened yet).
  const pendingCheckin = useRef<string | null>(host.ownsPage ? checkinFromSearch(window.location.search) : null);
  useEffect(() => {
    const at = pendingCheckin.current;
    if (at === null || me === null || status === null) return;
    pendingCheckin.current = null;
    try {
      window.history.replaceState(null, "", `${window.location.pathname}${withoutCheckin(window.location.search)}`);
    } catch {
      /* fine */
    }
    // In: the dialog over the room. Kept out (by the story or the server):
    // a quiet banner says why.
    void Promise.all([loadScanDone(), settled(checkin(at))]).then(
      ([m, a]) => {
        // A locked phone (403 locked) shows the lock screen, never a toast (C2).
        if ("e" in a) return lockedRefusal(a.e) ? undefined : alertsRef.current?.raise(m.scanErrorNote(a.e, "checkin"), { quiet: true });
        const o = m.checkinOutcome(a.r);
        if ("done" in o) showScan(o.done);
        else alertsRef.current?.raise(o.note, { quiet: true });
      },
      () => {},
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, status, post]);
  // A printed sign carries `?act=<interaction>` (wave 54): press it once
  // signed in; its story reply lands like the button's.
  const pendingAct = useRef<string | null>(host.ownsPage ? actFromSearch(window.location.search) : null);
  useEffect(() => {
    const name = pendingAct.current;
    if (name === null || me === null || status === null) return;
    pendingAct.current = null;
    try {
      window.history.replaceState(null, "", `${window.location.pathname}${withoutAct(window.location.search)}`);
    } catch {
      /* fine */
    }
    void act(name).catch((e: unknown) => {
      if (!lockedRefusal(e)) alertsRef.current?.raise(e instanceof Error ? e.message : "That didn't work — try again.", { quiet: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, status, post]);
  const links = useGuestLinks(me !== null && ready && status !== null, threads.list.map((c) => c.id), lobbyHidden(status));
  const sides = useMemo<SidesCalls>(
    () => ({
      join: (side) => post("/api/guest/join", { faction: side }),
      defect: (to) => post("/api/guest/defect", { to }),
      leave: () => post("/api/guest/side/leave", {}),
      recruit: (to, side) => post("/api/guest/recruit", { to, ...(side !== undefined ? { side } : {}) }),
      answer: (id, yes) => post("/api/guest/recruit/answer", { id, yes }),
      found: (name) => post<{ ok: boolean; crew?: { id: string; name: string } }>("/api/guest/crew/found", { name }),
      invite: (to) => post("/api/guest/crew/invite", { to }),
      leaveCrew: () => post<{ ok: boolean; dissolved?: boolean }>("/api/guest/crew/leave", {}),
      joinCrew: (crew) => post("/api/guest/crew/join", { crew }),
    }),
    [post],
  );
  const dismissAlert = alerts.dismiss;
  // Signed out (the join screens), the landing's skin; signed in, the story's.
  const landing = useLandingBrand();
  useTheme(me === null ? landing.theme : status?.theme);

  return {
    me,
    status,
    locked: status?.locked === true || locked403,
    connected,
    ready,
    notice,
    threads,
    register,
    pictures,
    setPicture,
    join,
    defect,
    choose,
    escape,
    act,
    say,
    inviteToChannel,
    leaveChannel,
    redeem,
    printed,
    checkin,
    scanDone,
    showScan,
    clearScan,
    shareCodex,
    wallet,
    message,
    alert,
    dismissAlert,
    alerts,
    answerWidget,
    widgetAnswers: answeredNow,
    messages: shown,
    leave,
    adopt,
    linkBadge,
    linkNav: links.nav,
    takeLinkNav: links.take,
    decision: dock,
    sides,
  };
}
