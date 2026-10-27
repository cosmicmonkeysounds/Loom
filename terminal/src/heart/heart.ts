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

import { ApiError, RequestTimeout } from "@loom/play/client.ts";
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

/** Does the composer show? `keys` false = a mouse-only rig: never.
 *  `blocked` (wave 27, `composerBlocked`): an eject, a proof or the
 *  shutdown is on screen, or the heart is done — nothing to type into. */
export function composerShown(o: { keys: boolean; menu: HeartMenu | null; blocked?: boolean }): boolean {
  if (!o.keys || o.blocked === true) return false;
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
 * The pilot's end for the room cue now showing, or null: only a cue raised
 * since this line opened counts (`since`, server time), and an eject ends it
 * whether or not a menu ever docked — a barred program's re-scan (Heart
 * Barred) gets no heart to heart either (D24).
 */
export function pilotEndOf(cue: { value: string; at: number } | null, since: number, keys: boolean): { why: "thrown" | "done"; ms: number } | null {
  if (cue === null || cue.at <= 0 || cue.at < since) return null;
  return pilotEndFor(cue.value, keys);
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

/**
 * What the panel says when a pick didn't go through (null: say nothing — the
 * menu moved under the click, and the next view redraws it). Never "door":
 * at the heart that reads as the server-room door.
 */
export function chooseErrorText(e: unknown): string | null {
  if (e instanceof RequestTimeout) return "DIDN'T SEND — TRY AGAIN";
  if (e instanceof ApiError) {
    if (isStaleChoice(e.status, e.message)) return null;
    if (e.status === 409) return "NOT NOW — HE IS PAUSED";
    if (e.status === 401 || e.status === 404) return "THE LINE WAS CUT";
  }
  return `DIDN'T SEND — ${(e as Error)?.message?.toUpperCase?.() ?? "TRY AGAIN"}`;
}

/** How long a pick may take before the panel says so (ms). */
export const CHOOSE_TIMEOUT_MS = 15_000;

/** Does the door overlay show? The door open while the heart wants it shut. */
export function doorOverlayOn(doorOpen: boolean | null, stage: string | null): boolean {
  return doorOpen === true && (stage === "door" || stage === "scan" || stage === "talk");
}

// --- wave 27: the first meeting, at the terminal ----------------------------------------

/** The layer cards' titles (the `room_heart_layer_n` scene and the panel's header). */
export const LAYER_TITLES = ["WHO ARE YOU", "WHAT I AM", "THE ARGUMENT", "THE ASK"] as const;

const LAYER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, "1": 1, "2": 2, "3": 3, "4": 4 };

/** `Heart Layer Three` → 3; any other beat (Heart Talk, Heart Speak …) → null. */
export function layerOfBeat(beat: string): number | null {
  const m = /^heart layer (\w+)/u.exec(foldName(beat));
  return m === null ? null : (LAYER_WORDS[m[1]!] ?? null);
}

/** `room_heart_layer_2` → 2; any other cue → null. */
export function layerOfCue(value: string): number | null {
  const m = /^room_heart_layer_([1-4])$/u.exec(value);
  return m === null ? null : Number(m[1]);
}

/** The panel's header: `LAYER 3 / 4 · THE ARGUMENT`, or "" with no layer known. */
export function layerLabel(layer: number | null): string {
  if (layer === null || layer < 1 || layer > 4) return "";
  return `LAYER ${layer} / 4 · ${LAYER_TITLES[layer - 1]}`;
}

/** How long the room scene a `room_heart_*` cue plays (ms), or null for any other cue. */
export function heartSceneMs(value: string): number | null {
  if (!value.startsWith("room_heart_")) return null;
  const id = value.slice("room_".length);
  if (/^heart_layer_[1-4]$/u.test(id)) return HEART_SCENE_MS.heart_layer;
  return (HEART_SCENE_MS as Record<string, number>)[id] ?? null;
}

/** How much longer (ms) the heart scene of this line is on screen at `now` (server
 *  clock): 0 when none plays, or its cue came before the line opened (`since`). */
export function heartSceneLeft(cue: { value: string; at: number } | null, since: number, now: number): number {
  if (cue === null || cue.at <= 0 || cue.at < since) return 0;
  const ms = heartSceneMs(cue.value);
  return ms === null ? 0 : Math.max(0, cue.at + ms - now);
}

/** A new menu waits this long before it takes a pick (ms): the reply it came with lands first. */
export const PANEL_SETTLE_MS = 700;
/** A voice that never drains (a stuck engine) holds a menu no longer than this (ms). */
export const PANEL_WAIT_CAP_MS = 20_000;

export type PanelWait = "voice" | "scene" | "settle";

/**
 * Does the docked menu take a pick yet (A2, A3, A7)? Not while one of his
 * heart scenes plays (`sceneLeft` ms), not in the first moment after it
 * docked (`sinceDock`, so the reply that came with it can land), and not
 * while his reply is still being said (`voiceBusy`) — but a voice never
 * holds it past the cap, and once a menu has opened (`wasOpen`) only a
 * scene closes it again (a line he says while it waits is no reason to
 * snatch it away). `recheck`: ms until the answer may change by itself.
 */
export function panelGate(o: { sinceDock: number; voiceBusy: boolean; sceneLeft: number; wasOpen?: boolean }): { open: boolean; wait: PanelWait | null; recheck: number | null } {
  if (o.sceneLeft > 0) return { open: false, wait: "scene", recheck: o.sceneLeft };
  if (o.wasOpen === true) return { open: true, wait: null, recheck: null };
  if (o.voiceBusy && o.sinceDock < PANEL_WAIT_CAP_MS) return { open: false, wait: "voice", recheck: PANEL_WAIT_CAP_MS - o.sinceDock };
  if (o.sinceDock < PANEL_SETTLE_MS) return { open: false, wait: "settle", recheck: PANEL_SETTLE_MS - o.sinceDock };
  return { open: true, wait: null, recheck: null };
}

/** The key that picks option `index` (A6): 1–9, then 0 for the tenth, then a, b, c …; null past z. */
export function optionKey(index: number): string | null {
  if (index < 0) return null;
  if (index < 9) return String(index + 1);
  if (index === 9) return "0";
  const letter = index - 10;
  return letter < 26 ? String.fromCharCode(97 + letter) : null;
}

/** The option a key picks among `count` (null: none). */
export function optionOfKey(key: string, count: number): number | null {
  if (key.length !== 1) return null;
  const k = key.toLowerCase();
  let i: number;
  if (/^[1-9]$/u.test(k)) i = Number(k) - 1;
  else if (k === "0") i = 9;
  else if (/^[a-z]$/u.test(k)) i = 10 + k.charCodeAt(0) - 97;
  else return null;
  return i < count ? i : null;
}

const ACTS: Record<string, string> = {
  show: "shows",
  hold: "holds",
  hand: "hands",
  give: "gives",
  play: "plays",
  read: "reads",
  put: "puts",
  open: "opens",
  offer: "offers",
  point: "points",
  place: "places",
  lay: "lays",
  slide: "slides",
  push: "pushes",
  pull: "pulls",
  plug: "plugs",
  unplug: "unplugs",
  take: "takes",
  tap: "taps",
  turn: "turns",
};

/**
 * How a pick reads in the thread (B4). Said words read as said; a tagged
 * option that is a deed (`⟦PROOF⟧ Show him the Sandy File.`) reads as one,
 * in brackets: `[shows the Sandy File]` — its first sentence, the verb in
 * the third person, a "him" right after it dropped.
 */
export function echoOf(option: string): { text: string; action: boolean } {
  const { tag, text } = splitTag(option);
  if (tag !== null) {
    const m = /^(\p{L}+)\s+(.*)$/u.exec(text);
    const act = m === null ? undefined : ACTS[m[1]!.toLowerCase()];
    if (m !== null && act !== undefined) {
      const first = (/^(.*?[.!?])(\s|$)/u.exec(m[2]!)?.[1] ?? m[2]!)
        .replace(/[.!?…]+$/u, "")
        .replace(/^him\s+/iu, "")
        .trim();
      if (first !== "") return { text: `[${act} ${first}]`, action: true };
    }
  }
  return { text, action: false };
}

/**
 * Is the composer held back (B7)? While a proof or the shutdown plays,
 * for the rest of a line thrown out (an eject since it opened — a barred
 * program's re-scan too: no heart to heart, D24), and at the heart
 * terminal once the heart is done (`Night.heart_stage` done).
 */
export function composerBlocked(o: { cue: { value: string; at: number } | null; since: number; now: number; stage: string | null; heart: boolean }): boolean {
  if (o.heart && o.stage === "done") return true;
  const c = o.cue;
  if (c === null || c.at <= 0 || c.at < o.since) return false;
  if (c.value === "room_heart_eject") return true;
  if (c.value === "room_heart_proof" || c.value === "room_heart_shutdown") return heartSceneLeft(c, o.since, o.now) > 0;
  return false;
}

/** An end cue (an eject; a mouse-only rig's *not yet* / leave) ends the line once his voice has drained too — never later than this after the cue (ms). */
export const PILOT_END_CAP_MS = 20_000;

/**
 * How long (ms) until the line may end for its end cue (B6): the scene
 * plays out (`sceneLeft`), then his lines still queued are said
 * (`voiceBusy`), up to the cap from the cue (`sinceCue`). 0: end now.
 */
export function pilotEndWait(o: { sceneLeft: number; voiceBusy: boolean; sinceCue: number }): number {
  if (o.sceneLeft > 0) return o.sceneLeft;
  if (o.voiceBusy && o.sinceCue < PILOT_END_CAP_MS) return PILOT_END_CAP_MS - o.sinceCue;
  return 0;
}

/** The thread's empty line: a keyboard-less rig, or his heart, is never asked to "say something". */
export function emptyThreadText(o: { character: string; keys: boolean; heart: boolean }): string {
  const who = o.character.toUpperCase();
  if (o.heart) return `— direct line to ${who} open. he speaks first. —`;
  return o.keys ? `— direct line to ${who} open. say something. —` : `— direct line to ${who} open. —`;
}
