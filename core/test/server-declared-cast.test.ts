//! Wave 6 open issue 6: a wall terminal provisioned before the doors open
//! resolves its mod code to the story's declared cast, so `provision`
//! canonicalises its `character` (and refuses a typo) at setup instead of
//! keeping the typed name until the doors open. The mod view served while
//! the doors are shut (`GET /api/state?role=mod`) carries the same list.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { ModView } from "../server/views.ts";

const CODES = { event: "EVT606", prime: "PRM606", mod: "MOD606" };
const SOURCE = "# Cast\nstart: Go\n\nCHARACTER Trabolta\nCHARACTER Clippy\n\n== Go\nHi.\n";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown, headers: Record<string, string>): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
  } as unknown as IncomingMessage;
}
function fakeRes() {
  const res = {
    statusCode: 0,
    body: "",
    setHeader() {},
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
  return res as typeof res & ServerResponse;
}
async function call(rt: EventRuntime, method: string, p: string, body: unknown, token?: string) {
  const url = new URL(`http://x${p}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body, token ? { "x-loom-token": token } : {}), res, method, url.pathname, url, { moderator: false });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

function runtime(source = SOURCE): EventRuntime {
  const dir = mkdtempSync(join(tmpdir(), "loom-cast-"));
  dirs.push(dir);
  return new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: "cast", scenarioSource: source, joinBase: () => "http://localhost" });
}

describe("the declared cast before the doors (open issue 6)", () => {
  it("the mod view served with the doors shut lists the story's characters", async () => {
    const rt = runtime();
    const token = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
    expect(typeof token).toBe("string");
    const shut = (await call(rt, "GET", "/api/state?role=mod", {}, token)).json as unknown as ModView;
    expect(shut.characters).toEqual(["Trabolta", "Clippy"]);
    expect(shut.cast).toEqual([]); // nothing else is live yet
    rt.openDoors();
    const open = (await call(rt, "GET", "/api/state?role=mod", {}, token)).json as unknown as ModView;
    expect(open.characters).toEqual(["Trabolta", "Clippy"]);
    rt.dispose();
  });

  it("compiles the cast from the story text while the doors are shut", () => {
    const rt = runtime();
    expect(rt.declaredCharacters).toEqual(["Trabolta", "Clippy"]);
    expect(rt.characterNames).toEqual([]); // the live cast; a performer code resolves `declaredCharacters` (recheck item 6)
    expect(runtime("").declaredCharacters).toEqual([]);
    rt.dispose();
  });
});
