import { describe, expect, it } from "vitest";
import type { TerminalSpot, Vec3 } from "@loom/house";
import { CAM_MAX_FEEDS, CAM_MISSES, CAM_NEAR_M, CAM_REST_MS, CamFeeds, pickFeeds } from "../src/game/cams.ts";

const spot = (id: string, x: number, y: number, z: number): TerminalSpot => ({ id, name: id, room: "r", pos: [x, y, z], yaw: 0 });

describe("pickFeeds", () => {
  const terms = [spot("near", 2, 1.3, 0), spot("far", CAM_NEAR_M + 1, 1.3, 0), spot("upstairs", 1, 4.1, 0), spot("mid", 5, 1.4, 3), spot("stale", 1, 1.3, 0)];
  const fresh = new Set(["near", "far", "upstairs", "mid"]);

  it("fresh feeds on the player's floor within 12 m, nearest first", () => {
    expect(pickFeeds(terms, fresh, [0, 0, 0], "r")).toEqual(["near", "mid"]);
    // From the top floor only the top floor's terminal.
    expect(pickFeeds(terms, fresh, [0, 2.8, 0], "r")).toEqual(["upstairs"]);
  });

  it("only the player's own (presence) room, never the tent's station; outside every room, none (wave 26, C7)", () => {
    const rooms: TerminalSpot[] = [
      { ...spot("here", 2, 1.3, 0), room: "hall" },
      { ...spot("next-door", 1, 1.3, 0), room: "kitchen" },
      { ...spot("tent", 1.5, 1.3, 0), room: "hall", view: "reinstall" },
    ];
    const all = new Set(rooms.map((t) => t.id));
    expect(pickFeeds(rooms, all, [0, 0, 0], "hall")).toEqual(["here"]);
    expect(pickFeeds(rooms, all, [0, 0, 0], "kitchen")).toEqual(["next-door"]);
    expect(pickFeeds(rooms, all, [0, 0, 0], null)).toEqual([]);
  });

  it("caps at the nearest few", () => {
    const many = Array.from({ length: 9 }, (_, i) => spot(`t${i}`, i, 1.3, 0));
    expect(pickFeeds(many, new Set(many.map((t) => t.id)), [0, 0, 0], "r")).toEqual(["t0", "t1", "t2", "t3"].slice(0, CAM_MAX_FEEDS));
  });
});

/** A CamFeeds on a fake server, fake timers and a fake decoder. */
function rig(opts: { list?: () => Response | Promise<Response>; frame?: (spot: string) => Response | Promise<Response> } = {}) {
  let t = 0;
  let at: Vec3 = [0, 0, 0];
  const terminals = [spot("hall", 2, 1.3, 0), spot("tent", 4, 1.3, 0)];
  const calls: string[] = [];
  const sunk: Array<[string, unknown]> = [];
  const closed: number[] = [];
  let timers = 0;
  let decodes = 0;
  const fetcher = (async (url: string) => {
    calls.push(url);
    if (url.endsWith("/api/spatial/cams")) return opts.list ? opts.list() : Response.json({ cams: [{ spot: "hall", at: 1, w: 160, h: 120 }, { spot: "tent", at: 1, w: 160, h: 120 }] });
    const s = new URL(url, "http://x").searchParams.get("spot")!;
    if (opts.frame) return opts.frame(s);
    return new Response(new Uint8Array([0xff, 0xd8, 1]), { headers: { "content-type": "image/jpeg", "x-cam-at": String(t) } });
  }) as unknown as typeof fetch;
  const feeds = new CamFeeds({
    base: "/e/evt",
    token: "tok",
    sink: (s, src) => sunk.push([s, src]),
    where: () => ({ terminals, at, room: "r" }),
    fetcher,
    decode: async () => {
      const id = ++decodes;
      return { id, close: () => closed.push(id) } as unknown as ImageBitmap;
    },
    every: () => {
      timers += 1;
      return () => (timers -= 1);
    },
    now: () => t,
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return {
    feeds,
    calls,
    sunk,
    closed,
    settle,
    timers: () => timers,
    decodes: () => decodes,
    advance: (ms: number) => (t += ms),
    move: (p: Vec3) => (at = p),
  };
}

describe("CamFeeds", () => {
  it("lists, then reads each near feed's frame, draws it and closes the bitmap", async () => {
    const r = rig();
    r.feeds.setActive(true);
    expect(r.timers()).toBe(2);
    await r.settle();
    r.advance(10);
    r.feeds.tick();
    await r.settle();
    await r.settle();
    expect(r.calls.filter((c) => c.includes("cam?spot=")).sort()).toEqual(["/e/evt/api/spatial/cam?spot=hall", "/e/evt/api/spatial/cam?spot=tent"]);
    expect(r.sunk.map(([s]) => s).sort()).toEqual(["hall", "tent"]);
    expect(r.closed.sort()).toEqual([1, 2]);
    expect(r.feeds.showing).toEqual(["hall", "tent"]);

    // The same x-cam-at is never decoded twice.
    r.feeds.tick();
    await r.settle();
    await r.settle();
    expect(r.decodes()).toBe(2);

    // Walking away puts the screens back.
    r.move([40, 0, 0]);
    r.feeds.tick();
    expect(r.sunk.slice(-2).map(([s, src]) => [s, src])).toEqual(expect.arrayContaining([["hall", null], ["tent", null]]));
    expect(r.feeds.showing).toEqual([]);
  });

  it("off stops the timers; dispose clears every window and never restarts", async () => {
    const r = rig();
    r.feeds.setActive(true);
    await r.settle();
    r.feeds.tick();
    await r.settle();
    await r.settle();
    r.feeds.setActive(false);
    expect(r.timers()).toBe(0);
    const before = r.calls.length;
    r.feeds.tick();
    expect(r.calls.length).toBe(before);
    r.feeds.dispose();
    expect(r.feeds.showing).toEqual([]);
    expect(r.sunk.filter(([, src]) => src === null).length).toBe(2);
    r.feeds.setActive(true);
    expect(r.timers()).toBe(0);
  });

  it("a 401 on the list ends the feeds; a network failure keeps what it had", async () => {
    let status = 200;
    const r = rig({ list: () => (status === 0 ? Promise.reject(new Error("down")) : status === 200 ? Response.json({ cams: [{ spot: "hall", at: 1, w: 1, h: 1 }] }) : new Response("{}", { status })) });
    r.feeds.setActive(true);
    await r.settle();
    status = 0;
    await r.feeds.list();
    r.feeds.tick();
    await r.settle();
    await r.settle();
    expect(r.feeds.showing).toEqual(["hall"]);
    status = 401;
    await r.feeds.list();
    expect(r.timers()).toBe(0);
    expect(r.feeds.showing).toEqual([]);
  });

  it("a 404 frame drops the feed; repeated failures rest the feed, never spam", async () => {
    let mode: "404" | "500" = "500";
    const r = rig({ frame: () => new Response("{}", { status: mode === "404" ? 404 : 500 }) });
    r.feeds.setActive(true);
    await r.settle();
    const frames = () => r.calls.filter((c) => c.includes("spot=hall")).length;
    for (let i = 0; i < CAM_MISSES; i++) {
      r.feeds.tick();
      await r.settle();
      await r.settle();
    }
    expect(frames()).toBe(CAM_MISSES);
    r.feeds.tick(); // resting
    await r.settle();
    expect(frames()).toBe(CAM_MISSES);
    r.advance(CAM_REST_MS + 1);
    mode = "404";
    r.feeds.tick();
    await r.settle();
    await r.settle();
    expect(frames()).toBe(CAM_MISSES + 1);
    // Off the fresh list now: no more requests for it until the next list.
    r.feeds.tick();
    await r.settle();
    expect(frames()).toBe(CAM_MISSES + 1);
  });
});
