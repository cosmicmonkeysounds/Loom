// Wave 48b (C7, C13): the booth's strength window copies the bands' tiers,
// keys and ⭐ points into play (`play/src/booth/filter/model.ts`, which
// never imports core). This keeps the copy honest.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FILTER_BANDS } from "../src/language-filter.ts";

const PLAY = readFileSync(join(import.meta.dirname, "..", "..", "play", "src", "booth", "filter", "model.ts"), "utf8");

describe("the booth's bands mirror core's", () => {
  it("has every tier with the same key and points, in order", () => {
    const rows = [...PLAY.matchAll(/\{ tier: (\d+), key: "([a-z-]+)", catches: "[^"]*", points: (\d+) \}/gu)].map((m) => ({ tier: Number(m[1]), key: m[2], points: Number(m[3]) }));
    expect(rows).toEqual(FILTER_BANDS.map((b) => ({ tier: b.tier, key: b.key, points: b.points })));
  });
});
