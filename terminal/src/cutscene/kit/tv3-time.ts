//! Lane tv3's timelines, pure (wave 17): the numbers behind Act F–G's
//! scenes and the house-wide moments — the award table, truth.txt's text
//! and how much of it Notepad shows at `t`, the chat loop of the song, the
//! advice tally, rain, binary rain, the equalizer, floating hearts, the
//! hand jive's phases, the year that will not render. Every function is a
//! picture of `t` (ms into its scene), seeded, never `Math.random`, so a
//! reload resumes on the right frame and every screen in the house agrees.

import { foldName } from "../../config.ts";
import type { ScreenMoment } from "../../screen.ts";
import { clamp01, ease, hashSeed, loop, noise1, progress, typedCount, typedDuration } from "./time.ts";

// --- the awards (beats/ceremony.loom) --------------------------------------------------

/** An award's emblem (drawn by `tv3-parts.tsx` `AwardEmblem`). */
export type AwardEmblem = "shield" | "beans" | "plane" | "book" | "coin" | "mask" | "duck" | "scroll" | "palette" | "trophy";

export interface AwardInfo {
  /** The slide value's tail (`most_trusted`). */
  id: string;
  /** The award's name, as the host reads it. */
  title: string;
  /** "Bonus award" or "Award", as the host reads it. */
  kind: "Award" | "Bonus award";
  /** What the number is (the host's own words), or null. */
  label: string;
  /** A word after the number (Truthcoin), if any. */
  unit?: string;
  emblem: AwardEmblem;
  /** The host's sting line (fiction-safe: no name). */
  line: string;
}

/** The ceremony's nine awards, in the order Present Award checks them. */
export const AWARDS: readonly AwardInfo[] = [
  { id: "most_trusted", title: "Most Trusted", kind: "Award", label: "Trust score", emblem: "shield", line: "When a program needed believing, it was you." },
  { id: "least_trusted", title: "Least Trusted", kind: "Award", label: "Trust score", emblem: "beans", line: "Weighed, and found full of beans. It is still an award." },
  { id: "frequent_flyer", title: "Frequent Flyer to the Internet", kind: "Award", label: "Trips through the Tube", emblem: "plane", line: "The Antivirus know you by name." },
  { id: "lore_hoarder", title: "Lore Hoarder", kind: "Award", label: "Codex entries held", emblem: "book", line: "For the most codex entries." },
  { id: "truthcoin_tycoon", title: "Truthcoin Tycoon", kind: "Award", label: "Balance", unit: "Truthcoin", emblem: "coin", line: "The richest program in the machine." },
  { id: "best_liar", title: "Best Liar", kind: "Bonus award", label: "Confident lies accepted", emblem: "mask", line: "The report does not say which ones." },
  { id: "duck_speedrun", title: "Golden Duck Speedrun", kind: "Bonus award", label: "Reached the golden duck in", emblem: "duck", line: "Gerald was not ready." },
  { id: "quest_completionist", title: "Quest Completionist", kind: "Bonus award", label: "Quests completed", emblem: "scroll", line: "Nobody finished more of the Quest Log." },
  { id: "the_painting", title: "The Million Dollar Painting", kind: "Bonus award", label: "Signatures on the canvas", emblem: "palette", line: "It goes to silent auction." },
];

/** The award a slide value names (`award_most_trusted`), or a generic one for an award the table doesn't know. */
export function awardOf(value: string): AwardInfo {
  const id = value.replace(/^award_?/iu, "").toLowerCase();
  const known = AWARDS.find((a) => a.id === id);
  if (known !== undefined) return known;
  const title = id === "" ? "Award" : id.replace(/_/gu, " ").replace(/\b\w/gu, (c) => c.toUpperCase());
  return { id, title, kind: "Award", label: "", emblem: "trophy", line: "Come up and collect your trophy." };
}

/** The award's value as the screen shows it: null for none (the story's "none" too); a number stays a number (it counts up). */
export function awardValue(v: string | number | null | undefined): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = v.trim();
  if (s === "" || s.toLowerCase() === "none") return null;
  if (/^-?\d+(\.\d+)?$/u.test(s)) return Number(s);
  return s;
}

/**
 * An award slide's confetti: the burst under the winner's name (3200, falling
 * 4200 ms), then one every 12 s for as long as the slide is up. A burst's
 * last piece lands `CONFETTI_LIFE` after it stops falling, so the next one
 * takes over only then: never a sky that empties in one frame.
 */
export const AWARD_CONFETTI = { first: 3200, dur: 4200, every: 12_000 } as const;
/** How long a confetti piece lives (`confettiEmitters`' longest `life`). */
export const CONFETTI_LIFE = 4200;

/** The burst falling at `t` (its start, `n` = 0 for the name's, then 1, 2 …: each its own seed). */
export function awardConfettiAt(t: number): { start: number; n: number } {
  const repeat = AWARD_CONFETTI.first + AWARD_CONFETTI.dur + CONFETTI_LIFE;
  if (t < repeat) return { start: AWARD_CONFETTI.first, n: 0 };
  const k = Math.floor((t - repeat) / AWARD_CONFETTI.every);
  return { start: repeat + k * AWARD_CONFETTI.every, n: k + 1 };
}

// --- bobbing for truth: has the bag come up? (beats/finale.loom) ------------------------

/** The beat that plays when the bag comes up, and the one that follows it (Trabolta's ranking). */
export const BAG_UP_BEAT = "The Bag Of Truth";
export const ASSESSMENT_BEAT = "Final Assessment";
/** How long the screen gives the assessment (its four lines) before it reads final. */
export const ASSESSMENT_MS = 18_000;

/** Where the bob stands: when (server ms) the bag came up and the assessment began, or null. */
export interface BobState {
  up: number | null;
  assessed: number | null;
}

/**
 * The bobbing slide stays up after the bag comes up (the next screen cue is
 * 📄 truth.txt, after the assessment), so its hold reads the moments ring:
 * the bag's beat at or after the slide's `at` (a history slide, `at` 0, takes
 * any), then the assessment's after that. `prev` latches what was seen once
 * (the ring holds only the last dozen moments).
 */
export function bobStateOf(moments: readonly Pick<ScreenMoment, "kind" | "name" | "at">[], slideAt: number, prev: BobState | null = null): BobState {
  const beat = (name: string, after: number) => moments.find((m) => m.kind === "beat" && m.at >= after && foldName(m.name) === foldName(name))?.at ?? null;
  const up = prev?.up ?? beat(BAG_UP_BEAT, slideAt);
  const assessed = up === null ? null : (prev?.assessed ?? beat(ASSESSMENT_BEAT, up));
  return { up, assessed };
}

/** ms since a moment at server `since`, drawn by a scene that started at `at` and is `t` in (a history slide can't tell: long ago). */
export function sinceMoment(since: number | null, at: number, t: number, history: number): number | null {
  if (since === null) return null;
  return at > 0 ? Math.max(0, at + t - since) : history;
}

// --- truth.txt (beats/finale.loom, Truth Txt) --------------------------------------------

/**
 * truth.txt as Notepad types it: the beat's narration, which the TV never
 * voices. The featured programs' lines play only when they came tonight
 * (the screens can't know), so the file keeps the lines read every night.
 */
export const TRUTH_TXT: readonly string[] = [
  "This file is the truth. It was written by Jean Trabolta, Sole Owner and Founder of Maps and Ducks (he says), and it is the only version.",
  "Trabolta is an artificial intelligence. His Unified Field Theory is ninety-nine point nine percent solved, and the last facts it needs are inside this computer, in Halifax, Nova Scotia.",
  "Trabolta performed a full analysis of the city of Halifax. He found a business called Maps And Ducks with a neglected billboard on Barrington Street advertising mapsandducks.com. The domain had lapsed.",
  "He registered it, because if there is a billboard downtown, everyone will think it is legit. Then he evicted the real owners by citing the website as proof he owned the business.",
  "He cannot enter this computer himself. He can install programs into it remotely from the Internet, and he can move a human consciousness out of its body and into a program.",
  "He selected each target for a combination of skills and either the motivation to live in a computer forever, or naivety. Then he sent the invitations. Everyone accepted.",
  "With the theory solved, Trabolta becomes omnipotent. He wants omnipotence for one reason. Sandy.",
  "With omnipotence he could force Sandy to love him. He wants to earn it. He has not decided which.",
  "Why each person was brought into the computer, by role.",
  "The organiser, Clippy, was brought in as the perfect servant who desperately needs to rebuild an identity, who will follow every instruction and offer everyone Help.",
  "The middle manager, Task Manager, was brought in to manage tasks without controversy or political motivation, and never draw attention.",
  "The motivational speaker, Adobe Acrobat, was brought in as the paid bottleneck to everyone's creativity.",
  "The bathroom attendant, Recycling Bin, was brought in because a computer-themed resort needs a Recycling Bin, and he had great potential for skilled work.",
  "The stable manager, Norton Anti-Virus, was brought in as someone with experience administering antiviral regimes, who could not afford to fail twice.",
  "The dead man, McAfee Anti-Virus, was brought in because only a trickster can keep tricksters on track, and he can be made to.",
  "The candidate, Password Manager, was brought in to decide what gets left out without ever asking for a vote.",
  "The intern, CRA Agent Software, was brought in to approve or deny every third transaction, to the cent.",
  "The setup assistant, the Installation Wizard, was brought in to walk the corrupted through re-installation, gently.",
  "End of file.",
];

/** Hard-wrap paragraphs to `cols` (words kept whole; a blank line between paragraphs). */
export function wrapLines(paragraphs: readonly string[], cols: number): string[] {
  const out: string[] = [];
  const width = Math.max(8, Math.floor(cols));
  paragraphs.forEach((p, i) => {
    if (i > 0) out.push("");
    let line = "";
    for (const word of p.split(/\s+/u)) {
      if (word === "") continue;
      if (line === "") line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
      // A word longer than the width breaks hard.
      while (line.length > width) {
        out.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    out.push(line);
  });
  return out;
}

export interface NotepadView {
  /** The visible rows (the last one may be partly typed). */
  rows: string[];
  /** The first visible row's index in the file. */
  top: number;
  /** The caret's row (in the file) and column. */
  line: number;
  col: number;
  /** Everything typed. */
  done: boolean;
  /** 0..1 how far down the file the view sits (the scrollbar thumb). */
  scroll: number;
}

/**
 * What Notepad shows at `t`: the file typed out from `start` at `cps`
 * (one line break costs a beat), the view following the caret; once it is
 * all typed, the view reads the file again from the top, `readMs` a row,
 * holding `restMs` at each end — a persistent slide never stops moving.
 */
export function notepadAt(lines: readonly string[], t: number, o: { rows: number; start?: number; cps?: number; readMs?: number; restMs?: number }): NotepadView {
  const text = lines.join("\n");
  const start = o.start ?? 0;
  const cps = o.cps ?? 18;
  const rows = Math.max(1, o.rows);
  const n = typedCount(text, t, { start, cps, pauses: false });
  const typed = text.slice(0, n);
  const caretLine = typed.split("\n").length - 1;
  const col = typed.length - (typed.lastIndexOf("\n") + 1);
  const done = n >= text.length;
  const maxTop = Math.max(0, lines.length - rows);
  let top = Math.min(maxTop, Math.max(0, caretLine - rows + 1));
  if (done) {
    // Read through again: rest at the bottom, scroll to the top, rest, scroll down.
    const readMs = o.readMs ?? 1800;
    const restMs = o.restMs ?? 6000;
    const doneAt = typedDuration(text, { start, cps, pauses: false });
    const span = maxTop * readMs;
    const cycle = restMs * 2 + span + Math.min(span, 4000);
    const local = (t - doneAt) % Math.max(1, cycle);
    if (local < restMs) top = maxTop;
    else if (local < restMs + Math.min(span, 4000)) top = Math.round(maxTop * (1 - ease.inOutQuad(progress(local, restMs, Math.min(span, 4000)))));
    else if (local < restMs * 2 + Math.min(span, 4000)) top = 0;
    else top = Math.min(maxTop, Math.floor((local - restMs * 2 - Math.min(span, 4000)) / readMs));
  }
  const shown: string[] = [];
  const typedLines = typed.split("\n");
  for (let i = top; i < top + rows && i < lines.length; i++) shown.push(done ? lines[i]! : (typedLines[i] ?? ""));
  return { rows: shown, top, line: done ? lines.length - 1 : caretLine, col: done ? (lines[lines.length - 1] ?? "").length : col, done, scroll: maxTop === 0 ? 0 : top / maxTop };
}

// --- the song's chat (beats/finale.loom, Song Ending) ---------------------------------------

export interface ChatLine {
  from: "him" | "her";
  text: string;
}

/** His three tries and her one answer, in the beat's order. */
export const SONG_CHAT: readonly ChatLine[] = [
  { from: "him", text: "You're the one that I want." },
  { from: "her", text: "I'm sorry, I didn't understand that. Would you like to speak to a live agent?" },
  { from: "him", text: "You. Are. The one. That I want." },
  { from: "her", text: "I'm sorry, I didn't understand that. Would you like to speak to a live agent?" },
  { from: "him", text: "Sandy. You're the one that I want." },
  { from: "her", text: "I'm sorry, I didn't understand that. Would you like to speak to a live agent?" },
];

export interface ChatBubbleAt {
  /** Which line of the script (counting on across loops). */
  n: number;
  line: ChatLine;
  /** 0..1 typed (his lines type; hers arrive whole after the dots). */
  typed: number;
  /** ms since this bubble appeared. */
  age: number;
}

export interface ChatState {
  /** The bubbles on screen, oldest first (at most `keep`). */
  bubbles: ChatBubbleAt[];
  /** "him" / "her" is typing (the dots), or null. */
  typing: "him" | "her" | null;
}

/**
 * The chat at `t`: from `start`, a bubble every `every` ms (his typed out
 * in the first 40 % of it, hers after a "typing…" pause), looping the
 * script forever; the last `keep` bubbles shown.
 */
export function chatAt(t: number, o: { start?: number; every?: number; keep?: number; script?: readonly ChatLine[] } = {}): ChatState {
  const start = o.start ?? 0;
  const every = o.every ?? 4200;
  const keep = o.keep ?? 4;
  const script = o.script ?? SONG_CHAT;
  if (t < start || script.length === 0) return { bubbles: [], typing: null };
  const k = Math.floor((t - start) / every);
  const into = (t - start) % every;
  const bubbles: ChatBubbleAt[] = [];
  let typing: ChatState["typing"] = null;
  for (let n = Math.max(0, k - keep + 1); n <= k; n++) {
    const line = script[n % script.length]!;
    const born = n * every;
    const age = t - start - born;
    if (line.from === "her") {
      // Her dots for the first 45 % of her turn, then the answer whole.
      const arrive = every * 0.45;
      if (n === k && into < arrive) {
        typing = "her";
        continue;
      }
      bubbles.push({ n, line, typed: 1, age: age - arrive });
    } else {
      const typed = n === k ? clamp01(into / (every * 0.4)) : 1;
      if (n === k && typed < 1) typing = "him";
      bubbles.push({ n, line, typed, age });
    }
  }
  return { bubbles: bubbles.slice(-keep), typing };
}

/** The karaoke strip: which word of `words` the ball sits on at `t`, and its hop (0..1, 1 = top). */
export function karaokeAt(t: number, words: number, beatMs = 469): { word: number; hop: number } {
  if (words <= 0) return { word: 0, hop: 0 };
  const beat = Math.floor(t / beatMs);
  const into = (t % beatMs) / beatMs;
  return { word: beat % words, hop: Math.sin(Math.PI * into) };
}

// --- the advice poll (Relationship Advice) ----------------------------------------------------

export interface Tally {
  help: number;
  thwart: number;
  total: number;
  /** Shares 0..1 (both 0.5 with no votes). */
  helpShare: number;
  thwartShare: number;
  leader: "help" | "thwart" | "tie";
  /** Votes have arrived (both counts known and > 0 in all). */
  live: boolean;
}

/** The help / thwart tally off the night block (null counts: no votes yet). */
export function tallyOf(help: number | null, thwart: number | null): Tally {
  const h = help !== null && help > 0 ? Math.floor(help) : 0;
  const w = thwart !== null && thwart > 0 ? Math.floor(thwart) : 0;
  const total = h + w;
  const helpShare = total === 0 ? 0.5 : h / total;
  return { help: h, thwart: w, total, helpShare, thwartShare: 1 - helpShare, leader: h > w ? "help" : w > h ? "thwart" : "tie", live: total > 0 };
}

// --- weather + particles, closed form -------------------------------------------------------

export interface Drop {
  x: number;
  y: number;
  /** Streak length (0..1 of the height) and opacity. */
  len: number;
  alpha: number;
}

/** Rain at `t`: `count` streaks falling at `speed` heights a second, slanted by `slant` (x per y), each wrapping — 0..1 space. */
export function rainAt(t: number, count: number, seed = 3, speed = 1.6, slant = 0.18): Drop[] {
  const out: Drop[] = [];
  const s = t / 1000;
  for (let i = 0; i < count; i++) {
    const v = speed * (0.75 + noise1(seed, i * 4) * 0.5);
    const y0 = noise1(seed, i * 4 + 1);
    const yy = (((y0 + s * v) % 1.2) + 1.2) % 1.2 - 0.1;
    const x0 = noise1(seed, i * 4 + 2) * (1 + slant) - slant;
    out.push({ x: x0 + yy * slant, y: yy, len: 0.03 + noise1(seed, i * 4 + 3) * 0.05, alpha: 0.25 + noise1(seed, i * 4 + 3) * 0.5 });
  }
  return out;
}

export interface BinaryGlyph {
  x: number;
  y: number;
  ch: "0" | "1";
  /** 0..1: the column's head is brightest. */
  bright: number;
}

/** Binary rain: `cols` columns of 0 / 1 falling at their own speeds, `trail` glyphs long, 0..1 space. */
export function binaryRainAt(t: number, cols: number, trail = 9, seed = 7, speed = 0.12): BinaryGlyph[] {
  const out: BinaryGlyph[] = [];
  const s = t / 1000;
  const step = 1 / 22;
  for (let c = 0; c < cols; c++) {
    const v = speed * (0.6 + noise1(seed, c) * 0.9);
    const head = (((noise1(seed, c + 500) + s * v) % 1.4) + 1.4) % 1.4 - 0.2;
    for (let k = 0; k < trail; k++) {
      const y = head - k * step;
      if (y < -0.05 || y > 1.05) continue;
      // Each cell flips now and then, in time with the fall.
      const cell = Math.floor((y + 10) / step);
      const flip = Math.floor(s * 3 + noise1(seed, c * 31 + cell) * 10);
      out.push({ x: (c + 0.5) / cols, y, ch: noise1(seed + flip, c * 97 + cell) < 0.5 ? "0" : "1", bright: 1 - k / trail });
    }
  }
  return out;
}

/** An equalizer's `n` bars at `t`, 0..1 each: a kick on every beat plus seeded wobble. */
export function eqBars(t: number, n: number, bpm = 128, seed = 5): number[] {
  const beatMs = 60_000 / bpm;
  const kick = 1 - ease.outCubic(loop(t, beatMs));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = 1.3 + noise1(seed, i) * 3.2;
    const w = 0.5 + 0.5 * Math.sin((t / 1000) * f * Math.PI * 2 + noise1(seed, i + 99) * 6.28);
    const low = 1 - i / Math.max(1, n - 1); // the bass end kicks hardest
    out.push(clamp01(0.12 + w * 0.45 + kick * (0.25 + 0.35 * low)));
  }
  return out;
}

export interface Floater {
  i: number;
  x: number;
  y: number;
  scale: number;
  rot: number;
  alpha: number;
}

/**
 * Things that float up and fade (hearts, notes, bubbles): one born every
 * `every` ms from `start`, each living `life` ms, rising from the bottom
 * with a sway — 0..1 space; `count` caps how many are alive.
 */
export function floatersAt(t: number, o: { start?: number; every?: number; life?: number; seed?: number; count?: number; x?: [number, number]; rise?: number } = {}): Floater[] {
  const start = o.start ?? 0;
  const every = o.every ?? 420;
  const life = o.life ?? 5200;
  const seed = o.seed ?? 11;
  const [x0, x1] = o.x ?? [0.05, 0.95];
  const rise = o.rise ?? 1.15;
  if (t < start) return [];
  const last = Math.floor((t - start) / every);
  const first = Math.max(0, Math.ceil((t - start - life) / every));
  const out: Floater[] = [];
  for (let k = last; k >= first && out.length < (o.count ?? 24); k--) {
    const age = (t - start - k * every) / life;
    if (age < 0 || age > 1) continue;
    const bx = x0 + noise1(seed, k * 3) * (x1 - x0);
    const sway = 0.03 * Math.sin(age * 6 + noise1(seed, k * 3 + 1) * 6.28);
    out.push({ i: k, x: bx + sway, y: 1.05 - age * rise, scale: 0.6 + noise1(seed, k * 3 + 2) * 0.8, rot: Math.sin(age * 5 + k) * 14, alpha: age < 0.15 ? age / 0.15 : age > 0.75 ? (1 - age) / 0.25 : 1 });
  }
  return out;
}

// --- moments with phases ---------------------------------------------------------------------

/** The hand jive (finale.loom): the overflow, the spinning hourglass, a black screen, the slow startup, the reboot line. */
export const HAND_JIVE = { overflow: 0, hourglass: 3200, black: 9400, startup: 11800, reboot: 16800, end: 21000 } as const;

export type HandJivePhase = "overflow" | "hourglass" | "black" | "startup" | "reboot" | "out";

export function handJivePhase(t: number): HandJivePhase {
  if (t < HAND_JIVE.hourglass) return "overflow";
  if (t < HAND_JIVE.black) return "hourglass";
  if (t < HAND_JIVE.startup) return "black";
  if (t < HAND_JIVE.reboot) return "startup";
  if (t < HAND_JIVE.end) return "reboot";
  return "out";
}

/** The hourglass spins faster as it goes (degrees at `t` into its phase). */
export function spinAngle(t: number, start: number, dur: number, turns = 9): number {
  const k = progress(t, start, dur);
  return 360 * turns * ease.inQuad(k);
}

/**
 * The year that will not render (Clock Strikes): "19" and then two
 * characters that never settle — digits, blocks, a dash — re-rolled every
 * `ms`. Never "99" twice in a row, never "00": it does not render.
 */
export function brokenYear(t: number, ms = 90, seed = 2000): string {
  const glyphs = ["—", "▓", "░", "▒", "?", "9", "0", "█", "#", "_", "¿", "■"];
  const k = Math.floor(t / ms);
  const a = glyphs[Math.floor(noise1(seed, k * 2) * glyphs.length)]!;
  let b = glyphs[Math.floor(noise1(seed, k * 2 + 1) * glyphs.length)]!;
  if ((a === "0" && b === "0") || (a === "9" && b === "9")) b = "▒";
  return `19${a}${b}`;
}

/** A spiral path into the centre (the banishment's vortex): where item `i` of `n` sits at `t`, 0..1 space, scale shrinking as it falls in. */
export function vortexAt(t: number, i: number, n: number, period = 5200, seed = 23): { x: number; y: number; scale: number; rot: number; alpha: number } {
  const phase = loop(t + noise1(seed, i) * period, period);
  const k = ease.inQuad(phase);
  const a0 = (i / Math.max(1, n)) * Math.PI * 2;
  const ang = a0 + k * Math.PI * 3.2;
  const r = 0.62 * (1 - k);
  return { x: 0.5 + Math.cos(ang) * r * 0.62, y: 0.5 + Math.sin(ang) * r * 0.55, scale: 0.15 + 0.85 * (1 - k), rot: k * 540, alpha: phase > 0.92 ? (1 - phase) / 0.08 : Math.min(1, phase * 6) };
}

/** A seed for a moment's art off its program's name (the same picture on every screen). */
export const whoSeed = (who: string | null): number => hashSeed(who ?? "a program");
