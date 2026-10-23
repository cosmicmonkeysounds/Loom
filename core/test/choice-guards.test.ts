//! Guarded choices (wave 20, D9): `+ (if <cond>) text` is offered only
//! while its condition holds when the menu is prompted.

import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/index.ts";
import type { BodyItem, Choice } from "../src/parser/index.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { Workspace } from "../src/lsp/index.ts";

function choicesOf(src: string): Choice[] {
  const [file] = parse(src);
  const out: Choice[] = [];
  const walk = (items: BodyItem[]) => {
    for (const item of items) if (item.kind === "choice") out.push(item.value);
  };
  for (const item of file.items) if (item.kind === "beat") walk(item.value.body);
  return out;
}

describe("guarded choices — the parser", () => {
  it("splits `(if …)` off into `guard` and keeps the text after it", () => {
    const [c] = choicesOf("== a\n+ (if program.trust >= 20) ⟦TRUSTED⟧ You trust me.\n");
    expect(c!.guard).toBe("program.trust >= 20");
    expect(c!.text).toBe("⟦TRUSTED⟧ You trust me.");
    expect(c!.sticky).toBe(true);
    expect(c!.suppressed).toBeNull();
  });

  it("an unguarded option has a null guard", () => {
    const [c] = choicesOf("== a\n* Leave.\n");
    expect(c!.guard).toBeNull();
    expect(c!.text).toBe("Leave.");
  });

  it("parens inside the condition nest", () => {
    const [c] = choicesOf("== a\n+ (if (a.x + 1) * (b.y) > 2) Go.\n");
    expect(c!.guard).toBe("(a.x + 1) * (b.y) > 2");
    expect(c!.text).toBe("Go.");
  });

  it("a `[` inside the guard is not hidden text; one after it still is", () => {
    const [c] = choicesOf('== a\n+ (if program.tag == "[x]") Ask[ again]. \n');
    expect(c!.guard).toBe('program.tag == "[x]"');
    expect(c!.text).toBe("Ask.");
    expect(c!.suppressed).toBe(" again");
  });

  it("anything else is plain text: no `(if `, or a paren that never closes", () => {
    expect(choicesOf("== a\n* (whispering) Hello.\n")[0]!.guard).toBeNull();
    expect(choicesOf("== a\n* (whispering) Hello.\n")[0]!.text).toBe("(whispering) Hello.");
    const open = choicesOf("== a\n* (if program.ok Hello.\n")[0]!;
    expect(open.guard).toBeNull();
    expect(open.text).toBe("(if program.ok Hello.");
    expect(choicesOf("== a\n* (iffy) Hello.\n")[0]!.guard).toBeNull();
  });
});

const SOURCE = `
LOCATION Server Room

CHARACTER Trabolta

ROLE Program
  trust: -100 to 100 = 0
  ok: bool = false
  picked: text = "none"
  when ask for program:
    -> Ask
  when ask nothing for program:
    -> Nothing

== Ask
  setting: Server Room
  cast: Trabolta
Trabolta: Well?
+ (if program.trust >= 20) ⟦TRUSTED⟧ You trust me.
  set program.picked = "trusted"
+ Who are you?
  set program.picked = "who"
+ (if program.ok == true) ⟦PROOF⟧ I have proof.
  set program.picked = "proof"
Trabolta: Hm.

== Nothing
  setting: Server Room
  cast: Trabolta
+ (if program.ok == true) Only with proof.
  set program.picked = "proof"
Trabolta: Then go.

== Broken
+ (if program.trust >= ) Never shown.
+ Shown.
`;

const prompts = (evs: SimEvent[]) => evs.filter((e): e is Extract<SimEvent, { type: "choicePrompted" }> => e.type === "choicePrompted");
const said = (evs: SimEvent[]) => evs.filter((e): e is Extract<SimEvent, { type: "dialogue" }> => e.type === "dialogue").map((e) => e.text);

describe("guarded choices — the sim", () => {
  it("a false guard drops the option; a true one offers it", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.createPerson("g1", "Excel");
    expect(prompts(sim.signal("ask", "g1"))[0]!.options).toEqual(["Who are you?"]);
    expect(sim.pendingChoiceFor("g1")).toEqual(["Who are you?"]);
  });

  it("the guard reads the program's own bindings", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.createPerson("g1", "Excel");
    sim.createPerson("g2", "Word");
    sim.setVar("g1.trust", "40");
    sim.setVar("g2.ok", "true");
    expect(prompts(sim.signal("ask", "g1"))[0]!.options).toEqual(["⟦TRUSTED⟧ You trust me.", "Who are you?"]);
    expect(prompts(sim.signal("ask", "g2"))[0]!.options).toEqual(["Who are you?", "⟦PROOF⟧ I have proof."]);
  });

  it("the index answers the shown list, not the written one", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.createPerson("g1", "Excel");
    sim.setVar("g1.ok", "true");
    sim.signal("ask", "g1"); // shown: Who are you? · ⟦PROOF⟧ I have proof.
    const after = sim.choose("g1", 1);
    expect(sim.world.get("g1.picked")).toMatchObject({ value: "proof" });
    expect(said(after)).toEqual(["Hm."]);
  });

  it("a menu with nothing left is skipped: no prompt, the story runs on", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.createPerson("g1", "Excel");
    const evs = sim.signal("ask nothing", "g1");
    expect(prompts(evs)).toEqual([]);
    expect(sim.pendingChoiceFor("g1")).toBeNull();
    expect(said(evs)).toEqual(["Then go."]);
  });

  it("a guard that does not parse is a diagnostic and the option is not offered", () => {
    const sim = Sim.fromSources(SOURCE);
    const evs = sim.fireBeat("Broken");
    expect(prompts(evs)[0]!.options).toEqual(["Shown."]);
    expect(evs.some((e) => e.type === "diagnostic" && e.message.includes("choice guard"))).toBe(true);
  });

  it("a replay of the same commands prompts the same menu", () => {
    const run = () => {
      const sim = Sim.fromSources(SOURCE);
      sim.createPerson("g1", "Excel");
      sim.setVar("g1.trust", "25");
      sim.signal("ask", "g1");
      return sim;
    };
    const a = run();
    const b = run();
    expect(b.pendingChoicesFor("g1")).toEqual(a.pendingChoicesFor("g1"));
    expect(a.pendingChoicesFor("g1")[0]!.options).toEqual(["⟦TRUSTED⟧ You trust me.", "Who are you?"]);
    b.choose("g1", 0);
    expect(b.world.get("g1.picked")).toMatchObject({ value: "trusted" });
  });
});

describe("guarded choices — lint L1221", () => {
  const l1221 = (src: string) => {
    const ws = new Workspace();
    ws.open("file:///main.loom", src);
    return (ws.diagnosticsFor("file:///main.loom")?.diagnostics ?? []).filter((d) => d.code === "L1221");
  };

  it("flags a guard that does not parse, on its line", () => {
    const d = l1221("== a\n+ (if program.trust >= ) Never.\n+ (if program.trust >= 20) Fine.\n* Plain.\n");
    expect(d).toHaveLength(1);
    expect(d[0]!.range.start.line).toBe(1);
    expect(d[0]!.message).toContain("never offered");
  });

  it("reaches a CHARACTER's owned beat too, and leaves good guards alone", () => {
    const src = "CHARACTER Trabolta\n  beat ask\n    + (if self.awake ==) Hi.\n\n== b\n+ (if (a.x + 1) > 2 and b.y) Ok.\n";
    expect(l1221(src).map((d) => d.range.start.line)).toEqual([2]);
  });

  it("skips comments, ``` fences and text: / brief: prose", () => {
    const src = [
      "CODEX Notes",
      "  text:",
      "    + (if nope ==) a bullet in prose.",
      "QUEST Hunt",
      "  brief: find it",
      "    * (if nope ==) more prose.",
      "== a",
      "// + (if nope ==) commented out.",
      "/* * (if nope ==) a block comment. */",
      "```",
      "+ (if nope ==) inside a fence.",
      "```",
      "```inline```",
      "+ (if bad ==) Real.",
      "  text: here",
      "+ (if worse ==) After a dedent.",
    ].join("\n");
    expect(l1221(src).map((d) => d.range.start.line)).toEqual([13, 15]);
  });
});
