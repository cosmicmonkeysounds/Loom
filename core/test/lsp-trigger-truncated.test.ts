//! L1212 TriggerTruncated (wave 13 fix round): `when glitch out:` parses as
//! the event `glitch` with `out` bound as a subject (the v3 shape, `on rally
//! guest`), so pressing `INTERACTION glitch out` runs nothing. The lint says
//! so, and names the spelling that works (`when glitch_out:`).

import { describe, expect, it } from "vitest";
import { Workspace } from "../src/lsp/index.ts";

describe("L1212: a trigger phrase that keeps only its first word", () => {
  const lint = (rule: string): string[] => {
    const ws = new Workspace();
    ws.open(
      "file:///main.loom",
      `# T\nstart: A\n\nINTERACTION glitch out\n  who: admin\n\n${rule}\n  -> B\n\n== A\nHello.\n\n== B\nStorm.\n\n== C\n  fire power surge\n  show captcha\n`,
    );
    return (ws.diagnosticsFor("file:///main.loom")?.diagnostics ?? [])
      .filter((d) => d.code === "L1212")
      .map((d) => d.message);
  };

  it("`when glitch out:` against INTERACTION glitch out is flagged, with the spelling that works", () => {
    const [msg, ...rest] = lint("when glitch out:");
    expect(rest).toEqual([]);
    expect(msg).toContain("listens for the event `glitch`");
    expect(msg).toContain("write `when glitch_out:`");
  });

  it("a fired event counts too; the spelling that works, a `for` binding and a v3 `on rally guest` do not", () => {
    expect(lint("when power surge:")).toHaveLength(1);
    expect(lint("when glitch_out:")).toEqual([]);
    expect(lint("when glitch out for program:")).toEqual([]);
    expect(lint("on rally guest:")).toEqual([]);
  });

  it("the house's own several-word events and a card's answer count too", () => {
    for (const rule of ["when wrong code:", "when chess won:", "when terminal opened:", "when captcha answered:"]) {
      expect([rule, lint(rule).length]).toEqual([rule, 1]);
    }
    // Bound to their subject they parse whole.
    for (const rule of ["when wrong code for program:", "when chess won for program:", "when captcha answered for program:"]) {
      expect([rule, lint(rule)]).toEqual([rule, []]);
    }
    // A card the story never shows is no event of its own.
    expect(lint("when poll answered:")).toEqual([]);
  });
});
