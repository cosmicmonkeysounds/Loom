import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GOLDEN, goldenFiles } from "./golden.ts";

describe("conformance goldens", () => {
  const files = goldenFiles();

  it("covers every fixture + the show", () => {
    expect([...files.keys()].filter((f) => f.startsWith("show."))).toHaveLength(3);
    expect(files.size % 3).toBe(0);
  });

  it("match the committed files (run `pnpm --filter @loom/house goldens` after a deliberate change)", () => {
    expect(existsSync(GOLDEN)).toBe(true);
    const committed = readdirSync(GOLDEN).filter((f) => f.endsWith(".json")).sort();
    expect(committed).toEqual([...files.keys()].sort());
    for (const [name, body] of files) expect(readFileSync(join(GOLDEN, name), "utf8"), name).toBe(body);
  });
});
