import { describe, expect, it } from "vitest";
import { VOICE_CHUNK_BYTES, VOICE_MAX_BYTES } from "@loom/house";
import { UPLINK_BACKOFF_MS, UPLINK_QUEUE_MAX, Uplink, uplinkOutcome, uplinkProblem, type UplinkAnswer, type UplinkStatus } from "../src/voice/uplink.ts";

const chunk = (fill = 1) => new Uint8Array(VOICE_CHUNK_BYTES).fill(fill);
const flush = () => new Promise((r) => setTimeout(r, 0));

function harness() {
  const posts: Array<{ body: Uint8Array; seq: number; answer: (a: UplinkAnswer) => void }> = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const statuses: UplinkStatus[] = [];
  const listening: boolean[] = [];
  const up = new Uplink({
    post: (body, seq) => new Promise((answer) => posts.push({ body, seq, answer })),
    seq0: 1_700_000_000_000.4,
    now: () => 5,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
    onStatus: (s) => statuses.push(s),
    onListening: (on) => listening.push(on),
  });
  return { up, posts, timers, statuses, listening };
}

describe("the voice uplink", () => {
  it("reads statuses", () => {
    expect(uplinkOutcome(200)).toBe("ok");
    for (const s of [401, 403, 404, 410]) expect(uplinkOutcome(s)).toBe("stop");
    expect(uplinkOutcome(413)).toBe("skip");
    expect(uplinkOutcome(400)).toBe("skip");
    expect(uplinkOutcome(503)).toBe("retry");
    expect(uplinkOutcome(null)).toBe("retry");
    expect(uplinkProblem(403)).toMatch(/off at this terminal/);
    expect(uplinkProblem(404)).toMatch(/no such spot/);
  });
  it("sends one upload at a time, seq from the clock, the backlog together", async () => {
    const h = harness();
    h.up.send(chunk(1));
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]!.seq).toBe(1_700_000_000_000);
    h.up.send(chunk(2));
    h.up.send(chunk(3));
    expect(h.posts).toHaveLength(1); // never two in flight
    h.posts[0]!.answer({ status: 200, listening: true });
    await flush();
    expect(h.posts).toHaveLength(2);
    expect(h.posts[1]!.seq).toBe(1_700_000_000_001);
    expect(h.posts[1]!.body.length).toBe(2 * VOICE_CHUNK_BYTES);
    expect(h.posts[1]!.body.length).toBeLessThanOrEqual(VOICE_MAX_BYTES);
    expect([h.posts[1]!.body[0], h.posts[1]!.body[VOICE_CHUNK_BYTES]]).toEqual([2, 3]);
    expect(h.statuses.at(-1)).toEqual({ kind: "sending", at: 5 });
    expect(h.listening).toEqual([true]);
  });
  it("drops the oldest speech behind a slow upload", async () => {
    const h = harness();
    h.up.send(chunk(0));
    for (let i = 1; i <= UPLINK_QUEUE_MAX + 3; i++) h.up.send(chunk(i));
    h.posts[0]!.answer({ status: 200 });
    await flush();
    // Two chunks per body: the newest five survive, oldest first.
    const firsts: number[] = [];
    for (let i = 1; h.posts[i] !== undefined; i++) {
      firsts.push(h.posts[i]!.body[0]!);
      h.posts[i]!.answer({ status: 200 });
      await flush();
    }
    expect(firsts).toEqual([4, 6, 8]);
  });
  it("stops sending when nobody hears it any more", async () => {
    const h = harness();
    h.up.send(chunk());
    h.up.send(chunk());
    h.posts[0]!.answer({ status: 200, listening: false });
    await flush();
    expect(h.posts).toHaveLength(1); // the queued one was dropped
    expect(h.listening).toEqual([false]);
  });
  it("backs off on a failure, queueing nothing meanwhile", async () => {
    const h = harness();
    h.up.send(chunk());
    h.posts[0]!.answer({ status: 503 });
    await flush();
    expect(h.timers[0]!.ms).toBe(UPLINK_BACKOFF_MS);
    expect(h.statuses.at(-1)).toMatchObject({ kind: "retrying" });
    h.up.send(chunk());
    expect(h.posts).toHaveLength(1);
    h.timers[0]!.fn();
    h.up.send(chunk());
    expect(h.posts).toHaveLength(2);
    h.posts[1]!.answer({ status: null });
    await flush();
    expect(h.timers[1]!.ms).toBe(UPLINK_BACKOFF_MS * 2);
  });
  it("skips a refused body and stops for good on a refusal of the terminal", async () => {
    const h = harness();
    h.up.send(chunk());
    h.up.send(chunk());
    h.posts[0]!.answer({ status: 413 });
    await flush();
    expect(h.posts).toHaveLength(2);
    h.posts[1]!.answer({ status: 403 });
    await flush();
    expect(h.up.stopped).toBe(true);
    expect(h.statuses.at(-1)).toMatchObject({ kind: "stopped", problem: expect.stringMatching(/off at this terminal/) });
    h.up.send(chunk());
    expect(h.posts).toHaveLength(2);
  });
  it("a stopped uplink sends nothing more, even an answer in flight", async () => {
    const h = harness();
    h.up.send(chunk());
    h.up.send(chunk());
    h.up.stop();
    h.posts[0]!.answer({ status: 200 });
    await flush();
    expect(h.posts).toHaveLength(1);
    expect(h.statuses).toEqual([]);
  });
});
