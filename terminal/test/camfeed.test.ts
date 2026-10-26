import { describe, expect, it, vi } from "vitest";
import { FEED_BACKOFF_MS, FEED_IDLE_EVERY_MS, cameraRetryable, FEED_EVERY_MS, base64Bytes, cropRect, feedGap, feedOutcome, feedStatusText, feedWanted, jpegBase64, runFeed, watchedOf, type FeedDeps, type FeedReply, type FeedStatus } from "../src/camfeed.ts";

function harness(over: Partial<FeedDeps> & { codes?: (number | null | FeedReply)[] } = {}) {
  const timers: { fn: () => void; ms: number }[] = [];
  const statuses: FeedStatus[] = [];
  const codes = over.codes ?? [];
  const post = vi.fn(async (): Promise<FeedReply> => {
    const c = codes.length > 0 ? codes.shift()! : 200;
    return typeof c === "object" && c !== null ? c : { status: c };
  });
  const deps: FeedDeps = {
    capture: () => ({ jpeg: "AAAA", w: 160, h: 120 }),
    post,
    hidden: () => false,
    now: () => 1,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
    onStatus: (s) => statuses.push(s),
    ...over,
  };
  const stop = runFeed(deps);
  const step = async () => {
    const t = timers.shift();
    t?.fn();
    await new Promise((r) => setTimeout(r, 0));
    return t?.ms;
  };
  return { timers, statuses, post, stop, step };
}

describe("the camera feed", () => {
  it("is wanted only on a placed terminal with the feed on", () => {
    expect(feedWanted({ spot: "kitchen", camFeed: true })).toBe(true);
    expect(feedWanted({ spot: " ", camFeed: true })).toBe(false);
    expect(feedWanted({ spot: "kitchen", camFeed: false })).toBe(false);
    // Wave 26 (T3 / R5): the tent laptop never sends its camera.
    expect(feedWanted({ spot: "tent", camFeed: true, view: "reinstall" })).toBe(false);
    expect(feedWanted({ spot: "hall", camFeed: true, view: "auto" })).toBe(true);
  });
  it("slows to a frame every 2 s while nobody in the game can see this room (wave 26, C7)", async () => {
    expect(watchedOf({ ok: true, watched: false })).toBe(false);
    expect(watchedOf({ ok: true })).toBeUndefined();
    expect(watchedOf(null)).toBeUndefined();
    expect(feedGap(false)).toBe(FEED_IDLE_EVERY_MS);
    expect(feedGap(true)).toBe(FEED_EVERY_MS);
    expect(feedGap(undefined)).toBe(FEED_EVERY_MS); // an older server: the old rate
    const h = harness({ codes: [{ status: 200, watched: false }, { status: 200, watched: true }, 200] });
    await h.step(); // the first frame
    expect(h.timers[0]?.ms).toBe(FEED_IDLE_EVERY_MS);
    expect(h.statuses.at(-1)).toMatchObject({ kind: "sending", watched: false });
    expect(feedStatusText(h.statuses.at(-1)!)).toMatch(/idle/u);
    await h.step();
    expect(h.timers[0]?.ms).toBe(FEED_EVERY_MS);
    await h.step();
    expect(h.timers[0]?.ms).toBe(FEED_EVERY_MS);
    h.stop();
  });
  it("crops the middle 4:3 of the camera", () => {
    expect(cropRect(1280, 720)).toEqual({ sx: 160, sy: 0, sw: 960, sh: 720 });
    expect(cropRect(480, 640)).toEqual({ sx: 0, sy: 140, sw: 480, sh: 360 });
    expect(cropRect(0, 0).sw).toBe(0);
  });
  it("strips the data URL and sizes the payload", () => {
    expect(jpegBase64("data:image/jpeg;base64,QUJD")).toBe("QUJD");
    expect(jpegBase64("data:image/png;base64,QUJD")).toBeNull();
    expect(base64Bytes("QUJD")).toBe(3);
    expect(base64Bytes("QQ==")).toBe(1);
  });
  it("reads statuses", () => {
    expect(feedOutcome(200)).toBe("ok");
    expect(feedOutcome(404)).toBe("stop");
    expect(feedOutcome(413)).toBe("retry");
    expect(feedOutcome(null)).toBe("retry");
    expect(feedStatusText({ kind: "stopped", problem: "x" })).toContain("x");
  });
  it("sends a frame about every 333 ms, one at a time", async () => {
    const h = harness();
    expect(await h.step()).toBe(0);
    expect(h.post).toHaveBeenCalledTimes(1);
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(FEED_EVERY_MS);
    await h.step();
    expect(h.post).toHaveBeenCalledTimes(2);
    expect(h.statuses.at(-1)?.kind).toBe("sending");
  });
  it("backs off on errors and stops for good on no such spot", async () => {
    const h = harness({ codes: [500, null, 404] });
    await h.step();
    expect(h.timers[0]!.ms).toBe(FEED_BACKOFF_MS);
    await h.step();
    expect(h.timers[0]!.ms).toBe(FEED_BACKOFF_MS * 2);
    expect(h.statuses.at(-1)).toMatchObject({ kind: "retrying" });
    await h.step();
    expect(h.timers).toHaveLength(0);
    expect(h.statuses.at(-1)).toMatchObject({ kind: "stopped" });
    expect((h.statuses.at(-1) as { problem: string }).problem).toContain("no such spot");
  });
  it("sends nothing while the page is hidden or there is no frame", async () => {
    let hidden = true;
    let frame = false;
    const h = harness({ hidden: () => hidden, capture: () => (frame ? { jpeg: "AAAA", w: 160, h: 120 } : null) });
    await h.step();
    hidden = false;
    await h.step();
    expect(h.post).not.toHaveBeenCalled();
    expect(h.statuses.at(-1)?.kind).toBe("waiting");
    frame = true;
    await h.step();
    expect(h.post).toHaveBeenCalledTimes(1);
  });
  it("stops when told", async () => {
    const h = harness();
    h.stop();
    await h.step();
    expect(h.post).not.toHaveBeenCalled();
  });
});

describe("a camera that failed to open", () => {
  it("is asked for again only when it was busy or glitched", () => {
    expect(cameraRetryable("error")).toBe(true);
    expect(cameraRetryable("denied")).toBe(false);
    expect(cameraRetryable("insecure")).toBe(false);
    expect(cameraRetryable("none")).toBe(false);
  });
});
