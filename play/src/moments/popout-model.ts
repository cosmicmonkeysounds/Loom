//! The booth pop-out rung (wave 18, the moments lane; BOOTH-SPEC §2,
//! CONTRACTS C9): the pure part. A pop-out is the booth's big moment — a
//! Wanted poster, a door queue, a confrontation, a `!!` readout — docked
//! over the stream, never over an open card's face, handled by one of its
//! buttons (or retired by the booth when the story moots it), and kept in a
//! 🔔 tray across a reload when deferred with *Later*.
//!
//! The rules (§2.2), each a pure function or a reducer case, tested in
//! `test/moments-popout.test.tsx`: one on screen, replaced while unhandled
//! only by an alarm that outranks an info one shown ≥ 2 s (wave 37, C9:
//! `PREEMPT_GRACE_MS`); the queue by priority then age; a handled `{key, rev}` never
//! shows again until its `rev` changes; *Later* moves it to the tray; a
//! pop-out about the open card's guest waits. `popout.tsx` holds the store
//! and renders it (the booth's chunk); `popout-registry.ts` is the engine's
//! doorway to it.

import type { PopTone } from "../alerts.ts";
import type { MomentMessage } from "./model.ts";
import { noticeKey } from "../../../core/src/delivery.ts";

export type { PopTone } from "../alerts.ts";

/** The guest a pop-out is about (its picture block). */
export interface PopGuest {
  id: string;
  name: string;
  /** AvatarBook key; rendered with PersonAvatar. */
  avatar?: string | null;
  /** Display title, e.g. "The Desktop (living room)". */
  location?: string | null;
  /** Already formatted, e.g. "seen 2 min ago". */
  seen?: string | null;
}

/** One button. */
export interface PopAction {
  /** Unique within the pop-out. */
  id: string;
  /** Exact button text, glyph included. */
  label: string;
  /** primary = the full-width 56 px default button; secondary = 44 px (default). */
  kind?: "primary" | "secondary";
  /** First tap arms (ARM_MS 4 s, ARM_DEAD_MS 300 ms), the second runs. */
  arm?: boolean;
  /** Disabled for this long after the pop-out first shows. */
  deadMs?: number;
  /** The booth's handler; the shell shows "…" and disables every button until it settles. */
  run: () => void | Promise<unknown>;
  /** Default true: a run that resolves (not throws) marks the key handled. */
  closes?: boolean;
}

export interface PopOutSpec {
  /** Stable across reloads, e.g. "wanted:g-1cc709". */
  key: string;
  /** Content version: a handled key re-raised with a NEW rev shows again. */
  rev?: string;
  /** Caption icon, e.g. "🚨". */
  glyph: string;
  /** Caption text, e.g. "Wanted". */
  title: string;
  /** Paragraphs; plain text only. */
  body: string | string[];
  /** The picture block (96 px floating, 48 px docked). */
  guest?: PopGuest;
  /** Up to 4 extra guest lines (a burst). */
  rows?: PopGuest[];
  /** ≤ 4, in visual order; the shell adds "Later" unless `noLater`. */
  actions: PopAction[];
  noLater?: boolean;
  /** Caption colour + sound. */
  tone: PopTone;
  /** true: an unhandled one survives a reload (re-shown from storage even if not re-raised). */
  sticky: boolean;
  /** 0–100, higher first. */
  priority: number;
  /** A Win95 status-bar line under the buttons. */
  status?: string;
  /** Retire itself after this long on screen untouched. */
  autoRetireMs?: number;
  /** Wave 37 (C9): defer itself (as *Later*: into 🔔 Waiting) after this
   *  long on screen untouched. A re-raise with the same rev keeps it there. */
  autoLaterMs?: number;
  /** Default true; false = silent (no tone, no vibrate). */
  sound?: boolean;
  /** Story ms of the cause; orders equal priorities (older first). */
  at: number;
}

/** A pop-out in the store: its spec, and whether it came back from storage without its buttons. */
export interface PopEntry {
  spec: PopOutSpec;
  /** Restored from storage and not re-raised yet: its buttons are gone (only *OK* / *Later*). */
  restored?: boolean;
  /** Wall time it was deferred (the tray's "deferred 3 min ago"). */
  deferredAt?: number;
}

export interface PopState {
  /** Raised and waiting (or on screen), unhandled, not deferred. */
  live: PopEntry[];
  /** Deferred with *Later*, newest first. */
  tray: PopEntry[];
  /** Handled `{key, rev}` pairs, oldest first (persisted, cap `HANDLED_MAX`). */
  handled: Array<{ key: string; rev: string }>;
  /** The key on screen (it holds until handled, deferred or pre-empted). */
  shown: string | null;
  /** Wall ms it went on screen (wave 37, C9: the pre-emption grace); null = unknown (no grace). */
  shownAt: number | null;
}

export const EMPTY_POPOUTS: PopState = { live: [], tray: [], handled: [], shown: null, shownAt: null };
/** Wave 37 (C9): an alarm takes the screen from an info pop-out only once that one has been up this long. */
export const PREEMPT_GRACE_MS = 2_000;
/** How many handled pairs a sign-in remembers. */
export const HANDLED_MAX = 300;
/** At most this many buttons (before *Later*). */
export const POP_ACTIONS_MAX = 4;
/** A docked pop-out shows this many buttons (before *Later*). */
export const DOCK_ACTIONS_MAX = 3;

export type PopOp =
  /** `at`: wall ms (the shown one changing its rev in place starts its grace again). */
  | { type: "raise"; spec: PopOutSpec; at?: number }
  | { type: "retire"; key: string }
  | { type: "defer"; key: string; at: number }
  | { type: "restore"; key: string; at?: number }
  /** `at`: wall ms it went on screen (the pre-emption grace starts). */
  | { type: "show"; key: string | null; at?: number }
  | { type: "hydrate"; stored: StoredPopOuts }
  | { type: "reset" };

function revOf(s: Pick<PopOutSpec, "rev">): string {
  return s.rev ?? "";
}

function markHandled(handled: PopState["handled"], key: string, rev: string): PopState["handled"] {
  const out = handled.filter((h) => h.key !== key);
  out.push({ key, rev });
  return out.length > HANDLED_MAX ? out.slice(out.length - HANDLED_MAX) : out;
}

/** The queue order (§2.2 rule 2): priority desc, then the cause's age asc. */
export function popOrder(a: PopOutSpec, b: PopOutSpec): number {
  return b.priority - a.priority || a.at - b.at;
}

export function popReducer(s: PopState, a: PopOp): PopState {
  switch (a.type) {
    case "raise": {
      const spec = { ...a.spec, actions: a.spec.actions.slice(0, POP_ACTIONS_MAX) };
      const rev = revOf(spec);
      const done = s.handled.find((h) => h.key === spec.key);
      if (done !== undefined && done.rev === rev) return s;
      const handled = done !== undefined ? s.handled.filter((h) => h.key !== spec.key) : s.handled;
      const at = s.live.findIndex((e) => e.spec.key === spec.key);
      if (at >= 0) {
        // Idempotent by key: an existing one updates in place (buttons back after a reload).
        const live = s.live.slice();
        const was = live[at]!;
        live[at] = { spec };
        // Wave 37 (C9): the one on screen with new content (WANTED → YOURS)
        // is new to the eye: an alarm waits its full grace again.
        const fresh = s.shown === spec.key && revOf(was.spec) !== rev;
        return { ...s, live, handled, ...(fresh && a.at !== undefined ? { shownAt: a.at } : {}) };
      }
      const t = s.tray.findIndex((e) => e.spec.key === spec.key);
      if (t >= 0) {
        const was = s.tray[t]!;
        // A deferred one re-raised with a new rev comes back on screen; otherwise it just updates in the tray.
        if (revOf(was.spec) !== rev) return { ...s, tray: s.tray.filter((_, i) => i !== t), live: [...s.live, { spec }], handled };
        const tray = s.tray.slice();
        tray[t] = { spec, ...(was.deferredAt !== undefined ? { deferredAt: was.deferredAt } : {}) };
        return { ...s, tray, handled };
      }
      return { ...s, live: [...s.live, { spec }], handled };
    }
    case "retire": {
      const e = s.live.find((x) => x.spec.key === a.key) ?? s.tray.find((x) => x.spec.key === a.key);
      const rev = e !== undefined ? revOf(e.spec) : (s.handled.find((h) => h.key === a.key)?.rev ?? "");
      return {
        live: s.live.filter((x) => x.spec.key !== a.key),
        tray: s.tray.filter((x) => x.spec.key !== a.key),
        handled: markHandled(s.handled, a.key, rev),
        ...(s.shown === a.key ? { shown: null, shownAt: null } : { shown: s.shown, shownAt: s.shownAt }),
      };
    }
    case "defer": {
      const e = s.live.find((x) => x.spec.key === a.key);
      if (e === undefined) return s;
      return { ...s, live: s.live.filter((x) => x !== e), tray: [{ ...e, deferredAt: a.at }, ...s.tray], ...(s.shown === a.key ? { shown: null, shownAt: null } : {}) };
    }
    case "restore": {
      const e = s.tray.find((x) => x.spec.key === a.key);
      if (e === undefined) return s;
      const { deferredAt: _d, ...rest } = e;
      return { ...s, tray: s.tray.filter((x) => x !== e), live: [rest, ...s.live], shown: a.key, shownAt: a.at ?? null };
    }
    case "show":
      return s.shown === a.key ? s : { ...s, shown: a.key, shownAt: a.key !== null ? (a.at ?? null) : null };
    case "hydrate": {
      const handled = a.stored.handled.slice(-HANDLED_MAX);
      const isDone = (k: string, rev: string) => handled.some((h) => h.key === k && h.rev === rev);
      const have = new Set([...s.live, ...s.tray].map((e) => e.spec.key));
      const live = [...s.live];
      const tray = [...s.tray];
      for (const k of a.stored.kept) {
        if (have.has(k.spec.key) || isDone(k.spec.key, revOf(k.spec))) continue;
        const spec: PopOutSpec = { ...k.spec, actions: [] };
        if (k.deferredAt !== undefined) tray.push({ spec, restored: true, deferredAt: k.deferredAt });
        else live.push({ spec, restored: true });
      }
      tray.sort((x, y) => (y.deferredAt ?? 0) - (x.deferredAt ?? 0));
      return { live, tray, handled: [...handled, ...s.handled.filter((h) => !handled.some((x) => x.key === h.key))].slice(-HANDLED_MAX), shown: s.shown, shownAt: s.shownAt };
    }
    case "reset":
      return EMPTY_POPOUTS;
  }
}

/** The best waiting alarm that outranks the info pop-out `held` (wave 37, C9), grace aside. */
function rivalOf(s: PopState, held: PopEntry, ok: (e: PopEntry) => boolean): PopEntry | null {
  if (held.spec.tone === "alarm") return null;
  let best: PopEntry | null = null;
  for (const e of s.live)
    if (e !== held && ok(e) && e.spec.tone === "alarm" && e.spec.priority > held.spec.priority && (best === null || popOrder(e.spec, best.spec) < 0)) best = e;
  return best;
}

const okFor = (blockedGuest: string | null) => (e: PopEntry) => blockedGuest === null || e.spec.guest?.id !== blockedGuest;

/**
 * The pop-out on screen (§2.2 rules 1, 2, 7): the one already shown while
 * it is live; else the first in queue order. One about the open card's
 * guest (`blockedGuest`) waits; the next one shows instead. Wave 37 (C9):
 * an alarm that outranks a shown info pop-out takes the screen once that
 * one has been up `PREEMPT_GRACE_MS` (it stays live and shows again later).
 */
export function currentOf(s: PopState, blockedGuest: string | null = null, now: number = Date.now()): PopEntry | null {
  const ok = okFor(blockedGuest);
  const held = s.shown !== null ? s.live.find((e) => e.spec.key === s.shown) : undefined;
  if (held !== undefined && ok(held)) {
    const rival = rivalOf(s, held, ok);
    return rival !== null && (s.shownAt === null || now - s.shownAt >= PREEMPT_GRACE_MS) ? rival : held;
  }
  let best: PopEntry | null = null;
  for (const e of s.live) if (ok(e) && (best === null || popOrder(e.spec, best.spec) < 0)) best = e;
  return best;
}

/** When a waiting pre-emption is due (wall ms), if only the grace holds it back; else null. */
export function preemptDueAt(s: PopState, blockedGuest: string | null = null, now: number = Date.now()): number | null {
  if (s.shownAt === null || s.shown === null) return null;
  const ok = okFor(blockedGuest);
  const held = s.live.find((e) => e.spec.key === s.shown);
  if (held === undefined || !ok(held) || rivalOf(s, held, ok) === null) return null;
  const due = s.shownAt + PREEMPT_GRACE_MS;
  return due > now ? due : null;
}

/** How many wait behind the one on screen (the pager's n − 1). */
export function queuedOf(s: PopState, current: PopEntry | null): number {
  return s.live.length - (current !== null ? 1 : 0);
}

/** The pager: "1 of 3" when others wait, else nothing. */
export function pagerOf(queued: number): string | null {
  return queued > 0 ? `1 of ${queued + 1}` : null;
}

/** A pop-out's spec as storage keeps it (no handlers). */
export type StoredSpec = Omit<PopOutSpec, "actions">;
export interface StoredPopOuts {
  handled: Array<{ key: string; rev: string }>;
  /** The sticky live ones and every deferred one. */
  kept: Array<{ spec: StoredSpec; deferredAt?: number }>;
}

/** Where a sign-in's pop-outs persist. */
export function popKey(session: string): string {
  return `loom.popouts.${session}`;
}

/** What to persist: the handled pairs, the sticky unhandled ones, the tray. */
export function storedOf(s: PopState): StoredPopOuts {
  const strip = (spec: PopOutSpec): StoredSpec => {
    const { actions: _a, ...rest } = spec;
    return rest;
  };
  return {
    handled: s.handled.slice(-HANDLED_MAX),
    kept: [
      ...s.live.filter((e) => e.spec.sticky).map((e) => ({ spec: strip(e.spec) })),
      ...s.tray.map((e) => ({ spec: strip(e.spec), ...(e.deferredAt !== undefined ? { deferredAt: e.deferredAt } : {}) })),
    ],
  };
}

/** Read stored pop-outs, defensively (a hand-edited or older shape → nothing). */
export function parseStored(v: unknown): StoredPopOuts {
  const out: StoredPopOuts = { handled: [], kept: [] };
  if (typeof v !== "object" || v === null) return out;
  const o = v as { handled?: unknown; kept?: unknown };
  if (Array.isArray(o.handled))
    for (const h of o.handled) {
      const x = h as { key?: unknown; rev?: unknown };
      if (typeof x?.key === "string") out.handled.push({ key: x.key, rev: typeof x.rev === "string" ? x.rev : "" });
    }
  if (Array.isArray(o.kept))
    for (const k of o.kept) {
      const x = k as { spec?: Partial<StoredSpec>; deferredAt?: unknown };
      const sp = x?.spec;
      if (sp === undefined || typeof sp.key !== "string" || typeof sp.title !== "string") continue;
      out.kept.push({
        spec: {
          key: sp.key,
          ...(typeof sp.rev === "string" ? { rev: sp.rev } : {}),
          glyph: typeof sp.glyph === "string" ? sp.glyph : "ℹ",
          title: sp.title,
          body: typeof sp.body === "string" || Array.isArray(sp.body) ? sp.body : "",
          ...(sp.guest !== undefined ? { guest: sp.guest } : {}),
          ...(Array.isArray(sp.rows) ? { rows: sp.rows } : {}),
          tone: sp.tone === "alarm" || sp.tone === "win" ? sp.tone : "info",
          sticky: sp.sticky === true,
          priority: typeof sp.priority === "number" ? sp.priority : 50,
          at: typeof sp.at === "number" ? sp.at : 0,
          ...(typeof sp.status === "string" ? { status: sp.status } : {}),
          ...(sp.noLater === true ? { noLater: true } : {}),
        },
        ...(typeof x.deferredAt === "number" ? { deferredAt: x.deferredAt } : {}),
      });
    }
  return out;
}

/** "deferred 3 min ago" (the tray's rows). */
export function deferredText(at: number | undefined, now: number): string {
  if (at === undefined) return "waiting";
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  return min < 1 ? "deferred just now" : `deferred ${min} min ago`;
}

/** A pop-out's body as paragraphs. */
export function paragraphs(body: string | string[]): string[] {
  return (Array.isArray(body) ? body : [body]).map((p) => p.trim()).filter((p) => p !== "");
}

/** How long a 🔔 Waiting row's text runs (wave 37, C8). */
export const TRAY_LINE_MAX = 60;

/** A 🔔 Waiting row's text: the body's first paragraph, cut to 60 characters; null when it has none. */
export function trayLine(body: string | string[]): string | null {
  const p = paragraphs(body)[0];
  if (p === undefined) return null;
  // Cut on code points: an emoji astride the cut never leaves half of itself.
  const cps = Array.from(p);
  return cps.length <= TRAY_LINE_MAX ? p : `${cps.slice(0, TRAY_LINE_MAX - 1).join("").trimEnd()}…`;
}

/** The docked strip's words: "{glyph} {title}: {guest} · 📍 {location}". */
export function stripText(s: Pick<PopOutSpec, "glyph" | "title" | "guest">): string {
  const who = s.guest !== undefined ? `: ${s.guest.name}` : "";
  const where = s.guest?.location ? ` · 📍 ${s.guest.location}` : "";
  return `${s.glyph} ${s.title}${who}${where}`;
}

// --- the booth's messages → pop-outs (§2.3) ----------------------------------

/** What the booth's adapter answers for a message: a spec, nothing at all, or the generic pop-out. */
export type PopOutVerdict = PopOutSpec | null | "default";
export type PopOutAdapter = (m: MomentMessage) => PopOutVerdict;

/**
 * The generic pop-out for a message (§2.3 "default"): key `msg:<seq>`, the
 * text's leading glyph (else ℹ) and the rest, the guest it is about, one
 * button (🗂 Open card when it names a guest, else its room), alarm for a
 * big one, info for a `!` one; sticky; priority 80 / 60.
 */
export function defaultPopOut(m: MomentMessage, ctx: { openCard?: (guestId: string) => void; openRoom?: (room: string) => void }): PopOutSpec {
  const big = m.moment === "big";
  const glyph = noticeKey(m.text);
  const body = (glyph !== "•" ? m.text.trim().slice(glyph.length) : m.text).trim();
  const about = typeof m.about === "string" && m.about !== "" ? m.about : null;
  const actions: PopAction[] = [];
  if (about !== null && ctx.openCard !== undefined) {
    const open = ctx.openCard;
    actions.push({ id: "card", label: "🗂 Open card", kind: "primary", run: () => open(about) });
  } else if (ctx.openRoom !== undefined && m.channel !== "lobby") {
    const open = ctx.openRoom;
    const room = m.channel;
    actions.push({ id: "room", label: "Open the room ›", kind: "primary", run: () => open(room) });
  }
  return {
    key: `msg:${m.seq}`,
    glyph: glyph !== "•" ? glyph : "ℹ",
    title: "Readout",
    body,
    ...(about !== null ? { guest: { id: about, name: m.aboutName ?? about, ...(m.aboutAvatar !== undefined ? { avatar: m.aboutAvatar } : {}) } } : {}),
    actions,
    tone: big ? "alarm" : "info",
    sticky: true,
    priority: big ? 80 : 60,
    at: m.ts,
  };
}
