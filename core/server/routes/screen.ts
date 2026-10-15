//! The lean screen state (OCT31 K-16): what every wall terminal polls instead
//! of the mod feed. `GET /e/:id/api/screen/state` answers in ~1 KB:
//!
//! - `night`     — the story's own screen mirrors, `Night.screen` / `Night.terminals`;
//! - `cues`      — the last `cue screens_*` / `terminals_*` / `tv_*` / `tablet_*`
//!                 value per family, folded from the sim log (a `seq` per family
//!                 so a re-fired cue — `screens_flicker` twice — is visible);
//! - `character` — the terminal's character: hidden (not yet `reveal`ed to
//!                 everyone), `awake` (its `<id>.awake` var, absent = awake) and
//!                 whether an agent worker is voicing it;
//! - `attract`   — hidden or asleep: the terminal shows the screensaver / ads,
//!                 never "ONLINE", and never pilots a pass into the thread;
//! - `remaining` — seconds left on the story countdown that is running, if any;
//! - `terminals` — each terminal's last poll (name, spot, view, how long ago),
//!                 so a director can tell a silent tablet from a live one;
//! - `announce`  — (N-09) the latest house announcement, `do announce "…"`
//!                 (`{seq, text, at}`: a `seq` per announcement, `at` 0 for
//!                 replayed history) — a terminal set to say announcements
//!                 speaks a new one in its own voice after a chime;
//! - `voice`     — (K-18, only when the poll names a `voice` room — the TV)
//!                 the characters' lines said in that location's room after
//!                 the poller's `after` seq, the room's `head` seq, and the
//!                 director's TV-voice mute (`POST /api/mod/screen/voice`).
//!
//! The director's side (K-29): `GET /api/mod/screen/terminals` answers just
//! the heartbeat list + the TV-voice mute, without recording a poll, for the
//! editor's Run → Terminals card (red after `TERMINAL_SILENT_MS`, a chime).
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

import type { IncomingMessage, ServerResponse } from "node:http";

import type { Sim } from "../../src/runtime/sim/index.ts";
import type { ChatMessage } from "../chat.ts";
import { foldName } from "../../src/parser/names.ts";
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

/** Slides that stay up until the next cue (no 45 s / 90 s hold); they beat attract. */
export function slidePersists(value: string): boolean {
  return value === "bingo" || value === "y2k" || value === "trust_chart" || value === "truth_txt" || /^(award|ceremony)/u.test(value);
}

export type ScreenCueClass = "overlay" | "flicker" | "countdown" | "base" | "slide";

/** What a screen cue value does: `countdown_*` is a corner (it never replaces
 *  the slide), `flicker` a one-shot effect, the overlays stand, the bases clear,
 *  and anything else is a slide (`/terminal/slides/<cue>.png`). */
export function screenCueClass(value: string): ScreenCueClass {
  if ((SCREEN_OVERLAYS as readonly string[]).includes(value)) return "overlay";
  if (value === "flicker") return "flicker";
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
}

const emptyProgram = (): ScreenProgram => ({ slide: null, overlay: null, blackout: null, flicker: null });

/** Fold one screen cue into a target's program (pure; returns a new program). */
export function foldProgram(p: ScreenProgram, shot: ScreenShot): ScreenProgram {
  const cls = screenCueClass(shot.value);
  switch (cls) {
    case "overlay":
      return { ...p, overlay: shot, blackout: shot.value === "blackout" ? shot : p.blackout };
    case "flicker":
      return { ...p, flicker: shot };
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
}

/** Speakers the TV shows as captions though they aren't its character (Sandy is
 *  lore, decision #28). Mirrors `TV_TEXT_ONLY` in `terminal/src/tv.ts`. */
export const SCREEN_TEXT_ONLY: readonly string[] = ["Sandy"];

/** At most this many lines per answer (the newest). A whole scripted beat lands
 *  in one poll, so this is generous; a TV that was *away* resyncs on its own. */
export const MAX_VOICE_LINES = 40;
const MAX_VOICE_TEXT = 600;

/**
 * The lines said by a speaker `speaks` admits in `channel` after `after`
 * (pure). Narration, system notices and hidden messages are left out; the
 * poll admits only the TV's character + `SCREEN_TEXT_ONLY`, which leaves out
 * guests' typed chat. `after` null (a screen that just booted) returns no lines.
 */
export function voiceLinesOf(
  messages: readonly ChatMessage[],
  channel: string,
  after: number | null,
  speaks: (from: string) => boolean,
  max = MAX_VOICE_LINES,
): { head: number; lines: ScreenVoiceLine[] } {
  const head = messages.length === 0 ? -1 : messages[messages.length - 1]!.seq;
  const lines: ScreenVoiceLine[] = [];
  if (after === null || after >= head || channel === "") return { head, lines };
  for (let i = messages.length - 1; i >= 0 && lines.length < max; i--) {
    const m = messages[i]!;
    if (m.seq <= after) break;
    if (m.channel !== channel || m.kind !== "line" || m.hidden || m.from === "" || !speaks(m.from)) continue;
    lines.push({ seq: m.seq, from: m.from, text: m.text.slice(0, MAX_VOICE_TEXT), beat: m.beat ?? null });
  }
  return { head, lines: lines.reverse() };
}

// --- the house announcement (N-09) ---------------------------------------------

/** The verb the story announces with (`do announce "Go to the living room."`) —
 *  the same directive stagehand's `show` sends to the house speakers (K-20). */
export const ANNOUNCE_VERB = "announce";
/** Longest announcement carried (characters) — the alexa player's `MAX_TEXT`. */
export const MAX_ANNOUNCE_TEXT = 300;

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

/** A terminal that hasn't polled for this long is silent (K-29): the editor's
 *  card goes red and chimes. Terminals poll every 2 s (the TV every 1 s), so
 *  this is ten missed polls; with the card's own 4 s poll a pulled tablet
 *  turns red within ~25 s. */
export const TERMINAL_SILENT_MS = 20_000;

/** At most this many terminals are remembered (oldest poll evicted). */
export const MAX_SCREENS = 32;

export interface ScreenCue {
  value: string;
  /** Bumps on every cue of this family, repeats included. */
  seq: number;
}

export interface ScreenPoll {
  name: string;
  spot: string;
  view: string;
  character: string;
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
  night: { screen: string | null; terminals: string | null };
  cues: Record<ScreenCueFamily, ScreenCue | null>;
  /** Null when the terminal's character isn't in the story (or no story is loaded). */
  character: ScreenCharacter | null;
  attract: boolean;
  countdown: string | null;
  remaining: number | null;
  /** Which program `program` is: the poller's, from its `view`. */
  target: ScreenTarget;
  program: ScreenProgram;
  terminals: Array<ScreenPoll & { ago: number }>;
  /** The latest house announcement (N-09), null before the first. */
  announce: ScreenAnnounce | null;
  /** Only when the poll names a voice room (K-18). */
  voice?: ScreenVoice;
}

export interface ScreenWho {
  name: string;
  spot: string;
  view: string;
  character: string;
  /** A location whose characters' lines this screen speaks (the TV: `The Desktop`). */
  voice?: string;
  /** The last chat seq this screen has handled; null = none yet. */
  after?: number | null;
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
  private readonly programs = new Map<ScreenTarget, ScreenProgram>();
  private shots = 0;
  private announcement: ScreenAnnounce | null = null;
  private readonly polls = new Map<string, ScreenPoll>();
  private readonly now: () => number;
  /** The director's TV-voice mute (K-18). Runtime state: a server restart unmutes. */
  voiceMuted = false;

  constructor(o: { now?: () => number } = {}) {
    this.now = o.now ?? Date.now;
  }

  /** Fold every screen cue the sim logged since the last look. A new Sim
   *  (a restart replays the journal into a fresh one) starts the fold over. */
  private sync(sim: Sim | null): void {
    if (sim !== this.sim) {
      this.sim = sim;
      this.cursor = 0;
      this.seeded = false;
      this.cues.clear();
      this.programs.clear();
      this.shots = 0;
      this.announcement = null;
    }
    if (sim === null) return;
    const events = sim.log.all();
    // The first look at a sim is its history (a boot or a restart replayed
    // the journal): stamped 0, so nothing held or one-shot re-runs.
    const at = this.seeded ? this.now() : 0;
    this.seeded = true;
    for (; this.cursor < events.length; this.cursor++) {
      const e = events[this.cursor]!;
      if (e.type !== "directive") continue;
      if (e.verb === ANNOUNCE_VERB) {
        const text = announceTextOf(e.args);
        if (text !== null) this.announcement = { seq: (this.announcement?.seq ?? 0) + 1, text, at };
        continue;
      }
      if (e.verb !== "cue") continue;
      const hit = screenCueOf(e.args);
      if (hit === null) continue;
      const prev = this.cues.get(hit.family);
      this.cues.set(hit.family, { value: hit.value, seq: (prev?.seq ?? 0) + 1 });
      const shot: ScreenShot = { value: hit.value, cue: `${hit.family}_${hit.value}`, seq: ++this.shots, at };
      for (const t of FAMILY_TARGETS[hit.family]) this.programs.set(t, foldProgram(this.programs.get(t) ?? emptyProgram(), shot));
    }
  }

  /** Remember a terminal's poll (unnamed polls aren't recorded). */
  private note(who: ScreenWho): void {
    const name = clip(who.name);
    if (name === "") return;
    this.polls.delete(name); // re-insert: Map order = poll order
    this.polls.set(name, { name, spot: clip(who.spot), view: clip(who.view, 16), character: clip(who.character), at: this.now() });
    while (this.polls.size > MAX_SCREENS) this.polls.delete(this.polls.keys().next().value!);
  }

  /** The watch's clock (server epoch ms). */
  clock(): number {
    return this.now();
  }

  /** Each terminal's last poll, most recent first. */
  seen(): Array<ScreenPoll & { ago: number }> {
    const now = this.now();
    return [...this.polls.values()].reverse().map((p) => ({ ...p, ago: Math.max(0, now - p.at) }));
  }

  /** One terminal polls: record it, and answer the current screen state.
   *  `messages` is the chat timeline (only read for a `voice` poll). */
  poll(sim: Sim | null, who: ScreenWho, online: (character: string) => boolean, messages: readonly ChatMessage[] = []): ScreenState {
    this.sync(sim);
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
    let program = this.programs.get(target) ?? emptyProgram();
    // The alarm overlay stands only while the story's alarm does: the story
    // clears `Night.alarm_on` after 120 s with no screen cue of its own, so
    // without this every terminal and the TV would flash INTRUSION (and the
    // terminals stay in takeover) until some unrelated later cue.
    // A story that never declares the var (null) keeps the plain rule.
    const alarmOn = peek(ALARM_VAR);
    if (program.overlay?.value === "alarm" && alarmOn !== null && alarmOn !== "true") program = { ...program, overlay: null };

    let voice: ScreenVoice | undefined;
    if (who.voice !== undefined && who.voice !== "") {
      const want = foldName(who.voice);
      const loc = sim === null ? undefined : [...sim.model.locations.values()].find((l) => foldName(l.id) === want || (l.label !== null && foldName(l.label) === want));
      const room = loc === undefined ? "" : `loc:${loc.id}`;
      const chars = sim?.model.characters;
      const me = foldName(who.character);
      const textOnly = new Set(SCREEN_TEXT_ONLY.map(foldName));
      // Only the TV's own character and the text-only lore speakers: guests
      // play declared characters too, so "any character" would carry their
      // typed chat onto the TV.
      const speaks = (from: string): boolean => chars?.has(from) === true && (foldName(from) === me || textOnly.has(foldName(from)));
      const got = voiceLinesOf(messages, room, who.after ?? null, speaks);
      voice = { room, muted: this.voiceMuted, ...got };
    }

    return {
      now: this.now(),
      night: { screen: peek("Night.screen"), terminals: peek("Night.terminals") },
      cues,
      character,
      // Fail closed: a character that is hidden or asleep keeps every
      // terminal on attract. An unknown character (a typo in setup) does
      // not — the terminal then behaves as it always did.
      attract: character !== null && (character.hidden || !character.awake),
      countdown,
      remaining,
      target,
      program,
      terminals: this.seen(),
      announce: this.announcement,
      ...(voice !== undefined ? { voice } : {}),
    };
  }
}

/**
 * `GET /api/screen/state?name=&spot=&view=&character=[&voice=<location>&after=<seq>]`
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
): boolean {
  if (!authorized(queryTokenOf(req, url))) {
    sendJson(res, 403, { error: "moderators only" });
    return true;
  }
  const q = (k: string): string => url.searchParams.get(k) ?? "";
  const voice = q("voice").slice(0, 64);
  const afterRaw = q("after");
  const after = afterRaw !== "" && /^-?\d+$/u.test(afterRaw) ? Number(afterRaw) : null;
  res.setHeader?.("cache-control", "no-store");
  const who: ScreenWho = { name: q("name"), spot: q("spot"), view: q("view"), character: q("character"), ...(voice !== "" ? { voice, after } : {}) };
  sendJson(res, 200, watch.poll(sim, who, online, voice !== "" ? messages() : []));
  return true;
}

/**
 * `POST /api/mod/screen/voice {muted: boolean}` — the director's (or the TV's
 * own) mute for the room voice. Every TV reads it off its next poll. Answers
 * `{muted}`; a body without a boolean `muted` just reads the current state.
 */
export async function handleScreenVoicePost(watch: ScreenWatch, req: IncomingMessage, res: ServerResponse, authorized: (token: string | undefined) => boolean): Promise<boolean> {
  const body = await readBody(req, 1024);
  if (!authorized(tokenOf(req, body))) {
    sendJson(res, 403, { error: "moderators only" });
    return true;
  }
  if (typeof body["muted"] === "boolean") watch.voiceMuted = body["muted"];
  sendJson(res, 200, { muted: watch.voiceMuted });
  return true;
}

/** What the director's terminals card reads (K-29). */
export interface ScreenTerminals {
  /** Server epoch ms. */
  now: number;
  /** Each terminal's last poll, most recent first (`ago` in ms). */
  terminals: Array<ScreenPoll & { ago: number }>;
  /** The TV-voice mute (K-18), so the card can flip it. */
  voiceMuted: boolean;
  /** The server's silence threshold (ms). */
  silentMs: number;
}

/** The heartbeat list, read-only (pure apart from the watch's clock). */
export function screenTerminals(watch: ScreenWatch): ScreenTerminals {
  return { now: watch.clock(), terminals: watch.seen(), voiceMuted: watch.voiceMuted, silentMs: TERMINAL_SILENT_MS };
}

/**
 * `GET /api/mod/screen/terminals` — moderator-gated (the author's session or a
 * mod token). Reading it never records a poll, so the editor isn't a terminal.
 */
export function handleScreenTerminalsGet(watch: ScreenWatch, req: IncomingMessage, res: ServerResponse, url: URL, authorized: (token: string | undefined) => boolean): boolean {
  if (!authorized(queryTokenOf(req, url))) {
    sendJson(res, 403, { error: "moderators only" });
    return true;
  }
  res.setHeader?.("cache-control", "no-store");
  sendJson(res, 200, screenTerminals(watch));
  return true;
}
