//! Clippy's dream on the server (wave 50, docs/loom-w50-contract.md): the
//! screen state's `dream` block and when the takeover falls, the story's
//! switch and its endings, and the games' feed down the camera routes.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it, vi } from "vitest";

import { dreamFrameIndex, dreamFrameName, dreamOffsetS } from "@loom/house";
import { DREAM_CHECK_MS, DREAM_SPURT_MAX_MS, DREAM_SPURT_MIN_MS, DreamFeed, dreamSpurting } from "../server/dream-feed.ts";
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
  const d = mkdtempSync(join(tmpdir(), "loom-w50-"));
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

/** The first moment from `from` the dream is (not) on `spot`. */
function when(spot: string, from: number, on: boolean): number {
  let t = from;
  while (dreamSpurting(spot, t) !== on) t += 100;
  return t;
}
const whenSpurting = (spot: string, from: number): number => when(spot, from, true);
const whenCalm = (spot: string, from: number): number => when(spot, from, false);

describe("the dream's spurts in the games: mostly the real room", () => {
  const HOUR = 3_600_000;
  const START = 1_800_000_000_000;
  const STEP = 100;
  const showSpots = (JSON.parse(readFileSync(join(import.meta.dirname, "../examples/trapped-in-the-internet/house.json"), "utf8")) as { terminals: Array<{ id: string }> }).terminals.map((t) => t.id);
  /** Every spurt of `spot` in an hour, as lengths (ms). */
  const spurts = (spot: string): number[] => {
    const out: number[] = [];
    let run = 0;
    // From a calm moment: a spurt already running at the start would read short.
    for (let t = whenCalm(spot, START); t < START + HOUR; t += STEP) {
      if (dreamSpurting(spot, t)) run += STEP;
      else if (run > 0) {
        out.push(run);
        run = 0;
      }
    }
    return out;
  };

  it("shows the room most of the time on every terminal", () => {
    for (const spot of showSpots) {
      const share = spurts(spot).reduce((a, b) => a + b, 0) / HOUR;
      expect(share, spot).toBeGreaterThan(0.08);
      expect(share, spot).toBeLessThan(0.17);
    }
  });

  it("is occasional: about one every 30 s on any terminal, so a player passing through sees one", () => {
    for (const spot of showSpots) {
      const n = spurts(spot).length;
      expect(n, spot).toBeGreaterThan(90);
      expect(n, spot).toBeLessThan(150);
    }
  });

  it("lasts seconds, and long enough for a terminal's next read of the feed list", () => {
    for (const spot of showSpots) {
      for (const ms of spurts(spot)) {
        expect(ms, spot).toBeGreaterThanOrEqual(DREAM_SPURT_MIN_MS - STEP);
        expect(ms, spot).toBeLessThanOrEqual(DREAM_SPURT_MAX_MS + STEP);
      }
    }
  });

  it("is no metronome: the gaps between one terminal's spurts vary", () => {
    let t = whenSpurting("hall", START);
    const starts: number[] = [];
    while (starts.length < 12) {
      starts.push(t);
      t = whenSpurting("hall", whenCalm("hall", t));
    }
    const gaps = starts.slice(1).map((v, i) => v - starts[i]!);
    expect(new Set(gaps.map((g) => Math.round(g / 1000))).size).toBeGreaterThan(5);
  });

  it("gives each terminal its own spurts: two walls only overlap by chance", () => {
    let both = 0;
    for (let t = START; t < START + HOUR; t += 1000) if (dreamSpurting("hall", t) && dreamSpurting("ram", t)) both += 1;
    expect(both / 3600).toBeLessThan(0.05);
  });

  it("is a pure function of the terminal and the time: a restart or a second game agrees", () => {
    const t = whenSpurting("ram", START);
    expect(dreamSpurting("ram", t)).toBe(true);
    expect(dreamSpurting("ram", t)).toBe(true);
    expect(dreamSpurting("ram", whenCalm("ram", t))).toBe(false);
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

  it("adds a terminal with no camera to the list only for a spurt, and keeps a real feed's entry", () => {
    const t = whenSpurting("ram", 5000);
    const { f, at } = feed({ now: t });
    const real = [{ spot: "hall", at: 1, w: 320, h: 240 }];
    expect(f.list(["hall", "ram"], real)).toEqual([real[0], { spot: "ram", at: t, w: 320, h: 240 }]);
    at(whenCalm("ram", t));
    expect(f.list(["hall", "ram"], real)).toEqual(real);
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
const DREAM_JPEG = Buffer.from([0xff, 0xd8, 0xd1, 0xff, 0xd9]);
const CAMERA_JPEG = Buffer.from([0xff, 0xd8, 0xca, 0xff, 0xd9]);

describe("the camera routes while the dream runs", () => {
  async function dreaming() {
    const media = fresh();
    mkdirSync(join(media, "dream", "frames"), { recursive: true });
    const clock = { t: 1_800_000_000_000 };
    const rt = new EventRuntime({ eventId: "evt", store: new Store(fresh()), codes: CODES, scenarioName: SHOW, scenarioSource: scenarioSource(SHOW), joinBase: () => "http://localhost", now: () => clock.t, mediaDir: media });
    rt.openDoors();
    for (const spot of ["hall", "ram"]) writeFileSync(join(media, "dream", "frames", dreamFrameName(dreamFrameIndex(spot, clock.t))), JPEG);
    writeFileSync(join(media, "dream", "frames", dreamFrameName(1)), JPEG);
    // `ready()` answers from its last look and starts the next: wait for that
    // look to land, not a fixed time (a full run's load outlasted 30 ms).
    await vi.waitFor(() => expect(rt.dreamFeed.ready()).toBe(true));
    return { rt, clock, media };
  }

  it("leaves the feeds alone before the dream", { timeout: SLOW }, async () => {
    const { rt } = await dreaming();
    expect(JSON.parse((await call(rt, "/api/spatial/cams")).raw.toString())).toEqual({ cams: [] });
    expect((await call(rt, "/api/spatial/cam?spot=hall")).status).toBe(404);
  });

  /** Press to 🕚 on a runtime, as a dream that began before this boot: on at once. */
  async function atTheHour(rt: EventRuntime): Promise<void> {
    const r = rt as unknown as { sim: Sim };
    const out = await pressChain(TO_Y2K, async (name) => (r.sim.signal(name), { ok: true }), () => {});
    expect(out.ok).toBe(true);
    rt.screens.adopt(r.sim);
  }
  /** Put the clock at `t` with a frame of `spot` on disk for it, and a live camera on `hall`. */
  function moveTo(rt: EventRuntime, clock: { t: number }, media: string, spot: string, t: number): void {
    clock.t = t;
    writeFileSync(join(media, "dream", "frames", dreamFrameName(dreamFrameIndex(spot, t))), DREAM_JPEG);
    rt.cams.put("hall", CAMERA_JPEG, 320, 240);
  }
  const listed = async (rt: EventRuntime): Promise<string[]> => (JSON.parse((await call(rt, "/api/spatial/cams")).raw.toString()) as { cams: Array<{ spot: string }> }).cams.map((c) => c.spot);

  it("shows the real camera between spurts, and the terminal's own moment in one", { timeout: SLOW }, async () => {
    const { rt, clock, media } = await dreaming();
    await atTheHour(rt);
    moveTo(rt, clock, media, "hall", whenCalm("hall", clock.t));
    expect((await call(rt, "/api/spatial/cam?spot=hall")).raw).toEqual(CAMERA_JPEG);
    moveTo(rt, clock, media, "hall", whenSpurting("hall", clock.t));
    const spurt = await call(rt, "/api/spatial/cam?spot=hall");
    expect(spurt.status).toBe(200);
    expect(spurt.raw).toEqual(DREAM_JPEG);
    expect(spurt.head["content-type"]).toBe("image/jpeg");
    expect(spurt.head["cache-control"]).toBe("no-store");
    expect(spurt.head["x-cam-at"]).toBeDefined();
    moveTo(rt, clock, media, "hall", whenCalm("hall", clock.t));
    expect((await call(rt, "/api/spatial/cam?spot=hall")).raw).toEqual(CAMERA_JPEG);
  });

  it("gives a terminal with no camera its spurts, and its usual screen between them", { timeout: SLOW }, async () => {
    const { rt, clock, media } = await dreaming();
    await atTheHour(rt);
    moveTo(rt, clock, media, "ram", whenSpurting("ram", clock.t));
    expect(await listed(rt)).toContain("ram");
    expect((await call(rt, "/api/spatial/cam?spot=ram")).raw).toEqual(DREAM_JPEG);
    moveTo(rt, clock, media, "ram", whenCalm("ram", clock.t));
    expect(await listed(rt)).not.toContain("ram");
    expect((await call(rt, "/api/spatial/cam?spot=ram")).status).toBe(404);
  });

  it("never touches the tent", { timeout: SLOW }, async () => {
    const { rt, clock, media } = await dreaming();
    await atTheHour(rt);
    moveTo(rt, clock, media, "tent", whenSpurting("tent", clock.t));
    expect(await listed(rt)).not.toContain("tent");
    expect((await call(rt, "/api/spatial/cam?spot=tent")).status).toBe(404);
  });

  it("falls back on the camera when the set is short a frame", { timeout: SLOW }, async () => {
    const { rt, clock } = await dreaming();
    await atTheHour(rt);
    clock.t = whenSpurting("hall", clock.t + 3_600_000); // no frame on disk for this moment
    rt.cams.put("hall", CAMERA_JPEG, 320, 240);
    expect((await call(rt, "/api/spatial/cam?spot=hall")).raw).toEqual(CAMERA_JPEG);
  });

  it("stops with 🌀: the camera again, in what would have been a spurt", { timeout: SLOW }, async () => {
    const { rt, clock, media } = await dreaming();
    await atTheHour(rt);
    moveTo(rt, clock, media, "hall", whenSpurting("hall", clock.t));
    expect((await call(rt, "/api/spatial/cam?spot=hall")).raw).toEqual(DREAM_JPEG);
    (rt as unknown as { sim: Sim }).sim.signal("dream_toggle");
    expect((await call(rt, "/api/spatial/cam?spot=hall")).raw).toEqual(CAMERA_JPEG);
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
