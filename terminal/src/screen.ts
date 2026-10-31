//! The lean screen state (OCT31 K-16): every 2 s the terminal asks the
//! event server `GET /api/screen/state` (~1 KB, `core/server/routes/screen.ts`)
//! what the house's screens should be doing — the story's screen cues, the
//! running countdown, and whether this terminal's character is hidden or
//! asleep. While it is, the terminal is on **attract** (screensaver + ads):
//! no scanner, never "ONLINE", never a pilot into the character's thread.
//!
//! The poll is also the terminal's heartbeat — the server remembers each
//! terminal's last poll by name (K-29 reads it), with the device health it
//! reports (`health.ts`: sound unlocked, visible, battery, build; SW-SCR-21).
//! A director's `identify` comes back as `identify: true` for ~10 s (with
//! the ms left, `identifyLeft`, counted down here): the terminal shows its
//! name full screen.
//!
//! The TV (`view: tv`, K-18) also names its `voice` room and the last chat
//! seq it handled (`after`); the answer's `voice` block carries the
//! characters' new lines in that room, the room's head seq and the
//! director's mute. It polls every second so a line is heard within 3 s.
//!
//! A room terminal (wave 7, `config.roomOf` — the server-room terminal)
//! names its `room` and its cursor instead: the answer's `room` block says
//! whether that LOCATION is open (attract until it is) and its `voice` block
//! carries the room's lines, never muted by the TV's mute.
//!
//! The King's chess board (wave 11, `view=chess`) reads the `king` block:
//! his one shared health bar (`hp` of `max`, `fallen` at 0) and whether a
//! checkmate wins anything right now (`armed`, off the King prop's `armed`
//! path — `Night.king_armed`; null = the map names none). An older server
//! sends no block (null).
//!
//! Wave 17: the answer also carries the house's live story **moments**
//! (`moments`, ≤ 12, oldest first, never history — a house-wide beat, a named
//! signal, an `sfx` name, a house-wide reveal, a duck find) and a few more
//! public `night` vars (the phase, the step, the bottle's pick, an award's
//! winner while its slide is up, the advice tally, the alert ladder). The
//! cutscenes (`cutscene/`) play off them. An older server sends neither:
//! no moments, every new var null.
//!
//! Wave 18: a **big** house broadcast (`broadcast "!!…"` to everyone — the
//! Bingo Ribbon, an award) may ride the same ring. The core lane's shape is
//! read generously: an entry of kind `big` (or any other unknown kind
//! carrying `moment: "big"` / `big: true`), its line in `text` (else
//! `name`), the program it is about in `who`. It becomes a moment of kind
//! `big` whose `name` is the line with its `!!` / `~` marks stripped, so a
//! scene can match it by its leading glyph (`🎀*`). An older server sends
//! none.
//!
//! Wave 18b: the **results** the story reads out (`results`, `ScreenResults`
//! — `do fact_read` / `do fact_truth`: who filed, what they said, sure or
//! not, the public outcome and Trabolta's ruling stamp; at ⚖ on the TV the
//! key answers and the liars' names), the spot's house setting for
//! announcements (`spot: {announce}`, a tablet on "House setting" follows
//! it), and four more `night` vars, each sent only while its slide is up
//! (`most_trusted` / `least_trusted` on the bobbing slide, `facts_accepted`
//! / `first_reinstall` on the recount and purgatory slides). An older server
//! sends none of them (null).
//!
//! The answer also carries the latest house announcements (`announce` +
//! the last few in `announces`, N-09); a terminal set to say announcements
//! speaks each new one (`announce.ts`).
//!
//! A terminal that speaks a room's lines (the TV, a room terminal) also
//! reports its speech (wave 25, `speech/said.ts`, the house desk's §5):
//! `talk=1|0` and `said=<seq>`, and polls at once when its queue drains.
//!
//! Fail closed: until the first answer arrives the terminal stays on
//! attract, and an unreachable server keeps the last answer it gave — a
//! dropped poll never flips a hidden character onto the wall.

import { VOICE_FLAVOURS, type VoiceFlavour, type VoiceFxState } from "./speech/glitch.ts";
import { linkedNow } from "./world/presence.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdOnAir } from "../../core/src/audio-ads.ts";
import { announceOf, announceReport, type Announcement } from "./announce.ts";
import { baseOf, type TerminalConfig } from "./config.ts";
import { deviceHealth, deviceQuery, type DeviceHealth } from "./health.ts";
import { PollPacer, speechQuery, type SpeechReport } from "./speech/said.ts";

/** How often the terminal polls (ms). */
export const SCREEN_POLL_MS = 2000;
/** How often the TV polls (ms): a line must be heard within 3 s. */
export const TV_POLL_MS = 1000;
/** (wave 59) While his next line waits on the teleprompter, polled this often. */
export const HELD_POLL_MS = 300;

export type ScreenCueFamily = "screens" | "terminals" | "tv" | "tablet";

export interface ScreenCue {
  value: string;
  seq: number;
}

/** Who a cue is for — the server picks the poller's from its `view`. */
export type ScreenTarget = "tv" | "terminals";

/** One screen cue as the server's fold saw it (`at` = server epoch ms, 0 = history). */
export interface ScreenShot {
  value: string;
  cue: string;
  seq: number;
  at: number;
  /** (wave 32, C5) A glitch shot only: the burst's own words
   *  (`Night.glitch_text`); absent = the hijack's old constant. */
  text?: string;
  /** (wave 32) A glitch shot only: the server's word that this one is an ad
   *  burst (`Night.glitch_kind` "burst"); absent = the full takeover, or an
   *  older server (`slides.ts` `isBurst` then reads the burst's sound). */
  light?: true;
}

/** What to layer over the base view (K-17 + N-03; `slides.ts` applies the precedence). */
export interface ScreenProgram {
  slide: (ScreenShot & { kind: "slide" | "base"; persist: boolean }) | null;
  overlay: ScreenShot | null;
  blackout: ScreenShot | null;
  flicker: ScreenShot | null;
  /** (wave 26, T2) The last glitch cue (`screens_glitch`, …): a one-shot that
   *  never touches the slide or the overlay; `at` 0 = history. Absent: none
   *  yet, or an older server (`programOf` leaves it out then); read it as
   *  `program.glitch ?? null`. */
  glitch?: ScreenShot | null;
}

/** A character's line in the voice room (`beat` null = a director's typed `say`). */
export interface VoiceLine {
  seq: number;
  from: string;
  text: string;
  beat: string | null;
}

/** A room terminal's LOCATION (wave 7): `id` "" = the story has no such room. */
export interface ScreenRoom {
  id: string;
  open: boolean;
  /** (wave 20) The last `cue room_<name>` played in a beat set in this room
   *  (its room scenes key on it), else null — also from an older server. */
  cue: ScreenRoomCue | null;
}

/** A room terminal's picture cue (wave 20, `cue room_heart_wake`). */
export interface ScreenRoomCue {
  /** The cue's first token, as written: `room_heart_wake`. */
  value: string;
  /** Bumps on every such cue for this room, a repeat included. */
  seq: number;
  /** Server epoch ms the cue played; 0 = history (never played). */
  at: number;
}

/** A room cue off the wire; anything malformed is null. */
export function roomCueOf(raw: unknown): ScreenRoomCue | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const value = r["value"];
  const seq = r["seq"];
  if (typeof value !== "string" || !value.startsWith("room_") || value.length <= 5 || typeof seq !== "number" || !Number.isFinite(seq)) return null;
  const at = typeof r["at"] === "number" && Number.isFinite(r["at"]) && r["at"] > 0 ? r["at"] : 0;
  return { value, seq, at };
}

/** The King on the screen state (wave 11): his shared health bar + stakes. */
export interface ScreenKing {
  hp: number;
  max: number;
  fallen: boolean;
  /** A checkmate gives the door code now (null: the map names no `armed` path). */
  armed: boolean | null;
}

/** A king block off the wire; anything malformed is null (no shared King). */
export function kingOf(raw: unknown): ScreenKing | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const hp = r["hp"];
  const max = r["max"];
  if (typeof hp !== "number" || !Number.isFinite(hp) || typeof max !== "number" || !Number.isFinite(max) || max < 1) return null;
  const clamped = Math.max(0, Math.min(max, Math.round(hp)));
  return { hp: clamped, max: Math.round(max), fallen: r["fallen"] === true || clamped <= 0, armed: typeof r["armed"] === "boolean" ? r["armed"] : null };
}

/** What a moment is (wave 17). */
export type ScreenMomentKind = "beat" | "signal" | "sfx" | "reveal" | "found" | "big";
/** The wave 17 kinds, exactly as the server names them. */
export const MOMENT_KINDS: readonly ScreenMomentKind[] = ["beat", "signal", "sfx", "reveal", "found"];
/** The longest big line kept (characters). */
export const BIG_LINE_MAX = 200;

/** A big broadcast's line as the screens show it: no leading `!` / `~`
 *  marks (the phones' delivery marks), trimmed, clipped. */
export function bigLineOf(raw: string): string {
  const line = raw.replace(/^[\s!~]+/u, "").trim();
  return line.length > BIG_LINE_MAX ? `${line.slice(0, BIG_LINE_MAX - 1).trimEnd()}…` : line;
}

/** Is this wire entry a big house broadcast (wave 18)? Kind `big`, or an
 *  unknown kind flagged `moment: "big"` / `big: true`. A wave 17 kind keeps
 *  its own meaning whatever it is flagged. */
function isBigEntry(r: Record<string, unknown>, kind: string): boolean {
  if ((MOMENT_KINDS as readonly string[]).includes(kind)) return false;
  return kind === "big" || r["moment"] === "big" || r["big"] === true;
}

/** A live story moment, house-wide (wave 17): `seq` is the sim log's (it
 *  restarts with the sim: `announceEpoch` says which), `at` server ms (> 0). */
export interface ScreenMoment {
  seq: number;
  at: number;
  kind: ScreenMomentKind;
  /** The beat's display name, the signal's, the sfx name, the revealed place / character, "golden duck" (or "golden duck kept"),
   *  or (kind `big`, wave 18) the big broadcast's line, marks stripped. */
  name: string;
  /** A public display name when the moment is about one program (the bottle's pick, a duck's finder). */
  who: string | null;
  /** A duck find the story kept (no release: GERALD CAN'T HELP). */
  kept: boolean;
}

/** At most this many moments are kept off one answer (the server sends ≤ 12). */
export const MOMENTS_MAX = 24;

/** The moments off the wire, oldest first; malformed or history (`at` ≤ 0) entries drop. */
export function momentsOf(raw: unknown): ScreenMoment[] {
  if (!Array.isArray(raw)) return [];
  const out: ScreenMoment[] = [];
  for (const x of raw) {
    if (typeof x !== "object" || x === null) continue;
    const r = x as Record<string, unknown>;
    const seq = r["seq"];
    const at = r["at"];
    const kind = r["kind"];
    const name = r["name"];
    if (typeof seq !== "number" || !Number.isFinite(seq) || typeof at !== "number" || !Number.isFinite(at) || at <= 0) continue;
    const who = typeof r["who"] === "string" && r["who"].trim() !== "" ? r["who"].trim() : null;
    if (typeof kind === "string" && isBigEntry(r, kind)) {
      const text = typeof r["text"] === "string" && r["text"].trim() !== "" ? r["text"] : name;
      const line = typeof text === "string" ? bigLineOf(text) : "";
      if (line !== "") out.push({ seq, at, kind: "big", name: line, who, kept: false });
      continue;
    }
    if (typeof kind !== "string" || !(MOMENT_KINDS as readonly string[]).includes(kind) || typeof name !== "string" || name.trim() === "") continue;
    out.push({ seq, at, kind: kind as ScreenMomentKind, name: name.trim(), who, kept: r["kept"] === true || /\bkept$/iu.test(name.trim()) });
  }
  out.sort((a, b) => a.seq - b.seq);
  return out.length > MOMENTS_MAX ? out.slice(out.length - MOMENTS_MAX) : out;
}

/** The public story vars on the screen state (wave 17 adds all but the first two). */
export interface ScreenNight {
  screen: string | null;
  terminals: string | null;
  phase: string | null;
  step: number | null;
  bottle_pick: string | null;
  /** The bottle waits on its pick's Truth or Dare. */
  bottle_open: boolean | null;
  /** Which hunt question's results are being read (0 before the first). */
  results_q: number | null;
  /** Only while an `award_*` slide is up. */
  award_winner: string | null;
  award_value: string | number | null;
  help_votes: number | null;
  thwart_votes: number | null;
  alerts: string | null;
  /** An ending has played (the story then ignores the King and the chess). */
  ended: boolean | null;
  /** Round two's tally: every fact in (61 %) or not (12 %). */
  collection_complete: boolean | null;
  /** The overshare that played (1–4), else null. */
  scenario: number | null;
  /** Wave 18b, only while the bobbing slide is up (Final Assessment): the
   *  programs the Trust Chart ranks top and bottom (null: not yet, or none). */
  most_trusted: string | null;
  least_trusted: string | null;
  /** Wave 18b, only while the recount / purgatory slide is up: how many
   *  filed facts were accepted tonight, and the first program reinstalled
   *  (null: nobody — the story's `"none"`). */
  facts_accepted: number | null;
  first_reinstall: string | null;
  /** (wave 20) `Night.server_door`: the story's door (null: no story / unset). */
  server_door: "open" | "closed" | null;
  /** (wave 20) `Night.heart_stage`: sealed / door / scan / talk / done. */
  heart_stage: string | null;
  /** (wave 20) The settled heart look (the story's "none" reads null). */
  heart_look: string | null;
  /** (wave 20) The patch-bay alarm latch. */
  alarm_on: boolean | null;
  /** (wave 20) A director has the door on the 🚪 buttons: the story ignores the sensor. */
  door_override: boolean | null;
  /** (wave 22) A director has the patch bay on the 🔌 buttons: the story ignores the bay. */
  patch_override: boolean | null;
  /** (wave 45) The Bathroom Report's numbers, only while its slide
   *  (`award_bathroom`) is up; absent otherwise or from an older server. */
  bathroom?: ScreenBathroom | null;
  /** (wave 48) The Language Report's numbers, only while its slide
   *  (`award_language`) is up; absent otherwise or from an older server. */
  language?: ScreenLanguage | null;
}

/** (wave 48) The Language Report (G14), as the story read it (the server's
 *  `ScreenLanguage`, `docs/loom-w48-contract.md` C4, reshaped by wave 48b's
 *  C12). `curser` may be a tie ("A and B"), null for nobody; `words` are
 *  the censored words, each once, never a slur, most censored first, at most
 *  `LANGUAGE_WORDS_MAX`, with `counts` (times each was censored) in the same
 *  order; `more` counts the unique censored words past them; `unsaid` the
 *  slurs censored (the TV draws a redaction bar for each, never a word);
 *  `level` the filter's strength now and `stars` the Password Manager's ⭐
 *  (null from a wave 48 server, which sends neither). */
export interface ScreenLanguage {
  flagged: number;
  censored: number;
  curser: string | null;
  curses: number;
  words: string[];
  counts: number[];
  more: number;
  unsaid: number;
  level: number | null;
  stars: number | null;
}

/** (wave 48b) The most censored words the slide carries (C12). */
export const LANGUAGE_WORDS_MAX = 400;

/** (wave 48b) A word the slide may print: not blank, not the journal's `[slur]`, not a starred one (no letter or digit left). Slurs are `unsaid`, a count. */
function sayable(w: string): boolean {
  const t = w.trim();
  return t !== "" && t.toLowerCase() !== "[slur]" && /[\p{L}\p{N}]/u.test(t);
}

/**
 * (wave 48) The report off the wire. Malformed (not an object, or no
 * `flagged` count) reads null, as if absent. A bad number reads 0; censored
 * words are flagged words, so `flagged` is at least `censored`; `words`
 * keeps the strings it may print (`sayable`), trimmed, each with its count (wave 48b: no
 * `counts`, or a bad one, is 1: a wave 48 server sends none), most censored
 * first (a stable sort, so equal counts keep the server's order), the
 * first `LANGUAGE_WORDS_MAX` (any past them count into `more`). No `unsaid`
 * reads 0; no `level` (0–100) or `stars` reads null.
 */
export function languageOf(raw: unknown): ScreenLanguage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["flagged"] !== "number" || !Number.isFinite(r["flagged"])) return null;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const who = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" && v.trim().toLowerCase() !== "none" ? v.trim() : null);
  const counts = Array.isArray(r["counts"]) ? (r["counts"] as unknown[]) : [];
  const all = (Array.isArray(r["words"]) ? (r["words"] as unknown[]) : [])
    .flatMap((w, i) => (typeof w === "string" && sayable(w) ? [{ word: w.trim(), count: Math.max(1, n(counts[i])), i }] : []))
    .sort((a, b) => b.count - a.count || a.i - b.i);
  const kept = all.slice(0, LANGUAGE_WORDS_MAX);
  const censored = n(r["censored"]);
  const level = r["level"];
  return {
    flagged: Math.max(n(r["flagged"]), censored),
    censored,
    curser: who(r["curser"]),
    curses: n(r["curses"]),
    words: kept.map((k) => k.word),
    counts: kept.map((k) => k.count),
    more: n(r["more"]) + Math.max(0, all.length - LANGUAGE_WORDS_MAX),
    unsaid: n(r["unsaid"]),
    level: typeof level === "number" && Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : null,
    stars: typeof r["stars"] === "number" && Number.isFinite(r["stars"]) ? n(r["stars"]) : null,
  };
}

/** (wave 45) The Bathroom Report (G13), as the story read it (the server's
 *  `ScreenBathroom`). Story seconds; a name may be a tie ("A and B"), null
 *  for nobody; `least` is null with fewer than two who went. */
export interface ScreenBathroom {
  goers: number;
  never: number;
  total_s: number;
  most: string | null;
  most_s: number;
  least: string | null;
  least_s: number;
  toggler: string | null;
  toggles: number;
}

/** (wave 45) The report off the wire; null unless it is an object. A bad number reads 0. */
export function bathroomOf(raw: unknown): ScreenBathroom | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const who = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" && v.trim().toLowerCase() !== "none" ? v.trim() : null);
  return { goers: n(r["goers"]), never: n(r["never"]), total_s: n(r["total_s"]), most: who(r["most"]), most_s: n(r["most_s"]), least: who(r["least"]), least_s: n(r["least_s"]), toggler: who(r["toggler"]), toggles: n(r["toggles"]) };
}

export const EMPTY_NIGHT: ScreenNight = { screen: null, terminals: null, phase: null, step: null, bottle_pick: null, bottle_open: null, results_q: null, award_winner: null, award_value: null, help_votes: null, thwart_votes: null, alerts: null, ended: null, collection_complete: null, scenario: null, most_trusted: null, least_trusted: null, facts_accepted: null, first_reinstall: null, server_door: null, heart_stage: null, heart_look: null, alarm_on: null, door_override: null, patch_override: null };

/** The night block off the wire; anything missing or malformed is null. */
export function nightOf(raw: unknown): ScreenNight {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
  const value = r["award_value"];
  const scenario = num(r["scenario"]);
  // A program's name; the story's "none" (and "") is nobody.
  const who = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" && v.trim().toLowerCase() !== "none" ? v.trim() : null);
  const accepted = num(r["facts_accepted"]);
  return {
    screen: str(r["screen"]),
    terminals: str(r["terminals"]),
    phase: str(r["phase"]),
    step: num(r["step"]),
    bottle_pick: str(r["bottle_pick"]),
    bottle_open: typeof r["bottle_open"] === "boolean" ? r["bottle_open"] : null,
    results_q: num(r["results_q"]),
    award_winner: str(r["award_winner"]),
    award_value: typeof value === "string" ? value : num(value),
    help_votes: num(r["help_votes"]),
    thwart_votes: num(r["thwart_votes"]),
    alerts: str(r["alerts"]),
    ended: bool(r["ended"]),
    collection_complete: bool(r["collection_complete"]),
    scenario: scenario !== null && Number.isInteger(scenario) && scenario >= 1 && scenario <= 4 ? scenario : null,
    most_trusted: who(r["most_trusted"]),
    least_trusted: who(r["least_trusted"]),
    facts_accepted: accepted !== null && accepted >= 0 ? Math.floor(accepted) : null,
    first_reinstall: who(r["first_reinstall"]),
    server_door: r["server_door"] === "open" || r["server_door"] === "closed" ? r["server_door"] : null,
    heart_stage: str(r["heart_stage"]),
    heart_look: who(r["heart_look"]),
    alarm_on: bool(r["alarm_on"]),
    door_override: bool(r["door_override"]),
    patch_override: bool(r["patch_override"]),
    // Wave 45: present only while the server sends it (its slide is up).
    ...((b) => (b === null ? {} : { bathroom: b }))(bathroomOf(r["bathroom"])),
    // Wave 48: likewise, only while the Language Report's slide is up.
    ...((l) => (l === null ? {} : { language: l }))(languageOf(r["language"])),
  };
}

// --- the results (wave 18b) ----------------------------------------------------
//
// The server's `ScreenResults` (`core/server/routes/screen.ts`,
// `screenResultsOf` in `core/server/facts.ts`), copied here because the
// terminal never imports `core/server`. Field names follow the wire; the
// wire's tuples are read into named objects (`rows` `[who, said, sure, out,
// ruled]` → `ResultRow`, `liars` `[who, ruled]` → `ResultLiar`).

/** A filing's public outcome: `a` accepted, `g` a guess, `u` not counted
 *  (no cup / marked), `p` pending. Never accurate versus lie. */
export type ResultOutcome = "a" | "g" | "u" | "p";
/** Trabolta's ruling stamp on a filing (O4, D10): `s` / `n` he ruled it the
 *  same / not the same (only below 100, where it equals the outcome); `r`
 *  he ruled a filing at 100 (the result held until ⚖); `?` he is asking
 *  (queued or out); `""` no ruling (an exact match, the house rule, a director). */
export type RulingStamp = "s" | "n" | "r" | "?" | "";
/** A question's truth at ⚖ (`do fact_truth`). */
export type ResultTruth = "true" | "lie" | "none";

/** One filing as a reading shows it (TV only). */
export interface ResultRow {
  /** The filer's display name (clipped by the server). */
  who: string;
  /** What they filed (clipped by the server). */
  said: string;
  /** Filed one hundred percent sure. */
  sure: boolean;
  out: ResultOutcome;
  ruled: RulingStamp;
}

/** A program named a liar at ⚖ (TV only). */
export interface ResultLiar {
  who: string;
  /** Trabolta's ruling made the lie (a 🤖 mark on the name). */
  ruled: boolean;
}

export interface ScreenResultQuestion {
  /** The facts book id (`H1` … `F3`). */
  id: string;
  /** 1-based position in the book. */
  n: number;
  round: number | null;
  /** The question's public text (a read only; null on a verdict). */
  text: string | null;
  filed: number;
  accepted: number;
  guesses: number;
  uncounted: number;
  /** Every filing matches and every one was sure. */
  consensus: boolean;
  /** The key's answer: a read carries it on consensus only; a TV verdict
   *  carries it for every question (O2). Else null. */
  answer: string | null;
  /** The verdict's truth (null on a read, or not judged). */
  truth: ResultTruth | null;
  /** The filings, in filing order (TV reads only; null elsewhere). */
  rows: ResultRow[] | null;
  /** Filings past the row cap. */
  more: number;
  /** Who lied (a TV verdict only; null elsewhere). */
  liars: ResultLiar[] | null;
  /** Liars past the name cap. */
  liarsMore: number;
}

export interface ScreenResults {
  /** `read`: `do fact_read` while a results slide is up; `verdict`: the window after `do fact_truth`. */
  kind: "read" | "verdict";
  seq: number;
  /** Server epoch ms of the publication; 0 = history (a replay). */
  at: number;
  questions: ScreenResultQuestion[];
}

/** Caps on a parsed block (the server's are lower: 9 questions, 40 rows / names). */
export const RESULTS_MAX_QUESTIONS = 16;
export const RESULTS_MAX_ROWS = 60;
const RESULT_TEXT_MAX = 400;

const OUTCOMES: readonly string[] = ["a", "g", "u", "p"];
const STAMPS: readonly string[] = ["s", "n", "r", "?", ""];
const TRUTHS: readonly string[] = ["true", "lie", "none"];

function clipText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/gu, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** A results row off the wire (`[who, said, sure, out, ruled?]`), else null. */
export function resultRowOf(raw: unknown): ResultRow | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const who = clipText(raw[0], 60);
  const said = clipText(raw[1], RESULT_TEXT_MAX);
  const out = raw[3];
  if (who === null || who === "" || said === null || typeof out !== "string" || !OUTCOMES.includes(out)) return null;
  const ruled = raw.length > 4 && typeof raw[4] === "string" && STAMPS.includes(raw[4]) ? (raw[4] as RulingStamp) : "";
  return { who, said, sure: raw[2] === 1 || raw[2] === true, out: out as ResultOutcome, ruled };
}

function resultQuestionOf(raw: unknown): ScreenResultQuestion | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = r["id"];
  const n = r["n"];
  if (typeof id !== "string" || id.trim() === "" || typeof n !== "number" || !Number.isFinite(n)) return null;
  const round = typeof r["round"] === "number" && Number.isFinite(r["round"]) ? r["round"] : null;
  let rows: ResultRow[] | null = null;
  if (Array.isArray(r["rows"])) {
    rows = [];
    for (const x of r["rows"]) {
      if (rows.length >= RESULTS_MAX_ROWS) break;
      const row = resultRowOf(x);
      if (row !== null) rows.push(row);
    }
  }
  let liars: ResultLiar[] | null = null;
  if (Array.isArray(r["liars"])) {
    liars = [];
    for (const x of r["liars"]) {
      if (liars.length >= RESULTS_MAX_ROWS) break;
      const pair = Array.isArray(x) ? x : null;
      const who = pair === null ? null : clipText(pair[0], 60);
      if (who === null || who === "") continue;
      liars.push({ who, ruled: pair !== null && (pair[1] === 1 || pair[1] === true) });
    }
  }
  const answer = clipText(r["answer"], RESULT_TEXT_MAX);
  const truth = r["truth"];
  return {
    id: id.trim(),
    n: Math.floor(n),
    round,
    text: clipText(r["text"], RESULT_TEXT_MAX),
    filed: count(r["filed"]),
    accepted: count(r["accepted"]),
    guesses: count(r["guesses"]),
    uncounted: count(r["uncounted"]),
    consensus: r["consensus"] === true,
    answer: answer === "" ? null : answer,
    truth: typeof truth === "string" && TRUTHS.includes(truth) ? (truth as ResultTruth) : null,
    rows,
    more: count(r["more"]),
    liars,
    liarsMore: count(r["liarsMore"]),
  };
}

/** The results block off the wire; malformed questions drop, a malformed
 *  block (or none: an older server, or nothing public) is null. */
export function resultsOf(raw: unknown): ScreenResults | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const kind = r["kind"];
  const seq = r["seq"];
  if ((kind !== "read" && kind !== "verdict") || typeof seq !== "number" || !Number.isFinite(seq) || !Array.isArray(r["questions"])) return null;
  const questions: ScreenResultQuestion[] = [];
  for (const x of r["questions"]) {
    if (questions.length >= RESULTS_MAX_QUESTIONS) break;
    const q = resultQuestionOf(x);
    if (q !== null) questions.push(q);
  }
  const at = typeof r["at"] === "number" && Number.isFinite(r["at"]) && r["at"] > 0 ? r["at"] : 0;
  return { kind, seq, at, questions };
}

/** This terminal's map spot as the server reads it (wave 18b, Q8):
 *  `announce` = the house list (`audio.json` `announce.terminals`) names it. */
export interface ScreenSpot {
  announce: boolean;
  /** (wave 26, R5) Live reinstalled players whose presence room is this
   *  spot's map room. Absent: the server can't tell (no spatial map, or an
   *  older server): fall back to the house-wide `reinstalling` rule. */
  here?: number;
}

/** A spot block off the wire; anything malformed is null (an older server sends none). */
export function spotOf(raw: unknown): ScreenSpot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const a = r["announce"];
  if (typeof a !== "boolean") return null;
  const here = r["here"];
  return typeof here === "number" && Number.isFinite(here) && here >= 0 ? { announce: a, here: Math.floor(here) } : { announce: a };
}

/** (wave 26, V1 phase 2) What the TV is speaking now, as the server heard it. */
export interface TvSpeech {
  /** The room line's seq. */
  seq: number;
  /** Its sentence (from 0); null = that line is done. */
  chunk: number | null;
  /** Server epoch ms the TV's report arrived. */
  at: number;
}

/** A `tvSpeech` block off the wire; anything malformed (or an older server's none) is null. */
export function tvSpeechOf(raw: unknown): TvSpeech | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!ok(r["seq"]) || !ok(r["at"])) return null;
  const chunk = r["chunk"];
  if (chunk !== null && !ok(chunk)) return null;
  return { seq: Math.floor(r["seq"]), chunk: chunk === null ? null : Math.floor(chunk), at: r["at"] };
}

/** The TV's voice block (K-18). */
export interface ScreenVoice {
  room: string;
  muted: boolean;
  head: number;
  lines: VoiceLine[];
  /** (wave 59) His next line waits on the teleprompter. */
  held?: boolean;
}

/** The server's answer (a subset is all the terminal reads today). */
export interface ScreenState {
  /** (wave 59p) Take stills now (`photos.ts`). Optional for hand-built states. */
  photos?: boolean;
  now: number;
  /** Local `Date.now()` when this answer arrived (not from the server). */
  receivedAt: number;
  /** (wave 26, T2) The server `now` of this page's first screen answer
   *  (`useScreenState` stamps it on every answer; `withFirstNow`). A glitch
   *  cued at or before it is one this page never saw happen — a reload mid
   *  glitch — and never plays. Absent (hand-built states): no such bound. */
  firstNow?: number;
  /** (wave 26, T2) The server `now` of the first answer this page got that
   *  carried the current glitch cue (`withFirstNow`, remembered per cue). A
   *  glitch first seen more than `GLITCH_FRESH_MS` after its cue — a page
   *  that lost the server around it and came back mid-takeover — never
   *  plays. Absent (hand-built states, no live glitch): no such bound. */
  glitchSeen?: number;
  night: ScreenNight;
  /** The house's live story moments, oldest first (wave 17; [] from an older server). */
  moments: ScreenMoment[];
  cues: Partial<Record<ScreenCueFamily, ScreenCue | null>>;
  /** `hold` — the character has a `hold:` line (it always answers): show no presence. */
  character: { id: string; hidden: boolean; awake: boolean; online: boolean; hold: boolean } | null;
  attract: boolean;
  countdown: string | null;
  remaining: number | null;
  /** The live chart while a chart slide is up (the Trust Chart), else null. */
  chart: ScreenChart | null;
  target: ScreenTarget;
  program: ScreenProgram;
  /** Only on a poll that named a voice room (or a `room`). */
  voice: ScreenVoice | null;
  /** Only on a poll that named a `room` (null: none, or an older server). */
  room: ScreenRoom | null;
  /** The latest house announcement (N-09, `announce.ts`), null before the first. */
  announce: Announcement | null;
  /** The last few announcements, oldest first (an older server: just `announce`). */
  announces: Announcement[];
  /** A director's `identify` is live for this terminal (SW-SCR-21). */
  identify: boolean;
  /** Its ms left at `now` (null: an older server; `identifyOn` decides). */
  identifyLeft: number | null;
  /** Which sim the announcements belong to (null: an older server): a change
   *  is a restart or a server boot, and the announce cursor resyncs. */
  announceEpoch: string | null;
  /** The King's shared health bar (wave 11; null: no King, or an older server). */
  king: ScreenKing | null;
  /** Programs in the reinstallation simulation right now (0: none, or an older server). */
  reinstalling: number;
  /** The results the story is reading out (wave 18b; null: none public now, or an older server).
   *  Optional for hand-built states; `parseScreenState` always sets it. */
  results?: ScreenResults | null;
  /** This terminal's map spot (wave 18b; null: unplaced, or an older server).
   *  Optional for hand-built states; `parseScreenState` always sets it. */
  spot?: ScreenSpot | null;
  /** (wave 26, V1 phase 2) What the TV is speaking now (null: no TV reported
   *  in the last 6 s, or an older server). Optional for hand-built states;
   *  `parseScreenState` always sets it. */
  tvSpeech?: TvSpeech | null;
  /** (wave 56) How broken his voice is (`core/src/voice-fx.ts`); null from an
   *  older server: he speaks plainly. */
  voiceFx?: VoiceFxState | null;
  /** (wave 50) Clippy's dream, while the story has it on: `at` is when the
   *  takeover starts (server ms; 0: long since). Null: off, or an older
   *  server. Optional for hand-built states. */
  dream?: { at: number } | null;
  /** (wave 59a) The audio ad on the air, for a terminal the server may play one
   *  on (`adTerminal`). Null: none, or an older server. Optional for hand-built states. */
  ad?: AdOnAir | null;
}

/** A ranked chart the server keeps live (`SCREEN_CHARTS`, core). */
export interface ScreenChart {
  slide: string;
  /** Ranked rows. `staff` (wave 21): a player part (Clippy, the Antivirus)
   *  ranked beside the programs; absent on the wire (a program, or an older
   *  server) = false; `chartOf` always sets it. */
  rows: Array<{ name: string; value: number; staff?: boolean }>;
  /** The names the story calls out at the top / bottom (null = nobody yet).
   *  Matched by name: the bottom may be past the server's row cap. */
  top: string | null;
  bottom: string | null;
  /** Server epoch ms the slide went up; 0 = history (or an older server):
   *  every row at once. */
  revealAt: number;
}

/** A chart off the wire; malformed rows are dropped, a malformed chart is null.
 *  `top` / `bottom` / `revealAt` are optional (a w3 server sends none). */
export function chartOf(raw: unknown): ScreenChart | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["slide"] !== "string" || !Array.isArray(r["rows"])) return null;
  const rows: ScreenChart["rows"] = [];
  for (const x of r["rows"]) {
    if (typeof x !== "object" || x === null) continue;
    const row = x as Record<string, unknown>;
    if (typeof row["name"] === "string" && typeof row["value"] === "number" && Number.isFinite(row["value"])) rows.push({ name: row["name"], value: row["value"], staff: row["staff"] === true });
  }
  const name = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  const revealAt = typeof r["revealAt"] === "number" && Number.isFinite(r["revealAt"]) && r["revealAt"] > 0 ? r["revealAt"] : 0;
  return { slide: r["slide"], rows, top: name(r["top"]), bottom: name(r["bottom"]), revealAt };
}

/** What a TV adds to its poll: the room it speaks for + its chat cursor. A
 *  room terminal (`as: "room"`) names the room it belongs to instead: the
 *  server then also answers whether that room is open. */
export interface VoiceQuery {
  room: string;
  after: number | null;
  as?: "voice" | "room";
  /** (wave 25) Its room speech: `talk` / `said` (absent: it doesn't speak). */
  speech?: SpeechReport | null;
}

/** The poll URL for this terminal (its name/spot/view + device health ride along as the heartbeat). */
export function screenStateUrl(c: Pick<TerminalConfig, "eventId" | "name" | "spot" | "view" | "character">, voice: VoiceQuery | null = null, device: DeviceHealth | null = null): string {
  const q = new URLSearchParams({ name: c.name, spot: c.spot, view: c.view, character: c.character });
  if (voice !== null) {
    q.set(voice.as === "room" ? "room" : "voice", voice.room);
    if (voice.after !== null) q.set("after", String(voice.after));
    for (const [k, v] of Object.entries(speechQuery(voice.speech))) q.set(k, v);
  }
  if (device !== null) for (const [k, v] of Object.entries(deviceQuery(device))) q.set(k, v);
  return `${baseOf(c)}/api/screen/state?${q.toString()}`;
}

/** A room block off the wire; anything malformed is null. */
export function roomOf(raw: unknown): ScreenRoom | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["id"] !== "string" || typeof r["open"] !== "boolean") return null;
  return { id: r["id"], open: r["open"], cue: roomCueOf(r["cue"]) };
}

/** A voice block off the wire; malformed lines are dropped, a malformed block is null. */
export function voiceOf(raw: unknown): ScreenVoice | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["head"] !== "number" || !Number.isFinite(r["head"])) return null;
  const lines: VoiceLine[] = [];
  for (const l of Array.isArray(r["lines"]) ? r["lines"] : []) {
    if (typeof l !== "object" || l === null) continue;
    const x = l as Record<string, unknown>;
    if (typeof x["seq"] !== "number" || typeof x["from"] !== "string" || typeof x["text"] !== "string") continue;
    lines.push({ seq: x["seq"], from: x["from"], text: x["text"], beat: typeof x["beat"] === "string" ? x["beat"] : null });
  }
  return { room: typeof r["room"] === "string" ? r["room"] : "", muted: r["muted"] === true, head: r["head"], lines, ...(r["held"] === true ? { held: true } : {}) };
}

function shotOf(v: unknown): ScreenShot | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r["value"] !== "string" || typeof r["cue"] !== "string") return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const shot: ScreenShot = { value: r["value"], cue: r["cue"], seq: n(r["seq"]), at: n(r["at"]) };
  // (wave 32, C5) A glitch's own words: a short line, else none.
  const text = typeof r["text"] === "string" ? r["text"].trim().slice(0, GLITCH_TEXT_MAX) : "";
  if (text !== "") shot.text = text;
  // (wave 32) The server's word that a glitch is an ad burst.
  if (r["light"] === true) shot.light = true;
  return shot;
}

/** (wave 32) The longest glitch line a screen shows (the server clips at 120 too). */
export const GLITCH_TEXT_MAX = 120;

/** A program off the wire; anything malformed reads as "nothing to layer". */
export function programOf(raw: unknown): ScreenProgram {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const slideShot = shotOf(r["slide"]);
  const slideRaw = (r["slide"] ?? {}) as Record<string, unknown>;
  const glitch = shotOf(r["glitch"]);
  return {
    slide: slideShot === null ? null : { ...slideShot, kind: slideRaw["kind"] === "base" ? "base" : "slide", persist: slideRaw["persist"] === true },
    overlay: shotOf(r["overlay"]),
    blackout: shotOf(r["blackout"]),
    flicker: shotOf(r["flicker"]),
    ...(glitch !== null ? { glitch } : {}),
  };
}

/** Accept a body only if it has the shape the terminal relies on. */
export function parseScreenState(raw: unknown, receivedAt: number = Date.now()): ScreenState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["attract"] !== "boolean") return null;
  const ch = r["character"];
  const character =
    typeof ch === "object" && ch !== null && typeof (ch as Record<string, unknown>)["id"] === "string"
      ? {
          id: String((ch as Record<string, unknown>)["id"]),
          hidden: (ch as Record<string, unknown>)["hidden"] === true,
          awake: (ch as Record<string, unknown>)["awake"] !== false,
          online: (ch as Record<string, unknown>)["online"] === true,
          hold: (ch as Record<string, unknown>)["hold"] === true,
        }
      : null;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    now: num(r["now"]) ?? 0,
    receivedAt,
    night: nightOf(r["night"]),
    moments: momentsOf(r["moments"]),
    cues: (typeof r["cues"] === "object" && r["cues"] !== null ? r["cues"] : {}) as ScreenState["cues"],
    character,
    attract: r["attract"] as boolean,
    countdown: str(r["countdown"]),
    remaining: num(r["remaining"]),
    chart: chartOf(r["chart"]),
    target: r["target"] === "tv" ? "tv" : "terminals",
    program: programOf(r["program"]),
    voice: voiceOf(r["voice"]),
    room: roomOf(r["room"]),
    announce: announceOf(r["announce"]),
    announces: announcesOf(r["announces"], r["announce"]),
    identify: r["identify"] === true,
    identifyLeft: num(r["identifyLeft"]),
    announceEpoch: str(r["announceEpoch"]),
    king: kingOf(r["king"]),
    reinstalling: typeof r["reinstalling"] === "number" && r["reinstalling"] > 0 ? Math.floor(r["reinstalling"]) : 0,
    results: resultsOf(r["results"]),
    spot: spotOf(r["spot"]),
    tvSpeech: tvSpeechOf(r["tvSpeech"]),
    dream: dreamOf(r["dream"]),
    ad: adOf(r["ad"]),
    voiceFx: voiceFxOf(r["voiceFx"]),
    photos: r["photos"] === true,
  };
}

/** A `voiceFx` block off the wire; anything malformed (or an older server's
 *  none) is null. A flavour this build doesn't know is left out. */
export function voiceFxOf(raw: unknown): VoiceFxState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const level = r["level"];
  if (typeof level !== "number" || !Number.isFinite(level)) return null;
  const s = r["spike"];
  let spike: VoiceFxState["spike"] = null;
  if (typeof s === "object" && s !== null) {
    const o = s as Record<string, unknown>;
    const flavours = (Array.isArray(o["flavours"]) ? o["flavours"] : []).filter((f): f is VoiceFlavour => (VOICE_FLAVOURS as readonly unknown[]).includes(f));
    if (typeof o["key"] === "string" && typeof o["at"] === "number" && typeof o["ms"] === "number" && typeof o["strength"] === "number" && flavours.length > 0) {
      spike = { key: o["key"], at: o["at"], ms: o["ms"], strength: o["strength"], flavours };
    }
  }
  return { level: Math.min(1, Math.max(0, level)), spike };
}

/** A `dream` block off the wire; anything malformed (or an older server's none) is null. */
export function dreamOf(raw: unknown): { at: number } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const at = (raw as Record<string, unknown>)["at"];
  return typeof at === "number" && Number.isFinite(at) && at >= 0 ? { at } : null;
}

/** (wave 59a) An `ad` block off the wire; anything malformed is no ad. */
export function adOf(raw: unknown): AdOnAir | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const n = (k: string): number | null => (typeof r[k] === "number" && Number.isFinite(r[k]) ? r[k] : null);
  const [seq, ad, at, until] = [n("seq"), n("n"), n("at"), n("until")];
  if (seq === null || ad === null || at === null || until === null || typeof r["name"] !== "string" || typeof r["url"] !== "string" || !r["url"].startsWith("/")) return null;
  return { seq, n: ad, name: r["name"], url: r["url"], at, until };
}

/** The recent announcements, oldest first; an older server sends only
 *  `announce`, which is then the list. Malformed entries drop. */
export function announcesOf(raw: unknown, latest: unknown): Announcement[] {
  if (!Array.isArray(raw)) {
    const one = announceOf(latest);
    return one === null ? [] : [one];
  }
  return raw.map(announceOf).filter((a): a is Announcement => a !== null).sort((a, b) => a.seq - b.seq);
}

/** How long an `identify` lasts when an older server doesn't say (its `IDENTIFY_MS`). */
export const IDENTIFY_MS = 10_000;

/**
 * Is a director's `identify` showing at local time `now`? Counted down from
 * the answer that carried it, so a tablet that loses the server mid-identify
 * (the last answer is kept) uncovers on time instead of staying covered.
 */
export function identifyOn(state: Pick<ScreenState, "identify" | "identifyLeft" | "receivedAt"> | null, now: number): boolean {
  if (state === null || !state.identify) return false;
  return now < state.receivedAt + (state.identifyLeft ?? IDENTIFY_MS);
}

/** The character is asleep but a program is reinstalling: a house terminal
 *  whose screen can show the simulation watches it full screen instead of
 *  the screensaver (from the first capture, whatever the character does). A
 *  room terminal, the TV, the board, the casino and the face never do.
 *  Wave 26 (R5): a placed `auto` / `world` wall watches only while a player
 *  is in its room in the game (`spot.here > 0`; the house-wide
 *  `reinstalling` only when the server sends no `here`), never with no
 *  spot; the `mirror` / `shadow` spectator screens stay house-wide.
 *  `spot` = this terminal's map spot id (`config.spot`). */
export function watchWhileAsleep(state: ScreenState | null, view: string, room: boolean, spot: string): boolean {
  if (state === null || room) return false;
  if (view !== "auto" && view !== "world" && view !== "mirror" && view !== "shadow") return false;
  return linkedNow({ view, spot, here: state.spot, anyone: state.reinstalling > 0 });
}

/** Attract or not: no answer yet is attract (fail closed). A room terminal
 *  (`room` true) also stays on attract when the answer has no room block —
 *  a server too old to say whether its room is open. */
export function attractOf(state: ScreenState | null, room = false): boolean {
  if (state === null) return true;
  return state.attract || (room && state.room === null);
}

export type PollOutcome = { kind: "state"; state: ScreenState } | { kind: "revoked" } | { kind: "ended" } | { kind: "miss" };

/** One poll. A 401/403 is a revoked token; a 404 "unknown event" means the
 *  event this terminal was set up for is over (a new one was launched); anything
 *  else that fails is a miss (keep the last answer). `announce`: whether this
 *  tablet says the house announcements, reported as `ann` (null: not said). */
export async function pollScreen(c: TerminalConfig, fetchFn: typeof fetch = fetch, voice: VoiceQuery | null = null, announce: boolean | null = null): Promise<PollOutcome> {
  try {
    const res = await fetchFn(screenStateUrl(c, voice, deviceHealth(announce)), { headers: { "x-loom-token": c.token }, cache: "no-store" });
    if (res.status === 401 || res.status === 403) return { kind: "revoked" };
    if (res.status === 404) {
      const err = await res.json().then((j: unknown) => (typeof j === "object" && j !== null ? (j as Record<string, unknown>)["error"] : null)).catch(() => null);
      return err === "unknown event" ? { kind: "ended" } : { kind: "miss" };
    }
    if (!res.ok) return { kind: "miss" };
    const state = parseScreenState(await res.json());
    return state === null ? { kind: "miss" } : { kind: "state", state };
  } catch {
    return { kind: "miss" };
  }
}

/** Polls in a row that may miss before the bar's dot goes dark: one
 *  dropped 2 s poll is a blip, two is the server gone. */
export const MISSES_OFFLINE = 2;

/** Missed polls in a row after this outcome (an answer resets it). */
export function missesAfter(misses: number, out: PollOutcome["kind"]): number {
  return out === "state" ? 0 : misses + 1;
}

/** Is the server answering? The last good state is kept on a miss (so the
 *  screen doesn't flicker), so its presence alone can't say. */
export function screenReachable(state: ScreenState | null, misses: number): boolean {
  return state !== null && misses < MISSES_OFFLINE;
}

/** The server `now` of this page's first screen answer (null: none yet).
 *  Once per page load, whatever the config: a glitch is live only after it. */
let pageFirst: number | null = null;
/** The glitch cue this page last saw (`seq:at`) and the server `now` of the
 *  first answer that carried it. */
let glitchFirst: { key: string; now: number } | null = null;
/**
 * Stamp an answer with the page's first answer's server time (the first one
 * sets it) and, while it carries a live glitch cue, with the server time this
 * page first saw that cue (`glitchSeen`).
 */
export function withFirstNow(state: ScreenState): ScreenState {
  pageFirst ??= state.now;
  const g = state.program.glitch ?? null;
  if (g === null || g.at <= 0) return { ...state, firstNow: pageFirst };
  const key = `${g.seq}:${g.at}`;
  if (glitchFirst === null || glitchFirst.key !== key) glitchFirst = { key, now: state.now };
  return { ...state, firstNow: pageFirst, glitchSeen: glitchFirst.now };
}
/** Forget the page's first answer and the glitch it saw (tests). */
export function resetPageFirst(): void {
  pageFirst = null;
  glitchFirst = null;
}

/**
 * Poll the screen state every `SCREEN_POLL_MS` (the TV: `TV_POLL_MS`) while a
 * config is present. Returns the last good answer (null until the first),
 * whether the server is answering right now (`reachable`), whether the server
 * refused this terminal's token, and whether its event is gone. `voice` (the TV) is read
 * fresh on every poll, so the cursor can move without restarting the loop.
 * `pollNow` (stable) asks for a poll at once — the speech queue draining
 * (wave 25) — paced by `PollPacer`: never two starts within
 * `DRAIN_REPOLL_GAP_MS`, and one in flight is followed by another. Every
 * answer is stamped by `withFirstNow`.
 */
export function useScreenState(
  config: TerminalConfig | null,
  voice: (() => VoiceQuery) | null = null,
): { state: ScreenState | null; reachable: boolean; revoked: boolean; ended: boolean; pollNow: () => void } {
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const kickRef = useRef<() => void>(() => {});
  const pollNow = useCallback(() => kickRef.current(), []);
  const [state, setState] = useState<ScreenState | null>(null);
  const [misses, setMisses] = useState(0);
  const [revoked, setRevoked] = useState(false);
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    setState(null);
    setMisses(0);
    setRevoked(false);
    setEnded(false);
    if (config === null) return;
    let alive = true;
    let timer = 0;
    const every = config.view === "tv" ? TV_POLL_MS : SCREEN_POLL_MS;
    const pacer = new PollPacer(every);
    let last: ScreenState | null = null;
    const tick = async () => {
      window.clearTimeout(timer);
      pacer.start(Date.now());
      // `ann` is what this tablet does now: its own setting, else the house
      // list's word off the last answer (left out until there is one).
      const out = await pollScreen(config, fetch, voiceRef.current?.() ?? null, announceReport(config, last));
      if (!alive) return;
      setMisses((m) => missesAfter(m, out.kind));
      if (out.kind === "state") {
        last = withFirstNow(out.state);
        setState(last);
      }
      else if (out.kind === "revoked") {
        pacer.stop();
        setRevoked(true);
        return; // stop polling: setup takes over
      } else if (out.kind === "ended") {
        pacer.stop();
        setEnded(true);
        return; // stop polling: setup asks for the next event's passcode
      }
      // Wave 59: his next line waits on the teleprompter: be there when it goes.
      const delay = pacer.done(Date.now());
      timer = window.setTimeout(() => void tick(), last?.voice?.held === true ? Math.min(delay, HELD_POLL_MS) : delay);
    };
    kickRef.current = () => {
      if (!alive) return;
      const delay = pacer.kick(Date.now());
      if (delay === null) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void tick(), delay);
    };
    void tick();
    return () => {
      alive = false;
      pacer.stop();
      kickRef.current = () => {};
      window.clearTimeout(timer);
    };
  }, [config]);
  return { state, reachable: screenReachable(state, misses), revoked, ended, pollNow };
}
