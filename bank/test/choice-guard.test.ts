//! Guarded choices (wave 20, D9) are live-event only for now: a bank
//! compiles the option unguarded and says so, never silently.

import { describe, expect, it } from "vitest";
import { compileSources } from "../src/compile.ts";

describe("guarded choices in a bank", () => {
  it("bank the option unguarded with a choiceGuardIgnored warning naming the line", () => {
    const bank = compileSources(
      ["== ask\nWell?\n+ (if program.trust >= 20) ⟦TRUSTED⟧ You trust me.\n  Yes.\n+ Who are you?\n  Me.\n"],
      { bankName: "t" },
    );
    const d = bank.diagnostics.filter((x) => x.code === "choiceGuardIgnored");
    expect(d.map((x) => x.severity)).toEqual(["warning"]);
    expect(d[0]!.message).toContain("line 3");
    expect(d[0]!.message).toContain("program.trust >= 20");
    expect(d[0]!.program).toBe("ask");
    expect(d[0]!.line).toBe(3);
    const menu = bank.menus[0]!;
    expect(menu.options).toHaveLength(2);
    expect(menu.options.map((o) => o.cond)).toEqual([-1, -1]);
    // The text banks without its guard.
    expect(JSON.stringify(bank.strings)).toContain("⟦TRUSTED⟧ You trust me.");
    expect(JSON.stringify(bank.strings)).not.toContain("(if program.trust");
  });

  it("an unguarded menu raises nothing", () => {
    const bank = compileSources(["== ask\n* A.\n* B.\n"], { bankName: "t" });
    expect(bank.diagnostics.map((x) => x.code)).not.toContain("choiceGuardIgnored");
  });
});
