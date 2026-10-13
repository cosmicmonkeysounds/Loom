import { describe, expect, it } from "vitest";
import type { PlayerPose, PoseBody } from "@loom/house";
import { outcomeOf, poseMoved, PosePump } from "../src/game/pump.ts";

/** A pump on a fake clock whose sends resolve when the test says so. */
function rig(opts: { interval?: number; keepalive?: number } = {}) {
  let t = 0;
  const sent: PoseBody[] = [];
  const pending: Array<(status: number | null) => void> = [];
  const over: number[] = [];
  const pump = new PosePump({
    now: () => t,
    send: (body) => {
      sent.push(body);
      return new Promise((resolve) => pending.push(resolve));
    },
    onOver: (s) => over.push(s),
    ...opts,
  });
  /** Answer the oldest send and let its continuation run. */
  const answer = async (status: number | null) => {
    pending.shift()!(status);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { pump, sent, over, answer, advance: (ms: number) => (t += ms), get now() { return t; } };
}
const pose = (x: number, yaw = 0): PlayerPose => ({ p: [x, 0, 0], yaw, pitch: 0 });

describe("outcomeOf", () => {
  it("maps statuses to what the pump does next", () => {
    expect(outcomeOf(204)).toBe("ok");
    expect(outcomeOf(400)).toBe("drop");
    expect(outcomeOf(401)).toBe("over");
    expect(outcomeOf(410)).toBe("over");
    expect(outcomeOf(404)).toBe("over");
    expect(outcomeOf(500)).toBe("retry");
    expect(outcomeOf(429)).toBe("retry");
    expect(outcomeOf(null)).toBe("retry");
  });
});

describe("PosePump", () => {
  it("sends nothing before it has a pose", () => {
    const r = rig();
    expect(r.pump.tick()).toBeNull();
    expect(r.sent).toHaveLength(0);
  });

  it("is latest-only: poses set during a send coalesce into the newest", async () => {
    const r = rig();
    r.pump.set(pose(1));
    expect(r.pump.tick()).not.toBeNull();
    r.pump.set(pose(2));
    r.pump.set(pose(3));
    r.advance(150);
    expect(r.pump.tick()).toBeNull(); // one in flight: never queue a second
    await r.answer(204);
    expect(r.pump.tick()).not.toBeNull();
    expect(r.sent.map((b) => b.p[0])).toEqual([1, 3]);
  });

  it("holds 10 Hz", async () => {
    const r = rig();
    r.pump.set(pose(1));
    r.pump.tick();
    await r.answer(204);
    r.pump.set(pose(2));
    r.advance(50);
    expect(r.pump.tick()).toBeNull();
    r.advance(50);
    expect(r.pump.tick()).not.toBeNull();
  });

  it("doesn't resend a pose that hasn't moved, except as a keepalive", async () => {
    const r = rig({ keepalive: 5000 });
    r.pump.set(pose(1));
    r.pump.tick();
    await r.answer(204);
    r.advance(1000);
    r.pump.set(pose(1.0004)); // under a millimetre
    expect(r.pump.tick()).toBeNull();
    r.advance(4100);
    expect(r.pump.tick()).not.toBeNull();
    expect(r.sent).toHaveLength(2);
    expect(poseMoved(pose(1), pose(1, 0.5))).toBe(true);
  });

  it("backs off exponentially on network errors and 5xx, then recovers", async () => {
    const r = rig();
    r.pump.set(pose(1));
    r.pump.tick();
    await r.answer(null);
    expect(r.pump.failing).toBe(1);
    r.advance(200);
    expect(r.pump.tick()).toBeNull();
    r.advance(50); // 250 ms
    expect(r.pump.tick()).not.toBeNull();
    await r.answer(503);
    expect(r.pump.failing).toBe(2);
    r.advance(499);
    expect(r.pump.tick()).toBeNull();
    r.advance(1); // 500 ms
    r.pump.set(pose(7));
    expect(r.pump.tick()).not.toBeNull();
    expect(r.sent.at(-1)!.p[0]).toBe(7); // the retry carries the newest pose
    await r.answer(204);
    expect(r.pump.failing).toBe(0);
  });

  it("caps the backoff", async () => {
    const r = rig();
    r.pump.set(pose(1));
    for (let i = 0; i < 12; i++) {
      r.advance(10_000);
      expect(r.pump.tick()).not.toBeNull();
      await r.answer(null);
    }
    r.advance(5000);
    expect(r.pump.tick()).not.toBeNull();
  });

  it("drops a malformed pose (400) without backing off", async () => {
    const r = rig();
    r.pump.set(pose(1));
    r.pump.tick();
    await r.answer(400);
    expect(r.pump.failing).toBe(0);
    expect(r.pump.stopped).toBe(false);
  });

  it("stops for good on 401 / 410 and says so once", async () => {
    for (const status of [401, 410]) {
      const r = rig();
      r.pump.set(pose(1));
      r.pump.tick();
      await r.answer(status);
      expect(r.pump.stopped).toBe(true);
      expect(r.over).toEqual([status]);
      r.advance(10_000);
      r.pump.set(pose(9));
      expect(r.pump.tick()).toBeNull();
      expect(await r.pump.flush()).toBe(false);
      expect(r.over).toHaveLength(1);
    }
  });

  it("flush waits for the send in flight, then sends the newest at once", async () => {
    const r = rig();
    r.pump.set(pose(1));
    r.pump.tick();
    r.pump.set(pose(2));
    const done = r.pump.flush();
    await r.answer(204);
    await Promise.resolve();
    expect(r.sent.map((b) => b.p[0])).toEqual([1, 2]); // inside the 10 Hz gap
    await r.answer(204);
    expect(await done).toBe(true);
  });

  it("stamps each body with the clock", () => {
    const r = rig();
    r.advance(1234.4);
    r.pump.set(pose(1, 15));
    r.pump.tick();
    expect(r.sent[0]).toEqual({ p: [1, 0, 0], yaw: 15, pitch: 0, t: 1234 });
  });

  it("stop() ends it without calling onOver", () => {
    const r = rig();
    r.pump.set(pose(1));
    r.pump.stop();
    expect(r.pump.tick()).toBeNull();
    expect(r.over).toEqual([]);
  });
});
