//! Wave 59: the old tablets and the games. The feed's ladder and pace, the
//! heartbeat's link keys and ⚙'s words. Real devices are the other half of
//! this (`docs/help/authoring/48-terminal-setup.md`).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEED_BLANK_RUN, FEED_EVERY_MS, FEED_MISS_RUN, FEED_RETRY_RUN, FEED_SHARE, FEED_SIZES, FEED_SLOW_MS, FEED_SLOW_RUN, FeedTuner, cameraError, feedError, looksBlank, runFeed, type FeedDeps } from "../src/camfeed.ts";
import { constraintsFor, CameraHub } from "../src/camera.ts";
import { ERROR_SHOWN_MS, LinkStats, RATE_WINDOW_MS, RateMeter, linkQuery, linkReadout, linkTroubled } from "../src/link-stats.ts";
import { nextPace, SLOWEST_FRAME_MS } from "../src/raycast/RaycastView.tsx";
import { JSQR_EVERY_MS, scanDelay } from "../src/scanner.tsx";
import { deviceQuery } from "../src/health.ts";
import { sizeCanvas, softwareCanvas } from "../src/software-canvas.ts";
import { LINK_ERRORS, isLinkError } from "../../core/src/link-health.ts";

describe("the feed's tuner", () => {
  it("walks from the video to the track, then to the smallest size, then both, and stops there", () => {
    const t = new FeedTuner(true);
    expect([t.track, t.size]).toEqual([false, 0]);
    for (let i = 0; i < FEED_BLANK_RUN - 1; i++) expect(t.blank()).toBe(false);
    expect(t.blank()).toBe(true);
    expect([t.track, t.size]).toEqual([true, 0]);
    for (let i = 0; i < FEED_MISS_RUN - 1; i++) expect(t.missed()).toBe(false);
    expect(t.missed()).toBe(true);
    expect([t.track, t.size]).toEqual([false, FEED_SIZES.length - 1]);
    for (let i = 0; i < FEED_MISS_RUN; i++) t.missed();
    expect([t.track, t.size]).toEqual([true, FEED_SIZES.length - 1]);
    for (let i = 0; i < FEED_MISS_RUN * 3; i++) t.missed();
    expect([t.track, t.size]).toEqual([true, FEED_SIZES.length - 1]);
  });
  it("goes straight to the smallest size with no ImageCapture", () => {
    const t = new FeedTuner(false);
    for (let i = 0; i < FEED_MISS_RUN; i++) t.missed();
    expect([t.track, t.size]).toEqual([false, FEED_SIZES.length - 1]);
  });
  it("a good frame clears a run", () => {
    const t = new FeedTuner(true);
    for (let i = 0; i < FEED_BLANK_RUN - 1; i++) t.blank();
    t.good();
    expect(t.blank()).toBe(false);
    expect(t.track).toBe(false);
  });
  it("every size is 4:3", () => {
    for (const [fw, fh] of FEED_SIZES) expect(fw / fh).toBeCloseTo(4 / 3);
  });
  it("keeps to its share of the page, and a slow capture drops a size", () => {
    const t = new FeedTuner(true);
    expect(t.gap(FEED_EVERY_MS)).toBe(FEED_EVERY_MS);
    t.took(200);
    expect(t.gap(FEED_EVERY_MS)).toBe(200 / FEED_SHARE);
    for (let i = 0; i < FEED_SLOW_RUN - 1; i++) t.took(FEED_SLOW_MS);
    expect(t.size).toBe(1);
    t.took(1);
    expect(t.size).toBe(1);
  });
  it("calls a frame blank only at an empty canvas's size", () => {
    expect(looksBlank(1000, 1000)).toBe(true);
    expect(looksBlank(1090, 1000)).toBe(true);
    expect(looksBlank(4000, 1000)).toBe(false);
    expect(looksBlank(100, 0)).toBe(false);
  });
});

describe("the feed's tuner comes back up", () => {
  const blanks = (t: FeedTuner, n: number) => {
    for (let i = 0; i < n; i++) t.blank();
  };
  const goods = (t: FeedTuner, n: number) => {
    for (let i = 0; i < n; i++) t.good();
  };
  /** Down to the smallest size on the track, the whole ladder, then a picture. */
  const atBottom = () => {
    const t = new FeedTuner(true);
    blanks(t, FEED_BLANK_RUN * 3);
    expect([t.track, t.size, t.proved]).toEqual([true, FEED_SIZES.length - 1, false]);
    t.good();
    return t;
  };

  it("a route that has shown a picture is proved until it changes", () => {
    const t = new FeedTuner(true);
    expect(t.proved).toBe(false);
    t.good();
    expect(t.proved).toBe(true);
    for (let i = 0; i < FEED_MISS_RUN; i++) t.missed();
    expect([t.track, t.proved]).toEqual([true, false]);
  });
  it("tries the top after a run of good frames, and a good frame there stays", () => {
    const t = atBottom();
    goods(t, FEED_RETRY_RUN - 2);
    expect(t.size).toBe(FEED_SIZES.length - 1);
    t.good();
    expect([t.track, t.size, t.proved]).toEqual([false, 0, false]);
    t.good();
    expect([t.track, t.size, t.proved]).toEqual([false, 0, true]);
    goods(t, FEED_RETRY_RUN * 3);
    expect([t.track, t.size]).toEqual([false, 0]);
    // A later failure starts down the ladder from its first rung.
    for (let i = 0; i < FEED_MISS_RUN; i++) t.missed();
    expect([t.track, t.size]).toEqual([true, 0]);
  });
  it("a try that comes back blank goes straight back, says nothing, and tries again later", () => {
    const t = atBottom();
    goods(t, FEED_RETRY_RUN - 1);
    expect(t.size).toBe(0);
    expect(t.blank()).toBe(false);
    expect([t.track, t.size, t.proved]).toEqual([true, FEED_SIZES.length - 1, true]);
    expect(t.spent).toBe(true);
    goods(t, FEED_RETRY_RUN - 1);
    expect(t.size).toBe(FEED_SIZES.length - 1);
    t.good();
    expect(t.size).toBe(0);
  });
  it("a try with no frame goes straight back too", () => {
    const t = atBottom();
    goods(t, FEED_RETRY_RUN - 1);
    expect(t.missed()).toBe(false);
    expect([t.track, t.size]).toEqual([true, FEED_SIZES.length - 1]);
  });
  it("a slow try goes straight back, with no mark on what a capture costs", () => {
    const t = atBottom();
    t.took(10);
    goods(t, FEED_RETRY_RUN - 1);
    expect(t.size).toBe(0);
    t.took(FEED_SLOW_MS * 5);
    expect(t.size).toBe(FEED_SIZES.length - 1);
    expect(t.costMs).toBe(10);
  });
  it("a size dropped for being slow climbs back too", () => {
    const t = new FeedTuner(true);
    for (let i = 0; i < FEED_SLOW_RUN; i++) t.took(FEED_SLOW_MS);
    expect([t.size, t.proved]).toEqual([1, false]);
    t.good();
    goods(t, FEED_RETRY_RUN - 1);
    t.took(1);
    t.good();
    expect([t.size, t.proved]).toEqual([0, true]);
  });
  it("sits still at the top", () => {
    const t = new FeedTuner(true);
    goods(t, FEED_RETRY_RUN * 3);
    expect([t.track, t.size, t.proved]).toEqual([false, 0, true]);
  });
  it("runs out of ladder only at the bottom: three rungs with the track, one without", () => {
    const t = new FeedTuner(true);
    blanks(t, FEED_BLANK_RUN * 2);
    expect(t.spent).toBe(false);
    blanks(t, FEED_BLANK_RUN);
    expect(t.spent).toBe(true);
    const plain = new FeedTuner(false);
    expect(plain.spent).toBe(false);
    blanks(plain, FEED_BLANK_RUN);
    expect(plain.spent).toBe(true);
  });
});

describe("a canvas kept off the GPU", () => {
  const recorder = () => {
    const log: string[] = [];
    const ctx = {
      fillRect: () => void log.push("fill"),
      getImageData: () => {
        log.push("read");
        return {} as ImageData;
      },
      clearRect: () => void log.push("clear"),
    };
    return { log, ctx };
  };
  it("draws a pixel, reads it, and leaves no mark", () => {
    const { log, ctx } = recorder();
    softwareCanvas(ctx);
    expect(log).toEqual(["fill", "read", "clear"]);
  });
  it("reads after the size is set, since a new size drops the buffer", () => {
    const { log, ctx } = recorder();
    const el = {
      set width(v: number) {
        log.push(`w${v}`);
      },
      set height(v: number) {
        log.push(`h${v}`);
      },
    } as unknown as HTMLCanvasElement;
    sizeCanvas(el, ctx, 320, 240);
    expect(log).toEqual(["w320", "h240", "fill", "read", "clear"]);
  });
  it("is how the feed and both of the raycaster's canvases get their size", () => {
    const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
    const ray = read("../src/raycast/RaycastView.tsx");
    expect(ray).toMatch(/sizeCanvas\(el, ctx, /u);
    expect(ray).toMatch(/sizeCanvas\(over, hctx, /u);
    expect(ray).not.toMatch(/\b(el|over)\.(width|height) = /u);
    const feed = read("../src/camfeed.ts");
    expect(feed).toMatch(/sizeCanvas\(canvas, c, /u);
    expect(feed).not.toMatch(/canvas\.width = |\[canvas\.width, canvas\.height\] = /u);
  });
});

describe("the upload loop with an async capture", () => {
  it("waits for the frame and stretches its wait by `pace`", async () => {
    const timers: { fn: () => void; ms: number }[] = [];
    const deps: FeedDeps = {
      capture: () => Promise.resolve({ jpeg: "AAAA", w: 160, h: 120 }),
      post: async () => ({ status: 200, watched: true }),
      hidden: () => false,
      now: () => 1,
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => {},
      onStatus: () => {},
      pace: (ms) => ms * 3,
    };
    const stop = runFeed(deps);
    timers.shift()!.fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(timers[0]!.ms).toBe(FEED_EVERY_MS * 3);
    stop();
  });
});

describe("the camera on an old tablet", () => {
  it("opens at 640 × 480 where there's no WebGL2, 720p elsewhere", async () => {
    expect((constraintsFor("user", null, true).video as MediaTrackConstraints).width).toEqual({ ideal: 640 });
    expect((constraintsFor("user").video as MediaTrackConstraints).width).toEqual({ ideal: 1280 });
    const asked: MediaStreamConstraints[] = [];
    const hub = new CameraHub(() => ({ secure: true, small: true, getUserMedia: (c) => (asked.push(c), Promise.resolve({ getTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream)) }));
    await hub.acquire("user");
    expect((asked[0]!.video as MediaTrackConstraints).height).toEqual({ ideal: 480 });
  });
  it("names why the camera or an upload failed", () => {
    expect(cameraError("denied")).toBe("cam_denied");
    expect(cameraError("insecure")).toBe("cam_insecure");
    expect(cameraError("none")).toBe("cam_none");
    expect(cameraError("error")).toBe("cam_error");
    expect([null, 404, 401, 403, 413, 500].map(feedError)).toEqual(["offline", "no_spot", "refused", "refused", "too_big", "http"]);
    for (const c of ["cam_denied", "offline", "no_spot", "refused", "too_big", "http", "no_frames", "blank", "stream_down"]) expect(isLinkError(c)).toBe(true);
    expect(isLinkError("constructor")).toBe(false);
  });
});

describe("the pace of a slow tablet", () => {
  it("the raycaster slows to what a frame costs, down to 5 fps, and comes back", () => {
    let pace = 50;
    for (let i = 0; i < 20; i++) pace = nextPace(pace, 180);
    expect(pace).toBe(SLOWEST_FRAME_MS);
    for (let i = 0; i < 60; i++) pace = nextPace(pace, 5);
    expect(pace).toBe(50);
    expect(nextPace(100, 45)).toBe(100);
  });
  it("jsQR waits at least as long as it took", () => {
    expect(scanDelay(false, 10_000, 0, 600)).toBe(600);
    expect(scanDelay(false, 10_000, 0, 10)).toBe(JSQR_EVERY_MS);
    expect(scanDelay(false, 10_000, 0)).toBe(JSQR_EVERY_MS);
  });
});

describe("the link's counters", () => {
  it("counts per second over its window", () => {
    const m = new RateMeter();
    for (let i = 0; i < 30; i++) m.hit(i * 333);
    expect(m.perSecond(9990)).toBeCloseTo(3);
    expect(m.perSecond(9990 + RATE_WINDOW_MS + 1)).toBe(0);
  });
  it("puts on the heartbeat only the halves this page runs, and an error for a minute", () => {
    const s = new LinkStats();
    expect(linkQuery(s.snapshot(0))).toEqual({});
    s.setFeeding(true);
    expect(linkQuery(s.snapshot(0))).toEqual({ cs: "0.0" });
    s.watch(1);
    s.received(0);
    s.drawn(0);
    s.error(0, "blank");
    expect(linkQuery(s.snapshot(1000))).toEqual({ cs: "0.0", cr: "0.1", cd: "0.1", ce: "blank" });
    expect(linkQuery(s.snapshot(ERROR_SHOWN_MS + 1)).ce).toBeUndefined();
    s.watch(-1);
    expect(linkQuery(s.snapshot(1000)).cr).toBeUndefined();
  });
  it("a failure that stands never ages off Run, and clears when it's over", () => {
    const s = new LinkStats();
    s.hold("cam_denied");
    const later = s.snapshot(ERROR_SHOWN_MS * 10);
    expect(linkQuery(later).ce).toBe("cam_denied");
    expect(linkTroubled(later)).toBe(true);
    expect(linkReadout(later)[2]).toBe(`error: ${LINK_ERRORS.cam_denied}`);
    s.hold(null);
    expect(s.snapshot(0).error).toBe(null);
    s.error(0, "offline");
    expect(linkTroubled(s.snapshot(ERROR_SHOWN_MS + 1))).toBe(false);
  });
  it("rides the poll", () => {
    expect(deviceQuery({ audio: null, visible: null, battery: null, charging: null, version: "v", link: { cs: "2.9", cr: "10.0", cd: "18.0", ce: "offline" } })).toMatchObject({ cs: "2.9", cr: "10.0", cd: "18.0", ce: "offline" });
  });
  it("reads plainly in ⚙", () => {
    const s = new LinkStats();
    s.setFeeding(true);
    s.watch(1);
    s.sent(0, { w: 320, h: 240, bytes: 10240 });
    s.captureCost(30);
    const lines = linkReadout(s.snapshot(1000));
    expect(lines[0]).toBe("camera to the games: 0.1 frames a second (320 × 240, 10.0 KB, 30 ms each)");
    expect(lines[1]).toBe("the games to here: 0.0 frames a second, 0.0 drawn");
    expect(lines[2]).toBe("no errors");
    s.error(0, "cam_denied");
    expect(linkReadout(s.snapshot(5000))[2]).toBe(`last error, 5 s ago: ${LINK_ERRORS.cam_denied}`);
    const off = new LinkStats();
    expect(linkReadout(off.snapshot(0)).slice(0, 2)).toEqual(["camera to the games: not sending from here", "the games to here: not watching"]);
  });
});
