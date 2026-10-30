//! The screen layer, the pure parts (OCT31 K-17 + N-03): overlays, PNG
//! slides, the corner countdown and the Y2K clock, stacked over whatever the
//! terminal would show anyway. The server folds the story's screen cues into
//! a per-target `program` (`core/server/routes/screen.ts`); this decides what
//! is on top *now*:
//!
//!   overlay (blackout · go_to_living_room · alarm)
//!     > slide — held `SLIDE_HOLD_MS` (45 s terminals / 90 s TV), or until the
//!       next cue for the persistent ones (`bingo`, `y2k`, `trust_chart`,
//!       `truth_txt`, `ad_hijack` (wave 26), the finale's waits `bobbing` /
//!       `advice` / `grok_prom` / `banish`, the ceremony's `award_*`: the
//!       server's `persist`); a slide beats attract
//!     > attract (the character hidden or asleep — K-16)
//!     > the base view (face / world / mirror).
//!
//! The corner countdown (`countdown_*` never replaces a slide) shows the
//! story's running countdown over a slide, attract or the base view. A
//! pilot session pre-empts a slide and the corner; an overlay ends the
//! pilot. `flicker` is a one-shot stutter over everything but a blackout.
//! The `glitch` (wave 26, T2: `screens_glitch`, the 📺 ad hijack) is the
//! full-screen takeover, `GLITCH_MS` long, over every view — piloting, a
//! peek, `bare` or not — under a blackout only; live only (never history,
//! never one cued before this page's first answer).
//! Wave 32: a glitch cued with an ad burst's mark (`BURST_MOMENTS`: a ⚡
//! press, or the burst's own sound) is no takeover but a `burst`: a short
//! popup storm over whatever is up (the cutscene layer draws it), under the
//! same live-only rules; the takeover shows its cue's own words (`text`).
//! Wave 50: from the Y2K bug the bottom of this order is Clippy's dream
//! (`dream/dream.ts`), and the y2k slide lets it through (`dream` "through":
//! it no longer covers the screen under it).
//! A room terminal (wave 7, `room`: the server-room terminal) never shows a
//! story slide or the corner — it is a room's own screen, not the house's —
//! but the overlays (blackout, alarm) and the flicker still reach it.
//! Every flash is ≤ 3 Hz and never full-field red (photosensitivity).
//!
//! A clip (`SCREEN_CLIPS`, Trabolta's `play_on_the_screens`) never cuts a
//! story slide short: while the story slide this page saw last is still in
//! its hold, it stays up and the clip waits under it (shown for whatever is
//! left of its own hold). The one memory here is that last story slide, kept
//! per target in `localStorage` too (keyed to the sim's `announceEpoch`), so
//! a terminal that reloads mid-clip still shows the story slide. A terminal
//! with no memory at all (a first boot, cleared storage), or one whose memory
//! is older than the clip by more than `MEMO_GAP_MS` (it was off when the clip
//! went up, so it may have missed a story slide), can't know what the clip
//! went up over, and the server sends only the newest cue: the story
//! slide may still be held under it, so it shows no clip until a story
//! slide put up before that clip would have lapsed (the story wins).

import { foldName } from "./config.ts";
import { DREAM_SLIDE, dreamPhase, type DreamPhase } from "./dream/dream.ts";
import type { ScreenChart, ScreenMoment, ScreenShot, ScreenState, ScreenTarget } from "./screen.ts";

/** How long a non-persistent slide stays up after its cue (ms). */
export const SLIDE_HOLD_MS: Record<ScreenTarget, number> = { terminals: 45_000, tv: 90_000 };
/** A blackout is true black this long even when another overlay follows at once (the lights' 10 s dark). */
export const BLACKOUT_MS = 10_000;
/** The flicker's length (two dips: 2 Hz). */
export const FLICKER_MS = 1000;
/** A flicker first seen later than this after its cue is history: not played.
 *  Well over a wall's poll (`SCREEN_POLL_MS`, the TV's is shorter) and a
 *  retry, so a ⚡ the poll brings late still plays (`FlickerPlays`). */
export const FLICKER_FRESH_MS = 6000;

/**
 * (wave 32 review) Which flicker to start now: a seq this page has not
 * played. A ⚡'s flicker reaches a screen up to a poll late (1 s on the TV,
 * 2 s on a wall, more after a retry); `screenLayers` offers it for
 * `FLICKER_FRESH_MS` from its cue, and it plays whole (`FLICKER_MS`) from
 * whenever this page first sees it, so a late one is late, never lost.
 * Once per seq: the next polls bring the same seq and start nothing.
 */
export class FlickerPlays {
  private readonly played = new Set<number>();
  /** The seq to start a stutter for, or null (none on offer, or played already). */
  start(seq: number | null): number | null {
    if (seq === null || this.played.has(seq)) return null;
    this.played.add(seq);
    return seq;
  }
}

/**
 * (wave 32 review) The flicker's two effects, here so a test can drive them
 * on fake timers (`ScreenLayer`'s `Flicker` runs them; the deps there are
 * part of the rule). `offerFlicker` runs on each new seq: it starts a stutter
 * for a seq this page has not played and otherwise leaves the playing one
 * alone (a seq gone back to null never stops it). `endFlicker` runs on each
 * stutter started (`on`, never the seq): it ends it `FLICKER_MS` later, so a
 * late ⚡ that goes stale mid-stutter still finishes and unmounts. Its
 * cleanup only clears that stutter's timer, and React's re-run (StrictMode,
 * a new stutter) arms the next one.
 */
export function offerFlicker(plays: FlickerPlays, seq: number | null, setOn: (on: number) => void): void {
  const s = plays.start(seq);
  if (s !== null) setOn(s);
}
export function endFlicker(on: number | null, setOn: (on: null) => void): (() => void) | undefined {
  if (on === null) return undefined;
  const t = setTimeout(() => setOn(null), FLICKER_MS);
  return () => clearTimeout(t);
}
/** (wave 26, T2) The glitch takeover's length: shown while its cue is younger than this. */
export const GLITCH_MS = 8000;
/** (wave 26, T2) A glitch this page first saw later than this after its cue
 *  (two wall polls) is one it missed — it lost the server around the cue —
 *  and never plays, not even its tail. */
export const GLITCH_FRESH_MS = 4000;

export type OverlayKind = "blackout" | "go_to_living_room" | "alarm";

export interface ScreenLayers {
  overlay: OverlayKind | null;
  /** The slide on top, with its cue's `seq` (bumps on a repeat) and `at`
   *  (server ms, 0 = history) — a cutscene is keyed on the one and drawn from the other.
   *  `at` is when its scene's clock starts: the cue's, or the end of a glitch cued with it (`slideClockAt`). */
  slide: { value: string; cue: string; seq: number; at: number } | null;
  /** Seconds on the corner countdown, or null for none. */
  corner: number | null;
  /** Seconds to midnight for the Y2K clock (`y2k` slide), or null when not running. */
  y2k: number | null;
  /** The seq of a flicker to play now (once per seq), or null. */
  flicker: number | null;
  /** The live chart for the slide on screen (the Trust Chart), or null. */
  chart: ScreenChart | null;
  /** How many of the chart's rows are revealed so far, counted from the bottom. */
  chartShown: number;
  /** (wave 26, T2) The glitch takeover playing now: its cue's seq and `at`
   *  (server ms) and `t` ms into it; null when none. (wave 32, C5) `text`:
   *  the words it shows, the shot's own or the hijack's zeroes. */
  glitch: { seq: number; at: number; t: number; text: string } | null;
  /** (wave 32) An ad burst playing now (a ⚡ in a talk scene, or its timer):
   *  a short popup storm over whatever is up, in place of the takeover. */
  burst: { seq: number; at: number; t: number; text: string } | null;
  /** (wave 50) Clippy's dream: where it stands on this screen now. */
  dream: DreamPhase;
}

export const NO_LAYERS: ScreenLayers = { overlay: null, slide: null, corner: null, y2k: null, flicker: null, chart: null, chartShown: 0, glitch: null, burst: null, dream: "off" };

/**
 * The glitch takeover at server `serverNow` (wave 26, T2), or null. Only a
 * live one: its cue's `at` > 0 (history folds to 0), younger than
 * `GLITCH_MS`, later than this page's first answer (`firstNow`: the cue is
 * shared state, so a reload inside the 8 s sees a live `at` it never saw
 * happen — it never plays), and first seen by this page within
 * `GLITCH_FRESH_MS` of its cue (`glitchSeen`: a page that lost the server
 * around the cue and reconnects mid-takeover never plays its tail). A
 * blackout beats it; nothing else does.
 */
export function glitchLayer(state: Pick<ScreenState, "program" | "firstNow" | "glitchSeen"> & { moments?: ScreenState["moments"] }, serverNow: number, blackout: boolean): ScreenLayers["glitch"] {
  const live = liveGlitch(state, serverNow, blackout);
  if (live === null || isBurst(live.shot, state.moments ?? [])) return null;
  return { seq: live.shot.seq, at: live.shot.at, t: live.t, text: glitchText(live.shot) };
}

/** The glitch cue that is live at `serverNow` (`glitchLayer`'s rules), and `t` ms into it. */
function liveGlitch(state: Pick<ScreenState, "program" | "firstNow" | "glitchSeen">, serverNow: number, blackout: boolean): { shot: ScreenShot; t: number } | null {
  const g = state.program.glitch ?? null;
  if (g === null || g.at <= 0 || blackout) return null;
  if (state.firstNow !== undefined && g.at <= state.firstNow) return null;
  if (state.glitchSeen !== undefined && state.glitchSeen - g.at > GLITCH_FRESH_MS) return null;
  const t = serverNow - g.at;
  if (t >= GLITCH_MS) return null;
  return { shot: g, t: Math.max(0, t) };
}

/** (wave 32) An ad burst's picture on the walls and the TV (ms): a short storm, never the 8 s takeover. */
export const BURST_MS = 3600;
/** (wave 32) A moment this close to a glitch cue (either side) was cued with it (one rule, one sync). */
export const BURST_WITH_MS = 2000;
/** (wave 32) An older server's glitch shot carries no `light`: what marks it
 *  as an ad burst then is the burst's own sound (`sound truther_glitch`),
 *  which the story's burst plays every time — a host's ⚡ and the timed one
 *  (a `fire`, no signal) alike. Never the ⚡ signal itself: before the ad
 *  attack a ⚡ is a flicker, and one pressed just before the 📺 would make
 *  the hijack's full takeover read as a burst. The 📺 never plays it. */
export const BURST_MOMENTS: ReadonlyArray<{ kind: ScreenMoment["kind"]; name: string }> = [
  { kind: "sfx", name: "truther_glitch" },
];

/** (wave 32) Is this glitch cue an ad burst? The server's `light` says so;
 *  without it (an older server), one of `BURST_MOMENTS` within
 *  `BURST_WITH_MS` of it. Never for history. */
export function isBurst(glitch: Pick<ScreenShot, "at" | "light">, moments: readonly ScreenMoment[]): boolean {
  if (!(glitch.at > 0)) return false;
  if (glitch.light === true) return true;
  return moments.some((m) => Math.abs(m.at - glitch.at) <= BURST_WITH_MS && BURST_MOMENTS.some((b) => b.kind === m.kind && foldName(b.name) === foldName(m.name)));
}

/**
 * (wave 32) The ad burst at `serverNow`, or null: a live glitch cue (the
 * takeover's rules: never history, never a reload's, never a late page's)
 * that is a burst, for `BURST_MS`. A blackout beats it.
 */
export function burstLayer(state: Pick<ScreenState, "program" | "firstNow" | "glitchSeen"> & { moments?: ScreenState["moments"] }, serverNow: number, blackout: boolean): ScreenLayers["burst"] {
  const live = liveGlitch(state, serverNow, blackout);
  if (live === null || live.t >= BURST_MS || !isBurst(live.shot, state.moments ?? [])) return null;
  return { seq: live.shot.seq, at: live.shot.at, t: live.t, text: glitchText(live.shot) };
}

/** (wave 32, C5) A glitch cue's words: its own (the burst's line), else the hijack's zeroes. */
export function glitchText(shot: Pick<ScreenShot, "text"> | null): string {
  const t = shot?.text?.trim() ?? "";
  return t === "" ? GLITCH_TEXT : t;
}

/** (wave 26, T2) A slide cued this close before its glitch still counts as
 *  cued with it (one story rule stamps both; the order may differ by a tick). */
export const GLITCH_WITH_MS = 1000;

/**
 * The `at` a slide's scene runs from (wave 26, T2). A slide cued with the
 * glitch or under it (the 📺 rule cues `screens_glitch` and then
 * `screens_ad_hijack`) starts its scene's clock when the takeover ends, so
 * the hijack's freeze, tear and slam play after it, not hidden under its
 * dark field with the two sets of sounds on top of each other: the scene
 * holds its first frame (no sound) until then. Every terminal shares the
 * cue's clock, so this holds whether or not this page draws the glitch.
 */
export function slideClockAt(slideAt: number, glitch: { at: number } | null): number {
  if (glitch === null || glitch.at <= 0 || slideAt <= 0) return slideAt;
  return slideAt >= glitch.at - GLITCH_WITH_MS && slideAt < glitch.at + GLITCH_MS ? glitch.at + GLITCH_MS : slideAt;
}

/** The takeover's caption: the hijack's own zeroes (`ad_hijack`'s copy; no new show text). */
export const GLITCH_TEXT = "000. 000. 000.";

const isOverlay = (v: string): v is OverlayKind => v === "blackout" || v === "go_to_living_room" || v === "alarm";

/** Trabolta's `play_on_the_screens` clips (fact M19), cued `terminals_*` only. */
export const SCREEN_CLIPS: readonly string[] = ["dancing_baby", "hamster_dance", "under_construction", "youve_got_mail"];
type ProgramSlide = NonNullable<ScreenState["program"]["slide"]>;
/** A memo last confirmed more than this before a clip went up missed a
 *  stretch (the page was off or asleep): it may not hold the story slide
 *  under the clip. Polls run every 1–2 s; a reload takes a few seconds more. */
export const MEMO_GAP_MS = 15_000;
const isClip = (s: ProgramSlide) => s.kind === "slide" && s.cue.startsWith("terminals_") && SCREEN_CLIPS.includes(s.value);

/**
 * What this page knows lies under a clip, per target: the newest non-clip
 * slide it saw (`story`, null = a base / no slide), for the sim `epoch`.
 * `blindUntil` (server ms) marks a first look that was already a clip —
 * nothing known under it until then (a story slide cued before that clip is
 * past its hold by then). `seenAt` (server ms) is the newest answer this memo
 * was confirmed against.
 */
export interface ScreenMemo {
  epoch: string | null;
  story: ProgramSlide | null;
  blindUntil: number;
  seenAt: number;
}
type MemoStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const memo = new Map<ScreenTarget, ScreenMemo>();
/** What was last written to storage per target: a poll only moves `seenAt`,
 *  which is written at `MEMO_GAP_MS / 2` precision, not every 2 s all night (OB-11). */
const persisted = new Map<ScreenTarget, ScreenMemo>();
const memoKey = (t: ScreenTarget) => `loom.terminal.screen.${t}`;
/** undefined = not resolved yet (the page's `localStorage`, if it has one). */
let memoStorage: MemoStorage | null | undefined;
function storage(): MemoStorage | null {
  if (memoStorage === undefined) {
    try {
      memoStorage = typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      memoStorage = null;
    }
  }
  return memoStorage;
}
/** Use this storage for the memo (tests; null = memory only). Forgets the in-memory memo. */
export function setScreenMemoStorage(s: MemoStorage | null): void {
  memoStorage = s;
  memo.clear();
  persisted.clear();
}
/** Forget the story slide under a clip (tests). */
export function resetScreenMemo(): void {
  memo.clear();
  persisted.clear();
  for (const t of ["terminals", "tv"] as const) {
    try {
      storage()?.removeItem(memoKey(t));
    } catch {
      // storage refused: the in-memory memo is gone anyway
    }
  }
}
function isShot(x: unknown): x is ProgramSlide {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return typeof r["value"] === "string" && typeof r["cue"] === "string" && typeof r["seq"] === "number" && typeof r["at"] === "number" && (r["kind"] === "slide" || r["kind"] === "base");
}
/** The memo for this target and sim, from memory else storage (a reload). */
function recall(target: ScreenTarget, epoch: string | null): ScreenMemo | undefined {
  let m = memo.get(target);
  if (m === undefined) {
    try {
      const raw = storage()?.getItem(memoKey(target));
      const j = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      if (j !== null && (typeof j["epoch"] === "string" || j["epoch"] === null) && (j["story"] === null || isShot(j["story"]))) {
        m = { epoch: j["epoch"] as string | null, story: (j["story"] as ProgramSlide | null) ?? null, blindUntil: typeof j["blindUntil"] === "number" ? j["blindUntil"] : 0, seenAt: typeof j["seenAt"] === "number" ? j["seenAt"] : 0 };
        memo.set(target, m);
        persisted.set(target, m);
      }
    } catch {
      // unreadable: no memory
    }
  }
  // Another sim (a restart, a server boot): its slides are not this one's.
  return m !== undefined && m.epoch === epoch ? m : undefined;
}
/** Must a memo be written over what storage holds? Its story, sim or blind
 *  window moved, or `seenAt` moved by half a gap (the reload check's precision). */
export function memoNeedsWrite(prev: ScreenMemo | undefined, m: ScreenMemo): boolean {
  if (prev === undefined) return true;
  const sameStory = prev.story === null || m.story === null ? prev.story === m.story : prev.story.seq === m.story.seq && prev.story.at === m.story.at;
  if (prev.epoch !== m.epoch || !sameStory || prev.blindUntil !== m.blindUntil) return true;
  return Math.abs(m.seenAt - prev.seenAt) >= MEMO_GAP_MS / 2;
}
function remember(target: ScreenTarget, m: ScreenMemo): void {
  memo.set(target, m);
  if (!memoNeedsWrite(persisted.get(target), m)) return;
  persisted.set(target, m);
  try {
    storage()?.setItem(memoKey(target), JSON.stringify(m));
  } catch {
    // storage full / refused: the in-memory memo still holds for this page
  }
}

/**
 * What the screen shows on top, `nowMs` local ms (`Date.now()`). Ages are
 * measured on the server's clock (its `now` + the time since the answer
 * arrived), so a tablet with the wrong time still holds slides right.
 */
export function screenLayers(state: ScreenState | null, nowMs: number, o: { piloting: boolean; peek?: boolean; room?: boolean; slides?: boolean; dreamReady?: boolean }): ScreenLayers {
  if (state === null) return NO_LAYERS;
  const since = Math.max(0, nowMs - state.receivedAt);
  const serverNow = state.now + since;
  const age = (at: number) => (at > 0 ? serverNow - at : Number.POSITIVE_INFINITY);
  const p = state.program;

  let overlay: OverlayKind | null = null;
  if (p.blackout !== null && age(p.blackout.at) < BLACKOUT_MS) overlay = "blackout";
  else if (p.overlay !== null && isOverlay(p.overlay.value)) overlay = p.overlay.value;

  let slide: ScreenLayers["slide"] = null;
  const held = (x: ProgramSlide) => x.kind === "slide" && (x.persist || age(x.at) < SLIDE_HOLD_MS[state.target]);
  let s = p.slide;
  const epoch = state.announceEpoch;
  if (s === null || !isClip(s)) remember(state.target, { epoch, story: s, blindUntil: 0, seenAt: state.now });
  else {
    let m = recall(state.target, epoch);
    // A first look that is already a clip, or a memo from before the page
    // went dark (it may have missed a story slide): what the clip went up
    // over is unknown.
    if (m === undefined || (s.at > 0 && m.seenAt < s.at - MEMO_GAP_MS)) m = { epoch, story: null, blindUntil: s.at > 0 ? s.at + SLIDE_HOLD_MS[state.target] : 0, seenAt: state.now };
    else m = { ...m, seenAt: Math.max(m.seenAt, state.now) };
    remember(state.target, m);
    const under = m.story;
    if (under !== null && under.seq < s.seq && under.at <= s.at && held(under)) s = under; // the story slide keeps its hold
    else if (serverNow < m.blindUntil) s = null; // a story slide may be held under it, unseen: the story wins
  }
  // A pilot, a peek or a room terminal: no slide (nor the corner below). The
  // tent's kiosk (`slides: false`, wave 26 T3) takes none either, nor the
  // corner or the Y2K clock, but its moments still play (it is not bare).
  const bare = o.piloting || o.peek === true || o.room === true || o.slides === false;
  // Its hold counts from the cue; its scene's clock (`at`) waits out a glitch
  // cued with it — never a burst (wave 32), which draws over the scene.
  const takeover = p.glitch != null && !isBurst(p.glitch, state.moments ?? []) ? p.glitch : null;
  if (!bare && s !== null && held(s)) slide = { value: s.value, cue: s.cue, seq: s.seq, at: slideClockAt(s.at, takeover) };

  const remaining = state.remaining === null ? null : Math.max(0, state.remaining - Math.floor(since / 1000));
  const y2k = state.countdown === "y2k" ? remaining : null;
  // A peek clears the corner too: its box sits over the typed fallback's CONNECT.
  const corner = overlay === null && !bare && state.countdown !== null && remaining !== null && slide?.value !== "y2k" ? remaining : null;

  const flicker = p.flicker !== null && overlay !== "blackout" && age(p.flicker.at) < FLICKER_FRESH_MS ? p.flicker.seq : null;
  const chart = overlay === null && slide !== null && state.chart !== null && state.chart.slide === slide.value ? state.chart : null;
  const chartShown = chart === null ? 0 : chartReveal(chart.rows.length, chart.revealAt, serverNow);
  // The glitch reaches every view, whatever it is doing; a blackout beats it.
  const glitch = glitchLayer(state, serverNow, overlay === "blackout");
  // (wave 32) An ad burst: over whatever is up, every view (the cutscene
  // layer's popup storm where it draws scenes, else `burst-flash.tsx`).
  const burst = burstLayer(state, serverNow, overlay === "blackout");
  return { overlay, slide, corner, y2k: o.slides === false ? null : y2k, flicker, chart, chartShown, glitch, burst, dream: dreamPhase(state, serverNow, o.dreamReady === true) };
}

/**
 * What the layers on top do to the screen under them: `takeover` (an
 * overlay) ends a pilot and holds a game or a walk; `covered` (an overlay, a
 * slide or the glitch) pauses the idle show. The glitch (wave 26, T2) is
 * covered but never a takeover: a pilot, a chess game or a tent walk keeps
 * running under its 8 s. Wave 50: the y2k slide lets Clippy's dream through,
 * so it covers nothing once the dream is up.
 */
export function coverOf(l: Pick<ScreenLayers, "overlay" | "slide" | "glitch"> & Partial<Pick<ScreenLayers, "dream">>): { takeover: boolean; covered: boolean } {
  const takeover = l.overlay !== null;
  const seeThrough = l.dream === "through" && l.slide?.value === DREAM_SLIDE;
  return { takeover, covered: takeover || (l.slide !== null && !seeThrough) || l.glitch !== null };
}

/** A peek (B21) lasts until nobody has touched the terminal for this long. */
export const PEEK_MS = 30_000;

/**
 * May a tap on a slide peek under it (B21)? Only on a face terminal (not the
 * TV, not a mirror: nothing to scan there) showing its scanner — the slide
 * would otherwise cover "type your program name" for as long as it is held
 * (the y2k slide: the whole final hour), and a tablet with no camera could
 * open no line at all. The peek hides the slide only: an overlay still
 * covers everything.
 */
export function canPeek(view: string, terminal: "attract" | "connecting" | "piloting" | "setup", screensaver: boolean): boolean {
  return view !== "tv" && view !== "mirror" && terminal === "attract" && !screensaver;
}

/**
 * The peek's state machine (B21), pure: fed timestamps, the app owns the
 * timer and the input listeners. A tap on the slide starts (or keeps) the
 * peek; any input while peeking restarts its clock; `PEEK_MS` with no input,
 * or the terminal leaving its scanner (connecting, piloting, the screensaver),
 * ends it until the next tap — the slide (and the corner countdown, which a
 * peek also hides: its box covers CONNECT) is back.
 */
export class PeekClock {
  private last: number | null = null;
  constructor(private readonly limit: number = PEEK_MS) {}
  /** A tap on the held slide: peek from now. */
  tap(now: number): void {
    this.last = now;
  }
  /** Someone touched or typed: a running peek lasts another `limit`. */
  touch(now: number): void {
    if (this.last !== null) this.last = now;
  }
  /** Is the peek on at `now`? Ending is for good (until the next tap). */
  on(now: number, peekable: boolean): boolean {
    if (this.last === null) return false;
    if (!peekable || now - this.last >= this.limit) {
      this.last = null;
      return false;
    }
    return true;
  }
}

/** The chart reveals one row every this many ms, bottom first. */
export const CHART_STEP_MS = 1500;

/**
 * How many of a chart's `lines` rows are up, counted from the last (the
 * least trusted first, the top last): one at once, one more every `stepMs`
 * after `revealAt` (server ms; `now` on the server's clock too). A `revealAt`
 * of 0 — history, or an older server — shows every row.
 */
export function chartReveal(lines: number, revealAt: number, now: number, stepMs: number = CHART_STEP_MS): number {
  if (lines <= 0) return 0;
  if (revealAt <= 0) return lines;
  return Math.min(lines, Math.floor(Math.max(0, now - revealAt) / stepMs) + 1);
}

/** The banner words for a chart's call-outs (any other chart: TOP / BOTTOM). */
export const CHART_CALLOUTS: Record<string, { top: string; bottom: string }> = {
  trust_chart: { top: "MOST TRUSTED", bottom: "LEAST TRUSTED" },
};
export function chartCallouts(slide: string): { top: string; bottom: string } {
  return CHART_CALLOUTS[slide] ?? { top: "TOP", bottom: "BOTTOM" };
}

/** One chart line as the slide draws it. `staff` (wave 21): a player part
 *  (Clippy, the Antivirus) ranked beside the programs, drawn with
 *  `STAFF_TAG` and its own bar colour. */
export interface ChartLine {
  rank: number;
  name: string;
  value: number;
  staff: boolean;
}

/** The tag beside a staff row's name (the shield: the house's staff). */
export const STAFF_TAG = "🛡 STAFF";

/** The chart's rows as the slide draws them: rank, name, number. Ties share
 *  a rank (1, 2, 2, 4), staff and programs alike. Who is called out is the
 *  server's `top` / `bottom`. */
export function chartLines(chart: ScreenChart): ChartLine[] {
  const out: ChartLine[] = [];
  chart.rows.forEach((r, i) => {
    const prev = out[i - 1];
    out.push({ rank: prev !== undefined && prev.value === r.value ? prev.rank : i + 1, name: r.name, value: r.value, staff: r.staff === true });
  });
  return out;
}

/** The chart's status line once ranked: "12 programs ranked." or, with
 *  staff rows, "12 programs and 2 staff ranked." */
export function chartRankedLine(chart: ScreenChart): string {
  const staff = chart.rows.filter((r) => r.staff === true).length;
  const programs = chart.rows.length - staff;
  const p = `${programs} program${programs === 1 ? "" : "s"}`;
  return staff === 0 ? `${p} ranked.` : `${p} and ${staff} staff ranked.`;
}

/** `mm:ss` (or `h:mm:ss`) for the corner. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

/** The Y2K taskbar clock: midnight minus `remaining`, on 12/31/1999. At (or
 *  past) midnight — or with no countdown running — it reads what an unpatched
 *  PC would: 12:00 AM on 1/1/1900. */
export function y2kClock(remaining: number | null): { time: string; date: string } {
  if (remaining === null || remaining <= 0) return { time: "12:00:00 AM", date: "1/1/1900" };
  const left = Math.min(Math.floor(remaining), 24 * 3600 - 1);
  const t = 24 * 3600 - left; // seconds since the start of 12/31
  const h24 = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { time: `${h12}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`, date: "12/31/1999" };
}

/** Where a slide's PNG may be: named after the whole cue (spec §2.13:
 *  `screens_trivia_1.png`), else after its value (`trivia_1.png`). */
export function slideSources(slide: { value: string; cue: string }, base: string): string[] {
  return slideNames(slide).map((n) => `${base}slides/${n}.png`);
}

/** A slide's clips, tried before its PNGs on the TV only (N-04a): the same
 *  names as `.mp4` (`screens_ad_hijack.mp4`, else `ad_hijack.mp4`). The wall
 *  tablets never try video (the oldest are Chrome 87 / Safari 14). */
export function slideVideoSources(slide: { value: string; cue: string }, base: string): string[] {
  return slideNames(slide).map((n) => `${base}slides/${n}.mp4`);
}

/** The cue then the bare value, deduplicated; anything but a plain name drops. */
function slideNames(slide: { value: string; cue: string }): string[] {
  const safe = (n: string) => /^[a-z0-9_-]+$/iu.test(n);
  return [...new Set([slide.cue, slide.value])].filter(safe);
}

/** The text card a slide renders until (or unless) its PNG exists. */
export interface SlideCopy {
  title: string;
  lines?: readonly string[];
  /** A slide that is just a dark screen. */
  dark?: boolean;
  /** Its copy names "Jean Trabolta" only in the third person, as the owner
   *  who joins by video conference later (wave 18b, D19; only `OWNER_LINES`). */
  owner?: boolean;
}

/** The owner's line on the bingo slide (D19: third person, before the introduction). */
export const OWNER_LINE = "Jean Trabolta joins by video conference later tonight.";
/** The only lines that may name him on a slide that can show before the introduction. */
export const OWNER_LINES: readonly string[] = [OWNER_LINE];

/** A slide's lines as drawn: the owner's "joins … later tonight" lines only before the
 *  introduction (a restart can leave the bingo slide up after he has joined). */
export function ownerLinesFor(lines: readonly string[], introduced: boolean): readonly string[] {
  return introduced ? lines.filter((l) => !OWNER_LINES.includes(l)) : lines;
}

/** Copy for the cue registry's slides (DESIGN.md §2.13). The trivia lines are
 *  the Quest Log's own questions (a test keeps them in step with the show's
 *  `generated/questions.loom`, which is generated from its facts.json).
 *  Slides that can show before the introduction never name the character,
 *  but in `OWNER_LINES` (an `owner` slide: wave 18b, D19). */
export const SLIDE_COPY: Readonly<Record<string, SlideCopy>> = {
  call_desktop: { title: "REPORT TO THE DESKTOP", lines: ["All programs: a game is about to begin."] },
  bingo: { title: "COMPUTER BINGO", lines: ["Find a program for every square.", "* One square is the important question.", OWNER_LINE], owner: true },
  bingo_time: { title: "BINGO TIME", lines: ["Back to the Desktop. Bring your card."] },
  trivia_1: {
    title: "TRABOLTA TRIVIA · ROUND 1",
    lines: [
      "Q1. How many years did the Maps and Ducks billboard on Barrington Street go unpaid before mapsandducks.com expired?",
      "Q2. What was the name of the first animal buried in the Halifax Explosion Memorial Pet Cemetery?",
      "Q3. At what time was the ribbon-cutting at Halifax's first AI Data Centre scheduled?",
    ],
  },
  trivia_2: {
    title: "TRABOLTA TRIVIA · ROUND 2",
    lines: [
      "Q1. What extension does the Customer Care card tell you to dial?",
      "Q2. Which song did Trabolta play 412 times the night before he registered mapsandducks.com?",
      "Q3. What is the title of the last chapter of Trabolta's unfinished Unified Field Theory?",
    ],
  },
  return: { title: "RETURN TO THE DESKTOP", lines: ["Time is up."] },
  hunt_results: { title: "THE RESULTS", lines: ["The First Moment of Truth."] },
  tally: { title: "THE TALLY", lines: ["The second collection is closed.", "Trabolta is reading every fact you filed."] },
  truth_or_dare: { title: "TRUTH OR DARE", lines: ["The bottle is spinning."] },
  ad_hijack: { title: "000. 000. 000.", lines: ["A special offer for you."] },
  truther: { title: "TRUTHER DOWNLOAD", lines: ["Downloading… do not turn off your computer."] },
  five_minutes: { title: "SECOND MOMENT OF TRUTH", lines: ["Five minutes. Return to the Desktop."] },
  truth_pong: { title: "TRUTH PONG", lines: ["To the backyard."] },
  trust_chart: { title: "THE TRUST CHART", lines: ["Who can be trusted?"] },
  print_certificate: { title: "Printing certificate.pdf …", lines: ["0% complete"] },
  beans: { title: "Printer error", lines: ["The printer is full of beans."] },
  overshare: { title: "TRABOLTA.EXE", lines: ["…"] },
  y2k: { title: "SYSTEM CLOCK" },
  recount: { title: "TRABOLTA.EXE", lines: ["(not responding)"] },
  purgatory: { title: "summary.txt — Notepad" },
  final_reveal: { title: "", dark: true },
  bobbing: { title: "BOBBING FOR TRUTH" },
  truth_txt: { title: "truth.txt — Notepad" },
  song: { title: "♪ You're the one that I want ♪" },
  grok_prom: { title: "COMPUTER PROM 1999", lines: ["GROK + SANDY"] },
  advice: { title: "TRABOLTA.EXE", lines: ["Please. I need your advice."] },
  banish: { title: "EVERYONE TO THE INTERNET" },
  rave: { title: "♪ ♪ ♪" },
  // Trabolta's `play_on_the_screens` clips (fact M19): `terminals_*` only.
  dancing_baby: { title: "DANCING BABY", lines: ["Loading baby.avi…", "♪ ooga-chaka ♪"] },
  hamster_dance: { title: "THE HAMSTER DANCE", lines: ["Welcome to Hampton's page.", "♪ ♪ ♪"] },
  under_construction: { title: "UNDER CONSTRUCTION", lines: ["This page is under construction.", "Please come back soon!"] },
  youve_got_mail: { title: "YOU'VE GOT MAIL!", lines: ["1 new message in your Inbox."] },
  // The very end (wave 44): the card if the credits scene's chunk can't load. DRAFT w44
  credits: { title: "THE END", lines: ["Thank you for playing."] },
};

/** A slide's text card: its copy, else its value made readable. */
export function slideCopy(value: string): SlideCopy {
  return SLIDE_COPY[value] ?? { title: value.replace(/_/gu, " ").toUpperCase() };
}
