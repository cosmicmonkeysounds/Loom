// Wave 56 on the show: how broken Trabolta's voice is, read off the real
// compiled story through the real screen watch. The curve in
// `src/voice-fx.ts` is only as good as the story vars it reads, so this drives
// the show's own rules: the 📺 hijack knocks his composure and cues the glitch,
// ⚡ cues a burst, and the server's `voiceFx` has to say so.

import { describe, expect, it } from "vitest";
import { scenarioSource } from "../examples/load.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { ScreenWatch } from "../server/routes/screen.ts";

const SRC = scenarioSource("trapped-in-the-internet");
const WHO = { name: "", spot: "", view: "", character: "" };
const SLOW = 120_000;

function night() {
  const sim = Sim.fromSources(SRC);
  sim.fireBeat("Power On");
  const clock = { t: 1_000_000 };
  const watch = new ScreenWatch({ now: () => clock.t });
  const fx = () => watch.poll(sim, WHO, () => false).voiceFx;
  fx(); // the first look only folds the history
  return { sim, clock, fx };
}

/** `Night.phase` + what a late phase carries, without playing the night to it. */
function at(sim: Sim, phase: string): void {
  sim.setVar("Night.phase", phase);
}

describe("the arc on the real story", () => {
  it("is clean at the doors", { timeout: SLOW }, () => {
    const { fx } = night();
    expect(fx()).toEqual({ mode: "auto", level: 0, spike: null });
  });

  it("reads the composure the story declares", { timeout: SLOW }, () => {
    const { sim, fx } = night();
    at(sim, "overshare");
    expect(fx().level).toBeCloseTo(0.3 * 0.75, 2); // 85 of 85: at his calmest
    sim.setVar("Trabolta.composure", "0");
    expect(fx().level).toBe(0.38); // 0.375, as the wire rounds it
  });

  it("climbs in the Y2K hour with the story's own clock", { timeout: SLOW }, () => {
    const { sim, fx } = night();
    at(sim, "y2k");
    sim.setVar("Trabolta.composure", "85");
    const flat = fx().level;
    sim.setVar("Night.final_round", "true");
    sim.setVar("Night.y2k_end", String(Number((sim.world.peek("Time.elapsed") as { value?: number } | undefined)?.value ?? 0) + 900));
    expect(fx().level).toBeGreaterThan(flat); // a quarter of an hour to midnight
  });

  it("the helped ending is clean, the banishment is everything", { timeout: SLOW }, () => {
    const { sim, fx } = night();
    at(sim, "finale_help");
    expect(fx().level).toBe(0);
    at(sim, "finale_banish");
    sim.setVar("Trabolta.composure", "0");
    expect(fx().level).toBe(1);
  });

  it("the alarm and his heart hold a floor before the night has got there", { timeout: SLOW }, () => {
    const { sim, fx } = night();
    at(sim, "hunt_2");
    expect(fx().level).toBe(0);
    sim.setVar("Night.heart_stage", "talk");
    expect(fx().level).toBe(0.4);
    sim.setVar("Night.alarm_clear_at", "9999"); // the alarm's own timer, set first by its beat
    sim.setVar("Night.alarm_on", "true");
    expect(fx().level).toBe(0.85);
  });
});

describe("the major glitches, pressed for real", () => {
  function atTheHijack() {
    const n = night();
    n.sim.setVar("Night.phase", "truth_1");
    n.sim.setVar("Night.step", "6");
    n.sim.setVar("Night.results_q", "3");
    return n;
  }

  it("📺 the hijack stands for 8 s over a voice that is otherwise clean, and costs him 20 composure", { timeout: SLOW }, () => {
    const { sim, clock, fx } = atTheHijack();
    sim.signal("second_hunt_preview");
    expect(sim.world.peek("Night.phase")).toMatchObject({ value: "malware" });
    expect(sim.world.peek("Trabolta.composure")).toMatchObject({ value: 65 });
    const on = fx();
    expect(on.level).toBe(0); // before the Trust Chart he snaps straight back
    expect(on.spike).toMatchObject({ kind: "hijack", ms: 8000, strength: 1 });
    expect(on.spike?.flavours).toContain("overclock");
    clock.t += 7999;
    expect(fx().spike?.kind).toBe("hijack");
    clock.t += 2;
    expect(fx().spike).toBeNull();
  });

  it("⚡ a talk scene's burst is its own, shorter spike", { timeout: SLOW }, () => {
    const { sim, clock, fx } = atTheHijack();
    sim.signal("second_hunt_preview");
    fx();
    clock.t += 30_000;
    sim.tick(30_000);
    fx();
    sim.signal("ad_burst");
    const on = fx();
    expect(on.spike).toMatchObject({ kind: "burst", ms: 3600 });
    clock.t += 3601;
    expect(fx().spike).toBeNull();
  });

  it("a flicker in the intro talk is the screens', and his voice stays clean", { timeout: SLOW }, () => {
    const { sim, clock, fx } = night();
    sim.setVar("Night.step", "4");
    sim.setVar("Night.talk", "intro");
    sim.signal("costume_flicker");
    expect(fx().spike).toBeNull();
    clock.t += 10_000;
    // The same press in another talk scene is the catch in his throat it always was.
    sim.setVar("Night.talk", "bottle");
    sim.signal("costume_flicker");
    expect(fx().spike?.kind).toBe("flicker");
  });

  it("a story that has just reloaded plays no spike from its history", { timeout: SLOW }, () => {
    const sim = Sim.fromSources(SRC);
    sim.fireBeat("Power On");
    sim.setVar("Night.phase", "truth_1");
    sim.setVar("Night.step", "6");
    sim.setVar("Night.results_q", "3");
    sim.signal("second_hunt_preview");
    // A watch that only now sees the sim: what it folds is history.
    const fresh = new ScreenWatch({ now: () => 5_000_000 });
    expect(fresh.poll(sim, WHO, () => false).voiceFx.spike).toBeNull();
  });
});
