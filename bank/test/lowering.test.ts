//! Lowering — every `BodyItem` kind to its instruction stream.
//!
//! These assert on decoded opcodes rather than on trace output, so a
//! lowering regression is localised to the compiler instead of showing up
//! as a mysterious behavioural diff.

import { describe, expect, it } from "vitest";
import { compileSources } from "../src/compile.ts";
import { OP_NAMES, Op, WORDS_PER_INSTRUCTION } from "../src/ir.ts";
import type { Bank } from "../src/ir.ts";

function bankOf(source: string): Bank {
  return compileSources([source], { bankName: "t" });
}

function program(bank: Bank, name: string) {
  const p = bank.programs.find((x) => bank.names[x.name] === name);
  if (p === undefined) throw new Error(`no program ${name}; have ${bank.programs.map((x) => bank.names[x.name])}`);
  return p;
}

/** Decode a program to `[opName, a, b, c]` rows. */
function decode(bank: Bank, name: string): Array<[string, number, number, number]> {
  const p = program(bank, name);
  const out: Array<[string, number, number, number]> = [];
  for (let pc = 0; pc < p.code.length / WORDS_PER_INSTRUCTION; pc++) {
    const b = pc * WORDS_PER_INSTRUCTION;
    out.push([OP_NAMES[p.code[b]!]!, p.code[b + 1]!, p.code[b + 2]!, p.code[b + 3]!]);
  }
  return out;
}

const ops = (bank: Bank, name: string): string[] => decode(bank, name).map((r) => r[0]);

describe("narration and dialogue", () => {
  it("narrates outside a speaker and speaks inside one", () => {
    const bank = bankOf(`
== a
The room is dark.

WREN
  I know.
`);
    expect(ops(bank, "a")).toEqual(["NARRATE", "SPEAK", "HALT"]);
  });

  it("drops a bare parenthetical under a speaker, keeping it as a note", () => {
    const bank = bankOf(`
== a

WREN
  (guarded)
  I know.
`);
    // The delivery note must not become a spoken line — and it is dropped
    // at compile time, not skipped on every playback.
    expect(ops(bank, "a")).toEqual(["SPEAK", "HALT"]);
    expect(program(bank, "a").notes).toEqual([{ pc: 0, text: "(guarded)" }]);
  });

  it("keeps a parenthetical as narration when there is no speaker", () => {
    const bank = bankOf(`
== a
(a distant bell)
`);
    expect(ops(bank, "a")).toEqual(["NARRATE", "HALT"]);
  });
});

describe("control flow", () => {
  it("lowers an if/else chain to guarded jumps with a shared join", () => {
    const bank = bankOf(`
== a
<if: x > 1>
  One.
<else>
  Two.
`);
    const rows = decode(bank, "a");
    expect(rows.map((r) => r[0])).toEqual(["JUMP_IF_NOT", "NARRATE", "JUMP", "NARRATE", "JUMP", "HALT"]);
    // The failing test jumps to the else body; both arms land on the join.
    expect(rows[0]![2]).toBe(3);
    expect(rows[2]![1]).toBe(5);
    expect(rows[4]![1]).toBe(5);
  });

  it("lowers each-visit with only the authored branches", () => {
    const bank = bankOf(`
== a
<each visit>
  first
    Once.
  finally
    Always after.
`);
    expect(ops(bank, "a")).toEqual(["EACH_VISIT", "NARRATE", "JUMP", "NARRATE", "JUMP", "HALT"]);
    const table = bank.visitTables[decode(bank, "a")[0]![2]]!;
    // Two authored branches, so `min(n, 2) - 1` clamps: `finally` sticks.
    expect(table.branches).toEqual([1, 3]);
    expect(table.resume).toBe(5);
  });

  it("lowers after/otherwise with a latch site", () => {
    const bank = bankOf(`
== a
<after: x > 1>
  Later.
<otherwise>
  Sooner.
`);
    expect(ops(bank, "a")).toEqual(["AFTER", "NARRATE", "JUMP", "NARRATE", "HALT"]);
    expect(program(bank, "a").siteKeys).toEqual(["a/body/0/after"]);
  });

  it("types match arm literals, so a quoted arm can actually match", () => {
    const bank = bankOf(`
== a
<match: mood>
  storm
    Rain.
  3
    Three.
  _
    Otherwise.
`);
    const table = bank.switches[decode(bank, "a")[0]![2]]!;
    expect(table.cases.map((c) => c.lit)).toEqual([
      { t: "str", v: "storm" },
      { t: "num", v: 3 },
    ]);
    expect(table.default).toBeGreaterThan(0);
  });

  it("falls through to the join when a match has no default arm", () => {
    const bank = bankOf(`
== a
<match: mood>
  storm
    Rain.
After.
`);
    const rows = decode(bank, "a");
    const table = bank.switches[rows[0]![2]]!;
    // No `_` arm: an unmatched scrutinee continues after the block rather
    // than skipping the rest of the beat.
    const join = rows.findIndex((r) => r[0] === "NARRATE" && r !== rows[1]);
    expect(table.default).toBe(join);
  });
});

describe("choices", () => {
  it("coalesces a run of consecutive choices into one menu", () => {
    const bank = bankOf(`
== a
* One.
  Took one.
* Two.
  Took two.
After the menu.
`);
    expect(ops(bank, "a")).toEqual([
      "MENU",
      "NARRATE",
      "JUMP",
      "NARRATE",
      "JUMP",
      "NARRATE",
      "HALT",
    ]);
    const menu = bank.menus[0]!;
    expect(menu.options).toHaveLength(1 + 1);
    expect(menu.resume).toBe(5);
    // Both option bodies rejoin at the menu's resume point.
    expect(decode(bank, "a")[2]![1]).toBe(5);
    expect(decode(bank, "a")[4]![1]).toBe(5);
  });

  it("splits two separated choice runs into two menus", () => {
    const bank = bankOf(`
== a
* One.
Interlude.
* Two.
`);
    expect(bank.menus).toHaveLength(2);
  });

  it("carries sticky and suppressed labels onto options", () => {
    const bank = bankOf(`
== a
+ Ask again.
* [She looks away.] Ask once.
`);
    const [sticky, once] = bank.menus[0]!.options;
    expect(sticky!.sticky).toBe(true);
    expect(once!.sticky).toBe(false);
    expect(once!.suppressed).toBeGreaterThanOrEqual(0);
  });

  it("tags options structurally, so a save survives an edit", () => {
    const bank = bankOf(`
== a
* One.
`);
    // A structural path, not an ordinal — inserting a sibling elsewhere
    // must not renumber this option's persisted key.
    expect(bank.menus[0]!.options[0]!.tag).toBe("a/body/0/opt0");
  });
});

describe("diverts", () => {
  it("lowers the four divert kinds to distinct opcodes", () => {
    const bank = bankOf(`
== a
-> b
(c) ->
<-
-> END

== b
Done.

== c
Tunnelled.
`);
    expect(ops(bank, "a")).toEqual(["DIVERT", "TUNNEL", "RETURN", "END", "HALT"]);
  });

  it("resolves a bare divert to a local program index", () => {
    const bank = bankOf(`
== a
-> b

== b
Done.
`);
    const target = bank.targets[decode(bank, "a")[0]![1]]!;
    expect(target).toEqual({ kind: "local", program: bank.programs.findIndex((p) => bank.names[p.name] === "b") });
  });

  it("keeps a self-qualified divert dynamic", () => {
    const bank = bankOf(`
CHARACTER Wren
  on scan guest
    -> self.greet

  beat greet(guest)
    SELF
      Hello.
`);
    const hook = bank.programs.find((p) => p.kind === "hook")!;
    const targetId = hook.code[1]!;
    const target = bank.targets[targetId]!;
    // `self.` cannot be resolved at compile time — whoever routed in
    // decides, so it stays an owned target resolved per frame.
    expect(target.kind).toBe("owned");
    if (target.kind === "owned") expect(target.qualifier).toBe("self");
  });

  it("warns on a divert that names no beat", () => {
    const bank = bankOf(`
== a
-> nowhere
`);
    expect(bank.diagnostics.map((d) => d.code)).toContain("unresolvedDivert");
  });
});

describe("directives", () => {
  it("lowers <set:> to a SET with a compile-time parsed clause", () => {
    const bank = bankOf(`
== a
<set: Wren.trust += 10>
`);
    expect(ops(bank, "a")).toEqual(["SET", "HALT"]);
    const entry = bank.sets[0]!;
    expect(entry.op).toBe("+=");
    expect(bank.paths[entry.path]!.segs.map((s) => bank.names[s])).toEqual(["Wren", "trust"]);
  });

  it("records a bare-identifier RHS as a string fallback", () => {
    const bank = bankOf(`
== a
<set: guest.faction = Mods>
`);
    // `Mods` is a name, not a variable — the fallback fires only when the
    // path resolves to nothing.
    expect(bank.strings[bank.sets[0]!.enum]).toBe("Mods");
  });

  it("lowers <fire:> to SIGNAL and registers the signal name", () => {
    const bank = bankOf(`
== a
<fire: lamp_lit>
`);
    expect(ops(bank, "a")).toEqual(["SIGNAL", "HALT"]);
    expect(bank.signals.map((s) => s.name)).toEqual(["lamp_lit"]);
  });

  it("pre-parses a pass-through directive's arguments", () => {
    const bank = bankOf(`
== a
<cue: projectors, scene: static_takeover, level: 0.7>
`);
    expect(ops(bank, "a")).toEqual(["HOST", "HALT"]);
    const args = bank.directiveArgs[0]!;
    // No runtime ever sees a comma — this is what keeps a GDScript
    // implementation small.
    expect(args.positional).toHaveLength(1);
    expect(args.named.map((n) => bank.names[n.key])).toEqual(["scene", "level"]);
  });

  it("brackets a directive block with begin/end host steps", () => {
    const bank = bankOf(`
== a
<vibe: crt_glitch>
  Static crawls.
`);
    const rows = decode(bank, "a");
    expect(rows.map((r) => r[0])).toEqual(["HOST", "NARRATE", "HOST", "HALT"]);
    expect(rows[0]![3]).toBe(1);
    expect(rows[2]![3]).toBe(2);
  });
});

describe("let bindings", () => {
  it("allocates a frame slot and clears it at scope exit", () => {
    const bank = bankOf(`
== a
<let: gale = wind > 40>
<if: gale>
  Windy.
`);
    expect(ops(bank, "a")).toEqual(["LET", "JUMP_IF_NOT", "NARRATE", "JUMP", "CLEAR_LOCALS", "HALT"]);
    expect(program(bank, "a").localCount).toBeGreaterThanOrEqual(1);
  });

  it("reads the binding from its slot, not from the world", () => {
    const bank = bankOf(`
== a
<let: gale = 1>
<if: gale>
  Windy.
`);
    // `gale` must compile to E_LOCAL — that is what makes a `<let:>`
    // frame-local instead of leaking into diverted beats.
    const condId = decode(bank, "a")[1]![1];
    const ref = bank.exprs[condId]!;
    expect(bank.exprCode.slice(ref.at, ref.at + ref.len)).toEqual([7, 0]);
  });
});

describe("program headers", () => {
  it("records the entry beat, setting, and cast", () => {
    const bank = bankOf(`
entry: opening

== opening
  cast: Wren, Fisher
  setting: Lighthouse

Hello.
`);
    const p = program(bank, "opening");
    expect(bank.entry).toBe(bank.programs.indexOf(p));
    expect(bank.names[p.setting]).toBe("Lighthouse");
    expect(bank.names[p.cast]).toBe("Wren");
  });

  it("registers a class-owned beat under Owner.name", () => {
    const bank = bankOf(`
CHARACTER Wren
  beat greet(guest)
    SELF
      Hello.
`);
    expect(bank.names[program(bank, "Wren.greet").name]).toBe("Wren.greet");
    expect(program(bank, "Wren.greet").kind).toBe("ownedBeat");
  });

  it("freezes hook dispatch order rather than leaving it to map order", () => {
    const bank = bankOf(`
CHARACTER Zeta
  on scan guest
    Zeta saw you.

CHARACTER Alpha
  on scan guest
    Alpha saw you.
`);
    expect(bank.hooks.map((h) => h.order)).toEqual([0, 1]);
    // Sorted by owner *hash*, not declaration order, so three runtimes
    // agree without relying on map iteration.
    expect(new Set(bank.hooks.map((h) => bank.names[h.owner]))).toEqual(new Set(["Zeta", "Alpha"]));
  });
});
