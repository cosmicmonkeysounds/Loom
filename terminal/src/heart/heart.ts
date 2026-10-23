//! The heart terminal's rules (wave 20, CONTRACT-w20 §1.4, §3, §7): which of a
//! piloted program's menus is the heart's, how its options read, when the
//! composer shows, and which room scenes end the line. Pure; the panel
//! (`ChoicePanel.tsx`), the overlay and the app read it.
//!
//! - **The heart menu** (D18): the newest entry of the guest view's `choices`
//!   whose channel is `dm:<character>` and whose beat folds to start with
//!   `heart ` — never `pendingChoice`, which is the oldest menu and may be a
//!   stale one (The Tablet Video's *Where is the exit?*).
//! - **Tags**: a leading `⟦WORD⟧` is drawn as a chip (never `[…]`: in a
//!   choice that is hidden text).
//! - **The heart to heart** (D24, D28): `⟦SPEAK FREELY⟧` is an option like any
//!   other; the one-option `⟦BACK⟧` menu it docks means "talking freely": the
//!   composer shows, focused, with ⟦BACK⟧ small under it.
//! - **The composer** (D23): shown when this terminal has a keyboard (`keys`),
//!   except while a heart menu other than the ⟦BACK⟧ menu is docked.

import { foldName } from "../config.ts";

export interface HeartMenu {
  id: number;
  beat: string;
  channel: string;
  options: string[];
}

/** The guest view's menus, read generously (an older server sends none). */
export function menusOf(view: unknown): HeartMenu[] {
  const raw = typeof view === "object" && view !== null ? (view as { choices?: unknown }).choices : undefined;
  if (!Array.isArray(raw)) return [];
  const out: HeartMenu[] = [];
  for (const x of raw) {
    if (typeof x !== "object" || x === null) continue;
    const r = x as Record<string, unknown>;
    if (typeof r["id"] !== "number" || typeof r["beat"] !== "string" || typeof r["channel"] !== "string" || !Array.isArray(r["options"])) continue;
    out.push({ id: r["id"], beat: r["beat"], channel: r["channel"], options: r["options"].filter((o): o is string => typeof o === "string") });
  }
  return out;
}

/** Is this menu one of the heart's (its beat `Heart …`)? */
export function isHeartBeat(beat: string): boolean {
  return foldName(beat).startsWith("heart ");
}

/** The heart menu docked for the piloted program at this terminal, or null. */
export function heartMenuOf(menus: readonly HeartMenu[], character: string): HeartMenu | null {
  const channel = `dm:${character}`;
  let best: HeartMenu | null = null;
  for (const m of menus) {
    if (m.channel !== channel || !isHeartBeat(m.beat) || m.options.length === 0) continue;
    if (best === null || m.id > best.id) best = m;
  }
  return best;
}

/** `⟦PROOF⟧ Hold it up.` → `{tag: "PROOF", text: "Hold it up."}`; no tag → `tag` null. */
export function splitTag(option: string): { tag: string | null; text: string } {
  const m = /^\s*⟦([^⟧]{1,40})⟧\s*(.*)$/u.exec(option);
  return m === null ? { tag: null, text: option.trim() } : { tag: m[1]!.trim(), text: m[2]!.trim() };
}

/** The ⟦BACK⟧ menu of a heart to heart: the program is talking freely. */
export function isChatMenu(menu: HeartMenu | null): boolean {
  return menu !== null && menu.options.length === 1 && foldName(splitTag(menu.options[0]!).tag ?? "") === "back";
}

/** Does the composer show? `keys` false = a mouse-only rig: never. */
export function composerShown(o: { keys: boolean; menu: HeartMenu | null }): boolean {
  if (!o.keys) return false;
  return o.menu === null || isChatMenu(o.menu);
}

/** The panel's state: what it shows and whether its options take a click. */
export interface PanelModel {
  menu: HeartMenu;
  options: Array<{ index: number; raw: string; tag: string | null; text: string }>;
  /** The door is open: options greyed under *CLOSE THE DOOR*. */
  greyed: boolean;
  /** The ⟦BACK⟧ menu: drawn small, under the composer. */
  chat: boolean;
}

export function panelModel(menu: HeartMenu | null, doorOpen: boolean | null): PanelModel | null {
  if (menu === null) return null;
  return { menu, options: menu.options.map((raw, index) => ({ index, raw, ...splitTag(raw) })), greyed: doorOpen === true, chat: isChatMenu(menu) };
}

/** `/api/guest/choose` for one option of the docked menu (D15, D18). */
export function chooseBody(menu: HeartMenu, index: number): { index: number; text: string; choice: number } {
  return { index, text: menu.options[index] ?? "", choice: menu.id };
}

/** A pick's 409 (the menu moved under the click, or is gone): read the next view, never retry. */
export function isStaleChoice(status: number, error: string | null): boolean {
  return status === 409 && (error === "moved" || error === "no choice");
}

// --- the room scenes that end a line ---------------------------------------------------

/** How long each heart room scene plays (ms; §3.8): the scenes and the app share it. */
export const HEART_SCENE_MS = {
  heart_wake: 14_000,
  heart_sealed: 8_000,
  heart_sealed_present: 6_000,
  heart_layer: 3_000,
  heart_proof: 6_000,
  heart_warn: 3_000,
  heart_eject: 8_000,
  heart_notyet: 6_000,
  heart_leave: 3_000,
  heart_shutdown: 25_000,
} as const;

/**
 * Does this room cue end the pilot once its scene has played, and how?
 * Being thrown out always does (D24: no heart to heart after an eject).
 * *Not yet* and *Leave* end the tree, not the line: with a keyboard the
 * program may keep talking (the heart to heart) until the leash; a mouse-only
 * rig (`keys` false) has nothing left to do, so the line ends there.
 */
export function pilotEndFor(cue: string, keys: boolean): { why: "thrown" | "done"; ms: number } | null {
  if (cue === "room_heart_eject") return { why: "thrown", ms: HEART_SCENE_MS.heart_eject };
  if (keys) return null;
  if (cue === "room_heart_notyet") return { why: "done", ms: HEART_SCENE_MS.heart_notyet };
  if (cue === "room_heart_leave") return { why: "done", ms: HEART_SCENE_MS.heart_leave };
  return null;
}

/**
 * Has a heart scene played for this line (a `room_heart_*` cue since it
 * opened)? Then the long leash holds. After *not yet* or a Leave the tree is
 * over: the normal leash runs (a program who walks off frees the terminal in
 * 30 s), and the long one comes back only once they type after it (the heart
 * to heart, D24). `typedAfter`: the program has typed a line since that cue.
 */
export function heartTouched(cue: { value: string; at: number } | null, since: number, typedAfter = false): boolean {
  if (cue === null || cue.at <= 0 || cue.at < since || !cue.value.startsWith("room_heart_") || cue.value === "room_heart_eject") return false;
  if (cue.value === "room_heart_notyet" || cue.value === "room_heart_leave") return typedAfter;
  return true;
}

/** Is this the heart terminal (the door overlay, the greyed menu)? One with a door sensor, or the server room's own room terminal. */
export function isHeartTerminal(room: string | null, door: string): boolean {
  return door !== "off" || (room !== null && foldName(room) === foldName(HEART_ROOM));
}

/** The LOCATION the heart lives in. */
export const HEART_ROOM = "The Server Room";

/** Does the door overlay show? The door open while the heart wants it shut. */
export function doorOverlayOn(doorOpen: boolean | null, stage: string | null): boolean {
  return doorOpen === true && (stage === "door" || stage === "scan" || stage === "talk");
}
