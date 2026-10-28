//! Trapped in the Internet — wave 38 (contract `docs/loom-w38-contract.md`
//! C5): the soundtrack's scenes. Each act change both cues the router
//! (`cue music_<scene>`, live) and mirrors it in `Night.music` (the screen
//! state's `night.music`, the router's catch-up after a restart), exactly as
//! the lights do; every ending turns the music off. The scene names here are
//! the ones `stagehand/media/soundtrack.yaml` defines (pinned on that side by
//! `stagehand/tests/test_trapped_house.py`).

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioFiles, scenarioSource } from "../examples/load.ts";
import { notePress, pressRefused } from "../server/views.ts";
import { CEREMONY, TO_Y2K, Y2K_TO_DESTROYED, Y2K_TO_HEART_END, Y2K_TO_VERDICT, pressChain, type ChainStep } from "../../scripts/accept/chains.ts";

const SCENES = ["doors", "act_1", "malware", "act_2", "act_3", "final", "off", "ceremony", "afterparty"];
const FILES = scenarioFiles("trapped-in-the-internet");

/** A file's top-level blocks: each `when …:` rule, `== Beat` or upper-case
 *  declaration (`INTERACTION x`), with the lines up to the next one. */
function blocks(source: string): { head: string; lines: string[] }[] {
  const out: { head: string; lines: string[] }[] = [];
  for (const line of source.split("\n")) {
    if (/^(when |== |[A-Z]{2,} )/u.test(line)) out.push({ head: line, lines: [] });
    else out[out.length - 1]?.lines.push(line);
  }
  return out;
}

describe("the story's music cues (static)", () => {
  const lines = FILES.flatMap((f) => f.source.split("\n").map((text, i) => ({ file: f.path, i, text })));

  it("every `cue music_<scene>` is followed by its mirror, at the same indent", () => {
    const cues = lines.filter((l) => /^\s*cue music_/u.test(l.text));
    expect(cues.length).toBeGreaterThanOrEqual(SCENES.length);
    for (const c of cues) {
      const [, ind, scene] = /^(\s*)cue music_(\w+)$/u.exec(c.text)!;
      const next = FILES.find((f) => f.path === c.file)!.source.split("\n")[c.i + 1];
      expect(next, `${c.file}:${c.i + 1}`).toBe(`${ind}set Night.music = "${scene}"`);
    }
    // And no mirror without its cue (the catch-up and the live cue agree).
    const sets = lines.filter((l) => /set Night\.music = /u.test(l.text));
    expect(sets).toHaveLength(cues.length);
  });

  it("names exactly the contract's scenes", () => {
    const named = new Set(lines.flatMap((l) => /^\s*cue music_(\w+)$/u.exec(l.text)?.slice(1) ?? []));
    expect([...named].sort()).toEqual([...SCENES].sort());
  });

  it("every rule or beat that ends the night turns the music off", () => {
    const ending = FILES.flatMap((f) => blocks(f.source).filter((b) => b.lines.some((l) => /set Night\.ended = true/u.test(l))).map((b) => ({ ...b, file: f.path })));
    expect(ending.map((b) => b.head.trim()).sort()).toEqual(["== Sad Confession", "== Song Ending", "when advice_helped:", "when computer_destroyed:", "when no_pickup_line:", "when the_hand_jive:", "when trabolta_disabled:"].sort());
    for (const b of ending) {
      const end = b.lines.findIndex((l) => /set Night\.ended = true/u.test(l));
      const off = b.lines.findIndex((l) => /cue music_off/u.test(l));
      expect(off, `${b.file} ${b.head}`).toBeGreaterThan(end);
      // Off comes before the ending's own song (a takeover track) starts.
      const song = b.lines.findIndex((l, i) => i > end && /^\s*sound /u.test(l));
      if (song >= 0) expect(off, `${b.file} ${b.head}`).toBeLessThan(song);
    }
  });

  it("the ad hijack cues its scene before its jingle (the track takes over first)", () => {
    const main = FILES.find((f) => f.path === "main.loom")!;
    const rule = blocks(main.source).find((b) => b.head === "when second_hunt_preview:")!;
    const cue = rule.lines.findIndex((l) => /cue music_malware/u.test(l));
    expect(cue).toBeGreaterThan(-1);
    expect(cue).toBeLessThan(rule.lines.findIndex((l) => /sound ad_jingle/u.test(l)));
  });
});

describe("the music through a night (the sim)", () => {
  function night() {
    const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    const boot = sim.fireBeat("Power On");
    sim.createPerson("g-sim1", "Calculator");
    sim.createPerson("g-sim2", "Winamp");
    const cued: string[] = [];
    const note = (out: SimEvent[]) => {
      for (const e of out) if (e.type === "directive" && e.verb === "cue" && /^music_/u.test(e.args)) cued.push(e.args.slice("music_".length));
    };
    note(boot);
    const press = async (name: string, who?: string) => {
      const out = sim.signal(name, who === undefined ? undefined : "g-sim1");
      note(out);
      notePress(sim, out);
      return pressRefused(sim, out) ? { ok: true, refused: true } : { ok: true };
    };
    const tick = (seconds: number) => {
      for (let i = 0; i < seconds; i++) note(sim.tick(1000));
    };
    const music = () => (sim.world.get("Night.music") as { value: unknown } | undefined)?.value;
    const chain = async (steps: readonly ChainStep[]) => expect(await pressChain(steps, press, () => {})).toEqual({ ok: true, refused: [] });
    return { sim, cued, music, chain, tick };
  }

  it("Power On → the Y2K clock: doors, act 1, the malware, act 2, act 3", { timeout: 60_000 }, async () => {
    const n = night();
    expect(n.music()).toBe("doors");
    await n.chain(TO_Y2K);
    expect(n.cued).toEqual(["doors", "act_1", "malware", "act_2", "act_3"]);
    expect(n.music()).toBe("act_3");
  });

  it("the heart's ending, then the ceremony and the resurrection: off, ceremony, afterparty", { timeout: 60_000 }, async () => {
    const n = night();
    await n.chain(TO_Y2K);
    await n.chain(Y2K_TO_HEART_END);
    expect(n.music()).toBe("off");
    n.tick(15);
    await n.chain(CEREMONY);
    expect(n.cued.slice(-3)).toEqual(["off", "ceremony", "afterparty"]);
    expect(n.music()).toBe("afterparty");
  });

  it("midnight's road: final at the reveal, off at the song", { timeout: 60_000 }, async () => {
    const n = night();
    await n.chain(TO_Y2K);
    await n.chain(Y2K_TO_VERDICT);
    expect(n.music()).toBe("final");
    n.tick(40);
    expect(n.music()).toBe("off");
    expect(n.cued.slice(-2)).toEqual(["final", "off"]);
  });

  it("Combo B (destroyed) turns it off", { timeout: 60_000 }, async () => {
    const n = night();
    await n.chain(TO_Y2K);
    await n.chain(Y2K_TO_DESTROYED);
    expect(n.music()).toBe("off");
  });
});
