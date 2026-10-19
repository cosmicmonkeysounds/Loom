import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GOLDEN, goldenFiles } from "./golden.ts";

describe("conformance goldens", () => {
  const files = goldenFiles();

  it("covers every fixture + the show (whose King adds his reach + fallen routes)", () => {
    expect([...files.keys()].filter((f) => f.startsWith("show.")).sort()).toEqual(
      ["show.fallen.json", "show.king.json", "show.locate.json", "show.routes.json", "show.walls.json"],
    );
    const plain = [...files.keys()].filter((f) => !/\.(king|fallen)\.json$/.test(f));
    expect(plain.length % 3).toBe(0);
  });

  it("the show's King goldens: every verdict appears, and the fallen routes reach the Server Room", () => {
    const reach = files.get("show.king.json")!.trim().split("\n").slice(1, -1).map((l) => JSON.parse(l.replace(/,$/, "")));
    for (const v of ["ok", "far", "facing", "floor"]) expect(reach.some((r) => r.reach === v), v).toBe(true);
    // The slack lets some poses through that the plain rule refuses.
    expect(reach.some((r) => r.reach !== "ok" && r.slack === "ok")).toBe(true);
    expect(files.get("show.fallen.json")).not.toBe(files.get("show.routes.json"));
  });

  it("match the committed files (run `pnpm --filter @loom/house goldens` after a deliberate change)", () => {
    expect(existsSync(GOLDEN)).toBe(true);
    const committed = readdirSync(GOLDEN).filter((f) => f.endsWith(".json")).sort();
    expect(committed).toEqual([...files.keys()].sort());
    for (const [name, body] of files) expect(readFileSync(join(GOLDEN, name), "utf8"), name).toBe(body);
  });
});
