//! Role sessions. Each opens the SSE stream for its participant (via
//! `useChatStream`), keeps the authoritative status snapshot, exposes the
//! role's actions, and composes the live message map into conversation
//! threads (`useThreads`). The guest and performer both build on the same
//! plumbing — only their channel-shaping + actions differ.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DOORS_POLL_MS, type Identities, type PictureChoices, type ProgramHit, type ProgramPictures } from "./avatars.ts";
import { ApiError, api, useChatStream } from "./client.ts";
import { boothAlertFilter, maxSeqOf, unsolicitedReadout, useAlerts, type Alert } from "./alerts.ts";
import { checkinFromSearch, withoutCheckin } from "./checkin.ts";
import { pmChannelId, pmOtherParty, unlockFromSearch, withoutUnlock } from "./codex.ts";
import { usePlayHost } from "./host.ts";
import { roomFromMessage, roomFromSearch, roomTarget, withoutRoom } from "./room.ts";
import { SessionRole, afterLifecycle, eventGone, guestSessionDead, lifecycleDropsSession, lifecycleNotice, lifecycleStartsNewRun, performerSessionDead } from "./lifecycle.ts";
import { locationOfRoom, occupantsByLocation, type Presence } from "./presence.ts";
import { CODEX_ROOM, PINNED_SPACE, QUEST_LOG, STORY_SPACE, WALLET_ROOM, channelHead, groupByChannel, prettyName, questSummary, withThe, useThreads, type Threads } from "./threads.ts";
import { queueSummary, walletNeedsYou, walletSummary } from "./wallet.tsx";
import { useTyping } from "./typing.ts";
import type { Channel, ChatMessage, Decision, GuestView, PrimeView } from "./types.ts";
import { cardAsks, supersededCards, type WidgetResult } from "./widgets.tsx";

// --- persistence ------------------------------------------------------------

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
interface PrimeAuth {
  token: string;
  character: string;
  admin: boolean;
  /** Which event this performer signed into. */
  eventId: string;
  /** The event's display title (from `/api/resolve-code`). */
  title?: string;
}

/** What `/api/resolve-code` answers for any valid passcode. */
export interface ResolvedCode {
  eventId: string;
  role: string;
  title?: string;
  /** The story's `theme:` (the join screens skin themselves with it). */
  theme?: string;
  /** A performer / mod code lists the characters one may sign in as. */
  characters?: string[];
}

/** Resolve a passcode (null if unknown/invalid). The join screens use it to
 *  show what a scanned QR leads into and, for a performer, whom they can be. */
export async function resolveCode(code: string): Promise<ResolvedCode | null> {
  const r = await resolveOrBusy(code);
  return r === "busy" ? null : r;
}

/**
 * Like `resolveCode`, but tells "no such code" (404) from "ask again later":
 * `/api/resolve-code` is throttled per IP, and a whole house on one Wi-Fi
 * shares one public IP — a 429 (or no answer at all) must never read as a
 * wrong code.
 */
async function resolveOrBusy(code: string): Promise<ResolvedCode | null | "busy"> {
  try {
    return await api<ResolvedCode>("/api/resolve-code", { code });
  } catch (e) {
    const status = (e as Partial<ApiError>).status;
    return typeof status === "number" && status !== 429 && status < 500 ? null : "busy";
  }
}

/** What the sign-in screen learns from a code. */
export type IdentityLookup =
  /** The code opens nothing. */
  | { kind: "unknown" }
  /** The server is throttling this address (or is unreachable): retry
   *  shortly, the code may be fine. */
  | { kind: "busy" }
  /** The code is good but the server couldn't give the picker (an older
   *  server, a hiccup): the screen falls back to a plain sign-in. */
  | { kind: "unavailable"; eventId: string; title?: string; role: string; characters?: string[]; error: string }
  | ({ kind: "ok"; eventId: string; title?: string } & Identities);

/** An event a code already resolved to — a re-ask skips `/api/resolve-code`. */
export interface KnownEvent {
  eventId: string;
  title?: string;
  /** What the code is there ("guest" / "prime"). */
  role: string;
}

/** The sign-in picker for a code: a guest's unclaimed programs, or a
 *  performer's unclaimed parts. Pass `known` (the event an earlier answer
 *  named) on a re-ask — the closed-doors poll, a refresh after a 409 — so
 *  only the event's own, unthrottled `/api/identities` is asked; a gone
 *  event falls back to a fresh resolve. */
export async function fetchIdentities(code: string, known?: KnownEvent): Promise<IdentityLookup> {
  if (known !== undefined) {
    const again = await identitiesOf(code, known, known.role);
    if (again !== "gone") return again;
  }
  const r = await resolveOrBusy(code);
  if (r === "busy") return { kind: "busy" };
  if (r === null) return { kind: "unknown" };
  const out = await identitiesOf(code, r, r.role, r.characters);
  return out === "gone" ? { kind: "unknown" } : out;
}

async function identitiesOf(code: string, ev: KnownEvent, role: string, characters?: string[]): Promise<IdentityLookup | "gone"> {
  try {
    const ids = await api<Identities>(`/e/${encodeURIComponent(ev.eventId)}/api/identities`, { passcode: code });
    return { kind: "ok", ...ids, eventId: ev.eventId, title: ev.title };
  } catch (e) {
    const err = e as Partial<ApiError>;
    if (typeof err.status === "number" && eventGone(err.status, err.message ?? "")) return "gone";
    if (err.status === 429) return { kind: "busy" };
    const status = typeof err.status === "number" ? ` (HTTP ${err.status})` : "";
    return { kind: "unavailable", eventId: ev.eventId, title: ev.title, role, characters, error: `${err.message ?? "no answer"}${status}` };
  }
}

/** How long the join screen waits before re-asking: every 5 s while the
 *  doors are closed (a minute of that, then every 15 s); a busy server
 *  backs off 10 → 20 → 30 s. `attempt` counts re-asks in a row from 0. */
export function retryDelay(kind: "closed" | "busy", attempt: number): number {
  if (kind === "busy") return Math.min(30_000, 10_000 * (attempt + 1));
  return attempt < 12 ? DOORS_POLL_MS : 15_000;
}

type Picker = Extract<IdentityLookup, { kind: "ok" }>;

/**
 * The join screens' picker for a typed / scanned code, kept fresh. A code
 * answered `waiting` (the doors are closed) is re-asked on `retryDelay`
 * straight at its event, never through the throttled resolve; a busy
 * server keeps the last good screen and backs off. `refresh` re-asks now
 * (someone may have just taken a name).
 */
export function useIdentities(code: string, waiting: (ids: Picker) => boolean): { ids: IdentityLookup | null | "loading"; busy: boolean; refresh: () => void } {
  const [ids, setIds] = useState<IdentityLookup | null | "loading">(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const known = useRef<{ code: string; event: KnownEvent } | null>(null);
  const streak = useRef<{ kind: "closed" | "busy"; n: number }>({ kind: "closed", n: 0 });
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;
  useEffect(() => {
    const c = code.trim();
    if (c.length < 4) {
      setIds(null);
      setBusy(false);
      return;
    }
    let alive = true;
    let timer: number | undefined;
    // A re-ask keeps the current screen until the answer lands.
    const keep = (prev: IdentityLookup | null | "loading") => prev !== null && prev !== "loading" && prev.kind === "ok";
    setIds((prev) => (keep(prev) ? prev : "loading"));
    const event = known.current?.code === c ? known.current.event : undefined;
    void fetchIdentities(c, event).then((r) => {
      if (!alive) return;
      let again: "closed" | "busy" | null = null;
      if (r.kind === "busy") {
        again = "busy";
        setBusy(true);
        setIds((prev) => (keep(prev) ? prev : null));
      } else {
        setBusy(false);
        setIds(r);
        known.current = r.kind === "ok" ? { code: c, event: { eventId: r.eventId, title: r.title, role: r.role } } : null;
        if (r.kind === "ok" && waitingRef.current(r)) again = "closed";
      }
      if (again === null) {
        streak.current = { kind: "closed", n: 0 };
        return;
      }
      const n = streak.current.kind === again ? streak.current.n : 0;
      streak.current = { kind: again, n: n + 1 };
      timer = window.setTimeout(() => setReload((x) => x + 1), retryDelay(again, n));
    });
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [code, reload]);
  const refresh = useCallback(() => setReload((x) => x + 1), []);
  return { ids, busy, refresh };
}

/** The pictures a guest may choose for a program before signing in: one of
 *  the story's (`name`) or a directory pick (`wiki` = its article title). */
export async function fetchPictures(eventId: string, code: string, pick: { name: string } | { wiki: string }): Promise<ProgramPictures> {
  return api<ProgramPictures>(`/e/${encodeURIComponent(eventId)}/api/identities/pictures`, { passcode: code, ...pick });
}

/** Search the program directory (any software; antivirus flagged). */
export async function searchPrograms(eventId: string, code: string, q: string): Promise<ProgramHit[]> {
  const r = await api<{ results: ProgramHit[] }>(`/e/${encodeURIComponent(eventId)}/api/identities/search`, { passcode: code, q });
  return r.results;
}

/**
 * Is this token still good? Asked before dropping a session over a closed
 * stream — a closed `EventSource` is also what a flaky network, a sleeping
 * phone, or a mid-restart server produces, and none of those should log a
 * guest out. Only a definite answer from the server means dead: 401 / 403
 * (the run forgot this token → `"reset"`) or 404 `unknown event` (the event
 * itself is gone → `"ended"`). `null` = alive, or no way to tell.
 */
async function tokenDead(base: string, role: "guest" | "prime", token: string): Promise<"reset" | "ended" | null> {
  try {
    const res = await fetch(`${base}/api/state?role=${role}`, { headers: { "x-loom-token": token } });
    if (res.status === 401 || res.status === 403) return "reset";
    if (res.status === 404) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (eventGone(404, String(body.error ?? ""))) return "ended";
    }
    return null;
  } catch {
    return null; // no answer at all: the server is away, not the session
  }
}

/** The event code can ride in on a `?code=` link (e.g. a scanned QR). */
export function codeFromUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get("code") ?? "";
  } catch {
    return "";
  }
}

/** The landing page's branding before any code: the one open event's title
 *  + skin (`GET /api/landing`), or nulls. */
export async function fetchLanding(): Promise<{ title: string | null; theme: string | null }> {
  try {
    const res = await fetch("/api/landing");
    if (!res.ok) return { title: null, theme: null };
    const j = (await res.json()) as { title?: unknown; theme?: unknown };
    return { title: typeof j.title === "string" ? j.title : null, theme: typeof j.theme === "string" ? j.theme : null };
  } catch {
    return { title: null, theme: null };
  }
}

/** `role` is what a `?code=` link's code opens (`guest` / `prime` / `mod`). */
type Brand = { title: string | null; theme: string | null; role?: string | null };

/** One branding lookup per page load, shared by every screen that asks
 *  (the role chooser, the join screens, the session's skin): each ask is a
 *  throttled `/api/resolve-code` on a `?code=` link. */
let brandOnce: { key: string; ask: Promise<Brand>; value: Brand | null } | null = null;

export function landingBrand(code: string): { ask: Promise<Brand>; value: Brand | null } {
  if (brandOnce === null || brandOnce.key !== code) {
    const once: { key: string; ask: Promise<Brand>; value: Brand | null } = {
      key: code,
      ask: code !== "" ? resolveCode(code).then((r) => ({ title: r?.title ?? null, theme: r?.theme ?? null, role: r?.role ?? null })) : fetchLanding(),
      value: null,
    };
    void once.ask.then((b) => {
      once.value = b;
    });
    brandOnce = once;
  }
  return brandOnce;
}

/**
 * The join screens' branding: the event a `?code=` link names, else (the
 * bare address, typed in) the one event with its doors open. The title
 * heads the page; the theme skins it until someone signs in. Asked once
 * per page load (see `landingBrand`).
 */
export function useLandingBrand(): Brand {
  const { ownsPage } = usePlayHost();
  const [brand, setBrand] = useState<Brand>(() => (ownsPage ? (landingBrand(codeFromUrl()).value ?? { title: null, theme: null }) : { title: null, theme: null }));
  useEffect(() => {
    if (!ownsPage) return;
    let alive = true;
    void landingBrand(codeFromUrl()).ask.then((b) => {
      if (alive) setBrand(b);
    });
    return () => {
      alive = false;
    };
  }, [ownsPage]);
  return brand;
}

/** Keep the browser tab named after the event once we know its title. */
export function useDocumentTitle(title: string | null | undefined): void {
  const { ownsPage } = usePlayHost();
  useEffect(() => {
    if (ownsPage && title) document.title = title;
  }, [ownsPage, title]);
}

/**
 * The story's `theme:` becomes `data-theme` on the root element — the
 * stylesheet's neutral skin is the default; `aol97` is the 1997 chat-room
 * look one particular party shipped with (see `styles.css`).
 */
export function useTheme(theme: string | null | undefined, active = true): void {
  const host = usePlayHost();
  useEffect(() => {
    if (!active) return; // another screen owns the skin
    const el = host.themeRoot();
    if (el === null) return;
    if (theme && theme !== "plain") el.dataset["theme"] = theme;
    else delete el.dataset["theme"];
  }, [host, theme, active]);
}
const GK = "loom.guest";
const PK = "loom.prime";
/** The last `!` alert each role's sign-in has seen (alerts.ts). */
const GUEST_ALERTS = "loom.guest.alerts";
const PRIME_ALERTS = "loom.prime.alerts";
/** A guest sign-in's read marks (threads.ts) and echoed choices. */
const GUEST_READ = "loom.guest.read";
const GUEST_ECHO = "loom.guest.echo";
/** How many echoed choices a sign-in keeps. */
const ECHO_CAP = 200;

/** The guest's pick as their own line in the room the choice docked in,
 *  just after everything already there (a half seq, so the story's answer
 *  — the next real message — lands under it). */
export function choiceEcho(channel: string, text: string, me: { id: string; name: string }, afterSeq: number): ChatMessage {
  return {
    seq: afterSeq + 0.5,
    channel,
    channelKind: channelHead(channel).kind,
    title: channelHead(channel).title,
    from: me.name,
    kind: "line",
    text,
    ts: Date.now(),
    audience: [me.id],
    parentSeq: null,
    hidden: false,
  };
}

/** The stream with the guest's echoed choices folded in. */
export function withEchoes(messages: ReadonlyMap<number, ChatMessage>, echoes: readonly ChatMessage[]): Map<number, ChatMessage> {
  const out = new Map(messages);
  for (const e of echoes) if (!out.has(e.seq)) out.set(e.seq, e);
  return out;
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

/** The one required decision (if any), and the channel it should dock under. */
export function requiredDecision(
  status: GuestView | null,
  acts: { choose: (i: number) => void; join: (f: string) => void; escape: () => void },
): { channel: string; decision: Decision } | null {
  if (!status) return null;
  if (status.pendingChoice) {
    return {
      channel: status.decisionChannel ?? "lobby",
      decision: {
        title: "Your move…",
        options: status.pendingChoice.map((opt, i) => ({ label: opt, onClick: () => acts.choose(i) })),
      },
    };
  }
  // The side chooser is driven by the story's declared public factions —
  // nothing is shown for a story that has none.
  const factions = status.factions ?? [];
  if (!status.faction && !status.captured && factions.length > 0) {
    return {
      channel: "lobby",
      decision: {
        title: "Choose your side",
        options: factions.map((f, i) => ({
          label: `Side with ${withThe(f)}`,
          onClick: () => acts.join(f),
          tone: i === 0 ? undefined : ("ghost" as const),
        })),
      },
    };
  }
  // A captive may break out from the app — unless their prison is sealed
  // (the story lets them out: a performer, a puzzle, a VR duck).
  if (status.captured && status.canEscape !== false) {
    return {
      channel: "lobby",
      decision: {
        title: "You've been captured",
        options: [{ label: "🏃 Make a break for it", onClick: () => acts.escape(), tone: "danger" }],
      },
    };
  }
  return null;
}

/** What a guest sees after pressing one of the story's buttons: the
 *  story's reply to them, else a plain acknowledgement of the button. */
export function actFeedback(replies: readonly string[] | undefined, label?: string): string {
  const said = (replies ?? []).map((r) => r.trim()).filter((r) => r !== "");
  if (said.length > 0) return said.join(" ");
  return label ? `✔ ${label}` : "✔ Done.";
}

/** A room whose *listing* the server snapshot decides: a location's room or
 *  an authored channel (derived DM / private / lobby threads are always shown). */
export function isListedRoom(id: string): boolean {
  return id.startsWith("loc:") || id.startsWith("room:");
}

/**
 * SW-PLAY-20: a tapped notification opens its room — `?room=` on a fresh
 * window, the service worker's `open-room` message on one already open
 * (listened for only when the app owns the page: never in Run → Players).
 * Applied once signed in with the backlog in, and only to a room this
 * participant lists; otherwise dropped. Returns whether a link is still
 * waiting (the wide-screen home default holds off until it has run).
 */
function useRoomLinks(threads: Threads, signedIn: boolean, booth: boolean): boolean {
  const { ownsPage } = usePlayHost();
  const [want, setWant] = useState<{ room: string } | null>(() => {
    const room = ownsPage ? roomFromSearch(window.location.search) : null;
    return room === null ? null : { room };
  });
  useEffect(() => {
    if (!ownsPage) return;
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (sw === undefined) return;
    const on = (e: MessageEvent) => {
      const room = roomFromMessage(e.data);
      if (room !== null) setWant({ room });
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
    if (ownsPage && roomFromSearch(window.location.search) !== null) {
      try {
        window.history.replaceState(null, "", `${window.location.pathname}${withoutRoom(window.location.search)}`);
      } catch {
        /* fine */
      }
    }
    const id = roomTarget(want.room, threads.list.map((c) => c.id), booth);
    if (id !== null) threads.open(id);
    // `threads` is rebuilt each render; the request is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want, signedIn]);
  return want !== null;
}

/** The guest's own pinned rooms — the Codex and the Quest Log. */
export function isPinnedRoom(id: string): boolean {
  return id === CODEX_ROOM || id === QUEST_LOG || id === WALLET_ROOM;
}

/** Everything said *to* this guest, in order — the on-rails stream a
 *  cutscene shows: lines addressed to them, their cards, their replies.
 *  Room-wide story (`audience: "all"`) is not theirs and stays out. */
export function personalStream(messages: ReadonlyMap<number, ChatMessage>, meId: string): ChatMessage[] {
  return [...messages.values()]
    .filter((m) => Array.isArray(m.audience) && m.audience.includes(meId) && m.parentSeq == null && !isPinnedRoom(m.channel))
    .sort((a, b) => a.seq - b.seq);
}

/** The newest card of `kind` shown to this guest that nobody has answered. */
export function pendingWidget(messages: ReadonlyMap<number, ChatMessage>, kind: string, answered: ReadonlySet<number>): ChatMessage | null {
  let best: ChatMessage | null = null;
  for (const m of messages.values()) {
    if (m.kind !== "widget" || m.widget?.kind !== kind || answered.has(m.seq)) continue;
    if (best === null || m.seq > best.seq) best = m;
  }
  return best;
}


/**
 * State that belongs to one sign-in (B2): a value held for one session
 * token reads as `empty` under any other. A restart cuts the session
 * (`dropSession`), the guest re-registers on the same tab, and the new run
 * hands out the old run's chat seqs again — a card answered last run must
 * not read "✔ Submitted" in this one. Keying on the token covers register,
 * leave and every drop at once.
 */
export interface PerSession<T> {
  readonly session: string | null;
  readonly value: T;
}

/** The value for `session` (`empty` when it was held for another one). */
export function perSessionValue<T>(held: PerSession<T>, session: string | null, empty: T): T {
  return held.session === session ? held.value : empty;
}

/** Apply `f` to `session`'s value (starting from `empty` for a new session). */
export function perSessionUpdate<T>(held: PerSession<T>, session: string | null, empty: T, f: (prev: T) => T): PerSession<T> {
  const prev = perSessionValue(held, session, empty);
  const value = f(prev);
  return held.session === session && value === held.value ? held : { session, value };
}

/** `useState` scoped to a sign-in; `empty` must be a stable constant. */
function usePerSession<T>(session: string | null, empty: T): [T, (f: (prev: T) => T) => void] {
  const [held, setHeld] = useState<PerSession<T>>(() => ({ session, value: empty }));
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const update = useCallback((f: (prev: T) => T) => setHeld((h) => perSessionUpdate(h, sessionRef.current, empty, f)), [empty]);
  return [perSessionValue(held, session, empty), update];
}

const NO_ANSWERS: ReadonlyMap<number, WidgetResult> = new Map();
const NONE_OPENED: ReadonlySet<string> = new Set();

/** Is a card still waiting on this participant — an answerable widget with
 *  no answer in this session? A re-dealt card (a 📝 fact card) only counts
 *  while it is the newest. Shared by the guest's rooms and the booth's. */
export function hasPendingCard(msgs: readonly ChatMessage[], answered: ReadonlySet<number>): boolean {
  const old = supersededCards(msgs);
  return msgs.some((m) => m.kind === "widget" && m.widget !== undefined && cardAsks(m.widget) && !answered.has(m.seq) && !old.has(m.seq));
}

/** Group the guest's messages into threads, docking the pending decision, and
 *  merge in authored channels (SPACE/CHANNEL) the guest can see — including
 *  empty rooms — from the server snapshot. */
export function buildGuestChannels(
  messages: Map<number, ChatMessage>,
  dock: { channel: string; decision: Decision } | null,
  view: GuestView | null,
  opened: ReadonlySet<string> = new Set(),
  answered: ReadonlySet<number> = new Set(),
): Channel[] {
  const groups = groupByChannel(messages);
  // Who stands where — the sidebar's "3 here" and the room header's strip.
  const occupants = occupantsByLocation(
    view?.people ?? [],
    view ? { id: view.id, name: view.name, group: view.faction, location: view.location } : null,
  );
  const everyone: Presence[] = view
    ? [
        { id: view.id, name: view.name, kind: "guest", group: view.faction },
        ...(view.people ?? []).filter((p) => p.kind === "guest").map((p) => ({ id: p.id, name: p.name, kind: "guest" as const, group: p.faction })),
      ]
    : [];
  const presenceOf = (id: string): { here?: boolean; people?: Presence[] } => {
    const loc = locationOfRoom(id);
    if (loc !== null) return { here: view?.location === loc, people: occupants.get(loc) ?? [] };
    if (id.startsWith("dm:")) return { people: [{ id: id.slice(3), name: id.slice(3), kind: "character", group: null }] };
    if (id === "lobby") return { people: everyone };
    return {};
  };
  // A card still waiting on this guest pulls its room to the top, like a
  // decision does.
  const needsYou = (msgs: ChatMessage[]): boolean => hasPendingCard(msgs, answered);
  if (!groups.has("lobby")) groups.set("lobby", []); // the lobby is always present
  // The pinned rooms are there from the start whenever the story has a
  // codex / declares quests — the Codex is where codes get typed.
  if ((view?.codexTotal ?? 0) > 0 && !groups.has(CODEX_ROOM)) groups.set(CODEX_ROOM, []);
  if ((view?.questTotal ?? 0) > 0 && !groups.has(QUEST_LOG)) groups.set(QUEST_LOG, []);
  // The Wallet is there whenever the story declares a currency.
  if (view?.wallet !== undefined && !groups.has(WALLET_ROOM)) groups.set(WALLET_ROOM, []);
  if (dock && !groups.has(dock.channel)) groups.set(dock.channel, []);
  // Threads the guest opened from the People list (a private message to a
  // guest, a DM to a character) exist before anyone has said anything.
  for (const id of opened) if (!groups.has(id)) groups.set(id, []);
  const spaceTitles = new Map((view?.spaces ?? []).map((s) => [s.id, s.title]));
  const snap = new Map((view?.channels ?? []).map((c) => [c.id, c]));
  for (const id of snap.keys()) if (!groups.has(id)) groups.set(id, []); // empty authored rooms
  // The snapshot is the authority on which rooms + places are *listed*: a
  // `hidden: true` room the story hasn't opened for this guest stays off
  // the sidebar even though its public lines were delivered — they are
  // kept, and appear with their history the moment the room is revealed.
  if (view !== null) {
    for (const id of [...groups.keys()]) if (isListedRoom(id) && !snap.has(id)) groups.delete(id);
  }
  // An agent-voiced character in the directory is always reachable: their
  // DM is on the sidebar before either side has said a word (a performer's
  // thread only appears once the character speaks to you).
  for (const p of view?.people ?? []) {
    if (p.kind === "character" && p.agent !== undefined && !groups.has(`dm:${p.id}`)) groups.set(`dm:${p.id}`, []);
  }
  // The story's own section is named after the story, whichever channel
  // (derived or authored) happens to lead it.
  const storyTitle = view?.title ?? spaceTitles.get(STORY_SPACE);
  const titleOfSpace = (spaceId: string) => (spaceId === STORY_SPACE ? storyTitle : spaceTitles.get(spaceId));
  return [...groups.entries()].map(([id, msgs]) => {
    const lastTs = msgs.length ? msgs[msgs.length - 1]!.ts : 0;
    const decision = dock && dock.channel === id ? dock.decision : null;
    const s = snap.get(id);
    if (s !== undefined) {
      // An authored channel — title/kind/space are server-authoritative.
      return {
        id,
        kind: s.kind as Channel["kind"],
        title: s.title,
        spaceId: s.spaceId,
        spaceTitle: titleOfSpace(s.spaceId),
        needsYou: needsYou(msgs),
        member: s.member,
        canPost: s.canPost,
        threadable: s.threadable,
        ...presenceOf(id),
        messages: msgs,
        unread: 0,
        decision,
        lastTs,
      };
    }
    if (id === WALLET_ROOM) {
      // The Wallet: a read-only log of coin cards, each with its own thread;
      // its footer (the guest app) holds Send / Request / Trade. A card
      // waiting on this guest (a request, an offer, a held approval) pulls
      // it up like a decision does.
      return {
        id,
        kind: "wallet" as const,
        title: "Wallet",
        subtitle: view?.wallet ? walletSummary(view.wallet, view.id) : "",
        spaceId: PINNED_SPACE,
        order: -1,
        canPost: false,
        threadable: true,
        tour: "wallet",
        needsYou: view?.wallet && view.id ? walletNeedsYou(view.wallet, view.id) : false,
        messages: msgs,
        unread: 0,
        decision,
        lastTs,
      };
    }
    if (isPinnedRoom(id)) {
      // The Codex takes codes (its composer redeems); the Quest Log is a
      // read-only log whose cards each open their own thread.
      const codex = id === CODEX_ROOM;
      return {
        id,
        kind: codex ? ("codex" as const) : ("quests" as const),
        title: codex ? "Codex" : "Quest Log",
        subtitle: codex ? `${view?.codex?.length ?? 0} of ${view?.codexTotal ?? 0} found` : questSummary(view?.quests ?? []),
        spaceId: PINNED_SPACE,
        order: codex ? 1 : 0,
        canPost: codex,
        threadable: !codex,
        tour: codex ? "codex" : "quests",
        messages: msgs,
        unread: 0,
        decision,
        lastTs,
      };
    }
    // A derived channel — read title/kind from the id (`dm:Recruiter` → "Recruiter").
    // The lobby is named after the story; derived rooms live in the story's space.
    // A private thread is named after the other party.
    const head = channelHead(id);
    const other = view ? pmOtherParty(id, view.id) : null;
    const otherName =
      other !== null
        ? (view?.people?.find((p) => p.id === other)?.name ?? view?.roster.find((p) => p.id === other)?.name ?? prettyName(other))
        : null;
    // A character's DM is titled with their declared name (`WebMD`), not a
    // re-cased channel key.
    const castName = id.startsWith("dm:") ? (view?.people?.find((p) => p.kind === "character" && p.id === id.slice(3))?.name ?? null) : null;
    return {
      id,
      kind: head.kind,
      title: otherName ?? castName ?? (head.kind === "lobby" && storyTitle ? storyTitle : head.title),
      subtitle: otherName !== null ? "private" : undefined,
      spaceId: STORY_SPACE,
      spaceTitle: storyTitle,
      needsYou: needsYou(msgs),
      order: head.kind === "lobby" ? 0 : head.kind === "faction" ? 1 : 2,
      ...(otherName !== null && other !== null ? { people: [{ id: other, name: otherName, kind: "guest" as const, group: null }] } : presenceOf(id)),
      messages: msgs,
      unread: 0,
      decision,
      lastTs,
    };
  });
}

export interface GuestSession {
  me: GuestId | null;
  status: GuestView | null;
  connected: boolean;
  /** The backlog has loaded — the rooms list is real, not a placeholder. */
  ready: boolean;
  /** Why the last session ended under us (the run restarted / went live /
   *  ended) — shown on the join screen until the guest registers again. */
  notice: string | null;
  threads: Threads;
  /** Join as `name` — a program from the picker, or (`wiki`) a directory title. */
  register: (name: string, code: string, wiki?: string, picture?: string) => Promise<void>;
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
  /** Codex: type (or scan) an unlock code. Resolves to the entry unlocked, if any. */
  redeem: (code: string) => Promise<string | null>;
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
  /** Answer a widget card (a CAPTCHA, a poll) the story showed you. */
  answerWidget: (seq: number, result: WidgetResult) => Promise<void>;
  /** Answers given this session, by card seq (the card renders resolved). */
  widgetAnswers: ReadonlyMap<number, WidgetResult>;
  /** Every message delivered to this guest, by seq (the raw stream the
   *  threads are built from — a cutscene reads what is addressed to them). */
  messages: ReadonlyMap<number, ChatMessage>;
  leave: () => void;
  /** A notification's room link is waiting to open (SW-PLAY-20). */
  roomLinkPending: boolean;
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
  const { messages, connected } = useChatStream(url, {
    onSnapshot: (v) => setStatus(v as GuestView),
    onTyping,
    onHistory: (list) => {
      alertsRef.current?.onHistory(list);
      crawl.loaded(maxSeqOf(list)); // the backlog never crawls; only what lands from now on
      setReady(true);
    },
    onLifecycle: (n) => {
      if (lifecycleDropsSession(n.kind, SessionRole.Guest)) dropSession(lifecycleNotice(n.kind, SessionRole.Guest));
    },
    // The stream closed for good: if the server really no longer knows this
    // token (a restart we slept through) or the event itself is gone, drop
    // the session and say why.
    onDead: () => {
      if (me === null) return;
      void tokenDead(base, "guest", me.token).then((dead) => {
        if (dead) dropSession(lifecycleNotice(dead, SessionRole.Guest));
      });
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
  // The guest's own pick, echoed into the thread as their bubble (the
  // server records the choice, not a line), so the story's answer never
  // reads as a non sequitur. Kept per sign-in so a reload keeps it.
  const [echoes, setEchoes] = useState<ChatMessage[]>(() => loadEchoes(load, me?.token ?? null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setEchoes(loadEchoes(load, me?.token ?? null)), [me?.token]);
  const pendingRef = useRef<{ options: string[] | null; channel: string }>({ options: null, channel: "lobby" });
  pendingRef.current = { options: status?.pendingChoice ?? null, channel: status?.decisionChannel ?? "lobby" };
  const choose = useCallback(
    async (index: number) => {
      const { options, channel } = pendingRef.current;
      const text = options?.[index];
      const echo = text !== undefined && me !== null ? choiceEcho(channel, text, me, maxSeqOf(messages.values())) : null;
      if (echo !== null) {
        crawl.claim(echo.seq); // your own words never crawl
        setEchoes((prev) => saveEchoes(save, me!.token, [...prev, echo]));
      }
      try {
        return await post("/api/guest/choose", { index });
      } catch (e) {
        if (echo !== null) setEchoes((prev) => saveEchoes(save, me!.token, prev.filter((m) => m.seq !== echo.seq)));
        throw e;
      }
    },
    [post, me, messages, crawl, save],
  );
  const shown = useMemo(() => withEchoes(messages, echoes), [messages, echoes]);
  const escape = useCallback(() => post("/api/guest/escape", {}), [post]);
  const act = useCallback(
    async (name: string, label?: string) => {
      const r = await post<{ ok: boolean; replies?: string[] }>("/api/guest/act", { name });
      alertsRef.current?.raise(actFeedback(r.replies, label), { quiet: true });
      return r;
    },
    [post],
  );
  const say = useCallback(
    (channel: string, text: string, parentSeq?: number) => post("/api/guest/say", { channel, text, parentSeq }),
    [post],
  );
  const register = useCallback(async (name: string, code: string, wiki?: string, picture?: string) => {
    // Resolve the short event code to its event, then register there.
    const { eventId, title } = await api<ResolvedCode>("/api/resolve-code", { code });
    const r = await api<{ id: string; name: string; token: string }>(
      `/e/${encodeURIComponent(eventId)}/api/guest/register`,
      { name, passcode: code, ...(wiki !== undefined ? { wiki } : {}), ...(picture !== undefined ? { picture } : {}) },
    );
    const m: GuestId = { id: r.id, name: r.name, token: r.token, eventId, title };
    crawl.reset();
    save(GK, m);
    setMe(m);
    setNotice(null);
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

  const inviteToChannel = useCallback(
    (person: string, channel: string) => post("/api/guest/channel/invite", { person, channel }),
    [post],
  );
  const leaveChannel = useCallback((channel: string) => post("/api/guest/channel/leave", { channel }), [post]);

  // --- codex + people ---
  const redeem = useCallback(
    async (code: string): Promise<string | null> => {
      const r = await post<{ unlocked: string | null }>("/api/guest/codex/redeem", { code });
      return r.unlocked;
    },
    [post],
  );
  const shareCodex = useCallback((entry: string, to: string) => post("/api/guest/codex/share", { entry, to }), [post]);
  // The wallet routes: the server's refusal is the whole story (it names
  // the reason), so it banners quietly instead of throwing at a button.
  const walletCall = useCallback(
    async (sub: string, body: Record<string, unknown>): Promise<unknown> => {
      try {
        return await post(`/api/guest/wallet/${sub}`, body);
      } catch (e) {
        if (e instanceof ApiError) {
          alertsRef.current?.raise(e.message, { quiet: true });
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
    void redeem(code)
      .then(() => setOpenCodex(true))
      .catch(() => {});
  }, [me, status, redeem]);

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
  const answerWidget = useCallback(
    async (seq: number, result: WidgetResult) => {
      setWidgetAnswers((prev) => new Map(prev).set(seq, result));
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
  const dock = requiredDecision(status, { choose: (i) => void choose(i), join: (f) => void join(f), escape: () => void escape() });
  const threads = useThreads(withAgents(buildGuestChannels(shown, dock, status, opened, new Set(widgetAnswers.keys())), status, typing), {
    store: host.storage,
    slot: GUEST_READ,
    session: me?.token ?? null,
  });
  const message = useCallback(
    (person: { id: string; kind: "guest" | "character" }) => {
      if (me === null) return;
      const id = person.kind === "character" ? `dm:${person.id}` : pmChannelId(me.id, person.id);
      setOpened((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      threads.open(id);
    },
    [me, threads],
  );
  // A wall QR just unlocked something: show it where it landed.
  useEffect(() => {
    if (!openCodex) return;
    setOpenCodex(false);
    threads.open(CODEX_ROOM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCodex]);
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
    void post<{ channel: string }>("/api/guest/checkin", { at })
      .then((r) => threads.open(r.channel))
      .catch((e: unknown) => alerts.raise(e instanceof Error ? e.message : "Check-in failed.", { quiet: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, status, post]);
  const roomLinkPending = useRoomLinks(threads, me !== null && ready && status !== null, false);
  const dismissAlert = alerts.dismiss;
  // Signed out (the join screens), the landing's skin; signed in, the story's.
  const landing = useLandingBrand();
  useTheme(me === null ? landing.theme : status?.theme);

  return {
    me,
    status,
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
    shareCodex,
    wallet,
    message,
    alert,
    dismissAlert,
    answerWidget,
    widgetAnswers,
    messages: shown,
    leave,
    roomLinkPending,
  };
}

// --- performer (character) --------------------------------------------------

/** The booth's Inbox channel id: cards + notes the story deals to the character. */
export const INBOX = "__inbox";

/** Build the performer's surfaces: a scanner, the character's Inbox (cards
 *  the story deals to it), the broadcast feed, the character's own pinned
 *  Quest Log / Codex, the rooms, the cast threads, and one conversation per
 *  guest (targeted messages, for moderation). `answered` = the cards this
 *  booth has answered (a pending one bubbles its room up). */
export function buildPrimeChannels(messages: Map<number, ChatMessage>, view: PrimeView | null, answered: ReadonlySet<number> = new Set<number>()): Channel[] {
  const all = [...messages.values()];
  const bySeq = (a: ChatMessage, b: ChatMessage) => a.seq - b.seq;
  const occupants = occupantsByLocation(view?.guests ?? [], null);
  const locationLabel = (loc: string | null): string | null => {
    if (loc === null) return null;
    return view?.channels.find((c) => c.id === `loc:${loc}`)?.title ?? loc;
  };
  const scanner: Channel = {
    id: "__scanner",
    kind: "scanner",
    title: "Scanner",
    subtitle: "scan a guest's pass",
    spaceId: "booth", // the booth tools group apart from the room + guests
    order: 0,
    messages: [],
    unread: 0,
    decision: null,
    lastTs: Number.MAX_SAFE_INTEGER, // pinned to the top
  };
  const feedMsgs = all.filter((m) => m.audience === "all").sort((a, b) => a.seq - b.seq);
  const everyone: Presence[] = (view?.guests ?? []).map((g) => ({ id: g.id, name: g.name, kind: "guest" as const, group: g.faction }));
  const feed: Channel = {
    id: "__feed",
    kind: "lobby",
    title: view?.title ?? "Lobby",
    subtitle: "everyone · broadcast feed",
    spaceId: STORY_SPACE,
    spaceTitle: view?.title,
    order: 0,
    people: everyone,
    messages: feedMsgs,
    unread: 0,
    decision: null,
    lastTs: feedMsgs.length ? feedMsgs[feedMsgs.length - 1]!.ts : 0,
  };
  const guests: Channel[] = (view?.guests ?? []).map((g) => {
    const msgs = all
      .filter((m) => Array.isArray(m.audience) && m.audience.includes(g.id))
      .sort((a, b) => a.seq - b.seq);
    const where = locationLabel(g.location);
    return {
      id: `guest:${g.id}`,
      kind: "guest" as const,
      title: g.name,
      subtitle: `${g.faction ?? "unaligned"}${where ? ` · 📍 ${where}` : ""}${g.captured ? " · 🔒 captured" : ""}${g.restricted ? " · ⛔ restricted" : ""}`,
      spaceId: "guests", // one section of per-guest conversations
      order: 0,
      people: [{ id: g.id, name: g.name, kind: "guest" as const, group: g.faction }],
      messages: msgs,
      unread: 0,
      decision: null,
      lastTs: msgs.length ? msgs[msgs.length - 1]!.ts : 0,
    };
  });
  // Authored channels (SPACE/CHANNEL) the performer runs — grouped by space.
  const spaceTitles = new Map((view?.spaces ?? []).map((s) => [s.id, s.title]));
  const rooms: Channel[] = (view?.channels ?? []).map((c) => {
    const msgs = all.filter((m) => m.channel === c.id).sort((a, b) => a.seq - b.seq);
    return {
      id: c.id,
      kind: c.kind as Channel["kind"],
      title: c.title,
      spaceId: c.spaceId,
      spaceTitle: c.spaceId === STORY_SPACE ? (view?.title ?? spaceTitles.get(c.spaceId)) : spaceTitles.get(c.spaceId),
      member: c.member,
      canPost: c.canPost,
      threadable: c.threadable,
      ...(locationOfRoom(c.id) !== null ? { people: occupants.get(locationOfRoom(c.id)!) ?? [] } : {}),
      messages: msgs,
      unread: 0,
      decision: null,
      lastTs: msgs.length ? msgs[msgs.length - 1]!.ts : 0,
    };
  });
  // Agent-voiced characters (`mind: external`) the performer can talk to
  // privately: the agent's `dm:` channel, narrowed to this performer
  // (audience `@<me>`). The server maps a post to `cast:<id>` onto it.
  const me = view?.character ?? "";
  const mine = (m: ChatMessage): boolean => Array.isArray(m.audience) && m.audience.includes(`@${me}`);
  const cast: Channel[] = (view?.agents ?? []).map((a) => {
    const msgs = all
      .filter((m) => m.channel === `dm:${a.id}` && mine(m))
      .sort(bySeq);
    return {
      id: `cast:${a.id}`,
      kind: "dm" as const,
      title: a.id,
      subtitle: a.online ? "online" : "away — answers when their agent is back",
      spaceId: "cast",
      spaceTitle: "Cast",
      order: 0,
      people: [{ id: a.id, name: a.id, kind: "character" as const, group: null }],
      messages: msgs,
      unread: 0,
      decision: null,
      needsYou: hasPendingCard(msgs, answered),
      lastTs: msgs.length ? msgs[msgs.length - 1]!.ts : 0,
    };
  });
  // The character's own pinned rooms: its Quest Log (`start quest X for
  // <Character>`) and Codex (what it knows), addressed `@<me>` — read-only
  // (a booth types no codes; sharing stays on the guest card).
  const pinned: Channel[] = [];
  if ((view?.questTotal ?? 0) > 0) {
    const msgs = all.filter((m) => m.channel === QUEST_LOG && mine(m)).sort(bySeq);
    pinned.push({
      id: QUEST_LOG,
      kind: "quests",
      title: "Quest Log",
      subtitle: questSummary(view?.quests ?? []),
      spaceId: PINNED_SPACE,
      order: 0,
      canPost: false,
      threadable: true,
      messages: msgs,
      unread: 0,
      decision: null,
      lastTs: msgs.length ? msgs[msgs.length - 1]!.ts : 0,
    });
  }
  if ((view?.codexTotal ?? 0) > 0) {
    const msgs = all.filter((m) => m.channel === CODEX_ROOM && mine(m)).sort(bySeq);
    pinned.push({
      id: CODEX_ROOM,
      kind: "codex",
      title: "Codex",
      subtitle: `${view?.codex?.length ?? 0} of ${view?.codexTotal ?? 0} found`,
      spaceId: PINNED_SPACE,
      order: 1,
      canPost: false,
      threadable: false,
      messages: msgs,
      unread: 0,
      decision: null,
      lastTs: msgs.length ? msgs[msgs.length - 1]!.ts : 0,
    });
  }
  // The approver's Wallet room: the held / pending transfers waiting on
  // this character, as `@<me>` cards — Approve / Deny live on the cards.
  if (view?.wallet !== undefined) {
    const msgs = all.filter((m) => m.channel === WALLET_ROOM && mine(m)).sort(bySeq);
    pinned.push({
      id: WALLET_ROOM,
      kind: "wallet",
      title: "Wallet",
      subtitle: queueSummary(view.wallet),
      spaceId: "booth",
      order: -1,
      canPost: false,
      threadable: true,
      needsYou: view.wallet.queue.some((t) => t.state === "held"),
      messages: msgs,
      unread: 0,
      decision: null,
      lastTs: Number.MAX_SAFE_INTEGER - 1,
    });
  }
  // The Inbox: cards and notes the story deals to this character
  // (`show <kind> … to <Character>` with no thread) — `dm:<me>` rows
  // addressed `@<me>`. A card still waiting on the booth bubbles it up.
  const inboxMsgs = all.filter((m) => m.channel === `dm:${me}` && mine(m)).sort(bySeq);
  const inbox: Channel = {
    id: INBOX,
    kind: "dm",
    title: "Inbox",
    subtitle: `cards and notes for ${me}`,
    spaceId: "booth",
    order: 1,
    messages: inboxMsgs,
    unread: 0,
    decision: null,
    needsYou: hasPendingCard(inboxMsgs, answered),
    lastTs: inboxMsgs.length ? inboxMsgs[inboxMsgs.length - 1]!.ts : 0,
  };
  return [scanner, inbox, feed, ...pinned, ...rooms, ...cast, ...guests];
}

/**
 * Guest-side agent chrome: a DM with an agent-voiced character says whether
 * anyone is answering, and shows "… is typing" while a reply is composed.
 * A character with a `hold:` line always answers (the story covers for a
 * missing worker), so its row never says "away": it previews the last
 * message like any other thread.
 */
export function withAgents(channels: Channel[], view: GuestView | null, typing: ReadonlyMap<string, string>): Channel[] {
  const agents = new Map((view?.people ?? []).filter((p) => p.agent !== undefined).map((p) => [`dm:${p.id}`, p.agent!]));
  return channels.map((c) => {
    const agent = agents.get(c.id);
    const who = typing.get(c.id);
    if (agent === undefined && who === undefined) return c;
    const presence = agent !== undefined && agent.hold !== true && c.subtitle === undefined;
    return {
      ...c,
      ...(presence ? { subtitle: agent.online ? "online" : "away — they'll answer when they're back" } : {}),
      ...(who !== undefined ? { typing: who } : {}),
    };
  });
}

export interface PrimeSession {
  auth: PrimeAuth | null;
  view: PrimeView | null;
  responses: Array<{ id: number; text: string }>;
  /** The alert that just landed — a `!` broadcast, or a readout the booth
   *  didn't ask for (the late list, a private warning) — until dismissed. */
  alert: Alert | null;
  dismissAlert: () => void;
  connected: boolean;
  /** The backlog has loaded — the rooms list is real, not a placeholder. */
  ready: boolean;
  /** Why the last sign-in ended under us (the show went live / the run
   *  ended) — shown on the sign-in screen until the performer signs in again. */
  notice: string | null;
  threads: Threads;
  login: (character: string, passcode: string) => Promise<void>;
  scan: (target: string) => Promise<unknown>;
  /** Hybrid chat: type into a channel as this character (reply via parentSeq). */
  say: (channel: string, text: string, parentSeq?: number) => Promise<unknown>;
  /** Access control: pull a guest into a membership-gated channel. */
  inviteToChannel: (person: string, channel: string) => Promise<unknown>;
  /** Leave a membership-gated channel. */
  leaveChannel: (channel: string) => Promise<unknown>;
  becomeAdmin: (passcode: string) => Promise<void>;
  /** Fire a performer / admin interaction on a guest, as this character. */
  act: (name: string, guest: string) => Promise<unknown>;
  /** Codex: hand one of the character's entries to a guest. */
  shareCodex: (entry: string, to: string) => Promise<unknown>;
  /** The approver's booth: settle a held transfer / deny one in its window. */
  walletApprove: (id: string) => Promise<unknown>;
  walletDeny: (id: string) => Promise<unknown>;
  moderate: (id: string, action: string, name?: string) => Promise<unknown>;
  setHidden: (seq: number, hidden: boolean) => Promise<unknown>;
  /** Answer a card the story dealt to this character (`show … to <Character>`). */
  answerWidget: (seq: number, result: WidgetResult) => Promise<void>;
  /** Cards (by seq) this booth has answered — rendered resolved, never re-asked. */
  widgetAnswers: ReadonlyMap<number, WidgetResult>;
  leave: () => void;
  /** A notification's room link is waiting to open (SW-PLAY-20). */
  roomLinkPending: boolean;
}

export function usePrimeSession(): PrimeSession {
  const host = usePlayHost();
  const { load, save, drop } = host.storage;
  const crawl = host.crawl;
  const [auth, setAuth] = useState<PrimeAuth | null>(() => {
    const stored = load<PrimeAuth>(PK);
    if (stored && !stored.eventId) stored.eventId = "default"; // migrate pre-multi-event sessions
    return stored;
  });
  const [view, setView] = useState<PrimeView | null>(null);
  const [responses, setResponses] = useState<Array<{ id: number; text: string }>>([]);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rid = useRef(0);
  const base = auth ? `/e/${encodeURIComponent(auth.eventId)}` : "";
  // The stream's character identity comes from the token server-side; the
  // token rides the URL because EventSource can't set headers.
  const url = auth ? `${base}/events?role=prime&token=${encodeURIComponent(auth.token)}` : null;
  /** The booth's sign-in is gone (the show went live / the run ended). */
  const dropBooth = useCallback((why: string | null) => {
    drop(PK);
    setAuth(null);
    setView(null);
    setResponses([]);
    setReady(false);
    setNotice(why);
    host.onEnded("prime", why);
  }, [drop, host]);
  const { typing, onTyping } = useTyping(auth !== null ? { role: "performer", character: auth.character } : null);
  // Booths get the guest's alerts (alerts.ts) plus N-07: a readout that
  // isn't the answer to this booth's own scan / act — the late list,
  // Trabolta's warning to Clippy — banners and chimes too.
  const alertsRef = useRef<ReturnType<typeof useAlerts> | null>(null);
  const lastActionAt = useRef(Number.NEGATIVE_INFINITY);
  /** The booth's own requests in flight: a readout while one is pending is
   *  its answer, however slow the network (a scan on cellular). */
  const inFlight = useRef(0);
  const { messages, connected } = useChatStream(url, {
    onSnapshot: (v) => setView(v as PrimeView),
    onTyping,
    onHistory: (list) => {
      alertsRef.current?.onHistory(list);
      crawl.loaded(maxSeqOf(list));
      setReady(true);
    },
    onResponse: (text) => {
      setResponses((r) => [{ id: rid.current++, text }, ...r]);
      if (inFlight.current === 0 && unsolicitedReadout(lastActionAt.current, Date.now())) alertsRef.current?.raise(text);
    },
    // Going live signs every performer out (rehearsal booths must not carry
    // into the show); a reset / reload keeps the character — the server just
    // re-sends the snapshot + history, which is then old news for alerts.
    onLifecycle: (n) => {
      if (lifecycleDropsSession(n.kind, SessionRole.Performer)) dropBooth(lifecycleNotice(n.kind, SessionRole.Performer));
      else {
        // B5: last run's readouts and answered cards are not tonight's. The
        // notice lands before the replay, so the new run's readouts follow.
        setResponses((r) => afterLifecycle(r, n.kind));
        if (lifecycleStartsNewRun(n.kind)) setWidgetAnswers(() => NO_ANSWERS);
        alertsRef.current?.rebase();
      }
    },
    // The stream closed for good: confirm the booth's token is really gone
    // (the show went live while the phone slept) before signing out.
    onDead: () => {
      if (auth === null) return;
      void tokenDead(base, "prime", auth.token).then((dead) => {
        if (dead) dropBooth(lifecycleNotice(dead === "ended" ? "ended" : "golive", SessionRole.Performer));
      });
    },
  });

  // Every action is scoped to the event this performer signed into. A 403
  // "sign in" answer means the token lost its character (go-live happened
  // while this phone wasn't listening) — drop the booth and say so.
  const post = useCallback(
    async <T,>(path: string, body?: unknown, token?: string): Promise<T> => {
      lastActionAt.current = Date.now();
      inFlight.current++;
      try {
        return await api<T>(`${base}${path}`, body, token);
      } catch (e) {
        if (e instanceof ApiError && auth !== null) {
          if (eventGone(e.status, e.message)) dropBooth(lifecycleNotice("ended", SessionRole.Performer));
          else if (performerSessionDead(e.status, e.message)) dropBooth(lifecycleNotice("golive", SessionRole.Performer));
        }
        throw e;
      } finally {
        inFlight.current--;
        lastActionAt.current = Date.now(); // the grace runs from the answer too
      }
    },
    [base, auth, dropBooth],
  );

  const login = useCallback(async (character: string, passcode: string) => {
    // Resolve the performer/mod code to its event, then sign in there.
    const { eventId, title } = await api<ResolvedCode>("/api/resolve-code", { code: passcode });
    const r = await api<{ token: string; character: string; admin: boolean }>(
      `/e/${encodeURIComponent(eventId)}/api/prime/login`,
      { character, passcode },
    );
    const a: PrimeAuth = { token: r.token, character: r.character, admin: !!r.admin, eventId, title };
    crawl.reset();
    save(PK, a);
    setAuth(a);
    setNotice(null);
  }, []);
  const scan = useCallback((target: string) => post("/api/scan", { target }, auth!.token), [post, auth]);
  const say = useCallback(
    (channel: string, text: string, parentSeq?: number) =>
      post("/api/prime/say", { channel, text, parentSeq }, auth!.token),
    [post, auth],
  );
  const inviteToChannel = useCallback(
    (person: string, channel: string) => post("/api/prime/channel/invite", { person, channel }, auth!.token),
    [post, auth],
  );
  const leaveChannel = useCallback(
    (channel: string) => post("/api/prime/channel/leave", { channel }, auth!.token),
    [post, auth],
  );
  const becomeAdmin = useCallback(
    async (passcode: string) => {
      const r = await api<{ token: string }>(`${base}/api/mod/login`, { passcode }, auth!.token);
      const a: PrimeAuth = { ...auth!, token: r.token, admin: true };
      save(PK, a);
      setAuth(a);
    },
    [base, auth],
  );
  const act = useCallback(
    (name: string, guest: string) => post("/api/prime/act", { name, guest }, auth!.token),
    [post, auth],
  );
  const shareCodex = useCallback(
    (entry: string, to: string) => post("/api/prime/codex/share", { entry, to }, auth!.token),
    [post, auth],
  );
  const moderate = useCallback(
    (id: string, action: string, name?: string) => post("/api/mod/act", { id, action, name }, auth!.token),
    [post, auth],
  );
  const walletCall = useCallback(
    async (sub: "approve" | "deny", id: string): Promise<unknown> => {
      try {
        return await post(`/api/prime/wallet/${sub}`, { id }, auth!.token);
      } catch (e) {
        if (e instanceof ApiError) {
          alertsRef.current?.raise(e.message, { quiet: true });
          return null;
        }
        throw e;
      }
    },
    [post, auth],
  );
  const walletApprove = useCallback((id: string) => walletCall("approve", id), [walletCall]);
  const walletDeny = useCallback((id: string) => walletCall("deny", id), [walletCall]);
  const setHidden = useCallback(
    (seq: number, hidden: boolean) => post("/api/mod/message", { seq, hidden }, auth!.token),
    [post, auth],
  );
  // Cards dealt to this character: one answer per card. The server refuses
  // a second (409); the snapshot lists the cards already answered so a
  // reload renders them resolved (an empty record marks each).
  // Held per sign-in like the guest's (B2): Go live, End and a dead token
  // drop the booth, the performer signs in again under a new token, and the
  // new run hands out the old run's seqs — last run's answers read empty.
  const [widgetAnswers, setWidgetAnswers] = usePerSession(auth?.token ?? null, NO_ANSWERS);
  const answeredList = view?.answered;
  useEffect(() => {
    if (answeredList === undefined || answeredList.length === 0) return;
    setWidgetAnswers((prev) => {
      if (answeredList.every((seq) => prev.has(seq))) return prev;
      const next = new Map(prev);
      for (const seq of answeredList) if (!next.has(seq)) next.set(seq, {});
      return next;
    });
  }, [answeredList]);
  const answerWidget = useCallback(
    async (seq: number, result: WidgetResult) => {
      setWidgetAnswers((prev) => new Map(prev).set(seq, result));
      try {
        await post("/api/prime/widget", { seq, result }, auth!.token);
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
    [post, auth],
  );
  const leave = useCallback(() => {
    // Sign out frees the part on the server too, so the same performer can
    // sign in from another phone (the iPhone Home Screen icon) without a
    // director's ⏏ Release. Fire-and-forget: signing out never waits.
    if (auth !== null) void api(`${base}/api/prime/logout`, {}, auth.token).catch(() => {});
    drop(PK);
    setAuth(null);
    setView(null);
    setResponses([]);
    setReady(false);
    setNotice(null);
    host.onEnded("prime", null);
  }, [drop, host, auth, base]);

  const boothFilter = useMemo(() => (auth !== null ? boothAlertFilter(auth.character) : undefined), [auth]);
  const alerts = useAlerts({
    messages,
    clock: view?.clock,
    session: auth?.token ?? null,
    storage: host.storage,
    storageKey: PRIME_ALERTS,
    sound: host.sound,
    // B1: never a guest's own `!` (the booth holds every guest's lobby lines).
    forMe: boothFilter,
  });
  alertsRef.current = alerts;
  const threads = useThreads(buildPrimeChannels(messages, view, new Set(widgetAnswers.keys())).map((c) => (typing.has(c.id) ? { ...c, typing: typing.get(c.id) } : c)));
  const roomLinkPending = useRoomLinks(threads, auth !== null && ready && view !== null, true);
  const landing = useLandingBrand();
  useTheme(auth === null ? landing.theme : view?.theme);
  return { auth, view, responses, alert: alerts.alert, dismissAlert: alerts.dismiss, connected, ready, notice, threads, login, scan, say, inviteToChannel, leaveChannel, becomeAdmin, act, shareCodex, walletApprove, walletDeny, moderate, setHidden, answerWidget, widgetAnswers, leave, roomLinkPending };
}
