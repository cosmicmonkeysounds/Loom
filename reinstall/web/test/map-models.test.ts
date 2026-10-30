import { describe, expect, it } from "vitest";
import { PROP_MODELS, validateHouse } from "@loom/house";
import { addModelProp, addProp, modelGroups, modelPlacing, patchProp, placingLabel, placingModel, rotateBy, takesModel } from "../src/map/props.ts";
import { TWO_ROOMS } from "./houses.ts";

const H = TWO_ROOMS();
const floor = H.floors[0]!.id;
const inRoom = (): [number, number] => {
  const poly = H.rooms[0]!.poly;
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
};

describe("map editor: prop models (wave 47)", () => {
  it("groups every model once, structure first", () => {
    const groups = modelGroups();
    expect(groups.map((g) => g.group)).toEqual(["structure", "computer", "office", "home", "studio", "strange"]);
    expect(groups.flatMap((g) => g.models.map((m) => m.id)).sort()).toEqual(PROP_MODELS.map((m) => m.id).sort());
  });

  it("names a model placing, and nothing else", () => {
    expect(placingModel(modelPlacing("rack"))?.label).toBe("Server rack");
    expect(placingModel("box")).toBeNull();
    expect(placingModel("speaker")).toBeNull();
    expect(placingModel(null)).toBeNull();
    expect(placingModel("model:jukebox")).toBeNull();
    expect(placingLabel(modelPlacing("wall"))).toBe("Wall panel");
    expect(placingLabel("cylinder")).toBe("cylinder");
  });

  it("places a model with its kind and size and no colour, and the map stays valid", () => {
    for (const m of PROP_MODELS) {
      const r = addModelProp(H, m.id, floor, inRoom())!;
      const p = r.house.props.find((x) => x.id === r.id)!;
      expect(p).toMatchObject({ kind: m.kind, model: m.id, size: [...m.size] });
      expect(p.color).toBeUndefined();
      expect(p.id.startsWith(m.id)).toBe(true);
      // The small fixture room: a big model may land on its spawn or a duck spot.
      expect(validateHouse(r.house).problems.filter((x) => !x.includes("is inside solid prop")), m.id).toEqual([]);
    }
    expect(addModelProp(H, "jukebox", floor, inRoom())).toBeNull();
    expect(addModelProp(H, "wall", floor, [999, 999])).toBeNull();
  });

  it("turns a wall like any prop", () => {
    const r = addModelProp(H, "wall", floor, inRoom())!;
    const turned = rotateBy(r.house, { kind: "prop", id: r.id }, 90);
    expect(Math.abs(turned.props.find((p) => p.id === r.id)!.yaw!)).toBe(90);
  });

  it("sets and clears model and neon, keeping the size", () => {
    const r = addProp(H, "box", floor, inRoom())!;
    const size = r.house.props.find((p) => p.id === r.id)!.size;
    let h = patchProp(r.house, r.id, { model: "cabinet", neon: "#ff00aa" });
    let p = h.props.find((x) => x.id === r.id)!;
    expect(p).toMatchObject({ model: "cabinet", neon: "#ff00aa", size });
    h = patchProp(h, r.id, { neon: undefined });
    p = h.props.find((x) => x.id === r.id)!;
    expect("neon" in p).toBe(false);
    h = patchProp(h, r.id, { model: "" as unknown as undefined });
    p = h.props.find((x) => x.id === r.id)!;
    expect("model" in p).toBe(false);
    expect(validateHouse(h).problems).toEqual([]);
  });

  it("drops the model when the prop becomes a kind that draws none", () => {
    const r = addModelProp(H, "rack", floor, inRoom())!;
    const h = patchProp(patchProp(r.house, r.id, { neon: "#00ff00" }), r.id, { kind: "screen" });
    const p = h.props.find((x) => x.id === r.id)!;
    expect(p.model).toBeUndefined();
    expect(p.neon).toBeUndefined();
    expect(validateHouse(h).problems).toEqual([]);
    expect(takesModel("box") && takesModel("cylinder") && !takesModel("king")).toBe(true);
  });
});
