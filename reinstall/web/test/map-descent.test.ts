import { describe, expect, it, vi } from "vitest";
import { DESCENT_MAX, FOOTSTEP_REACH_M, FOOTSTEP_REACH_MAX, parseDescent, propSolid, validateAudio, validateHouse } from "@loom/house";
import type { AudioConfig, HouseMap } from "@loom/house";
import { fetchDescent, postTold } from "../src/api.ts";
import { descentHint, hintsFromSearch, withoutSecrets } from "../src/config.ts";
import { testFootsteps } from "../src/map/audio-api.ts";
import { normalizeAudio, setFootsteps } from "../src/map/audio.ts";
import { talkProblems } from "../src/map/check.ts";
import { stepsSentText } from "../src/map/descent-tools.ts";
import { addModelProp, APPEARS_OPTIONS, MODEL_GROUP_LABELS, modelGroups, patchProp, talkerByModel } from "../src/map/props.ts";
import { SHOW, TWO_ROOMS } from "./houses.ts";
import showScript from "../../../core/examples/trapped-in-the-internet/descent.json";

const script = parseDescent(showScript)!;

function withStove(): { house: HouseMap; id: string } {
  const h = TWO_ROOMS();
  return addModelProp(h, "stove", h.floors[0]!.id, [3.2, 1])!;
}

const valid = (h: HouseMap): string[] => validateHouse(h).problems;
const prop = (h: HouseMap, id: string) => h.props.find((p) => p.id === id)!;

describe("the model groups (C5)", () => {
  it("names Home, Studio and Strange", () => {
    expect(MODEL_GROUP_LABELS).toMatchObject({ home: "Home", studio: "Studio", strange: "Strange" });
    const strange = modelGroups().find((g) => g.group === "strange")!;
    expect(strange.label).toBe("Strange");
    expect(strange.models.map((m) => m.id)).toContain("door");
  });
});

describe("Appears", () => {
  it("offers Always and every level", () => {
    expect(APPEARS_OPTIONS.map((o) => o.value)).toEqual([null, 1, 2, 3, 4]);
    expect(APPEARS_OPTIONS).toHaveLength(DESCENT_MAX + 1);
  });

  it("from a level clears solid, and the map stays valid", () => {
    const { house, id } = withStove();
    const solid = patchProp(house, id, { solid: true });
    expect(prop(solid, id).solid).toBe(true);
    const next = patchProp(solid, id, { from: 2 });
    expect(prop(next, id).from).toBe(2);
    expect(prop(next, id).solid).toBeUndefined();
    expect(propSolid(prop(next, id))).toBe(false);
    expect(valid(next).filter((p) => !p.includes("inside solid"))).toEqual([]);
  });

  it("back to Always leaves no field", () => {
    const { house, id } = withStove();
    const next = patchProp(patchProp(house, id, { from: 3 }), id, { from: undefined });
    expect("from" in prop(next, id)).toBe(false);
    expect(propSolid(prop(next, id))).toBe(true);
  });

  it("a kind that can't carry it loses it", () => {
    const { house, id } = withStove();
    const next = patchProp(patchProp(house, id, { from: 3 }), id, { kind: "label", label: "X" });
    expect("from" in prop(next, id)).toBe(false);
  });
});

describe("Talks", () => {
  it("sets a talker, never, or back to by model", () => {
    const { house, id } = withStove();
    expect(prop(patchProp(house, id, { talk: "fridge" }), id).talk).toBe("fridge");
    expect(prop(patchProp(house, id, { talk: "none" }), id).talk).toBe("none");
    expect("talk" in prop(patchProp(patchProp(house, id, { talk: "fridge" }), id, { talk: undefined }), id)).toBe(false);
  });

  it("says who a prop is by model, whatever its `talk`", () => {
    const { house, id } = withStove();
    expect(talkerByModel(script, prop(house, id))).toBe("stove");
    expect(talkerByModel(script, prop(patchProp(house, id, { talk: "none" }), id))).toBe("stove");
    expect(talkerByModel(null, prop(house, id))).toBeNull();
  });

  it("the check warns about a talker the script doesn't have, and clicks through to the prop", () => {
    const { house, id } = withStove();
    expect(talkProblems(house, script)).toEqual([]);
    expect(talkProblems(patchProp(house, id, { talk: "none" }), script)).toEqual([]);
    expect(talkProblems(patchProp(house, id, { talk: "fridge" }), script)).toEqual([]);
    const bad = talkProblems(patchProp(house, id, { talk: "toaster" }), script);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ level: "warning", sel: { kind: "prop", id } });
    expect(bad[0]!.text).toContain("toaster");
  });

  it("says nothing while the script is unknown", () => {
    const { house, id } = withStove();
    expect(talkProblems(patchProp(house, id, { talk: "toaster" }), null)).toEqual([]);
  });

  it("the show's map names no talker its script lacks", () => {
    expect(talkProblems(SHOW(), script)).toEqual([]);
  });
});

describe("👣 Footsteps", () => {
  const audio = (): AudioConfig => normalizeAudio({});

  it("leaves the defaults out of the file, and no block at all when nothing is set", () => {
    const off = setFootsteps(audio(), { enabled: false });
    expect(off.footsteps).toEqual({ enabled: false });
    expect("footsteps" in setFootsteps(off, { enabled: true })).toBe(false);
    expect("footsteps" in setFootsteps(audio(), { reach: FOOTSTEP_REACH_M })).toBe(false);
    expect(setFootsteps(audio(), { gain: -6 }).footsteps).toEqual({ gain: -6 });
    expect("footsteps" in setFootsteps(setFootsteps(audio(), { gain: -6 }), { gain: 0 })).toBe(false);
    expect("footsteps" in setFootsteps(setFootsteps(audio(), { reach: 9 }), { reach: null })).toBe(false);
  });

  it("clamps what validation would refuse", () => {
    const a = setFootsteps(audio(), { reach: 999 });
    expect(a.footsteps?.reach).toBe(FOOTSTEP_REACH_MAX);
    expect(validateAudio(setFootsteps(a, { gain: 999 }), TWO_ROOMS()).problems).toEqual([]);
  });

  it("is kept when a config is read back", () => {
    expect(normalizeAudio({ footsteps: { reach: 9 } }).footsteps).toEqual({ reach: 9 });
  });

  it("the test posts the speaker to the walkers' route with the mod token", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const r = await testFootsteps("/e/x", "tok", "living-1", fetcher as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/e/x/api/mod/audio/walkers/test");
    expect(JSON.parse(init.body as string)).toEqual({ speaker: "living-1" });
    expect((init.headers as Record<string, string>)["x-loom-token"]).toBe("tok");
    expect(stepsSentText("living-1")).toContain("living-1");
  });
});

describe("the words over the wire", () => {
  const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("a script that validates", async () => {
    const fetcher = answer(200, { script: showScript });
    expect(await fetchDescent("/e/x", "tok", fetcher as unknown as typeof fetch)).not.toBeNull();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/e/x/api/spatial/descent");
    expect((init.headers as Record<string, string>)["x-loom-token"]).toBe("tok");
  });

  it("no words: none, one that doesn't validate, an old server, no network", async () => {
    expect(await fetchDescent("/e/x", "t", answer(200, { script: null }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchDescent("/e/x", "t", answer(200, { script: { version: 2 } }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchDescent("/e/x", "t", answer(404, { error: "not found" }) as unknown as typeof fetch)).toBeNull();
    const down = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await fetchDescent("/e/x", "t", down as unknown as typeof fetch)).toBeNull();
  });

  it("told posts the talker and the mark, and never throws", async () => {
    const fetcher = answer(200, { ok: true });
    expect(await postTold("/e/x", "tok", "stove", "sorry", fetcher as unknown as typeof fetch)).toBe(true);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/e/x/api/spatial/told");
    expect(JSON.parse(init.body as string)).toEqual({ talker: "stove", mark: "sorry" });
    const down = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await postTold("/e/x", "tok", "a", "b", down as unknown as typeof fetch)).toBe(false);
  });
});

describe("?descent=N", () => {
  it("overrides the level, clamped, and junk is no hint", () => {
    expect(descentHint("?descent=3")).toBe(3);
    expect(descentHint("?descent=0")).toBe(0);
    expect(descentHint("?descent=99")).toBe(DESCENT_MAX);
    expect(descentHint("?descent=x")).toBeNull();
    expect(descentHint("?descent=")).toBeNull();
    expect(descentHint("?code=abc")).toBeNull();
  });

  it("stays on the URL when the code is scrubbed", () => {
    expect(withoutSecrets("?code=abc&descent=4")).toBe("?descent=4");
    expect(hintsFromSearch("?descent=4").code).toBe("");
  });
});
