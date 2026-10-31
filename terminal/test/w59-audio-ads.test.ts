// Wave 59a: the audio ads on a wall (docs/loom-w59-ads-contract.md C4, C5). The
// real pages are driven in Chromium by scripts/sim/ads.spec.ts.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { AdOnAir } from "../../core/src/audio-ads.ts";
import type { AdAudio } from "../../play/src/ad-player.ts";
import { AD_JOIN_LEFT_MS, AdMachine, WallAd, adCovered, adsHere } from "../src/ad-spot.ts";
import { defaultConfig, type TerminalConfig } from "../src/config.ts";
import { adOf } from "../src/screen.ts";

const AD: AdOnAir = { seq: 1000, n: 3, name: "Mizz Butter", url: "/media/ads/ad-03-mizz-butter.mp3", at: 1000, until: 61_000 };
const wall = (o: Partial<TerminalConfig> = {}): TerminalConfig => ({ ...defaultConfig({ eventId: "e", token: "t", spot: "start-bar" }), ...o });

describe("which terminals play one", () => {
  it("a wall and the casino terminal", () => {
    expect(adsHere(wall())).toBe(true);
    expect(adsHere(wall({ spot: "graphics-card", view: "casino" }))).toBe(true);
  });
  it("the Server Door never, whatever its link or ⚙ say", () => {
    expect(adsHere(wall({ spot: "server-room-door", view: "chess" }))).toBe(false);
    expect(adsHere(wall({ spot: "server-room-door", view: "chess", bleeps: true }))).toBe(false);
    expect(adsHere(wall({ spot: "server-room-door", view: "auto", bleeps: true }))).toBe(false);
  });
  it("the tent and the reinstall games never, even with bleeps on", () => {
    expect(adsHere(wall({ spot: "tent", bleeps: true }))).toBe(false);
    expect(adsHere(wall({ spot: "tent", view: "reinstall", bleeps: true }))).toBe(false);
    expect(adsHere(wall({ spot: "hall", view: "reinstall", bleeps: true }))).toBe(false);
  });
  it("a terminal that doesn't say where it is never", () => {
    expect(adsHere(wall({ spot: "" }))).toBe(false);
    expect(adsHere(wall({ spot: "", bleeps: true }))).toBe(false);
  });
  it("never the TV, however it was set up, or the server room, or the tent", () => {
    expect(adsHere(wall({ view: "tv" }))).toBe(false);
    expect(adsHere(wall({ spot: "desktop-tv" }))).toBe(false);
    expect(adsHere(wall({ view: "tv", bleeps: true }))).toBe(false);
    expect(adsHere(wall({ spot: "desktop-tv", bleeps: true }))).toBe(false);
    expect(adsHere(wall({ spot: "server-room" }))).toBe(false);
    expect(adsHere(wall({ spot: "server-room", bleeps: true }))).toBe(false);
    expect(adsHere(wall({ spot: "tent" }))).toBe(false);
    expect(adsHere(wall({ view: "reinstall" }))).toBe(false);
    expect(adsHere(wall({ crt: true }))).toBe(false);
  });
  it("a wall ⚙ turned quiet stays quiet", () => {
    expect(adsHere(wall({ bleeps: false }))).toBe(false);
  });
});

describe("what on a screen stops one", () => {
  const none = { overlay: null, glitch: null, burst: null };
  it("an overlay, the glitch or a burst", () => {
    expect(adCovered({ ...none, overlay: {} })).toBe(true);
    expect(adCovered({ ...none, glitch: {} })).toBe(true);
    expect(adCovered({ ...none, burst: {} })).toBe(true);
  });
  it("never a slide: the Y2K clock stands for the whole final hour, and the server decides", () => {
    expect(adCovered({ ...none, slide: { value: "y2k" } } as Parameters<typeof adCovered>[0])).toBe(false);
  });
  it("is what the app asks", () => {
    const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
    expect(app).toMatch(/adCovered\(drawnLayers\)/u);
    expect(app).not.toMatch(/const adBusy[^\n]*\bcovered\b/u);
  });
});

describe("the wire", () => {
  it("reads a good block, and anything else is no ad", () => {
    expect(adOf(AD)).toEqual(AD);
    expect(adOf(null)).toBeNull();
    expect(adOf(undefined)).toBeNull();
    expect(adOf({ ...AD, at: "soon" })).toBeNull();
    expect(adOf({ ...AD, url: "https://elsewhere.example/x.mp3" })).toBeNull();
  });
});

describe("one screen's beats", () => {
  it("waits for the instant, then starts once", () => {
    const m = new AdMachine();
    expect(m.step(AD, false, 900)).toBeNull();
    expect(m.step(AD, false, 1000)).toEqual({ kind: "start", ad: AD, from: 0 });
    expect(m.step(AD, false, 1250)).toBeNull();
  });
  it("a reload mid-ad joins where it has got to", () => {
    expect(new AdMachine().step(AD, false, 11_000)).toEqual({ kind: "start", ad: AD, from: 10 });
  });
  it("too little left isn't worth joining", () => {
    expect(new AdMachine().step(AD, false, AD.until - AD_JOIN_LEFT_MS + 1)).toBeNull();
  });
  it("in use as it starts, it sits this one out", () => {
    const m = new AdMachine();
    expect(m.step(AD, true, 1000)).toBeNull();
    expect(m.step(AD, false, 2000)).toBeNull();
  });
  it("in use only in the lead, it still plays", () => {
    const m = new AdMachine();
    expect(m.step(AD, true, 900)).toBeNull();
    expect(m.step(AD, false, 1000)?.kind).toBe("start");
  });
  it("in use while it plays, it stops at once and doesn't come back", () => {
    const m = new AdMachine();
    m.step(AD, false, 1000);
    expect(m.step(AD, true, 2000)).toEqual({ kind: "stop" });
    expect(m.step(AD, false, 3000)).toBeNull();
  });
  it("gone from the state, it stops; the next one plays", () => {
    const m = new AdMachine();
    m.step(AD, false, 1000);
    expect(m.step(null, false, 2000)).toEqual({ kind: "stop" });
    expect(m.step({ ...AD, seq: 2000, at: 2000 }, false, 2500)?.kind).toBe("start");
  });
  it("× and the track's end are the end of it here", () => {
    const m = new AdMachine();
    m.step(AD, false, 1000);
    m.closed();
    expect(m.step(AD, false, 2000)).toBeNull();
  });
});

describe("the wall's sound", () => {
  const el = (): AdAudio & { src: string; plays: string[]; refuse: boolean } => ({
    src: "",
    preload: "",
    onended: null,
    onerror: null,
    plays: [],
    refuse: false,
    play() {
      this.plays.push(this.src);
      return this.refuse ? Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" })) : Promise.resolve();
    },
    pause() {},
    load() {},
    removeAttribute() {
      this.src = "";
    },
  });

  it("plays, closes with the track, and × cuts it", async () => {
    const a = el();
    const w = new WallAd(() => a);
    w.step(AD, false, 1000);
    expect(w.shown).toMatchObject({ n: 3, name: "Mizz Butter" });
    expect(a.plays).toEqual([AD.url]);
    a.onended?.();
    expect(w.shown).toBeNull();
    w.step({ ...AD, seq: 2 }, false, 2000);
    expect(w.shown).not.toBeNull();
    w.close();
    expect(w.shown).toBeNull();
    expect(a.src).toBe("");
  });
  it("a page that refuses stays up with ▶, and the tap plays from where it has got to", async () => {
    const a = el();
    a.refuse = true;
    const w = new WallAd(() => a);
    w.step(AD, false, 1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(w.shown?.refused).toBe(true);
    a.refuse = false;
    w.retry(11_000);
    await Promise.resolve();
    expect(a.src).toBe(`${AD.url}#t=10.0`);
    expect(w.shown?.refused).toBe(false);
  });
});

describe("the chess and casino terminals", () => {
  it("say when a board or a hand is up", () => {
    for (const f of ["../src/chess/ChessTerminal.tsx", "../src/casino/CasinoTerminal.tsx"]) expect(readFileSync(new URL(f, import.meta.url), "utf8")).toMatch(/adTable\(s\.kind !== "attract"\)/u);
  });
});
