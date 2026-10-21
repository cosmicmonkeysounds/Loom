//! The reinstallation flow lifted out for the tent laptop (wave 18b):
//! where a scanned program starts (`firstStep`, pure), a held walk
//! (`Game.hold`: the leash paused, input ignored, the pump alive), and the
//! game's sounds on a borrowed bus (`createSfx(output)`).
import { afterEach, describe, expect, it, vi } from "vitest";
import { firstStep } from "../src/flow-state.ts";
import { exitFlash } from "../src/flow.tsx";
import { createSfx } from "../src/game/audio.ts";
import { Game } from "../src/game/engine.ts";
import { IdleLeash } from "../src/game/leash.ts";
import { NOT_MARKED } from "../src/program.ts";

const row = (over: Partial<{ captured: boolean; restricted: boolean; eligible: boolean; marked: boolean; favour: boolean }> = {}) => ({ captured: false, restricted: false, eligible: false, marked: false, favour: false, ...over });
const corrupted = row({ captured: true, eligible: true });
const marked = row({ marked: true, restricted: true, eligible: true });
const healthy = row();
const held = row({ restricted: true });

describe("firstStep", () => {
  it("never begins a program the server would turn away (healthy, or held by a director)", () => {
    for (const role of ["both", "player", "station"] as const) {
      expect(firstStep(healthy, false, role, 2, true)).toBe("refuse");
      expect(firstStep(held, false, role, 2, true)).toBe("refuse");
    }
  });

  it("no headset online: straight to Play here on a device that can draw it", () => {
    expect(firstStep(corrupted, false, "both", 0, true)).toBe("play");
    expect(firstStep(marked, false, "both", 0, true)).toBe("play");
    expect(firstStep(marked, false, "player", 3, true)).toBe("play");
  });

  it("a headset to send to, a send-only device, or no WebGL2: the choose card", () => {
    expect(firstStep(marked, false, "both", 1, true)).toBe("choose");
    expect(firstStep(marked, false, "station", 0, true)).toBe("choose");
    expect(firstStep(marked, false, "both", 0, false)).toBe("choose");
    expect(firstStep(marked, false, "player", 0, false)).toBe("choose");
  });

  it("after an ending anyone the server lets in plays (the party favour)", () => {
    expect(firstStep(row({ eligible: true, favour: true }), true, "both", 0, true)).toBe("play");
    expect(firstStep(row({ eligible: true }), true, "both", 0, true)).toBe("play");
  });
});

describe("exitFlash", () => {
  it("says a failure and the game's ends; a park and Back say nothing", () => {
    expect(exitFlash({ kind: "failed", text: NOT_MARKED })).toEqual({ text: NOT_MARKED, tone: "bad" });
    expect(exitFlash({ kind: "quit" })).toEqual({ text: "Simulation aborted.", tone: "bad" });
    expect(exitFlash({ kind: "sent", station: "Quest 1" })).toBeNull();
    expect(exitFlash({ kind: "back" })).toBeNull();
  });
});

describe("Game.hold — an overlay holds the walk, never ends it", () => {
  afterEach(() => vi.unstubAllGlobals());
  /** A bare Game (no canvas): `hold` only touches these fields. */
  function bare(t0: number) {
    const g = Object.create(Game.prototype) as Record<string, unknown>;
    g["leash"] = new IdleLeash(t0);
    g["keys"] = new Set(["KeyW"]);
    g["drag"] = [3, 4];
    g["dragPointer"] = 7;
    g["hitQueued"] = true;
    g["held"] = false;
    return g as unknown as Game & { leash: IdleLeash; keys: Set<string>; hitQueued: boolean };
  }

  it("pauses the leash and drops held input; letting go resumes it where it stopped", () => {
    vi.stubGlobal("document", { hidden: false });
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const g = bare(1000);
    now = 31_000;
    g.hold(true);
    expect(g.isHeld).toBe(true);
    expect(g.keys.size).toBe(0);
    expect(g.hitQueued).toBe(false);
    // Held for five minutes: the leash didn't count any of it.
    now = 331_000;
    expect(g.leash.idleFor(now)).toBe(30_000);
    expect(g.leash.expired(now)).toBe(false);
    g.hold(false);
    expect(g.isHeld).toBe(false);
    expect(g.leash.idleFor(now)).toBe(30_000);
    now = 341_000;
    expect(g.leash.idleFor(now)).toBe(40_000);
    vi.restoreAllMocks();
  });

  it("letting go while the tab is hidden keeps the leash paused (the tab's own pause)", () => {
    vi.stubGlobal("document", { hidden: true });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const g = bare(0);
    now = 10_000;
    g.hold(true);
    now = 20_000;
    g.hold(false);
    expect(g.leash.hidden).toBe(true);
    now = 90_000;
    expect(g.leash.idleFor(now)).toBe(10_000);
    vi.restoreAllMocks();
  });

  it("holding twice is one hold", () => {
    vi.stubGlobal("document", { hidden: false });
    const g = bare(0);
    g.hold(true);
    g.hold(true);
    g.hold(false);
    expect(g.leash.hidden).toBe(false);
  });

  it("the pump is never stopped by a hold (keepalives keep the server's 60 s timeout away)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/game/engine.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("  hold(on: boolean): void {"), src.indexOf("  get isHeld()"));
    expect(body).not.toMatch(/pump|pumpTimer|postEnd|end\(/u);
  });
});

describe("createSfx(output) — the game on a host's bus", () => {
  it("plays into the host's node through the game's own level, and never closes the host's context", () => {
    const connected: unknown[] = [];
    let closed = false;
    const gain = () => ({ gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect(n: unknown) { connected.push(n); return n; }, disconnect() {} });
    const ctx = { state: "running", currentTime: 0, sampleRate: 8000, createGain: gain, close: async () => void (closed = true), createOscillator: () => ({ type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => n, start() {}, stop() {} }) };
    const out = { id: "master" };
    const sfx = createSfx(() => ({ ctx: ctx as unknown as AudioContext, out: out as unknown as AudioNode }));
    sfx.buzz();
    expect(connected).toContain(out);
    sfx.dispose();
    expect(closed).toBe(false);
  });

  it("is silent while the host has no context", () => {
    const sfx = createSfx(() => null);
    expect(() => {
      sfx.resume();
      sfx.quack(1);
      sfx.fanfare();
      sfx.buzz();
      sfx.thud();
      sfx.dispose();
    }).not.toThrow();
  });
});
