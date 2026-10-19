//! W-03 against a real Postgres: the reserved programs' claim secret is
//! pinned to the project like its codes (K-10) — a launch carries the
//! project's last event's, so End → relaunch (even with `rotate: true`)
//! keeps every printed invitation; a row from before the column gets the
//! secret its runtime minted written back. Gated on DB connectivity like
//! `db.test.ts` (every case skips with no database).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dbReady, initSchema, pool } from "../server/db/index.ts";
import { activeEvent, createProject, lastEventClaimSecret, setEventClaimSecret, upsertFile } from "../server/db/queries.ts";
import { handleEvent, specFromRow } from "../server/events-api.ts";
import { EventRegistry } from "../server/registry.ts";
import { claimToken } from "../server/identity.ts";

const OWNER = `test-claims-${randomUUID()}`;
const USER = { id: OWNER, email: `${OWNER}@example.test`, name: "Ada" };
let hasDb = false;
const stateDir = mkdtempSync(join(tmpdir(), "loom-events-claims-"));
const registry = new EventRegistry(stateDir, () => "http://localhost");

const STORY = "# Claims\n\nCHARACTER Microsoft Excel\n  reserved: true\n\n== Start\nHello.\n";

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
async function eventCall(projectId: string, action?: string, body: unknown = {}) {
  const res = fakeRes();
  const segs = ["api", "projects", projectId, "event", ...(action !== undefined ? [action] : [])];
  await handleEvent(fakeReq(body), res, "POST", segs, USER, { registry, joinBase: () => "http://localhost" });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
const eventId = (r: { json: Record<string, unknown> }) => (r.json.event as { id: string }).id;

describe("the claim secret is pinned to the project (Postgres)", () => {
  it("a launch mints it; End → relaunch keeps it, whatever `rotate` does to the codes", async (ctx) => {
    if (!hasDb) return ctx.skip();
    const p = await createProject(OWNER, "Claims show");
    await upsertFile(p.id, "main.loom", STORY);
    expect(await lastEventClaimSecret(p.id)).toBeNull();

    const first = await eventCall(p.id, undefined, { mode: "preview" });
    expect(first.status).toBe(200);
    const secret = (await activeEvent(p.id))!.claim_secret!;
    expect(secret.length).toBeGreaterThan(20);
    const token = registry.get(eventId(first))!.claimFor("Microsoft Excel");
    expect(token).toBe(claimToken(secret, "Microsoft Excel"));

    expect((await eventCall(p.id, "end")).status).toBe(200);
    const second = await eventCall(p.id, undefined, { mode: "preview", rotate: true });
    expect(eventId(second)).not.toBe(eventId(first));
    expect((await activeEvent(p.id))!.claim_secret).toBe(secret);
    expect(registry.get(eventId(second))!.claimFor("Microsoft Excel")).toBe(token);
    await eventCall(p.id, "end");
  });

  it("a row from before the column gets its runtime's minted secret written back (never over a pinned one)", async (ctx) => {
    if (!hasDb) return ctx.skip();
    const p = await createProject(OWNER, "Legacy row");
    await upsertFile(p.id, "main.loom", STORY);
    const launched = await eventCall(p.id, undefined, { mode: "preview" });
    const id = eventId(launched);
    registry.stop(id);
    await pool().query("update event set claim_secret = null where id = $1", [id]);
    rmSync(join(stateDir, id), { recursive: true, force: true });

    const row = (await activeEvent(p.id))!;
    expect(row.claim_secret).toBeNull();
    const rt = registry.ensure(specFromRow(row));
    await new Promise((r) => setTimeout(r, 50)); // the write-back is fire-and-forget
    const kept = (await activeEvent(p.id))!.claim_secret!;
    expect(rt.claimFor("Microsoft Excel")).toBe(claimToken(kept, "Microsoft Excel"));
    await setEventClaimSecret(id, "something-else");
    expect((await activeEvent(p.id))!.claim_secret).toBe(kept);
    await eventCall(p.id, "end");
  });
});
