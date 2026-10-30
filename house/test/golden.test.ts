import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GOLDEN, goldenFiles } from "./golden.ts";

describe("conformance goldens", () => {
  const files = goldenFiles();

  it("covers every fixture + the show (whose King adds his reach + fallen routes, its heart and disk the moments)", () => {
    expect([...files.keys()].filter((f) => f.startsWith("show.")).sort()).toEqual([
      "show.escape.json",
      "show.fallen.json",
      "show.king.json",
      "show.locate.json",
      "show.moments.json",
      "show.presence.json",
      "show.routes.json",
      "show.walls.json",
    ]);
    const plain = [...files.keys()].filter((f) => !/\.(king|fallen|moments)\.json$/.test(f) && f !== "constants.json" && f !== "models.json" && f !== "descent.json");
    expect(plain.length % 5).toBe(0);
    expect(files.has("constants.json")).toBe(true);
    expect(files.has("models.json")).toBe(true);
    expect(files.has("descent.json")).toBe(true);
  });

  it("the wave 26 goldens: every verdict appears", () => {
    const rows = (name: string) => files.get(name)!.trim().split("\n").slice(1, -1).map((l) => JSON.parse(l.replace(/,$/, "")));
    const escape = rows("show.escape.json");
    expect(escape[0].ground).toMatchObject({ floor: "main", y: 0 });
    expect(escape.some((r) => r.d === null)).toBe(true);
    expect(escape.some((r) => typeof r.d === "number" && r.d >= 5)).toBe(true);
    expect(escape.some((r) => typeof r.d === "number" && r.d < 1)).toBe(true);
    const presence = rows("show.presence.json").filter((r) => "prev" in r);
    // The hysteresis shows: somewhere the previous room holds over locate's.
    expect(presence.some((r) => r.prev !== null && r.room === r.prev)).toBe(true);
    expect(presence.some((r) => r.prev !== null && r.room !== r.prev)).toBe(true);
    const moments = rows("show.moments.json");
    for (const k of [true, false]) expect(moments.some((r) => "heart" in r && r.reached === k), `heart ${k}`).toBe(true);
    expect(moments.some((r) => "pickup" in r && r.reach)).toBe(true);
    expect(moments.some((r) => "pickup" in r && !r.reach && r.slack)).toBe(true);
    expect(moments.some((r) => "pickup" in r && !r.slack)).toBe(true);
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
