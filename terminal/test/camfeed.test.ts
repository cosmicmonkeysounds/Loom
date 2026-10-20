import { describe, expect, it, vi } from "vitest";
import { FEED_BACKOFF_MS, FEED_EVERY_MS, base64Bytes, cropRect, feedOutcome, feedStatusText, feedWanted, jpegBase64, runFeed, type FeedDeps, type FeedStatus } from "../src/camfeed.ts";

function harness(over: Partial<FeedDeps> & { codes?: (number | null)[] } = {}) {
  const timers: { fn: () => void; ms: number }[] = [];
  const statuses: FeedStatus[] = [];
  const codes = over.codes ?? [];
  const post = vi.fn(async () => (codes.length > 0 ? codes.shift()! : 200));
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
