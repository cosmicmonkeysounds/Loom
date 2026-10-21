//! The map belongs to the project (SW-MAP-01) + the tent ↔ shed switch
//! (SW-MAP-13): the pure helpers in `server/house-maps.ts`, and their wiring
//! in `EventRuntime` — the resolution order (director save > the project
//! snapshot's active variant > the show file), the snapshot surviving a
//! restart, `GET /api/mod/spatial/variants`, `POST /api/mod/spatial/variant`
//! (mid-show: sessions carried over, ducks kept or re-dealt, 409 on a stale
//! base), `POST /api/mod/spatial/house/project` ("Save to project"), a
//! reload's fresh snapshot, and the auth on all three.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { houseHash, validateHouse, type Assignment, type HouseMap, type MapVariantsResponse } from "@loom/house";
import {
  DEFAULT_MAP_FILE,
  activeVariant,
  asMapFiles,
  isMapFile,
  listVariants,
  mapFileText,
  mapFilesOf,
  mapProblems,
  mapSummary,
  parseMapText,
  planMapSync,
  saveFileFor,
  showVariantFiles,
  type MapFiles,
  type ProjectLink,
} from "../server/house-maps.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { scenarioMapFiles, scenarioSource } from "../examples/load.ts";

const SHOW_FILE = fileURLToPath(new URL("../examples/trapped-in-the-internet/house.json", import.meta.url));
const SHOW_TEXT = readFileSync(SHOW_FILE, "utf8");
const show = (): HouseMap => {
  const v = validateHouse(JSON.parse(SHOW_TEXT));
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
  return v.house;
};
/** The shed variant: the show's map renamed, its first duck spot gone. */
function shedOf(house: HouseMap): HouseMap {
  const shed = structuredClone(house);
  shed.name = "The house (shed)";
  shed.duck.spots = shed.duck.spots.slice(1);
  return shed;
}
const text = (h: HouseMap): string => mapFileText(h);

const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-maps-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The pure helpers
// ---------------------------------------------------------------------------

describe("house-maps helpers", () => {
  it("a map file is house.json or house.<variant>.json at the project's root", () => {
    for (const ok of ["house.json", "house.shed.json", "house.rain_2.json", "house.Tent-B.json"]) expect(isMapFile(ok)).toBe(true);
    for (const no of ["house.loom", "maps/house.json", "house..json", "house.a.b.json", "houses.json", "house.json.bak", "../house.json", "house.sh ed.json", ""]) {
      expect(isMapFile(no)).toBe(false);
    }
  });

  it("mapFilesOf keeps the maps among a project's files; asMapFiles sanitises an untrusted record", () => {
    expect(mapFilesOf([
      { path: "main.loom", content: "x" },
      { path: "house.json", content: "{}" },
      { path: "house.shed.json", content: "[]" },
      { path: "notes/house.json", content: "no" },
    ])).toEqual({ "house.json": "{}", "house.shed.json": "[]" });
    expect(asMapFiles({ "house.json": "{}", "house.shed.json": 5, "evil/../x": "y" })).toEqual({ "house.json": "{}" });
    expect(asMapFiles(null)).toBeNull();
    expect(asMapFiles(["house.json"])).toBeNull();
    expect(asMapFiles({})).toEqual({});
  });

  it("activeVariant: the stored choice while it exists, else the default, else the first", () => {
    expect(activeVariant(["house.json", "house.shed.json"], "house.shed.json")).toBe("house.shed.json");
    expect(activeVariant(["house.json", "house.shed.json"], "house.gone.json")).toBe("house.json");
    expect(activeVariant(["house.json", "house.shed.json"], null)).toBe("house.json");
    expect(activeVariant(["house.tent.json", "house.shed.json"], null)).toBe("house.shed.json");
    expect(activeVariant(["map.json", "map.shed.json"], null, "map.json")).toBe("map.json");
    expect(activeVariant([], "house.json")).toBeNull();
  });

  it("parseMapText + listVariants: the default first, the map's name, problems for a bad file", () => {
    const h = show();
    expect(parseMapText(text(h)).house?.name).toBe(h.name);
    expect(parseMapText("{nope").problems[0]).toMatch(/^not JSON: /u);
    expect(parseMapText(JSON.stringify({ ...h, rooms: [] })).problems.length).toBeGreaterThan(0);
    const list = listVariants(
      [
        ["house.shed.json", parseMapText(text(shedOf(h)))],
        ["house.broken.json", parseMapText("{")],
        [DEFAULT_MAP_FILE, parseMapText(text(h))],
      ],
      "house.shed.json",
    );
    expect(list.map((v) => [v.file, v.name, v.active, v.ok])).toEqual([
      ["house.json", h.name, false, true],
      ["house.broken.json", "house.broken.json", false, false],
      ["house.shed.json", "The house (shed)", true, true],
    ]);
    expect(list[1]!.problems).toHaveLength(1);
  });

  it("listVariants: a map's `variant` field rides as its `label` (trimmed); none without one", () => {
    const h = show();
    expect(h.variant).toBe("Tent"); // the show's own map
    const shed = { ...shedOf(h), variant: "  Shed " };
    const bare = { ...shedOf(h), variant: undefined };
    const list = listVariants(
      [
        [DEFAULT_MAP_FILE, parseMapText(text(h))],
        ["house.shed.json", parseMapText(text(shed))],
        ["house.rain.json", parseMapText(text(bare))],
      ],
      DEFAULT_MAP_FILE,
    );
    expect(list.map((v) => [v.file, v.label])).toEqual([
      [DEFAULT_MAP_FILE, "Tent"],
      ["house.rain.json", undefined],
      ["house.shed.json", "Shed"],
    ]);
    expect("label" in list[1]!).toBe(false);
  });

  it("showVariantFiles: the show file, then its <stem>.<variant>.json siblings", () => {
    const d = freshDir();
    for (const f of ["house.json", "house.shed.json", "house.b.json", "house.a.b.json", "other.json", "spatial-house.json"]) writeFileSync(join(d, f), "{}");
    expect(showVariantFiles(join(d, "house.json")).map((v) => v.file)).toEqual(["house.json", "house.b.json", "house.shed.json"]);
    expect(showVariantFiles(join(d, "house.shed.json"))[0]).toEqual({ file: "house.shed.json", path: join(d, "house.shed.json") });
    expect(showVariantFiles(join(d, "nowhere", "house.json"))).toEqual([{ file: "house.json", path: join(d, "nowhere", "house.json") }]);
  });

  it("planMapSync: by default the project's maps win — only missing example maps are added, differing ones kept", () => {
    const project = { "house.json": "A", "house.shed.json": "S", "house.old.json": "O" };
    const example = { "house.json": "A", "house.shed.json": "S2", "house.rain.json": "R" };
    expect(planMapSync(project, example)).toEqual({
      maps: { "house.json": "A", "house.shed.json": "S", "house.old.json": "O", "house.rain.json": "R" },
      put: ["house.rain.json"],
      remove: [],
      kept: ["house.shed.json"],
      replaced: [],
    });
    expect(planMapSync({}, { "house.json": "A" })).toMatchObject({ maps: { "house.json": "A" }, put: ["house.json"], kept: [] });
  });

  it("planMapSync: --replace-maps writes the example's, deletes the rest, lists the lost text; --keep-maps touches nothing", () => {
    const project = { "house.json": "A", "house.shed.json": "S", "house.old.json": "O" };
    const example = { "house.json": "A", "house.shed.json": "S2" };
    expect(planMapSync(project, example, "replace")).toEqual({
      maps: example,
      put: ["house.json", "house.shed.json"],
      remove: ["house.old.json"],
      kept: [],
      replaced: ["house.old.json", "house.shed.json"],
    });
    expect(planMapSync(project, example, "keep")).toEqual({ maps: project, put: [], remove: [], kept: [], replaced: [] });
  });

  it("mapProblems names the first broken map file; mapSummary tells two versions apart", () => {
    expect(mapProblems({ "house.json": SHOW_TEXT, "house.shed.json": text(shedOf(show())) })).toBeNull();
    const bad = mapProblems({ "house.json": SHOW_TEXT, "house.b.json": "{", "house.a.json": "{}" });
    expect(bad!.file).toBe("house.a.json");
    expect(bad!.problems.length).toBeGreaterThan(0);
    expect(mapProblems({})).toBeNull();
    const h = show();
    expect(mapSummary(SHOW_TEXT)).toBe(
      `"${h.name}" — ${h.floors.length} floors, ${h.rooms.length} rooms, ${h.doors.length} doors, ${h.terminals.length} terminals, ${h.duck.spots.length} duck spots, ${SHOW_TEXT.length} bytes`,
    );
    expect(mapSummary("{")).toMatch(/^invalid \(not JSON/u);
  });

  it("saveFileFor: the active variant's file when it is a map file name, else house.json", () => {
    expect(saveFileFor("house.shed.json")).toBe("house.shed.json");
    expect(saveFileFor("house.json")).toBe("house.json");
    expect(saveFileFor("trapped-house.json")).toBe(DEFAULT_MAP_FILE); // a LOOM_HOUSE with another name
    expect(saveFileFor(null)).toBe(DEFAULT_MAP_FILE);
  });

  it("the show example ships its map as a project file (sync-example + a new project's seed)", () => {
    const maps = scenarioMapFiles("trapped-in-the-internet");
    expect(maps.map((f) => f.path)).toContain("house.json");
    expect(maps.every((f) => isMapFile(f.path))).toBe(true);
    expect(maps.find((f) => f.path === "house.json")!.source).toBe(SHOW_TEXT);
  });
});

// ---------------------------------------------------------------------------
// EventRuntime
// ---------------------------------------------------------------------------

const SCENARIO = scenarioSource("trapped-in-the-internet");

/** A ProjectLink that records what it was asked to do. */
function fakeProject(opts: { fail?: boolean } = {}) {
  const files = new Map<string, string>();
  const snapshots: MapFiles[] = [];
  const variants: Array<string | null> = [];
  const link: ProjectLink = {
    projectId: "proj-1",
    async writeFile(path, content) {
      if (opts.fail === true) throw new Error("db down");
      files.set(path, content);
    },
    async saveSnapshot(maps) {
      snapshots.push(maps);
    },
    async saveVariant(file) {
      variants.push(file);
    },
  };
  return { link, files, snapshots, variants };
}

function runtimeAt(d: string, init: { houseFile?: string; houseMaps?: MapFiles | null; mapVariant?: string | null; project?: ProjectLink | null } = {}): EventRuntime {
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: { event: "EVT333", prime: "PRM333", mod: "MOD333" },
    scenarioName: "trapped-in-the-internet",
    scenarioSource: SCENARIO,
    joinBase: () => "http://localhost",
    houseFile: init.houseFile ?? SHOW_FILE,
    ...(init.houseMaps !== undefined ? { houseMaps: init.houseMaps } : {}),
    ...(init.mapVariant !== undefined ? { mapVariant: init.mapVariant } : {}),
    ...(init.project !== undefined ? { project: init.project } : {}),
  });
}

function fakeReq(body: unknown, headers: Record<string, string> = {}, onClose?: (fn: () => void) => void): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on(ev: string, fn: () => void) {
      if (ev === "close") onClose?.(fn);
    },
    destroy() {},
  } as unknown as IncomingMessage;
}
function fakeRes(): ServerResponse & { statusCode: number; body: string } {
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write() {
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string };
}

type Auth = { moderator?: boolean; token?: string };
async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: unknown = {}, auth: Auth = {}) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  const headers: Record<string, string> = auth.token !== undefined ? { "x-loom-token": auth.token } : {};
  await rt.handle(fakeReq(body, headers), res, method, url.pathname, url, auth.moderator === true ? { moderator: true, moderatorName: "Ada" } : {});
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
const mod = (rt: EventRuntime, path: string, body: unknown = {}) => call(rt, "POST", path, body, { moderator: true });
const modGet = (rt: EventRuntime, path: string) => call(rt, "GET", path, {}, { moderator: true });
const variants = async (rt: EventRuntime) => (await modGet(rt, "/api/mod/spatial/variants")).json as unknown as MapVariantsResponse;

/** Open the spatial stream as a director; `of(event)` = that frame's data. */
function spatialStream(rt: EventRuntime) {
  let buf = "";
  const res = {
    writeHead() {
      return res;
    },
    write(chunk: string) {
      buf += chunk;
      return true;
    },
    end() {
      return res;
    },
  } as unknown as ServerResponse;
  const url = new URL("http://x/api/spatial/stream");
  let closer: (() => void) | undefined;
  const open = rt.handle(fakeReq(null, {}, (fn) => (closer = fn)), res, "GET", url.pathname, url, { moderator: true });
  const of = (event: string): Array<Record<string, unknown>> =>
    [...buf.matchAll(/event: (\w+)\ndata: (.*)\n\n/gu)].filter((m) => m[1] === event).map((m) => JSON.parse(m[2]!) as Record<string, unknown>);
  return { open, of, close: () => closer?.() };
}

/** Two variants: the show's map and its shed. */
function twoVariants(): MapFiles {
  return { "house.json": text(show()), "house.shed.json": text(shedOf(show())) };
}

describe("EventRuntime — the project's maps", () => {
  it("resolution: director save > the project snapshot's active variant > the show file", async () => {
    // No snapshot: the show's file.
    const bare = runtimeAt(freshDir());
    expect((await modGet(bare, "/api/spatial/house")).json.source).toBe("show");
    bare.dispose();

    // A snapshot: its house.json, even when the show file differs.
    const projectHouse = { ...show(), name: "The project's house" };
    const d = freshDir();
    const rt = runtimeAt(d, { houseMaps: { "house.json": text(projectHouse) } });
    const got = await modGet(rt, "/api/spatial/house");
    expect(got.json).toMatchObject({ source: "project", version: houseHash(projectHouse) });
    expect((got.json.house as HouseMap).name).toBe("The project's house");

    // A director's save outranks it.
    expect((await mod(rt, "/api/mod/spatial/house", { house: { ...show(), name: "Ada's edit" } })).status).toBe(200);
    expect((await modGet(rt, "/api/spatial/house")).json.source).toBe("event");
    rt.dispose();

    // An invalid snapshot falls through to the show's file.
    const broken = runtimeAt(freshDir(), { houseMaps: { "house.json": "{" } });
    expect((await modGet(broken, "/api/spatial/house")).json.source).toBe("show");
    broken.dispose();
  });

  it("a restart: the map files come from the row (like the story), the active variant from the state dir", async () => {
    const d = freshDir();
    const rt = runtimeAt(d, { houseMaps: twoVariants() });
    expect((await mod(rt, "/api/mod/spatial/variant", { file: "house.shed.json" })).status).toBe(200);
    rt.dispose();
    expect(existsSync(join(d, "spatial-maps.json"))).toBe(true);

    // The registry rebuilds a row's runtime with the row's maps: the same
    // files → the shed still plays.
    const again = runtimeAt(d, { houseMaps: twoVariants() });
    again.restore();
    const got = await modGet(again, "/api/spatial/house");
    expect(got.json.source).toBe("project");
    expect((got.json.house as HouseMap).name).toBe("The house (shed)");
    expect((await variants(again)).variants.find((v) => v.active)?.file).toBe("house.shed.json");
    again.dispose();

    // A sync wrote newer maps to the row while the runtime was down
    // (`sync-example --no-reload`): the restart plays them, variant kept.
    const newer = { "house.json": text(show()), "house.shed.json": text({ ...shedOf(show()), name: "Shed, synced" }) };
    const synced = runtimeAt(d, { houseMaps: newer });
    synced.restore();
    expect(((await modGet(synced, "/api/spatial/house")).json.house as HouseMap).name).toBe("Shed, synced");
    expect(synced.houseMaps).toEqual(newer);
    synced.dispose();

    // No row snapshot (the LAN default event, an old row): the state dir's copy.
    const lan = runtimeAt(d);
    lan.restore();
    expect(((await modGet(lan, "/api/spatial/house")).json.house as HouseMap).name).toBe("Shed, synced");
    lan.dispose();
  });

  it("the variant rides the event row: a switch records it, and a relaunch's fresh state dir starts on it", async () => {
    const p = fakeProject();
    const rt = runtimeAt(freshDir(), { houseMaps: twoVariants(), project: p.link });
    expect((await mod(rt, "/api/mod/spatial/variant", { file: "house.shed.json" })).status).toBe(200);
    expect(p.variants).toEqual(["house.shed.json"]);
    rt.dispose();

    // End → relaunch: a new event, a fresh state dir, the row seeded from
    // the project's last event (`events-api.ts`) — still the shed.
    const next = runtimeAt(freshDir(), { houseMaps: twoVariants(), mapVariant: "house.shed.json", project: fakeProject().link });
    expect(next.activeMapVariant).toBe("house.shed.json");
    expect(((await modGet(next, "/api/spatial/house")).json.house as HouseMap).name).toBe("The house (shed)");
    expect((await variants(next)).variants.find((v) => v.active)?.file).toBe("house.shed.json");
    next.dispose();

    // A recorded variant the project no longer has: the default.
    const gone = runtimeAt(freshDir(), { houseMaps: { "house.json": text(show()) }, mapVariant: "house.shed.json" });
    expect((await variants(gone)).variants.find((v) => v.active)?.file).toBe("house.json");
    gone.dispose();

    // The state dir's own choice outranks the row's (a server restart).
    const d = freshDir();
    const own = runtimeAt(d, { houseMaps: twoVariants(), project: p.link });
    await mod(own, "/api/mod/spatial/variant", { file: "house.json" });
    own.dispose();
    const back = runtimeAt(d, { houseMaps: twoVariants(), mapVariant: "house.shed.json" });
    expect(back.activeMapVariant).toBe("house.json");
    back.dispose();
  });

  it("GET variants: the project's files with the active one marked, `edited` while a director's save is in force", async () => {
    const rt = runtimeAt(freshDir(), { houseMaps: { ...twoVariants(), "house.broken.json": "{" } });
    const v = await variants(rt);
    expect(v.from).toBe("project");
    expect(v.edited).toBe(false);
    expect(v.project).toBe(false);
    expect(v.variants.map((x) => [x.file, x.active, x.ok])).toEqual([
      ["house.json", true, true],
      ["house.broken.json", false, false],
      ["house.shed.json", false, true],
    ]);
    expect(v.variants[2]!.name).toBe("The house (shed)");
    await mod(rt, "/api/mod/spatial/house", { house: show() });
    expect((await variants(rt)).edited).toBe(true);
    rt.dispose();
  });

  it("switching mid-show carries live sessions over: ducks kept or re-dealt, `house` + `duck` frames, tokens still good", async () => {
    const d = freshDir();
    const rt = runtimeAt(d, { houseMaps: twoVariants() });
    rt.openDoors();
    const term = spatialStream(rt);
    await term.open;
    // A marked program: the tablet's begin lets them in (wave 16; wave 18 marks, no restriction).
    const person = async (name: string) => {
      const id = ((await mod(rt, "/api/mod/persona", { name })).json.guest as { id: string }).id;
      await mod(rt, "/api/mod/signal", { name: "mark_for_reinstallation", subject: id }); // wave 18: the show's `reinstall:` reads the mark
      return id;
    };
    const firstSpot = show().duck.spots[0]!.id;
    // Deal until one session holds the spot the shed lacks and one doesn't.
    const sessions: Assignment[] = [];
    for (let i = 0; i < 40 && !(sessions.some((s) => s.duck.id === firstSpot) && sessions.some((s) => s.duck.id !== firstSpot)); i++) {
      const a = (await mod(rt, "/api/mod/spatial/begin", { guest: await person(`P${i}`), world: "web", device: "Tent tablet" })).json as unknown as Assignment;
      sessions.push(a);
    }
    const lost = sessions.find((s) => s.duck.id === firstSpot)!;
    const kept = sessions.find((s) => s.duck.id !== firstSpot)!;
    expect(lost).toBeDefined();
    expect(kept).toBeDefined();
    const before = rt.spatial.version;

    const sw = await mod(rt, "/api/mod/spatial/variant", { file: "house.shed.json", base: before });
    expect(sw.status).toBe(200);
    expect(sw.json).toMatchObject({ ok: true, file: "house.shed.json", dropped: false, version: houseHash(shedOf(show())) });
    expect(rt.spatial.source).toBe("project");
    expect(term.of("house")).toEqual([{ version: sw.json.version }]);
    const dealt = term.of("duck").map((f) => f.session);
    expect(dealt).toContain(lost.session);
    expect(dealt).not.toContain(kept.session);
    // Every session is still alive on the new map.
    expect((await call(rt, "POST", "/api/spatial/pose", { p: [0, 0, 0], yaw: 0 }, { token: kept.token })).status).toBe(204);
    const fresh = await call(rt, "GET", "/api/spatial/house", {}, { token: lost.token });
    expect(fresh.json.version).toBe(sw.json.version);
    expect((fresh.json.duck as { id: string }).id).not.toBe(firstSpot);

    // A stale base is refused, nothing changes.
    const stale = await mod(rt, "/api/mod/spatial/variant", { file: "house.json", base: before });
    expect(stale.status).toBe(409);
    expect(stale.json).toEqual({ error: "the map changed — reload", version: sw.json.version });
    expect(rt.spatial.version).toBe(sw.json.version);
    // The variant list carries the playing map's version — what the Run
    // card's switch sends back as `base` (wave 5 issue 7): a list read
    // before a co-director's switch is refused, one read after it passes.
    const listed = (await variants(rt)) as unknown as { version: string };
    expect(listed.version).toBe(sw.json.version);
    const raced = await mod(rt, "/api/mod/spatial/variant", { file: "house.json", base: listed.version });
    expect(raced.status).toBe(200);
    const late = await mod(rt, "/api/mod/spatial/variant", { file: "house.shed.json", base: listed.version });
    expect(late.status).toBe(409);
    expect(rt.spatial.version).toBe(before);
    await mod(rt, "/api/mod/spatial/variant", { file: "house.shed.json" });
    // And back to the tent, no base.
    const back = await mod(rt, "/api/mod/spatial/variant", { file: "house.json" });
    expect(back.json.version).toBe(before);
    term.close();
    rt.dispose();
  });

  it("switching: 404 an unknown file, 400 a broken variant, a director's save is dropped", async () => {
    const d = freshDir();
    const rt = runtimeAt(d, { houseMaps: { ...twoVariants(), "house.broken.json": JSON.stringify({ ...show(), rooms: [] }) } });
    const unknown = await mod(rt, "/api/mod/spatial/variant", { file: "house.nope.json" });
    expect(unknown.status).toBe(404);
    expect(unknown.json.variants).toEqual(["house.json", "house.shed.json", "house.broken.json"]);
    const broken = await mod(rt, "/api/mod/spatial/variant", { file: "house.broken.json" });
    expect(broken.status).toBe(400);
    expect(broken.json.error).toBe("invalid house map");
    expect((broken.json.problems as string[]).length).toBeGreaterThan(0);

    await mod(rt, "/api/mod/spatial/house", { house: { ...show(), name: "Ada's edit" } });
    expect(existsSync(join(d, "spatial-house.json"))).toBe(true);
    const sw = await mod(rt, "/api/mod/spatial/variant", { file: "house.shed.json" });
    expect(sw.json.dropped).toBe(true);
    expect(existsSync(join(d, "spatial-house.json"))).toBe(false);
    expect((await variants(rt)).edited).toBe(false);
    rt.dispose();
  });

  it("an event with no project map files switches among the show file's siblings (the LAN default event)", async () => {
    const d = freshDir();
    writeFileSync(join(d, "house.json"), SHOW_TEXT);
    writeFileSync(join(d, "house.shed.json"), text(shedOf(show())));
    const rt = runtimeAt(freshDir(), { houseFile: join(d, "house.json") });
    const v = await variants(rt);
    expect(v.from).toBe("show");
    expect(v.variants.map((x) => [x.file, x.active])).toEqual([["house.json", true], ["house.shed.json", false]]);
    const sw = await mod(rt, "/api/mod/spatial/variant", { file: "house.shed.json" });
    expect(sw.status).toBe(200);
    expect(rt.spatial.source).toBe("show");
    expect(rt.spatial.house!.name).toBe("The house (shed)");
    // Still the show side: a hand edit of the chosen sibling is followed.
    writeFileSync(join(d, "house.shed.json"), text({ ...shedOf(show()), name: "Shed, edited" }));
    const later = Date.now() / 1000 + 5;
    (await import("node:fs")).utimesSync(join(d, "house.shed.json"), later, later);
    expect(((await modGet(rt, "/api/spatial/house")).json.house as HouseMap).name).toBe("Shed, edited");
    // Saving to a project needs one.
    const save = await mod(rt, "/api/mod/spatial/house/project", {});
    expect(save.status).toBe(409);
    expect(save.json.error).toBe("this event has no project — download the map instead");
    rt.dispose();
  });

  it("Save to project on a show sibling (no project maps yet) writes that variant's file, never the tent's", async () => {
    const d = freshDir();
    writeFileSync(join(d, "house.json"), SHOW_TEXT);
    writeFileSync(join(d, "house.shed.json"), text(shedOf(show())));
    const p = fakeProject();
    const rt = runtimeAt(freshDir(), { houseFile: join(d, "house.json"), project: p.link });
    await mod(rt, "/api/mod/spatial/variant", { file: "house.shed.json" });
    const saved = await mod(rt, "/api/mod/spatial/house", { house: { ...shedOf(show()), name: "The shed, adjusted" } });
    const out = await mod(rt, "/api/mod/spatial/house/project", { base: saved.json.version });
    expect(out.status).toBe(200);
    expect(out.json.file).toBe("house.shed.json");
    expect([...p.files.keys()]).toEqual(["house.shed.json"]);
    expect(parseMapText(p.files.get("house.shed.json")!).house!.name).toBe("The shed, adjusted");
    // …and the event keeps playing it, now as the project's file.
    expect(rt.spatial.source).toBe("project");
    expect((await variants(rt)).variants.find((v) => v.active)?.file).toBe("house.shed.json");
    rt.dispose();
  });

  it("Save to project: the live map becomes the active variant's file and retires the director's save", async () => {
    const d = freshDir();
    const p = fakeProject();
    const rt = runtimeAt(d, { houseMaps: twoVariants(), project: p.link });
    expect((await variants(rt)).project).toBe(true);
    await mod(rt, "/api/mod/spatial/variant", { file: "house.shed.json" });
    const edited = { ...shedOf(show()), name: "The shed, measured" };
    const saved = await mod(rt, "/api/mod/spatial/house", { house: edited });
    const version = saved.json.version as string;

    // A stale base: 409, nothing written.
    expect((await mod(rt, "/api/mod/spatial/house/project", { base: "deadbeef" })).status).toBe(409);
    expect(p.files.size).toBe(0);

    const out = await mod(rt, "/api/mod/spatial/house/project", { base: version });
    expect(out.status).toBe(200);
    expect(out.json).toEqual({ ok: true, file: "house.shed.json", version });
    const written = p.files.get("house.shed.json")!;
    expect(parseMapText(written).house!.name).toBe("The shed, measured");
    expect(written.endsWith("}\n")).toBe(true);
    expect(p.snapshots.at(-1)!["house.shed.json"]).toBe(written);
    // The event now runs on the project's copy — same map, no director's save.
    expect(rt.spatial.source).toBe("project");
    expect(rt.spatial.version).toBe(version);
    expect(existsSync(join(d, "spatial-house.json"))).toBe(false);
    expect(rt.houseMaps!["house.shed.json"]).toBe(written);
    rt.dispose();
    // …and so does the restarted process.
    const again = runtimeAt(d, { project: p.link });
    again.restore();
    expect((await modGet(again, "/api/spatial/house")).json).toMatchObject({ source: "project", version });
    again.dispose();
  });

  it("Save to project as another file adds a variant; the live map is untouched; bad names + write failures are refused", async () => {
    const d = freshDir();
    const p = fakeProject();
    const rt = runtimeAt(d, { project: p.link }); // a project with no map files yet: the show's map plays
    expect((await mod(rt, "/api/mod/spatial/house/project", { file: "maps/house.json" })).status).toBe(400);
    expect((await mod(rt, "/api/mod/spatial/house/project", { file: "house.loom" })).status).toBe(400);

    // The first map saved to a mapless project becomes the one it plays.
    const first = await mod(rt, "/api/mod/spatial/house/project", {});
    expect(first.json.file).toBe("house.json");
    expect(rt.spatial.source).toBe("project");

    await mod(rt, "/api/mod/spatial/house", { house: shedOf(show()) }); // a director's draft of the shed
    const asShed = await mod(rt, "/api/mod/spatial/house/project", { file: "house.shed.json" });
    expect(asShed.status).toBe(200);
    expect(rt.spatial.source).toBe("event"); // still the director's save over house.json
    expect((await variants(rt)).variants.map((v) => [v.file, v.active])).toEqual([["house.json", true], ["house.shed.json", false]]);
    rt.dispose();

    const failing = runtimeAt(freshDir(), { project: fakeProject({ fail: true }).link });
    const r = await mod(failing, "/api/mod/spatial/house/project", {});
    expect(r.status).toBe(502);
    expect(failing.spatial.source).toBe("show");
    failing.dispose();
  });

  it("a reload's fresh snapshot: the active variant follows the project (announced), a director's save stays", async () => {
    const d = freshDir();
    const rt = runtimeAt(d, { houseMaps: twoVariants() });
    rt.openDoors();
    const term = spatialStream(rt);
    await term.open;
    await mod(rt, "/api/mod/spatial/variant", { file: "house.shed.json" });
    const remeasured = { ...shedOf(show()), name: "Shed v2" };
    rt.setProjectMaps({ "house.json": text(show()), "house.shed.json": text(remeasured) });
    expect(rt.spatial.house!.name).toBe("Shed v2");
    expect(term.of("house").at(-1)).toEqual({ version: houseHash(remeasured) });

    // The shed is gone from the project: back to the default.
    rt.setProjectMaps({ "house.json": text(show()) });
    expect(rt.spatial.version).toBe(houseHash(show()));
    expect((await variants(rt)).variants.map((v) => [v.file, v.active])).toEqual([["house.json", true]]);

    // A director's save is never replaced by a reload.
    await mod(rt, "/api/mod/spatial/house", { house: { ...show(), name: "Ada's" } });
    rt.setProjectMaps({ "house.json": text({ ...show(), name: "Newer project" }) });
    expect(rt.spatial.house!.name).toBe("Ada's");
    term.close();
    rt.dispose();
  });

  it("/api/mod/load takes the project's maps with the source (sync-example)", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    expect((await modGet(rt, "/api/spatial/house")).json.source).toBe("show");
    const r = await mod(rt, "/api/mod/load", { source: SCENARIO, maps: { "house.json": text({ ...show(), name: "Synced" }), "../x.json": "{}" } });
    expect(r.status).toBe(200);
    expect(rt.houseMaps).toEqual({ "house.json": text({ ...show(), name: "Synced" }) });
    expect(rt.spatial.house!.name).toBe("Synced");
    rt.dispose();
  });

  it("/api/mod/load refuses a broken map before restarting, and records a good snapshot on the row", async () => {
    const p = fakeProject();
    const rt = runtimeAt(freshDir(), { houseMaps: twoVariants(), project: p.link });
    rt.openDoors();
    const bad = await mod(rt, "/api/mod/load", { source: SCENARIO, maps: { "house.json": text(show()), "house.shed.json": "{ \"rooms\": [], }" } });
    expect(bad.status).toBe(400);
    expect(bad.json.file).toBe("house.shed.json");
    expect((bad.json.problems as string[]).length).toBeGreaterThan(0);
    expect(rt.houseMaps).toEqual(twoVariants()); // nothing changed
    expect(p.snapshots).toEqual([]);

    const maps = { "house.json": text({ ...show(), name: "Synced" }) };
    expect((await mod(rt, "/api/mod/load", { source: SCENARIO, maps })).status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(p.snapshots).toEqual([maps]);
    rt.dispose();
  });

  it("the new routes are moderator-only", async () => {
    const rt = runtimeAt(freshDir(), { houseMaps: twoVariants(), project: fakeProject().link });
    rt.openDoors();
    const pid = ((await mod(rt, "/api/mod/persona", { name: "Paint" })).json.guest as { id: string }).id;
    await mod(rt, "/api/mod/signal", { name: "mark_for_reinstallation", subject: pid }); // wave 18: the show's `reinstall:` reads the mark
    const a = (await mod(rt, "/api/mod/spatial/begin", { guest: pid, world: "web" })).json as unknown as Assignment;
    expect(typeof a.token).toBe("string");
    for (const auth of [{}, { token: "nope" }, { token: a.token }]) {
      expect((await call(rt, "GET", "/api/mod/spatial/variants", {}, auth)).status).toBe(403);
      expect((await call(rt, "POST", "/api/mod/spatial/variant", { file: "house.shed.json" }, auth)).status).toBe(403);
      expect((await call(rt, "POST", "/api/mod/spatial/house/project", {}, auth)).status).toBe(403);
    }
    expect(rt.spatial.source).toBe("project");
    expect(rt.spatial.house!.name).toBe(show().name);
    // A mod token works like the author's session.
    const login = await call(rt, "POST", "/api/mod/login", { passcode: "MOD333" });
    const token = login.json.token as string;
    expect((await call(rt, "GET", "/api/mod/spatial/variants", {}, { token })).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/spatial/variant", { file: "house.shed.json" }, { token })).status).toBe(200);
    rt.dispose();
  });
});
