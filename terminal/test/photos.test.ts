//! The terminals' photos (wave 59p): who shoots, how a still is taken and what it
//! falls back on, and the loop (`runPhotos`): one upload at a time, nothing while
//! hidden, a failure quiet and slow.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseScreenState } from "../src/screen.ts";
import { deviceQuery } from "../src/health.ts";
import { feedWanted, type Picture } from "../src/camfeed.ts";
import { PHOTO_BACKOFF_MS, PHOTO_LOOK_MS, PHOTO_MAX_BYTES, PHOTO_RETRY_RUN, PHOTO_SIZES, PHOTO_SLOW_MS, StillTuner, fitSize, photoPosted, photoTerminal, runPhotos, takeStill, type Draw, type PhotoDeps, type Shot, type StillDeps } from "../src/photos.ts";
import { photoStatus, photoStatusText } from "../src/photo-status.ts";
import { PHOTO_EVERY_MS, PHOTO_REPORTS } from "../../core/src/photos.ts";

describe("who shoots", () => {
  it("is a placed terminal, never the tent or the TV", () => {
    expect(photoTerminal({ spot: "hall", view: "auto" })).toBe(true);
    expect(photoTerminal({ spot: "server-room", view: "face" })).toBe(true);
    expect(photoTerminal({ spot: "server-room-door", view: "chess" })).toBe(true);
    expect(photoTerminal({ spot: "tent", view: "reinstall" })).toBe(false);
    expect(photoTerminal({ spot: "desktop-tv", view: "tv" })).toBe(false);
    expect(photoTerminal({ spot: " ", view: "auto" })).toBe(false);
  });
  it("opens nothing: no acquire, no getUserMedia, nothing in the page, no sound", () => {
    const src = readFileSync(new URL("../src/photos.ts", import.meta.url), "utf8").replace(/^\/\/!.*$/gmu, "");
    expect(src).not.toMatch(/\.acquire\(|getUserMedia|useCamera\b|appendChild|sfx\(|\.speak\(/u);
  });
  it("needs the games' camera setting, the one thing that holds the camera open", () => {
    expect(feedWanted({ spot: "hall", camFeed: false, view: "auto" })).toBe(false);
    expect(feedWanted({ spot: "hall", camFeed: true, view: "auto" })).toBe(true);
  });
});

describe("the wire", () => {
  it("reads the arm off the screen state, off by default", () => {
    const base = { now: 1, night: {}, cues: {}, character: null, attract: false };
    expect(parseScreenState({ ...base, photos: true })?.photos).toBe(true);
    expect(parseScreenState(base)?.photos).toBe(false);
    expect(parseScreenState({ ...base, photos: "yes" })?.photos).toBe(false);
  });
  it("reports on the heartbeat only when there's something to report", () => {
    const h = { audio: null, visible: null, battery: null, charging: null, version: "x" };
    expect(deviceQuery({ ...h, photo: "camera" })["ph"]).toBe("camera");
    expect(deviceQuery({ ...h, photo: null })["ph"]).toBeUndefined();
    expect(deviceQuery(h)["ph"]).toBeUndefined();
  });
  it("has a line in ⚙ for every report, and the store tells once", () => {
    for (const r of PHOTO_REPORTS) expect(photoStatusText(r)).toContain("photos armed");
    let told = 0;
    const off = photoStatus.subscribe(() => told++);
    photoStatus.set("ok");
    photoStatus.set("ok");
    photoStatus.set(null);
    off();
    expect(told).toBe(2);
  });
});

describe("fitSize", () => {
  it("keeps the whole frame and never upscales", () => {
    expect(fitSize(1280, 720, 640, 480)).toEqual({ w: 640, h: 360 });
    expect(fitSize(640, 480, 640, 480)).toEqual({ w: 640, h: 480 });
    expect(fitSize(320, 240, 640, 480)).toEqual({ w: 320, h: 240 });
    expect(fitSize(1920, 1080, 320, 240)).toEqual({ w: 320, h: 180 });
    expect(fitSize(480, 640, 640, 480)).toEqual({ w: 360, h: 480 });
  });
});

const stream = {} as MediaStream;
const pic = (log: string[] = []): Picture => ({ image: {} as CanvasImageSource, w: 1280, h: 720, done: () => log.push("done") });
const GOOD = "A".repeat(4000);
const EMPTY = 1000;
const feedFrame = { jpeg: "FEED", w: 320, h: 240 };

function deps(o: Partial<StillDeps> & { jpeg?: string | null; ms?: number } = {}): StillDeps & { draws: Array<[number, number]>; asked: boolean[] } {
  const draws: Array<[number, number]> = [];
  const asked: boolean[] = [];
  let t = 0;
  const draw: Draw = (_p, w, h) => {
    draws.push([w, h]);
    t += o.ms ?? 10;
    return { jpeg: o.jpeg === undefined ? GOOD : o.jpeg, emptyLength: EMPTY };
  };
  return {
    stream: () => stream,
    picture: (_s, track) => (asked.push(track), pic()),
    draw,
    feedFrame: () => feedFrame,
    clock: () => t,
    draws,
    asked,
    ...o,
  };
}

describe("a still", () => {
  it("is the biggest size, the whole frame, and closes what it drew", async () => {
    const log: string[] = [];
    const d = deps({ picture: () => pic(log) });
    const tuner = new StillTuner(true);
    expect(await takeStill(tuner, d)).toEqual({ kind: "still", still: { jpeg: GOOD, w: 640, h: 360 } });
    expect(tuner.proved).toBe(true);
    expect(log).toEqual(["done"]);
  });
  it("opens nothing: no running camera is no photo", async () => {
    const d = deps({ stream: () => null });
    expect(await takeStill(new StillTuner(true), d)).toEqual({ kind: "camera" });
    expect(d.draws).toEqual([]);
  });
  it("walks from the video to the track to the feed's frame when no frame comes", async () => {
    const tuner = new StillTuner(true);
    const d = deps({ picture: (_s, track) => (d.asked.push(track), null) });
    expect(await takeStill(tuner, d)).toEqual({ kind: "still", still: feedFrame });
    expect(tuner.track).toBe(true);
    await takeStill(tuner, d);
    expect(tuner.feed).toBe(true);
    await takeStill(tuner, d);
    expect(d.asked).toEqual([false, true]);
  });
  it("skips the track where there's no ImageCapture", async () => {
    const tuner = new StillTuner(false);
    await takeStill(tuner, deps({ picture: () => null }));
    expect(tuner.feed).toBe(true);
  });
  it("takes a blank frame on an unproved route for a failure (the Mali-400), and on a proved one for a dark room", async () => {
    const blank = "A".repeat(EMPTY);
    const tuner = new StillTuner(true);
    expect(await takeStill(tuner, deps({ jpeg: blank }))).toEqual({ kind: "still", still: feedFrame });
    expect(tuner.track).toBe(true);
    const proved = new StillTuner(true);
    await takeStill(proved, deps());
    expect(await takeStill(proved, deps({ jpeg: blank }))).toMatchObject({ kind: "still", still: { jpeg: blank } });
  });
  it("says so when there's neither a picture nor a feed frame, and never throws", async () => {
    expect(await takeStill(new StillTuner(true), deps({ picture: () => null, feedFrame: () => null }))).toEqual({ kind: "picture" });
    const thrower: Draw = () => {
      throw new Error("tainted");
    };
    const log: string[] = [];
    expect(await takeStill(new StillTuner(true), deps({ draw: thrower, feedFrame: () => null, picture: () => pic(log) }))).toEqual({ kind: "picture" });
    expect(log).toEqual(["done"]);
  });
  it("drops a size after two slow captures, then settles on the feed's frame, which costs nothing", async () => {
    const tuner = new StillTuner(true);
    const d = deps({ ms: PHOTO_SLOW_MS });
    await takeStill(tuner, d);
    expect(tuner.size).toBe(0);
    await takeStill(tuner, d);
    expect(tuner.size).toBe(1);
    await takeStill(tuner, d);
    await takeStill(tuner, d);
    expect(tuner.feed).toBe(true);
    expect(d.draws.map(([w]) => w)).toEqual([640, 640, 320, 320]);
    expect(await takeStill(tuner, d)).toEqual({ kind: "still", still: feedFrame });
    expect(d.draws.length).toBe(4);
    const quick = new StillTuner(true);
    const q = deps({ ms: PHOTO_SLOW_MS - 1 });
    for (let i = 0; i < 5; i++) await takeStill(quick, q);
    expect(quick.size).toBe(0);
  });
  it("drops a size for a still the server would refuse, and sends the feed's instead", async () => {
    const tuner = new StillTuner(true);
    const big = "A".repeat(Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 8);
    expect(await takeStill(tuner, deps({ jpeg: big }))).toEqual({ kind: "still", still: feedFrame });
    expect(tuner.size).toBe(1);
    expect(PHOTO_SIZES[tuner.size]).toEqual([320, 240]);
  });
  it("tries the top again after a while on the feed's frame", async () => {
    const tuner = new StillTuner(true);
    tuner.failed();
    tuner.failed();
    expect(tuner.feed).toBe(true);
    const d = deps();
    for (let i = 0; i < PHOTO_RETRY_RUN; i++) await takeStill(tuner, d);
    expect(d.draws).toEqual([]);
    expect(tuner.feed).toBe(false);
    expect(await takeStill(tuner, d)).toMatchObject({ still: { jpeg: GOOD } });
  });
});

function loop(o: Partial<PhotoDeps> = {}) {
  const clock = { t: 0 };
  let due: { at: number; fn: () => void } | null = null;
  const reports: string[] = [];
  const posts: number[] = [];
  const d: PhotoDeps = {
    shoot: async () => ({ kind: "still", still: feedFrame }),
    post: async () => {
      posts.push(clock.t);
      return 200;
    },
    hidden: () => false,
    now: () => clock.t,
    setTimer: (fn, ms) => ((due = { at: clock.t + ms, fn }), due),
    clearTimer: () => {
      due = null;
    },
    onReport: (r) => reports.push(r),
    ...o,
  };
  const stop = runPhotos(d);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const step = async () => {
    const t = due;
    if (t === null) return null;
    clock.t = Math.max(clock.t, t.at);
    due = null;
    t.fn();
    await settle();
    return due === null ? null : (due as { at: number }).at - clock.t;
  };
  return { clock, reports, posts, stop, step, pending: () => due !== null };
}

describe("the loop", () => {
  it("shoots at once, then every 15 s", async () => {
    const l = loop();
    expect(await l.step()).toBe(PHOTO_EVERY_MS);
    await l.step();
    await l.step();
    expect(l.posts).toEqual([0, PHOTO_EVERY_MS, 2 * PHOTO_EVERY_MS]);
    expect(l.reports).toEqual(["ok", "ok", "ok"]);
  });
  it("counts the upload's time in the gap, and never runs two at once", async () => {
    const clock = { now: 0 };
    let inFlight = 0;
    let most = 0;
    const l = loop({
      now: () => clock.now,
      post: async () => {
        most = Math.max(most, ++inFlight);
        clock.now += 40_000;
        inFlight--;
        return 200;
      },
    });
    expect(await l.step()).toBe(0);
    expect(most).toBe(1);
  });
  it("takes nothing while the page is hidden, and looks again", async () => {
    let hidden = true;
    let shots = 0;
    const l = loop({
      hidden: () => hidden,
      shoot: async () => (shots++, { kind: "still", still: feedFrame }),
    });
    expect(await l.step()).toBe(PHOTO_LOOK_MS);
    expect(shots).toBe(0);
    expect(l.reports).toEqual(["hidden"]);
    hidden = false;
    await l.step();
    expect(shots).toBe(1);
  });
  it("reports no camera and no picture, and posts nothing", async () => {
    let shot: Shot = { kind: "camera" };
    const l = loop({ shoot: async () => shot });
    expect(await l.step()).toBe(PHOTO_LOOK_MS);
    shot = { kind: "picture" };
    await l.step();
    expect(l.reports).toEqual(["camera", "picture"]);
    expect(l.posts).toEqual([]);
  });
  it("backs off a failed upload, quietly, and carries on", async () => {
    let answer: number | null = null;
    const l = loop({ post: async () => answer });
    expect(await l.step()).toBe(PHOTO_BACKOFF_MS);
    answer = 507;
    expect(await l.step()).toBe(PHOTO_BACKOFF_MS);
    answer = 200;
    expect(await l.step()).toBe(PHOTO_EVERY_MS);
    expect(l.reports).toEqual(["upload", "upload", "ok"]);
  });
  it("survives a throwing post and a throwing shot", async () => {
    const a = loop({
      post: async () => {
        throw new Error("no");
      },
    });
    expect(await a.step()).toBe(PHOTO_BACKOFF_MS);
    const b = loop({
      shoot: async () => {
        throw new Error("no");
      },
    });
    expect(await b.step()).toBe(PHOTO_LOOK_MS);
  });
  it("takes a just-disarmed 409 and a too-soon 429 for no trouble", () => {
    expect(photoPosted(409)).toBe(true);
    expect(photoPosted(429)).toBe(true);
    expect(photoPosted(200)).toBe(true);
    expect(photoPosted(403)).toBe(false);
    expect(photoPosted(404)).toBe(false);
    expect(photoPosted(507)).toBe(false);
    expect(photoPosted(null)).toBe(false);
  });
  it("stops dead at the stopper, even mid-shot", async () => {
    let finish: (s: Shot) => void = () => {};
    const l = loop({ shoot: () => new Promise((r) => (finish = r)) });
    const running = l.step();
    await new Promise((r) => setTimeout(r, 0));
    l.stop();
    finish({ kind: "still", still: feedFrame });
    await running;
    expect(l.posts).toEqual([]);
    expect(l.pending()).toBe(false);
  });
});
