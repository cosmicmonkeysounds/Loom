// Wave 52b: the server room's old 4:3 CRT. The button guide, the scenes as
// text cards, nothing cutting him off, the thread staying on the newest line.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TYPE_CPS, followAfter } from "../src/chat.tsx";
import { defaultConfig, hintsFromSearch, loadConfig, withoutSecrets } from "../src/config.ts";
import { bannerOf, cardOf } from "../src/crt/cards.ts";
import { legendFor, type LegendIn } from "../src/crt/legend.ts";
import { KEY_ROWS, NAME_MAX, PROMPT_LINGER_MS, keyMoved, keyPressed, promptAfterDoor, promptAfterPress, promptUp, speaksPrompt } from "../src/crt/prompt.ts";
import { HEART_SCENE_MS, PANEL_HOLD_CAP_MS, PANEL_WAIT_CAP_MS, panelGate } from "../src/heart/heart.ts";
import { NO_LAYERS, plainLayers } from "../src/slides.ts";

const base: LegendIn = { who: "TRABOLTA", speaking: false, files: false, voice: null, talking: false, menu: false, greyed: false, canGive: true, scene: false, prompt: false, typing: false, warning: null };
const keys = (o: Partial<LegendIn>) => legendFor({ ...base, ...o }).hints.map((h) => h.key);
const words = (o: Partial<LegendIn>) => legendFor({ ...base, ...o }).hints.map((h) => `${h.key} ${h.label}`);

describe("the button guide", () => {
  it("offers the answers, and a file, on a menu", () => {
    expect(words({ menu: true })).toEqual(["▲▼ CHOOSE", "A SELECT", "Y GIVE FILE"]);
  });

  it("marks Y's hint as the button Y presses", () => {
    expect(legendFor({ ...base, menu: true }).hints.filter((h) => h.file === true).map((h) => h.key)).toEqual(["Y"]);
  });

  it("offers nothing to press while he speaks", () => {
    expect(legendFor({ ...base, menu: true, speaking: true })).toEqual({ note: "TRABOLTA IS SPEAKING", hints: [] });
  });

  it("never offers a skip, anywhere", () => {
    const all: Array<Partial<LegendIn>> = [{ menu: true }, { speaking: true }, { voice: "ready" }, { voice: "confirm" }, { files: true }, { speaking: true, voice: "confirm" }];
    for (const o of all) for (const h of legendFor({ ...base, ...o }).hints) expect(h.label).not.toMatch(/skip/iu);
  });

  it("offers the talk's own buttons at each step of a spoken answer", () => {
    expect(words({ voice: "ready", talking: true })).toEqual(["A SPEAK", "B BACK", "Y GIVE FILE"]);
    expect(words({ voice: "listening" })).toEqual(["A DONE", "B BACK"]);
    expect(words({ voice: "thinking" })).toEqual(["B BACK"]);
    expect(words({ voice: "confirm" })).toEqual(["▲▼ CHOOSE", "A SELECT", "B BACK"]);
    expect(words({ voice: "sending" })).toEqual([]);
  });

  it("holds the prompt's buttons while he says it back", () => {
    expect(legendFor({ ...base, voice: "confirm", speaking: true })).toEqual({ note: "TRABOLTA IS SPEAKING", hints: [] });
  });

  it("never offers scrolling: the conversation stands on the newest line", () => {
    const all: Array<Partial<LegendIn>> = [{ menu: true }, { speaking: true }, { voice: "ready" }, { voice: "confirm" }, { files: true }, {}];
    for (const o of all) for (const k of keys(o)) expect(["C", "START"]).not.toContain(k);
  });

  it("offers no file where none can be given", () => {
    expect(keys({ menu: true, canGive: false })).not.toContain("Y");
  });

  it("says what to do with the door open", () => {
    expect(legendFor({ ...base, menu: true, greyed: true }).note).toBe("CLOSE THE DOOR");
  });

  it("says what it's waiting for", () => {
    expect(legendFor(base).note).toBe("WAITING FOR TRABOLTA");
  });

  it("says how to stay when the line is about to drop", () => {
    expect(legendFor({ ...base, menu: true, warning: 9 })).toEqual({ note: "STILL THERE? MOVE THE STICK · 9", hints: [] });
  });

  it("gets out of a scene's way", () => {
    expect(legendFor({ ...base, menu: true, scene: true })).toEqual({ note: null, hints: [] });
  });

  it("gives the file panel its own buttons", () => {
    expect(words({ files: true })).toEqual(["▲▼ CHOOSE", "A SELECT", "B BACK"]);
  });
});

describe("the scenes as cards", () => {
  const scenes = readFileSync(join(__dirname, "../src/cutscene/scenes/heart.tsx"), "utf8");

  it("says the scenes' own words, nothing of its own", () => {
    const said: string[] = [];
    for (const id of ["wake", "sealed", "sealed_present", "proof", "eject", "notyet", "leave", "shutdown"]) {
      const value = `room_heart_${id}`;
      const ms = HEART_SCENE_MS[`heart_${id}` as keyof typeof HEART_SCENE_MS];
      for (let t = 0; t < ms; t += 250) {
        const c = cardOf(value, t);
        if (c === null) continue;
        for (const s of [c.big, c.sub, c.note, ...(c.lines ?? [])]) if (s !== undefined && s !== "") said.push(s);
      }
    }
    expect(said.length).toBeGreaterThan(0);
    for (const s of new Set(said)) expect(scenes, s).toContain(s);
  });

  it("types the boot, then asks for the door, on the scene's clock", () => {
    expect(cardOf("room_heart_wake", 0)?.lines).toEqual([]);
    expect(cardOf("room_heart_wake", 800)?.lines).toHaveLength(1);
    expect(cardOf("room_heart_wake", 8900)?.lines).toHaveLength(3);
    expect(cardOf("room_heart_wake", 9000)).toEqual({ big: "CLOSE THE DOOR" });
  });

  it("asks for the pass once the door has sealed", () => {
    expect(cardOf("room_heart_sealed", 500)).toEqual({ big: "SEALED" });
    expect(cardOf("room_heart_sealed", 3000)?.sub).toBe("SHOW ME YOUR PASS");
  });

  it("counts the shutdown down, then lets him go", () => {
    expect(cardOf("room_heart_shutdown", 0)?.bar).toBe(0);
    expect(cardOf("room_heart_shutdown", 10_250)?.bar).toBeCloseTo(0.5);
    expect(cardOf("room_heart_shutdown", 20_500)?.sub).toMatch(/safe to turn off/u);
  });

  it("is gone when its time is up, and never shows before it", () => {
    expect(cardOf("room_heart_leave", HEART_SCENE_MS.heart_leave)).toBeNull();
    expect(cardOf("room_heart_leave", -1)).toBeNull();
    expect(cardOf("room_heart_nothing", 0)).toBeNull();
  });

  it("leaves his questions and the warning to the top line, over nothing", () => {
    expect(cardOf("room_heart_layer_2", 100)).toBeNull();
    expect(bannerOf("room_heart_layer_2", 100)).toBe("WHAT I AM");
    expect(bannerOf("room_heart_warn", 100)).toBe("CAREFUL");
    expect(bannerOf("room_heart_warn", HEART_SCENE_MS.heart_warn)).toBeNull();
    expect(bannerOf("room_heart_sealed", 100)).toBeNull();
  });
});

describe("nothing cuts him off", () => {
  it("holds the answers for as long as he speaks, past the usual cap", () => {
    expect(panelGate({ sinceDock: PANEL_WAIT_CAP_MS + 5000, voiceBusy: true, sceneLeft: 0, hold: true })).toMatchObject({ open: false, wait: "voice" });
    expect(panelGate({ sinceDock: PANEL_WAIT_CAP_MS + 5000, voiceBusy: true, sceneLeft: 0 }).open).toBe(true);
  });

  it("takes open answers away again when he starts up", () => {
    expect(panelGate({ sinceDock: 30_000, voiceBusy: true, sceneLeft: 0, wasOpen: true, hold: true }).open).toBe(false);
    expect(panelGate({ sinceDock: 30_000, voiceBusy: true, sceneLeft: 0, wasOpen: true }).open).toBe(true);
  });

  it("opens when he's done", () => {
    expect(panelGate({ sinceDock: 30_000, voiceBusy: false, sceneLeft: 0, hold: true }).open).toBe(true);
  });

  it("never locks up on a voice that sticks", () => {
    expect(panelGate({ sinceDock: PANEL_HOLD_CAP_MS, voiceBusy: true, sceneLeft: 0, hold: true }).open).toBe(true);
  });
});

describe("the thread and the newest line", () => {
  const el = (scrollTop: number, scrollHeight = 2000, clientHeight = 300) => ({ scrollTop, scrollHeight, clientHeight });

  it("keeps following when a menu docks and leaves the end out of view", () => {
    expect(followAfter(true, 1700, el(1700, 2000, 200))).toBe(true);
  });

  it("keeps following when a long line lands", () => {
    expect(followAfter(true, 1700, el(1700, 2300))).toBe(true);
  });

  it("stops following when someone scrolls up", () => {
    expect(followAfter(true, 1700, el(1500))).toBe(false);
  });

  it("stops following for the first nudge up from the end, or the stick fights the follow", () => {
    expect(followAfter(true, 1700, el(1690))).toBe(false);
  });

  it("keeps following when the thread shrinks and the browser clamps it to the end", () => {
    expect(followAfter(true, 1700, el(1600, 1900))).toBe(true);
  });

  it("stays stopped while they read, and scrolling on down", () => {
    expect(followAfter(false, 1200, el(1300))).toBe(false);
  });

  it("follows again at the end", () => {
    expect(followAfter(false, 1500, el(1700))).toBe(true);
  });
});

describe("asking for a pass", () => {
  const ask = (o: Partial<Parameters<typeof promptUp>[0]>) => promptUp({ attract: true, until: 0, now: 1000, typing: false, stage: "scan", ...o });

  it("is the pipes with the door shut", () => {
    expect(ask({})).toBe(false);
  });

  it("wakes when the door opens, and holds while it stands open", () => {
    const until = promptAfterDoor(0, true, 1000);
    expect(ask({ until, now: 1_000_000_000 })).toBe(true);
  });

  it("gives a guest a minute after the door shuts behind them, then goes back to the pipes", () => {
    const open = promptAfterDoor(0, true, 0);
    const until = promptAfterDoor(open, false, 5000);
    expect(until).toBe(5000 + PROMPT_LINGER_MS);
    expect(ask({ until, now: 5000 + PROMPT_LINGER_MS - 1 })).toBe(true);
    expect(ask({ until, now: 5000 + PROMPT_LINGER_MS })).toBe(false);
  });

  it("doesn't reopen on a shut door's every poll", () => {
    expect(promptAfterDoor(5000, false, 9000)).toBe(5000);
    expect(promptAfterDoor(0, null, 9000)).toBe(0);
  });

  it("wakes on the controller too, for a sensor that's down, without cutting an open door short", () => {
    expect(promptAfterPress(0, 1000)).toBe(1000 + PROMPT_LINGER_MS);
    expect(promptAfterPress(Number.POSITIVE_INFINITY, 1000)).toBe(Number.POSITIVE_INFINITY);
  });

  it("stays up while someone is typing, past its minute", () => {
    expect(ask({ until: 0, typing: true })).toBe(true);
  });

  it("never asks on a line, or after the heart is done", () => {
    expect(ask({ until: Number.POSITIVE_INFINITY, attract: false })).toBe(false);
    expect(ask({ until: Number.POSITIVE_INFINITY, stage: "done" })).toBe(false);
  });

  it("speaks only for a later guest: the story tells the first one itself", () => {
    const say = (o: Partial<Parameters<typeof speaksPrompt>[0]>) => speaksPrompt({ up: true, typing: false, said: false, voiceBusy: false, stage: "scan", ...o });
    expect(say({})).toBe(true);
    expect(say({ stage: "door" })).toBe(false);
    expect(say({ stage: "sealed" })).toBe(false);
    expect(say({ said: true })).toBe(false);
    expect(say({ voiceBusy: true })).toBe(false);
    expect(say({ typing: true })).toBe(false);
    expect(say({ up: false })).toBe(false);
  });

  it("offers the keyboard in the guide, as the button a held Start presses", () => {
    expect(legendFor({ ...base, prompt: true }).hints).toEqual([{ key: "HOLD START", label: "TYPE YOUR NAME", hold: true }]);
  });

  it("gives the keyboard its own guide", () => {
    expect(words({ typing: true })).toEqual(["▲▼◄► MOVE", "A TYPE", "B DELETE"]);
  });
});

describe("the virtual keyboard", () => {
  it("types, spaces, deletes and finishes", () => {
    expect(keyPressed("TR", "A")).toEqual({ text: "TRA", done: false });
    expect(keyPressed("TR", "SPACE")).toEqual({ text: "TR ", done: false });
    expect(keyPressed("TR", "DELETE")).toEqual({ text: "T", done: false });
    expect(keyPressed("", "DELETE")).toEqual({ text: "", done: false });
    expect(keyPressed("TR", "DONE")).toEqual({ text: "TR", done: true });
  });

  it("stops at the longest name", () => {
    expect(keyPressed("X".repeat(NAME_MAX), "A").text).toHaveLength(NAME_MAX);
  });

  it("walks the grid and stops at its edges", () => {
    expect(keyMoved({ row: 0, col: 0 }, 1, 0)).toEqual({ row: 0, col: 1 });
    expect(keyMoved({ row: 0, col: 0 }, -1, 0)).toEqual({ row: 0, col: 0 });
    expect(keyMoved({ row: 0, col: 0 }, 0, -1)).toEqual({ row: 0, col: 0 });
    expect(keyMoved({ row: 0, col: 8 }, 1, 0)).toEqual({ row: 0, col: 8 });
    expect(keyMoved({ row: 4, col: 0 }, 0, 1)).toEqual({ row: 4, col: 0 });
  });

  it("keeps its place across the shorter bottom row, and comes back", () => {
    expect(KEY_ROWS[keyMoved({ row: 3, col: 8 }, 0, 1).row]![keyMoved({ row: 3, col: 8 }, 0, 1).col]).toBe("DONE");
    expect(keyMoved({ row: 4, col: 3 }, 0, -1)).toEqual({ row: 3, col: 8 });
  });

  it("can reach every key", () => {
    for (let r = 0; r < KEY_ROWS.length; r++) for (let c = 0; c < KEY_ROWS[r]!.length; c++) {
      let at = { row: 0, col: 0 };
      for (let i = 0; i < r; i++) at = keyMoved(at, 0, 1);
      for (let i = 0; i < c; i++) at = keyMoved(at, 1, 0);
      expect(at).toEqual({ row: r, col: c });
    }
  });

  it("can spell every program name it has letters for", () => {
    const all = KEY_ROWS.flat().join("");
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-") expect(all).toContain(ch);
  });
});

describe("the typewriter", () => {
  it("runs a shade ahead of his voice, so a sentence is down as he ends it", () => {
    expect(TYPE_CPS).toBeGreaterThanOrEqual(15);
    expect(TYPE_CPS).toBeLessThanOrEqual(22);
  });
});

describe("the CRT's screen layers", () => {
  it("drops the glitch, the burst, the flicker and the dream", () => {
    const busy = { ...NO_LAYERS, glitch: { seq: 1, at: 1, t: 0, text: "x" }, burst: { seq: 2, at: 1, t: 0, text: "y" }, flicker: 3, dream: "through" as const };
    expect(plainLayers(busy)).toEqual(NO_LAYERS);
  });

  it("keeps the overlays: a blackout is the whole house's", () => {
    expect(plainLayers({ ...NO_LAYERS, overlay: "blackout" }).overlay).toBe("blackout");
  });
});

describe("the crt key", () => {
  it("comes off the link and out of the address bar", () => {
    expect(hintsFromSearch("?code=x&crt=1").crt).toBe(true);
    expect(withoutSecrets("?crt=1")).toBe("");
  });

  it("is off by default, and survives a reload", () => {
    expect(defaultConfig({ eventId: "e", token: "t" }).crt).toBe(false);
    expect(loadConfig({ getItem: () => JSON.stringify({ eventId: "e", token: "t" }) })?.crt).toBe(false);
    expect(loadConfig({ getItem: () => JSON.stringify({ eventId: "e", token: "t", crt: true }) })?.crt).toBe(true);
  });
});
