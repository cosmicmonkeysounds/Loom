import { describe, expect, it } from "vitest";
import { STAGES, stageFor } from "../src/stage.ts";
import { PROFILES } from "../src/ai.ts";
import { PAWNS_ONLY_FEN, START_FEN, startFen } from "../src/rules.ts";

describe("stageFor", () => {
  it("reads the shared 15 HP bar: full = grandmaster … 0 = pawns only", () => {
    const ladder = Array.from({ length: 16 }, (_, hp) => stageFor(hp, 15));
    expect(ladder[15]).toBe("grandmaster");
    // The first hit already weakens him.
    expect(ladder[14]).toBe("club");
    expect(ladder[10]).toBe("club");
    expect(ladder[9]).toBe("beginner");
    expect(ladder[5]).toBe("beginner");
    expect(ladder[4]).toBe("dizzy");
    // Still standing on his last point: dizzy, never pawns only.
    expect(ladder[1]).toBe("dizzy");
    expect(ladder[0]).toBe("pawns");
    // Only a full bar is grandmaster, only an empty one pawns.
    expect(ladder.filter((s) => s === "grandmaster")).toHaveLength(1);
    expect(ladder.filter((s) => s === "pawns")).toHaveLength(1);
    // Never stronger with fewer points.
    for (let hp = 1; hp <= 15; hp++) expect(STAGES.indexOf(ladder[hp]!)).toBeLessThanOrEqual(STAGES.indexOf(ladder[hp - 1]!));
    // Every stage is reached somewhere on the bar.
    expect(new Set(ladder)).toEqual(new Set(STAGES));
  });

  it("clamps out-of-range hp and a bad max", () => {
    expect(stageFor(99, 15)).toBe("grandmaster");
    expect(stageFor(-3, 15)).toBe("pawns");
    expect(stageFor(1, 0)).toBe("grandmaster");
    expect(stageFor(4, 8)).toBe("beginner");
  });

  it("every stage has a profile and a start", () => {
    for (const s of STAGES) expect(PROFILES[s]).toBeDefined();
    expect(startFen("pawns")).toBe(PAWNS_ONLY_FEN);
    expect(startFen("club")).toBe(START_FEN);
  });
});
