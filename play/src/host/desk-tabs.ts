//! The Desk's sub-tabs and its 🖥 House, as plain decisions (wave 59). No React,
//! so every rule is tested on plain values. Part of the Desk's lazy chunk: a guest
//! never downloads it. New words here are `DRAFT w59d`.
//!
//! - Five tabs: 🎛 Cues · 🎵 Music · 🎚 Mix · 🖥 House · 🔌 Setup. Music and Mix
//!   need the booth's token (`mixer`), and poll only while they are on screen.
//! - The first tab: this device's last one, else Music for Task Manager (M-2), else
//!   Cues. The memory is a convenience: storage that is blocked, or holds something
//!   else, changes nothing.
//! - A run still going is a chip in the part of the Desk that never moves, so it
//!   stays in sight from every tab.
//! - 🖥 House reads the host view: each terminal's state and build stamp. It widens
//!   nothing: every write it makes was already on the host allowlist.

import type { HostView } from "../types.ts";
import type { DeskRun } from "../../../core/src/house-desk.ts";
import { agoText, type VoiceFxMode } from "./model.ts";
import { musicOpen } from "./mixer-model.ts";

export type DeskTabId = "cues" | "music" | "mix" | "house" | "setup";

export interface DeskTab {
  id: DeskTabId;
  icon: string;
  label: string;
}

export const DESK_TABS: readonly DeskTab[] = [
  { id: "cues", icon: "🎛", label: "Cues" },
  { id: "music", icon: "🎵", label: "Music" },
  { id: "mix", icon: "🎚", label: "Mix" },
  { id: "house", icon: "🖥", label: "House" },
  { id: "setup", icon: "🔌", label: "Setup" },
];

/** This device's last tab (host storage). */
export const DESK_TAB_KEY = "loom.desk.tab";

/** The tabs this booth has: Music and Mix need its token. */
export function deskTabs(canMix: boolean): DeskTab[] {
  return DESK_TABS.filter((t) => canMix || (t.id !== "music" && t.id !== "mix"));
}

/** The tab a window opens on (M-2: Music for Task Manager the first time). */
export function firstDeskTab(me: string | null, saved: unknown, tabs: readonly DeskTab[]): DeskTabId {
  const has = (id: unknown): id is DeskTabId => tabs.some((t) => t.id === id);
  if (has(saved)) return saved;
  return musicOpen(me) && has("music") ? "music" : "cues";
}

/** The stored tab, or null: a storage that throws costs only the memory. */
export function readDeskTab(storage: { load<T>(k: string): T | null }): unknown {
  try {
    return storage.load<unknown>(DESK_TAB_KEY);
  } catch {
    return null;
  }
}

export function saveDeskTab(storage: { save(k: string, v: unknown): void }, tab: DeskTabId): void {
  try {
    storage.save(DESK_TAB_KEY, tab);
  } catch {
    // A convenience only.
  }
}

/** The "▶ playing" chip: the running cue's name, and how many more. Null: none. */
export function playingChip(runs: readonly Pick<DeskRun, "name" | "state">[]): string | null {
  const on = runs.filter((r) => r.state === "running");
  if (on.length === 0) return null;
  return `▶ ${on[0]!.name}${on.length > 1 ? ` +${on.length - 1}` : ""}`;
}

/** The ✗ / ⚠ on 🔌 Setup's tab: the worst of its systems. Null: all fine. */
export function setupBadge(tones: readonly ("ok" | "warn" | "bad")[]): "✗" | "⚠" | null {
  if (tones.includes("bad")) return "✗";
  return tones.includes("warn") ? "⚠" : null;
}

// --- 🖥 House: the terminals -----------------------------------------------------------

type Terminals = NonNullable<HostView["terminals"]>;
type TerminalRow = Terminals["rows"][number];

/** A small mark on a terminal's row. `warn`: someone should do something. */
export interface TerminalBadge {
  key: string;
  text: string;
  warn: boolean;
}

export interface TerminalLine {
  name: string;
  quiet: boolean;
  /** "chess · The Casino · 4 s ago". */
  sub: string;
  badges: TerminalBadge[];
}

/** Under this a battery on no charger asks for one (Run's rule). */
const LOW_BATTERY = 20;

/** The build most terminals run, or null on a tie or no stamps (Run's `majorityVersion`). */
export function majorityBuild(rows: readonly Pick<TerminalRow, "version">[]): string | null {
  const n = new Map<string, number>();
  for (const r of rows) if (r.version) n.set(r.version, (n.get(r.version) ?? 0) + 1);
  const ranked = [...n.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0 || (ranked.length > 1 && ranked[0]![1] === ranked[1]![1])) return null;
  return ranked[0]![0];
}

function doorBadge(door: string | undefined): TerminalBadge | null {
  if (door === undefined || door === "none") return null;
  if (door === "fault") return { key: "door", text: "🚪 fault", warn: true };
  return { key: "door", text: door === "open" ? "🚪 open" : "🚪 shut", warn: false };
}

/** One row: silent ones say only that and their build (a dead tablet's health is old news). */
export function terminalLine(r: TerminalRow, silentMs: number, majority: string | null): TerminalLine {
  const quiet = r.agoMs > silentMs;
  const badges: TerminalBadge[] = [];
  if (!quiet) {
    const door = doorBadge(r.door);
    if (door !== null) badges.push(door);
    if (r.audio === false) badges.push({ key: "audio", text: "🔇 touch it", warn: true });
    if (r.visible === false) badges.push({ key: "hidden", text: "💤 hidden", warn: true });
    if (r.fullscreen === false) badges.push({ key: "fullscreen", text: "⛶ not full", warn: true });
    if (typeof r.battery === "number") {
      const low = r.battery < LOW_BATTERY && r.charging !== true;
      badges.push({ key: "battery", text: `${r.charging === true ? "⚡" : "🔋"}${r.battery}%`, warn: low });
    }
  }
  if (r.version) badges.push({ key: "version", text: r.version, warn: majority !== null && r.version !== majority });
  else if (majority !== null) badges.push({ key: "version", text: "old build", warn: true });
  return { name: r.name, quiet, sub: [r.view, r.room, agoText(r.agoMs)].filter((x) => x !== undefined && x !== "").join(" · "), badges };
}

/** The terminals, silent first (a row that needs a walk leads), then as they polled. */
export function terminalLines(t: Terminals): TerminalLine[] {
  const majority = majorityBuild(t.rows);
  const lines = t.rows.map((r) => terminalLine(r, t.silentMs, majority));
  return [...lines.filter((l) => l.quiet), ...lines.filter((l) => !l.quiet)];
}

export function silentTerminals(t: Pick<Terminals, "rows" | "silentMs"> | null | undefined): number {
  return t == null ? 0 : t.rows.filter((r) => r.agoMs > t.silentMs).length;
}

/** "12/14 live · 2 on another build". */
export function terminalsAside(t: Terminals): string {
  const live = t.rows.length - silentTerminals(t);
  const majority = majorityBuild(t.rows);
  const odd = majority === null ? 0 : t.rows.filter((r) => r.version !== majority).length;
  return `${live}/${t.rows.length} live${odd > 0 ? ` · ${odd} on another build` : ""}`;
}

// --- 🖥 House: his voice, the dream -----------------------------------------------------

export const VOICE_MODE_WORD: Readonly<Record<VoiceFxMode, string>> = { auto: "Auto", clean: "Clean", broken: "Broken" };

/** What each mode does, under the three buttons. */
export function voiceModeLine(mode: VoiceFxMode): string {
  if (mode === "clean") return "Kept clean: nothing breaks him, whatever the night does.";
  return mode === "broken" ? "Fully broken, from now until you change it." : "Follows the night: he comes apart by himself.";
}

/** The story's switch for Clippy's dream (the show's `dream_toggle`). */
export const DREAM_CUE = "dream_toggle";

/** The dream's row in 🖥 House, or null when the story has no switch. Behind closed
 *  doors no story is running to hear it, whatever the row says. */
export function dreamRow(rows: readonly { id: string; live: boolean }[], on: boolean | undefined, doorsClosed: boolean): { live: boolean; on: boolean; state: string; button: string; ask: string } | null {
  const row = rows.find((r) => r.id === DREAM_CUE);
  if (row === undefined) return null;
  const dreaming = on === true;
  return {
    live: row.live && !doorsClosed,
    on: dreaming,
    state: dreaming ? "on the terminals" : "off",
    button: dreaming ? "🌀 Put the terminals back" : "🌀 Bring the dream back",
    ask: dreaming ? "Every terminal goes back to its usual screen. Do it?" : "Every terminal goes back into the dream. Do it?",
  };
}

/** Why the dream's switch is off. */
export const DREAM_NOT_NOW = "It runs from 🕚 until an ending.";

/** What the note says after the switch: the story's own line to the hosts. */
export function dreamDone(on: boolean, answer: unknown): string {
  const a = answer !== null && typeof answer === "object" ? (answer as Record<string, unknown>) : {};
  const said = Array.isArray(a["staff"]) ? a["staff"].find((l): l is string => typeof l === "string" && l !== "") : undefined;
  if (said !== undefined) return said;
  if (a["refused"] === true) return "🌀 Not now — # hosts says why";
  if (a["moved"] === true) return "🌀 Cues moved — tap again";
  return on ? "🌀 The terminals are going back" : "🌀 The dream is coming back";
}
