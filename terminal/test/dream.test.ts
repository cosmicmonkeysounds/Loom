import { describe, expect, it } from "vitest";
import { DREAM_TAKE_MS, dreamKeyOf, dreamPhase, dreamSrc, moshMode, type MoshAsk } from "../src/dream/dream.ts";
import { DREAM_FRESH, DREAM_FRAME_TRIES, DREAM_VIDEO_TRIES, dreamHealthAfter, type DreamEvent, type DreamHealth } from "../src/dream/player.ts";
import { DREAM_BUG_LINE, DREAM_BUG_MS, RoomSpeech, speechQuery } from "../src/speech/said.ts";
import { splitSentences } from "../src/speech/split.ts";
import { dreamOf } from "../src/screen.ts";
import { coverOf } from "../src/slides.ts";

const on = { dream: { at: 10_000 } };

describe("dreamPhase", () => {
  it("is off with no dream, from an older server too", () => {
    expect(dreamPhase({ dream: null }, 5, true)).toBe("off");
    expect(dreamPhase({}, 5, true)).toBe("off");
    expect(dreamPhase(null, 5, true)).toBe("off");
  });
  it("waits, armed, until the moment: the video readies ahead of it", () => {
    expect(dreamPhase(on, 9_999, true)).toBe("armed");
  });
  it("takes over at the moment, on every screen alike, then stays through", () => {
    expect(dreamPhase(on, 10_000, true)).toBe("take");
    expect(dreamPhase(on, 10_000 + DREAM_TAKE_MS - 1, true)).toBe("take");
    expect(dreamPhase(on, 10_000 + DREAM_TAKE_MS, true)).toBe("through");
  });
  it("skips the takeover for a dream that began before this boot", () => {
    expect(dreamPhase({ dream: { at: 0 } }, 50, true)).toBe("through");
  });
  it("never leaves armed on a terminal with no picture: it keeps its idle show", () => {
    expect(dreamPhase(on, 99_000, false)).toBe("armed");
  });
});

describe("what gets through (the priority queue)", () => {
  const ask = (o: Partial<MoshAsk> = {}): MoshAsk => ({ phase: "through", overlay: null, slide: null, glitch: false, burst: false, moment: false, announcing: false, speaking: false, busy: false, reduced: false, ...o });
  it("the dream alone is not moshed, nor the y2k clock floating on it", () => {
    expect(moshMode(ask())).toBeNull();
    expect(moshMode(ask({ slide: "y2k" }))).toBeNull();
  });
  it("cutscenes, slides, announcements, glitches, bursts and his face get through moshed", () => {
    for (const o of [{ moment: true }, { slide: "bobbing" }, { announcing: true }, { glitch: true }, { burst: true }, { speaking: true }, { overlay: "alarm" }]) expect(moshMode(ask(o))).toBe("rot");
  });
  it("a moment over the y2k clock is moshed", () => {
    expect(moshMode(ask({ slide: "y2k", moment: true }))).toBe("rot");
  });
  it("a blackout stays true black", () => {
    expect(moshMode(ask({ overlay: "blackout", moment: true }))).toBeNull();
    expect(moshMode(ask({ phase: "take", overlay: "blackout" }))).toBeNull();
  });
  it("never moshes a screen someone is using, but an overlay has already stopped it", () => {
    expect(moshMode(ask({ busy: true, moment: true }))).toBeNull();
    expect(moshMode(ask({ busy: true, announcing: true }))).toBeNull();
    expect(moshMode(ask({ busy: true, overlay: "alarm" }))).toBe("rot");
    expect(moshMode(ask({ phase: "take", busy: true }))).toBeNull();
  });
  it("the takeover is its own mode; reduced motion takes the cut", () => {
    expect(moshMode(ask({ phase: "take" }))).toBe("take");
    expect(moshMode(ask({ phase: "take", reduced: true }))).toBeNull();
  });
  it("nothing moshes before the dream is through", () => {
    expect(moshMode(ask({ phase: "armed", moment: true }))).toBeNull();
    expect(moshMode(ask({ phase: "off", moment: true }))).toBeNull();
  });
});

describe("the y2k slide and the idle show under it", () => {
  const slide = { value: "y2k", cue: "screens_y2k", seq: 1, at: 1 };
  it("stops covering the screen once the dream is up, so the dream is seen all hour", () => {
    expect(coverOf({ overlay: null, slide, glitch: null, dream: "through" }).covered).toBe(false);
    expect(coverOf({ overlay: null, slide, glitch: null, dream: "armed" }).covered).toBe(true);
  });
  it("any other slide still covers", () => {
    expect(coverOf({ overlay: null, slide: { ...slide, value: "bobbing" }, glitch: null, dream: "through" }).covered).toBe(true);
  });
});

describe("the media", () => {
  it("gives the TV the sharper file", () => {
    expect(dreamSrc("tv")).toBe("/media/dream/dream-720.mp4");
    expect(dreamSrc("wall")).toBe("/media/dream/dream-480.mp4");
  });
  it("keys a terminal on its spot (as the server's feed does), else its name", () => {
    expect(dreamKeyOf({ spot: " hall ", name: "x" })).toBe("hall");
    expect(dreamKeyOf({ spot: "", name: " Spare " })).toBe("Spare");
  });
  it("reads the wire's block, and nothing malformed", () => {
    expect(dreamOf({ at: 12 })).toEqual({ at: 12 });
    expect(dreamOf({ at: 0 })).toEqual({ at: 0 });
    for (const bad of [null, undefined, 3, {}, { at: "1" }, { at: -1 }, { at: Number.NaN }]) expect(dreamOf(bad)).toBeNull();
  });
});

describe("the player's health", () => {
  const run = (...events: DreamEvent[]): DreamHealth => events.reduce(dreamHealthAfter, DREAM_FRESH);
  const fails = (e: DreamEvent, n: number): DreamEvent[] => Array.from({ length: n }, () => e);
  it("is ready once the video plays", () => {
    expect(run("playing")).toEqual({ mode: "video", ready: true, videoFails: 0, frameFails: 0 });
  });
  it("retries the video, then falls back to the frames", () => {
    expect(run(...fails("video-failed", DREAM_VIDEO_TRIES - 1)).mode).toBe("video");
    expect(run(...fails("video-failed", DREAM_VIDEO_TRIES)).mode).toBe("frames");
  });
  it("needs a frame on screen to be ready in the fallback", () => {
    const f = fails("video-failed", DREAM_VIDEO_TRIES);
    expect(run(...f).ready).toBe(false);
    expect(run(...f, "frame-ok").ready).toBe(true);
  });
  it("fails for good only when the frames fail too: the old idle show comes back", () => {
    const h = run(...fails("video-failed", DREAM_VIDEO_TRIES), "frame-ok", ...fails("frame-failed", DREAM_FRAME_TRIES));
    expect(h).toMatchObject({ mode: "failed", ready: false });
  });
  it("one good frame clears the misses", () => {
    const h = run(...fails("video-failed", DREAM_VIDEO_TRIES), ...fails("frame-failed", DREAM_FRAME_TRIES - 1), "frame-ok", "frame-failed");
    expect(h).toMatchObject({ mode: "frames", frameFails: 1 });
  });
  it("keeps the frames' picture up while a retry of the video proves itself", () => {
    const h = run(...fails("video-failed", DREAM_VIDEO_TRIES), "frame-ok", "retry");
    expect(h).toMatchObject({ mode: "video", ready: true, videoFails: 0 });
  });
  it("ignores a late frame's load once the video is back", () => {
    const h = run("playing", "frame-ok");
    expect(h.mode).toBe("video");
  });
});

describe("his word (bug=1)", () => {
  it("knows the sentence, and it stays one sentence for the voice", () => {
    const line = "Worst case scenario — we will have to face the Y2K BUG.";
    expect(DREAM_BUG_LINE.test(line)).toBe(true);
    const said = splitSentences(line);
    expect(said).toHaveLength(1); // the lead counts from its start: never a second piece
    expect(DREAM_BUG_LINE.test(said[0]!)).toBe(true);
    expect(DREAM_BUG_LINE.test("Bring me the facts.")).toBe(false);
  });
  it("rides the polls for a moment, then stops, so a story restart never finds it set", () => {
    const s = new RoomSpeech();
    expect(speechQuery(s.report(null, 100))["bug"]).toBeUndefined();
    s.namedBug(100);
    expect(speechQuery(s.report(null, 101))["bug"]).toBe("1");
    expect(speechQuery(s.report(null, 100 + DREAM_BUG_MS))["bug"]).toBeUndefined();
  });
  it("polls at once, like a drain", () => {
    const s = new RoomSpeech();
    let polls = 0;
    s.onDrain(() => void (polls += 1));
    s.namedBug();
    expect(polls).toBe(1);
  });
});
