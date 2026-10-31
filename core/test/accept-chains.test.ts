//! The acceptance helpers' cue chains (scripts/accept/chains.ts — K-24's
//! setup to hunt 2, K-27's to the Y2K clock) walk the show in the order the
//! wave 9 cue sheet demands: every press accepted (never `refused`), and the
//! night lands where the helper says it does.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";
import { cueState, notePress, pressRefused } from "../server/views.ts";
import { CEREMONY, THE_FULL_TRUTH, TO_HUNT2, TO_Y2K, Y2K_TO_DESTROYED, Y2K_TO_DISABLED, Y2K_TO_VERDICT, pressChain } from "../../scripts/accept/chains.ts";

function night() {
  const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
  sim.fireBeat("Power On");
  const signal = async (name: string) => {
    const out = sim.signal(name);
    notePress(sim, out);
    return pressRefused(sim, out) ? { ok: true, refused: true } : { ok: true };
  };
  const v = (p: string) => (sim.world.get(p) as { value: unknown } | undefined)?.value;
  return { sim, signal, v };
}

describe("the acceptance cue chains", () => {
  it("K-24's setup reaches hunt 2 with every press accepted", async () => {
    const { sim, signal, v } = night();
    const r = await pressChain(TO_HUNT2, signal, () => {});
    expect(r).toEqual({ ok: true, refused: [] });
    expect([v("Night.phase"), v("Night.step")]).toEqual(["hunt_2", 8]);
    expect(cueState(sim).last).toBe("start_the_second_hunt");
  });

  it("K-27's setup reaches the Y2K clock (step 14) with every press accepted", { timeout: 60_000 }, async () => {
    const { sim, signal, v } = night();
    const r = await pressChain(TO_Y2K, signal, () => {});
    expect(r).toEqual({ ok: true, refused: [] });
    expect([v("Night.phase"), v("Night.step")]).toEqual(["y2k", 14]);
    expect(cueState(sim).last).toBe("y2k_clock");
  });

  it("the old shortcut is refused, and a rerun stops at the first refusal", async () => {
    const { signal, v } = night();
    expect(await signal("y2k_clock")).toEqual({ ok: true, refused: true });
    await pressChain(TO_HUNT2, signal, () => {});
    const again = await pressChain(TO_HUNT2, signal, () => {});
    expect(again.ok).toBe(false);
    expect(again.refused[0]).toBe("call_to_the_desktop");
    expect(v("Night.phase")).toBe("hunt_2");
  });

  it("a filing window the timer already closed is no reason to stop", async () => {
    const { sim, signal, v } = night();
    await pressChain(TO_HUNT2.slice(0, TO_HUNT2.indexOf("close_the_filing")), signal, () => {});
    expect(v("Night.filing_open")).toBe(true);
    for (let i = 0; i < 130; i++) sim.tick(1000);
    expect(v("Night.filing_open")).toBe(false);
    const r = await pressChain(TO_HUNT2.slice(TO_HUNT2.indexOf("close_the_filing")), signal, () => {});
    expect(r.ok).toBe(true);
    expect(v("Night.phase")).toBe("hunt_2");
  });
});

// Wave 28: the chains after the Y2K clock, which the full-evening simulator
// (scripts/sim/evening.ts) presses: each ending, then the whole ceremony.
describe("the chains after the Y2K clock", () => {
  async function atY2K() {
    const n = night();
    n.sim.createPerson("g-sim1", "Calculator");
    n.sim.createPerson("g-sim2", "Winamp");
    // A step's `who` names a role; here every role is the first program.
    const aimed = async (name: string, who?: string) => {
      const out = n.sim.signal(name, who === undefined ? undefined : "g-sim1");
      notePress(n.sim, out);
      return pressRefused(n.sim, out) ? { ok: true, refused: true } : { ok: true };
    };
    expect((await pressChain(TO_Y2K, n.signal, () => {})).ok).toBe(true);
    return { ...n, aimed };
  }
  const tick = (sim: Sim, seconds: number) => {
    for (let i = 0; i < seconds; i++) sim.tick(1000);
  };

  it("Combo A's ending without the cables, 📜, then the ceremony to the resurrection", { timeout: 60_000 }, async () => {
    const { sim, aimed, v } = await atY2K();
    expect(await pressChain(Y2K_TO_DISABLED, aimed, () => {})).toEqual({ ok: true, refused: [] });
    expect([v("Night.ending"), v("Night.ended"), v("Night.step")]).toEqual(["disabled", true, 19]);
    tick(sim, 15);
    expect(await pressChain(THE_FULL_TRUTH, aimed, () => {})).toEqual({ ok: true, refused: [] });
    expect(v("Night.truth_reader")).toBe("Task Manager");
    tick(sim, 840);
    expect(await pressChain(CEREMONY, aimed, () => {})).toEqual({ ok: true, refused: [] });
    expect([v("Night.ceremony_done"), v("Night.resurrected")]).toEqual([true, true]);
  });

  it("Combo B's ending without the cables: destroyed", { timeout: 60_000 }, async () => {
    const { v, aimed } = await atY2K();
    expect(await pressChain(Y2K_TO_DESTROYED, aimed, () => {})).toEqual({ ok: true, refused: [] });
    expect([v("Night.ending"), v("Night.ended")]).toEqual(["destroyed", true]);
  });

  it("midnight's road: the full truth, then nobody found it → 8-B", { timeout: 60_000 }, async () => {
    const { sim, v, aimed } = await atY2K();
    expect(await pressChain(Y2K_TO_VERDICT, aimed, () => {})).toEqual({ ok: true, refused: [] });
    expect(v("Night.phase")).toBe("finale_truth");
    for (const s of [831, 106, 121, 35]) tick(sim, s); // nobody found the last answer: 8-B
    expect([v("Night.ending"), v("Night.ended")]).toEqual(["song_pickup", true]);
  });

  it("an aimed award with nobody named is refused (the caller must say who)", { timeout: 60_000 }, async () => {
    const { sim, signal } = await atY2K();
    await pressChain(Y2K_TO_DISABLED, signal, () => {});
    tick(sim, 15);
    await pressChain(THE_FULL_TRUTH, signal, () => {});
    tick(sim, 840);
    expect(await pressChain(CEREMONY, signal, () => {})).toEqual({ ok: false, refused: ["award_most_trusted"] });
  });
});
