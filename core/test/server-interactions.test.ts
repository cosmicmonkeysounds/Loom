//! Slice 3 — the participant app is story-driven (docs/loom-4.md §11):
//! the story's title + theme ride every view, declared INTERACTIONs
//! become guest / performer routes that fire named events, and the mod
//! `signal` route carries arguments.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { guestView, modView, primeView } from "../server/views.ts";

const CODES = { event: "EVT111", prime: "PRM111", mod: "MOD111" };

const SOURCE = `# The Glass Orchard
theme: aol97
start: Gate

LOCATION Gate
  label: The Front Gate

ROLE Guest
  favour: 0 to 100 = 0
  when knock for guest:
    reply Nobody answers.

CHARACTER The Gatekeeper
  when whisper for guest:
    set guest.favour += 5
    The Gatekeeper: Later. Not here.

CHARACTER Ivo Marsh
  when whisper for guest:
    set guest.favour += 100

CHARACTER Warden
  when alarm:
    Warden: Level {level}.

INTERACTION knock
  label: Knock
  who: guest

INTERACTION whisper
  label: Whisper to them
  who: performer

INTERACTION eject
  who: admin

== Gate
  setting: Gate
Narrator: The gate.
`;

const dirs: string[] = [];
function freshRuntime(): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-ix-"));
  dirs.push(d);
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "orchard",
    scenarioSource: SOURCE,
    joinBase: () => "http://localhost",
  });
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
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
async function post(rt: EventRuntime, path: string, body: unknown, moderator = false) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body), res, "POST", path, url, { moderator });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
async function guest(rt: EventRuntime, name = "Alice"): Promise<{ id: string; token: string }> {
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event });
  return { id: r.json.id as string, token: r.json.token as string };
}

describe("views carry the story's title, theme, and interactions", () => {
  it("title + theme come from the source header; interactions are filtered by who", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.createPerson("g1", "Ada");
    const g = guestView(sim, "g1");
    expect(g.title).toBe("The Glass Orchard");
    expect(g.theme).toBe("aol97");
    expect(g.interactions.map((i) => i.id)).toEqual(["knock"]);
    expect(g.groups).toEqual([]);
    const p = primeView(sim, "The Gatekeeper");
    expect(p.title).toBe("The Glass Orchard");
    expect(p.interactions.map((i) => [i.id, i.who])).toEqual([
      ["whisper", "performer"],
      ["eject", "admin"],
    ]);
    expect(p.legacyCapture).toBe(false);
    const m = modView(sim, "open", "orchard");
    expect(m.title).toBe("The Glass Orchard");
    expect(m.interactions!.map((i) => i.id)).toEqual(["knock", "whisper", "eject"]);
    // The lobby is named after the story; derived rooms live in the story space.
    expect(sim.channelHead("lobby")).toMatchObject({ title: "The Glass Orchard", spaceId: "story" });
  });

  it("defaults to the plain theme and a plain lobby when the header says nothing", () => {
    const sim = Sim.fromSources("== x\n  Nothing.\n");
    expect(sim.model.theme).toBeNull();
    expect(sim.lobbyTitle()).toBe("Lobby");
    expect(freshRuntime().theme).toBe("aol97");
  });
});

describe("/api/guest/act", () => {
  it("fires a `who: guest` interaction for the caller only", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    const r = await post(rt, "/api/guest/act", { token: g.token, name: "knock" });
    expect(r.status).toBe(200);
    // The role's `when knock for guest:` replied to the guest.
    expect(rt.liveSim!.log.all().some((e) => e.type === "respond" && e.to === g.id && e.text === "Nobody answers.")).toBe(true);
  });

  it("refuses interactions that are not for guests", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    expect((await post(rt, "/api/guest/act", { token: g.token, name: "whisper" })).status).toBe(404);
    expect((await post(rt, "/api/guest/act", { token: g.token, name: "nope" })).status).toBe(404);
  });
});

describe("/api/prime/act", () => {
  it("fires a performer interaction as that character only", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    const login = await post(rt, "/api/prime/login", { character: "The Gatekeeper", passcode: CODES.prime });
    const token = login.json.token as string;
    const r = await post(rt, "/api/prime/act", { token, name: "whisper", guest: g.id });
    expect(r.status).toBe(200);
    // Only the Gatekeeper's hook ran (+5), not Ivo Marsh's (+100).
    expect(rt.liveSim!.world.get(`${g.id}.favour`)).toEqual({ kind: "number", value: 5 });
    expect(rt.liveSim!.log.all().some((e) => e.type === "dialogue" && e.speaker === "The Gatekeeper")).toBe(true);
  });

  it("gates `who: admin` interactions behind moderator powers and validates the guest", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    const login = await post(rt, "/api/prime/login", { character: "The Gatekeeper", passcode: CODES.prime });
    const token = login.json.token as string;
    expect((await post(rt, "/api/prime/act", { token, name: "eject", guest: g.id })).status).toBe(404);
    expect((await post(rt, "/api/prime/act", { token, name: "whisper", guest: "ghost" })).status).toBe(404);
    expect((await post(rt, "/api/prime/act", { name: "whisper", guest: g.id })).status).toBe(403);
  });
});

describe("/api/mod/signal with arguments", () => {
  it("binds JSON args in the listening body", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    await guest(rt);
    const r = await post(rt, "/api/mod/signal", { name: "alarm", args: { level: 4 } }, true);
    expect(r.status).toBe(200);
    expect(rt.liveSim!.log.all().some((e) => e.type === "dialogue" && e.text === "Level 4.")).toBe(true);
  });
});
