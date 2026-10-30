//! The map page asks for the moderator passcode again (OCT31 W-15, a cheap
//! stand-in for SW-MAP-11): the device's stored token is full admin, so the
//! first save, Save to project or tent ⇄ shed switch in a page load waits
//! for the passcode, checked against `/api/resolve-code` (a moderator code
//! for this device's event). Once it checks out the page stays unlocked
//! until it is reloaded; the token itself is untouched. A page that has been
//! given the passcode already starts open: a `?code=` link, or Run → House →
//! 🗺 Map, where the author's own session is the unlock.
//!
//! Also the map's key rules, pure: which keys are the map's, and where a key
//! really landed once the editor sits in a shadow root.

import { api, ApiError } from "@loom/play/client.ts";
import { TOOLS } from "./tools.ts";

/** Resolve a code the way the server does: `{eventId, role}`, throwing an `ApiError` on a miss. */
export type ResolveCode = (code: string) => Promise<{ eventId?: unknown; role?: unknown }>;

const resolveCode: ResolveCode = (code) => api("/api/resolve-code", { code });

/** Is `code` the moderator passcode of `eventId`? null when it is, else what to tell the director. */
export async function checkModCode(code: string, eventId: string, resolve: ResolveCode = resolveCode): Promise<string | null> {
  const typed = code.trim();
  if (typed === "") return "Type the moderator passcode.";
  let r: { eventId?: unknown; role?: unknown };
  try {
    r = await resolve(typed);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return "That isn't the moderator passcode.";
    if (e instanceof ApiError && e.status === 429) return "Too many tries — wait a minute, then try again.";
    return `Couldn't check the passcode (${(e as Error).message}).`;
  }
  if (r.role !== "mod") return "That isn't the moderator passcode.";
  if (r.eventId !== eventId) return "That passcode is for another event.";
  return null;
}

/**
 * The page's lock. `ensure(ask)` resolves true once a passcode checks out
 * (now, or earlier in this page load); `ask` is shown the last error and
 * resolves to the typed code, or null when the director cancels — then
 * `ensure` resolves false and the write must not happen.
 */
export class MapUnlock {
  private unlocked: boolean;
  private pending: Promise<boolean> | null = null;
  private readonly verify: (code: string) => Promise<string | null>;

  /** `open`: the passcode isn't asked for at all. */
  constructor(verify: (code: string) => Promise<string | null>, open = false) {
    this.verify = verify;
    this.unlocked = open;
  }

  get open(): boolean {
    return this.unlocked;
  }

  ensure(ask: (error: string | null) => Promise<string | null>): Promise<boolean> {
    if (this.unlocked) return Promise.resolve(true);
    // Two writes at once (a save on the way to Save to project) share one ask.
    if (this.pending !== null) return this.pending;
    this.pending = (async () => {
      let error: string | null = null;
      for (;;) {
        const code = await ask(error);
        if (code === null) return false;
        error = await this.verify(code);
        if (error === null) {
          this.unlocked = true;
          return true;
        }
      }
    })().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}

/**
 * Does the map editor's window key handler take this key? Never in a text
 * field, and never while the passcode dialog is up: its input is disabled
 * while a code is checked, so the browser drops focus to the page and a
 * Backspace meant for the code would delete the selected room.
 */
export function editorTakesKey(k: { typing: boolean; editing: boolean; asking: boolean }): boolean {
  return k.editing && !k.typing && !k.asking;
}

/** Where a key really landed: at the window, `e.target` of a key inside a
 *  shadow root is the shadow host. */
export function keyOrigin(e: Pick<Event, "composedPath" | "target">): EventTarget | null {
  return e.composedPath()[0] ?? e.target;
}

/** A key landing in a field that takes text (not a checkbox or a button). */
export function isTyping(target: EventTarget | null): boolean {
  const t = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown } | null;
  if (t === null || typeof t.tagName !== "string") return false;
  if (t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable === true) return true;
  return t.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "color", "range"].includes(String(t.type));
}

const MOVE_KEYS = ["Escape", "Delete", "Backspace", "[", "]", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

/** The keys the map answers to (`MapEditor`'s handler), in or out of a field:
 *  embedded, these stop at the map and never reach the host page's shortcuts. */
export function mapAnswersKey(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): boolean {
  const key = e.key.toLowerCase();
  if (e.metaKey || e.ctrlKey) return key === "z" || key === "y" || key === "d";
  if (e.altKey) return false;
  return MOVE_KEYS.includes(e.key) || TOOLS.some((t) => t.key === key);
}
