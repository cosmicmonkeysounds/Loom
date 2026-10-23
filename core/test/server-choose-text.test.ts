//! `/api/guest/choose {index, text?, choice?}` (wave 20, D15 + D18): a
//! client names the menu it shows by id and the option by its text, so a
//! click racing a new menu is refused (409 `moved`), never misapplied.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";

const CODES = { event: "EVT222", prime: "PRM222", mod: "MOD222" };

const SOURCE = `# The Heart
start: Gate

LOCATION Gate
LOCATION Server Room

CHARACTER Trabolta
CHARACTER Clippy

ROLE Program
  picked: text
  when tablet for program:
    -> Tablet Video
  when heart for program:
    -> Heart Talk

INTERACTION tablet
  who: guest

INTERACTION heart
  who: guest

== Gate
  setting: Gate
Narrator: The gate.

== Tablet Video
  setting: Gate
  cast: Clippy
Clippy: Where is the exit?
* Up the stairs.
  set program.picked = "stairs"
* I don't know.
  set program.picked = "dunno"

== Heart Talk
  setting: Server Room
  cast: Trabolta
Trabolta: Close the door.
+ ⟦ASK⟧ Why are you here?
  set program.picked = "why"
+ ⟦LEAVE⟧ Goodbye.
  set program.picked = "bye"
`;

const dirs: string[] = [];
function runtimeIn(d: string, limits?: ConstructorParameters<typeof EventRuntime>[0]["limits"]): EventRuntime {
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "heart",
    scenarioSource: SOURCE,
    joinBase: () => "http://localhost",
    limits,
  });
}
function freshRuntime(limits?: ConstructorParameters<typeof EventRuntime>[0]["limits"]): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-choose-"));
  dirs.push(d);
  return runtimeIn(d, limits);
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
async function state(rt: EventRuntime, token: string) {
  const res = fakeRes();
  const url = new URL(`http://x/api/state?role=guest&token=${encodeURIComponent(token)}`);
  await rt.handle(fakeReq({}), res, "GET", url.pathname, url, { moderator: false });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

type Choice = { id: number; beat: string; channel: string; options: string[] };

async function twoMenus(rt: EventRuntime) {
  rt.openDoors();
  const g = await guest(rt);
  expect((await post(rt, "/api/guest/act", { token: g.token, name: "tablet" })).status).toBe(200);
  expect((await post(rt, "/api/guest/act", { token: g.token, name: "heart" })).status).toBe(200);
  const choices = (await state(rt, g.token)).json["choices"] as Choice[];
  return { g, choices };
}
const picked = (rt: EventRuntime, id: string) => (rt.liveSim!.world.get(`${id}.picked`) as { value?: unknown }).value;

describe("/api/guest/choose", () => {
  it("the guest's state lists every menu with its id and channel", async () => {
    const rt = freshRuntime();
    const { choices } = await twoMenus(rt);
    expect(choices.map((c) => [c.beat, c.channel, c.options])).toEqual([
      ["Tablet Video", "dm:Clippy", ["Up the stairs.", "I don't know."]],
      ["Heart Talk", "dm:Trabolta", ["⟦ASK⟧ Why are you here?", "⟦LEAVE⟧ Goodbye."]],
    ]);
    rt.dispose();
  });

  it("`choice` answers that menu wherever it sits; the older stays", async () => {
    const rt = freshRuntime();
    const { g, choices } = await twoMenus(rt);
    const heart = choices[1]!;
    const r = await post(rt, "/api/guest/choose", { token: g.token, index: 1, text: "⟦LEAVE⟧ Goodbye.", choice: heart.id });
    expect(r).toEqual({ status: 200, json: { ok: true } });
    expect(picked(rt, g.id)).toBe("bye");
    const left = (await state(rt, g.token)).json["choices"] as Choice[];
    expect(left.map((c) => c.id)).toEqual([choices[0]!.id]);
    rt.dispose();
  });

  it("a text that is not the option at that index is 409 `moved` with the menu's options", async () => {
    const rt = freshRuntime();
    const { g, choices } = await twoMenus(rt);
    const r = await post(rt, "/api/guest/choose", { token: g.token, index: 0, text: "⟦LEAVE⟧ Goodbye.", choice: choices[1]!.id });
    expect(r).toEqual({ status: 409, json: { error: "moved", options: ["⟦ASK⟧ Why are you here?", "⟦LEAVE⟧ Goodbye."] } });
    // Without `choice` the text is checked against the oldest menu.
    const old = await post(rt, "/api/guest/choose", { token: g.token, index: 0, text: "⟦ASK⟧ Why are you here?" });
    expect(old).toEqual({ status: 409, json: { error: "moved", options: ["Up the stairs.", "I don't know."] } });
    expect((rt.liveSim!.pendingChoicesFor(g.id)).length).toBe(2);
    rt.dispose();
  });

  it("an id that is not pending is 409 `no choice`", async () => {
    const rt = freshRuntime();
    const { g } = await twoMenus(rt);
    expect(await post(rt, "/api/guest/choose", { token: g.token, index: 0, choice: 123_456 })).toEqual({
      status: 409,
      json: { error: "no choice", options: null },
    });
    const other = await guest(rt, "Bea");
    expect(await post(rt, "/api/guest/choose", { token: other.token, index: 0, text: "Up the stairs." })).toEqual({
      status: 409,
      json: { error: "no choice", options: null },
    });
    rt.dispose();
  });

  it("an old client (index only) answers the oldest menu, as before", async () => {
    const rt = freshRuntime();
    const { g } = await twoMenus(rt);
    expect((await post(rt, "/api/guest/choose", { token: g.token, index: 0 })).status).toBe(200);
    expect(picked(rt, g.id)).toBe("stairs");
    rt.dispose();
  });

  it("a restore replays the id'd answer and keeps the ids and channels", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-choose-"));
    dirs.push(d);
    const rt = runtimeIn(d);
    const { g, choices } = await twoMenus(rt);
    await post(rt, "/api/guest/act", { token: g.token, name: "heart" }); // a third menu
    await post(rt, "/api/guest/choose", { token: g.token, index: 0, text: "⟦ASK⟧ Why are you here?", choice: choices[1]!.id });
    const live = (await state(rt, g.token)).json["choices"] as Choice[];
    rt.dispose();
    const again = runtimeIn(d);
    expect(again.restore()).not.toBeNull();
    expect(picked(again, g.id)).toBe("why");
    const back = (await state(again, g.token)).json["choices"] as Choice[];
    expect(back).toEqual(live);
    expect(back.map((c) => c.channel)).toEqual(["dm:Clippy", "dm:Trabolta"]);
    again.dispose();
  });
});
