//! Clippy's dream on the server (wave 49, docs/loom-w49-contract.md): the
//! screen state's `dream` block and when the takeover falls, the story's
//! switch and its endings, and the games' feed down the camera routes.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { dreamFrameIndex, dreamFrameName, dreamOffsetS } from "@loom/house";
import { DREAM_CAM_EVERY_MS, DREAM_CAM_MS, DREAM_CHECK_MS, DreamFeed } from "../server/dream-feed.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { DREAM_FALLBACK_MS, DREAM_LEAD_MS, ScreenWatch, screenDeviceOf, type ScreenDevice } from "../server/routes/screen.ts";
import { Store } from "../server/store.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";
import { TO_Y2K, pressChain } from "../../scripts/accept/chains.ts";

const SHOW = "trapped-in-the-internet";
const CODES = { event: "EVTW49", prime: "PRMW49", mod: "MODW49" };
const SLOW = 120_000;
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const fresh = (): string => {
  const d = mkdtempSync(join(tmpdir(), "loom-w49-"));
  dirs.push(d);
  return d;
};

function tiny() {
  const sim = Sim.fromSources(
    [
      "# T",
      "",
      "== Boot",
      "set Night.dream = false",
      "set Night.ended = false",
      "",
      "== Go",
      "set Night.dream = true",
      "cue dream_begin",
      "",
      "== Stop",
      "set Night.dream = false",
      "",
      "== Finish",
      "set Night.ended = true",
      "",
    ].join("\n"),
  );
  sim.fireBeat("Boot");
  let t = 100_000;
  const w = new ScreenWatch({ now: () => t });
  const poll = (view = "auto", device: ScreenDevice = {}) => w.poll(sim, { name: view, spot: "", view, character: "", device }, () => false);
  return { sim, w, poll, at: (ms: number) => void (t = ms), now: () => t };
}

describe("the dream block", () => {
  it("is null until the story turns it on", () => {
    expect(tiny().poll().dream).toBeNull();
  });

  it("falls on the voice's fallback with no word from the TV, known to every screen ahead of time", () => {
    const { sim, poll, at } = tiny();
    poll();
    sim.fireBeat("Go");
    at(200_000);
    expect(poll().dream).toEqual({ at: 200_000 + DREAM_FALLBACK_MS });
    expect(poll("tv").dream).toEqual({ at: 200_000 + DREAM_FALLBACK_MS });
  });

  it("moves to his word when the TV starts the sentence, and every terminal hears the same moment", () => {
    const { sim, poll, at } = tiny();
    poll();
    sim.fireBeat("Go");
    at(200_000);
    poll();
    at(226_000);
    expect(poll("tv", { bug: true }).dream).toEqual({ at: 226_000 + DREAM_LEAD_MS });
    expect(poll("auto").dream).toEqual({ at: 226_000 + DREAM_LEAD_MS });
  });

  it("takes his word once: a TV still saying so can't push the moment on", () => {
    const { sim, poll, at } = tiny();
    poll();
    sim.fireBeat("Go");
    at(200_000);
    poll();
    at(226_000);
    poll("tv", { bug: true });
    at(227_000);
    expect(poll("tv", { bug: true }).dream).toEqual({ at: 226_000 + DREAM_LEAD_MS });
  });

  it("only takes it from the TV, and never from before the cue", () => {
    const { sim, poll, at } = tiny();
    poll("tv", { bug: true });
    sim.fireBeat("Go");
    at(200_000);
    poll();
    expect(poll("auto", { bug: true }).dream).toEqual({ at: 200_000 + DREAM_FALLBACK_MS });
  });

  it("never moves the moment later: a TV far behind the fallback changes nothing", () => {
    const { sim, poll, at } = tiny();
    poll();
    sim.fireBeat("Go");
    at(200_000);
    poll();
    at(200_000 + DREAM_FALLBACK_MS + 5000);
    expect(poll("tv", { bug: true }).dream).toEqual({ at: 200_000 + DREAM_FALLBACK_MS });
  });

  it("is simply on after a restart: the cue replays as history", () => {
    const { sim } = tiny();
    sim.fireBeat("Go");
    const w = new ScreenWatch({ now: () => 500_000 });
    w.adopt(sim);
    expect(w.poll(sim, { name: "a", spot: "", view: "auto", character: "" }, () => false).dream).toEqual({ at: 0 });
  });

  it("goes with 🌀 and comes back, its moment long past", () => {
    const { sim, poll, at } = tiny();
    poll();
    sim.fireBeat("Go");
    at(200_000);
    poll();
    sim.fireBeat("Stop");
    expect(poll().dream).toBeNull();
    sim.fireBeat("Go");
    at(201_000);
    expect(poll().dream?.at).toBe(201_000 + DREAM_FALLBACK_MS); // the fixture cues again; the show's 🌀 never does
  });

  it("ends at an ending, whatever Night.dream says", () => {
    const { sim, poll } = tiny();
    sim.fireBeat("Go");
    sim.fireBeat("Finish");
    expect(poll().dream).toBeNull();
  });

  it("parses `bug=1` off the poll and nothing else", () => {
    const of = (v: string) => screenDeviceOf((k) => (k === "bug" ? v : "")).bug;
    expect(of("1")).toBe(true);
    expect(of("0")).toBeUndefined();
    expect(of("")).toBeUndefined();
  });
});

describe("the show", () => {
  it("turns it on at 🕚 and readies every screen, off before it", { timeout: SLOW }, async () => {
    const sim = Sim.fromSources(scenarioSource(SHOW));
    sim.fireBeat("Power On");
    const dream = () => sim.world.peek("Night.dream");
    expect(dream()).toMatchObject({ kind: "bool", value: false });
    const chain = TO_Y2K.slice(0, TO_Y2K.indexOf("y2k_clock"));
    expect(chain.length).toBeGreaterThan(0);
    const r = await pressChain(chain, async (name) => (sim.signal(name), { ok: true }), () => {});
    expect(r.ok).toBe(true);
    expect(dream()).toMatchObject({ kind: "bool", value: false });
    sim.signal("y2k_clock");
    expect(dream()).toMatchObject({ kind: "bool", value: true });
    const cues = sim.log.all().filter((e) => e.type === "directive" && e.verb === "cue").map((e) => (e as { args: string }).args.trim());
    expect(cues).toContain("dream_begin");
    // 🌀 off, 🌀 on.
    sim.signal("dream_toggle");
    expect(dream()).toMatchObject({ kind: "bool", value: false });
    sim.signal("dream_toggle");
    expect(dream()).toMatchObject({ kind: "bool", value: true });
  });

  it("says the words the TV listens for, in the beat the rule plays", { timeout: SLOW }, () => {
    const text = scenarioSource(SHOW);
    expect(text).toMatch(/== The Y2K Clock[\s\S]*?Trabolta: Worst case scenario — we will have to face the Y2K BUG\./u);
    expect(text.split("\n").filter((l) => /^\w+( \w+)*:.*\bY2K BUG\b/u.test(l) && !/^\s*(description|label):/u.test(l))).toHaveLength(1);
  });

  it("refuses 🌀 before the clock", { timeout: SLOW }, () => {
    const sim = Sim.fromSources(scenarioSource(SHOW));
    sim.fireBeat("Power On");
    sim.signal("dream_toggle");
    expect(sim.world.peek("Night.dream")).toMatchObject({ kind: "bool", value: false });
  });
});

describe("the games' feed", () => {
  function feed(o: { now?: number; dir?: string | null; read?: (f: string) => Promise<Buffer>; found?: boolean } = {}) {
    let t = o.now ?? 1_800_000_000_000;
    let looks = 0;
    const f = new DreamFeed({
      dir: o.dir === undefined ? "/media" : o.dir,
      now: () => t,
      read: o.read ?? (async (file) => Buffer.from(file)),
      exists: async () => {
        looks += 1;
        return o.found ?? true;
      },
    });
    return { f, at: (ms: number) => void (t = ms), now: () => t, looks: () => looks };
  }

  it("serves each terminal its own moment of the hour: the one that wall is showing", async () => {
    const { f, now } = feed();
    const hall = await f.frame("hall");
    const ram = await f.frame("ram");
    expect(hall?.jpeg.toString()).toBe(join("/media", "dream", "frames", dreamFrameName(dreamFrameIndex("hall", now()))));
    expect(hall?.jpeg.toString()).not.toBe(ram?.jpeg.toString());
  });

  it("moves its `at` with the frame, so a game never decodes one twice", async () => {
    const { f, at, now } = feed();
    const a = await f.frame("hall");
    expect((await f.frame("hall"))?.at).toBe(a?.at);
    at(now() + 400);
    expect((await f.frame("hall"))?.at).not.toBe(a?.at);
  });

  it("gives no frame for a missing file", async () => {
    const { f } = feed({ read: () => Promise.reject(new Error("gone")) });
    expect(await f.frame("hall")).toBeNull();
  });

  it("has nothing with no media folder", async () => {
    const { f, looks } = feed({ dir: null });
    expect(f.ready()).toBe(false);
    expect(looks()).toBe(0);
    expect(await f.frame("hall")).toBeNull();
  });

  it("looks for the frames at most once per check, and notices them arrive", async () => {
    const { f, at, now, looks } = feed();
    expect(f.ready()).toBe(false); // the look is on its way
    await Promise.resolve();
    await Promise.resolve();
    expect(f.ready()).toBe(true);
    expect(looks()).toBe(1);
    at(now() + DREAM_CHECK_MS);
    f.ready();
    expect(looks()).toBe(2);
  });

  it("lets the real room break through on each terminal's own beat, only with a camera", () => {
    const { f, at } = feed({ now: 0 });
    const beatStart = (DREAM_CAM_EVERY_MS - ((dreamOffsetS("hall") * 1000) % DREAM_CAM_EVERY_MS)) % DREAM_CAM_EVERY_MS;
    at(beatStart + 10);
    expect(f.showsCamera("hall", true)).toBe(true);
    expect(f.showsCamera("hall", false)).toBe(false);
    at(beatStart + DREAM_CAM_MS + 10);
    expect(f.showsCamera("hall", true)).toBe(false);
  });

  it("the room shows a small share of the time", () => {
    expect(DREAM_CAM_MS / DREAM_CAM_EVERY_MS).toBeLessThan(0.2);
  });

  it("lists every terminal, with or without a camera, keeping a real feed's entry", () => {
    const { f } = feed({ now: 5000 });
    const list = f.list(["hall", "ram"], [{ spot: "hall", at: 1, w: 320, h: 240 }]);
    expect(list).toEqual([
      { spot: "hall", at: 1, w: 320, h: 240 },
      { spot: "ram", at: 5000, w: 320, h: 240 },
    ]);
  });
});

// --- through the routes -----------------------------------------------------------

function fakeReq(body: unknown): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
    destroy() {},
  } as unknown as IncomingMessage;
}

/** One route, waiting for its answer: a frame is read off disk after `handle` returns. */
async function call(rt: EventRuntime, path: string): Promise<{ status: number; head: Record<string, string>; raw: Buffer }> {
  let status = 0;
  let head: Record<string, string> = {};
  let raw: Buffer = Buffer.alloc(0);
  let done: () => void = () => {};
  const answered = new Promise<void>((r) => (done = r));
  const res = {
    writeHead(s: number, h?: Record<string, string>) {
      status = s;
      head = h ?? {};
      return res;
    },
    setHeader() {},
    write() {
      return true;
    },
    end(b?: string | Buffer) {
      if (b !== undefined) raw = Buffer.isBuffer(b) ? b : Buffer.from(b);
      done();
      return res;
    },
  } as unknown as ServerResponse;
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq({}), res, "GET", url.pathname, url, { moderator: true, moderatorName: "Ada" });
  await answered;
  return { status, head, raw };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

describe("the camera routes while the dream runs", () => {
  async function dreaming() {
    const media = fresh();
    mkdirSync(join(media, "dream", "frames"), { recursive: true });
    const clock = { t: 1_800_000_000_000 };
    const rt = new EventRuntime({ eventId: "evt", store: new Store(fresh()), codes: CODES, scenarioName: SHOW, scenarioSource: scenarioSource(SHOW), joinBase: () => "http://localhost", now: () => clock.t, mediaDir: media });
    rt.openDoors();
    for (const spot of ["hall", "ram"]) writeFileSync(join(media, "dream", "frames", dreamFrameName(dreamFrameIndex(spot, clock.t))), JPEG);
    writeFileSync(join(media, "dream", "frames", dreamFrameName(1)), JPEG);
    rt.dreamFeed.ready();
    await new Promise((r) => setTimeout(r, 30));
    return { rt, clock };
  }

  it("leaves the feeds alone before the dream", { timeout: SLOW }, async () => {
    const { rt } = await dreaming();
    expect(JSON.parse((await call(rt, "/api/spatial/cams")).raw.toString())).toEqual({ cams: [] });
    expect((await call(rt, "/api/spatial/cam?spot=hall")).status).toBe(404);
  });

  it("feeds every terminal but the tent's, cameras or none, a frame of its own", { timeout: SLOW }, async () => {
    const { rt } = await dreaming();
    const r = rt as unknown as { sim: Sim };
    const out = await pressChain(TO_Y2K, async (name) => (r.sim.signal(name), { ok: true }), () => {});
    expect(out.ok).toBe(true);
    rt.screens.adopt(r.sim); // began before this boot: on at once, no takeover to wait for
    const list = JSON.parse((await call(rt, "/api/spatial/cams")).raw.toString()) as { cams: Array<{ spot: string; w: number; h: number }> };
    const spots = list.cams.map((c) => c.spot);
    expect(spots).toContain("hall");
    expect(spots).toContain("desktop-tv");
    expect(spots).not.toContain("tent");
    expect(list.cams[0]).toMatchObject({ w: 320, h: 240 });
    const frame = await call(rt, "/api/spatial/cam?spot=hall");
    expect(frame.status).toBe(200);
    expect(frame.head["content-type"]).toBe("image/jpeg");
    expect(frame.head["cache-control"]).toBe("no-store");
    expect(frame.head["x-cam-at"]).toBeDefined();
    expect(frame.raw[0]).toBe(0xff);
    expect((await call(rt, "/api/spatial/cam?spot=tent")).status).toBe(404);
    expect((await call(rt, "/api/spatial/cam?spot=upstairs-hall")).status).toBe(404); // a frame the set lacks: the terminal keeps its own screen
  });

  it("stops with 🌀", { timeout: SLOW }, async () => {
    const { rt } = await dreaming();
    const r = rt as unknown as { sim: Sim };
    await pressChain(TO_Y2K, async (name) => (r.sim.signal(name), { ok: true }), () => {});
    rt.screens.adopt(r.sim);
    r.sim.signal("dream_toggle");
    expect(JSON.parse((await call(rt, "/api/spatial/cams")).raw.toString())).toEqual({ cams: [] });
  });

  it("does nothing at all with no media folder", { timeout: SLOW }, async () => {
    const clock = { t: 1_800_000_000_000 };
    const rt = new EventRuntime({ eventId: "evt", store: new Store(fresh()), codes: CODES, scenarioName: SHOW, scenarioSource: scenarioSource(SHOW), joinBase: () => "http://localhost", now: () => clock.t, mediaDir: null });
    rt.openDoors();
    const r = rt as unknown as { sim: Sim };
    await pressChain(TO_Y2K, async (name) => (r.sim.signal(name), { ok: true }), () => {});
    rt.screens.adopt(r.sim);
    expect(JSON.parse((await call(rt, "/api/spatial/cams")).raw.toString())).toEqual({ cams: [] });
  });
});
