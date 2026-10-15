//! SW-MAP-01 against a real Postgres: a project's house maps are project
//! files, snapshotted on the event row at launch like `scenario_source`, so
//! an event plays a fixed map; a reload refreshes it; "Save to project"
//! writes the file back (and the row follows); End → relaunch plays the
//! project's current map. Gated on DB connectivity like `db.test.ts` (every
//! case skips with no database).

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { validateHouse, type HouseMap } from "@loom/house";
import { dbReady, initSchema, pool } from "../server/db/index.ts";
import { activeEvent, createProject, getFile, projectSource, upsertFile } from "../server/db/queries.ts";
import { handleEvent } from "../server/events-api.ts";
import { handleProjects } from "../server/projects.ts";
import { EventRegistry } from "../server/registry.ts";
import { mapFileText, parseMapText } from "../server/house-maps.ts";
import type { EventRuntime } from "../server/event-runtime.ts";

const OWNER = `test-maps-${randomUUID()}`;
const USER = { id: OWNER, email: `${OWNER}@example.test`, name: "Ada" };
let hasDb = false;
const stateDir = mkdtempSync(join(tmpdir(), "loom-events-maps-"));
const registry = new EventRegistry(stateDir, () => "http://localhost");

const SHOW = (() => {
  const v = validateHouse(JSON.parse(readFileSync(fileURLToPath(new URL("../examples/trapped-in-the-internet/house.json", import.meta.url)), "utf8")));
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
  return v.house;
})();
const named = (name: string): string => mapFileText({ ...SHOW, name });

beforeAll(async () => {
  hasDb = await dbReady();
  if (hasDb) await initSchema();
});

afterAll(async () => {
  for (const rt of registry.all()) registry.stop(rt.eventId);
  rmSync(stateDir, { recursive: true, force: true });
  if (hasDb) {
    await pool().query("delete from project where owner_id = $1", [OWNER]);
    await pool().end();
  }
});

function fakeReq(body: unknown): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
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

/** `POST /api/projects/:id/event[/action]` as the owner. */
async function eventCall(projectId: string, action?: string, body: unknown = {}) {
  const res = fakeRes();
  const segs = ["api", "projects", projectId, "event", ...(action !== undefined ? [action] : [])];
  await handleEvent(fakeReq(body), res, "POST", segs, USER, { registry, joinBase: () => "http://localhost" });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

/** A mod call on a hosted runtime, as the owning author. */
async function modCall(rt: EventRuntime, method: "GET" | "POST", path: string, body: unknown = {}) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body), res, method, url.pathname, url, { moderator: true, moderatorName: "Ada" });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
const liveMap = async (rt: EventRuntime) => (await modCall(rt, "GET", "/api/spatial/house")).json as { house: HouseMap; source: string };

describe("the map belongs to the project (Postgres)", () => {
  it("map files are not story: projectSource concatenates the .loom files only", async (ctx) => {
    if (!hasDb) return ctx.skip();
    const p = await createProject(OWNER, "Maps are not story");
    await upsertFile(p.id, "main.loom", "# Maps\n");
    await upsertFile(p.id, "house.json", named("The house"));
    const src = await projectSource(p.id);
    expect(src!.source).toContain("# ── main.loom");
    expect(src!.source).not.toContain("house.json");
    expect(src!.source).not.toContain('"floors"');
    // A project holding only a map has nothing to run.
    const q = await createProject(OWNER, "Only a map");
    await upsertFile(q.id, "house.json", named("The house"));
    expect(await projectSource(q.id)).toBeNull();
  });

  it("launch snapshots the maps; reload refreshes them; save-to-project writes back; End → relaunch plays the current map", async (ctx) => {
    if (!hasDb) return ctx.skip();
    const p = await createProject(OWNER, "Mapped show");
    await upsertFile(p.id, "main.loom", "# Mapped show\n\n== Start\nHello.\n");
    await upsertFile(p.id, "house.json", named("Tent v1"));
    await upsertFile(p.id, "house.shed.json", named("Shed v1"));

    // Launch: the row and the runtime hold the snapshot; the event plays house.json.
    const launched = await eventCall(p.id, undefined, { mode: "preview" });
    expect(launched.status).toBe(200);
    const id = (launched.json.event as { id: string }).id;
    const row = (await activeEvent(p.id))!;
    expect(Object.keys(row.house_maps!).sort()).toEqual(["house.json", "house.shed.json"]);
    const rt = registry.get(id)!;
    expect(await liveMap(rt)).toMatchObject({ source: "project", house: { name: "Tent v1" } });

    // A fixed map: editing the project changes nothing until a reload.
    await upsertFile(p.id, "house.json", named("Tent v2"));
    expect((await liveMap(rt)).house.name).toBe("Tent v1");
    expect((await eventCall(p.id, "reload")).status).toBe(200);
    expect((await liveMap(rt)).house.name).toBe("Tent v2");
    expect(parseMapText((await activeEvent(p.id))!.house_maps!["house.json"]!).house!.name).toBe("Tent v2");

    // Rain: switch to the shed, edit it on the map page, save to the project.
    expect((await modCall(rt, "POST", "/api/mod/spatial/variant", { file: "house.shed.json" })).status).toBe(200);
    expect((await modCall(rt, "POST", "/api/mod/spatial/house", { house: { ...SHOW, name: "Shed, measured" } })).status).toBe(200);
    const saved = await modCall(rt, "POST", "/api/mod/spatial/house/project", {});
    expect(saved.json).toMatchObject({ ok: true, file: "house.shed.json" });
    expect(parseMapText((await getFile(p.id, "house.shed.json"))!.content).house!.name).toBe("Shed, measured");
    expect(parseMapText((await activeEvent(p.id))!.house_maps!["house.shed.json"]!).house!.name).toBe("Shed, measured");

    // End → relaunch: a new event, the project's current maps, the default variant.
    expect((await eventCall(p.id, "end")).status).toBe(200);
    const again = await eventCall(p.id, undefined, { mode: "preview" });
    const next = registry.get((again.json.event as { id: string }).id)!;
    expect(next.eventId).not.toBe(id);
    expect(await liveMap(next)).toMatchObject({ source: "project", house: { name: "Tent v2" } });
    expect(parseMapText(next.houseMaps!["house.shed.json"]!).house!.name).toBe("Shed, measured");
    await eventCall(p.id, "end");
  });

  it("PUT /files refuses a map file that doesn't validate (an empty new file is fine); other files are untouched", async (ctx) => {
    if (!hasDb) return ctx.skip();
    const p = await createProject(OWNER, "Map writes");
    const put = async (path: string, content: string) => {
      const res = fakeRes();
      await handleProjects(fakeReq({ path, content }), res, "PUT", `/api/projects/${p.id}/files`, USER);
      return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
    };
    const bad = await put("house.json", '{ "floors": [], }');
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("invalid house map house.json");
    expect((bad.json.problems as string[])[0]).toMatch(/^not JSON/u);
    expect((await put("house.shed.json", JSON.stringify({ version: 1 }))).status).toBe(400);
    expect(await getFile(p.id, "house.json")).toBeNull();
    expect((await put("house.json", "")).status).toBe(200); // the editor's New file…
    expect((await put("house.json", named("Tent"))).status).toBe(200);
    expect((await put("notes.json", "{ not a map")).status).toBe(200);
  });

  it("an old event row with no snapshot plays the show's file", async (ctx) => {
    if (!hasDb) return ctx.skip();
    const p = await createProject(OWNER, "Mapless");
    await upsertFile(p.id, "main.loom", "# Mapless\n");
    const launched = await eventCall(p.id, undefined, { mode: "preview" });
    const rt = registry.get((launched.json.event as { id: string }).id)!;
    expect((await activeEvent(p.id))!.house_maps).toEqual({});
    expect((await liveMap(rt)).source).toBe("show");
    await eventCall(p.id, "end");
  });
});
