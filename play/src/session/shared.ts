//! What both role sessions share (moved out of `session.ts` in wave 13):
//! resolving a code, the sign-in pickers, the landing brand, the document
//! title + theme, the dead-token probe, notification room links, and state
//! scoped to one sign-in.

import { useCallback, useEffect, useRef, useState } from "react";
import { DOORS_POLL_MS, type Identities, type ProgramHit, type ProgramPictures } from "../avatars.ts";
import { claimField } from "../claim.ts";
import { ApiError, api, type StreamVerdict } from "../client.ts";
import { usePlayHost } from "../host.ts";
import { eventGone } from "../lifecycle.ts";
import { roomFromMessage, roomFromSearch, roomTarget, withoutRoom } from "../room.ts";
import type { Threads } from "../rooms/threads-state.ts";
import type { WidgetResult } from "../widgets.tsx";

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
 *  event falls back to a fresh resolve. An invitation's `claim` rides
 *  along, so its reserved program reads as open to this caller. */
export async function fetchIdentities(code: string, known?: KnownEvent, claim?: string | null): Promise<IdentityLookup> {
  if (known !== undefined) {
    const again = await identitiesOf(code, known, known.role, undefined, claim);
    if (again !== "gone") return again;
  }
  const r = await resolveOrBusy(code);
  if (r === "busy") return { kind: "busy" };
  if (r === null) return { kind: "unknown" };
  const out = await identitiesOf(code, r, r.role, r.characters, claim);
  return out === "gone" ? { kind: "unknown" } : out;
}

async function identitiesOf(code: string, ev: KnownEvent, role: string, characters?: string[], claim?: string | null): Promise<IdentityLookup | "gone"> {
  try {
    const ids = await api<Identities>(`/e/${encodeURIComponent(ev.eventId)}/api/identities`, { passcode: code, ...claimField(claim) });
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
export function retryDelay(kind: "closed" | "busy" | "reserved", attempt: number): number {
  if (kind === "busy") return Math.min(30_000, 10_000 * (attempt + 1));
  if (kind === "reserved") return RESERVED_POLL_MS;
  return attempt < 12 ? DOORS_POLL_MS : 15_000;
}

/** How often an open picker showing a 🔒 Reserved tile re-asks: a
 *  director's "Unlock for 2 min" (`/api/mod/claim/unlock`) opens it to the
 *  guest standing at the join screen without a reload. */
export const RESERVED_POLL_MS = 12_000;

type Picker = Extract<IdentityLookup, { kind: "ok" }>;

/** Why an answer is asked again: the doors are closed, the server is busy,
 *  a tile is still 🔒 Reserved (a director may open it), or not at all. */
export function reaskReason(r: IdentityLookup, waiting: (ids: Picker) => boolean): "closed" | "busy" | "reserved" | null {
  if (r.kind === "busy") return "busy";
  if (r.kind !== "ok") return null;
  if (waiting(r)) return "closed";
  return r.identities.some((row) => row.reserved === true && !row.claimed) ? "reserved" : null;
}

/**
 * The join screens' picker for a typed / scanned code, kept fresh. A code
 * answered `waiting` (the doors are closed), or showing a 🔒 Reserved tile,
 * is re-asked on `retryDelay` straight at its event, never through the
 * throttled resolve; a busy
 * server keeps the last good screen and backs off. `refresh` re-asks now
 * (someone may have just taken a name). `claim`: an invitation's token.
 */
export function useIdentities(code: string, waiting: (ids: Picker) => boolean, claim?: string | null): { ids: IdentityLookup | null | "loading"; busy: boolean; refresh: () => void } {
  const [ids, setIds] = useState<IdentityLookup | null | "loading">(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const known = useRef<{ code: string; event: KnownEvent } | null>(null);
  const streak = useRef<{ kind: "closed" | "busy" | "reserved"; n: number }>({ kind: "closed", n: 0 });
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
    void fetchIdentities(c, event, claim).then((r) => {
      if (!alive) return;
      const again = reaskReason(r, waitingRef.current);
      if (r.kind === "busy") {
        setBusy(true);
        setIds((prev) => (keep(prev) ? prev : null));
      } else {
        setBusy(false);
        setIds(r);
        known.current = r.kind === "ok" ? { code: c, event: { eventId: r.eventId, title: r.title, role: r.role } } : null;
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
  }, [code, reload, claim]);
  const refresh = useCallback(() => setReload((x) => x + 1), []);
  return { ids, busy, refresh };
}

/** The pictures a guest may choose for a program before signing in: one of
 *  the story's (`name`) or a directory pick (`wiki` = its article title). */
export async function fetchPictures(eventId: string, code: string, pick: { name: string } | { wiki: string }, claim?: string | null): Promise<ProgramPictures> {
  return api<ProgramPictures>(`/e/${encodeURIComponent(eventId)}/api/identities/pictures`, { passcode: code, ...pick, ...claimField(claim) });
}

/** Search the program directory (any software; antivirus flagged). */
export async function searchPrograms(eventId: string, code: string, q: string, claim?: string | null): Promise<ProgramHit[]> {
  const r = await api<{ results: ProgramHit[] }>(`/e/${encodeURIComponent(eventId)}/api/identities/search`, { passcode: code, q, ...claimField(claim) });
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
export async function tokenDead(base: string, role: "guest" | "prime", token: string): Promise<StreamVerdict> {
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

/** `/api/guest/register`'s body: the program, the code, a directory pick's
 *  title, the chosen picture, and an invitation's claim — each only when set. */
export function registerBody(name: string, code: string, wiki?: string, picture?: string, claim?: string | null): Record<string, string> {
  return { name, passcode: code, ...(wiki !== undefined ? { wiki } : {}), ...(picture !== undefined ? { picture } : {}), ...claimField(claim) };
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
    // The phone's status bar wears the title bar's colour (wave 13): navy
    // under aol97, the plain navy (index.html's own value) otherwise.
    if (host.ownsPage && typeof document !== "undefined" && typeof getComputedStyle === "function") {
      setThemeColor(document.querySelector('meta[name="theme-color"]'), getComputedStyle(el).getPropertyValue("--navy"));
    }
  }, [host, theme, active]);
}

/** Point `<meta name="theme-color">` at the theme's title-bar colour (the
 *  `--navy` token, as computed). A missing meta or an empty token is left alone. */
export function setThemeColor(meta: Pick<Element, "setAttribute"> | null, navy: string): void {
  const colour = navy.trim();
  if (meta !== null && colour !== "") meta.setAttribute("content", colour);
}

/**
 * SW-PLAY-20: a tapped notification opens its room — `?room=` on a fresh
 * window, the service worker's `open-room` message on one already open
 * (listened for only when the app owns the page: never in Run → Players).
 * Applied once signed in with the backlog in, and only to a room this
 * participant lists; otherwise dropped. Returns whether a link is still
 * waiting (the wide-screen home default holds off until it has run).
 */
export function useRoomLinks(threads: Threads, signedIn: boolean, booth: boolean): boolean {
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
export function usePerSession<T>(session: string | null, empty: T): [T, (f: (prev: T) => T) => void] {
  const [held, setHeld] = useState<PerSession<T>>(() => ({ session, value: empty }));
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const update = useCallback((f: (prev: T) => T) => setHeld((h) => perSessionUpdate(h, sessionRef.current, empty, f)), [empty]);
  return [perSessionValue(held, session, empty), update];
}

export const NO_ANSWERS: ReadonlyMap<number, WidgetResult> = new Map();

/** The cards answered: this device's own answers, plus every card the
 *  server's view says is answered (an empty record — the result itself is
 *  not replayed). Computed in the render, so a new sign-in's first pass
 *  (the big-moment sweep) never sees the server's answered cards as open
 *  (N1). Returns `local` itself when it already holds every one. */
export function mergeAnswered(local: ReadonlyMap<number, WidgetResult>, server: readonly number[] | undefined): ReadonlyMap<number, WidgetResult> {
  if (server === undefined || server.every((seq) => local.has(seq))) return local;
  const next = new Map(local);
  for (const seq of server) if (!next.has(seq)) next.set(seq, {});
  return next;
}
