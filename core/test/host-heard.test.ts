//! A host's press of another character's `by:` button (wave 13 fhostby).
//! A booth's press fires as its own character, so only that character's
//! hooks hear it, plus every story-level rule and ROLE hook. A host part
//! (`admin: true`) may press another character's `by:` button, but only one
//! something outside its actors hears: a button heard only by hooks its
//! actors own (theirs, or a trait's merged onto them) is left off a host's
//! card and booth list, flagged `hostHeard: false`, and `/api/prime/act`
//! refuses it with the same *not your button* as any other booth.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { actorHeardOnly, byRefusal, guestCardView, modView, pressRefusal, primeView } from "../server/views.ts";

const SRC = `# Heard
start: Opening

ROLE Program
  marked: bool = false
  watched: bool = false
  when roled:
    set self.watched = true

GROUP Antivirus
  joinable: false

GROUP Hosts
  joinable: false

TRAIT Enforcer
  when shield for program:
    set program.marked = true

CHARACTER Norton is Enforcer
  faction: Antivirus
  when own for program:
    set program.marked = true
  when both for program:
    set program.marked = true

CHARACTER McAfee is Enforcer
  faction: Antivirus

CHARACTER Task Manager
  faction: Hosts
  admin: true
  when hosted for program:
    set program.watched = true

CHARACTER Clippy
  faction: Hosts

INTERACTION own
  label: 🅾 Own
  who: performer
  by: Norton

INTERACTION shield
  label: 🛡 Shield
  who: performer
  by: Antivirus

INTERACTION ruled
  label: 📏 Ruled
  who: performer
  by: Norton

INTERACTION roled
  label: 🎭 Roled
  who: performer
  by: Norton

INTERACTION both
  label: 🅱 Both
  who: performer
  by: Norton

INTERACTION silent
  label: 🤫 Silent
  who: performer
  by: Norton

INTERACTION hosted
  label: 🏠 Hosted
  who: performer
  by: Norton

INTERACTION open
  label: 🚪 Open
  who: performer

when ruled:
  set Night.ruled = true

when both:
  set Night.both = true

== Opening
Hello.
`;

const ALL = ["own", "shield", "ruled", "roled", "both", "silent", "hosted", "open"];

function fresh(): Sim {
  const sim = Sim.fromSources(SRC);
  sim.createPerson("g1", "Ada");
  return sim;
}
const peek = (sim: Sim, p: string) => (sim.world.peek(p) as { value: unknown } | undefined)?.value;

describe("actorHeardOnly: per handler kind", () => {
  it("a button heard only by its actors' own hooks (theirs or a trait's) is in; a rule, a ROLE hook, no handler at all are out", () => {
    const sim = fresh();
    expect([...actorHeardOnly(sim)].sort()).toEqual(["hosted", "own", "shield"]);
    // Computed once per model.
    expect(actorHeardOnly(sim)).toBe(actorHeardOnly(sim));
  });

  it("pressRefusal: a host may press another's heard button, never an unheard one; its own hook's press is its own", () => {
    const sim = fresh();
    const def = (id: string) => sim.model.interactions.get(id)!;
    const host = (id: string) => pressRefusal(sim, def(id), "Task Manager", true);
    expect(host("ruled")).toBeNull();
    expect(host("roled")).toBeNull();
    expect(host("both")).toBeNull();
    expect(host("silent")).toBeNull();
    expect(host("hosted")).toBeNull(); // Task Manager owns a hook for it: one of its actors
    expect(host("open")).toBeNull();
    expect(host("own")).toBe("not your button: “🅾 Own” is for Norton");
    expect(host("shield")).toBe("not your button: “🛡 Shield” is for Antivirus");
    expect(host("own")).toBe(byRefusal(sim, def("own"), "Task Manager"));
    // A plain booth is refused every other character's by: button, heard or not.
    for (const id of ["own", "shield", "ruled", "roled", "both", "silent", "hosted"]) expect(pressRefusal(sim, def(id), "Clippy", false), id).not.toBeNull();
    // An actor presses its own.
    for (const id of ["own", "shield", "ruled", "both", "silent"]) expect(pressRefusal(sim, def(id), "Norton", false), id).toBeNull();
    expect(pressRefusal(sim, def("shield"), "McAfee", false)).toBeNull();
  });

  it("the press itself: only the actors' hooks hear a cross press of an unheard button; a rule and a ROLE hook hear anyone's", () => {
    const sim = fresh();
    sim.signal("shield", "g1", null, "Task Manager");
    expect(peek(sim, "g1.marked")).toBe(false);
    sim.signal("roled", "g1", null, "Task Manager");
    expect(peek(sim, "g1.watched")).toBe(true);
    sim.signal("ruled", "g1", null, "Task Manager");
    expect(peek(sim, "Night.ruled")).toBe(true);
    sim.signal("shield", "g1", null, "McAfee");
    expect(peek(sim, "g1.marked")).toBe(true);
  });
});

describe("the views follow it", () => {
  it("a host's card lists another character's heard by: buttons only; a plain booth's lists none of them", () => {
    const sim = fresh();
    expect(guestCardView(sim, [], "Task Manager", "g1", true)!.live).toEqual(["ruled", "roled", "both", "silent", "hosted", "open"]);
    expect(guestCardView(sim, [], "Clippy", "g1", false)!.live).toEqual(["open"]);
    // `by:` makes Norton an actor of 🏠 too (the press is his to make; whether
    // anything hears it is the story's business, as before).
    expect(guestCardView(sim, [], "Norton", "g1", false)!.live).toEqual(["own", "shield", "ruled", "roled", "both", "silent", "hosted", "open"]);
    expect(guestCardView(sim, [], "McAfee", "g1", true)!.live).toEqual(["shield", "ruled", "roled", "both", "silent", "open"]);
  });

  it("every view flags the unheard ones hostHeard: false (only on an `only` button)", () => {
    const sim = fresh();
    const flags = (list: ReturnType<typeof primeView>["interactions"] | undefined) =>
      Object.fromEntries((list ?? []).filter((i) => ALL.includes(i.id)).map((i) => [i.id, i.hostHeard ?? null]));
    const want = { own: false, shield: false, ruled: null, roled: null, both: null, silent: null, hosted: false, open: null };
    expect(flags(primeView(sim, "Task Manager", undefined, { host: true }).interactions)).toEqual(want);
    expect(flags(primeView(sim, "Clippy").interactions)).toEqual(want);
    expect(flags(modView(sim, "open", "x").interactions)).toEqual(want);
  });
});

// --- through the event runtime -------------------------------------------

const CODES = { event: "EVTHH1", prime: "PRMHH1", mod: "MODHH1" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function runtime(): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-host-heard-"));
  dirs.push(d);
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "heard", scenarioSource: SRC, joinBase: () => "http://localhost" });
}
async function post(rt: EventRuntime, path: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const buf = Buffer.from(JSON.stringify(body));
  const req = { headers: {}, [Symbol.asyncIterator]: async function* () { yield buf; }, on() {} } as unknown as IncomingMessage;
  const res = { statusCode: 0, body: "", writeHead(s: number) { res.statusCode = s; return res; }, setHeader() {}, write() { return true; }, end(b?: string) { if (typeof b === "string") res.body = b; return res; } };
  const url = new URL(`http://x${path}`);
  await rt.handle(req, res as unknown as ServerResponse, "POST", url.pathname, url, {});
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

describe("/api/prime/act", () => {
  it("refuses a host's press of an unheard button with the plain booth's 403; a heard one lands", async () => {
    const rt = runtime();
    rt.openDoors();
    const g = await post(rt, "/api/guest/register", { name: "Winamp", passcode: CODES.event });
    const guest = g.json["id"] as string;
    const login = await post(rt, "/api/prime/login", { character: "Task Manager", passcode: CODES.prime });
    expect(login.json["host"]).toBe(true);
    const host = login.json["token"] as string;
    const card = await post(rt, "/api/prime/card", { token: host, guest });
    expect(card.json["live"]).not.toContain("shield");
    expect(card.json["live"]).toContain("roled");
    const refused = await post(rt, "/api/prime/act", { token: host, name: "shield", guest });
    expect(refused.status).toBe(403);
    expect(refused.json["error"]).toBe("not your button: “🛡 Shield” is for Antivirus");
    expect(rt.liveSim!.world.peek(`${guest}.marked`)).toMatchObject({ value: false });
    const heard = await post(rt, "/api/prime/act", { token: host, name: "roled", guest });
    expect(heard.status).toBe(200);
    expect(rt.liveSim!.world.peek(`${guest}.watched`)).toMatchObject({ value: true });
    // The mod passcode in a booth is a host for this too: never offered a dead button.
    const modToken = (await post(rt, "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
    const admin = await post(rt, "/api/prime/login", { character: "McAfee", passcode: CODES.prime, token: modToken });
    expect(admin.json).toMatchObject({ character: "McAfee", admin: true, host: true });
    const adminToken = admin.json["token"] as string;
    expect((await post(rt, "/api/prime/act", { token: adminToken, name: "own", guest })).status).toBe(403);
    expect((await post(rt, "/api/prime/act", { token: adminToken, name: "ruled", guest })).status).toBe(200);
    // Norton, an actor, presses it.
    const norton = (await post(rt, "/api/prime/login", { character: "Norton", passcode: CODES.prime })).json["token"] as string;
    expect((await post(rt, "/api/prime/act", { token: norton, name: "shield", guest })).status).toBe(200);
    expect(rt.liveSim!.world.peek(`${guest}.marked`)).toMatchObject({ value: true });
  });
});
