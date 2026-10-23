//! Guarded choices in the editing surfaces (wave 20, D9): an in-place
//! edit of an option's text keeps its guard, and the story graph's node
//! preview shows the guard.

import { describe, expect, it } from "vitest";
import { appendChoice, applyEdits, choiceTextRange, editChoiceText, parse } from "../src/parser/index.ts";
import type { Choice } from "../src/parser/index.ts";
import { previewBody } from "../src/lsp/graph.ts";

const SRC = `== Heart Talk
Trabolta: Well?
  + (if program.trust >= 20) ⟦TRUSTED⟧ You trust me.
    -> Heart Pick
  * Who are you?
`;

function choices(src: string): Choice[] {
  const [file] = parse(src);
  const beat = file.items.find((i) => i.kind === "beat");
  if (beat?.kind !== "beat") throw new Error("no beat");
  const out: Choice[] = [];
  const walk = (items: typeof beat.value.body) => {
    for (const it of items) {
      if (it.kind === "choice") out.push(it.value);
      if (it.kind === "dialogue") walk(it.value.body);
    }
  };
  walk(beat.value.body);
  return out;
}

describe("editing a guarded option", () => {
  it("the text range starts after the guard", () => {
    const [guarded, plain] = choices(SRC);
    const g = choiceTextRange(SRC, guarded!)!;
    expect(SRC.slice(g[0], g[1])).toBe("⟦TRUSTED⟧ You trust me.");
    const p = choiceTextRange(SRC, plain!)!;
    expect(SRC.slice(p[0], p[1])).toBe("Who are you?");
  });

  it("an in-place edit of the text keeps the marker and the guard", () => {
    const [guarded] = choices(SRC);
    const out = applyEdits(SRC, editChoiceText(SRC, guarded!, "⟦TRUSTED⟧ You trust me.", "⟦TRUSTED⟧ You trust me most."));
    expect(out).toContain("  + (if program.trust >= 20) ⟦TRUSTED⟧ You trust me most.\n    -> Heart Pick");
    const [again] = choices(out);
    expect(again!.guard).toBe("program.trust >= 20");
    expect(again!.text).toBe("⟦TRUSTED⟧ You trust me most.");
  });

  it("a stale expectation is refused", () => {
    const [guarded] = choices(SRC);
    expect(() => editChoiceText(SRC, guarded!, "something else", "x")).toThrow(/anchor/);
  });

  it("appendChoice can write a guard", () => {
    const [file] = parse("== a\nHi.\n");
    const out = applyEdits("== a\nHi.\n", appendChoice("== a\nHi.\n", file, "a", "⟦PROOF⟧ I have proof.", { sticky: true, guard: "program.ok == true" }));
    expect(out).toContain("+ (if program.ok == true) ⟦PROOF⟧ I have proof.");
  });

  it("the node preview shows the guard", () => {
    const [file] = parse("== a\n+ (if program.ok == true) Proof.\n* Leave.\n");
    const beat = file.items[0]!;
    if (beat.kind !== "beat") throw new Error("no beat");
    expect(previewBody(beat.value.body)).toEqual(["+ (if program.ok == true) Proof.", "* Leave."]);
  });
});
