import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { IdentifyOverlay, ScreenLayer, SlideView, claimGlitchSounds, glitchLeftMs, resetGlitchSounds } from "../src/ScreenLayer.tsx";
import { EMPTY_NIGHT, SCREEN_POLL_MS, TV_POLL_MS, parseScreenState, resetPageFirst, withFirstNow, type ScreenProgram, type ScreenState } from "../src/screen.ts";
import { BLACKOUT_MS, FLICKER_FRESH_MS, FLICKER_MS, FlickerPlays, endFlicker, offerFlicker, GLITCH_FRESH_MS, GLITCH_MS, GLITCH_WITH_MS, slideClockAt, coverOf, GLITCH_TEXT, OWNER_LINE, OWNER_LINES, PEEK_MS, PeekClock, canPeek, SLIDE_COPY, SLIDE_HOLD_MS, CHART_STEP_MS, chartCallouts, chartLines, chartRankedLine, chartReveal, formatCountdown, resetScreenMemo, screenLayers, setScreenMemoStorage, slideCopy, slideSources, slideVideoSources, y2kClock } from "../src/slides.ts";

const T0 = 1_000_000;
const empty: ScreenProgram = { slide: null, overlay: null, blackout: null, flicker: null };
const shot = (value: string, at: number, seq = 1, family = "screens") => ({ value, cue: `${family}_${value}`, seq, at });
const slide = (value: string, at: number, persist = false, kind: "slide" | "base" = "slide") => ({ ...shot(value, at), kind, persist });

function state(over: Partial<Omit<ScreenState, "program">> & { program?: Partial<ScreenProgram> } = {}): ScreenState {
  return {
    now: T0,
    receivedAt: T0,
    night: EMPTY_NIGHT,
    moments: [],
    cues: {},
    character: null,
    attract: false,
    countdown: null,
    remaining: null,
    chart: null,
    target: "terminals",
    voice: null,
    room: null,
    announce: null,
    announces: [],
    identify: false,
    identifyLeft: null,
    announceEpoch: null,
    king: null,
    reinstalling: 0,
    ...over,
    program: { ...empty, ...over.program },
  };
}
const at = (s: ScreenState, ms: number, piloting = false) => screenLayers(s, s.receivedAt + ms, { piloting });

describe("a tap peeks under a held slide (B21)", () => {
  // After y2k_clock the persisting y2k slide stands for the whole final hour.
  const y2k = state({ countdown: "y2k", remaining: 3000, program: { slide: slide("y2k", T0, true) } });
  const peekAt = (s: ScreenState, ms: number) => screenLayers(s, s.receivedAt + ms, { piloting: false, peek: true });

  it("only a face terminal showing its scanner may peek", () => {
    for (const v of ["auto", "face", "world"]) expect(canPeek(v, "attract", false)).toBe(true);
    expect(canPeek("tv", "attract", false)).toBe(false);
    expect(canPeek("mirror", "attract", false)).toBe(false);
    expect(canPeek("auto", "attract", true)).toBe(false); // the screensaver: no scanner under it
    expect(canPeek("auto", "piloting", false)).toBe(false);
    expect(canPeek("auto", "connecting", false)).toBe(false);
    expect(PEEK_MS).toBe(30_000);
  });

  it("a peek drops the persisting y2k slide and the corner (it would cover CONNECT); the slide is back after", () => {
    expect(at(y2k, 30 * 60_000)).toMatchObject({ slide: { value: "y2k" }, corner: null });
    expect(peekAt(y2k, 30 * 60_000)).toMatchObject({ slide: null, corner: null });
    expect(at(y2k, 31 * 60_000).slide?.value).toBe("y2k");
  });

  it("the app's peek: a tap starts it, input keeps it, 30 s untouched brings the y2k slide back", () => {
    const clock = new PeekClock();
    const t0 = y2k.receivedAt + 30 * 60_000;
    // What the app draws at `ms`: the clock decides `peek` for screenLayers.
    const drawn = (ms: number, kind: "attract" | "connecting" | "piloting" | "setup" = "attract") => {
      const peek = clock.on(ms, canPeek("auto", kind, false));
      return { peek, layers: screenLayers(y2k, ms, { piloting: kind === "piloting" || kind === "connecting", peek }) };
    };
    expect(drawn(t0).peek).toBe(false); // input with no tap starts nothing
    clock.touch(t0);
    expect(drawn(t0 + 1).layers.slide?.value).toBe("y2k");

    clock.tap(t0);
    expect(drawn(t0)).toMatchObject({ peek: true, layers: { slide: null, corner: null } });
    // The guest types their name slowly: each input restarts the 30 s.
    clock.touch(t0 + 29_000);
    expect(drawn(t0 + 29_000 + 29_000).peek).toBe(true);
    clock.touch(t0 + 58_000);
    expect(drawn(t0 + 58_000 + PEEK_MS - 1).peek).toBe(true);
    // Then nobody touches it for PEEK_MS: the clock is back, and stays back.
    expect(drawn(t0 + 58_000 + PEEK_MS)).toMatchObject({ peek: false, layers: { slide: { value: "y2k" } } });
    clock.touch(t0 + 58_000 + PEEK_MS + 1);
    expect(drawn(t0 + 58_000 + PEEK_MS + 2).peek).toBe(false);
  });

  it("the peek ends the moment the terminal leaves its scanner (connecting, piloting)", () => {
    for (const kind of ["connecting", "piloting"] as const) {
      const clock = new PeekClock();
      clock.tap(T0);
      expect(clock.on(T0 + 1_000, canPeek("auto", "attract", false))).toBe(true);
      expect(clock.on(T0 + 2_000, canPeek("auto", kind, false))).toBe(false);
      // Back at the scanner (the pilot ended): no stale peek, the slide is up.
      expect(clock.on(T0 + 3_000, canPeek("auto", "attract", false))).toBe(false);
    }
    // The screensaver ends it too.
    const clock = new PeekClock();
    clock.tap(T0);
    expect(clock.on(T0 + 1, canPeek("auto", "attract", true))).toBe(false);
  });

  it("overlays still block a peek", () => {
    const alarm = state({ ...y2k, program: { slide: slide("y2k", T0, true), overlay: shot("alarm", T0, 2) } });
    expect(peekAt(alarm, 0).overlay).toBe("alarm");
  });

  it("the slide catches the tap; while peeking nothing covers the typed fallback", () => {
    const covered = renderToStaticMarkup(createElement(ScreenLayer, { layers: at(y2k, 0), gear: null, onSlideTap: () => {} }));
    expect(covered).toContain('data-peekable=""');
    expect(covered).toContain("y2k-slide");
    const peeking = renderToStaticMarkup(createElement(ScreenLayer, { layers: peekAt(y2k, 0), gear: null, onSlideTap: () => {} }));
    expect(peeking).not.toContain("screen-slide");
    expect(peeking).not.toContain("screen-gear");
    // The TV and mirrors get no tap handler: the slide is drawn bare.
    expect(renderToStaticMarkup(createElement(ScreenLayer, { layers: at(y2k, 0), gear: null }))).not.toContain("data-peekable");
  });
});

describe("screen layers — precedence (N-03)", () => {
  it("holds a slide 45 s on a terminal and 90 s on the TV", () => {
    const s = state({ program: { slide: slide("trivia_2", T0) } });
    // The cue's seq and server time ride along: a cutscene is keyed and drawn off them.
    expect(at(s, 0).slide).toEqual({ value: "trivia_2", cue: "screens_trivia_2", seq: 1, at: T0 });
    expect(at(s, SLIDE_HOLD_MS.terminals - 1).slide).not.toBeNull();
    expect(at(s, SLIDE_HOLD_MS.terminals).slide).toBeNull(); // back to auto
    const tv = { ...s, target: "tv" as const };
    expect(at(tv, 60_000).slide).not.toBeNull();
    expect(at(tv, SLIDE_HOLD_MS.tv).slide).toBeNull();
  });

  it("persistent slides stay; history (at 0) never re-holds; a base cue is no slide", () => {
    expect(at(state({ program: { slide: slide("bingo", T0, true) } }), 10 * 60_000).slide?.value).toBe("bingo");
    expect(at(state({ program: { slide: slide("bingo", 0, true) } }), 0).slide?.value).toBe("bingo");
    expect(at(state({ program: { slide: slide("trivia_1", 0) } }), 0).slide).toBeNull();
    expect(at(state({ program: { slide: slide("attract", T0, false, "base") } }), 0).slide).toBeNull();
  });

  it("ages on the server's clock, not the tablet's", () => {
    // The tablet's clock is an hour off; the answer arrived 10 s after the cue.
    const s = state({ now: T0 + 10_000, receivedAt: T0 + 3_600_000, program: { slide: slide("call_desktop", T0) } });
    expect(at(s, 0).slide).not.toBeNull();
    expect(at(s, SLIDE_HOLD_MS.terminals - 10_000).slide).toBeNull();
  });

  it("a pilot pre-empts the slide and the corner; an overlay beats the slide", () => {
    const s = state({ countdown: "hunt", remaining: 900, program: { slide: slide("trivia_1", T0) } });
    expect(at(s, 0)).toMatchObject({ slide: { value: "trivia_1" }, corner: 900 });
    expect(at(s, 0, true)).toMatchObject({ slide: null, corner: null });
    const o = state({ countdown: "hunt", remaining: 900, program: { slide: slide("trivia_1", T0), overlay: shot("alarm", T0, 2) } });
    expect(at(o, 0)).toMatchObject({ overlay: "alarm", corner: null });
  });

  it("a room terminal (wave 7) never shows a story slide or the corner; overlays and the flicker still reach it", () => {
    const room = (s: ScreenState, ms = 0) => screenLayers(s, s.receivedAt + ms, { piloting: false, room: true });
    const s = state({ countdown: "y2k", remaining: 600, program: { slide: slide("y2k", T0, true), flicker: shot("flicker", T0, 4) } });
    expect(at(s, 0)).toMatchObject({ slide: { value: "y2k" }, y2k: 600 });
    expect(room(s)).toMatchObject({ slide: null, corner: null, chart: null, flicker: 4 });
    expect(room(state({ countdown: "hunt", remaining: 900, program: { slide: slide("trivia_1", T0) } }))).toMatchObject({ slide: null, corner: null });
    expect(room(state({ program: { slide: slide("trivia_1", T0), overlay: shot("alarm", T0, 2) } })).overlay).toBe("alarm");
    expect(room(state({ program: { overlay: shot("blackout", T0), blackout: shot("blackout", T0) } })).overlay).toBe("blackout");
  });

  it("blackout is black for 10 s, then the overlay after it (go to the living room)", () => {
    const s = state({ program: { overlay: shot("go_to_living_room", T0, 2), blackout: shot("blackout", T0, 1) } });
    expect(at(s, 0).overlay).toBe("blackout");
    expect(at(s, BLACKOUT_MS - 1).overlay).toBe("blackout");
    expect(at(s, BLACKOUT_MS).overlay).toBe("go_to_living_room");
    // A blackout on its own stands until the next cue.
    expect(at(state({ program: { overlay: shot("blackout", T0), blackout: shot("blackout", T0) } }), 60_000).overlay).toBe("blackout");
    // After a reboot (history) the blackout is not replayed.
    expect(at(state({ program: { overlay: shot("go_to_living_room", 0, 2), blackout: shot("blackout", 0) } }), 0).overlay).toBe("go_to_living_room");
  });

  it("the corner ticks down between polls, and the y2k slide turns it into the clock", () => {
    const s = state({ countdown: "hunt", remaining: 900 });
    expect(at(s, 1500).corner).toBe(899);
    expect(at(s, 2_000_000).corner).toBe(0);
    const y = state({ countdown: "y2k", remaining: 3600, program: { slide: slide("y2k", T0, true) } });
    expect(at(y, 0)).toMatchObject({ corner: null, y2k: 3600, slide: { value: "y2k" } });
    expect(at(state({ countdown: "y2k", remaining: 30 }), 0)).toMatchObject({ corner: 30, y2k: 30 });
  });

  it("a flicker plays only while fresh, never over a blackout", () => {
    const s = state({ program: { flicker: shot("flicker", T0, 7) } });
    expect(at(s, 0).flicker).toBe(7);
    expect(at(s, FLICKER_FRESH_MS).flicker).toBeNull();
    expect(at(state({ program: { flicker: shot("flicker", 0, 7) } }), 0).flicker).toBeNull();
    expect(at(state({ program: { flicker: shot("flicker", T0, 7), blackout: shot("blackout", T0) } }), 0).flicker).toBeNull();
  });

  it("a ⚡'s flicker the poll brings late still plays, whole, once (wave 32 review)", () => {
    // The TV polls every second, a wall every two; a retry can add more. Each
    // answer is the server's word at `now` (the cue was at T0).
    expect(FLICKER_FRESH_MS).toBeGreaterThanOrEqual(2 * SCREEN_POLL_MS + FLICKER_MS);
    for (const lag of [TV_POLL_MS - 50, TV_POLL_MS, SCREEN_POLL_MS, 2 * SCREEN_POLL_MS + 500, FLICKER_FRESH_MS - FLICKER_MS]) {
      const s = state({ now: T0 + lag, receivedAt: 5_000, target: lag < SCREEN_POLL_MS ? "tv" : "terminals", program: { flicker: shot("flicker", T0, 7) } });
      // On offer from the answer for at least its whole stutter, on the page's own clock.
      for (const ms of [0, FLICKER_MS / 2, FLICKER_MS - 1]) expect(at(s, ms).flicker, `${lag} + ${ms}`).toBe(7);
    }
    // Past the freshness it is history: never played.
    expect(at(state({ now: T0 + FLICKER_FRESH_MS, program: { flicker: shot("flicker", T0, 7) } }), 0).flicker).toBeNull();
    // Once per seq: the next polls bring the same seq and start nothing; a new ⚡ plays.
    const plays = new FlickerPlays();
    expect(plays.start(null)).toBeNull();
    expect(plays.start(7)).toBe(7);
    expect(plays.start(7)).toBeNull();
    expect(plays.start(null)).toBeNull();
    expect(plays.start(7)).toBeNull();
    expect(plays.start(8)).toBe(8);
  });

  // `ScreenLayer`'s Flicker, with React's effect rules played by hand: each
  // commit runs an effect whose deps changed (its old cleanup first), a set
  // state commits again, and StrictMode's mount runs every effect, cleans up
  // and runs them all again. The deps are the component's: [seq] and [on].
  function flickerOnPage(seq0: number | null, strict: boolean) {
    const UNSET = Symbol("unset");
    const plays = new FlickerPlays();
    const page = { seq: seq0, on: null as number | null, starts: [] as number[] };
    let seqDep: unknown = UNSET;
    let onDep: unknown = UNSET;
    let endCleanup: (() => void) | undefined;
    let dirty = false;
    let flushing = false;
    const setOn = (v: number | null) => {
      if (Object.is(v, page.on)) return;
      page.on = v;
      if (v !== null) page.starts.push(v);
      dirty = true;
      if (!flushing) flush();
    };
    const commit = () => {
      const { seq, on } = page; // what this render saw
      if (!Object.is(seq, seqDep)) { seqDep = seq; offerFlicker(plays, seq, setOn); }
      if (!Object.is(on, onDep)) { endCleanup?.(); onDep = on; endCleanup = endFlicker(on, setOn); }
    };
    const flush = () => {
      flushing = true;
      do { dirty = false; commit(); } while (dirty);
      flushing = false;
    };
    flushing = true;
    commit();
    if (strict) {
      endCleanup?.();
      endCleanup = undefined;
      seqDep = onDep = UNSET;
      commit();
    }
    flushing = false;
    if (dirty) flush();
    return { page, setSeq: (s: number | null) => { page.seq = s; flush(); } };
  }

  it("a late ⚡ that goes stale mid-stutter still finishes and unmounts; StrictMode starts one (wave 32 review)", () => {
    vi.useFakeTimers();
    try {
      for (const strict of [false, true]) {
        const { page, setSeq } = flickerOnPage(7, strict);
        expect(page.on, `strict ${strict}`).toBe(7);
        expect(page.starts).toEqual([7]);
        // The next poll is past FLICKER_FRESH_MS: the seq goes back to null mid-stutter.
        vi.advanceTimersByTime(FLICKER_MS / 2);
        setSeq(null);
        expect(page.on).toBe(7);
        vi.advanceTimersByTime(FLICKER_MS / 2 - 1);
        expect(page.on).toBe(7);
        vi.advanceTimersByTime(1);
        expect(page.on).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        // The same seq again starts nothing; a new ⚡ plays whole.
        setSeq(7);
        expect(page.on).toBeNull();
        setSeq(8);
        expect(page.on).toBe(8);
        vi.advanceTimersByTime(FLICKER_MS);
        expect(page.on).toBeNull();
        expect(page.starts).toEqual([7, 8]);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("no answer yet: nothing on top", () => {
    expect(screenLayers(null, T0, { piloting: false })).toEqual({ overlay: null, slide: null, corner: null, y2k: null, flicker: null, chart: null, chartShown: 0, glitch: null, burst: null, dream: "off" });
  });

  // Fact M19: a clip Trabolta puts on the terminals never cuts a story slide short.
  const clip = (value: string, at: number, seq: number) => ({ ...shot(value, at, seq, "terminals"), kind: "slide" as const, persist: false });
  const story = (value: string, at: number, seq: number) => ({ ...shot(value, at, seq), kind: "slide" as const, persist: false });
  // One poll's answer, read at once: a page that keeps polling keeps its memo fresh.
  const poll = (slide: ScreenProgram["slide"], now: number, announceEpoch: string | null = null) => at(state({ announceEpoch, now, receivedAt: now, program: { slide } }), 0);

  it("a clip waits under a held story slide (trivia_2, truth_or_dare), then plays out its own hold", () => {
    for (const v of ["trivia_2", "truth_or_dare"]) {
      resetScreenMemo();
      const before = state({ program: { slide: story(v, T0, 5) } });
      expect(at(before, 0).slide?.value).toBe(v);
      // 10 s later the dancing baby is the newest cue: the story slide keeps its 45 s.
      const after = state({ now: T0 + 10_000, receivedAt: T0 + 10_000, program: { slide: clip("dancing_baby", T0 + 10_000, 6) } });
      expect(at(after, 0).slide).toEqual({ value: v, cue: `screens_${v}`, seq: 5, at: T0 });
      expect(at(after, SLIDE_HOLD_MS.terminals - 10_001).slide?.value).toBe(v);
      // The story slide's hold is over: the clip has what is left of its own.
      expect(at(after, SLIDE_HOLD_MS.terminals - 10_000).slide).toEqual({ value: "dancing_baby", cue: "terminals_dancing_baby", seq: 6, at: T0 + 10_000 });
      expect(at(after, SLIDE_HOLD_MS.terminals).slide).toBeNull();
    }
  });

  it("a clip plays at once over a lapsed slide, a base view, or a page that saw no story slide", () => {
    resetScreenMemo();
    expect(at(state({ program: { slide: story("trivia_2", T0, 5) } }), SLIDE_HOLD_MS.terminals).slide).toBeNull();
    expect(poll(story("trivia_2", T0, 5), T0 + SLIDE_HOLD_MS.terminals - 1_000).slide?.value).toBe("trivia_2"); // still polling
    const late = state({ now: T0 + SLIDE_HOLD_MS.terminals, receivedAt: T0 + SLIDE_HOLD_MS.terminals, program: { slide: clip("hamster_dance", T0 + SLIDE_HOLD_MS.terminals, 6) } });
    expect(at(late, 0).slide?.value).toBe("hamster_dance");
    resetScreenMemo();
    at(state({ program: { slide: { ...shot("trabolta_online", T0, 5, "terminals"), kind: "base", persist: false } } }), 0);
    expect(at(state({ program: { slide: clip("youve_got_mail", T0, 6) } }), 0).slide?.value).toBe("youve_got_mail");
    // A story slide cued after the clip replaces it as usual.
    expect(at(state({ program: { slide: story("truther", T0 + 1, 7) } }), 0).slide?.value).toBe("truther");
  });

  // Issue 10: a terminal that boots mid-clip must not show the clip over a held story slide.
  function fakeStorage(): Storage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      key: (i: number) => [...data.keys()][i] ?? null,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  }

  it("the memo is not written on every poll: only a new slide, a new sim or a seenAt that moved half a gap (OB-11)", () => {
    const disk = fakeStorage();
    let writes = 0;
    const counted = { ...disk, setItem: (k: string, v: string) => (writes++, disk.setItem(k, v)) } as Storage;
    setScreenMemoStorage(counted);
    resetScreenMemo();
    const poll = (dt: number, seq = 5) => at(state({ announceEpoch: "e1", now: T0 + dt, receivedAt: T0 + dt, program: { slide: story("trivia_2", T0, seq) } }), 0);
    for (let i = 0; i < 10; i++) poll(i * 2000);
    // 0–18 s at 2 s: written once, then once more each half gap (7.5 s) the seenAt moved.
    expect(writes).toBeLessThanOrEqual(3);
    const before = writes;
    poll(18_500, 6); // a new story slide
    expect(writes).toBe(before + 1);
    poll(18_500 + 8_000, 6); // 8 s later
    expect(writes).toBe(before + 2);
    setScreenMemoStorage(null);
  });

  it("a reload mid-clip keeps the story slide on top: the memo is stored per sim", () => {
    const disk = fakeStorage();
    setScreenMemoStorage(disk);
    resetScreenMemo();
    expect(at(state({ announceEpoch: "e1", program: { slide: story("trivia_2", T0, 5) } }), 0).slide?.value).toBe("trivia_2");
    // The page reloads (memory gone, storage kept); its first answer is the clip.
    setScreenMemoStorage(disk);
    const after = state({ announceEpoch: "e1", now: T0 + 10_000, receivedAt: T0 + 10_000, program: { slide: clip("dancing_baby", T0 + 10_000, 6) } });
    expect(at(after, 0).slide).toEqual({ value: "trivia_2", cue: "screens_trivia_2", seq: 5, at: T0 });
    expect(at(after, SLIDE_HOLD_MS.terminals - 10_000).slide?.value).toBe("dancing_baby");
    // Another sim (a restart) never reads the old one's story slide.
    setScreenMemoStorage(disk);
    const restarted = state({ announceEpoch: "e2", now: T0 + 10_000, receivedAt: T0 + 10_000, program: { slide: clip("dancing_baby", T0 + 10_000, 2) } });
    expect(at(restarted, 0).slide).toBeNull();
    setScreenMemoStorage(null);
  });

  it("a memo from before the page went dark is no memo: a clip cued while it was off waits like a first boot", () => {
    const disk = fakeStorage();
    setScreenMemoStorage(disk);
    resetScreenMemo();
    // The tablet saw trivia_1, then was off for ten minutes.
    expect(at(state({ announceEpoch: "e1", program: { slide: story("trivia_1", T0, 5) } }), 0).slide?.value).toBe("trivia_1");
    // Meanwhile trivia_2 went up (unseen) and a clip after it; the tablet boots mid-clip.
    setScreenMemoStorage(disk);
    const off = T0 + 600_000;
    const boot = state({ announceEpoch: "e1", now: off + 10_000, receivedAt: off + 10_000, program: { slide: clip("dancing_baby", off + 5_000, 8) } });
    expect(at(boot, 0).slide).toBeNull(); // not the clip: trivia_2 may be held under it
    // A page that watched the clip go up (polling) keeps playing it after a reload.
    setScreenMemoStorage(disk);
    resetScreenMemo();
    expect(at(state({ announceEpoch: "e1", program: { slide: story("trivia_1", T0, 5) } }), SLIDE_HOLD_MS.terminals).slide).toBeNull();
    const t1 = T0 + SLIDE_HOLD_MS.terminals + 1_000;
    expect(poll(story("trivia_1", T0, 5), t1 - 2_000, "e1").slide?.value).toBe("trivia_1"); // still polling
    const live = state({ announceEpoch: "e1", now: t1, receivedAt: t1, program: { slide: clip("hamster_dance", t1, 9) } });
    expect(at(live, 0).slide?.value).toBe("hamster_dance");
    setScreenMemoStorage(disk); // reload
    const again = state({ announceEpoch: "e1", now: t1 + 4_000, receivedAt: t1 + 4_000, program: { slide: clip("hamster_dance", t1, 9) } });
    expect(at(again, 0).slide?.value).toBe("hamster_dance");
    setScreenMemoStorage(null);
  });

  it("a first boot mid-clip shows no clip until a story slide under it would have lapsed", () => {
    setScreenMemoStorage(null);
    resetScreenMemo();
    const boot = state({ now: T0 + 10_000, receivedAt: T0 + 10_000, program: { slide: clip("under_construction", T0, 6) } });
    expect(at(boot, 0).slide).toBeNull(); // not the clip: a story slide may be held under it
    expect(at(boot, SLIDE_HOLD_MS.terminals - 10_000).slide).toBeNull(); // the clip's own hold is over too
    // A clip from history (a restart's replay) was never held: nothing changes.
    resetScreenMemo();
    expect(at(state({ program: { slide: clip("hamster_dance", 0, 6) } }), 0).slide).toBeNull();
    // Later, a new clip in a quiet stretch plays as usual.
    const later = T0 + SLIDE_HOLD_MS.terminals;
    expect(poll(clip("hamster_dance", 0, 6), later - 2_000).slide).toBeNull(); // still polling
    expect(at(state({ now: later, receivedAt: later, program: { slide: clip("youve_got_mail", later, 7) } }), 0).slide?.value).toBe("youve_got_mail");
    // Storage that throws never breaks the layer.
    setScreenMemoStorage({
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    expect(at(state({ program: { slide: story("trivia_2", T0, 5) } }), 0).slide?.value).toBe("trivia_2");
    setScreenMemoStorage(null);
  });
});

describe("the live Trust Chart", () => {
  const chart = { slide: "trust_chart", rows: [{ name: "Calculator", value: 30 }, { name: "Winamp", value: 10 }, { name: "VLC", value: 10 }, { name: "MS Paint", value: -5 }], top: null, bottom: null, revealAt: 0 };

  it("rides the trust_chart slide only, and ranks ties together", () => {
    const up = state({ chart, program: { slide: slide("trust_chart", T0, true) } });
    expect(at(up, 60_000).chart).toBe(chart);
    expect(at(state({ chart, program: { slide: slide("bingo", T0, true) } }), 0).chart).toBeNull();
    expect(at(state({ chart, program: { slide: slide("trust_chart", T0, true), overlay: shot("alarm", T0, 2) } }), 0).chart).toBeNull();
    expect(chartLines(chart).map((r) => `${r.rank}:${r.name}:${r.value}`)).toEqual(["1:Calculator:30", "2:Winamp:10", "2:VLC:10", "4:MS Paint:-5"]);
  });

  it("parses off the wire; junk rows drop, a junk chart is null", () => {
    const s = parseScreenState({ attract: false, chart: { slide: "trust_chart", rows: [{ name: "A", value: 3 }, { name: 4 }, null, { name: "B", value: "x" }] } });
    // An older (w3) server sends no call-outs and no reveal time: nobody called out, every row up.
    expect(s?.chart).toEqual({ slide: "trust_chart", rows: [{ name: "A", value: 3, staff: false }], top: null, bottom: null, revealAt: 0 });
    expect(parseScreenState({ attract: false, chart: "nope" })?.chart).toBeNull();
    expect(parseScreenState({ attract: false })?.chart).toBeNull();
    const now = parseScreenState({ attract: false, chart: { slide: "trust_chart", rows: [], top: "A", bottom: "B", revealAt: 123 } })?.chart;
    expect(now).toMatchObject({ top: "A", bottom: "B", revealAt: 123 });
    expect(parseScreenState({ attract: false, chart: { slide: "trust_chart", rows: [], top: 4, bottom: "", revealAt: "x" } })?.chart).toMatchObject({ top: null, bottom: null, revealAt: 0 });
  });

  it("marks staff rows (wave 21): staff: true only, ranked with the programs", () => {
    const s = parseScreenState({ attract: false, chart: { slide: "trust_chart", rows: [{ name: "Clippy", value: 40, staff: true }, { name: "Winamp", value: 40 }, { name: "Norton Anti-Virus", value: 5, staff: "yes" }, { name: "Excel", value: -2, staff: false }] } });
    expect(s?.chart?.rows.map((r) => r.staff)).toEqual([true, false, false, false]);
    const lines = chartLines(s!.chart!);
    expect(lines.map((r) => `${r.rank}:${r.name}:${r.staff ? "staff" : "-"}`)).toEqual(["1:Clippy:staff", "1:Winamp:-", "3:Norton Anti-Virus:-", "4:Excel:-"]);
    expect(chartRankedLine(s!.chart!)).toBe("3 programs and 1 staff ranked.");
    expect(chartRankedLine(chart)).toBe("4 programs ranked.");
    expect(chartRankedLine({ ...chart, rows: [{ name: "A", value: 1 }] })).toBe("1 program ranked.");
  });

  it("draws a staff row with its tag on the chart slide", () => {
    const html = renderToStaticMarkup(createElement(SlideView, { slide: { value: "trust_chart", cue: "screens_trust_chart" }, y2k: null, chart: { ...chart, rows: [{ name: "Clippy", value: 50, staff: true }, ...chart.rows] } }));
    expect(html).toMatch(/chart-row[^"]*chart-staff[^>]*>.*?Clippy.*?🛡 STAFF/su);
    expect(html.match(/chart-staff-tag/gu)?.length).toBe(1);
  });

  it("reveals bottom-up, one row every step, from the server's revealAt", () => {
    expect(chartReveal(4, T0, T0)).toBe(1); // the bottom row with the slide
    expect(chartReveal(4, T0, T0 + CHART_STEP_MS - 1)).toBe(1);
    expect(chartReveal(4, T0, T0 + CHART_STEP_MS)).toBe(2);
    expect(chartReveal(4, T0, T0 + 4 * CHART_STEP_MS)).toBe(4); // all rows after n × step
    expect(chartReveal(4, T0, T0 + 60_000)).toBe(4);
    expect(chartReveal(4, T0, T0 - 5_000)).toBe(1); // a server clock behind revealAt never shows less
    expect(chartReveal(4, 0, T0)).toBe(4); // history: everything at once
    expect(chartReveal(0, T0, T0)).toBe(0);
  });

  it("the layer counts the reveal on the server's clock, not the tablet's", () => {
    // The answer arrived when the server said T0 + 1 s; the slide went up at T0.
    const up = state({ now: T0 + 1_000, receivedAt: 50, chart: { ...chart, revealAt: T0 }, program: { slide: slide("trust_chart", T0, true) } });
    expect(screenLayers(up, 50, { piloting: false }).chartShown).toBe(1);
    expect(screenLayers(up, 50 + 2 * CHART_STEP_MS, { piloting: false }).chartShown).toBe(3);
    expect(at(state({ chart, program: { slide: slide("trust_chart", T0, true) } }), 0).chartShown).toBe(4); // revealAt 0
  });

  it("names the call-outs per chart", () => {
    expect(chartCallouts("trust_chart")).toEqual({ top: "MOST TRUSTED", bottom: "LEAST TRUSTED" });
    expect(chartCallouts("other")).toEqual({ top: "TOP", bottom: "BOTTOM" });
  });
});

describe("screen layers — parsing the wire", () => {
  it("reads the program and target, tolerating junk", () => {
    const s = parseScreenState(
      {
        attract: true,
        now: 5,
        target: "tv",
        program: { slide: { value: "bingo", cue: "tv_bingo", seq: 3, at: 4, kind: "slide", persist: true }, overlay: { value: 1 }, blackout: null, flicker: "x" },
      },
      9,
    );
    expect(s).toMatchObject({ receivedAt: 9, target: "tv", program: { slide: { cue: "tv_bingo", persist: true, kind: "slide" }, overlay: null, flicker: null } });
    expect(parseScreenState({ attract: false })?.program).toEqual(empty);
    expect(parseScreenState({ attract: false })?.target).toBe("terminals");
  });
});

describe("slides", () => {
  it("looks for the PNG under the cue's name, then its value; never a path", () => {
    expect(slideSources({ value: "trivia_1", cue: "screens_trivia_1" }, "/terminal/")).toEqual(["/terminal/slides/screens_trivia_1.png", "/terminal/slides/trivia_1.png"]);
    expect(slideSources({ value: "../x", cue: "screens_../x" }, "/t/")).toEqual([]);
    // N-04a: the TV tries the same names as clips first.
    expect(slideVideoSources({ value: "ad_hijack", cue: "screens_ad_hijack" }, "/terminal/")).toEqual(["/terminal/slides/screens_ad_hijack.mp4", "/terminal/slides/ad_hijack.mp4"]);
    expect(slideVideoSources({ value: "../x", cue: "screens_../x" }, "/t/")).toEqual([]);
    expect(slideVideoSources({ value: "x", cue: "x" }, "/t/")).toEqual(["/t/slides/x.mp4"]);
  });

  it("a missing PNG still has a card: known copy, else the value made readable", () => {
    expect(slideCopy("bingo").title).toBe("COMPUTER BINGO");
    expect(slideCopy("award_best_liar")).toEqual({ title: "AWARD BEST LIAR" });
  });

  it("slides that can show before the introduction never name the character, but as the owner (D19)", () => {
    for (const v of ["call_desktop", "bingo", "bingo_time", "screensaver"]) {
      const c = slideCopy(v);
      // An owner slide may carry only the owner's third-person lines.
      const rest = c.owner === true ? { ...c, lines: (c.lines ?? []).filter((l) => !OWNER_LINES.includes(l)) } : c;
      expect(JSON.stringify(rest), v).not.toMatch(/trabolta/iu);
    }
    for (const l of OWNER_LINES) expect(l).toMatch(/^Jean Trabolta .*digital conference/u);
    expect(slideCopy("bingo").lines).toContain(OWNER_LINE);
    // R14: the bingo slide no longer asks for no names.
    expect(JSON.stringify(slideCopy("bingo"))).not.toMatch(/write names|memory/iu);
  });

  it("the trivia slides ask exactly the Quest Log's questions", () => {
    // The hunt quests are generated from facts.json (wave 4): generated/questions.loom, not quests.loom.
    const quests = readFileSync(fileURLToPath(new URL("../../core/examples/trapped-in-the-internet/generated/questions.loom", import.meta.url)), "utf8");
    for (const v of ["trivia_1", "trivia_2"]) {
      const lines = SLIDE_COPY[v]!.lines!;
      expect(lines).toHaveLength(3);
      for (const l of lines) expect(quests).toContain(`- ${l}`);
    }
  });

  it("every clip Trabolta can put on the wall terminals has its own card (fact M19)", () => {
    const trabolta = readFileSync(fileURLToPath(new URL("../../core/examples/trapped-in-the-internet/cast/trabolta.loom", import.meta.url)), "utf8");
    const clips = [...trabolta.matchAll(/^\s*cue terminals_(\w+)\s*$/gmu)].map((m) => m[1]!);
    expect(clips).toEqual(["dancing_baby", "hamster_dance", "under_construction", "youve_got_mail"]);
    for (const c of clips) {
      expect(SLIDE_COPY[c], c).toBeDefined();
      expect(SLIDE_COPY[c]!.lines?.length).toBeGreaterThan(0);
    }
  });

  it("formats the corner and the Y2K clock", () => {
    expect(formatCountdown(900)).toBe("15:00");
    expect(formatCountdown(59)).toBe("00:59");
    expect(formatCountdown(3725)).toBe("1:02:05");
    expect(y2kClock(3600)).toEqual({ time: "11:00:00 PM", date: "12/31/1999" });
    expect(y2kClock(61)).toEqual({ time: "11:58:59 PM", date: "12/31/1999" });
    expect(y2kClock(0)).toEqual({ time: "12:00:00 AM", date: "1/1/1900" });
    expect(y2kClock(null).date).toBe("1/1/1900");
  });
});

describe("the TV's clip (N-04a) is inert without an mp4", () => {
  it("the still (PNG / card) renders at once; the clip waits hidden on top until it has a frame", () => {
    const html = renderToStaticMarkup(createElement(SlideView, { slide: { value: "trivia_1", cue: "screens_trivia_1" }, y2k: null, video: true }));
    expect(html).toContain('class="slide-image"');
    expect(html).toContain("screens_trivia_1.png");
    expect(html).toMatch(/class="screen-slide clip-waiting"[^>]*data-video=""/u);
    expect(html.indexOf("slide-image")).toBeLessThan(html.indexOf("slide-video")); // the clip is drawn over the still
    // A terminal (no video) never mounts a clip.
    expect(renderToStaticMarkup(createElement(SlideView, { slide: { value: "trivia_1", cue: "screens_trivia_1" }, y2k: null }))).not.toContain("slide-video");
  });
});

describe("the identify overlay", () => {
  it("renders nothing off a stale answer older than its time left", () => {
    const props = { name: "Kitchen", spot: "start-bar", view: "auto" };
    const live = state({ identify: true, identifyLeft: 10_000, receivedAt: Date.now() });
    expect(renderToStaticMarkup(createElement(IdentifyOverlay, { state: live, ...props }))).toContain("KITCHEN");
    const stale = state({ identify: true, identifyLeft: 10_000, receivedAt: Date.now() - 10_001 });
    expect(renderToStaticMarkup(createElement(IdentifyOverlay, { state: stale, ...props }))).toBe("");
  });
});

describe("the glitch takeover (wave 26, T2)", () => {
  const glitchAt = (at: number, seq = 9) => ({ glitch: shot("glitch", at, seq) });
  const seen = (over: Parameters<typeof state>[0] = {}) => state({ firstNow: T0 - 60_000, ...over });

  it("plays while its cue is fresh, for GLITCH_MS, from its own at", () => {
    const s = seen({ program: glitchAt(T0) });
    expect(at(s, 0).glitch).toEqual({ seq: 9, at: T0, t: 0, text: GLITCH_TEXT });
    expect(at(s, 2500).glitch).toEqual({ seq: 9, at: T0, t: 2500, text: GLITCH_TEXT });
    expect(at(s, GLITCH_MS - 1).glitch).not.toBeNull();
    expect(at(s, GLITCH_MS).glitch).toBeNull();
    expect(GLITCH_MS).toBe(8000);
  });

  it("never plays history (at 0), nor one cued at or before this page's first answer (a reload mid-glitch)", () => {
    expect(at(seen({ program: glitchAt(0) }), 0).glitch).toBeNull();
    // The page's first answer came 1 s after the cue: shared state, live at, but never seen happen.
    expect(at(state({ firstNow: T0 + 1000, program: glitchAt(T0) }), 2000).glitch).toBeNull();
    expect(at(state({ firstNow: T0, program: glitchAt(T0) }), 0).glitch).toBeNull();
    // Cued after the first answer: it plays.
    expect(at(state({ firstNow: T0 - 1, program: glitchAt(T0) }), 0).glitch).not.toBeNull();
    // An old server (no glitch on the program): nothing.
    expect(at(seen(), 0).glitch).toBeNull();
  });

  it("reaches every view, piloting, peeking, bare or a kiosk; only a blackout beats it", () => {
    const s = seen({ program: { ...glitchAt(T0), slide: slide("ad_hijack", T0, true) } });
    for (const o of [{ piloting: true }, { piloting: false, peek: true }, { piloting: false, room: true }, { piloting: false, slides: false }]) {
      expect(screenLayers(s, T0 + 100, o).glitch, JSON.stringify(o)).not.toBeNull();
    }
    expect(screenLayers(seen({ target: "tv", program: glitchAt(T0) }), T0 + 100, { piloting: false }).glitch).not.toBeNull();
    // An alarm overlay does not beat it; a fresh blackout does.
    expect(at(seen({ program: { ...glitchAt(T0), overlay: shot("alarm", T0) } }), 100).glitch).not.toBeNull();
    expect(at(seen({ program: { ...glitchAt(T0), blackout: shot("blackout", T0) } }), 100).glitch).toBeNull();
  });

  it("is never a slide: the hijack slide under it keeps its place, and persists", () => {
    const s = seen({ program: { ...glitchAt(T0), slide: slide("ad_hijack", T0, true) } });
    expect(at(s, 100)).toMatchObject({ slide: { value: "ad_hijack" }, overlay: null });
    // Persistent now (the server's `persist`): still up long after the 45 s hold.
    expect(at(s, 10 * 60_000).slide?.value).toBe("ad_hijack");
    expect(GLITCH_TEXT).toBe(SLIDE_COPY.ad_hijack!.title);
  });

  it("a slide cued with it starts its scene's clock when the takeover ends (the hijack's slam is never hidden under it)", () => {
    // The 📺 rule: screens_glitch, then screens_ad_hijack, one tick apart.
    const s = seen({ program: { ...glitchAt(T0), slide: slide("ad_hijack", T0 + 1, true) } });
    expect(at(s, 100).slide).toMatchObject({ value: "ad_hijack", seq: 1, at: T0 + GLITCH_MS });
    // Still so once the glitch is over (the clock never jumps back), and on a page that never drew it.
    expect(at(s, GLITCH_MS + 2000).slide?.at).toBe(T0 + GLITCH_MS);
    expect(at({ ...s, firstNow: T0 + 3000 }, 3500)).toMatchObject({ glitch: null, slide: { at: T0 + GLITCH_MS } });
    // Its hold still counts from the cue (a non-persistent slide lapses on time).
    const plain = seen({ program: { ...glitchAt(T0), slide: slide("trivia_2", T0) } });
    expect(at(plain, SLIDE_HOLD_MS.terminals - 1).slide?.at).toBe(T0 + GLITCH_MS);
    expect(at(plain, SLIDE_HOLD_MS.terminals).slide).toBeNull();
    // The pure rule: cued with it (a tick before counts), or under it.
    expect(slideClockAt(T0, { at: T0 })).toBe(T0 + GLITCH_MS);
    expect(slideClockAt(T0 - GLITCH_WITH_MS, { at: T0 })).toBe(T0 + GLITCH_MS);
    expect(slideClockAt(T0 + GLITCH_MS - 1, { at: T0 })).toBe(T0 + GLITCH_MS);
    // A slide from before it, or after it, or history, or no glitch: its own at.
    expect(slideClockAt(T0 - GLITCH_WITH_MS - 1, { at: T0 })).toBe(T0 - GLITCH_WITH_MS - 1);
    expect(slideClockAt(T0 + GLITCH_MS, { at: T0 })).toBe(T0 + GLITCH_MS);
    expect(slideClockAt(T0 + 60_000, { at: T0 })).toBe(T0 + 60_000);
    expect(slideClockAt(0, { at: T0 })).toBe(0);
    expect(slideClockAt(T0, { at: 0 })).toBe(T0);
    expect(slideClockAt(T0, null)).toBe(T0);
  });

  it("covers the screen (the idle show pauses) but is never a takeover (a pilot, a game, a walk survive)", () => {
    const g = at(seen({ program: glitchAt(T0) }), 100);
    expect(coverOf(g)).toEqual({ takeover: false, covered: true });
    expect(coverOf(at(seen({ program: { overlay: shot("alarm", T0) } }), 100))).toEqual({ takeover: true, covered: true });
    expect(coverOf(at(seen(), 100))).toEqual({ takeover: false, covered: false });
  });

  it("stamps the page's first answer once (withFirstNow)", () => {
    resetPageFirst();
    const a = withFirstNow(state({ now: 5000 }));
    const b = withFirstNow(state({ now: 9000 }));
    expect(a.firstNow).toBe(5000);
    expect(b.firstNow).toBe(5000);
    resetPageFirst();
  });

  it("never plays the tail of one this page missed: first seen later than GLITCH_FRESH_MS after its cue (a lost server, back mid-takeover)", () => {
    expect(GLITCH_FRESH_MS).toBe(4000);
    // Seen one poll after the cue: plays.
    expect(at(seen({ glitchSeen: T0 + 1800, program: glitchAt(T0) }), 2000).glitch).not.toBeNull();
    expect(at(seen({ glitchSeen: T0 + GLITCH_FRESH_MS, program: glitchAt(T0) }), GLITCH_FRESH_MS).glitch).not.toBeNull();
    // First seen 5 s in (the page was cut off around the cue): never, not even its last 3 s.
    expect(at(seen({ glitchSeen: T0 + 5000, program: glitchAt(T0) }), 5000).glitch).toBeNull();
    expect(at(seen({ glitchSeen: T0 + 5000, program: glitchAt(T0) }), 6500).glitch).toBeNull();
  });

  it("remembers when this page first saw each glitch cue (withFirstNow), and only while one is live", () => {
    resetPageFirst();
    const g = (now: number, at: number, seq = 9) => withFirstNow(state({ now, program: glitchAt(at, seq) }));
    expect(withFirstNow(state({ now: T0 - 4000 })).glitchSeen).toBeUndefined();
    expect(g(T0 + 1500, T0).glitchSeen).toBe(T0 + 1500);
    // Later answers keep the first sighting.
    expect(g(T0 + 3500, T0).glitchSeen).toBe(T0 + 1500);
    // A new cue (a new seq) is a new sighting.
    expect(g(T0 + 60_000, T0 + 59_000, 10).glitchSeen).toBe(T0 + 60_000);
    // History (at 0) carries none.
    expect(g(T0 + 90_000, 0, 10).glitchSeen).toBeUndefined();
    // A page cut off around the cue: its first sighting is late, so it never plays.
    resetPageFirst();
    withFirstNow(state({ now: T0 - 10_000 }));
    const late = g(T0 + 5000, T0);
    expect(late.glitchSeen).toBe(T0 + 5000);
    expect(screenLayers(late, T0, { piloting: false }).glitch).toBeNull(); // (received at T0: server now = its now)
    // A page that saw it at once plays it.
    resetPageFirst();
    withFirstNow(state({ now: T0 - 10_000 }));
    const prompt = g(T0 + 1200, T0);
    expect(screenLayers(prompt, T0, { piloting: false }).glitch).toMatchObject({ seq: 9, t: 1200 });
    resetPageFirst();
  });

  it("draws CSS-only: the zeroes in the error windows, one takeover per seq, the ⚙ over it", () => {
    const layers = { ...at(seen({ program: glitchAt(T0) }), 1200) };
    const html = renderToStaticMarkup(createElement(ScreenLayer, { layers, gear: createElement("i", { id: "gear" }) }));
    expect(html).toContain('class="screen-glitch"');
    expect(html).toContain('data-glitch="9"');
    expect(html).toContain(GLITCH_TEXT);
    expect(html).toContain('id="gear"');
    expect(html).not.toMatch(/<canvas|<video|<img/u);
    // Drawn late (a poll after the cue): its beats start that far along.
    expect(html).toContain("animation-delay:-1200ms");
    const none = renderToStaticMarkup(createElement(ScreenLayer, { layers: at(seen(), 0), gear: null }));
    expect(none).not.toContain("screen-glitch");
  });

  it("unmounts itself when it ends (no invisible layer taking taps until the next re-decide)", () => {
    expect(glitchLeftMs(0)).toBe(GLITCH_MS);
    expect(glitchLeftMs(1200)).toBe(GLITCH_MS - 1200);
    expect(glitchLeftMs(GLITCH_MS + 50)).toBe(0);
    const src = readFileSync(fileURLToPath(new URL("../src/ScreenLayer.tsx", import.meta.url)), "utf8");
    const fn = src.slice(src.indexOf("export function GlitchTakeover"), src.indexOf("export function ScreenLayer"));
    expect(fn).toMatch(/window\.setTimeout\(\(\) => setOver\(true\), glitchLeftMs\(t0\)\)/u);
    expect(fn).toMatch(/if \(over\) return null;/u);
  });

  it("schedules its sounds once per cue per page, so a remount mid-takeover never doubles them", () => {
    resetGlitchSounds();
    expect(claimGlitchSounds(9, T0)).toBe(true);
    expect(claimGlitchSounds(9, T0)).toBe(false);
    // Another cue (a new seq, or a restarted story's same seq at a new time) sounds again.
    expect(claimGlitchSounds(10, T0 + 60_000)).toBe(true);
    expect(claimGlitchSounds(9, T0 + 90_000)).toBe(true);
    resetGlitchSounds();
    const src = readFileSync(fileURLToPath(new URL("../src/ScreenLayer.tsx", import.meta.url)), "utf8");
    expect(src).toMatch(/if \(!claimGlitchSounds\(seq, cueAt\)\) return;/u);
    // And the app keeps the layer at one keyed place in every screen it sits beside.
    const app = readFileSync(fileURLToPath(new URL("../src/app.tsx", import.meta.url)), "utf8");
    expect(app).toMatch(/const layer = \(\n {4}<Fragment key="screen-layer">/u);
  });

  it("its CSS stays inside the photosensitivity and old-tablet rules", () => {
    const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
    const block = css.slice(css.indexOf("/* --- the glitch takeover"), css.indexOf("/* --- the house announcement"));
    expect(block.length).toBeGreaterThan(500);
    // Keyframes animate transform / opacity only.
    const bodies = [...block.matchAll(/^@keyframes [\w-]+ \{ (.*) \}$/gmu), ...block.matchAll(/^@keyframes [\w-]+ \{\n([\s\S]*?)\n\}/gmu)].map((m) => m[1]!);
    expect(bodies.length).toBeGreaterThanOrEqual(9);
    for (const body of bodies) for (const prop of body.matchAll(/([a-z-]+):/gu)) expect(["transform", "opacity"], prop[1]).toContain(prop[1]);
    // No red field, no blend modes or filters, no inset shorthand (Safari 14.0).
    expect(block).not.toMatch(/background:\s*(red|#f00\b|#ff0000)/iu);
    expect(block).not.toMatch(/mix-blend-mode|filter:|backdrop-filter|\binset:/u);
    // Reduced motion: no animation at all.
    expect(block).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.screen-glitch, \.screen-glitch \* \{ animation: none !important; \}/u);
    // Nothing repeats faster than 3 Hz: every step animation's cycle / steps ≥ 333 ms.
    for (const m of block.matchAll(/animation: [\w-]+ ([\d.]+)s steps\((\d+), end\) ([\d.]+|infinite)/gu)) {
      const repeats = m[3] !== "1";
      if (repeats) expect((Number(m[1]) * 1000) / Number(m[2]), m[0]).toBeGreaterThanOrEqual(333);
    }
  });
});
