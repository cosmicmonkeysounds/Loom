// The audio ads on the server (wave 59a, docs/loom-w59-ads-contract.md): the sacred
// rule, the draws, the hub on its own, then the real show through a real runtime,
// from 📓 to the final reveal, a restart and a story reload.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { TO_HUNT2, TO_Y2K } from "../../scripts/accept/chains.ts";
import { scenarioSource } from "../examples/load.ts";
import { AdsHub, adsGapOf, type AdsNow } from "../server/audio-ads.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { HERE_TTL_MS } from "../server/prompter.ts";
import { Store } from "../server/store.ts";
import { ADS_GAP_MAX_MS, ADS_GAP_MIN_MS, AD_ANNOUNCE_HOLD_MS, AD_LEAD_MS, AD_REPLACE_LEFT_MS, AD_STANDING_SLIDE_HOLD_MS, AUDIO_ADS, adPhoneCount, adTerminal, adWallCount, type AdFrame, type AdOffer, type AdOnAir } from "../src/audio-ads.ts";
import { PLAY_CSP, TERMINAL_CSP } from "../server/routing.ts";

const CODES = { event: "GUEST1", prime: "PRIME1", mod: "MOD111" };
const SRC = scenarioSource("trapped-in-the-internet");
const SLOW = 180_000;
const dirs: string[] = [];
const live: EventRuntime[] = [];
afterAll(() => {
  for (const rt of live) rt.dispose();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** The same dice every run. */
function dice(seed = 1): () => number {
  let x = seed;
  return () => {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

describe("the files", () => {
  it("are the fourteen of ads-media.sh", () => {
    const script = readFileSync(new URL("../../scripts/ops/ads-media.sh", import.meta.url), "utf8");
    const files = [...script.matchAll(/\|(ad-\d\d-[a-z0-9-]+\.mp3)"/gu)].map((m) => m[1]);
    expect(files).toEqual(AUDIO_ADS.map((a) => a.file));
    expect(AUDIO_ADS.map((a) => a.n)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  });
  it("the shortest gap outlasts the longest ad, so two never overlap", () => {
    expect(Math.max(...AUDIO_ADS.map((a) => a.seconds)) * 1000 + AD_LEAD_MS).toBeLessThan(ADS_GAP_MIN_MS);
  });
});

describe("the sacred rule", () => {
  // The user: "Remember the TV and Tent and Server Room are sacred." Every line of
  // this table is a terminal that must never hear an ad, whatever else it says.
  const NEVER: Array<{ view: string; spot: string; room?: string }> = [
    { view: "tv", spot: "desktop-tv" },
    { view: "tv", spot: "" },
    { view: "tv", spot: "hall" },
    { view: "auto", spot: "desktop-tv" },
    { view: "face", spot: "desktop-tv" },
    { view: "reinstall", spot: "tent" },
    { view: "reinstall", spot: "hall" },
    { view: "reinstall", spot: "" },
    { view: "auto", spot: "tent" },
    { view: "face", spot: "tent" },
    { view: "chess", spot: "tent" },
    { view: "auto", spot: "server-room" },
    { view: "face", spot: "server-room" },
    { view: "auto", spot: "server-room-door" },
    { view: "chess", spot: "server-room-door" },
    { view: "auto", spot: "server-room-2" },
    { view: "auto", spot: "SERVER-ROOM" },
    { view: "chess", spot: " Server-Room-Door " },
    { view: "auto", spot: "x", room: "The Server Room" },
    { view: "mirror", spot: "hall" },
    { view: "auto", spot: "" },
    { view: "auto", spot: "   " },
    { view: "", spot: "" },
  ];
  for (const t of NEVER) it(`never ${JSON.stringify(t)}`, () => expect(adTerminal(t)).toBe(false));
  it("the map's every wall that may play, and only those", () => {
    const house = JSON.parse(readFileSync(new URL("../examples/trapped-in-the-internet/house.json", import.meta.url), "utf8")) as { terminals: Array<{ id: string; view?: string }> };
    expect(house.terminals.filter((t) => adTerminal({ view: t.view ?? "auto", spot: t.id })).map((t) => t.id).sort()).toEqual(["backyard", "bathroom-1-door", "cpu", "graphics-card", "hall", "optical-drive", "ram", "start-bar", "steam-room", "upstairs-hall"]);
  });
});

describe("the page's rules", () => {
  it("a terminal and a phone may play from /media/, and a phone's first tap its silence", () => {
    const media = (csp: string) => csp.split("; ").find((d) => d.startsWith("media-src"));
    expect(media(TERMINAL_CSP)).toContain("'self'");
    expect(media(PLAY_CSP)).toBe("media-src 'self' data:");
  });
  it("the service worker never sees a fetch, so an MP3 is never cached by it", () => {
    const sw = readFileSync(new URL("../../play/public/sw.js", import.meta.url), "utf8");
    expect(sw).not.toMatch(/addEventListener\(\s*["']fetch["']/u);
  });
});

describe("the counts", () => {
  it("a quarter of the phones, at least two, never more than there are", () => {
    expect([0, 1, 2, 3, 8, 9, 30, 31].map(adPhoneCount)).toEqual([0, 1, 2, 2, 2, 3, 8, 8]);
  });
  it("one to three walls, never more than there are", () => {
    expect([0, 0.34, 0.67, 0.999].map((d) => adWallCount(9, d))).toEqual([1, 2, 3, 3]);
    expect(adWallCount(2, 0.999)).toBe(2);
    expect(adWallCount(0, 0.999)).toBe(0);
  });
  it("a scratch server's gaps come off the env, and nothing else moves the show's", () => {
    expect(adsGapOf("20-40")).toEqual({ min: 20_000, max: 40_000 });
    for (const bad of [undefined, "", "soon", "40-20", "0-5"]) expect(adsGapOf(bad)).toEqual({ min: ADS_GAP_MIN_MS, max: ADS_GAP_MAX_MS });
  });
});

describe("the hub", () => {
  const WALLS = ["a", "b", "c", "d", "e"];
  const PHONES = Array.from({ length: 12 }, (_, i) => `p${i}`);
  const at = (story: number, o: Partial<AdsNow> = {}): AdsNow => ({ now: 1_000_000 + story, story, running: true, hold: null, walls: WALLS, phones: PHONES, ...o });
  /** Beat by beat from `from` until one starts: when. */
  const untilPop = (h: AdsHub, from: number, o: Partial<AdsNow> = {}): number => {
    for (let t = from; t < from + 2 * ADS_GAP_MAX_MS; t += 1000) if (h.tick(at(t, o))?.kind === "start") return t;
    throw new Error("nothing started");
  };
  /** Pop after pop, each to its end: the ads in order, and the gaps. */
  const night = (h: AdsHub, pops: number) => {
    const ns: number[] = [];
    const gaps: number[] = [];
    let last = 0;
    h.tick(at(0));
    for (let i = 0; i < pops; i++) {
      const t = untilPop(h, last + 1000);
      gaps.push(t - last);
      ns.push(h.air!.n);
      h.tick(at(t + 1000, { now: h.air!.until }));
      last = t;
    }
    return { ns, gaps };
  };

  it("every gap is its own draw between 3 and 10 minutes, the first one too", () => {
    const { gaps } = night(new AdsHub(dice(7)), 60);
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(ADS_GAP_MIN_MS);
      expect(g).toBeLessThanOrEqual(ADS_GAP_MAX_MS + 1000);
    }
    expect(new Set(gaps).size).toBeGreaterThan(40);
    expect(Math.min(...gaps)).toBeLessThan(ADS_GAP_MIN_MS + 60_000);
    expect(Math.max(...gaps)).toBeGreaterThan(ADS_GAP_MAX_MS - 60_000);
  });

  it("random order, and none repeats until all 14 have played, pass after pass", () => {
    const { ns } = night(new AdsHub(dice(3)), 14 * 4);
    for (let p = 0; p < 4; p++) expect([...ns.slice(p * 14, (p + 1) * 14)].sort((x, y) => x - y)).toEqual(AUDIO_ADS.map((a) => a.n));
    expect(ns.slice(0, 14)).not.toEqual(AUDIO_ADS.map((a) => a.n));
    expect(ns.slice(0, 14)).not.toEqual(ns.slice(14, 28));
    for (let i = 1; i < ns.length; i++) expect(ns[i]).not.toBe(ns[i - 1]);
  });

  it("two nights don't play alike", () => {
    expect(night(new AdsHub(dice(11)), 14).ns).not.toEqual(night(new AdsHub(dice(12)), 14).ns);
  });

  it("tells every screen ahead, and ends on its time", () => {
    const h = new AdsHub(dice());
    h.tick(at(0));
    const t = untilPop(h, 1000);
    const a = h.air!;
    const ad = AUDIO_ADS[a.n - 1]!;
    expect(a.at).toBe(at(t).now + AD_LEAD_MS);
    expect(a.until).toBe(a.at + Math.round(ad.seconds * 1000));
    expect(a.url).toBe(`/media/ads/${ad.file}`);
    h.tick(at(t + 1000, { now: a.until }));
    expect(h.air).toBeNull();
  });

  it("one at a time: nothing starts while one is on the air", () => {
    const h = new AdsHub(() => 0);
    h.tick(at(0));
    const t = untilPop(h, 1000);
    expect(h.tick(at(t + ADS_GAP_MAX_MS, { now: at(t).now + 1000 }))).toBeNull();
  });

  it("a held pop starts the moment it can, not a gap later", () => {
    const h = new AdsHub(() => 0);
    h.tick(at(0));
    expect(h.tick(at(ADS_GAP_MIN_MS, { hold: "talk" }))).toBeNull();
    expect(h.tick(at(ADS_GAP_MIN_MS + 30_000, { hold: "speaking" }))).toBeNull();
    expect(h.tick(at(ADS_GAP_MIN_MS + 31_000))?.kind).toBe("start");
  });

  it("with nobody to hear it, it waits and nothing is spent", () => {
    const h = new AdsHub(() => 0);
    h.tick(at(0));
    expect(h.tick(at(ADS_GAP_MIN_MS, { walls: [], phones: [] }))).toBeNull();
    expect(h.aired).toBe(0);
    expect(h.tick(at(ADS_GAP_MIN_MS + 1000, { walls: [], phones: ["p0"] }))?.kind).toBe("start");
  });

  it("a hold stops what is on the air, and that one stays spent", () => {
    const h = new AdsHub(() => 0);
    h.tick(at(0));
    const t = untilPop(h, 1000);
    expect(h.tick(at(t + 1000, { hold: "announcement" }))).toEqual({ kind: "stop" });
    expect(h.air).toBeNull();
    expect(h.aired).toBe(1);
    expect(h.tick(at(t + 2000))).toBeNull();
  });

  it("the window's end cuts it, and nothing more starts", () => {
    const h = new AdsHub(() => 0);
    h.tick(at(0));
    const t = untilPop(h, 1000);
    expect(h.tick(at(t + 1000, { running: false }))).toEqual({ kind: "stop" });
    expect(h.tick(at(t + ADS_GAP_MAX_MS * 2, { running: false }))).toBeNull();
  });

  it("Off stops it and holds them; On lets the next start as soon as its time has come", () => {
    const h = new AdsHub(() => 0);
    h.tick(at(0));
    const t = untilPop(h, 1000);
    h.setOn(false);
    expect(h.air).toBeNull();
    expect(h.tick(at(t + ADS_GAP_MAX_MS))).toBeNull();
    h.setOn(true);
    expect(h.tick(at(t + ADS_GAP_MAX_MS + 1000))?.kind).toBe("start");
    expect(h.aired).toBe(2);
  });

  it("a replay keeps the pass: what played stays played, and the gap runs from the last pop", () => {
    const h = new AdsHub(() => 0);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) h.replayAired(n, 600_000);
    h.replaySwitched(false);
    h.replaySwitched(true);
    expect(h.tick(at(600_000 + ADS_GAP_MIN_MS - 1))).toBeNull();
    const next = h.tick(at(600_000 + ADS_GAP_MIN_MS));
    expect(next?.kind === "start" && next.ad.n).toBe(14);
  });

  it("a replay of a whole pass and more lands in the new pass", () => {
    const h = new AdsHub(dice(5));
    const pass = AUDIO_ADS.map((a) => a.n);
    for (const n of [...pass, 3]) h.replayAired(n, 600_000);
    expect(h.aired).toBe(15);
    const { ns } = night(h, 13);
    expect([...ns, 3].sort((x, y) => x - y)).toEqual(pass);
  });

  it("a story reload is a new night, switched on", () => {
    const h = new AdsHub(dice());
    h.replayAired(5, 600_000);
    h.replaySwitched(false);
    h.reset();
    expect(h.status(false, null)).toMatchObject({ on: true, aired: 0 });
  });

  describe("who hears it", () => {
    const pop = (h: AdsHub, o: Partial<AdsNow> = {}) => {
      h.tick(at(0, o));
      for (let t = 1000; t < 2 * ADS_GAP_MAX_MS; t += 1000) {
        const s = h.tick(at(t, o));
        if (s?.kind === "start") return s;
      }
      throw new Error("nothing started");
    };

    it("one to three walls, a fresh draw each pop, and only those walls get it", () => {
      const sizes = new Set<number>();
      const seen = new Set<string>();
      for (let i = 1; i < 60; i++) {
        const h = new AdsHub(dice(i));
        pop(h);
        const on = WALLS.filter((w) => h.onWall(w) !== null);
        expect(on.length).toBeGreaterThanOrEqual(1);
        expect(on.length).toBeLessThanOrEqual(3);
        sizes.add(on.length);
        seen.add(on.join());
        expect(h.onWall("nobody")).toBeNull();
      }
      expect([...sizes].sort()).toEqual([1, 2, 3]);
      expect(seen.size).toBeGreaterThan(10);
    });

    it("no wall stays picked once it is over", () => {
      const h = new AdsHub(dice());
      pop(h);
      h.cut();
      expect(WALLS.filter((w) => h.onWall(w) !== null)).toEqual([]);
    });

    it("a random quarter of the phones, at least two, not the same ones each time", () => {
      const heard = new Set<string>();
      for (let i = 1; i < 30; i++) {
        const s = pop(new AdsHub(dice(i)));
        expect(s.phones.length).toBe(3);
        expect(new Set(s.phones).size).toBe(3);
        for (const p of s.phones) heard.add(p);
      }
      expect(heard.size).toBe(PHONES.length);
      expect(pop(new AdsHub(dice()), { phones: ["x", "y", "z"] }).phones.length).toBe(2);
      expect(pop(new AdsHub(dice()), { phones: ["x"] }).phones).toEqual(["x"]);
    });

    it("a pop with no walls still plays on the phones, and with no phones on the walls", () => {
      expect(pop(new AdsHub(dice()), { walls: [] }).phones.length).toBe(3);
      const h = new AdsHub(dice());
      expect(pop(h, { phones: [] }).phones).toEqual([]);
      expect(WALLS.filter((w) => h.onWall(w) !== null).length).toBeGreaterThan(0);
    });

    it("a busy phone is replaced by one not yet offered it, once", () => {
      const h = new AdsHub(dice());
      const asked = pop(h).phones;
      const seq = h.air!.seq;
      const next = h.replace(asked[0]!, seq, PHONES, h.air!.at)!;
      expect(PHONES).toContain(next);
      expect(asked).not.toContain(next);
      expect(h.replace(asked[1]!, seq + 1, PHONES, h.air!.at)).toBeNull();
      expect(h.replace(PHONES.find((p) => !asked.includes(p) && p !== next)!, seq, PHONES, h.air!.at)).toBeNull();
    });

    it("gives up near the end, and with nobody left", () => {
      const h = new AdsHub(dice());
      const asked = pop(h, { phones: ["a", "b"] }).phones;
      const seq = h.air!.seq;
      expect(h.replace(asked[0]!, seq, ["a", "b"], h.air!.at)).toBeNull();
      expect(h.replace(asked[1]!, seq, ["a", "b", "c"], h.air!.until - AD_REPLACE_LEFT_MS + 1)).toBeNull();
    });

    it("the frame says when in server ms, so a phone can tell how late it is", () => {
      const h = new AdsHub(dice());
      expect(h.frame(5)).toBeNull();
      pop(h);
      const a = h.air!;
      expect(h.frame(a.at + 5000)).toEqual({ seq: a.seq, n: a.n, name: a.name, url: a.url, at: a.at, until: a.until, now: a.at + 5000 });
    });

    it("a stream opens on the server's time, and on a stop with nothing on the air", () => {
      const h = new AdsHub(dice());
      expect(h.hello(9)).toEqual({ stop: true, now: 9 });
      pop(h);
      expect(h.hello(9)).toEqual({ now: 9 });
    });
  });
});

// --- the real show, through a real runtime ---------------------------------

function fakeReq(body: unknown): IncomingMessage {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return { headers: {}, socket: { remoteAddress: "127.0.0.1" }, on() {}, [Symbol.asyncIterator]: async function* () { yield* chunks; } } as unknown as IncomingMessage;
}
type Frame = { event: string; data: unknown };
function res() {
  let pending: string | null = null;
  const r = {
    statusCode: 200,
    body: "",
    frames: [] as Frame[],
    setHeader() {},
    once() {},
    on() {},
    flushHeaders() {},
    writeHead(s: number) {
      r.statusCode = s;
      return r;
    },
    write(chunk: string) {
      const ev = /^event: (\S+)\n$/u.exec(chunk);
      if (ev) pending = ev[1]!;
      const data = /^data: (.*)\n\n$/su.exec(chunk);
      if (data && pending !== null) r.frames.push({ event: pending, data: JSON.parse(data[1]!) });
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") r.body = b;
      return r;
    },
  };
  return r as unknown as ServerResponse & typeof r;
}

class Night {
  t = 1_800_000_000_000;
  readonly rt: EventRuntime;
  readonly store: Store;
  /** The walls that keep polling while the night runs. */
  walls: Array<[view: string, spot: string, extra?: string]> = [];
  constructor(readonly dir = mkdtempSync(join(tmpdir(), "loom-w59a-")), open = true) {
    dirs.push(dir);
    this.store = new Store(dir);
    this.rt = new EventRuntime({ eventId: "evt", store: this.store, codes: CODES, scenarioName: "titi", scenarioSource: SRC, joinBase: () => "http://localhost", now: () => this.t });
    live.push(this.rt);
    if (open) this.rt.openDoors();
  }
  async post(path: string, body: unknown, moderator = false) {
    const r = res();
    await this.rt.handle(fakeReq(body), r, "POST", path, new URL(`http://x${path}`), { moderator });
    return { status: r.statusCode, json: JSON.parse(r.body || "{}") as Record<string, unknown> };
  }
  async get(pathAndQuery: string, moderator = false) {
    const r = res();
    const url = new URL(`http://x${pathAndQuery}`);
    await this.rt.handle(fakeReq({}), r, "GET", url.pathname, url, { moderator });
    return r;
  }
  async guest(name: string) {
    const g = (await this.post("/api/guest/register", { name, passcode: CODES.event })).json as { id: string; token: string };
    return { ...g, stream: await this.get(`/events?role=guest&token=${encodeURIComponent(g.token)}`) };
  }
  async press(names: readonly string[]) {
    for (const name of names) await this.post("/api/mod/signal", { name }, true);
  }
  async toHunt2() {
    await this.press(TO_HUNT2);
    expect(this.rt.liveSim!.world.peek("Night.phase")).toMatchObject({ value: "hunt_2" });
  }
  /** `s` seconds of story and wall clock, a beat at a time, the walls polling every other one. */
  async run(s: number): Promise<void> {
    for (let i = 0; i < s; i++) {
      this.t += 1000;
      if (i % 2 === 0) for (const [view, spot, extra] of this.walls) await this.wall(view, spot, extra);
      this.rt.tickOnce(1000);
    }
  }
  /** Until an ad goes out, at most `s` seconds. */
  async untilAired(aired: number, s = 900): Promise<void> {
    for (let i = 0; i < s && this.rt.ads.aired < aired; i++) await this.run(1);
    expect(this.rt.ads.aired).toBe(aired);
  }
  async wall(view = "auto", spot = "start-bar", extra = ""): Promise<{ ad?: AdOnAir | null }> {
    return JSON.parse((await this.get(`/api/screen/state?name=${view}-${spot}&view=${view}&spot=${spot}${extra}`, true)).body) as { ad?: AdOnAir | null };
  }
  async ads() {
    return (JSON.parse((await this.get("/api/mod/screen/terminals", true)).body) as { ads: Record<string, unknown> }).ads;
  }
}
const adFrames = (r: { frames: Frame[] }) => r.frames.filter((f) => f.event === "ad").map((f) => f.data as AdFrame);
const offers = (r: { frames: Frame[] }) => adFrames(r).filter((f): f is AdOffer => "seq" in f);
const STOP = expect.objectContaining({ stop: true });
const OPEN_WALLS: Array<[string, string]> = [["auto", "start-bar"], ["auto", "cpu"], ["auto", "hall"], ["auto", "ram"], ["casino", "graphics-card"]];
const SACRED: Array<[string, string, string?]> = [["tv", "desktop-tv", "&voice=The%20Desktop"], ["face", "server-room", "&room=The%20Server%20Room"], ["chess", "server-room-door"], ["reinstall", "tent"], ["auto", "tent"]];

describe("the night", () => {
  it(
    "nothing before the hunt; then 1 to 3 walls and a quarter of the phones; the sacred terminals never",
    async () => {
      const n = new Night();
      const gs = [];
      for (const name of ["Ada", "Bea", "Cy", "Dot", "Eve", "Fay", "Gus", "Hal", "Ivy"]) gs.push(await n.guest(name));
      n.walls = [...OPEN_WALLS, ...SACRED];
      await n.run(120);
      expect((await n.wall()).ad).toBeNull();
      await n.toHunt2();
      await n.run(ADS_GAP_MIN_MS / 1000 - 5);
      expect(n.rt.ads.aired).toBe(0);
      await n.untilAired(1, ADS_GAP_MAX_MS / 1000);
      const air = n.rt.ads.air!;
      const playing = OPEN_WALLS.map(([v, s]) => n.wall(v, s));
      const on = (await Promise.all(playing)).filter((w) => w.ad !== null);
      expect(on.length).toBeGreaterThanOrEqual(1);
      expect(on.length).toBeLessThanOrEqual(3);
      expect(on[0]!.ad).toMatchObject({ seq: air.seq, n: air.n, name: air.name, url: air.url });
      for (const [v, s, x] of SACRED) expect((await n.wall(v, s, x)).ad, `${v} ${s}`).toBeUndefined();
      expect((await n.wall("auto", "start-bar-new")).ad).toBeNull(); // a wall the pop didn't pick
      const told = gs.filter((g) => offers(g.stream).length === 1);
      expect(told.length).toBe(3);
      expect(offers(told[0]!.stream)[0]).toMatchObject({ seq: air.seq, n: air.n, at: air.at, until: air.until });
    },
    SLOW,
  );

  it(
    "a whole pass in random order and at random gaps, and nothing reaches the chat or the story",
    async () => {
      const n = new Night();
      const [a, b] = [await n.guest("Ada"), await n.guest("Bea")];
      await n.run(120);
      await n.toHunt2();
      const chat = n.rt.liveSim!.log.len();
      await n.untilAired(14, 14 * ADS_GAP_MAX_MS / 1000 + 600);
      const heard = offers(a.stream).map((f) => f.n);
      expect(heard.length).toBe(14);
      expect(new Set(heard).size).toBe(14);
      expect(offers(b.stream).map((f) => f.n)).toEqual(heard);
      expect(heard).not.toEqual(AUDIO_ADS.map((x) => x.n));
      const starts = offers(a.stream).map((f) => f.at);
      const gaps = starts.slice(1).map((s, i) => s - starts[i]!);
      for (const g of gaps) expect(g).toBeGreaterThanOrEqual(ADS_GAP_MIN_MS);
      expect(new Set(gaps).size).toBeGreaterThan(1);
      const journal = n.store.readJournal().filter((e) => e.m === "signal" && e.a[0] === "audio_ad_aired");
      expect(journal.length).toBe(14);
      expect(n.rt.liveSim!.log.len()).toBeGreaterThan(chat);
      expect(n.store.readJournal().filter((e) => e.m === "say" || e.m === "broadcast").some((e) => JSON.stringify(e.a).includes("Mommy"))).toBe(false);
    },
    SLOW,
  );

  it(
    "the window runs on past the summons, Truth Pong and into the Y2K hour, and shuts for good at 🌑",
    async () => {
      const n = new Night();
      const g = await n.guest("Ada");
      await n.guest("Bea");
      await n.run(120);
      await n.toHunt2();
      await n.press(["five_minute_warning"]);
      await n.run(5);
      expect(await n.ads()).toMatchObject({ running: true });
      await n.press(["summons_closed", "truth_pong"]);
      await n.untilAired(1);
      await n.press(TO_Y2K.slice(TO_HUNT2.length + 3));
      expect(n.rt.liveSim!.world.peek("Night.phase")).toMatchObject({ value: "y2k" });
      expect(await n.ads()).toMatchObject({ running: true });
      // The Y2K clock is a slide the walls keep up for the hour: it holds them only a while.
      const before = n.rt.ads.aired;
      await n.run(AD_STANDING_SLIDE_HOLD_MS / 1000 - 5);
      expect((await n.ads())["hold"]).toBe("cutscene");
      expect(n.rt.ads.aired).toBe(before);
      await n.run(6);
      expect((await n.ads())["hold"]).not.toBe("cutscene");
      await n.untilAired(before + 1, 2 * ADS_GAP_MAX_MS / 1000);
      expect(n.rt.ads.air).not.toBeNull();
      expect(offers(g.stream).length).toBeGreaterThan(1);

      await n.press(["final_reveal"]);
      await n.run(1);
      expect(n.rt.ads.air).toBeNull();
      expect(adFrames(g.stream).at(-1)).toEqual(STOP);
      expect(await n.ads()).toMatchObject({ running: false });
      const aired = n.rt.ads.aired;
      await n.run(2 * ADS_GAP_MAX_MS / 1000);
      expect(n.rt.ads.aired).toBe(aired);
    },
    SLOW,
  );

  it(
    "an ending that comes first shuts it too",
    async () => {
      const n = new Night();
      await n.guest("Ada");
      await n.guest("Bea");
      await n.run(120);
      await n.press(TO_Y2K);
      expect(await n.ads()).toMatchObject({ running: true });
      await n.press(["patch_combo_a"]);
      expect(await n.ads()).toMatchObject({ running: false });
      await n.run(2 * ADS_GAP_MAX_MS / 1000);
      expect(n.rt.ads.aired).toBe(0);
    },
    SLOW,
  );

  it(
    "paused doors stop it at once, say so, and hold; ■ cuts this one and leaves the rest",
    async () => {
      const n = new Night();
      const g = await n.guest("Ada");
      await n.guest("Bea");
      await n.run(120);
      await n.toHunt2();
      await n.untilAired(1);
      await n.post("/api/mod/stop", {}, true);
      expect(n.rt.ads.air).toBeNull();
      expect(adFrames(g.stream).at(-1)).toEqual(STOP);
      expect(await n.ads()).toMatchObject({ hold: "doors", running: true, playing: null });
      await n.post("/api/mod/start", {}, true);
      await n.untilAired(2);
      expect((await n.post("/api/mod/audio/stop", {}, true)).status).toBe(200);
      expect(n.rt.ads.air).toBeNull();
      expect(n.rt.ads.status(true, null)).toMatchObject({ on: true, aired: 2 });
      await n.untilAired(3);
      await n.post("/api/mod/broadcast", { scope: "everyone", cue: "📣 Lost and found is at the kitchen." }, true);
      await n.run(1);
      expect(n.rt.ads.air).toBeNull();
      expect((await n.ads())["hold"]).toBe("announcement");
      await n.run(Math.ceil(AD_ANNOUNCE_HOLD_MS / 1000) + 1);
      expect((await n.ads())["hold"]).toBeNull();
    },
    SLOW,
  );

  it(
    "his scripted lines on the TV hold them, by its own word and by the lines' length, and a dead TV can't",
    async () => {
      const n = new Night();
      await n.guest("Ada");
      await n.run(120);
      await n.toHunt2();
      // No TV: the chain's lines, pressed all at once, take their length to say.
      await n.run(5);
      for (let i = 0; i < 3600 && (await n.ads())["hold"] !== null; i += 10) await n.run(10);
      expect((await n.ads())["hold"]).toBeNull();

      // A real beat of his, with no TV there at all: the lines' own length.
      await n.post("/api/mod/beat", { name: "Trabolta Greeting" }, true);
      await n.run(1);
      expect((await n.ads())["hold"]).toBe("speaking");
      expect(n.rt.ads.air).toBeNull();

      // A TV that reports is believed: `talk=1`, whatever `said=` reads, then `talk=0` at once.
      await n.wall("tv", "desktop-tv", "&voice=The%20Desktop&talk=1&said=0");
      expect((await n.ads())["hold"]).toBe("speaking");
      await n.wall("tv", "desktop-tv", "&voice=The%20Desktop&talk=0&said=0");
      expect((await n.ads())["hold"]).toBeNull();

      // A TV stuck on `talk=1` that stops polling lets go.
      await n.wall("tv", "desktop-tv", "&voice=The%20Desktop&talk=1&said=0");
      expect((await n.ads())["hold"]).toBe("speaking");
      await n.run(600);
      expect((await n.ads())["hold"]).toBeNull();
    },
    SLOW,
  );

  it(
    "a real reader on the prompter holds them with no time cap; a phone that dies lets go",
    async () => {
      const n = new Night();
      await n.guest("Ada");
      await n.guest("Bea");
      const clippy = (await n.post("/api/prime/login", { character: "Clippy", passcode: CODES.prime })).json.token as string;
      const booth = await n.get(`/events?role=prime&token=${encodeURIComponent(clippy)}`);
      n.walls = [["auto", "start-bar"]]; // a screen poll is what moves the prompter's clock here
      await n.run(120);
      await n.toHunt2();
      const scene = booth.frames.filter((f) => f.event === "prompter" && f.data !== null).map((f) => f.data as { id: number }).at(-1)!;
      expect(scene).toBeDefined();
      const post = async () => {
        const r = res();
        await n.rt.handle(fakeReq({ scene: scene.id, op: "here", open: true, token: clippy }), r, "POST", "/api/aloud", new URL("http://x/api/aloud"), {});
        expect(r.statusCode).toBe(200);
      };
      // Twenty minutes on her phone, far past any gap, and past the old five-minute cap.
      for (let i = 0; i < 300; i++) {
        await post();
        await n.run(4);
        expect(n.rt.ads.air).toBeNull();
      }
      expect((await n.ads())["hold"]).toBe("reading");
      expect(n.rt.ads.aired).toBe(0);
      // Her phone dies: `inUse` lets go, and the pop that waited starts.
      await n.run(Math.ceil(HERE_TTL_MS / 1000) + 2);
      expect((await n.ads())["hold"]).not.toBe("reading");
      await n.untilAired(1, ADS_GAP_MAX_MS / 1000);
    },
    SLOW,
  );

  it(
    "a phone that can't take it hands it to another; a locked one and a host are never asked",
    async () => {
      const n = new Night();
      const gs = [await n.guest("Ada"), await n.guest("Bea"), await n.guest("Cy"), await n.guest("Dot"), await n.guest("Eve")];
      const task = (await n.post("/api/prime/login", { character: "Task Manager", passcode: CODES.prime })).json.token as string;
      const host = await n.get(`/events?role=prime&token=${encodeURIComponent(task)}`);
      await n.run(120);
      await n.toHunt2();
      await n.untilAired(1);
      expect(offers(host)).toEqual([]);
      expect(gs.filter((g) => offers(g.stream).length > 0).length).toBe(2);
      n.rt.ads.cut();
      const locked = gs[0]!;
      n.rt.liveSim!.setVar(`${locked.id}.corrupted`, "true");
      const others = offers(locked.stream).length;
      for (let i = 2; i < 6; i++) {
        await n.untilAired(i);
        n.rt.ads.cut();
      }
      expect(offers(locked.stream).length).toBe(others);
      await n.untilAired(6);
      const seq = n.rt.ads.air!.seq;
      const before = gs.reduce((k, g) => k + offers(g.stream).length, 0);
      const asked = gs.find((g) => offers(g.stream).some((f) => f.seq === seq))!;
      expect((await n.post("/api/ad/busy", { seq, token: asked.token })).status).toBe(200);
      expect(gs.reduce((k, g) => k + offers(g.stream).length, 0)).toBe(before + 1);
      expect((await n.post("/api/ad/busy", { seq })).status).toBe(401);
    },
    SLOW,
  );

  it(
    "📢 Off is journaled, a director's or a host's, stops every phone even with nothing on the air, and a restart keeps it",
    async () => {
      const n = new Night();
      const g = await n.guest("Ada");
      await n.guest("Bea");
      await n.run(120);
      await n.toHunt2();
      await n.untilAired(1);
      const played = n.rt.ads.air!.n;
      expect((await n.post("/api/mod/screen/ads", { on: false })).status).toBe(403);
      expect((await n.post("/api/mod/screen/ads", { on: false, token: g.token })).status).toBe(403);
      const task = (await n.post("/api/prime/login", { character: "Task Manager", passcode: CODES.prime })).json.token as string;
      const hostAds = async () => JSON.parse((await n.get(`/api/state?role=mod&host=1&token=${encodeURIComponent(task)}`)).body) as { terminals: { ads: { on: boolean; aired: number; total: number; running: boolean } } };
      expect((await hostAds()).terminals.ads).toMatchObject({ on: true, aired: 1, total: 14, running: true });
      expect((await n.post("/api/mod/screen/ads", { on: false, token: task })).json).toMatchObject({ on: false });
      expect((await hostAds()).terminals.ads.on).toBe(false);
      expect((await n.post("/api/mod/screen/ads", { on: true, token: task })).json).toMatchObject({ on: true });
      expect((await hostAds()).terminals.ads.on).toBe(true);
      expect((await n.post("/api/mod/screen/ads", {}, true)).status).toBe(400);
      expect((await n.post("/api/mod/screen/ads", { on: false }, true)).json).toMatchObject({ on: false });
      expect(adFrames(g.stream).at(-1)).toEqual(STOP);
      expect((await n.wall()).ad ?? null).toBeNull();
      await n.run(2 * ADS_GAP_MAX_MS / 1000);
      expect(n.rt.ads.aired).toBe(1);
      expect(await n.ads()).toMatchObject({ on: false, aired: 1 });

      // Nothing on the air, as after a restart: Off still reaches a phone still playing.
      expect(n.rt.ads.air).toBeNull();
      const stops = adFrames(g.stream).filter((f) => "stop" in f).length;
      await n.post("/api/mod/screen/ads", { on: true }, true);
      await n.post("/api/mod/screen/ads", { on: false }, true);
      expect(adFrames(g.stream).filter((f) => "stop" in f).length).toBe(stops + 1);
      await n.post("/api/mod/audio/stop", {}, true);
      expect(adFrames(g.stream).filter((f) => "stop" in f).length).toBe(stops + 2);

      n.rt.flushClock();
      const again = new EventRuntime({ eventId: "evt", store: new Store(n.dir), codes: CODES, scenarioName: "titi", scenarioSource: SRC, joinBase: () => "http://localhost", now: () => n.t });
      live.push(again);
      expect(again.restore()).not.toBeNull();
      expect(again.ads.status(true, null)).toMatchObject({ on: false, aired: 1 });
      expect(again.ads.air).toBeNull();
      // A stream reopening on the restarted server: a stop, so a phone it forgot falls silent.
      const r = res();
      const url = new URL(`http://x/events?role=guest&token=${encodeURIComponent(g.token)}`);
      await again.handle(fakeReq({}), r, "GET", url.pathname, url, {});
      expect(adFrames(r)).toEqual([expect.objectContaining({ stop: true, now: n.t })]);
      again.tickOnce(1000);
      expect(again.ads.aired).toBe(1);
      const on = res();
      await again.handle(fakeReq({ on: true }), on, "POST", "/api/mod/screen/ads", new URL("http://x/api/mod/screen/ads"), { moderator: true });
      expect(on.statusCode).toBe(200);
      for (let i = 0; i < ADS_GAP_MAX_MS / 1000 && again.ads.aired < 2; i++) {
        n.t += 1000;
        again.tickOnce(1000);
      }
      expect(again.ads.status(true, null)).toMatchObject({ on: true, aired: 2 });
      expect(again.ads.air!.n).not.toBe(played);
    },
    SLOW,
  );

  it(
    "the event's Restart stops it and starts a new night",
    async () => {
      const n = new Night();
      const g = await n.guest("Ada");
      await n.guest("Bea");
      await n.run(120);
      await n.toHunt2();
      await n.untilAired(1);
      expect(n.rt.ads.air).not.toBeNull();
      n.rt.restart();
      expect(adFrames(g.stream).at(-1)).toEqual(STOP);
      expect(n.rt.ads.status(false, null)).toMatchObject({ on: true, aired: 0, playing: null });
      expect((await n.wall()).ad ?? null).toBeNull();
    },
    SLOW,
  );
});
