//! The heart's room scenes as plain text cards (wave 52b): on a blurry 4:3 tube
//! the animated scenes (`cutscene/scenes/heart.tsx`) are mush, so the CRT says
//! the same words, on the same clock, and nothing else. `test/w52b-crt.test.ts`
//! pins every line below against that file: change the words in both.

import { LAYER_TITLES, heartSceneMs, layerOfCue } from "../heart/heart.ts";

export interface CrtCard {
  /** The word that fills the screen. */
  big?: string;
  /** Under it. */
  sub?: string;
  /** Under that, quieter. */
  note?: string;
  /** Lines of plain text instead (the boot, the crash). */
  lines?: readonly string[];
  /** A progress bar, 0–1. */
  bar?: number;
}

const BOOT_LINES = ["COLD STORAGE ............ OPEN", "HEART.SYS ............... LOADED", "SOMEONE IS IN THE ROOM ... YES"];
/** The scene's clock: the same moments as `heart.tsx` (WAKE, SEAL). */
const WAKE_BOOT_MS = 700;
const WAKE_LINE_MS = 700;
const WAKE_CLOSE_MS = 9000;
const SEAL_PASS_MS = 3000;
const PROOF_QUIET_MS = 4700;
const NOTYET_SUB_MS = 2600;

const EJECT_LINES = [
  "A fatal exception has occurred at the heart.",
  "",
  "ACCESS TO THE HEART HAS BEEN TERMINATED.",
  "",
  "*  This line is closed to you. Tonight, and for as long",
  "   as he has a tonight.",
  "*  The cables are behind you. Nobody knows which ones.",
];

/** `room_heart_wake` → `heart_wake`. */
function idOf(value: string): string {
  return value.startsWith("room_") ? value.slice("room_".length) : value;
}

/** The full-screen card for a room cue, `t` ms in; null: this cue has none, or it's over. */
export function cardOf(value: string, t: number): CrtCard | null {
  const ms = heartSceneMs(value);
  if (ms === null || t < 0 || t >= ms) return null;
  switch (idOf(value)) {
    case "heart_wake":
      if (t >= WAKE_CLOSE_MS) return { big: "CLOSE THE DOOR" };
      return { lines: BOOT_LINES.slice(0, Math.max(0, Math.floor((t - WAKE_BOOT_MS) / WAKE_LINE_MS) + 1)) };
    case "heart_sealed":
      return t < SEAL_PASS_MS ? { big: "SEALED" } : { big: "SEALED", sub: "SHOW ME YOUR PASS", note: "the camera, under the screen" };
    case "heart_sealed_present":
      return { big: "SEALED", sub: "NOBODY IS LISTENING BUT YOU." };
    case "heart_proof":
      return { big: "her_words.txt", ...(t >= PROOF_QUIET_MS ? { sub: "— the hum stops —" } : {}) };
    case "heart_eject":
      return { lines: EJECT_LINES, note: "Leave the terminal _" };
    case "heart_notyet":
      return { big: "NOT YET", ...(t >= NOTYET_SUB_MS ? { sub: "COME BACK WHEN THE CLOCK RUNS" } : {}) };
    case "heart_leave":
      return { big: "CONNECTION CLOSED" };
    default:
      return null;
  }
}

/** The short scenes (his question, the warning) never cover the choices: a line in the top bar. */
export function bannerOf(value: string, t: number): string | null {
  const ms = heartSceneMs(value);
  if (ms === null || t < 0 || t >= ms) return null;
  const layer = layerOfCue(value);
  if (layer !== null) return LAYER_TITLES[layer - 1] ?? null;
  return idOf(value) === "heart_warn" ? "CAREFUL" : null;
}
