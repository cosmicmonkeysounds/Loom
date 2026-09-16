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
  when riddle for guest:
    The Gatekeeper: Prove you are not a bot.
    show captcha "Pick every gate" to guest with target: "gate"
  when captcha answered for guest:
    if passed:
      set guest.favour += 1
      reply A human. How dull.
    else:
      reply Welcome, machine.

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

INTERACTION riddle
  label: Riddle
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
    expect(g.interactions.map((i) => i.id)).toEqual(["knock", "riddle"]);
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
    expect(m.interactions!.map((i) => i.id)).toEqual(["knock", "riddle", "whisper", "eject"]);
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

describe("/api/guest/widget", () => {
  async function shown(rt: EventRuntime, token: string, id: string): Promise<number> {
    expect((await post(rt, "/api/guest/act", { token, name: "riddle" })).status).toBe(200);
    const card = rt.chatHistoryFor(id).find((m) => m.kind === "widget");
    expect(card?.widget).toEqual({ kind: "captcha", text: "Pick every gate", params: { target: "gate" } });
    expect(card?.channel).toBe("dm:The Gatekeeper"); // docked under the character who just spoke
    expect(card?.audience).toEqual([id]);
    return card!.seq;
  }

  it("answers a widget as the `<kind> answered` event with the result as arguments", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    const seq = await shown(rt, g.token, g.id);
    const r = await post(rt, "/api/guest/widget", { token: g.token, seq, result: { passed: true, picked: 3 } });
    expect(r.status).toBe(200);
    const log = rt.liveSim!.log.all();
    expect(log.some((e) => e.type === "signal" && e.name === "captcha answered" && e.subject === g.id)).toBe(true);
    expect(log.some((e) => e.type === "respond" && e.to === g.id && e.text === "A human. How dull.")).toBe(true);
    // One answer per card per guest.
    expect((await post(rt, "/api/guest/widget", { token: g.token, seq, result: { passed: false } })).status).toBe(409);
  });

  it("refuses a card that isn't yours, a bad seq, and a result that names someone", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const a = await guest(rt, "Ada");
    const b = await guest(rt, "Bob");
    const seq = await shown(rt, a.token, a.id);
    expect((await post(rt, "/api/guest/widget", { token: b.token, seq, result: {} })).status).toBe(404);
    expect((await post(rt, "/api/guest/widget", { token: a.token, seq: 9999, result: {} })).status).toBe(404);
    expect((await post(rt, "/api/guest/widget", { token: a.token, seq, result: { who: b.id } })).status).toBe(400);
    expect((await post(rt, "/api/guest/widget", { token: a.token, seq, result: [1] })).status).toBe(400);
    // Still unanswered after the refusals.
    expect((await post(rt, "/api/guest/widget", { token: a.token, seq, result: { passed: false } })).status).toBe(200);
    expect(rt.liveSim!.log.all().some((e) => e.type === "respond" && e.to === a.id && e.text === "Welcome, machine.")).toBe(true);
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

describe("/api/mod/signal as a character (`actor`)", () => {
  it("fires only that character's hooks — the director's performer-lens path", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    const r = await post(rt, "/api/mod/signal", { name: "whisper", subject: g.id, actor: "The Gatekeeper" }, true);
    expect(r.status).toBe(200);
    // Only the Gatekeeper's hook ran (+5), not Ivo Marsh's (+100) — exactly like /api/prime/act.
    expect(rt.liveSim!.world.get(`${g.id}.favour`)).toEqual({ kind: "number", value: 5 });
    expect((await post(rt, "/api/mod/signal", { name: "whisper", subject: g.id, actor: "Nobody" }, true)).status).toBe(404);
  });

  it("without an actor every listener hears it", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    expect((await post(rt, "/api/mod/signal", { name: "whisper", subject: g.id }, true)).status).toBe(200);
    expect(rt.liveSim!.world.get(`${g.id}.favour`)).toEqual({ kind: "number", value: 105 });
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
