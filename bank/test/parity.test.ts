//! Parity with the live engine.
//!
//! The bank IR is meant to become the single semantics both a game engine
//! and the live event server run on. Until that migration happens, the
//! only thing keeping the two honest is this: play the same source through
//! `@loom/core`'s `Sim` and through the bank VM, and require the same
//! sequence of lines and choices.
//!
//! Deliberately excluded are the documented divergences — `-> END`,
//! `<each visit>`'s later arms, `<after:>` latching, once-only choices,
//! and typed `match` arms — where the bank plays the authored language and
//! the live engine does not. Those have their own tests in
//! `interp.test.ts`; mixing them in here would just assert the bug.

import { describe, expect, it } from "vitest";
import { Sim } from "@loom/core/sim";
import type { SimEvent } from "@loom/core/sim";

import { compileSources } from "../src/compile.ts";
import { BankVM } from "../src/interp.ts";
import type { Step } from "../src/ir.ts";

/** A comparable transcript entry, independent of either engine's shape. */
type Entry =
  | { kind: "say"; speaker: string; text: string }
  | { kind: "narrate"; text: string }
  | { kind: "menu"; options: string[] };

/**
 * The bank displays a speaker in the upper-cased ID form its stable engine
 * IDs are hashed from; the live engine (Loom 4 §4) emits the declared name
 * (`Wren`). Both name the same character — compare them in the bank's form.
 */
function bankSpeaker(name: string): string {
  return name.toUpperCase();
}

function fromSim(events: SimEvent[]): Entry[] {
  const out: Entry[] = [];
  for (const e of events) {
    if (e.type === "dialogue") out.push({ kind: "say", speaker: bankSpeaker(e.speaker), text: e.text });
    else if (e.type === "action") out.push({ kind: "narrate", text: e.text });
    else if (e.type === "choicePrompted") out.push({ kind: "menu", options: e.options });
  }
  return out;
}

function fromBank(steps: Step[]): Entry[] {
  const out: Entry[] = [];
  for (const s of steps) {
    if (s.step === "line") {
      if (s.speaker === 0) out.push({ kind: "narrate", text: s.text });
      else out.push({ kind: "say", speaker: s.display ?? "", text: s.text });
    } else if (s.step === "choice") {
      out.push({ kind: "menu", options: s.options.map((o) => o.text) });
    }
  }
  return out;
}

/** Play `source` through both engines, answering `choices` in order. */
function bothEngines(source: string, beat: string, choices: number[] = []): [Entry[], Entry[]] {
  const sim = Sim.fromSources(source);
  const simEvents: SimEvent[] = [...sim.fireBeat(beat)];
  for (const index of choices) simEvents.push(...sim.choose("__global", index));

  const vm = new BankVM();
  vm.loadBank(compileSources([source], { bankName: "p" }));
  vm.start(vm.programByName(beat));
  const bankSteps: Step[] = [...vm.run()];
  for (const index of choices) {
    vm.choose(index);
    bankSteps.push(...vm.run());
  }

  return [fromSim(simEvents), fromBank(bankSteps)];
}

describe("bank/Sim parity", () => {
  it("agrees on narration and dialogue", () => {
    const [sim, bank] = bothEngines(
      `
== a
  cast: Wren
  setting: Lighthouse

The stair smells of salt.

WREN
  You're late.
  (guarded)
  The lamp's been dark.
`,
      "a",
    );
    expect(bank).toEqual(sim);
    expect(sim).toEqual([
      { kind: "narrate", text: "The stair smells of salt." },
      { kind: "say", speaker: "WREN", text: "You're late." },
      { kind: "say", speaker: "WREN", text: "The lamp's been dark." },
    ]);
  });

  it("agrees on conditional arms and interpolation", () => {
    const source = `
== a
<set: trust = 80>
Trust is {trust}.
<if: trust > 50>
  High.
<else>
  Low.
`;
    const [sim, bank] = bothEngines(source, "a");
    expect(bank).toEqual(sim);
    expect(bank).toEqual([
      { kind: "narrate", text: "Trust is 80." },
      { kind: "narrate", text: "High." },
    ]);
  });

  it("agrees on a choice menu and its continuation", () => {
    const source = `
== a
  cast: Wren

WREN
  Well?
  * Climb.
    Up you go.
  * Leave.
    Suit yourself.
Afterwards.
`;
    const [sim, bank] = bothEngines(source, "a", [0]);
    // This is the case the live engine got wrong until the frame-context
    // fix — the post-choice line must still be WREN speaking.
    expect(bank).toEqual(sim);
    expect(bank).toContainEqual({ kind: "say", speaker: "WREN", text: "Up you go." });
  });

  it("agrees that a divert is a call, resuming the caller after it", () => {
    const source = `
== a
Before.
-> b
After.

== b
Inside.
`;
    const [sim, bank] = bothEngines(source, "a");
    expect(bank).toEqual(sim);
    expect(bank.map((e) => ("text" in e ? e.text : ""))).toEqual(["Before.", "Inside.", "After."]);
  });

  it("agrees on hook dispatch, self binding, and SELF speakers", () => {
    const source = `
CHARACTER Wren
  faction: Keepers

  on lamp_lit
    <set: self.trust += 5>
    -> self.reassure

  beat reassure(guest)
    SELF
      The lamp holds.

== a
<fire: lamp_lit>
`;
    const [sim, bank] = bothEngines(source, "a");
    expect(bank).toEqual(sim);
    expect(bank).toEqual([{ kind: "say", speaker: "WREN", text: "The lamp holds." }]);
  });

  it("agrees on a cross-owner divert rebinding self", () => {
    const source = `
CHARACTER Wren
  beat greet(guest)
    SELF
      Wren here.

== a
-> Wren.greet
`;
    const [sim, bank] = bothEngines(source, "a");
    expect(bank).toEqual(sim);
    expect(bank).toEqual([{ kind: "say", speaker: "WREN", text: "Wren here." }]);
  });

  it("agrees on typed-slot defaults feeding a conditional", () => {
    const source = `
CHARACTER Wren
  trust: 0 to 100 = 20

== a
<if: Wren.trust > 10>
  Warm enough.
<else>
  Cold.
`;
    const [sim, bank] = bothEngines(source, "a");
    expect(bank).toEqual(sim);
    expect(bank).toEqual([{ kind: "narrate", text: "Warm enough." }]);
  });

  it("agrees on a match block dispatching a bare-word arm", () => {
    const source = `
== a
<set: mood = storm>
<match: mood>
  storm
    Rain.
  calm
    Still.
`;
    const [sim, bank] = bothEngines(source, "a");
    // A bare word is the case both engines handle identically; a *quoted*
    // arm is where the live engine cannot match and the bank can.
    expect(bank).toEqual(sim);
    expect(bank).toEqual([{ kind: "narrate", text: "Rain." }]);
  });

  it("agrees on nested control flow inside a dialogue block", () => {
    const source = `
== a
  cast: Wren

WREN
  Listen.
  <if: 1>
    Closely.
  Done.
`;
    const [sim, bank] = bothEngines(source, "a");
    // The speaker must be inherited through the conditional arm.
    expect(bank).toEqual(sim);
    expect(bank.every((e) => e.kind === "say" && e.speaker === "WREN")).toBe(true);
  });
});
