//! The reinstallation flow lifted out for the tent laptop (wave 18b):
//! where a scanned program starts (`firstStep`, pure), a held walk
//! (`Game.hold`: the leash paused, input ignored, the pump alive), and the
//! game's sounds on a borrowed bus (`createSfx(output)`).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StationInfo } from "@loom/house";
import { begin } from "../src/api.ts";
import { defaultConfig, type DeviceRole } from "../src/config.ts";
import { firstStep } from "../src/flow-state.ts";
import { exitFlash, ReinstallFlow, type FlowStations } from "../src/flow.tsx";
import { TWO_ROOMS } from "./houses.ts";
import { createSfx } from "../src/game/audio.ts";
import { Game } from "../src/game/engine.ts";
import { IdleLeash } from "../src/game/leash.ts";
import { NOT_MARKED, type Program } from "../src/program.ts";

// A frame on a bare Game: the walk itself is not under test here.
vi.mock("../src/game/physics.ts", async (orig) => ({
  ...(await orig<object>()),
  move: (body: unknown) => body,
}));

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

  it("no station poll has answered yet: the card on a device that may send (a headset may be ready, D8)", () => {
    expect(firstStep(marked, false, "both", null, true)).toBe("choose");
    // A player-only device never sends, so it doesn't wait on the headsets.
    expect(firstStep(marked, false, "player", null, true)).toBe("play");
    expect(firstStep(healthy, false, "both", null, true)).toBe("refuse");
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
    return g as unknown as { hold(on: boolean): void; readonly isHeld: boolean; leash: IdleLeash; keys: Set<string>; hitQueued: boolean };
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
      sfx.scare();
      sfx.pickup();
      sfx.dispose();
    }).not.toThrow();
  });
});

describe("ReinstallFlow start=\"auto\" — the first screen, decided at mount", () => {
  const program = (over: Partial<Program> = {}): Program => ({ id: "g1", name: "Winamp", location: null, ...marked, ...over });
  const vr = (online: boolean): StationInfo => ({ id: "q1", name: "Quest 1", world: "vr", online, busy: null });
  const render = (p: Program, stations: FlowStations, role: DeviceRole = "both", start: "auto" | "choose" = "auto") =>
    renderToStaticMarkup(
      createElement(ReinstallFlow, {
        config: defaultConfig({ eventId: "e", token: "t", role }),
        program: p,
        ended: false,
        stations,
        canDraw: true,
        sfx: createSfx(() => null),
        start,
        onExit: () => {},
      }),
    );
  const polled = (list: StationInfo[]): FlowStations => ({ list, ok: true, refresh: () => {} });
  const unpolled: FlowStations = { list: [], ok: false, refresh: () => {} };

  it("no headset online: straight to the begin (no card)", () => {
    const html = render(program(), polled([vr(false)]));
    expect(html).toContain("Copying files…");
    expect(html).not.toContain("Play here");
  });

  it("a headset online, or the stations not polled yet: the choose card", () => {
    for (const st of [polled([vr(true)]), unpolled]) {
      const html = render(program(), st);
      expect(html).toContain("Play here");
      expect(html).toContain("Send to a headset");
      expect(html).not.toContain("Copying files…");
    }
  });

  it("a program the server would turn away: nothing on screen (not even a frame of the card)", () => {
    expect(render(program({ marked: false, restricted: false, eligible: false }), polled([]))).toBe("");
  });

  it("start=\"choose\" (the standalone wizard) always shows the card", () => {
    expect(render(program(), polled([vr(false)]), "both", "choose")).toContain("Play here");
  });
});

describe("the flow's begin never forces (the server's marked-only gate decides, R16)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("begin sends guest, world, device and the station — never force", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ token: "x" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const c = defaultConfig({ eventId: "e", token: "t", name: "Tent" });
    await begin(c, "g1", "web");
    await begin(c, "g1", "vr", "q1");
    expect(bodies).toEqual([
      { guest: "g1", world: "web", device: "Tent" },
      { guest: "g1", world: "vr", device: "Tent", station: "q1" },
    ]);
  });

  it("flow.tsx passes no force anywhere (its doc may say so)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/flow.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/\bforce\s*[:=,})]/u);
    expect(src).toMatch(/begin\(config, program\.id, "web"\)/u);
    expect(src).toMatch(/begin\(config, program\.id, "vr", s\.id\)/u);
  });
});

describe("a held frame — no find and no quack under an overlay", () => {
  afterEach(() => vi.unstubAllGlobals());
  function frameGame(held: boolean) {
    const house = TWO_ROOMS();
    const at: [number, number, number] = [1, 0, 1];
    const quack = vi.fn();
    const found = vi.fn(async () => {});
    const set = vi.fn();
    const g = Object.create(Game.prototype) as Record<string, unknown>;
    const noop = { set: () => {} };
    Object.assign(g, {
      phase: "playing",
      o: { sticks: () => ({ left: { x: 0, y: 0 }, right: { x: 0, y: 0 } }), arrowsTurn: true, sfx: { quack } },
      held,
      keys: new Set<string>(),
      drag: [0, 0],
      leash: new IdleLeash(0),
      body: { p: at, yaw: 0, pitch: 0, vy: 0 },
      world: {},
      pump: { set },
      lastTrailAt: 1000,
      doorOpen: false,
      kingState: null,
      kingProp: null,
      duck: { state: "idle", update: () => {} },
      map: house,
      duckSpot: { id: "d1", room: house.rooms[0]!.id, pos: at },
      foundRefusals: 0,
      foundCooldownUntil: 0,
      perchedSaid: false,
      nextQuackAt: 0,
      camera: { position: noop, rotation: noop },
      trail: { update: () => {} },
      house: { update: () => {} },
      ghosts: new Map(),
      renderer: { render: () => {} },
      lastHudAt: 1000,
      found,
      // The moments (wave 26): no heart, no disks; in a room, not in the void.
      escaping: false,
      heartProp: null,
      pickups: [],
      taken: new Set<string>(),
      pickupGivenUp: new Set<string>(),
      pickupRetryAt: new Map<string, number>(),
    });
    (g as unknown as { frame(now: number, dt: number): void }).frame(1000, 0.016);
    return { quack, found, set };
  }

  it("standing on Gerald, held: no find, no quack — and the pose still goes out", () => {
    vi.stubGlobal("document", { hidden: false });
    const held = frameGame(true);
    expect(held.found).not.toHaveBeenCalled();
    expect(held.quack).not.toHaveBeenCalled();
    expect(held.set).toHaveBeenCalledTimes(1);
  });

  it("the same frame, not held: the find and the quack", () => {
    vi.stubGlobal("document", { hidden: false });
    const free = frameGame(false);
    expect(free.found).toHaveBeenCalledTimes(1);
    expect(free.quack).toHaveBeenCalledTimes(1);
  });
});

describe("held and onPlaying reach the game (structural: this package has no DOM renderer)", () => {
  it("the flow hands held to Play and reports the play step; Play applies it to the game", async () => {
    const { readFileSync } = await import("node:fs");
    const flow = readFileSync(new URL("../src/flow.tsx", import.meta.url), "utf8");
    expect(flow).toMatch(/<Play[\s\S]*?held=\{held\}[\s\S]*?\/>/u);
    expect(flow).toMatch(/const playing = step\.kind === "play";/u);
    expect(flow).toMatch(/playingRef\.current\?\.\(playing\);\s*\}, \[playing\]\);/u);
    // Unmounting mid-walk says "not playing" (the host resumes its own work).
    expect(flow).toMatch(/useEffect\(\(\) => \(\) => playingRef\.current\?\.\(false\), \[\]\);/u);
    const play = readFileSync(new URL("../src/game/Play.tsx", import.meta.url), "utf8");
    expect(play).toMatch(/\.hold\(held\)/u);
  });
});
