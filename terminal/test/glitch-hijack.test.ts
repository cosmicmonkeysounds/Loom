//! The glitch and the hijack slide cued in one story rule (wave 26, T2): the
//! 📺 rule cues `screens_glitch` and then `screens_ad_hijack`, so both carry
//! the same `at`. The slide's scene must not run its freeze, tear and slam
//! (and their sounds) under the takeover's dark field: its clock starts when
//! the takeover ends, and it holds its first frame until then.

import { describe, expect, it } from "vitest";
import { MomentQueue, pickScene } from "../src/cutscene/pick.ts";
import type { SceneDef } from "../src/cutscene/types.ts";
import { EMPTY_NIGHT, type ScreenProgram, type ScreenState } from "../src/screen.ts";
import { GLITCH_MS, screenLayers } from "../src/slides.ts";

const T0 = 3_000_000;
const shot = (value: string, at: number, seq = 1) => ({ value, cue: `screens_${value}`, seq, at });

function state(program: Partial<ScreenProgram>, now = T0): ScreenState {
  return {
    now,
    receivedAt: now,
    firstNow: T0 - 60_000,
    night: EMPTY_NIGHT,
    moments: [],
    cues: {},
    character: { id: "Trabolta", hidden: false, awake: true, online: true, hold: false },
    attract: false,
    countdown: null,
    remaining: null,
    chart: null,
    target: "terminals",
    voice: null,
    room: null,
    announce: null,
    announces: [],
    identify: false,
    identifyLeft: null,
    announceEpoch: null,
    king: null,
    reinstalling: 0,
    program: { slide: null, overlay: null, blackout: null, flicker: null, ...program },
  };
}

describe("the hijack slide cued with the glitch", () => {
  const def: SceneDef = { id: "ad_hijack", when: [{ slide: "ad_hijack" }], ms: "hold", tv: () => null, wall: () => null };
  const program = { glitch: shot("glitch", T0, 4), slide: { ...shot("ad_hijack", T0 + 1, 7), kind: "slide" as const, persist: true } };

  const pick = (now: number) => {
    const s = state(program, now);
    const layers = screenLayers(s, now, { piloting: false });
    return { layers, pick: pickScene({ state: s, now, layers, bare: false, target: "wall", scenes: [def], queue: new MomentQueue() }) };
  };

  it("holds the scene at its first frame under the takeover, then runs it from the takeover's end", () => {
    const during = pick(T0 + 2000);
    expect(during.layers.glitch).toMatchObject({ seq: 4, t: 2000 });
    const scene = during.pick.base;
    expect(scene).not.toBeNull();
    expect(scene !== null && scene !== "card" && scene.start).toBe(T0 + GLITCH_MS);
    // The stage's t is max(0, now − start): 0 for the whole takeover (no cue fires at 0).
    expect(Math.max(0, T0 + 2000 - (T0 + GLITCH_MS))).toBe(0);
    // After it: the glitch is gone and the scene runs from the end of it, the same key throughout.
    const after = pick(T0 + GLITCH_MS + 1500);
    expect(after.layers.glitch).toBeNull();
    const s2 = after.pick.base;
    expect(s2 !== null && s2 !== "card" && s2.start).toBe(T0 + GLITCH_MS);
    expect(s2 !== null && s2 !== "card" && s2.key).toBe(scene !== null && scene !== "card" ? scene.key : "");
  });
});
