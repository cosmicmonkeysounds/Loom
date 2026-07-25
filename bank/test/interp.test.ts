//! The reference interpreter — the normative semantics.
//!
//! Anything asserted here is what a GDScript / C# / C++ runtime has to
//! reproduce byte for byte. Anything *not* asserted here is not part of
//! the format, however clearly the spec prose reads.

import { describe, expect, it } from "vitest";
import { compileSources } from "../src/compile.ts";
import { BankVM } from "../src/interp.ts";
import type { Bank, Step } from "../src/ir.ts";
import { vNumber, vString } from "../src/value.ts";

function vmOf(source: string): BankVM {
  const vm = new BankVM();
  vm.loadBank(compileSources([source], { bankName: "t" }));
  return vm;
}

function start(vm: BankVM, beat: string): void {
  vm.start(vm.programByName(beat));
}

/** Every line of text the VM emits, in order. */
function lines(steps: Step[]): string[] {
  return steps.filter((s): s is Extract<Step, { step: "line" }> => s.step === "line").map((s) => s.text);
}

function playAll(vm: BankVM, beat: string): Step[] {
  start(vm, beat);
  return vm.run();
}

describe("lines", () => {
  it("emits narration with speaker 0 and dialogue with a speaker", () => {
    const vm = vmOf(`
== a
The room is dark.

WREN
  I know.
`);
    const steps = playAll(vm, "a").filter((s) => s.step === "line");
    expect(steps).toMatchObject([
      { speaker: 0, text: "The room is dark." },
      { display: "WREN", text: "I know." },
    ]);
  });

  it("interpolates without ever scanning for braces at runtime", () => {
    const vm = vmOf(`
== a
You owe {debt} credits.
`);
    vm.set("debt", vNumber(40));
    expect(lines(playAll(vm, "a"))).toEqual(["You owe 40 credits."]);
  });

  it("escapes doubled braces to literals", () => {
    const vm = vmOf(`
== a
Use {{braces}} literally.
`);
    expect(lines(playAll(vm, "a"))).toEqual(["Use {braces} literally."]);
  });

  it("resolves SELF to the same speaker id as an explicit cue", () => {
    const vm = vmOf(`
CHARACTER Wren
  beat greet(guest)
    SELF
      Hello.

== a
WREN
  Hello.
`);
    const explicit = playAll(vm, "a").find((s) => s.step === "line");
    const viaSelf = playAll(vm, "Wren.greet").find((s) => s.step === "line");
    // A host keying on the speaker id must not see `Wren` and `WREN` as
    // two different characters.
    expect(explicit).toMatchObject({ display: "WREN" });
    expect(viaSelf).toMatchObject({ display: "WREN" });
    if (explicit?.step === "line" && viaSelf?.step === "line") {
      expect(viaSelf.speaker).toBe(explicit.speaker);
    }
  });
});

describe("conditionals", () => {
  it("takes the matching arm", () => {
    const source = `
== a
<if: trust > 50>
  Glad it's you.
<else>
  Don't touch anything.
`;
    const low = vmOf(source);
    expect(lines(playAll(low, "a"))).toEqual(["Don't touch anything."]);

    const high = vmOf(source);
    high.set("trust", vNumber(80));
    expect(lines(playAll(high, "a"))).toEqual(["Glad it's you."]);
  });

  it("runs each-visit branches and sticks on the last authored one", () => {
    const vm = vmOf(`
== a
<each visit>
  first
    Once.
  then
    Again.
`);
    // The live engine only ever runs `first`; a bank plays what was written.
    expect(lines(playAll(vm, "a"))).toEqual(["Once."]);
    expect(lines(playAll(vm, "a"))).toEqual(["Again."]);
    expect(lines(playAll(vm, "a"))).toEqual(["Again."]);
  });

  it("latches <after:> permanently once its condition has held", () => {
    const vm = vmOf(`
== a
<after: armed>
  The warning.
<otherwise>
  Nothing yet.
`);
    expect(lines(playAll(vm, "a"))).toEqual(["Nothing yet."]);
    vm.set("armed", vNumber(1));
    expect(lines(playAll(vm, "a"))).toEqual(["The warning."]);
    // Permanently: the writer's guide promises this, and the live engine
    // re-evaluates instead.
    vm.set("armed", vNumber(0));
    expect(lines(playAll(vm, "a"))).toEqual(["The warning."]);
  });

  it("compares match arms by value", () => {
    const vm = vmOf(`
== a
<match: mood>
  storm
    Rain.
  _
    Calm.
`);
    vm.set("mood", vString("storm"));
    expect(lines(playAll(vm, "a"))).toEqual(["Rain."]);
    vm.set("mood", vString("clear"));
    expect(lines(playAll(vm, "a"))).toEqual(["Calm."]);
  });
});

describe("choices", () => {
  const MENU = `
== a
* Climb.
  You climb.
* Leave.
  You leave.
Afterwards.
`;

  it("suspends on a menu and resumes the option then the continuation", () => {
    const vm = vmOf(MENU);
    const steps = playAll(vm, "a");
    expect(steps.at(-1)).toMatchObject({ step: "choice" });
    expect(vm.isWaiting()).toBe(true);

    expect(vm.choose(0)).toBe(true);
    expect(vm.isWaiting()).toBe(false);
    // The option body runs, then execution continues past the menu.
    expect(lines(vm.run())).toEqual(["You climb.", "Afterwards."]);
  });

  it("rejects an out-of-range choice without consuming the menu", () => {
    const vm = vmOf(MENU);
    playAll(vm, "a");
    expect(vm.choose(7)).toBe(false);
    expect(vm.isWaiting()).toBe(true);
    expect(vm.choose(1)).toBe(true);
  });

  it("reports idle while a menu is unanswered", () => {
    const vm = vmOf(MENU);
    playAll(vm, "a");
    expect(vm.advance()).toEqual({ step: "idle" });
  });

  it("drops a once-only option on a revisit but keeps a sticky one", () => {
    const vm = vmOf(`
== a
+ Ask again.
  Asked.
* Ask once.
  Asked once.
`);
    start(vm, "a");
    let steps = vm.run();
    let choice = steps.at(-1);
    expect(choice?.step === "choice" && choice.options).toHaveLength(2);
    vm.choose(1); // the once-only option
    vm.run();

    start(vm, "a");
    steps = vm.run();
    choice = steps.at(-1);
    expect(choice?.step === "choice" && choice.options.map((o) => o.text)).toEqual(["Ask again."]);
  });

  it("shows suppressed text in place of a taken sticky option", () => {
    const vm = vmOf(`
== a
+ [You already asked.] Ask.
  Asked.
`);
    start(vm, "a");
    vm.run();
    vm.choose(0);
    vm.run();

    start(vm, "a");
    const choice = vm.run().at(-1);
    expect(choice?.step === "choice" && choice.options[0]!.text).toBe("You already asked.");
  });

  it("never dead-ends an exhausted menu", () => {
    const vm = vmOf(`
== a
* Only once.
  Taken.
Afterwards.
`);
    start(vm, "a");
    vm.run();
    vm.choose(0);
    vm.run();

    // Every option is spent. The menu must report idle once and then
    // continue at its resume point, not trap the story.
    start(vm, "a");
    const steps = vm.run();
    expect(steps.some((s) => s.step === "idle")).toBe(true);
    expect(lines(vm.run())).toEqual(["Afterwards."]);
  });
});

describe("diverts", () => {
  it("treats a divert as a call — the caller resumes after it", () => {
    const vm = vmOf(`
== a
Before.
-> b
After.

== b
Inside b.
`);
    // This is the live engine's behaviour and is deliberately preserved,
    // even though Ink-trained authors expect a goto here.
    expect(lines(playAll(vm, "a"))).toEqual(["Before.", "Inside b.", "After."]);
  });

  it("stops the beat dead on -> END", () => {
    const vm = vmOf(`
== a
Before.
-> END
Never reached.
`);
    // In the live engine the `break` exits the switch, not the loop, so
    // `-> END` is inert and "Never reached." plays.
    expect(lines(playAll(vm, "a"))).toEqual(["Before."]);
    expect(vm.advance()).toEqual({ step: "done" });
  });

  it("returns from a tunnel to just after the call", () => {
    const vm = vmOf(`
== a
Before.
(b) ->
After.

== b
Inside.
<-
`);
    expect(lines(playAll(vm, "a"))).toEqual(["Before.", "Inside.", "After."]);
  });

  it("inherits the caller's setting when the target declares none", () => {
    const vm = vmOf(`
== a
  setting: Lighthouse
-> b

== b
Inside.
`);
    const steps = playAll(vm, "a");
    const beats = steps.filter((s): s is Extract<Step, { step: "beat" }> => s.step === "beat");
    expect(beats[1]!.setting).toBe(beats[0]!.setting);
  });

  it("rebinds self when reaching a foreign owner's beat", () => {
    const vm = vmOf(`
CHARACTER Wren
  beat greet(guest)
    SELF
      Wren speaking.

== a
-> Wren.greet
`);
    // The foreign beat must speak as its true owner, not the caller.
    const line = playAll(vm, "a").find((s) => s.step === "line");
    expect(line).toMatchObject({ display: "WREN" });
  });
});

describe("state and hooks", () => {
  it("applies compound <set:> operators through the world", () => {
    const vm = vmOf(`
== a
<set: Wren.trust = 20>
<set: Wren.trust += 10>
<set: Wren.trust *= 2>
`);
    playAll(vm, "a");
    expect(vm.get("Wren.trust")).toEqual(vNumber(60));
  });

  it("seeds typed-slot defaults and entity self-identity", () => {
    const vm = vmOf(`
CHARACTER Wren
  faction: Keepers
  trust: 0 to 100 = 20
`);
    expect(vm.get("Wren.trust")).toEqual(vNumber(20));
    expect(vm.get("Wren.faction")).toEqual(vString("Keepers"));
    // Every entity resolves to its own name, so `x.faction == Keepers`
    // reads naturally in authored expressions.
    expect(vm.get("Wren")).toEqual(vString("Wren"));
  });

  it("fires a hook on a signal and binds self plus the subject", () => {
    const vm = vmOf(`
CHARACTER Wren
  on lamp_lit guest
    <set: self.trust += 5>
    SELF
      I saw that, {guest}.

== a
<fire: lamp_lit>
`);
    vm.set("Wren.trust", vNumber(0));
    const steps = playAll(vm, "a");
    expect(vm.get("Wren.trust")).toEqual(vNumber(5));
    // `self` is bound to the owner, so `self.trust` resolved. A bare
    // `<fire:>` supplies no subject, so `guest` stays unbound and
    // interpolates as `null` — which is what the live engine renders for
    // any unresolved path, not an empty string.
    expect(lines(steps)).toEqual(["I saw that, null."]);
  });

  it("does not surface hook dispatch as a beat step", () => {
    const vm = vmOf(`
CHARACTER Wren
  on ping
    Pinged.

== a
<fire: ping>
`);
    const beats = playAll(vm, "a").filter((s) => s.step === "beat");
    // Hooks are plumbing: a host sees what they emit, not the dispatch.
    expect(beats).toHaveLength(1);
  });

  it("respects a hook's entity filter", () => {
    const vm = vmOf(`
CHARACTER Wren
  on join Mods
    Only for Mods.
`);
    vm.signal("join", "g1", "Chatters");
    expect(lines(vm.run())).toEqual([]);
    vm.signal("join", "g1", "Mods");
    expect(lines(vm.run())).toEqual(["Only for Mods."]);
  });

  it("counts visits per beat", () => {
    const vm = vmOf(`
== a
Visited {visits(a)} times.
`);
    expect(lines(playAll(vm, "a"))).toEqual(["Visited 1 times."]);
    expect(lines(playAll(vm, "a"))).toEqual(["Visited 2 times."]);
  });
});

describe("directives reach the host", () => {
  it("delivers a pass-through directive with parsed arguments", () => {
    const vm = vmOf(`
== a
<cue: projectors, scene: static_takeover, level: 0.7>
`);
    const step = playAll(vm, "a").find((s) => s.step === "directive");
    expect(step).toMatchObject({
      verbName: "cue",
      positional: ["projectors"],
      named: { scene: "static_takeover", level: "0.7" },
      block: 0,
    });
  });

  it("interpolates directive arguments", () => {
    const vm = vmOf(`
== a
<prop: tv, channel: {ch}>
`);
    vm.set("ch", vNumber(13));
    const step = playAll(vm, "a").find((s) => s.step === "directive");
    expect(step).toMatchObject({ named: { channel: "13" } });
  });

  it("brackets a directive block so a host can scope it", () => {
    const vm = vmOf(`
== a
<vibe: crt_glitch>
  Static crawls.
`);
    const steps = playAll(vm, "a");
    const blocks = steps.filter((s): s is Extract<Step, { step: "directive" }> => s.step === "directive");
    expect(blocks.map((b) => b.block)).toEqual([1, 2]);
    // The body runs between the brackets.
    expect(steps.findIndex((s) => s.step === "line")).toBeGreaterThan(steps.indexOf(blocks[0]!));
    expect(steps.findIndex((s) => s.step === "line")).toBeLessThan(steps.indexOf(blocks[1]!));
  });
});

describe("save and load", () => {
  const MENU = `
== a
  setting: Lighthouse
Before.

WREN
  * Climb.
    You climb.
  * Leave.
    You leave.
After.
`;

  it("round-trips mid-choice — the thing the live engine structurally cannot do", () => {
    const vm = vmOf(MENU);
    playAll(vm, "a");
    expect(vm.isWaiting()).toBe(true);

    const saved = JSON.parse(JSON.stringify(vm.save()));
    // The whole point of the flat IR: a suspended continuation is
    // (program, pc) plus scalars, so it survives JSON.
    const revived = vmOf(MENU);
    expect(revived.load(saved).ok).toBe(true);
    expect(revived.isWaiting()).toBe(true);

    expect(revived.choose(0)).toBe(true);
    expect(lines(revived.run())).toEqual(["You climb.", "After."]);
  });

  it("preserves speaker context across a save/load boundary", () => {
    const vm = vmOf(MENU);
    playAll(vm, "a");
    const revived = vmOf(MENU);
    revived.load(JSON.parse(JSON.stringify(vm.save())));
    revived.choose(0);
    const line = revived.run().find((s) => s.step === "line");
    // The option body sits inside a dialogue block, so it must come back
    // as WREN speaking in the Lighthouse — not as speakerless narration.
    expect(line).toMatchObject({ display: "WREN" });
  });

  it("preserves visit counters, latches, and taken options", () => {
    const source = `
== a
<each visit>
  first
    Once.
  then
    Again.
* Only once.
  Taken.
`;
    const vm = vmOf(source);
    start(vm, "a");
    vm.run();
    vm.choose(0);
    vm.run();

    const revived = vmOf(source);
    revived.load(JSON.parse(JSON.stringify(vm.save())));
    start(revived, "a");
    const steps = revived.run();
    expect(lines(steps)).toContain("Again.");
    expect(steps.some((s) => s.step === "choice")).toBe(false);
  });

  it("refuses a save from a changed bank unless migration is allowed", () => {
    const vm = vmOf(`
== a
Before.
`);
    playAll(vm, "a");
    const saved = vm.save();

    const edited = new BankVM();
    edited.loadBank(compileSources([`\n== a\nBefore. And after.\n`], { bankName: "t" }));
    // pcs are meaningless across a recompile, so this must not silently
    // resume at a stale position.
    expect(edited.load(saved)).toMatchObject({ ok: false, reason: "bankChanged" });

    const migrated = new BankVM();
    migrated.loadBank(compileSources([`\n== a\nBefore. And after.\n`], { bankName: "t" }));
    const result = migrated.load(saved, true);
    expect(result.ok).toBe(true);
    // Structural state survives; positions do not.
    expect(migrated.visitsOf("a")).toBe(1);
  });
});

describe("expressions", () => {
  function evalIn(vm: BankVM, expression: string): string {
    const banked = compileSources([`\n== q\n{${expression}}\n`], { bankName: "q" });
    const inner = new BankVM();
    inner.loadBank(banked);
    for (const [key, value] of vm.world.entries()) inner.set(key, value);
    inner.start(inner.programByName("q"));
    const line = inner.run().find((s) => s.step === "line");
    return line?.step === "line" ? line.text : "";
  }

  it("short-circuits and/or to a bool, not to the surviving operand", () => {
    const vm = vmOf(`\n== a\nx\n`);
    vm.set("n", vNumber(5));
    // The live engine yields a bool here; matching it matters because
    // authors compare the result.
    expect(evalIn(vm, "n and 7")).toBe("true");
    expect(evalIn(vm, "0 and 7")).toBe("false");
    expect(evalIn(vm, "0 or 7")).toBe("true");
  });

  it("treats an unknown call as null rather than an error", () => {
    const vm = vmOf(`\n== a\nx\n`);
    expect(evalIn(vm, "mystery(1)")).toBe("null");
  });

  it("evaluates a list comprehension with a filter", () => {
    const vm = vmOf(`\n== a\nx\n`);
    expect(evalIn(vm, "count([n for n in [1, 2, 3] where n > 1])")).toBe("2");
  });
});
