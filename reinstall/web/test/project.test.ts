import { describe, expect, it } from "vitest";
import type { MapVariant, MapVariantsResponse } from "@loom/house";
import { fetchVariants, saveToProject, switchVariant } from "../src/api.ts";
import {
  activeOf,
  canSaveToProject,
  canSwitch,
  downloadOf,
  saveConfirm,
  saveTarget,
  statusOf,
  switchConfirm,
  variantLabel,
  variantTitle,
} from "../src/map/project.ts";
import { SHOW } from "./houses.ts";

const tent: MapVariant = { file: "house.json", name: "The house", active: true, ok: true, problems: [] };
const shed: MapVariant = { file: "house.shed.json", name: "The house (shed)", active: false, ok: true, problems: [] };
const broken: MapVariant = { file: "house.broken.json", name: "house.broken.json", active: false, ok: false, problems: ["rooms must be an array"] };
const list = (over: Partial<MapVariantsResponse> = {}): MapVariantsResponse => ({ variants: [tent, shed, broken], from: "project", edited: false, project: true, ...over });

/** A fetch that answers `status` + `body` and records what it was asked. */
function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("project bar logic", () => {
  it("labels: the file on the button, the map's name (or its problems) on the tooltip", () => {
    expect(variantLabel(shed)).toBe("house.shed.json");
    expect(variantTitle(tent)).toBe("The house (playing now)");
    expect(variantTitle(shed)).toBe("Play The house (shed)");
    expect(variantTitle(broken)).toContain("does not validate");
    expect(variantTitle(broken)).toContain("rooms must be an array");
  });

  it("a switch: only to another valid variant, never mid-request", () => {
    expect(canSwitch(shed, false)).toBe(true);
    expect(canSwitch(shed, true)).toBe(false);
    expect(canSwitch(tent, false)).toBe(false); // already playing
    expect(canSwitch(broken, false)).toBe(false);
  });

  it("a switch asks first when programs are mid-game or a director's save would be dropped", () => {
    expect(switchConfirm(shed, { players: 0, edited: false })).toBeNull();
    const one = switchConfirm(shed, { players: 1, edited: false })!;
    expect(one).toContain("1 program is in the simulation now");
    expect(one).toContain("house.shed.json");
    const both = switchConfirm(shed, { players: 3, edited: true })!;
    expect(both).toContain("3 programs are");
    expect(both).toContain("Save to project first");
  });

  it("Save to project: offered on a project's event, for a served map; the active variant's file; warns about unsaved edits", () => {
    expect(canSaveToProject(list(), "v1", false)).toBe(true);
    expect(canSaveToProject(list({ project: false }), "v1", false)).toBe(false);
    expect(canSaveToProject(list(), null, false)).toBe(false); // the bundled stand-in
    expect(canSaveToProject(null, "v1", false)).toBe(false);
    expect(canSaveToProject(list(), "v1", true)).toBe(false);
    expect(saveTarget(list())).toBe("house.json");
    expect(saveTarget(list({ variants: [{ ...tent, active: false }, { ...shed, active: true }] }))).toBe("house.shed.json");
    expect(saveTarget(null)).toBe("house.json");
    expect(activeOf(null)).toBeNull();
    expect(saveConfirm("house.json", false)).toBeNull();
    expect(saveConfirm("house.json", true)).toContain("unsaved edits are not part of it");
  });

  it("Download JSON: the active variant's name, two-space JSON + a newline", () => {
    const house = SHOW();
    const d = downloadOf(house, list({ variants: [{ ...tent, active: false }, { ...shed, active: true }] }));
    expect(d.name).toBe("house.shed.json");
    expect(d.text.endsWith("}\n")).toBe(true);
    expect(JSON.parse(d.text)).toEqual(house);
    expect(d.text.split("\n")[1]!.startsWith('  "')).toBe(true);
  });

  it("statusOf: ok · conflict · error with its first problem", () => {
    expect(statusOf({ ok: true, result: { file: "house.shed.json" } }, "switch")).toEqual({ kind: "ok", text: "Playing house.shed.json" });
    expect(statusOf({ ok: true, result: { file: "house.json" } }, "save")).toEqual({ kind: "ok", text: "Saved to the project as house.json" });
    expect(statusOf({ ok: false, status: 409, error: "the map changed — reload", problems: [], conflict: true, version: "v2" }, "switch").kind).toBe("error");
    expect(statusOf({ ok: false, status: 400, error: "invalid house map", problems: ["a", "b"], conflict: false, version: null }, "switch")).toEqual({
      kind: "error",
      text: "invalid house map: a (+1 more)",
    });
  });
});

describe("project bar API calls", () => {
  it("fetchVariants reads the list with the mod token", async () => {
    const real = globalThis.fetch;
    const { f, calls } = fakeFetch(200, list());
    globalThis.fetch = f;
    try {
      expect(await fetchVariants("/e/evt", "tok")).toEqual(list());
    } finally {
      globalThis.fetch = real;
    }
    expect(calls[0]!.url).toBe("/e/evt/api/mod/spatial/variants");
    expect((calls[0]!.init?.headers as Record<string, string>)["x-loom-token"]).toBe("tok");
  });

  it("switchVariant posts the file and the page's version as `base`; a stale one is a conflict", async () => {
    const ok = fakeFetch(200, { ok: true, version: "v2", warnings: [], file: "house.shed.json", dropped: false });
    const r = await switchVariant("/e/evt", "tok", "house.shed.json", "v1", ok.f);
    expect(r).toEqual({ ok: true, result: { ok: true, version: "v2", warnings: [], file: "house.shed.json", dropped: false } });
    expect(ok.calls[0]!.url).toBe("/e/evt/api/mod/spatial/variant");
    expect(JSON.parse(ok.calls[0]!.init!.body as string)).toEqual({ file: "house.shed.json", base: "v1" });
    const stale = await switchVariant("/e/evt", "tok", "house.json", "v1", fakeFetch(409, { error: "the map changed — reload", version: "v2" }).f);
    expect(stale).toMatchObject({ ok: false, conflict: true, version: "v2" });
  });

  it("saveToProject: no file = the active variant's; a project-less event's 409 is no conflict", async () => {
    const ok = fakeFetch(200, { ok: true, file: "house.json", version: "v1" });
    expect((await saveToProject("/e/evt", "tok", null, "v1", ok.f)).ok).toBe(true);
    expect(ok.calls[0]!.url).toBe("/e/evt/api/mod/spatial/house/project");
    expect(JSON.parse(ok.calls[0]!.init!.body as string)).toEqual({ base: "v1" });
    const none = await saveToProject("/e/evt", "tok", "house.shed.json", null, fakeFetch(409, { error: "this event has no project — download the map instead" }).f);
    expect(none).toMatchObject({ ok: false, status: 409, conflict: false, error: "this event has no project — download the map instead" });
  });
});
