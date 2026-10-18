//! The acceptance helpers' cue chains (scripts/accept/chains.ts — K-24's
//! setup to hunt 2, K-27's to the Y2K clock) walk the show in the order the
//! wave 9 cue sheet demands: every press accepted (never `refused`), and the
//! night lands where the helper says it does.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";
import { cueState, notePress, pressRefused } from "../server/views.ts";
import { TO_HUNT2, TO_Y2K, pressChain } from "../../scripts/accept/chains.ts";

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
