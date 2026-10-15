import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { HouseMap, MapVariant, MapVariantsResponse } from "@loom/house";
import { fetchVariants, saveToProject, switchVariant, type LoadedHouse } from "../src/api.ts";
import type { ReinstallConfig } from "../src/config.ts";
import { projectBarExtras, type ProjectBarProps } from "../src/map/ProjectBar.tsx";
import type { MapToolbarContext } from "../src/map/tools.ts";
import showTent from "../../../core/examples/trapped-in-the-internet/house.json";
import showShed from "../../../core/examples/trapped-in-the-internet/house.shed.json";
import {
  activeOf,
  canSaveToProject,
  canSwitch,
  downloadOf,
  saveConfirm,
  saveTarget,
  sourceLabel,
  statusOf,
  switchConfirm,
  variantLabel,
  variantName,
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
  it("labels: a director's word on the button, the file + the map's name (or its problems) on the tooltip", () => {
    expect(variantLabel(shed)).toBe("Shed");
    expect(variantLabel({ ...shed, file: "house.rain_night.json" })).toBe("Rain night");
    // The default file: the word only its map's name has, else "Main".
    expect(variantLabel(tent, [tent, shed])).toBe("Main");
    expect(variantLabel({ ...tent, name: "The house (tent)" }, [tent, shed])).toBe("Tent");
    expect(variantLabel(tent)).toBe("Main");
    // A show sibling not named like a project map keeps its stem.
    expect(variantLabel({ ...tent, file: "trapped.json" })).toBe("trapped");
    expect(variantName(shed)).toBe("Shed (house.shed.json)");
    expect(variantTitle(tent)).toBe("house.json — The house (playing now)");
    expect(variantTitle(shed)).toBe("Play house.shed.json — The house (shed)");
    expect(variantTitle(broken)).toContain("does not validate");
    expect(variantTitle(broken)).toContain("rooms must be an array");
  });

  it("the show's own maps read Tent / Shed", () => {
    const t: MapVariant = { file: "house.json", name: (showTent as { name: string }).name, active: true, ok: true, problems: [] };
    const sh: MapVariant = { file: "house.shed.json", name: (showShed as { name: string }).name, active: false, ok: true, problems: [] };
    expect(variantLabel(t, [t, sh])).toBe("Tent");
    expect(variantLabel(sh, [t, sh])).toBe("Shed");
    expect(switchConfirm(sh, { players: 2, edited: false, all: [t, sh] })).toContain("Switch the house map to Shed (house.shed.json)?");
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
    expect(one).toContain("goes back to its start"); // standing in what is a solid prop there
    expect(one).toContain("house.shed.json");
    const both = switchConfirm(shed, { players: 3, edited: true })!;
    expect(both).toContain("3 programs are");
    expect(both).toContain("Save to project first");
    // The page's own unsaved draft goes too (the server's map replaces it).
    expect(switchConfirm(shed, { players: 0, edited: false, dirty: true })).toContain("unsaved edits on this page are dropped");
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
    // A show sibling (an event with no project maps yet) is saved under its own name…
    expect(saveTarget(list({ from: "show", variants: [{ ...tent, active: false }, { ...shed, active: true }] }))).toBe("house.shed.json");
    // …unless the show file isn't named like a project map (LOOM_HOUSE=/config/trapped.json).
    expect(saveTarget(list({ from: "show", variants: [{ ...tent, file: "trapped.json" }] }))).toBe("house.json");
    expect(activeOf(null)).toBeNull();
    expect(saveConfirm("house.json", false)).toBeNull();
    expect(saveConfirm("house.json", true)).toContain("unsaved edits are not part of it");
    // A valid draft is saved to the event on the way: nothing to ask.
    expect(saveConfirm("house.json", true, true)).toBeNull();
  });

  it("Download JSON: the active variant's name, two-space JSON + a newline", () => {
    const house = SHOW();
    const d = downloadOf(house, list({ variants: [{ ...tent, active: false }, { ...shed, active: true }] }));
    expect(d.name).toBe("house.shed.json");
    expect(d.text.endsWith("}\n")).toBe(true);
    expect(JSON.parse(d.text)).toEqual(house);
    expect(d.text.split("\n")[1]!.startsWith('  "')).toBe(true);
  });

  it("sourceLabel: where the shown map comes from — a project file by name", () => {
    expect(sourceLabel("event")).toBe("this event's map");
    expect(sourceLabel("project", list({ variants: [{ ...tent, active: false }, { ...shed, active: true }] }))).toBe("the project's house.shed.json");
    expect(sourceLabel("project")).toBe("the project's map");
    expect(sourceLabel("project", list({ from: "show" }))).toBe("the project's map");
    expect(sourceLabel("show")).toBe("the show's map");
    expect(sourceLabel("bundled")).toBe("offline — the bundled show map");
  });

  it("statusOf: ok · conflict · error with its first problem", () => {
    expect(statusOf({ ok: true, result: { file: "house.shed.json" } }, "switch")).toEqual({ kind: "ok", text: "Playing house.shed.json" });
    expect(statusOf({ ok: true, result: { file: "house.shed.json" } }, "switch", "Shed")).toEqual({ kind: "ok", text: "Playing Shed (house.shed.json)" });
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

describe("the project bar in the map page's toolbar slot", () => {
  const config: ReinstallConfig = { server: "", eventId: "evt", token: "tok", name: "Map" } as unknown as ReinstallConfig;
  const ctxOf = (over: Partial<MapToolbarContext> = {}): MapToolbarContext => {
    const house: HouseMap = SHOW();
    const loaded: LoadedHouse = { house, version: "v3", source: "project" };
    return {
      house,
      saved: house,
      loaded,
      config,
      base: "/e/evt",
      players: 2,
      dirty: false,
      valid: true,
      adopt: vi.fn(),
      reload: vi.fn(async () => {}),
      save: vi.fn(async () => "v4"),
      ...over,
    };
  };
  const propsOf = (ctx: MapToolbarContext) => (projectBarExtras(ctx) as ReactElement<ProjectBarProps>).props;

  it("is fed from the editor: the event's base + token, the saved map + its version, the players", () => {
    const p = propsOf(ctxOf());
    expect(p.base).toBe("/e/evt");
    expect(p.token).toBe("tok");
    expect(p.version).toBe("v3");
    expect(p.players).toBe(2);
    expect(p.dirty).toBe(false);
    expect(p.saveDraft).toBeUndefined(); // nothing unsaved
  });

  it("a switch and a save to the project reload the page (a clean draft at the server's version, never an undoable adopt)", () => {
    const ctx = ctxOf();
    const p = propsOf(ctx);
    p.onSwitched(SHOW(), "v9");
    p.onSaved?.("house.json");
    expect(ctx.reload).toHaveBeenCalledTimes(2);
    expect(ctx.adopt).not.toHaveBeenCalled();
  });

  it("a valid unsaved draft is saved to the event first; an invalid one is not offered", () => {
    expect(propsOf(ctxOf({ dirty: true, valid: true })).saveDraft).toBeDefined();
    expect(propsOf(ctxOf({ dirty: true, valid: false })).saveDraft).toBeUndefined();
  });

  it("offline (the bundled stand-in) shows no bar; a draft-free page downloads the saved map", () => {
    const house = SHOW();
    expect(projectBarExtras(ctxOf({ loaded: { house, version: "bundled", source: "bundled" } }))).toBeNull();
    const draft = { ...house, name: "draft" };
    expect(propsOf(ctxOf({ house: draft, saved: house })).house).toBe(house);
  });
});
