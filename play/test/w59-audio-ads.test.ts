// Wave 59a: the audio ads on a phone (docs/loom-w59-ads-contract.md C4, C5). A
// fake audio element: what a real iPhone does with one is not proven here. The
// real pages are driven in Chromium by scripts/sim/ads.spec.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { AD_SILENCE, AdPlayer, type AdAudio, type AdSound } from "../src/ad-player.ts";
import { AdSpots, adCardOpen, adCardsOpen, type AdOffer } from "../src/ad-spots.ts";
import { chatFrameHandler, CHAT_FRAMES } from "../src/client.ts";

class FakeAudio implements AdAudio {
  src = "";
  preload = "";
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  plays: string[] = [];
  paused = 0;
  /** What the next `play()` does. */
  next: "ok" | "refuse" | "broken" | "throw" = "ok";
  play(): Promise<void> {
    this.plays.push(this.src);
    if (this.next === "throw") throw new Error("nope");
    if (this.next === "refuse") return Promise.reject(Object.assign(new Error("gesture"), { name: "NotAllowedError" }));
    if (this.next === "broken") return Promise.reject(Object.assign(new Error("404"), { name: "NotSupportedError" }));
    return Promise.resolve();
  }
  pause(): void {
    this.paused += 1;
  }
  load(): void {}
  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }
}
const offer = (o: Partial<AdOffer> = {}): AdOffer => ({ seq: 7, n: 2, name: "Adobe", url: "/media/ads/ad-02-adobe.mp3", in: 0, from: 0, left: 60_000, ...o });
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("the frame", () => {
  it("is a stream frame, and reaches its handler", () => {
    expect(CHAT_FRAMES).toContain("ad");
    const onAd = vi.fn();
    const on = chatFrameHandler(() => ({ onAd }), { replace() {}, upsert() {}, drop() {} });
    on("ad", JSON.stringify({ stop: true }));
    expect(onAd).toHaveBeenCalledWith({ stop: true });
  });
});

describe("the one element", () => {
  const made = () => {
    const a = new FakeAudio();
    const told: Array<[AdSound, boolean]> = [];
    const make = vi.fn(() => a);
    return { a, told, make, p: new AdPlayer(make, (s, d) => told.push([s, d])) };
  };

  it("swaps the source on one element, never a second", async () => {
    const { a, make, p } = made();
    p.start("/one.mp3");
    p.stop();
    p.start("/two.mp3");
    await Promise.resolve();
    expect(make).toHaveBeenCalledTimes(1);
    expect(a.plays).toEqual(["/one.mp3", "/two.mp3"]);
  });
  it("says playing once the phone really plays", async () => {
    const { told, p } = made();
    p.start("/a.mp3");
    expect(told).toEqual([]);
    await Promise.resolve();
    expect(told).toEqual([["playing", false]]);
  });
  it("joins late with a media fragment", () => {
    const { a, p } = made();
    p.start("/a.mp3", 12.34);
    expect(a.src).toBe("/a.mp3#t=12.3");
  });
  it("a refused play is `refused`, never an error, and a throw is too", async () => {
    const { a, told, p } = made();
    a.next = "refuse";
    p.start("/a.mp3");
    await Promise.resolve();
    await Promise.resolve();
    expect(told).toEqual([["refused", false]]);
    a.next = "throw";
    expect(() => p.start("/a.mp3")).not.toThrow();
  });
  it("a file that isn't there ends quietly, with no ▶", async () => {
    const { a, told, p } = made();
    a.next = "broken";
    p.start("/a.mp3");
    await Promise.resolve();
    await Promise.resolve();
    expect(told).toEqual([["idle", true]]);
  });
  it("hears the track end, and nothing after a stop", async () => {
    const { a, told, p } = made();
    p.start("/a.mp3");
    await Promise.resolve();
    a.onended?.();
    expect(told.at(-1)).toEqual(["idle", true]);
    told.length = 0;
    p.start("/b.mp3");
    const ended = a.onended;
    p.stop();
    ended?.();
    await Promise.resolve();
    expect(told).toEqual([]);
    expect(a.src).toBe("");
  });
  it("no element at all is `refused`, not a crash", () => {
    const told: AdSound[] = [];
    new AdPlayer(() => null, (s) => told.push(s)).start("/a.mp3");
    expect(told).toEqual(["refused"]);
  });
  it("the first tap plays silence once, and only while nothing plays", async () => {
    const { a, p } = made();
    p.unlock();
    await Promise.resolve();
    await Promise.resolve();
    p.unlock();
    expect(a.plays).toEqual([AD_SILENCE]);
    expect(AD_SILENCE.startsWith("data:audio/wav;base64,")).toBe(true);
  });
  it("tries the unlock again on the next tap if the first was refused", async () => {
    const { a, p } = made();
    a.next = "refuse";
    p.unlock();
    await Promise.resolve();
    await Promise.resolve();
    a.next = "ok";
    p.unlock();
    expect(a.plays.length).toBe(2);
  });
});

describe("a phone's turn", () => {
  let a: FakeAudio;
  let told: number[];
  let s: AdSpots;
  let hidden: boolean;
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {}, get hidden() { return hidden; } });
    a = new FakeAudio();
    told = [];
    s = new AdSpots(() => a);
    s.arm((seq) => told.push(seq));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits out the lead, then shows the pop-up and plays", async () => {
    s.take(offer({ in: 3000 }));
    await vi.advanceTimersByTimeAsync(2999);
    expect(s.shown()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.shown()).toMatchObject({ n: 2, name: "Adobe", refused: false });
    expect(a.plays).toEqual(["/media/ads/ad-02-adobe.mp3"]);
  });
  it("closes itself when the track ends", async () => {
    s.take(offer());
    await settle();
    a.onended?.();
    expect(s.shown()).toBeNull();
  });
  it("× stops the sound on this phone", async () => {
    s.take(offer());
    await settle();
    s.end();
    expect(s.shown()).toBeNull();
    expect(a.paused).toBeGreaterThan(0);
  });
  it("closes on its own if the track's end never comes", async () => {
    s.take(offer({ left: 1000 }));
    await settle();
    await vi.advanceTimersByTimeAsync(4100);
    expect(s.shown()).toBeNull();
  });
  it("a stop frame stops it, even in the lead", async () => {
    s.take(offer());
    await settle();
    s.take({ stop: true });
    expect(s.shown()).toBeNull();
    s.take(offer({ in: 3000 }));
    s.take({ stop: true });
    await vi.advanceTimersByTimeAsync(4000);
    expect(s.shown()).toBeNull();
  });
  it("busy, it says so at once and plays nothing", async () => {
    s.setBusy(true);
    s.take(offer({ in: 3000 }));
    expect(told).toEqual([7]);
    await vi.advanceTimersByTimeAsync(4000);
    expect(a.plays).toEqual([]);
  });
  it("a hidden page says so too", () => {
    hidden = true;
    s.take(offer());
    expect(told).toEqual([7]);
  });
  it("gets busy in the lead: it says so at the start", async () => {
    s.take(offer({ in: 3000 }));
    s.setBusy(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(a.plays).toEqual([]);
  });
  it("getting busy takes a pop-up down at once", async () => {
    s.take(offer());
    await settle();
    expect(s.shown()).not.toBeNull();
    s.setBusy(true);
    expect(s.shown()).toBeNull();
  });
  it("a refused play leaves the pop-up up with ▶, and ▶ plays from where it has got to", async () => {
    a.next = "refuse";
    s.take(offer({ from: 2 }));
    await settle();
    expect(s.shown()?.refused).toBe(true);
    a.next = "ok";
    await vi.advanceTimersByTimeAsync(10_000);
    s.retry();
    await settle();
    expect(a.src).toBe("/media/ads/ad-02-adobe.mp3#t=12.0");
    expect(s.shown()?.refused).toBe(false);
  });
  it("an unarmed session (a Run pane) ignores it and says nothing", () => {
    const pane = new AdSpots(() => a);
    pane.take(offer());
    expect(told).toEqual([]);
    expect(pane.shown()).toBeNull();
  });
});

describe("an open card", () => {
  it("counts while it is open", () => {
    const close = adCardOpen();
    const again = adCardOpen();
    expect(adCardsOpen()).toBe(true);
    close();
    expect(adCardsOpen()).toBe(true);
    again();
    expect(adCardsOpen()).toBe(false);
  });
  it("is what the tray says, and the slot reads", () => {
    expect(readFileSync(new URL("../src/stream/card-tray.tsx", import.meta.url), "utf8")).toMatch(/adCardOpen\(\)/u);
    expect(readFileSync(new URL("../src/ad-slot.tsx", import.meta.url), "utf8")).toMatch(/adCardsOpen/u);
  });
});
