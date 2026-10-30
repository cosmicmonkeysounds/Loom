import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PART_ROLES, PROP_MODELS, PROP_MODEL_IDS, modelBodyColor, modelNeonColor, modelParts, partsOf, propSolid, validateHouse } from "../src/index.ts";
import type { HouseMap, Prop } from "../src/index.ts";
import { FIXTURES } from "./golden.ts";

const props = (): HouseMap => JSON.parse(readFileSync(join(FIXTURES, "props.json"), "utf8")) as HouseMap;
const boxProp = (over: Partial<Prop> = {}): Prop => ({ id: "p", room: "r", kind: "box", pos: [0, 0, 0], size: [1, 1, 1], ...over });

describe("prop models (wave 47)", () => {
  it("has unique ids, a kind that collides and a sensible size", () => {
    expect(new Set(PROP_MODEL_IDS).size).toBe(PROP_MODELS.length);
    for (const m of PROP_MODELS) {
      expect(["box", "cylinder"]).toContain(m.kind);
      expect(propSolid({ ...boxProp(), kind: m.kind })).toBe(true);
      for (const n of m.size) expect(n).toBeGreaterThan(0);
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/u);
      expect(m.neon).toMatch(/^#[0-9a-f]{6}$/u);
    }
  });

  it("draws every model from parts that stay (nearly) inside its size", () => {
    for (const m of PROP_MODELS) {
      for (const k of [1, 0.5, 1.8]) {
        const [w, h, d] = [m.size[0] * k, m.size[1] * k, m.size[2] * k];
        const parts = partsOf(m.id, w, h, d);
        expect(parts.length, m.id).toBeGreaterThan(1);
        expect(parts.some((p) => p.role === "neon"), `${m.id} has neon`).toBe(true);
        for (const p of parts) {
          expect(PART_ROLES).toContain(p.role);
          // Handles and inlays may stand a few centimetres proud of a face.
          const slack = 0.05;
          expect(Math.abs(p.c[0]) + p.s[0] / 2, `${m.id} x`).toBeLessThanOrEqual(w / 2 + slack);
          expect(p.c[1] - p.s[1] / 2, `${m.id} y0`).toBeGreaterThanOrEqual(-1e-9);
          expect(p.c[1] + p.s[1] / 2, `${m.id} y1`).toBeLessThanOrEqual(h + 1e-9);
          expect(Math.abs(p.c[2]) + p.s[2] / 2, `${m.id} z`).toBeLessThanOrEqual(d / 2 + slack);
          for (const n of [...p.c, ...p.s]) expect(Number.isFinite(n)).toBe(true);
        }
      }
    }
  });

  it("is drawn on a box or a cylinder with a known model, else plain", () => {
    expect(modelParts(boxProp())).toBeNull();
    expect(modelParts(boxProp({ model: "rack" }))?.length).toBeGreaterThan(1);
    expect(modelParts(boxProp({ kind: "cylinder", model: "plant" }))?.length).toBeGreaterThan(1);
    expect(modelParts(boxProp({ model: "jukebox" }))).toBeNull();
    expect(modelParts(boxProp({ kind: "screen", model: "rack" }))).toBeNull();
  });

  it("takes the prop's colours over the model's", () => {
    expect(modelBodyColor(boxProp({ model: "rack" }))).toBe("#f2f5f8");
    expect(modelBodyColor(boxProp({ model: "rack", color: "#123456" }))).toBe("#123456");
    expect(modelNeonColor(boxProp({ model: "camera" }))).toBe("#ff2a4a");
    expect(modelNeonColor(boxProp({ model: "camera", neon: "#00ff00" }))).toBe("#00ff00");
  });

  it("validates model and neon on boxes and cylinders only", () => {
    const h = props();
    const box = h.props.find((p) => p.kind === "box")!;
    box.model = "cabinet";
    box.neon = "#ff00aa";
    expect(validateHouse(h).problems).toEqual([]);
    box.model = "some-future-model";
    expect(validateHouse(h).problems).toEqual([]);
    box.model = "Bad Model";
    box.neon = "pink";
    const bad = validateHouse(h).problems;
    expect(bad.some((p) => p.includes("model"))).toBe(true);
    expect(bad.some((p) => p.includes("neon"))).toBe(true);
    const h2 = props();
    const other = h2.props.find((p) => p.kind !== "box" && p.kind !== "cylinder");
    if (other) {
      other.model = "rack";
      expect(validateHouse(h2).problems.some((p) => p.includes('only for kind "box" or "cylinder"'))).toBe(true);
    }
  });
});
