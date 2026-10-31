//! The lean screen state (OCT31 K-16): what every wall terminal polls instead
//! of the mod feed. `GET /e/:id/api/screen/state` answers in ~1 KB:
//!
//! - `night`     — the story's own screen mirrors, `Night.screen` / `Night.terminals`,
//!                 and (wave 17) the public vars a cutscene reads: the phase,
//!                 the step, the bottle's pick and whether it waits on
//!                 Truth or Dare, the results question, the advice tally, the alert
//!                 level, and the award winner + value while an `award_*`
//!                 slide is up (`SCREEN_NIGHT_VARS`; "none" reads null);
//! - `moments`   — (wave 17) the last `MOMENT_RING` live story moments, oldest
//!                 first: house-wide beats, allowlisted signals (admin cues
//!                 the story took, `do pick` draws and their verdict — the
//!                 first booth press taken about the pick —, the King / chess /
//!                 reinstallation devices), `sound X` names, reveals to
//!                 everyone and duck finds (`momentOf`), never history, never
//!                 a per-guest beat, a guest's or other booth press or a secret;
//! - `cues`      — the last `cue screens_*` / `terminals_*` / `tv_*` / `tablet_*`
//!                 value per family, folded from the sim log (a `seq` per family
//!                 so a re-fired cue — `screens_flicker` twice — is visible);
//! - `character` — the terminal's character: hidden (not yet `reveal`ed to
//!                 everyone), `awake` (its `<id>.awake` var, absent = awake) and
//!                 whether an agent worker is voicing it;
//! - `attract`   — hidden or asleep: the terminal shows the screensaver / ads,
//!                 never "ONLINE", and never pilots a pass into the thread;
//! - `remaining` — seconds left on the story countdown that is running, if any;
//! - `chart`     — while a chart slide is the story's screen (`trust_chart`),
//!                 the ranked rows it draws live: every cleared participant
//!                 and their number, highest first (`SCREEN_CHARTS`), the
//!                 `top` / `bottom` names the story has called out, and
//!                 `revealAt` (server ms the slide went up) so every screen
//!                 reveals the rows bottom-up from the same moment;
//! - `identify`  — true while a director's `identify` (install day) is live
//!                 for this terminal's name: it shows its name full screen
//!                 (`identifyLeft`: the ms left, counted down on the device);
//! - `announce`  — (N-09) the latest house announcement, `do announce "…"`
//!                 (`{seq, text, at}`: a `seq` per announcement, `at` 0 for
//!                 replayed history) — a terminal set to say announcements
//!                 speaks a new one in its own voice after a chime;
//! - `announces` — the last `ANNOUNCE_RING` announcements, oldest first, so
//!                 two inside one poll are both said (`announce` is the last
//!                 of them, kept for older terminal builds); `announceEpoch`
//!                 changes with the sim (a restart, a boot) so a terminal
//!                 resyncs its cursor even when the new seqs reach the old;
//! - `voice`     — (K-18, only when the poll names a `voice` room — the TV —
//!                 or a `room`) the characters' lines said in that location's
//!                 room after the poller's `after` seq, the room's `head` seq,
//!                 and the director's TV-voice mute (`POST /api/mod/screen/voice`),
//!                 which silences the TV only: a room terminal is never muted;
//! - `room`      — (wave 7, only when the poll names a `room` — a terminal
//!                 that belongs to a LOCATION, the server-room terminal)
//!                 `{id, open}`: the LOCATION and whether it is open to
//!                 everyone (not `hidden:`, or `reveal`ed with no `for`; a
//!                 per-person reveal or a visit doesn't count). While it is
//!                 closed the terminal is on attract; an unknown name answers
//!                 `{id: "", open: false}` (a typo never wakes a secret room).
//!                 Before the doors (no sim) the name resolves against the
//!                 story's declared LOCATIONs: a correct one is `{id, open:
//!                 false}`, so only a typo reads as "no room called …".
//! - `king`      — (wave 11, C2) the shared King of the house map: `{hp, max,
//!                 fallen, armed}` — his one health bar for the night (it sets
//!                 how well he plays at the chess terminal) and whether a
//!                 checkmate counts now (`armed`: his prop's `armed` world var
//!                 at or above its `min`; null = no `armed` path, or no story
//!                 yet). Null when the map has no King.
//!
//! The director's side (K-29): `GET /api/mod/screen/terminals` answers the
//! heartbeat list (each terminal's last poll: name, spot, view, how long ago,
//! and the device health a current build reports — sound unlocked, page
//! visible, battery, full screen (wave 17), build version, SW-SCR-21; since wave 17 only here, not
//! on every terminal's answer) + the TV-voice mute, without recording a poll, for the
//! editor's Run → Terminals card (red after `TERMINAL_SILENT_MS`, a chime);
//! `POST /api/mod/screen/identify {name}` makes that terminal show its name
//! for `IDENTIFY_MS` (SW-SCR-21).
//!
//! The house desk (wave 25, `server/desk.ts` §5): a voice / room poll also
//! carries `talk=1|0` (speaking, or holding unspoken room lines) and
//! `said=<seq>` (every room line at or below it finished). Both are kept with
//! the heartbeat (memory only); `speechWatchOf` ends a desk `speech` step once
//! every terminal that speaks the room has fallen quiet. The runtime pokes the
//! desk on every poll.
//!
//! Why not the mod feed (`docs/trapped/screens-audit.md` §3.3): it pushes a
//! full ModView per story step, carries every DM onto a wall a guest can
//! touch, has no "current state" for a rebooted tablet, and counts every
//! screen as a director. A poll of this route has none of those problems —
//! and because the fold reads the sim's own log, a restarted server (which
//! replays the journal) answers the same thing it answered before.
//!
//! Transport-free apart from `handleScreenGet`; `ScreenWatch` takes an
//! injected clock for tests.

import { isVoiceFlavour, isVoiceFxMode, voiceFxOf, type VoiceFlavour, type VoiceFx, type VoiceFxMode, type VoiceShot } from "../../src/voice-fx.ts";
import { isLinkError, type LinkError } from "../../src/link-health.ts";
import type { CamRate } from "../spatial-cams.ts";
import type { ShowClock } from "../../src/show-clock.ts";
import type { IncomingMessage, ServerResponse } from "node:http";

import { ESCAPE_SIGNAL, HEART_SIGNAL, KING_SIGNALS, PICKUP_SIGNAL, type KingState } from "@loom/house";

import type { Sim } from "../../src/runtime/sim/index.ts";
import { inWorldLabel, type SimModel } from "../../src/runtime/sim/model.ts";
import type { BodyItem } from "../../src/parser/ast.ts";
import { parseSet, splitDirective } from "../../src/runtime/sim/effects.ts";
import type { SimEvent } from "../../src/runtime/sim/event.ts";
import { cueText, globalScope, splitAlert, type ChatMessage } from "../chat.ts";
import { foldName } from "../../src/parser/names.ts";
import { isPrivateSlot } from "../../src/runtime/sim/stats.ts";
import { DEFAULT_CONFIRM } from "../facts.ts";
import { signalRefusedAt } from "../views.ts";
import { queryTokenOf, readBody, sendJson, tokenOf } from "../http-util.ts";

/** The cue families a screen cares about (`cue <family>_<value>`). */
export const SCREEN_CUE_FAMILIES = ["screens", "terminals", "tv", "tablet"] as const;
export type ScreenCueFamily = (typeof SCREEN_CUE_FAMILIES)[number];

/**
 * The story's countdowns, most specific first: while `on` is true the
 * countdown runs to `end` (story seconds, against `Time.elapsed`). The vars
 * are *Trapped in the Internet*'s (`main.loom`); a story without them simply
 * never has a countdown.
 */
export const SCREEN_COUNTDOWNS: ReadonlyArray<{ name: string; on: string; end: string }> = [
  { name: "y2k", on: "Night.final_round", end: "Night.y2k_end" },
  { name: "summons", on: "Night.summons_open", end: "Night.summons_end" },
  { name: "hunt", on: "Night.hunt_on", end: "Night.hunt_end" },
  { name: "hunt_2", on: "Night.hunt2_on", end: "Night.hunt2_end" },
  { name: "bingo", on: "Night.bingo_on", end: "Night.bingo_end" },
];

/**
 * The story's live charts: while `Night.screen` / `Night.terminals` shows
 * `slide`, the state carries every participant whose `<id>.<only>` is true,
 * ranked by `<id>.<value>` (highest first, then by name). *Trapped in the
 * Internet*'s Trust Chart; a story without the slide never has a chart.
 *
 * `top` / `bottom` are the story vars holding the names it calls out (the
 * show sets them when Trabolta praises the top and shames the bottom, and
 * `"none"` until then). A story that never mentions them gets the ranked
 * chart's own first and last names instead.
 */
export const SCREEN_CHARTS: ReadonlyArray<{ slide: string; value: string; only: string; top: string; bottom: string }> = [
  { slide: "trust_chart", value: "trust", only: "cleared", top: "Night.most_trusted", bottom: "Night.least_trusted" },
];
/** At most this many chart rows (a party, not a census). */
export const MAX_CHART_ROWS = 40;
/** A call-out var holding this (or nothing) names nobody yet. */
export const CHART_NOBODY = "none";

/** One Trust Chart row. Wave 21 (C6): a `player: true` performer part
 *  ranks beside the programs with `staff: true` (a program's row has no
 *  flag; a terminal reads an absent flag as false). */
export interface ScreenChartRow {
  name: string;
  value: number;
  staff?: true;
}

export interface ScreenChart {
  slide: string;
  rows: ScreenChartRow[];
  /** The name the story calls out at the top / bottom (null = nobody yet).
   *  Either may be past `MAX_CHART_ROWS`, so a screen matches it by name. */
  top: string | null;
  bottom: string | null;
  /** Server epoch ms the chart slide went up on this target; 0 = it was
   *  already up in replayed history (a restart), so nothing re-reveals. */
  revealAt: number;
}

/** Does the story mention `path` anywhere (a rule, a role's or a
 *  character's hook, a beat)? Read off the compiled model's own text. */
export function storyMentions(model: Sim["model"], paths: readonly string[]): Set<string> {
  let text = "";
  try {
    text = JSON.stringify([model.rules, [...model.roles.values()].map((r) => r.hooks), [...model.characters.values()].map((c) => c.hooks), [...model.beats.values()]]).toLowerCase();
  } catch {
    text = "";
  }
  return new Set(paths.filter((p) => text.includes(p.toLowerCase())));
}

// --- the screen program (K-17 + N-03) -----------------------------------------

/** Who a screen cue is for: `screens_*` = both, `tv_*` = the TV, `terminals_*` =
 *  the wall terminals. `tablet_*` (the tent tablet) reaches neither. */
export type ScreenTarget = "tv" | "terminals";
export const SCREEN_TARGETS: readonly ScreenTarget[] = ["tv", "terminals"];
const FAMILY_TARGETS: Record<ScreenCueFamily, readonly ScreenTarget[]> = {
  screens: ["tv", "terminals"],
  tv: ["tv"],
  terminals: ["terminals"],
  tablet: [],
};

/** The terminal's target from its `view`: the TV runs `mirror` (or K-18's `tv`). */
export function screenTargetOf(view: string): ScreenTarget {
  return view === "mirror" || view === "tv" ? "tv" : "terminals";
}

/** Full-screen overlays that stand until the next slide / base cue (`alarm`:
 *  or until the story clears `ALARM_VAR`). */
export const SCREEN_OVERLAYS = ["blackout", "go_to_living_room", "alarm"] as const;
/** The story var the `alarm` overlay follows (*Trapped in the Internet*'s latch). */
export const ALARM_VAR = "Night.alarm_on";
/** Base cues: they clear the slide (back to attract / the configured view). */
export const SCREEN_BASES = ["screensaver", "attract", "trabolta_online", "mirror"] as const;

/** Slides that stay up until the next cue (no 45 s / 90 s hold); they beat attract.
 *  The finale's waits are among them (wave 17): the bob until 📄, the advice
 *  poll until its tally, Grok Prom and the banishment until the story's next
 *  screen cue — each one's scene keeps moving the whole time. Wave 44 (C3):
 *  the credits hold their end card until the next cue. Wave 58: the recount
 *  and purgatory stand through Task Manager's reading (attract would follow
 *  them otherwise, and he is gone: no face to come back to). */
const PERSISTENT_SLIDES: ReadonlySet<string> = new Set(["bingo", "y2k", "trust_chart", "truth_txt", "bobbing", "advice", "grok_prom", "banish", "hunt_results", "tally", "ad_hijack", "credits", "recount", "purgatory"]);
export function slidePersists(value: string): boolean {
  return PERSISTENT_SLIDES.has(value) || /^(award|ceremony)/u.test(value);
}

export type ScreenCueClass = "overlay" | "flicker" | "glitch" | "countdown" | "base" | "slide";

/** What a screen cue value does: `countdown_*` is a corner (it never replaces
 *  the slide), `flicker` and `glitch` (wave 26, T2) one-shot effects, the
 *  overlays stand, the bases clear, and anything else is a slide
 *  (`/terminal/slides/<cue>.png`). */
export function screenCueClass(value: string): ScreenCueClass {
  if ((SCREEN_OVERLAYS as readonly string[]).includes(value)) return "overlay";
  if (value === "flicker") return "flicker";
  if (value === "glitch") return "glitch";
  if (value.startsWith("countdown_") || value === "countdown") return "countdown";
  if ((SCREEN_BASES as readonly string[]).includes(value)) return "base";
  return "slide";
}

export interface ScreenShot {
  /** The cue's value (`trivia_1`). */
  value: string;
  /** The whole cue (`screens_trivia_1`) — the slide PNG is named after it. */
  cue: string;
  /** Bumps on every screen cue the fold sees. */
  seq: number;
  /** Server epoch ms the fold first saw it; 0 = replayed history (a restart),
   *  so a held slide or a blackout never re-runs after a reboot. */
  at: number;
  /** (wave 32, C5) A glitch shot only: the burst's own words, from
   *  `Night.glitch_text` as the fold saw it (the story sets it in the same
   *  rule as the cue). Absent = the terminals' old constant. */
  text?: string;
  /** (wave 32) A glitch shot only: `true` when `Night.glitch_kind` was
   *  `"burst"` as the fold saw it (a talk scene's short ad burst, never the
   *  📺's full takeover). Absent = the full one (or an older story). */
  light?: true;
}

export interface ScreenProgram {
  /** The newest slide or base cue for this target (a base one = no slide). */
  slide: (ScreenShot & { kind: "slide" | "base"; persist: boolean }) | null;
  /** The standing overlay (blackout / go_to_living_room / alarm), cleared by a newer slide or base cue
   *  — and `alarm` also as soon as the story's `Night.alarm_on` is no longer true. */
  overlay: ScreenShot | null;
  /** The last blackout (cleared like the overlay): 10 s of black even when another overlay follows at once. */
  blackout: ScreenShot | null;
  /** The last one-shot flicker. */
  flicker: ScreenShot | null;
  /** (wave 26, T2) The last glitch cue (`screens_glitch`, `tv_glitch`,
   *  `terminals_glitch`). Like `flicker`, it never touches slide or overlay.
   *  `at` follows the fold's rule: 0 for replayed history. */
  glitch: ScreenShot | null;
}

const emptyProgram = (): ScreenProgram => ({ slide: null, overlay: null, blackout: null, flicker: null, glitch: null });

/** (wave 32, C5) The world path a glitch shot's `text` reads. */
export const SCREEN_GLITCH_TEXT_PATH = "Night.glitch_text";

/** (wave 32) The world path that marks a glitch shot `light` (`"burst"`). */
export const SCREEN_GLITCH_KIND_PATH = "Night.glitch_kind";

/** Is `Night.glitch_kind` `"burst"` now (a talk scene's ad burst)? */
export function glitchIsBurst(sim: Sim | null): boolean {
  const v = sim?.world.peek(SCREEN_GLITCH_KIND_PATH) ?? null;
  return v !== null && v.kind === "string" && v.value.replace(/^"(.*)"$/su, "$1").trim() === "burst";
}

/** `Night.glitch_text` now, trimmed (≤ 120 chars), or null when unset,
 *  empty or `"none"`. */
export function glitchTextOf(sim: Sim | null): string | null {
  const v = sim?.world.peek(SCREEN_GLITCH_TEXT_PATH) ?? null;
  if (v === null || v.kind !== "string") return null;
  const t = v.value.replace(/^"(.*)"$/su, "$1").trim();
  return t === "" || t === "none" ? null : t.slice(0, 120);
}

/** Fold one screen cue into a target's program (pure; returns a new program). */
export function foldProgram(p: ScreenProgram, shot: ScreenShot): ScreenProgram {
  const cls = screenCueClass(shot.value);
  switch (cls) {
    case "overlay":
      return { ...p, overlay: shot, blackout: shot.value === "blackout" ? shot : p.blackout };
    case "flicker":
      return { ...p, flicker: shot };
    case "glitch":
      return { ...p, glitch: shot };
    case "countdown":
      return p; // the corner reads the running countdown, never a slide
    case "base":
    case "slide":
      return { ...p, slide: { ...shot, kind: cls, persist: cls === "slide" && slidePersists(shot.value) }, overlay: null, blackout: null };
  }
}

// --- the room voice (K-18 + N-04b) ---------------------------------------------

/** One line a character said in the voice room. `beat` is the scripted beat it
 *  was spoken in (the TV stays silent on the song beats); null = typed — a
 *  director's `say` as that character. */
export interface ScreenVoiceLine {
  seq: number;
  from: string;
  text: string;
  beat: string | null;
}

export interface ScreenVoice {
  /** The room's channel id (`loc:The Desktop`), or "" when the story has no such location. */
  room: string;
  /** The director's TV-voice mute: lines still arrive (as captions), nothing is spoken. */
  muted: boolean;
  /** The newest chat seq (−1 = none). A screen with no cursor yet starts here —
   *  no backlog — and one whose cursor is past it saw a restart: it resyncs. */
  head: number;
  /** Lines after the poller's `after`, oldest first, the newest `MAX_VOICE_LINES` at most. */
  lines: ScreenVoiceLine[];
  /** (wave 59) His next line waits for the teleprompter: `head` stops short of
   *  it, so the cursor stays behind it. A TV polls quicker while it is set. */
  held?: true;
}

/** Speakers the TV shows as captions though they aren't its character (Sandy is
 *  lore, decision #28). Mirrors `TV_TEXT_ONLY` in `terminal/src/tv.ts`. */
export const SCREEN_TEXT_ONLY: readonly string[] = ["Sandy"];

/** At most this many lines per answer (the newest). A whole scripted beat lands
 *  in one poll, so this is generous; a TV that was *away* resyncs on its own. */
export const MAX_VOICE_LINES = 40;
/** Longest line carried (wave 18b: a reading of every filing is one line). */
export const MAX_VOICE_TEXT = 4000;
/** At most this many characters in one answer's lines: past it the oldest
 *  are dropped (a TV that was away resyncs on its own). */
export const MAX_VOICE_BLOCK = 16_000;

/**
 * The lines said by a speaker `speaks` admits in `channel` after `after`
 * (pure). Narration, system notices and hidden messages are left out; the
 * poll admits only the TV's character + `SCREEN_TEXT_ONLY`, which leaves out
 * guests' typed chat. `after` null (a screen that just booted) returns no lines.
 *
 * Wave 59: `heldFrom` is the first line the teleprompter holds back (null: none).
 * The timeline ends just before it, `head` included, so a cursor can never pass
 * a held line and everything behind it plays in order once it is let go.
 */
export function voiceLinesOf(
  messages: readonly ChatMessage[],
  channel: string,
  after: number | null,
  speaks: (from: string) => boolean,
  max = MAX_VOICE_LINES,
  heldFrom: number | null = null,
): { head: number; lines: ScreenVoiceLine[] } {
  let end = messages.length;
  if (heldFrom !== null) while (end > 0 && messages[end - 1]!.seq >= heldFrom) end--;
  const head = end === 0 ? -1 : messages[end - 1]!.seq;
  const lines: ScreenVoiceLine[] = [];
  if (after === null || after >= head || channel === "") return { head, lines };
  let total = 0;
  for (let i = end - 1; i >= 0 && lines.length < max; i--) {
    const m = messages[i]!;
    if (m.seq <= after) break;
    if (m.channel !== channel || m.kind !== "line" || m.hidden || m.from === "" || !speaks(m.from)) continue;
    const text = m.text.slice(0, MAX_VOICE_TEXT);
    // Newest first: past the block's cap, the older lines are dropped.
    if (total + text.length > MAX_VOICE_BLOCK && lines.length > 0) break;
    total += text.length;
    lines.push({ seq: m.seq, from: m.from, text, beat: m.beat ?? null });
  }
  return { head, lines: lines.reverse() };
}

// --- the house announcement (N-09) ---------------------------------------------

/** The verb the story announces with (`do announce "Go to the living room."`) —
 *  the same directive stagehand's `show` sends to the house speakers (K-20). */
export const ANNOUNCE_VERB = "announce";
/** Longest announcement carried (characters) — the house-announcement player's
 *  `MAX_TEXT` (stagehand `alexa`). */
export const MAX_ANNOUNCE_TEXT = 300;
/** How many recent announcements the state carries (`announces`). */
export const ANNOUNCE_RING = 3;

/**
 * What a phone says of a typed announcement (wave 53, a host's 📣): no alert
 * mark, no emoji (a phone reads their names out), capped like the speakers'.
 * Empty: nothing to say.
 */
export function spokenAnnounce(raw: string): string {
  return raw
    .replace(/^[!~]+/u, "")
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_ANNOUNCE_TEXT);
}

export interface ScreenAnnounce {
  /** Bumps on every announcement the fold sees (history included). */
  seq: number;
  text: string;
  /** Server epoch ms the fold first saw it; 0 = replayed history. */
  at: number;
}

/**
 * The words of an announcement's directive args, read like stagehand reads
 * `{target}` (`show/directives.py`): the first top-level-comma segment that
 * isn't `key: value`, unquoted. `"Go to the living room."` → the sentence;
 * a bare `Five minutes. Everyone to the Desktop.` → itself; nothing → null.
 */
export function announceTextOf(args: string): string | null {
  const segments: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let depth = 0;
  for (const ch of args) {
    if (quote !== null) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      cur += ch;
    } else if ((ch === ")" || ch === "]" || ch === "}") && depth > 0) {
      depth--;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      segments.push(cur);
      cur = "";
    } else cur += ch;
  }
  segments.push(cur);
  for (const raw of segments) {
    const seg = raw.trim();
    if (seg === "") continue;
    const quoted = seg.length >= 2 && (seg[0] === '"' || seg[0] === "'") && seg[seg.length - 1] === seg[0];
    // A `key: value` named argument (outside quotes) is not the words.
    if (!quoted && /^[\p{L}\p{N}_-]+\s*:/u.test(seg)) continue;
    const text = (quoted ? seg.slice(1, -1) : seg).replace(/\s+/gu, " ").trim();
    if (text === "" || text === "{target}") return null;
    if (text.length <= MAX_ANNOUNCE_TEXT) return text;
    return text.slice(0, MAX_ANNOUNCE_TEXT).replace(/\s+\S*$/u, "") || text.slice(0, MAX_ANNOUNCE_TEXT);
  }
  return null;
}

// --- the moments ring (wave 17) ------------------------------------------------

/** How many recent moments the state carries (`moments`). The TV polls every
 *  second and a wall terminal every two, so the ring only has to hold what
 *  happens between two polls. */
export const MOMENT_RING = 12;
/** Longest moment name / `who` carried (characters). */
const MAX_MOMENT_NAME = 48;

export type ScreenMomentKind = "beat" | "signal" | "sfx" | "reveal" | "found" | "big";

/**
 * A live, house-wide story moment the screens can animate (the introduction,
 * the bottle landing, the Heart, a find): never history (a fold's first look
 * is stamped 0 and carries none), never a per-guest beat, never a secret.
 */
export interface ScreenMoment {
  /** The sim log seq (1-based log index; monotonic within an `announceEpoch`). */
  seq: number;
  /** Server epoch ms the fold first saw it. */
  at: number;
  kind: ScreenMomentKind;
  /** The beat's name (`Trabolta Introduction`), the signal's (`bottle_landed`),
   *  the sound's (`printer_grind`), the revealed place / character, or
   *  `golden duck` (`golden duck kept` when the story kept the finder). */
  name: string;
  /** The program the moment is about (the bottle's pick, the duck's finder)
   *  by display name, else null. */
  who: string | null;
  /** A `big` moment's whole line (wave 18: a `broadcast "!!…"` to everyone,
   *  its `!!` stripped, its leading glyph kept); `name` is it clipped. */
  text?: string;
}

/** Longest big line carried (characters; the terminals clip to the same). */
export const MAX_BIG_LINE = 200;

/** The duck's two signals (`EventRuntime.commitFound`): the first is folded
 *  into the second, which becomes the `found` moment. */
const FOUND_SIGNAL = "the golden duck";
const FOUND_FIRST = "the simulation completed";

/** Folded names a moment may never carry: every `secret: true` character's
 *  (the Kernel) — a beat owned by one, a signal named after one. */
export function secretMomentNames(model: SimModel): string[] {
  const out = new Set<string>(["kernel"]);
  for (const c of model.characters.values()) if (c.secret) out.add(foldName(c.id));
  return [...out];
}

const touchesSecret = (name: string, secrets: readonly string[]): boolean => {
  const f = foldName(name);
  return secrets.some((s) => f === s || f.startsWith(`${s}.`) || f.startsWith(`${s} `));
};

/** The device signals a screen may animate, folded: the King's and the
 *  chess board's defaults (`KING_SIGNALS`) and the reinstallation's start.
 *  A map's own king signal names are added by the runtime (`MomentSignals.devices`). */
export const DEVICE_MOMENT_SIGNALS: readonly string[] = [...Object.values(KING_SIGNALS).filter((s) => s !== KING_SIGNALS.won), "reinstallation begun"].map(foldName);

/** (wave 26, C6) The reinstallation games' moment signals (`POST
 *  /api/spatial/moment`): admin interactions the games fire, never a public
 *  moment on the screens ("simulation heart reached" on a wall would name
 *  the machinery, G2). The same strings as `@loom/house`'s `ESCAPE_SIGNAL`,
 *  `HEART_SIGNAL` and `PICKUP_SIGNAL` (house lane, wave 26 Stage A); a test
 *  pins them equal once the house exports them. */
export const GAME_MOMENT_SIGNALS: readonly string[] = [ESCAPE_SIGNAL, HEART_SIGNAL, PICKUP_SIGNAL];

/** Never a moment: a checkmate (the story tells only the winner and
 *  `# hosts` — a public one would hint who now holds the door code). Folded,
 *  so the show's admin `chess_won` press is quiet too. Wave 20: the server
 *  room's admin door cues (a door that opens
 *  and shuts is no house-wide event; the sensor's own `door_sensor_*` and
 *  the story's `heart_door_*` are not admin cues, so never moments anyway). */
export const QUIET_MOMENT_SIGNALS: readonly string[] = [KING_SIGNALS.won, "server_door_opened", "server_door_closed", "server_door_trust", "trust_patch_bay", ...GAME_MOMENT_SIGNALS].map(foldName);

/** (wave 20) Subject-free beats that never become a `beat` moment, folded:
 *  the server room's door chatter (the nag, the door again, the shut, the
 *  sealing). *The Heart* itself stays a moment. */
export const QUIET_MOMENT_BEATS: readonly string[] = ["Heart Nag", "Heart Door Again", "Heart Door Shut", "Heart Sealed"].map(foldName);

/** The booth presses that may stand as a draw's verdict (🗣 / 🙅 / 🎩 on the
 *  bottle's pick) — only those the story declares as an INTERACTION. Every
 *  other booth press (an accusation, a facts verdict, a charge) stays off
 *  the screens and never uses up the draw. */
export const BOTTLE_VERDICTS: readonly string[] = ["truth_answered", "truth_refused", "chose_dare"];

/** Every directive in a body, nested arms included. */
function* directivesIn(body: readonly BodyItem[]): Generator<string> {
  for (const item of body) {
    switch (item.kind) {
      case "directive":
        yield item.value.raw;
        break;
      case "directiveBlock":
        yield item.value.directive.raw;
        yield* directivesIn(item.value.body);
        break;
      case "conditional":
        for (const arm of item.value.arms) yield* directivesIn(arm.body);
        break;
      case "match":
        for (const arm of item.value.arms) yield* directivesIn(arm.body);
        break;
      case "eachVisit":
        yield* directivesIn(item.value.first);
        yield* directivesIn(item.value.then);
        yield* directivesIn(item.value.finally);
        break;
      case "afterMorph":
        yield* directivesIn(item.value.after);
        yield* directivesIn(item.value.otherwise);
        break;
      default:
        break;
    }
  }
}

const secretCueCache = new WeakMap<SimModel, ReadonlySet<string>>();

/** The admin cues (folded) whose own story rule writes a secret character's
 *  var (`set Kernel.majority = "leave"`): the cue's name tells the secret
 *  (🗳 force_majority_leave), so it is never a moment. Cached per model. */
export function secretWritingCues(model: SimModel): ReadonlySet<string> {
  const hit = secretCueCache.get(model);
  if (hit !== undefined) return hit;
  const secrets = secretMomentNames(model);
  const admin = new Set<string>();
  for (const i of model.interactions.values()) if (i.who === "admin") admin.add(foldName(i.id));
  const out = new Set<string>();
  for (const rule of model.rules) {
    const f = foldName(rule.verb);
    if (f === "" || !admin.has(f) || out.has(f)) continue;
    for (const raw of directivesIn(rule.body)) {
      const { verb, rest } = splitDirective(raw);
      if (verb !== "set") continue;
      const head = parseSet(rest)?.path[0];
      if (head !== undefined && secrets.includes(foldName(head))) {
        out.add(f);
        break;
      }
    }
  }
  secretCueCache.set(model, out);
  return out;
}

/** Which signals may become a moment. Everything else a signal can be — a
 *  guest's or a booth's INTERACTION press (but a draw's verdict), a room check-in (`checked_in`),
 *  a facts verdict, a phone's card answer — is about one person and may
 *  carry a secret in its subject (who planted the virus, who lied), so it
 *  is never put on every screen. All names folded (`foldName`). */
export interface MomentSignals {
  /** The admin cues (`INTERACTION … who: admin`): `who` is never carried. */
  admin: ReadonlySet<string>;
  /** Device signals (`DEVICE_MOMENT_SIGNALS` + the map's kings'): `who` = the player. */
  devices: ReadonlySet<string>;
  /** `do pick <event> … else <event>` names seen in the log: `who` = the pick. */
  picks: ReadonlySet<string>;
  /** Never a moment, even when allowlisted (the facts book's confirm events). */
  quiet: ReadonlySet<string>;
  /** The draw's verdicts (`BOTTLE_VERDICTS` the story declares, plus a
   *  runtime's own): a moment only as the verdict on the last draw's pick
   *  (`drawn`), `who` = the pick. */
  verdicts?: ReadonlySet<string>;
  /** The person the last live `do pick` drew, while its verdict is still due
   *  (the first booth press about them the story takes, within `VERDICT_MS`). */
  drawn?: string | null;
}

/** A draw's verdict (a booth press about its pick) counts this long after the draw (ms). */
export const VERDICT_MS = 5 * 60_000;

/** The allowlist a model gives on its own: its admin cues, the default
 *  devices, no picks yet, the default facts confirm events. */
export function momentSignalsOf(
  model: SimModel,
  extra: { devices?: Iterable<string>; quiet?: Iterable<string>; picks?: Iterable<string>; verdicts?: Iterable<string> } = {},
): MomentSignals {
  const fold = (xs: Iterable<string> | undefined): string[] => [...(xs ?? [])].map(foldName);
  const verdictNames = new Set([...BOTTLE_VERDICTS.map(foldName), ...fold(extra.verdicts)]);
  const secretCues = secretWritingCues(model);
  const admin = new Set<string>();
  const verdicts = new Set<string>();
  for (const i of model.interactions.values()) {
    const f = foldName(i.id);
    if (i.who === "admin") {
      if (!secretCues.has(f)) admin.add(f);
    } else if (verdictNames.has(f)) verdicts.add(f);
  }
  return {
    admin,
    devices: new Set([...DEVICE_MOMENT_SIGNALS, ...fold(extra.devices)]),
    picks: new Set(fold(extra.picks)),
    quiet: new Set([...Object.values(DEFAULT_CONFIRM).map(foldName), ...QUIET_MOMENT_SIGNALS, ...fold(extra.quiet)]),
    verdicts,
    drawn: null,
  };
}

/** The event names a `do pick` directive can signal (its draw and its `else`). */
export function pickNamesOf(args: string): string[] {
  const m = /^(\S+)\s+from\s+\[[^\]]*\](?:\s+else\s+(\S+))?$/u.exec(args.trim());
  return m === null ? [] : m[2] === undefined ? [m[1]!] : [m[1]!, m[2]];
}

/**
 * The moment one sim event makes, or null (pure apart from reading the sim's
 * model, persons and — for an admin cue that is the logged event at
 * `seq − 1` — the story's refusal). `seq` is its log index + 1.
 * - `beatEntered` with no subject (a house-wide beat; a per-guest one is not);
 * - an allowlisted `signal` (`MomentSignals`): an admin cue the story took
 *   (a refused press — only a `# hosts` line — is not), a `do pick` draw
 *   (`who` its pick), the first booth press the story takes about that pick
 *   within `VERDICT_MS` (its verdict: 🗣 / 🙅 / 🎩, `who` the pick), a
 *   device's (`who` the player); the duck's pair becomes one `found`;
 * - a story `sound X` (`sfx`), by its name;
 * - a `reveal` to everyone (never a quiet one);
 * - a big `broadcast "!!…"` to everyone (`big`, its line in `text`).
 */
export function momentOf(e: SimEvent, seq: number, at: number, sim: Sim, secrets: readonly string[], signals: MomentSignals = momentSignalsOf(sim.model)): ScreenMoment | null {
  const who = (id: string | null): string | null => {
    const p = id === null ? undefined : sim.persons.get(id);
    return p === undefined ? null : clip(p.name, MAX_MOMENT_NAME);
  };
  const make = (kind: ScreenMomentKind, name: string, w: string | null): ScreenMoment | null => {
    const n = clip(name.trim(), MAX_MOMENT_NAME);
    return n === "" || touchesSecret(n, secrets) ? null : { seq, at, kind, name: n, who: w };
  };
  switch (e.type) {
    case "beatEntered":
      return e.subject === null && !QUIET_MOMENT_BEATS.includes(foldName(e.beat)) ? make("beat", e.beat, null) : null;
    case "signal": {
      if (e.name === FOUND_FIRST) return null;
      if (e.name === FOUND_SIGNAL && e.subject !== null && sim.persons.has(e.subject)) {
        return make("found", sim.isCaptured(e.subject) ? "golden duck kept" : "golden duck", who(e.subject));
      }
      const f = foldName(e.name);
      if (signals.quiet.has(f)) return null;
      if (signals.picks.has(f) || signals.devices.has(f)) return make("signal", e.name, who(e.subject));
      // The verdict on a draw (🗣 / 🙅 / 🎩 on the bottle's pick): a booth press
      // about the person the last draw picked — already on every screen — that
      // the story took. Any other booth press stays off the screens.
      if (signals.verdicts?.has(f) === true) {
        if (signals.drawn == null || e.subject !== signals.drawn) return null;
        if (sim.log.all()[seq - 1] === e && signalRefusedAt(sim, seq - 1)) return null;
        return make("signal", e.name, who(e.subject));
      }
      if (!signals.admin.has(f)) return null;
      if (sim.log.all()[seq - 1] === e && signalRefusedAt(sim, seq - 1)) return null;
      return make("signal", e.name, null);
    }
    case "directive": {
      if (e.verb !== "sfx") return null;
      const name = e.args.trim().split(/[\s,]+/u)[0] ?? "";
      return make("sfx", name, null);
    }
    case "broadcast": {
      // Wave 18: a big moment to the whole house (`broadcast "!!…" to
      // everyone`) lights the TV and the walls. Never a staff room, a side
      // or any narrower scope: only what every phone in the house was told.
      const split = splitAlert(e.cue);
      if (split.big !== true || !globalScope(e.scope)) return null;
      const line = clip(cueText(split.cue).trim(), MAX_BIG_LINE);
      const m = make("big", line, null);
      return m === null ? null : { ...m, text: line };
    }
    case "revealed": {
      // A reveal for one person, or a quiet one (wave 18b: clearance's
      // rooms open quietly), is no moment: no room "opens" on the screens.
      if (e.person !== null || e.quiet === true) return null;
      const label = e.kind === "location" ? inWorldLabel(sim.model.locations.get(e.target)?.label ?? e.target) : e.kind === "channel" ? e.target.replace(/^room:/u, "") : e.target;
      return make("reveal", label, null);
    }
    default:
      return null;
  }
}

// --- the night block (wave 17) --------------------------------------------------

/** The public story vars the screens read (*Trapped in the Internet*'s `Night.*`;
 *  never a Kernel value or a ROLE `secret:` slot). A story without them reads null. */
export const SCREEN_NIGHT_VARS = {
  phase: "Night.phase",
  step: "Night.step",
  bottle_pick: "Night.bottle_pick",
  bottle_open: "Night.bottle_open",
  results_q: "Night.results_q",
  award_winner: "Night.award_winner",
  award_value: "Night.award_value",
  help_votes: "Night.help_votes",
  thwart_votes: "Night.thwart_votes",
  alerts: "Night.alerts",
  ended: "Night.ended",
  collection_complete: "Night.collection_complete",
  scenario: "Night.scenario",
  most_trusted: "Night.most_trusted",
  least_trusted: "Night.least_trusted",
  facts_accepted: "Night.facts_accepted",
  first_reinstall: "Night.first_reinstall",
  // Wave 20: the server room's door and Trabolta's heart, always carried
  // (no slide gate): the door bridge, the room terminal and the lights
  // module's catch-up all read them.
  server_door: "Night.server_door",
  heart_stage: "Night.heart_stage",
  heart_look: "Night.heart_look",
  alarm_on: "Night.alarm_on",
  // Wave 31: the house look (`cue lights_<value>`), for the lights module's catch-up.
  lights: "Night.lights",
  // Wave 38: the soundtrack's scene (`cue music_<value>`), for the router's catch-up.
  music: "Night.music",
  door_override: "Night.door_override",
  // Wave 22: the patch bay on the server-room M4 posts `patch_changed`; a
  // 🔌 / 💥 / ❌ press puts the story on the buttons until 🔌 Trust the
  // patch bay, and the terminal's bridge stops posting while it holds.
  patch_override: "Night.patch_override",
  // Wave 45: the Bathroom Report (G13), only while its slide is up.
  bath_goers: "Night.bath_goers",
  bath_never: "Night.bath_never",
  bath_total_s: "Night.bath_total_s",
  bath_most: "Night.bath_most",
  bath_most_s: "Night.bath_most_s",
  bath_least: "Night.bath_least",
  bath_least_s: "Night.bath_least_s",
  bath_toggler: "Night.bath_toggler",
  bath_toggles: "Night.bath_toggles",
  // Wave 50: Clippy's dream, on from the Y2K bug until an ending or a 🌀.
  dream: "Night.dream",
  // Wave 56: what his voice is made of; only the level ever leaves the server.
  composure: "Trabolta.composure",
  // Wave 48: the Language Report (G14), only while its slide is up.
  lang_flagged: "Night.lang_flagged",
  lang_censored: "Night.lang_censored",
  lang_curser: "Night.lang_curser",
  lang_curses: "Night.lang_curses",
} as const;
/** (wave 50) The story's cue that readies Clippy's dream: never a screen cue
 *  (no slide, no family), only the moment the takeover counts from. */
export const DREAM_CUE = "dream_begin";
/** (wave 50) The takeover with no word from the TV (muted, off): this long
 *  after the cue. His word can only bring it sooner, so this is set past the
 *  slowest voice that could reach the words (about 30 s on the show's). */
export const DREAM_FALLBACK_MS = 42_000;
/** (wave 50) From the TV starting that sentence (`bug=1`) to the words. Long
 *  enough that a wall's next poll (2 s) hears it first: every screen in the
 *  house goes at the same server instant, on his word. */
export const DREAM_LEAD_MS = 3200;
/** (wave 45) The longest tie the Bathroom Report's slide carries. */
const MAX_TIE_NAMES = 120;
/** (wave 45) The slide the Bathroom Report (G13) cues. */
export const BATHROOM_SLIDE = "award_bathroom";
/** (wave 48) The slide the Language Report (G14) cues. */
export const LANGUAGE_SLIDE = "award_language";
/** (wave 48, 48b) The most censored words the slide lists, and the longest one. */
export const LANGUAGE_WORDS_MAX = 400;
const LANGUAGE_WORD_CHARS = 40;
/** A story var holding this names nobody / nothing yet (the show's "none"). */
const NIGHT_NONE = "none";

export interface ScreenNight {
  screen: string | null;
  terminals: string | null;
  phase: string | null;
  step: number | null;
  bottle_pick: string | null;
  /** The bottle waits on its pick's Truth or Dare (`Night.bottle_open`). */
  bottle_open: boolean | null;
  /** Which hunt question's results are being read (`Night.results_q`: 0 before the first). */
  results_q: number | null;
  /** Only while an `award_*` slide is up on this target (the story sets the
   *  winner just before it cues the slide). */
  award_winner: string | null;
  award_value: string | number | null;
  help_votes: number | null;
  thwart_votes: number | null;
  alerts: string | null;
  /** An ending has played (the story ignores the King and the chess from then on). */
  ended: boolean | null;
  /** Round two's tally: every fact in (the 61 % the TV says aloud) or not (12 %). */
  collection_complete: boolean | null;
  /** The overshare that played, 1–4 (0 = not yet: null). Public: its beat says it aloud. */
  scenario: number | null;
  /** (wave 18b) The Trust Chart's call-outs, only while the `bobbing` slide
   *  is up on this target (Trabolta says both names aloud there). */
  most_trusted: string | null;
  least_trusted: string | null;
  /** (wave 18b) The night's summary numbers, only while the `recount` or
   *  `purgatory` slide is up: facts accepted, the first reinstalled program. */
  facts_accepted: number | null;
  first_reinstall: string | null;
  /** (wave 20) `Night.server_door`: "open" | "closed" (null: no story / unset). */
  server_door: "open" | "closed" | null;
  /** (wave 20) `Night.heart_stage`: "sealed" | "door" | "scan" | "talk" | "done". */
  heart_stage: string | null;
  /** (wave 20) `Night.heart_look`: the settled heart look ("none" reads null). */
  heart_look: string | null;
  /** (wave 20) `Night.alarm_on`: the patch-bay alarm latch. */
  alarm_on: boolean | null;
  /** (wave 31) `Night.lights`: the house look the story last cued (`lights_<value>`; "none" reads null). */
  lights: string | null;
  /** (wave 38) `Night.music`: the soundtrack scene the story last cued
   *  (`music_<value>`; "none" reads null, which the router plays as `off`). */
  music: string | null;
  /** (wave 20) `Night.door_override`: the story follows the 🚪 buttons, not the sensor. */
  door_override: boolean | null;
  /** (wave 22) `Night.patch_override`: the story follows the 🔌 buttons, not the patch bay. */
  patch_override: boolean | null;
  /** (wave 45) The Bathroom Report's numbers, only while its slide
   *  (`award_bathroom`) is up on this target; absent otherwise. */
  bathroom?: ScreenBathroom;
  /** (wave 48) The Language Report's numbers, only while its slide
   *  (`award_language`) is up on this target; absent otherwise. */
  language?: ScreenLanguage;
}

/** (wave 48, `docs/loom-w48-contract.md` C4, C12) The Language Report
 *  (G14): words the Password Manager's filter caught tonight (at the
 *  strength of the time), of them censored, the program with the most
 *  caught (a tie "A and B"; null for nobody) and its count, as the story
 *  read them; and from the server's book every censored word once with how
 *  often (most first; `more` past the ones listed; never a slur), the slur
 *  words censored (`unsaid`: a redaction bar each, never text), the
 *  strength now and the ⭐ ✂ paid. */
export interface ScreenLanguage {
  flagged: number;
  censored: number;
  curser: string | null;
  curses: number;
  words: string[];
  counts: number[];
  more: number;
  unsaid: number;
  level: number;
  stars: number;
}

/** (wave 45) The Bathroom Report (G13), as the story read it. Times are
 *  story seconds; a name is one program or a tie ("A and B"), null for
 *  nobody. `least` is null with fewer than two who went (the story reads
 *  no least then). */
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

// --- the results block (wave 18b) ----------------------------------------------

/** `do fact_read H1 [H2 …]`: the story has read these questions aloud. */
export const RESULTS_READ_VERB = "fact_read";
/** `do fact_truth H1 accurate|lie|none`: the verdict on one question. */
export const RESULTS_TRUTH_VERB = "fact_truth";
/** The slides a `read` block rides (the reading's own scenes). */
export const RESULTS_SLIDES: readonly string[] = ["hunt_results", "tally"];
/** How long the verdict stays on the screens after its first `fact_truth`. */
export const RESULTS_VERDICT_MS = 120_000;
export { MAX_RESULT_ROWS } from "../facts.ts";

/** `do fact_truth`'s status as the screens say it: `accurate` (or `true`)
 *  → "true", `lie` → "lie", anything else → "none". */
export function truthStatusOf(raw: string): "true" | "lie" | "none" {
  const v = raw.trim().toLowerCase();
  return v === "accurate" || v === "true" ? "true" : v === "lie" ? "lie" : "none";
}

/** The key ids a `do fact_read …` names (`H1 H2`, commas allowed). */
export function resultIdsOf(args: string): string[] {
  const out: string[] = [];
  for (const id of args.split(/[\s,]+/u)) if (/^[A-Za-z0-9_-]{1,16}$/u.test(id) && !out.includes(id)) out.push(id);
  return out;
}

/** What the runtime builds a results block from (`screenResultsOf` over
 *  the facts ledger). Empty when there is no key in force. */
export type ScreenResultsSource = (q: { kind: "read" | "verdict"; ids: readonly string[] | null; tv: boolean; truths: ReadonlyMap<string, "true" | "lie" | "none"> }) => ScreenResultQuestion[];

/** The runtime's extras for one poll (wave 18b), all optional. */
export interface ScreenPollExtras {
  /** The facts ledger's public results (gated here: see `ScreenResults`). */
  results?: ScreenResultsSource;
  /** Is this map spot on `audio.json`'s `announce.terminals` (Q8)? */
  spotAnnounce?: (spot: string) => boolean;
  /** (wave 26) Players in a spot's room now; wired by the runtime from the
   *  spatial hub. Null: the server can't tell for that spot (no spatial map,
   *  or a spot the map lacks), so `spot.here` is left out. */
  spotHere?: (spot: string) => number | null;
  /** (wave 48b) The Password Manager's filter book: every censored word with
   *  its tally (most first, never a slur), slurs censored, the strength now
   *  and the ⭐ paid. Read only while the Language Report's slide is up. */
  language?: () => { words: ReadonlyArray<{ word: string; n: number }>; unsaid: number; level: number; stars: number };
  /** (wave 59) The first line of `channel` the teleprompter holds back. */
  voiceHeldFrom?: (channel: string) => number | null;
}

/** A filing's public outcome on a screen: `a` accepted (an accurate filing
 *  or a confident lie — the screens never tell them apart before ⚖), `g` a
 *  guess (uncertain, or marked as one), `u` not counted (marked with no cup
 *  — its verdict was accurate or a lie), `p` still pending. */
export type ScreenOutcome = "a" | "g" | "u" | "p";

/** Trabolta's stamp on a filing (O4, D10): `s` he ruled it the same as the
 *  key, `n` not the same — both only below confidence 100, where they equal
 *  the public outcome; `r` he ruled on a filing at 100 (the result is held
 *  until ⚖, so the screen says only that he ruled); `?` a ruling is asked
 *  (queued or out with his worker); `""` no ruling (an exact match, the
 *  house rule, a director). His `why` never reaches a screen. */
export type ScreenRuled = "s" | "n" | "r" | "?" | "";

/** One filing as a reading shows it (TV only): the filer's display name
 *  (≤ 24), what they said (≤ 40, newlines → spaces), sure (1 = filed at
 *  100) or not (0), its public outcome, Trabolta's stamp. */
export type ScreenResultRow = [who: string, said: string, sure: 0 | 1, out: ScreenOutcome, ruled: ScreenRuled];

/** One liar named at ⚖ (O2, TV only): display name (≤ 24), and 1 when his
 *  ruling made the lie (a 🤖 on the name), else 0. */
export type ScreenLiar = [who: string, ruled: 0 | 1];

/** One question in a results block. */
export interface ScreenResultQuestion {
  /** The key id (`H1` … `F2`). */
  id: string;
  /** 1-based place in the book's questions. */
  n: number;
  /** The question's round (null: an `answers[]` key). */
  round: number | null;
  /** The question as the Quest Log shows it (≤ 140); `read` only. */
  text?: string;
  /** How many filed, and their public outcomes. */
  filed: number;
  accepted: number;
  guesses: number;
  uncounted: number;
  /** Every filing matches the key and every one was filed at 100 (the
   *  story says the answer aloud then). */
  consensus: boolean;
  /** The key's canonical answer: in a `read`, only on consensus; in a TV
   *  `verdict`, for every question (O2); null otherwise (and on a wall). */
  answer: string | null;
  /** `verdict` only: true / a lie on record / nobody answered. */
  truth?: "true" | "lie" | "none";
  /** `read`, TV only: the filings in filing order, ≤ `MAX_RESULT_ROWS`. */
  rows?: ScreenResultRow[];
  /** Rows past the cap. */
  more?: number;
  /** TV `verdict` only (O2): the programs who lied — a final lie (house,
   *  ruling or director) or a pending filing proposed a lie — ≤
   *  `MAX_RESULT_ROWS`. Names only, never what they filed. */
  liars?: ScreenLiar[];
  /** Liars past the cap. */
  liarsMore?: number;
}

/**
 * `ScreenState.results` (wave 18b): what the story has published of the
 * facts ledger. `read` after `do fact_read …` while the target's slide is
 * `hunt_results` or `tally` (its ids only, never the book's final round:
 * D11); `verdict` from the first `do
 * fact_truth …` for `RESULTS_VERDICT_MS` (all the book's questions). Absent
 * otherwise. Built off the facts ledger (`FactsWatch`), never `Night.*`.
 */
export interface ScreenResults {
  kind: "read" | "verdict";
  /** Bumps on every publication the fold sees (a screen latches on it). */
  seq: number;
  /** Server epoch ms the fold first saw it; 0 = replayed history. */
  at: number;
  questions: ScreenResultQuestion[];
}

/** A terminal that hasn't polled for this long is silent (K-29): the editor's
 *  card goes red and chimes. Terminals poll every 2 s (the TV every 1 s), so
 *  this is ten missed polls; with the card's own 4 s poll a pulled tablet
 *  turns red within ~25 s. */
export const TERMINAL_SILENT_MS = 20_000;

/** At most this many terminals are remembered (oldest poll evicted). */
export const MAX_SCREENS = 32;

/** How long a director's `identify` shows on the terminal (SW-SCR-21): short,
 *  so it never covers a pilot session for long. */
export const IDENTIFY_MS = 10_000;

/** What a terminal build reports about its device on each poll (SW-SCR-21).
 *  Every field is optional: an older build (tablets cache builds) sends none,
 *  and iOS / Safari have no battery API. */
export interface ScreenDevice {
  /** Sound is unlocked (the page's AudioContext runs: someone touched it). */
  audio?: boolean;
  /** The page is visible (false: screen off, app switched, a screensaver). */
  visible?: boolean;
  /** Battery percent, 0–100. */
  battery?: number;
  charging?: boolean;
  /** The page is full screen (wave 17; absent: a build that can't be, has it
   *  turned off in ⚙, or predates the flag). */
  fullscreen?: boolean;
  /** The voice link's microphone (wave 19, `MIC_STATES`): `live` (open),
   *  `muted` (turned off in ⚙ on that tablet), `denied` (the permission
   *  refused), `insecure` (plain http: no getUserMedia), `locked` (open, but
   *  the page's sound waits for a touch), `off` (the view or the map turns it
   *  off). Absent: a build that predates it. */
  mic?: ScreenMic;
  /** The terminal's build stamp. */
  version?: string;
  /** (wave 18b, Q8) The tablet says the house announcements right now
   *  (`ann=1|0`: its own setting, else the house list). */
  announce?: boolean;
  /** (wave 20) The door sensor this terminal bridges (`door=`, `DOOR_STATES`):
   *  absent = none configured (or a build that predates it). */
  door?: ScreenDoor;
  /** The sensor's last level (`dlv=`, 0–4095: the lit − dark difference in
   *  the firmware's `mod` mode). */
  doorLevel?: number;
  /** The blocking fault while `door === "fault"` (`dft=`: `ldr_saturated` |
   *  `led_dead` | `stale` | `no_port`). */
  doorFault?: string;
  /** A non-blocking warning (`dwn=`, `ldr_open`): the door state above still holds. */
  doorWarn?: string;
  /** (wave 22) The patch bay on the door's board (`pb=`): the V–D cables in
   *  its settled bay (0–16), or `fault`. Absent: no bay at this terminal.
   *  Counts only: the pairs themselves never ride the heartbeat. */
  patch?: number | "fault";
  /** The settled bay is complete (`pbc=1|0`: exactly four pairs). */
  patchComplete?: boolean;
  /** Inputs reading between levels in the latest scan (`pbx=`). */
  patchBetween?: number;
  /** Why `patch === "fault"` (`pft=`: `no_port` | `stale` | `dup`). */
  patchFault?: string;
  /** (wave 25, the house desk §5; voice / room polls only) `talk=1|0`: is
   *  it speaking, or holding unspoken room lines? */
  talk?: boolean;
  /** (wave 25) `said=<seq>`: every room line at or below it is finished
   *  (spoken, skipped or muted); −1 = none. Absent: no cursor yet, or a build
   *  too old to send it. */
  said?: number;
  /** (wave 50) `bug=1`: the TV has started the sentence that names the Y2K
   *  bug (its own text says so). Kept only from a `view=tv` poller. */
  bug?: boolean;
  /** (wave 26, V1 phase 2) `sp=<seq>:<chunk>` / `sp=<seq>:d`: the line the
   *  TV is speaking now (its room-line seq) and the sentence (`chunk`, from
   *  0), or `chunk: null` once that line is done. Kept only from a `view=tv`
   *  poller (`ScreenState.tvSpeech`); dropped from any other. */
  speech?: { seq: number; chunk: number | null };
  /** (wave 59) `cs=`: camera frames it sent to the games, per second (absent: no feed there). */
  camSent?: number;
  /** (wave 59) `cr=`: simulation frames it received, per second (absent: no stream open). */
  simReceived?: number;
  /** (wave 59) `cd=`: simulation frames it drew, per second. */
  simDrawn?: number;
  /** (wave 59) `ce=`: the last thing that went wrong with that link, for a minute. */
  linkError?: LinkError;
}

/** (wave 26) How long a TV's `sp=` report stays `tvSpeech` without a newer poll. */
export const TV_SPEECH_FRESH_MS = 6000;
/** The highest sentence index `sp=` may carry. */
export const SPEECH_CHUNK_MAX = 999;

/** `sp=812:2` → `{seq: 812, chunk: 2}`, `sp=812:d` → `{seq: 812, chunk: null}`; else null. */
export function speechReportOf(raw: string): { seq: number; chunk: number | null } | null {
  const m = /^(\d{1,12}):(\d{1,3}|d)$/u.exec(raw);
  if (m === null) return null;
  const chunk = m[2] === "d" ? null : Number(m[2]);
  if (chunk !== null && chunk > SPEECH_CHUNK_MAX) return null;
  return { seq: Number(m[1]), chunk };
}

/** What a terminal's `door=` may say (wave 20). */
export const DOOR_STATES = ["open", "closed", "fault", "none"] as const;
export type ScreenDoor = (typeof DOOR_STATES)[number];
/** The door sensor's 12-bit ceiling (`dlv=`). */
export const DOOR_LEVEL_MAX = 4095;
/** A door fault or warning code as the heartbeat may carry it. */
const DOOR_CODE = /^[a-z_]{1,24}$/u;

/** What a terminal's `mic=` may say (wave 19). */
export const MIC_STATES = ["live", "muted", "denied", "insecure", "locked", "off"] as const;
export type ScreenMic = (typeof MIC_STATES)[number];

/** The device fields off a poll's query (`audio=1|0`, `vis=v|h`,
 *  `bat=<0-100>[c]`, `fs=1|0`, `mic=<MIC_STATES>`, `ver=<build>`, wave 18b
 *  `ann=1|0`, wave 20 `door=<DOOR_STATES>`, `dlv=<0-4095>`, `dft=` /
 *  `dwn=<[a-z_]{1,24}>`, wave 22 `pb=<0-16>|fault`, `pbc=1|0`, `pbx=<0-16>`,
 *  `pft=<[a-z_]{1,24}>`); anything malformed is left out. */
/** The most inputs a bay can report (`pb=` / `pbx=`). */
export const PATCH_INPUTS_MAX = 16;

export function screenDeviceOf(q: (k: string) => string): ScreenDevice {
  const d: ScreenDevice = {};
  const audio = q("audio");
  if (audio === "1" || audio === "0") d.audio = audio === "1";
  const vis = q("vis");
  if (vis === "v" || vis === "h") d.visible = vis === "v";
  const bat = /^(\d{1,3})(c?)$/u.exec(q("bat"));
  if (bat !== null && Number(bat[1]) <= 100) {
    d.battery = Number(bat[1]);
    d.charging = bat[2] === "c";
  }
  const fs = q("fs");
  if (fs === "1" || fs === "0") d.fullscreen = fs === "1";
  const mic = q("mic");
  if ((MIC_STATES as readonly string[]).includes(mic)) d.mic = mic as ScreenMic;
  const ver = q("ver").replace(/[^\w.:+-]/gu, "").slice(0, 24);
  if (ver !== "") d.version = ver;
  const ann = q("ann");
  if (ann === "1" || ann === "0") d.announce = ann === "1";
  const door = q("door");
  if ((DOOR_STATES as readonly string[]).includes(door)) d.door = door as ScreenDoor;
  const dlv = q("dlv");
  if (/^\d{1,4}$/u.test(dlv) && Number(dlv) <= DOOR_LEVEL_MAX) d.doorLevel = Number(dlv);
  const dft = q("dft");
  if (DOOR_CODE.test(dft)) d.doorFault = dft;
  const dwn = q("dwn");
  if (DOOR_CODE.test(dwn)) d.doorWarn = dwn;
  const count = (v: string): number | null => (/^\d{1,2}$/u.test(v) && Number(v) <= PATCH_INPUTS_MAX ? Number(v) : null);
  const pb = q("pb");
  if (pb === "fault") d.patch = "fault";
  else if (count(pb) !== null) d.patch = count(pb)!;
  const pbc = q("pbc");
  if (pbc === "1" || pbc === "0") d.patchComplete = pbc === "1";
  const pbx = count(q("pbx"));
  if (pbx !== null) d.patchBetween = pbx;
  const pft = q("pft");
  if (DOOR_CODE.test(pft)) d.patchFault = pft;
  const talk = q("talk");
  if (talk === "1" || talk === "0") d.talk = talk === "1";
  const said = q("said");
  if (/^-?\d{1,12}$/u.test(said) && Number(said) >= -1) d.said = Number(said);
  const sp = speechReportOf(q("sp"));
  if (sp !== null) d.speech = sp;
  if (q("bug") === "1") d.bug = true;
  const rate = (v: string): number | null => (/^\d{1,2}(\.\d)?$/u.test(v) ? Number(v) : null);
  const cs = rate(q("cs"));
  if (cs !== null) d.camSent = cs;
  const cr = rate(q("cr"));
  if (cr !== null) d.simReceived = cr;
  const cd = rate(q("cd"));
  if (cd !== null) d.simDrawn = cd;
  const ce = q("ce");
  if (isLinkError(ce)) d.linkError = ce;
  return d;
}

export interface ScreenCue {
  value: string;
  /** Bumps on every cue of this family, repeats included. */
  seq: number;
}

export interface ScreenPoll extends ScreenDevice {
  name: string;
  spot: string;
  view: string;
  character: string;
  /** The room terminal's LOCATION, as polled (absent: not a room terminal). */
  room?: string;
  /** (wave 25) The location whose lines it speaks, as polled (`voice=`, the TV). */
  voice?: string;
  /** Epoch ms of the last poll. */
  at: number;
}

export interface ScreenCharacter {
  id: string;
  hidden: boolean;
  awake: boolean;
  online: boolean;
  /** The character has a `hold:` line: guests are always answered, so a
   *  guest-facing screen shows no online / away. */
  hold: boolean;
}

export interface ScreenState {
  /** Server epoch ms. */
  now: number;
  night: ScreenNight;
  cues: Record<ScreenCueFamily, ScreenCue | null>;
  /** Null when the terminal's character isn't in the story (or no story is loaded). */
  character: ScreenCharacter | null;
  attract: boolean;
  countdown: string | null;
  remaining: number | null;
  /** The live chart, while a chart slide is up (null otherwise). */
  chart: ScreenChart | null;
  /** Which program `program` is: the poller's, from its `view`. */
  target: ScreenTarget;
  program: ScreenProgram;
  /** The last `MOMENT_RING` live story moments, oldest first (wave 17; the
   *  epoch is `announceEpoch`). */
  moments: ScreenMoment[];
  /** The latest house announcement (N-09), null before the first. */
  announce: ScreenAnnounce | null;
  /** The last `ANNOUNCE_RING` announcements, oldest first (`announce` = the last). */
  announces: ScreenAnnounce[];
  /** Only when the poll names a voice room (K-18) or a `room`. */
  voice?: ScreenVoice;
  /** (wave 56) How broken his voice is now, for everything that speaks him. */
  voiceFx: VoiceFx;
  /** Only when the poll names a `room` (wave 7). */
  room?: ScreenRoom;
  /** A director's `identify` is live for this terminal (SW-SCR-21). */
  identify: boolean;
  /** How long that `identify` has left (ms; 0 when off): the terminal counts
   *  it down itself, so a tablet that loses the server mid-identify uncovers. */
  identifyLeft: number;
  /** Which sim the announcements belong to: changes on every story restart
   *  (a fresh sim numbers its announcements from 1 again) and server boot, so
   *  a terminal resyncs its cursor however the new seqs compare to the old. */
  announceEpoch: string;
  /** The shared King (wave 11, C2); null = the map has none. */
  king: ScreenKing | null;
  /** (wave 18b) The published results, when there are any (omitted else). */
  results?: ScreenResults;
  /** (wave 18b, Q8) Only when the poll names a `spot`: what the house says
   *  about that map terminal — `announce`: it is on `audio.json`'s
   *  `announce.terminals` list; (wave 26) `here`: players in its room. */
  spot?: ScreenSpot;
  /** (wave 26, V1 phase 2) What the TV is speaking now: the newest `sp=` from
   *  a poller whose `view` is `tv`, stamped with the server's receive time.
   *  `chunk` null = that line is done. Memory only; null when no TV reported
   *  in the last 6 s (`TV_SPEECH_FRESH_MS`). */
  tvSpeech?: { seq: number; chunk: number | null; at: number } | null;
  /** (wave 50) Clippy's dream; null: off, or a story without it. */
  dream?: ScreenDream | null;
}

/** (wave 50) Clippy's dream while the story has it on. `at`: when the takeover
 *  starts (server ms; 0 = before this boot), known ahead of time, so a
 *  terminal readies its video first and every screen goes together. */
export interface ScreenDream {
  at: number;
}

/** The house's word on a poller's map spot (Q8). */
export interface ScreenSpot {
  announce: boolean;
  /** (wave 26, R5) Live reinstalled players whose presence room (C5
   *  `presenceRoom`) is this spot's map room. Absent: the server can't tell
   *  (no spatial map or an old server); then fall back to `reinstalling`. */
  here?: number;
}

/** The shared King as the chess terminal reads him (C2). `armed`: a
 *  checkmate counts now; null = unknown (no `armed` path, or no story). */
export interface ScreenKing {
  hp: number;
  max: number;
  fallen: boolean;
  armed: boolean | null;
}

/**
 * The screen state's `king` block from the hub's King and his prop's
 * `armed` rule: armed while the world var at `armed.path` is a number at or
 * above `armed.min` (unset reads as not armed); null with no `armed` rule
 * or no story loaded.
 */
export function screenKingOf(king: KingState | null, armed: { path: string; min: number } | undefined, sim: Sim | null): ScreenKing | null {
  if (king === null) return null;
  let on: boolean | null = null;
  if (armed !== undefined && sim !== null) {
    const v = sim.world.peek(armed.path);
    const n = v === null ? null : v.kind === "number" ? v.value : v.kind === "string" && v.value.trim() !== "" ? Number(v.value) : null;
    on = n !== null && Number.isFinite(n) && n >= armed.min;
  }
  return { hp: king.hp, max: king.max, fallen: king.fallen, armed: on };
}

/** The LOCATION a room terminal belongs to (wave 7): `open` once it is open
 *  to everyone; `id` "" = no such LOCATION (or no story yet). */
export interface ScreenRoom {
  id: string;
  open: boolean;
  /** (wave 20) The last `cue room_<name>` played in a beat whose setting folds
   *  to this LOCATION (id or label), else null (also before the doors and for
   *  an unknown room). */
  cue: ScreenRoomCue | null;
}

/** (wave 20) A room terminal's picture cue (`cue room_heart_wake` in a beat set
 *  in its LOCATION): its room scenes key on it. Never a screen cue family,
 *  never a moment, never seen by a wall or the TV. */
export interface ScreenRoomCue {
  /** The cue's first token, as written: `room_heart_wake`. */
  value: string;
  /** Bumps on every such cue for this room, a repeat included. */
  seq: number;
  /** Server epoch ms the fold first saw it; 0 = before this server's fold (history: never played). */
  at: number;
}

/** The prefix a room terminal's picture cue carries (`cue room_heart_wake`). */
export const ROOM_CUE_PREFIX = "room_";

/** `room_heart_wake, slow` → `room_heart_wake`; anything not `room_<name>` → null. */
export function roomCueOf(args: string): string | null {
  const head = args.trim().split(/[\s,]+/u)[0] ?? "";
  return head.startsWith(ROOM_CUE_PREFIX) && head.length > ROOM_CUE_PREFIX.length ? head : null;
}

/** The declared LOCATION a folded name (a beat's `setting`, a poll's `room`)
 *  names by id or label, else undefined. */
function locationNamed(model: SimModel | null, name: string) {
  const want = foldName(name);
  if (model === null || want === "") return undefined;
  return [...model.locations.values()].find((l) => foldName(l.id) === want || (l.label !== null && foldName(l.label) === want));
}

export interface ScreenWho {
  name: string;
  spot: string;
  view: string;
  character: string;
  /** A location whose characters' lines this screen speaks (the TV: `The Desktop`). */
  voice?: string;
  /** The LOCATION this terminal belongs to (the server-room terminal): it
   *  sleeps until that room is open to everyone and speaks its lines (its
   *  `voice` room, unless the poll names one). */
  room?: string;
  /** The last chat seq this screen has handled; null = none yet. */
  after?: number | null;
  /** The device health the build reports (SW-SCR-21). */
  device?: ScreenDevice;
}

/** `screens_call_desktop` → `{family: "screens", value: "call_desktop"}`; anything else → null. */
export function screenCueOf(args: string): { family: ScreenCueFamily; value: string } | null {
  const head = args.trim().split(/[\s,]+/u)[0] ?? "";
  for (const family of SCREEN_CUE_FAMILIES) {
    if (head.startsWith(`${family}_`) && head.length > family.length + 1) return { family, value: head.slice(family.length + 1) };
  }
  return null;
}

const clip = (s: string | null, n = 48): string => (s ?? "").slice(0, n);

export class ScreenWatch {
  private sim: Sim | null = null;
  private cursor = 0;
  /** Has this sim's history been folded yet? Set after the first look even
   *  when the log was empty (a restart while paused, doors not yet open), so
   *  every later cue is stamped with the clock — not mistaken for history. */
  private seeded = false;
  private readonly cues = new Map<ScreenCueFamily, ScreenCue>();
  /** (wave 20) Per LOCATION id, the last `cue room_*` played in a beat set there. */
  private readonly roomCues = new Map<string, ScreenRoomCue>();
  private readonly programs = new Map<ScreenTarget, ScreenProgram>();
  private shots = 0;
  /** The last `ANNOUNCE_RING` announcements, oldest first. */
  private announcements: ScreenAnnounce[] = [];
  /** The last `MOMENT_RING` live moments, oldest first (wave 17). */
  private moments: ScreenMoment[] = [];
  /** This sim's secret names (`secretMomentNames`; null = not read yet). */
  private secrets: string[] | null = null;
  /** The `do pick` event names this sim's log has drawn from (folded). */
  private picks = new Set<string>();
  /** The last live draw's pick, until its verdict lands (`MomentSignals.drawn`). */
  private drawn: { subject: string; at: number } | null = null;
  /** The runtime's extra device signals (a map's own king signals) and
   *  quiet ones (the facts book's confirm events), read on every fold. */
  private readonly signalExtras: (() => { devices?: Iterable<string>; quiet?: Iterable<string> }) | undefined;
  /** Wave 18b: the last `do fact_read` (its ids), the verdict's truths
   *  (`do fact_truth`) and when its window opened; `resultSeq` bumps on each. */
  private read: { seq: number; at: number; ids: string[] } | null = null;
  private readonly truths = new Map<string, "true" | "lie" | "none">();
  private truthAt: { seq: number; at: number } | null = null;
  private resultSeq = 0;
  /** (wave 50) When Clippy's dream takes over (0: history), from `dream_begin`
   *  until the TV reaches the words; `dreamHeard`: it did. Memory only: a
   *  restart replays the cue as history, so the dream is simply on. */
  private dreamAt: number | null = null;
  private dreamHeard = false;
  /** Per target, the chart slide on screen and when it went up (`revealAt`). */
  private readonly chartUp = new Map<ScreenTarget, { slide: string; at: number }>();
  /** The chart call-out vars this sim's story mentions (null = not read yet). */
  private chartVars: Set<string> | null = null;
  private readonly polls = new Map<string, ScreenPoll>();
  /** (wave 26, V1 phase 2) The newest `sp=` from a `view=tv` poller, with
   *  the server time it arrived (memory only). */
  private tvSpeech: { seq: number; chunk: number | null; at: number } | null = null;
  /** A director's `identify`, per terminal name: when it stops (server ms). */
  private readonly identifying = new Map<string, number>();
  private readonly now: () => number;
  /** This watch's boot id + a count of the sims it has seen (`announceEpoch`). */
  private readonly boot = Math.random().toString(36).slice(2, 8);
  private sims = 0;
  /** The director's TV-voice mute (K-18). Persisted by the runtime (`muted`
   *  seeds it, `onMute` writes it), so a server restart keeps the TV quiet. */
  voiceMuted: boolean;
  private readonly onMute: ((muted: boolean) => void) | undefined;
  /** (wave 56) The director's mode for his voice; persisted like the mute. */
  voiceFxMode: VoiceFxMode;
  private readonly onVoiceFx: ((mode: VoiceFxMode) => void) | undefined;
  /** (wave 56) A director's shot: one flavour, now. */
  private voiceShot: VoiceShot | null = null;

  constructor(o: { now?: () => number; muted?: boolean; onMute?: (muted: boolean) => void; voiceFx?: VoiceFxMode; onVoiceFx?: (mode: VoiceFxMode) => void; signals?: () => { devices?: Iterable<string>; quiet?: Iterable<string> } } = {}) {
    this.now = o.now ?? Date.now;
    this.signalExtras = o.signals;
    this.voiceMuted = o.muted ?? false;
    this.onMute = o.onMute;
    this.voiceFxMode = o.voiceFx ?? "auto";
    this.onVoiceFx = o.onVoiceFx;
  }

  /** Flip the TV-voice mute (`POST /api/mod/screen/voice`) and persist it. */
  setVoiceMuted(muted: boolean): void {
    this.voiceMuted = muted;
    this.onMute?.(muted);
  }

  /** (wave 56) The director's mode for his voice, persisted. */
  setVoiceFxMode(mode: VoiceFxMode): void {
    this.voiceFxMode = mode;
    this.onVoiceFx?.(mode);
  }

  /** (wave 56) Break his voice in one flavour, now. */
  fireVoiceShot(flavour: VoiceFlavour): void {
    this.voiceShot = { flavour, at: this.now() };
  }

  /** Fold every screen cue the sim logged since the last look. A new Sim
   *  (a restart replays the journal into a fresh one) starts the fold over.
   *  True on the first look at a sim (its history). */
  private sync(sim: Sim | null): boolean {
    if (sim !== this.sim) {
      this.sim = sim;
      this.sims += 1;
      this.cursor = 0;
      this.seeded = false;
      this.cues.clear();
      this.roomCues.clear();
      this.programs.clear();
      this.shots = 0;
      this.announcements = [];
      this.moments = [];
      this.secrets = null;
      this.picks = new Set();
      this.drawn = null;
      this.chartUp.clear();
      this.chartVars = null;
      this.read = null;
      this.truths.clear();
      this.truthAt = null;
      this.resultSeq = 0;
      this.dreamAt = null;
      this.dreamHeard = false;
    }
    if (sim === null) return false;
    const events = sim.log.all();
    // The first look at a sim is its history (a boot or a restart replayed
    // the journal): stamped 0, so nothing held or one-shot re-runs.
    const first = !this.seeded;
    const at = first ? 0 : this.now();
    this.seeded = true;
    this.secrets ??= secretMomentNames(sim.model);
    const signals = first || this.cursor >= events.length ? null : momentSignalsOf(sim.model, { ...this.signalExtras?.(), picks: this.picks });
    for (; this.cursor < events.length; this.cursor++) {
      const e = events[this.cursor]!;
      // A `do pick` draw's events (history too: a draw after a restart).
      if (e.type === "directive" && e.verb === "pick") {
        for (const n of pickNamesOf(e.args)) {
          this.picks.add(foldName(n));
          if (signals !== null) (signals.picks as Set<string>).add(foldName(n));
        }
      }
      // A live moment (never history: the first look carries none).
      if (signals !== null) {
        signals.drawn = this.drawn !== null && at - this.drawn.at <= VERDICT_MS ? this.drawn.subject : null;
        const m = momentOf(e, this.cursor + 1, at, sim, this.secrets, signals);
        if (m !== null) {
          this.moments.push(m);
          if (this.moments.length > MOMENT_RING) this.moments.shift();
        }
        if (e.type === "signal" && e.subject !== null) {
          const f = foldName(e.name);
          if (signals.picks.has(f)) this.drawn = { subject: e.subject, at };
          else if (m !== null && signals.verdicts?.has(f) === true) this.drawn = null; // one verdict a draw
        }
      }
      if (e.type !== "directive") continue;
      // Wave 18b: the story publishes results (a reading, the verdict).
      if (e.verb === RESULTS_READ_VERB) {
        const ids = resultIdsOf(e.args);
        if (ids.length > 0) this.read = { seq: ++this.resultSeq, at, ids };
        continue;
      }
      if (e.verb === RESULTS_TRUTH_VERB) {
        const [id, status] = e.args.trim().split(/\s+/u);
        if (id !== undefined && /^[A-Za-z0-9_-]{1,16}$/u.test(id)) {
          this.truths.set(id, truthStatusOf(status ?? ""));
          // One window per verdict: a truth inside the open window keeps it.
          const open = this.truthAt !== null && this.truthAt.at > 0 && at - this.truthAt.at < RESULTS_VERDICT_MS;
          this.truthAt = { seq: ++this.resultSeq, at: open ? this.truthAt!.at : at };
        }
        continue;
      }
      if (e.verb === ANNOUNCE_VERB) {
        const text = announceTextOf(e.args);
        if (text !== null) {
          const seq = (this.announcements[this.announcements.length - 1]?.seq ?? 0) + 1;
          this.announcements.push({ seq, text, at });
          if (this.announcements.length > ANNOUNCE_RING) this.announcements.shift();
        }
        continue;
      }
      if (e.verb !== "cue") continue;
      if (e.args.trim().split(/[\s,]+/u)[0] === DREAM_CUE) {
        this.dreamAt = at === 0 ? 0 : at + DREAM_FALLBACK_MS;
        continue;
      }
      // Wave 20: a room terminal's picture, kept per LOCATION (last wins).
      const roomCue = roomCueOf(e.args);
      if (roomCue !== null) {
        const loc = e.setting == null ? undefined : locationNamed(sim.model, e.setting);
        if (loc !== undefined) this.roomCues.set(loc.id, { value: roomCue, seq: (this.roomCues.get(loc.id)?.seq ?? 0) + 1, at });
        continue;
      }
      const hit = screenCueOf(e.args);
      if (hit === null) continue;
      const prev = this.cues.get(hit.family);
      this.cues.set(hit.family, { value: hit.value, seq: (prev?.seq ?? 0) + 1 });
      const shot: ScreenShot = { value: hit.value, cue: `${hit.family}_${hit.value}`, seq: ++this.shots, at };
      if (screenCueClass(hit.value) === "glitch") {
        const text = glitchTextOf(sim);
        if (text !== null) shot.text = text;
        if (glitchIsBurst(sim)) shot.light = true;
      }
      for (const t of FAMILY_TARGETS[hit.family]) this.programs.set(t, foldProgram(this.programs.get(t) ?? emptyProgram(), shot));
    }
    return first;
  }

  /** Fold what the sim logged now, without a poll — the runtime calls it
   *  right after a find, so the `found` moment reads the finder's capture
   *  as the find left it and carries the find's own time. */
  catchUp(sim: Sim | null): void {
    this.sync(sim);
  }

  /** Start the fold over on `sim`, taking everything it has logged as
   *  history (stamped 0: no moment, held slides held). The runtime calls it
   *  when a sim is born (an empty log, so what follows — the doors' entry
   *  beat — is live) and after a restore's journal replay (so the replay
   *  is never live). */
  adopt(sim: Sim): void {
    this.sim = null;
    this.sync(sim);
  }

  /** Clippy's dream now (wave 50): null unless `Night.dream` is on and no
   *  ending has come. The story's var is what a restart keeps; with no cue
   *  seen (a story that sets it by hand) it is simply on. */
  dreamOf(sim: Sim | null): ScreenDream | null {
    if (sim === null) return null;
    this.sync(sim);
    const on = (path: string): boolean => {
      const v = sim.world.peek(path);
      return v?.kind === "bool" && v.value;
    };
    if (!on(SCREEN_NIGHT_VARS.dream) || on(SCREEN_NIGHT_VARS.ended)) return null;
    return { at: this.dreamAt ?? 0 };
  }

  /** Remember a terminal's poll (unnamed polls aren't recorded). */
  private note(who: ScreenWho): void {
    const name = clip(who.name);
    if (name === "") return;
    this.polls.delete(name); // re-insert: Map order = poll order
    const room = clip(who.room ?? "");
    const voice = clip(who.voice ?? "");
    // Wave 26: `sp=` counts only from the TV (`view=tv`); any other drops it.
    const { speech, bug, ...device } = who.device ?? {};
    const tv = who.view === "tv";
    if (tv && speech !== undefined) this.tvSpeech = { ...speech, at: this.now() };
    // Wave 50: his word sets the takeover, once, and only ever sooner.
    if (tv && bug === true && this.dreamAt !== null && !this.dreamHeard) {
      this.dreamHeard = true;
      this.dreamAt = Math.min(this.dreamAt, this.now() + DREAM_LEAD_MS);
    }
    this.polls.set(name, { name, spot: clip(who.spot), view: clip(who.view, 16), character: clip(who.character), ...(room !== "" ? { room } : {}), ...(voice !== "" ? { voice } : {}), ...device, ...(tv && speech !== undefined ? { speech } : {}), at: this.now() });
    while (this.polls.size > MAX_SCREENS) this.polls.delete(this.polls.keys().next().value!);
  }

  /** A director asks one terminal to show its name for `ms` (install day).
   *  Runtime state, per name; answers when it stops (server ms). */
  identify(name: string, ms: number = IDENTIFY_MS): number {
    const until = this.now() + ms;
    this.identifying.set(clip(name), until);
    while (this.identifying.size > MAX_SCREENS) this.identifying.delete(this.identifying.keys().next().value!);
    return until;
  }

  /** Is an `identify` live for this name? (An expired one is forgotten.) */
  identifyingNow(name: string): boolean {
    return this.identifyLeft(name) > 0;
  }

  /** How long this name's `identify` has left (ms; 0 = none). */
  identifyLeft(name: string): number {
    const key = clip(name);
    const until = this.identifying.get(key);
    if (until === undefined) return 0;
    const left = until - this.now();
    if (left > 0) return left;
    this.identifying.delete(key);
    return 0;
  }

  /** The watch's clock (server epoch ms). */
  clock(): number {
    return this.now();
  }

  /** (wave 59) The room line the TV is saying now, or null. */
  speakingNow(): number | null {
    const sp = this.tvSpeech;
    return sp !== null && sp.chunk !== null && this.now() - sp.at <= TV_SPEECH_FRESH_MS ? sp.seq : null;
  }

  /** Each terminal's last poll, most recent first. */
  seen(): Array<ScreenPoll & { ago: number }> {
    const now = this.now();
    return [...this.polls.values()].reverse().map((p) => ({ ...p, ago: Math.max(0, now - p.at) }));
  }

  /** One terminal polls: record it, and answer the current screen state.
   *  `messages` is the chat timeline (only read for a `voice` poll);
   *  `declared` is the story's model while no sim exists (before the doors),
   *  so a room terminal's correct LOCATION still resolves (asleep). */
  poll(
    sim: Sim | null,
    who: ScreenWho,
    online: (character: string) => boolean,
    messages: readonly ChatMessage[] = [],
    declared: SimModel | null = null,
    king: ScreenKing | null = null,
    extras: ScreenPollExtras = {},
  ): ScreenState {
    const first = this.sync(sim);
    this.note(who);
    const peek = (path: string): string | null => {
      const v = sim?.world.peek(path) ?? null;
      if (v === null || v.kind === "null") return null;
      if (v.kind === "string") return v.value;
      if (v.kind === "number") return String(v.value);
      if (v.kind === "bool") return v.value ? "true" : "false";
      return null;
    };

    let character: ScreenCharacter | null = null;
    if (sim !== null && who.character !== "") {
      const want = foldName(who.character);
      const def = sim.model.characters.get(who.character) ?? [...sim.model.characters.values()].find((c) => foldName(c.id) === want);
      if (def !== undefined) {
        const hidden = def.hidden && !sim.isRevealed(def.id);
        const awake = peek(`${def.id}.awake`) !== "false";
        character = { id: def.id, hidden, awake, online: online(def.id), hold: def.hold !== null };
      }
    }

    let countdown: string | null = null;
    let remaining: number | null = null;
    const elapsed = Number(peek("Time.elapsed") ?? 0);
    for (const c of SCREEN_COUNTDOWNS) {
      if (peek(c.on) !== "true") continue;
      const end = Number(peek(c.end));
      if (!Number.isFinite(end) || end <= 0) continue;
      countdown = c.name;
      remaining = Math.max(0, Math.round(end - elapsed));
      break;
    }

    const cues = {} as Record<ScreenCueFamily, ScreenCue | null>;
    for (const f of SCREEN_CUE_FAMILIES) cues[f] = this.cues.get(f) ?? null;
    const target = screenTargetOf(who.view);

    let chart: ScreenChart | null = null;
    const specFor = (t: ScreenTarget) => {
      const showing = peek(t === "tv" ? "Night.screen" : "Night.terminals");
      return SCREEN_CHARTS.find((c) => c.slide === showing);
    };
    // When each target's chart slide went up: a chart already up in the
    // history (the first look) is stamped 0, so a restart never re-reveals.
    for (const t of first ? SCREEN_TARGETS : [target]) {
      const up = specFor(t);
      if (up === undefined) this.chartUp.delete(t);
      else if (this.chartUp.get(t)?.slide !== up.slide) this.chartUp.set(t, { slide: up.slide, at: first ? 0 : this.now() });
    }
    const spec = specFor(target);
    if (sim !== null && spec !== undefined) {
      const rows: ScreenChart["rows"] = [];
      for (const p of sim.persons.values()) {
        if (peek(`${p.id}.${spec.only}`) !== "true") continue;
        const n = Number(peek(`${p.id}.${spec.value}`) ?? 0);
        rows.push({ name: p.name, value: Number.isFinite(n) ? n : 0 });
      }
      // Wave 21 (C6): every player with a declared numeric `<value>` slot
      // (never a `private:` one) ranks beside the programs, as staff.
      for (const c of sim.model.characters.values()) {
        if (!c.player || isPrivateSlot(c, spec.value)) continue;
        const d = c.defaults.get(spec.value);
        if (!c.ranges.has(spec.value) && d?.kind !== "number") continue;
        const n = Number(peek(`${c.id}.${spec.value}`) ?? 0);
        rows.push({ name: c.id, value: Number.isFinite(n) ? n : 0, staff: true });
      }
      rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
      this.chartVars ??= storyMentions(sim.model, SCREEN_CHARTS.flatMap((c) => [c.top, c.bottom]));
      // The story's own call-outs when it has them ("none" = not named yet);
      // a story without them gets the ranked chart's ends.
      const called = (path: string, derived: string | null): string | null => {
        if (!this.chartVars!.has(path)) return derived;
        const v = peek(path);
        return v === null || v === "" || v === CHART_NOBODY ? null : v;
      };
      const top = called(spec.top, rows[0]?.name ?? null);
      const bottom = called(spec.bottom, rows.length >= 2 ? rows[rows.length - 1]!.name : null);
      chart = { slide: spec.slide, rows: rows.slice(0, MAX_CHART_ROWS), top, bottom, revealAt: this.chartUp.get(target)?.at ?? 0 };
    }
    let program = this.programs.get(target) ?? emptyProgram();
    // The alarm overlay stands only while the story's alarm does: the story
    // clears `Night.alarm_on` after 120 s with no screen cue of its own, so
    // without this every terminal and the TV would flash INTRUSION (and the
    // terminals stay in takeover) until some unrelated later cue.
    // A story that never declares the var (null) keeps the plain rule.
    const alarmOn = peek(ALARM_VAR);
    if (program.overlay?.value === "alarm" && alarmOn !== null && alarmOn !== "true") program = { ...program, overlay: null };

    const identifyLeft = this.identifyLeft(who.name);
    const model = sim?.model ?? declared;
    const locationOf = (name: string) => locationNamed(model, name);
    // A room terminal (wave 7): asleep until its LOCATION is open to everyone.
    // Before the doors (no sim) a declared room is named but closed, so only
    // a typo reads as "no room called …" (S1-03).
    let room: ScreenRoom | undefined;
    if (who.room !== undefined && who.room !== "") {
      const loc = locationOf(who.room);
      room =
        loc === undefined
          ? { id: "", open: false, cue: null }
          : sim === null
            ? { id: loc.id, open: false, cue: null }
            : { id: loc.id, open: !loc.hidden || sim.isRevealed(loc.id), cue: this.roomCues.get(loc.id) ?? null };
    }
    let voice: ScreenVoice | undefined;
    const voiceRoom = who.voice !== undefined && who.voice !== "" ? who.voice : (who.room ?? "");
    if (voiceRoom !== "") {
      const loc = locationOf(voiceRoom);
      const room = loc === undefined ? "" : `loc:${loc.id}`;
      const chars = sim?.model.characters;
      const me = foldName(who.character);
      const textOnly = new Set(SCREEN_TEXT_ONLY.map(foldName));
      // Only the TV's own character and the text-only lore speakers: guests
      // play declared characters too, so "any character" would carry their
      // typed chat onto the TV.
      const speaks = (from: string): boolean => chars?.has(from) === true && (foldName(from) === me || textOnly.has(foldName(from)));
      // Wave 59: his lines wait for the teleprompter (`prompter.ts`).
      const heldFrom = extras.voiceHeldFrom?.(room) ?? null;
      const got = voiceLinesOf(messages, room, who.after ?? null, speaks, MAX_VOICE_LINES, heldFrom);
      // The director's mute is the TV's (its button, the Run page's): a room
      // terminal — the server-room one — is never silenced by it.
      voice = { room, muted: this.voiceMuted && target === "tv", ...got, ...(heldFrom !== null ? { held: true as const } : {}) };
    }

    // The night block: public story vars only; the award only while its slide is up.
    const num = (path: string): number | null => {
      const v = peek(path);
      const n = v === null || v.trim() === "" ? NaN : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const named = (path: string): string | null => {
      const v = peek(path);
      return v === null || v.trim() === "" || v === NIGHT_NONE ? null : clip(v, MAX_MOMENT_NAME);
    };
    const flag = (path: string): boolean | null => {
      const v = peek(path);
      return v === "true" ? true : v === "false" ? false : null;
    };
    const awardUp = program.slide?.kind === "slide" && program.slide.value.startsWith("award_");
    const slideUp = program.slide?.kind === "slide" ? program.slide.value : null;
    const bobbingUp = slideUp === "bobbing";
    const summaryUp = slideUp === "recount" || slideUp === "purgatory";
    const awardValue = awardUp ? named(SCREEN_NIGHT_VARS.award_value) : null;
    const night: ScreenNight = {
      screen: peek("Night.screen"),
      terminals: peek("Night.terminals"),
      phase: named(SCREEN_NIGHT_VARS.phase),
      step: num(SCREEN_NIGHT_VARS.step),
      bottle_pick: named(SCREEN_NIGHT_VARS.bottle_pick),
      bottle_open: flag(SCREEN_NIGHT_VARS.bottle_open),
      results_q: num(SCREEN_NIGHT_VARS.results_q),
      award_winner: awardUp ? named(SCREEN_NIGHT_VARS.award_winner) : null,
      award_value: awardValue !== null && /^-?\d+(\.\d+)?$/u.test(awardValue) ? Number(awardValue) : awardValue,
      help_votes: num(SCREEN_NIGHT_VARS.help_votes),
      thwart_votes: num(SCREEN_NIGHT_VARS.thwart_votes),
      alerts: named(SCREEN_NIGHT_VARS.alerts),
      ended: flag(SCREEN_NIGHT_VARS.ended),
      collection_complete: flag(SCREEN_NIGHT_VARS.collection_complete),
      scenario: ((n) => (n !== null && n >= 1 && n <= 4 ? n : null))(num(SCREEN_NIGHT_VARS.scenario)),
      most_trusted: bobbingUp ? named(SCREEN_NIGHT_VARS.most_trusted) : null,
      least_trusted: bobbingUp ? named(SCREEN_NIGHT_VARS.least_trusted) : null,
      facts_accepted: summaryUp ? num(SCREEN_NIGHT_VARS.facts_accepted) : null,
      first_reinstall: summaryUp ? named(SCREEN_NIGHT_VARS.first_reinstall) : null,
      server_door: ((v) => (v === "open" || v === "closed" ? v : null))(peek(SCREEN_NIGHT_VARS.server_door)),
      heart_stage: named(SCREEN_NIGHT_VARS.heart_stage),
      heart_look: named(SCREEN_NIGHT_VARS.heart_look),
      alarm_on: flag(SCREEN_NIGHT_VARS.alarm_on),
      lights: named(SCREEN_NIGHT_VARS.lights),
      music: named(SCREEN_NIGHT_VARS.music),
      door_override: flag(SCREEN_NIGHT_VARS.door_override),
      patch_override: flag(SCREEN_NIGHT_VARS.patch_override),
    };
    if (slideUp === BATHROOM_SLIDE) {
      const count = (path: string): number => Math.max(0, Math.floor(num(path) ?? 0));
      const goers = count(SCREEN_NIGHT_VARS.bath_goers);
      // A tie names everyone in it: a longer clip than a moment's name.
      const tied = (path: string): string | null => {
        const v = peek(path);
        return v === null || v.trim() === "" || v === NIGHT_NONE ? null : clip(v, MAX_TIE_NAMES);
      };
      night.bathroom = {
        goers,
        never: count(SCREEN_NIGHT_VARS.bath_never),
        total_s: count(SCREEN_NIGHT_VARS.bath_total_s),
        most: tied(SCREEN_NIGHT_VARS.bath_most),
        most_s: count(SCREEN_NIGHT_VARS.bath_most_s),
        least: goers > 1 ? tied(SCREEN_NIGHT_VARS.bath_least) : null,
        least_s: goers > 1 ? count(SCREEN_NIGHT_VARS.bath_least_s) : 0,
        toggler: tied(SCREEN_NIGHT_VARS.bath_toggler),
        toggles: count(SCREEN_NIGHT_VARS.bath_toggles),
      };
    }
    if (slideUp === LANGUAGE_SLIDE) {
      const count = (path: string): number => Math.max(0, Math.floor(num(path) ?? 0));
      const curser = peek(SCREEN_NIGHT_VARS.lang_curser);
      const book = extras.language?.() ?? { words: [], unsaid: 0, level: 100, stars: 0 };
      const shown = book.words.slice(0, LANGUAGE_WORDS_MAX);
      night.language = {
        flagged: count(SCREEN_NIGHT_VARS.lang_flagged),
        censored: count(SCREEN_NIGHT_VARS.lang_censored),
        curser: curser === null || curser.trim() === "" || curser === NIGHT_NONE ? null : clip(curser, MAX_TIE_NAMES),
        curses: count(SCREEN_NIGHT_VARS.lang_curses),
        words: shown.map((w) => clip(w.word, LANGUAGE_WORD_CHARS)),
        counts: shown.map((w) => w.n),
        more: Math.max(0, book.words.length - LANGUAGE_WORDS_MAX),
        unsaid: book.unsaid,
        level: book.level,
        stars: book.stars,
      };
    }

    // Wave 18b: the published results — the verdict for its window, else a
    // reading while the reading's slide is up on this target.
    let results: ScreenResults | undefined;
    if (extras.results !== undefined && sim !== null) {
      const now = this.now();
      const tv = target === "tv";
      if (this.truthAt !== null && this.truthAt.at > 0 && now - this.truthAt.at < RESULTS_VERDICT_MS) {
        const questions = extras.results({ kind: "verdict", ids: null, tv, truths: this.truths });
        if (questions.length > 0) results = { kind: "verdict", seq: this.truthAt.seq, at: this.truthAt.at, questions };
      } else if (this.read !== null && slideUp !== null && RESULTS_SLIDES.includes(slideUp)) {
        const questions = extras.results({ kind: "read", ids: this.read.ids, tv, truths: this.truths });
        if (questions.length > 0) results = { kind: "read", seq: this.read.seq, at: this.read.at, questions };
      }
    }
    // The spot block (Q8; wave 26 `here`): only when the poll names a spot
    // and the runtime wired either extra.
    let spot: ScreenSpot | undefined;
    if (who.spot !== "" && (extras.spotAnnounce !== undefined || extras.spotHere !== undefined)) {
      const here = extras.spotHere?.(who.spot) ?? null;
      spot = { announce: extras.spotAnnounce?.(who.spot) ?? false, ...(here !== null && Number.isFinite(here) && here >= 0 ? { here: Math.floor(here) } : {}) };
    }
    const tvSpeech = this.tvSpeech !== null && this.now() - this.tvSpeech.at <= TV_SPEECH_FRESH_MS ? { ...this.tvSpeech } : null;

    return {
      now: this.now(),
      night,
      cues,
      character,
      // Fail closed: a character that is hidden or asleep keeps every
      // terminal on attract. An unknown character (a typo in setup) does
      // not — the terminal then behaves as it always did. A room terminal
      // also sleeps while its room is closed (or unknown).
      // Before the doors (no story loaded) a terminal that names a character
      // fails closed: nothing may show its face or name before the
      // introduction (livetv-2). With a story, an unknown name never forces it.
      attract: (sim === null && who.character !== "") || (character !== null && (character.hidden || !character.awake)) || (room !== undefined && !room.open),
      countdown,
      remaining,
      chart,
      target,
      program,
      moments: [...this.moments],
      announce: this.announcements[this.announcements.length - 1] ?? null,
      announces: [...this.announcements],
      ...(voice !== undefined ? { voice } : {}),
      voiceFx: voiceFxOf(
        this.voiceFxMode,
        { phase: night.phase, composure: num(SCREEN_NIGHT_VARS.composure), remaining, alarmOn: night.alarm_on, heartStage: night.heart_stage, reading: awardUp || summaryUp },
        { now: this.now(), glitch: program.glitch ?? null, flicker: program.flicker, dreamAt: this.dreamOf(sim)?.at ?? null, shot: this.voiceShot },
      ),
      ...(room !== undefined ? { room } : {}),
      identify: identifyLeft > 0,
      identifyLeft,
      announceEpoch: `${this.boot}.${this.sims}`,
      king,
      ...(results !== undefined ? { results } : {}),
      ...(spot !== undefined ? { spot } : {}),
      tvSpeech,
      dream: this.dreamOf(sim),
    };
  }
}

/**
 * `GET /api/screen/state?name=&spot=&view=&character=[&voice=<location>|&room=<location>][&after=<seq>][&audio=&vis=&bat=&ver=]`
 * — moderator-gated (a terminal holds a mod token; the author's session works
 * too — `routing.ts::wantsModRead` resolves it). Returns true when it answered.
 */
export function handleScreenGet(
  watch: ScreenWatch,
  sim: Sim | null,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  authorized: (token: string | undefined) => boolean,
  online: (character: string) => boolean,
  messages: () => readonly ChatMessage[] = () => [],
  declared: () => SimModel | null = () => null,
  king: () => ScreenKing | null = () => null,
  showClock: () => ShowClock | undefined = () => undefined,
  reinstalling: () => number = () => 0,
  extras: ScreenPollExtras = {},
): boolean {
  if (!authorized(queryTokenOf(req, url))) {
    sendJson(res, 403, { error: "moderators only" });
    return true;
  }
  const q = (k: string): string => url.searchParams.get(k) ?? "";
  const voice = q("voice").slice(0, 64);
  const room = q("room").slice(0, 64);
  const afterRaw = q("after");
  const after = afterRaw !== "" && /^-?\d+$/u.test(afterRaw) ? Number(afterRaw) : null;
  res.setHeader?.("cache-control", "no-store");
  const who: ScreenWho = {
    name: q("name"),
    spot: q("spot"),
    view: q("view"),
    character: q("character"),
    device: screenDeviceOf(q),
    ...(voice !== "" ? { voice } : {}),
    ...(room !== "" ? { room } : {}),
    ...(voice !== "" || room !== "" ? { after } : {}),
  };
  const named = voice !== "" || room !== "";
  const clock = showClock();
  // The show clock (wave 13 K2) rides along for the terminals; nothing reads it yet.
  sendJson(res, 200, { ...watch.poll(sim, who, online, named ? messages() : [], named && sim === null ? declared() : null, king(), extras), ...(clock !== undefined ? { showClock: clock } : {}), reinstalling: reinstalling() });
  return true;
}

/**
 * `POST /api/mod/screen/voice {muted?: boolean, fx?: auto|clean|broken,
 * shot?: <flavour>}` — the director's (or the TV's own) mute for the room
 * voice, and (wave 56) the mode for how broken it is and a shot of one
 * flavour. Every terminal and the router read them off their next poll.
 * Answers `{muted, fx}`; a body with none of them just reads the current state.
 */
export async function handleScreenVoicePost(watch: ScreenWatch, req: IncomingMessage, res: ServerResponse, authorized: (token: string | undefined) => boolean): Promise<boolean> {
  const body = await readBody(req, 1024);
  if (!authorized(tokenOf(req, body))) {
    sendJson(res, 403, { error: "moderators only" });
    return true;
  }
  if (typeof body["muted"] === "boolean") watch.setVoiceMuted(body["muted"]);
  if (isVoiceFxMode(body["fx"])) watch.setVoiceFxMode(body["fx"]);
  if (isVoiceFlavour(body["shot"])) watch.fireVoiceShot(body["shot"]);
  sendJson(res, 200, { muted: watch.voiceMuted, fx: watch.voiceFxMode });
  return true;
}

/**
 * `POST /api/mod/screen/identify {name}` — the director's install-day check
 * (SW-SCR-21): that terminal shows its name + spot full screen (and chimes,
 * if its sound is unlocked) for `IDENTIFY_MS`, read off its next poll.
 * Answers `{name, until}`; 400 without a name.
 */
export async function handleScreenIdentifyPost(watch: ScreenWatch, req: IncomingMessage, res: ServerResponse, authorized: (token: string | undefined) => boolean): Promise<boolean> {
  const body = await readBody(req, 1024);
  if (!authorized(tokenOf(req, body))) {
    sendJson(res, 403, { error: "moderators only" });
    return true;
  }
  const name = typeof body["name"] === "string" ? clip(body["name"]) : "";
  if (name.trim() === "") {
    sendJson(res, 400, { error: "name required" });
    return true;
  }
  sendJson(res, 200, { name, until: watch.identify(name) });
  return true;
}

// --- speech done (wave 25, the house desk §5) -------------------------------

/** A terminal counts as speaking its room this long after its last poll. */
export const SPEECH_ONLINE_MS = 6_000;

/** The room lines a poller speaks: its own character's and the text-only
 *  lore speakers' (the same rule as the `voice` block). */
function speaksFor(model: SimModel | null, character: string): (from: string) => boolean {
  const me = foldName(character);
  const textOnly = new Set(SCREEN_TEXT_ONLY.map(foldName));
  return (from) => model?.characters.has(from) === true && (foldName(from) === me || textOnly.has(foldName(from)));
}

/** The newest line seq in `channel` a speaker `speaks` admits (−1 = none). */
export function newestRoomLine(messages: readonly ChatMessage[], channel: string, speaks: (from: string) => boolean): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.channel === channel && m.kind === "line" && !m.hidden && m.from !== "" && speaks(m.from)) return m.seq;
  }
  return -1;
}

/**
 * What the terminals speaking `channel` (`loc:<id>`) are doing, for the
 * teleprompter (wave 59): the slowest one's `said`, the TV's mute and the line it
 * is saying. Not `live`: nothing speaks the room, so a hold falls back on time.
 */
export function roomVoiceOf(watch: ScreenWatch, model: SimModel | null, channel: string): { live: boolean; muted: boolean; said: number; speaking: number | null } {
  const now = watch.clock();
  const on = watch.seen().filter((p) => {
    if (p.talk === undefined || now - p.at > SPEECH_ONLINE_MS) return false;
    const r = p.voice !== undefined && p.voice !== "" ? p.voice : (p.room ?? "");
    return r !== "" && `loc:${locationNamed(model, r)?.id ?? ""}` === channel;
  });
  const said = on.length === 0 ? -1 : Math.min(...on.map((p) => p.said ?? -1));
  return { live: on.length > 0, muted: watch.voiceMuted, said, speaking: watch.speakingNow() };
}

/** One `speech` step's watch (`DeskSpeechWatch`). */
export interface SpeechWatch {
  done(now: number): string | null;
}

/**
 * Watch a house-desk `speech` step on `room` (a LOCATION) from `startAt`
 * (§5): it may end once every online terminal that speaks that room (its
 * poll's `voice=`, else `room=`, polled in the last `SPEECH_ONLINE_MS`, and
 * reporting `talk=`) has polled, at or after `startAt + grace`, `talk=0`
 * with `said` at or past the newest room line it speaks as of the step's
 * start (a poll with no `said` counts on `talk=0` alone). A terminal that
 * never reports `talk=` (a build before wave 25) can't hold the step. Null:
 * no such terminal now (the step ends `no terminal`). `done` answers
 * `said`, or `no terminal` once they have all gone.
 */
export function speechWatchOf(watch: ScreenWatch, model: SimModel | null, room: string, startAt: number, messages: readonly ChatMessage[], grace: number): SpeechWatch | null {
  const loc = locationNamed(model, room);
  if (loc === undefined) return null;
  const channel = `loc:${loc.id}`;
  const speakers = (now: number) =>
    watch.seen().filter((p) => {
      if (p.talk === undefined || now - p.at > SPEECH_ONLINE_MS) return false;
      const r = p.voice !== undefined && p.voice !== "" ? p.voice : (p.room ?? "");
      return r !== "" && locationNamed(model, r)?.id === loc.id;
    });
  if (speakers(startAt).length === 0) return null;
  // The room's lines as of the step's start (later lines are the next step's).
  const at = messages.slice();
  const targets = new Map<string, number>();
  const target = (p: ScreenPoll) => {
    const k = `${p.name}\u0000${p.character}`;
    if (!targets.has(k)) targets.set(k, newestRoomLine(at, channel, speaksFor(model, p.character)));
    return targets.get(k)!;
  };
  return {
    done(now) {
      const live = speakers(now);
      if (live.length === 0) return "no terminal";
      const quiet = live.every((p) => p.at >= startAt + grace && p.talk === false && (p.said === undefined || p.said >= target(p)));
      return quiet ? "said" : null;
    },
  };
}

/** What the director's terminals card reads (K-29). */
export interface ScreenTerminals {
  /** Server epoch ms. */
  now: number;
  /** Each terminal's last poll, most recent first (`ago` in ms). `cam`
   *  (wave 59): its spot's feed as the server measures it. */
  terminals: Array<ScreenPoll & { ago: number; cam?: CamRate }>;
  /** The TV-voice mute (K-18), so the card can flip it. */
  voiceMuted: boolean;
  /** (wave 56) The director's mode for his voice. */
  voiceFx: VoiceFxMode;
  /** The server's silence threshold (ms). */
  silentMs: number;
}

/** The heartbeat list, read-only (pure apart from the watch's clock). */
export function screenTerminals(watch: ScreenWatch, camRate?: (spot: string) => CamRate): ScreenTerminals {
  const terminals = watch.seen();
  return { now: watch.clock(), terminals: camRate === undefined ? terminals : terminals.map((t) => (t.spot === "" ? t : { ...t, cam: camRate(t.spot) })), voiceMuted: watch.voiceMuted, voiceFx: watch.voiceFxMode, silentMs: TERMINAL_SILENT_MS };
}

/**
 * `GET /api/mod/screen/terminals` — moderator-gated (the author's session or a
 * mod token). Reading it never records a poll, so the editor isn't a terminal.
 */
export function handleScreenTerminalsGet(watch: ScreenWatch, req: IncomingMessage, res: ServerResponse, url: URL, authorized: (token: string | undefined) => boolean, camRate?: (spot: string) => CamRate): boolean {
  if (!authorized(queryTokenOf(req, url))) {
    sendJson(res, 403, { error: "moderators only" });
    return true;
  }
  res.setHeader?.("cache-control", "no-store");
  sendJson(res, 200, screenTerminals(watch, camRate));
  return true;
}
