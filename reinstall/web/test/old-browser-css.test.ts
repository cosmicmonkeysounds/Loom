//! The tent wizard on Chrome 87 / Safari 14 (wave 17 integration, OB-13):
//! every box sized only by `aspect-ratio` has a height fallback.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");

describe("aspect-ratio fallbacks", () => {
  it("every rule using aspect-ratio is in the @supports not (aspect-ratio) block", () => {
    const fallback = /@supports not \(aspect-ratio: 1\) \{([\s\S]*?)\n\}/u.exec(css)?.[1] ?? "";
    const users = [...css.matchAll(/^\s*([.#][^{]+?)\s*\{[^}]*aspect-ratio/gmu)].map((m) => m[1]!.trim());
    expect(users.length).toBeGreaterThan(0);
    for (const sel of users) for (const one of sel.split(",")) expect(fallback, one.trim()).toContain(one.trim());
  });
});
