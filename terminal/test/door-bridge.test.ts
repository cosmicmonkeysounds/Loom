import { describe, expect, it } from "vitest";
import { DOOR_RETRY_MS, DOOR_STALE_MS, DoorBridge, RECONCILE_GAP_MS, doorOpenNow, doorQuery, doorReport, type DoorSignal, type PostOutcome } from "../src/serial/door-bridge.ts";
import type { DoorReading } from "../src/serial/door-protocol.ts";

/** A bridge on a fake clock, its posts answered by `answer` (async, like fetch). */
function rig(answer: (signal: DoorSignal) => PostOutcome = () => "ok") {
  let now = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; off: boolean }> = [];
  const posts: Array<{ signal: DoorSignal; level: number; at: number }> = [];
  const bridge = new DoorBridge({
    now: () => now,
    post: async (signal, level) => {
      posts.push({ signal, level, at: now });
      return answer(signal);
    },
    later: (fn, ms) => {
      const t = { at: now + ms, fn, off: false };
      timers.push(t);
      return () => void (t.off = true);
    },
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const advance = async (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => !x.off && x.at <= now)) {
      t.off = true;
      t.fn();
    }
    await flush();
  };
  let seq = 0;
  const line = (open: boolean, extra: Partial<DoorReading> = {}) => bridge.line({ t: "door", seq: seq++, open, level: open ? 30 : 2400, lit: 3000, dark: 600, fault: null, warn: null, ...extra });
  return { bridge, posts, advance, flush, line, now: () => now };
}

const SHUT = { server_door: "closed" as const, door_override: false };
const OPEN = { server_door: "open" as const, door_override: false };

describe("the door bridge (§2.5)", () => {
  it("posts nothing before the story has a door (Power On not played)", async () => {
    const r = rig();
    r.bridge.screen({ server_door: null, door_override: null });
    r.line(false);
    r.line(true);
    await r.flush();
    expect(r.posts).toEqual([]);
  });

  it("posts each edge once, with the level", async () => {
    const r = rig();
    r.bridge.screen(SHUT);
    r.line(false);
    r.line(false); // the periodic line: no edge
    r.line(true);
    await r.flush();
    r.line(true);
    r.line(false);
    await r.flush();
    expect(r.posts.map((p) => p.signal)).toEqual(["door_sensor_opened", "door_sensor_closed"]);
    expect(r.posts[0]?.level).toBe(30);
  });

  it("an ldr_open warning still posts", async () => {
    const r = rig();
    r.bridge.screen(SHUT);
    r.line(false);
    r.line(true, { warn: "ldr_open", level: 0 });
    await r.flush();
    expect(r.posts.map((p) => p.signal)).toEqual(["door_sensor_opened"]);
  });

  it("a blocking fault posts nothing, and its end is no edge", async () => {
    const r = rig();
    r.bridge.screen(SHUT);
    r.line(false);
    r.line(true, { fault: "ldr_saturated", level: 0 });
    r.line(false);
    await r.flush();
    expect(r.posts).toEqual([]);
  });

  it("never posts while a director has the door on the 🚪 buttons", async () => {
    const r = rig();
    r.bridge.screen({ server_door: "closed", door_override: true });
    r.line(false);
    r.line(true);
    await r.advance(RECONCILE_GAP_MS + 1);
    r.bridge.screen({ server_door: "closed", door_override: true });
    await r.flush();
    expect(r.posts).toEqual([]);
    // 🚪 Trust the door sensor: the next poll's reconcile follows the sensor.
    r.line(true);
    r.bridge.screen(SHUT);
    await r.flush();
    expect(r.posts.map((p) => p.signal)).toEqual(["door_sensor_opened"]);
  });

  it("reconciles only when fresh, quiet for 4 s and different from the story", async () => {
    const r = rig();
    r.line(true); // boot: the door is open, the story doesn't know yet
    r.bridge.screen(SHUT);
    await r.flush();
    expect(r.posts.map((p) => p.signal)).toEqual(["door_sensor_opened"]);
    // The story hasn't caught up on the next poll: too soon to post again.
    await r.advance(1000);
    r.line(true);
    r.bridge.screen(SHUT);
    await r.flush();
    expect(r.posts).toHaveLength(1);
    await r.advance(RECONCILE_GAP_MS);
    r.line(true);
    r.bridge.screen(SHUT);
    await r.flush();
    expect(r.posts).toHaveLength(2);
    // Agreeing: nothing.
    await r.advance(RECONCILE_GAP_MS);
    r.line(true);
    r.bridge.screen(OPEN);
    await r.flush();
    expect(r.posts).toHaveLength(2);
  });

  it("never reconciles off a stale sensor", async () => {
    const r = rig();
    r.line(true);
    await r.advance(DOOR_STALE_MS + 1);
    r.bridge.screen(SHUT);
    await r.flush();
    expect(r.posts).toEqual([]);
  });

  it("retries a post lost to the network at 1 s, 2 s, 4 s, then leaves it to the reconcile", async () => {
    const r = rig(() => "network");
    r.bridge.screen(SHUT);
    r.line(false);
    r.line(true);
    await r.flush();
    for (const ms of DOOR_RETRY_MS) {
      r.line(true);
      await r.advance(ms);
    }
    await r.advance(10_000);
    expect(r.posts.map((p) => p.signal)).toEqual(["door_sensor_opened", "door_sensor_opened", "door_sensor_opened", "door_sensor_opened"]);
  });

  it("a refused post is not retried, and a retry is dropped once the door moved back", async () => {
    const refused = rig(() => "refused");
    refused.bridge.screen(SHUT);
    refused.line(false);
    refused.line(true);
    await refused.advance(10_000);
    expect(refused.posts).toHaveLength(1);
    const lost = rig(() => "network");
    lost.bridge.screen(SHUT);
    lost.line(false);
    lost.line(true);
    await lost.flush();
    lost.line(false); // shut again: the closed edge goes out, the open retry never does
    for (let i = 0; i < 5; i++) await lost.advance(5000);
    expect(lost.posts.map((p) => p.signal)).toEqual(["door_sensor_opened", "door_sensor_closed", "door_sensor_closed", "door_sensor_closed", "door_sensor_closed"]);
  });

  it("an edge during a post in flight goes out when it lands", async () => {
    let release: () => void = () => {};
    let n = 0;
    let now = 0;
    const posts: DoorSignal[] = [];
    const bridge = new DoorBridge({
      now: () => now,
      later: () => () => {},
      post: (s) => {
        posts.push(s);
        n += 1;
        return n === 1 ? new Promise<PostOutcome>((res) => (release = () => res("ok"))) : Promise.resolve("ok");
      },
    });
    bridge.screen(SHUT);
    const l = (open: boolean) => bridge.line({ t: "door", seq: now++, open, level: 1, lit: 1, dark: 0, fault: null, warn: null });
    l(false);
    l(true);
    l(false);
    expect(posts).toEqual(["door_sensor_opened"]);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(posts).toEqual(["door_sensor_opened", "door_sensor_closed"]);
  });
});

describe("the door's heartbeat keys", () => {
  it("reports no port, stale, a fault, a warning and the state", () => {
    expect(doorQuery(doorReport({ connected: false, sensor: null, now: 0 }))).toEqual({ door: "fault", dft: "no_port" });
    expect(doorQuery(doorReport({ connected: true, sensor: null, now: 0 }))).toEqual({ door: "fault", dft: "stale" });
    const s = { open: false, level: 2410, fault: null, warn: null, at: 0 };
    expect(doorQuery(doorReport({ connected: true, sensor: s, now: 100 }))).toEqual({ door: "closed", dlv: "2410" });
    expect(doorQuery(doorReport({ connected: true, sensor: s, now: DOOR_STALE_MS + 1 }))).toEqual({ door: "fault", dlv: "2410", dft: "stale" });
    expect(doorQuery(doorReport({ connected: true, sensor: { ...s, open: true, level: 0, warn: "ldr_open" }, now: 0 }))).toEqual({ door: "open", dlv: "0", dwn: "ldr_open" });
    expect(doorQuery(doorReport({ connected: true, sensor: { ...s, open: true, fault: "led_dead" }, now: 0 }))).toEqual({ door: "fault", dlv: "2410", dft: "led_dead" });
    expect(doorQuery(null)).toEqual({});
  });
});

describe("the panel's door source", () => {
  const fresh = { open: true, level: 0, fault: null, warn: null, at: 1000 };
  it("is the local sensor when fresh, fault-free and not overridden", () => {
    expect(doorOpenNow(fresh, SHUT, 1500)).toBe(true);
  });
  it("is the story's door otherwise", () => {
    expect(doorOpenNow(fresh, { server_door: "closed", door_override: true }, 1500)).toBe(false);
    expect(doorOpenNow({ ...fresh, fault: "ldr_saturated" }, SHUT, 1500)).toBe(false);
    expect(doorOpenNow(fresh, SHUT, 1000 + DOOR_STALE_MS + 1)).toBe(false);
    expect(doorOpenNow(null, OPEN, 0)).toBe(true);
    expect(doorOpenNow(null, { server_door: null, door_override: null }, 0)).toBeNull();
    expect(doorOpenNow(null, null, 0)).toBeNull();
  });
});
