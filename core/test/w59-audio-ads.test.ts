// The audio ads on the server (wave 59a, docs/loom-w59-ads-contract.md): the
// list and its pace, the hub on its own, then the real show through a real
// runtime, from 📓 to the summons, a restart and a story reload.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { TO_HUNT2 } from "../../scripts/accept/chains.ts";
import { scenarioSource } from "../examples/load.ts";
import { AdsHub, type AdsNow } from "../server/audio-ads.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { ADS_EVERY_MS, ADS_FIRST_MS, AD_ANNOUNCE_HOLD_MS, AD_LEAD_MS, AD_PHONES_MIN, AD_READING_HOLD_MS, AUDIO_ADS, adPhoneCount, adTerminal, type AdFrame, type AdOnAir } from "../src/audio-ads.ts";
import { PLAY_CSP, TERMINAL_CSP } from "../server/routing.ts";

const CODES = { event: "GUEST1", prime: "PRIME1", mod: "MOD111" };
const SRC = scenarioSource("trapped-in-the-internet");
const SLOW = 120_000;
const dirs: string[] = [];
const live: EventRuntime[] = [];
afterAll(() => {
  for (const rt of live) rt.dispose();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("the list", () => {
  it("is the fourteen files of ads-media.sh, in its order", () => {
    const script = readFileSync(new URL("../../scripts/ops/ads-media.sh", import.meta.url), "utf8");
    const files = [...script.matchAll(/\|(ad-\d\d-[a-z0-9-]+\.mp3)"/gu)].map((m) => m[1]);
    expect(files).toEqual(AUDIO_ADS.map((a) => a.file));
    expect(AUDIO_ADS.map((a) => a.n)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  });
  it("fits the hunt's hour before the five-minute warning, even starting late", () => {
    const last = AUDIO_ADS[AUDIO_ADS.length - 1]!;
    const truther = 165_000; // the Truther Download's slide, the latest usual first start
    expect(truther + (AUDIO_ADS.length - 1) * ADS_EVERY_MS + AD_LEAD_MS + last.seconds * 1000).toBeLessThan(3_300_000);
  });
  it("leaves a gap between two ads at this pace", () => {
    expect(Math.max(...AUDIO_ADS.map((a) => a.seconds)) * 1000 + AD_LEAD_MS).toBeLessThan(ADS_EVERY_MS);
  });
  it("a third of the phones, at least three, never more than there are", () => {
    expect(adPhoneCount(0)).toBe(0);
    expect(adPhoneCount(2)).toBe(2);
    expect(adPhoneCount(5)).toBe(AD_PHONES_MIN);
    expect(adPhoneCount(30)).toBe(10);
    expect(adPhoneCount(31)).toBe(11);
  });
  it("never the TV, a mirror, a room terminal or the server room", () => {
    expect(adTerminal({ view: "auto", spot: "start-bar" })).toBe(true);
    expect(adTerminal({ view: "chess", spot: "server-room-door" })).toBe(true);
    for (const t of [{ view: "tv", spot: "" }, { view: "mirror", spot: "x" }, { view: "auto", spot: "desktop-tv" }, { view: "auto", spot: "server-room" }, { view: "auto", spot: "x", room: "The Server Room" }]) expect(adTerminal(t)).toBe(false);
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

describe("the hub", () => {
  const at = (story: number, o: Partial<AdsNow> = {}): AdsNow => ({ now: 1_000_000 + story, story, running: true, hold: null, ...o });

  it("waits a minute into the hour, then one every 3.5 minutes, in order, one at a time", () => {
    const h = new AdsHub();
    expect(h.tick(at(0))).toBeNull();
    expect(h.tick(at(ADS_FIRST_MS - 1))).toBeNull();
    const first = h.tick(at(ADS_FIRST_MS));
    expect(first?.kind === "start" && first.ad.n).toBe(1);
    expect(h.tick(at(ADS_FIRST_MS + 1000))).toBeNull();
    expect(h.tick(at(ADS_FIRST_MS + ADS_EVERY_MS - 1))).toBeNull();
    const second = h.tick(at(ADS_FIRST_MS + ADS_EVERY_MS));
    expect(second?.kind === "start" && second.ad.n).toBe(2);
    expect(h.aired).toBe(2);
  });

  it("tells every screen ahead, and ends on its time", () => {
    const h = new AdsHub();
    h.tick(at(0));
    h.tick(at(ADS_FIRST_MS));
    const a = h.air!;
    expect(a.at).toBe(at(ADS_FIRST_MS).now + AD_LEAD_MS);
    expect(a.until).toBe(a.at + Math.round(AUDIO_ADS[0]!.seconds * 1000));
    expect(a.url).toBe("/media/ads/ad-01-mommy-intro.mp3");
    h.tick(at(ADS_FIRST_MS + 1000, { now: a.until }));
    expect(h.air).toBeNull();
  });

  it("stops at the end of the list", () => {
    const h = new AdsHub();
    h.tick(at(0));
    let story = ADS_FIRST_MS;
    for (let i = 0; i < AUDIO_ADS.length; i++, story += ADS_EVERY_MS) expect(h.tick(at(story))?.kind).toBe("start");
    h.tick(at(story, { now: Number.MAX_SAFE_INTEGER }));
    expect(h.tick(at(story + ADS_EVERY_MS))).toBeNull();
    expect(h.status()).toMatchObject({ aired: 14, total: 14, playing: null });
  });

  it("a hold keeps the next one back, and what is on the air stops at once and stays spent", () => {
    const h = new AdsHub();
    h.tick(at(0));
    expect(h.tick(at(ADS_FIRST_MS, { hold: "talk" }))).toBeNull();
    expect(h.tick(at(ADS_FIRST_MS + 500))?.kind).toBe("start");
    expect(h.tick(at(ADS_FIRST_MS + 1000, { hold: "announcement" }))).toEqual({ kind: "stop" });
    expect(h.air).toBeNull();
    expect(h.aired).toBe(1);
    expect(h.tick(at(ADS_FIRST_MS + 2000))).toBeNull();
  });

  it("the hour's end cuts it, and nothing more starts", () => {
    const h = new AdsHub();
    h.tick(at(0));
    h.tick(at(ADS_FIRST_MS));
    expect(h.tick(at(ADS_FIRST_MS + 1000, { running: false }))).toEqual({ kind: "stop" });
    expect(h.tick(at(ADS_FIRST_MS + ADS_EVERY_MS, { running: false }))).toBeNull();
  });

  it("Off stops it everywhere and holds the list; On resumes at the next", () => {
    const h = new AdsHub();
    h.tick(at(0));
    h.tick(at(ADS_FIRST_MS));
    expect(h.setOn(false)).toEqual({ kind: "stop" });
    expect(h.tick(at(ADS_FIRST_MS + ADS_EVERY_MS))).toBeNull();
    expect(h.setOn(true)).toBeNull();
    const next = h.tick(at(ADS_FIRST_MS + ADS_EVERY_MS + 1000));
    expect(next?.kind === "start" && next.ad.n).toBe(2);
  });

  it("a replay resumes the list at its pace, never from the top, with the switch as it was", () => {
    const h = new AdsHub();
    h.replayAired(5, 600_000);
    h.replaySwitched(false);
    h.replaySwitched(true);
    expect(h.tick(at(600_000 + ADS_EVERY_MS - 1))).toBeNull();
    const next = h.tick(at(600_000 + ADS_EVERY_MS));
    expect(next?.kind === "start" && next.ad.n).toBe(6);
  });

  it("a story reload starts the list over, switched on", () => {
    const h = new AdsHub();
    h.replayAired(5, 600_000);
    h.replaySwitched(false);
    h.reset();
    expect(h.status()).toMatchObject({ on: true, aired: 0 });
  });

  describe("the phones", () => {
    const phones = Array.from({ length: 9 }, (_, i) => `p${i}`);
    const air = (h: AdsHub, n: number): void => {
      h.air = null;
      h.tick(at(0));
      h.tick(at(ADS_FIRST_MS * 2 + ADS_EVERY_MS * n));
    };

    it("rotates: every phone gets its turn before anyone gets a second", () => {
      const h = new AdsHub();
      const heard = new Map<string, number>();
      for (let n = 0; n < 3; n++) {
        air(h, n);
        for (const id of h.pick(phones)) heard.set(id, (heard.get(id) ?? 0) + 1);
        h.cut();
      }
      expect([...heard.values()]).toEqual(phones.map(() => 1));
    });

    it("a busy phone is replaced by the next, keeps its place, and is told once", () => {
      const h = new AdsHub();
      air(h, 0);
      const first = h.pick(phones);
      expect(first).toEqual(["p0", "p1", "p2"]);
      const seq = h.air!.seq;
      expect(h.replace("p1", seq, phones, h.air!.at)).toBe("p3");
      expect(h.replace("p1", seq + 1, phones, h.air!.at)).toBeNull();
      expect(h.replace("p8", seq, phones, h.air!.at)).toBeNull();
      h.cut();
      air(h, 1);
      expect(h.pick(phones)).toContain("p1");
    });

    it("gives up near the end, and with nobody left", () => {
      const h = new AdsHub();
      air(h, 0);
      const seq = h.air!.seq;
      h.pick(["a", "b", "c"]);
      expect(h.replace("a", seq, ["a", "b", "c"], h.air!.at)).toBeNull();
      expect(h.replace("b", seq, ["a", "b", "c", "d"], h.air!.until - 1000)).toBeNull();
    });

    it("hands a late phone the place the ad has reached", () => {
      const h = new AdsHub();
      air(h, 0);
      const a = h.air!;
      const f = h.frame(a.at + 5000) as Exclude<AdFrame, { stop: true }>;
      expect(f).toMatchObject({ in: 0, from: 5, left: a.until - a.at - 5000 });
      expect((h.frame(a.at - 1000) as Exclude<AdFrame, { stop: true }>).in).toBe(1000);
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
  async toHunt2() {
    for (const name of TO_HUNT2) await this.post("/api/mod/signal", { name }, true);
    expect(this.rt.liveSim!.world.peek("Night.phase")).toMatchObject({ value: "hunt_2" });
  }
  /** `s` seconds of story and wall clock, a beat at a time. */
  run(s: number): void {
    for (let i = 0; i < s; i++) {
      this.t += 1000;
      this.rt.tickOnce(1000);
    }
  }
  async wall(view = "auto", spot = "start-bar", extra = ""): Promise<{ ad?: AdOnAir | null }> {
    return JSON.parse((await this.get(`/api/screen/state?name=${view}-${spot}&view=${view}&spot=${spot}${extra}`, true)).body) as { ad?: AdOnAir | null };
  }
  async ads() {
    return (JSON.parse((await this.get("/api/mod/screen/terminals", true)).body) as { ads: Record<string, unknown> }).ads;
  }
}
const adFrames = (r: { frames: Frame[] }) => r.frames.filter((f) => f.event === "ad").map((f) => f.data as AdFrame);
const offers = (r: { frames: Frame[] }) => adFrames(r).filter((f): f is Exclude<AdFrame, { stop: true }> => !("stop" in f));

describe("the night", () => {
  it(
    "nothing before the hunt; the first after the Truther Download, on a wall and three phones; never the TV or the server room",
    async () => {
      const n = new Night();
      const [a, b, c, d] = [await n.guest("Ada"), await n.guest("Bea"), await n.guest("Cy"), await n.guest("Dot")];
      n.run(120);
      expect((await n.wall()).ad).toBeNull();
      await n.toHunt2();
      n.run(50);
      expect((await n.wall()).ad).toBeNull();
      expect(await n.ads()).toMatchObject({ on: true, aired: 0, running: true, hold: "truther" });
      n.run(60); // 1:50, still before the Truther Download at 2:00
      expect((await n.wall()).ad).toBeNull();
      n.run(15);
      expect((await n.ads())["hold"]).toBe("cutscene"); // its slide
      n.run(46);
      const wall = (await n.wall()).ad!;
      expect(wall).toMatchObject({ n: 1, name: "Mommy Intro", url: "/media/ads/ad-01-mommy-intro.mp3" });
      expect((await n.wall("tv", "desktop-tv")).ad).toBeUndefined();
      expect((await n.wall("auto", "server-room")).ad).toBeUndefined();
      expect((await n.wall("mirror", "start-bar")).ad).toBeUndefined();
      const told = [a, b, c, d].filter((g) => offers(g.stream).length === 1);
      expect(told.length).toBe(3);
      expect(offers(told[0]!.stream)[0]).toMatchObject({ seq: wall.seq, n: 1, name: "Mommy Intro" });
    },
    SLOW,
  );

  it(
    "the list runs to its end inside the hour and nothing reaches the chat or the story",
    async () => {
      const n = new Night();
      const g = await n.guest("Ada");
      n.run(120);
      await n.toHunt2();
      const chat = n.rt.liveSim!.log.len();
      n.run(3299);
      expect(n.rt.ads.aired).toBe(14);
      expect(new Set(offers(g.stream).map((f) => f.n)).size).toBe(14);
      expect(offers(g.stream).map((f) => f.n)).toEqual(AUDIO_ADS.map((x) => x.n));
      const journal = n.store.readJournal().filter((e) => e.m === "signal" && e.a[0] === "audio_ad_aired");
      expect(journal.length).toBe(14);
      expect(n.rt.liveSim!.log.len()).toBeGreaterThan(chat);
      expect(n.store.readJournal().filter((e) => e.m === "say" || e.m === "broadcast").some((e) => JSON.stringify(e.a).includes("Mommy"))).toBe(false);
    },
    SLOW,
  );

  it(
    "the summons stops one on the air",
    async () => {
      const n = new Night();
      const g = await n.guest("Ada");
      n.run(120);
      await n.toHunt2();
      n.run(170);
      expect(n.rt.ads.air).not.toBeNull();
      await n.post("/api/mod/signal", { name: "five_minute_warning" }, true);
      n.run(1);
      expect(n.rt.ads.air).toBeNull();
      expect(adFrames(g.stream).at(-1)).toEqual({ stop: true });
      expect((await n.wall()).ad).toBeNull();
      expect(await n.ads()).toMatchObject({ running: false });
    },
    SLOW,
  );

  it(
    "paused doors stop it at once; the list waits; a read and an announcement hold it",
    async () => {
      const n = new Night();
      const g = await n.guest("Ada");
      n.run(120);
      await n.toHunt2();
      n.run(170);
      expect(n.rt.ads.aired).toBe(1);
      await n.post("/api/mod/stop", {}, true);
      expect(n.rt.ads.air).toBeNull();
      expect(adFrames(g.stream).at(-1)).toEqual({ stop: true });
      await n.post("/api/mod/start", {}, true);
      n.run(205);
      expect(n.rt.ads.aired).toBe(2);
      expect((await n.post("/api/mod/audio/stop", {}, true)).status).toBe(200);
      expect(n.rt.ads.air).toBeNull(); // ■ Stop house sounds: this one, not the list
      expect(n.rt.ads.status()).toMatchObject({ on: true, aired: 2 });
      n.run(210);
      expect(n.rt.ads.aired).toBe(3);
      await n.post("/api/mod/broadcast", { scope: "everyone", cue: "📣 Lost and found is at the kitchen." }, true);
      n.run(1);
      expect(n.rt.ads.air).toBeNull();
      expect((await n.ads())["hold"]).toBe("announcement");
      n.run(Math.ceil(AD_ANNOUNCE_HOLD_MS / 1000) + 1);
      expect((await n.ads())["hold"]).toBeNull();
    },
    SLOW,
  );

  it(
    "a read on the teleprompter holds them, but a phone left on it can't for ever",
    async () => {
      const n = new Night();
      n.run(120);
      await n.toHunt2();
      n.run(170);
      n.rt.ads.cut();
      const prompters = (n.rt as unknown as { prompters: object }).prompters;
      Object.defineProperty(prompters, "inUse", { get: () => true, configurable: true });
      n.run(1);
      expect((await n.ads())["hold"]).toBe("reading");
      n.run(Math.ceil(AD_READING_HOLD_MS / 1000));
      expect((await n.ads())["hold"]).toBeNull();
    },
    SLOW,
  );

  it(
    "a phone that can't take it hands it to the next; a locked one and a host are never asked",
    async () => {
      const n = new Night();
      const gs = [await n.guest("Ada"), await n.guest("Bea"), await n.guest("Cy"), await n.guest("Dot"), await n.guest("Eve")];
      const task = (await n.post("/api/prime/login", { character: "Task Manager", passcode: CODES.prime })).json.token as string;
      const host = await n.get(`/events?role=prime&token=${encodeURIComponent(task)}`);
      n.run(120);
      await n.toHunt2();
      n.run(170);
      expect(offers(host)).toEqual([]);
      const told = gs.filter((g) => offers(g.stream).length > 0);
      const left = gs.filter((g) => !told.includes(g));
      expect(told.length).toBe(3);
      n.rt.ads.cut();
      n.rt.liveSim!.setVar(`${left[0]!.id}.corrupted`, "true");
      n.run(211);
      expect(offers(left[0]!.stream)).toEqual([]);
      expect(n.rt.ads.aired).toBe(2);
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
    "📢 Off is journaled, a director's alone, and a restart keeps the list and the switch",
    async () => {
      const n = new Night();
      const g = await n.guest("Ada");
      n.run(120);
      await n.toHunt2();
      n.run(170);
      expect(n.rt.ads.aired).toBe(1);
      expect((await n.post("/api/mod/screen/ads", { on: false })).status).toBe(403);
      expect((await n.post("/api/mod/screen/ads", {}, true)).status).toBe(400);
      expect((await n.post("/api/mod/screen/ads", { on: false }, true)).json).toMatchObject({ on: false });
      expect(adFrames(g.stream).at(-1)).toEqual({ stop: true });
      expect((await n.wall()).ad).toBeNull();
      n.run(300);
      expect(n.rt.ads.aired).toBe(1);
      expect(await n.ads()).toMatchObject({ on: false, aired: 1 });

      n.rt.flushClock();
      const again = new EventRuntime({ eventId: "evt", store: new Store(n.dir), codes: CODES, scenarioName: "titi", scenarioSource: SRC, joinBase: () => "http://localhost", now: () => n.t });
      live.push(again);
      expect(again.restore()).not.toBeNull();
      expect(again.ads.status()).toMatchObject({ on: false, aired: 1 });
      expect(again.ads.air).toBeNull();
      again.tickOnce(1000);
      expect(again.ads.aired).toBe(1);
      const on = res();
      await again.handle(fakeReq({ on: true }), on, "POST", "/api/mod/screen/ads", new URL("http://x/api/mod/screen/ads"), { moderator: true });
      expect(on.statusCode).toBe(200);
      n.t += 1000;
      again.tickOnce(1000);
      expect(again.ads.status()).toMatchObject({ on: true, aired: 2, playing: "Adobe" });
    },
    SLOW,
  );

  it(
    "the event's Restart stops it and clears the list",
    async () => {
      const n = new Night();
      const g = await n.guest("Ada");
      n.run(120);
      await n.toHunt2();
      n.run(170);
      expect(n.rt.ads.air).not.toBeNull();
      n.rt.restart();
      expect(adFrames(g.stream).at(-1)).toEqual({ stop: true });
      expect(n.rt.ads.status()).toMatchObject({ on: true, aired: 0, playing: null });
      expect((await n.wall()).ad).toBeNull();
    },
    SLOW,
  );
});
