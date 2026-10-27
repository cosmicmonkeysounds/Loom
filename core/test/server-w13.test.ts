//! Wave 13 server surface (CONTRACTS §2.4–§2.7): the host capability (a
//! part marked `admin: true`), the host allowlist walked route by route,
//! `Booth · X` attribution, the host booth's stream, the PrimeView /
//! GuestView additions, `/api/prime/card` and the cards on `/api/scan` and
//! `/api/prime/act`, the `?host=1` read, the alert dial, and one push per
//! booth readout.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { EventRuntime, type EventRuntimeInit } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { PushSender } from "../server/push.ts";
import { NOT_FROM_A_BOOTH, isHostRoute, isModSurface } from "../server/routes/host.ts";

const CODES = { event: "EVT131", prime: "PRM131", mod: "MOD131" };

const STORY = `# Host Night
start: Opening
watch: program.cleared as Cleared, program.door_digits as Digits
countdown: Night.doors_at as Doors

ROLE Program
  cleared: bool = false
  marked: bool = false
  door_digits: 0 to 4 = 0
  secret: door_digits

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

LOCATION Hall

CHARACTER Task Manager
  faction: Hosts
  admin: true
  when greet for program:
    reply Hello {program.name}.

CHARACTER Clippy
  faction: Hosts
  when greet for program:
    reply Hi {program.name}.

CHARACTER Norton
  when scanned by program:
    reply Clean: {program.name}.
  when mark for program:
    set program.marked = true
    reply Marked {program.name}.
  when alarm_tripped:
    reply !Server room breach.

CHARACTER McAfee
  when scanned by program:
    reply Scanned.

CHARACTER Trabolta
  mind: external
  hold: One moment.

INTERACTION mark
  who: performer
  while: program.marked != true

INTERACTION greet
  who: performer

INTERACTION open the doors
  who: admin
  act: A · Doors

OBJECTIVE Show Pass
  for: Program
  title: Show your pass
  text:
    Hold it up.
    - Cleared, done when program.cleared == true
  buttons: pass

OBJECTIVE Watch The Door
  for: performers
  title: Watch the door
  buttons: scan, mark

== Opening
  setting: Hall
Hello.
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function freshRuntime(extra: Partial<EventRuntimeInit> = {}, dir?: string): EventRuntime {
  const d = dir ?? mkdtempSync(join(tmpdir(), "loom-w13-"));
  if (dir === undefined) dirs.push(d);
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "host", scenarioSource: STORY, joinBase: () => "http://localhost", ...extra });
}

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
function fakeRes() {
  const res = {
    statusCode: 0,
    body: "",
    headers: {} as Record<string, string>,
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
    write() {
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res;
}
type Reply = { status: number; json: Record<string, unknown> };
async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: Record<string, unknown> = {}, opts: { moderator?: boolean; moderatorName?: string } = {}): Promise<Reply> {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body), res as unknown as ServerResponse, method, url.pathname, url, opts);
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}");
  } catch {
    json = { raw: res.body };
  }
  return { status: res.statusCode, json };
}
const post = (rt: EventRuntime, path: string, body: Record<string, unknown> = {}, moderator = false) => call(rt, "POST", path, body, { moderator });
const get = (rt: EventRuntime, path: string, moderator = false) => call(rt, "GET", path, {}, { moderator });
const mod = (rt: EventRuntime, path: string, body: Record<string, unknown> = {}) => post(rt, path, body, true);

async function register(rt: EventRuntime, name: string): Promise<{ id: string; token: string }> {
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event });
  expect(r.status).toBe(200);
  return { id: r.json.id as string, token: r.json.token as string };
}
async function boothLogin(rt: EventRuntime, character: string, token?: string): Promise<Reply> {
  return post(rt, "/api/prime/login", { character, passcode: CODES.prime, ...(token !== undefined ? { token } : {}) });
}
async function hostToken(rt: EventRuntime): Promise<string> {
  const r = await boothLogin(rt, "Task Manager");
  expect(r.json).toMatchObject({ character: "Task Manager", admin: false, host: true });
  return r.json.token as string;
}

/** A booth's SSE stream, parsed. */
function primeStream(rt: EventRuntime, token: string) {
  const chunks: string[] = [];
  const stream = { writeHead: () => stream, write: (c: unknown) => chunks.push(String(c)) > 0, end: () => stream } as unknown as ServerResponse;
  const open = rt.handle(fakeReq(null), stream, "GET", "/events", new URL(`http://x/events?role=prime&token=${encodeURIComponent(token)}`), {});
  const events = (type: string): unknown[] =>
    chunks
      .join("")
      .split("\n\n")
      .filter((f) => f.startsWith(`event: ${type}\n`))
      .map((f) => JSON.parse(f.slice(f.indexOf("data: ") + 6)));
  return { open, events };
}

describe("the host capability (D1, §2.5)", () => {
  it("a part marked admin: true makes its booth a host; a switch takes it away; passcode admin is kept", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const token = await hostToken(rt);
    expect((await get(rt, `/api/state?role=mod&host=1&token=${token}`)).status).toBe(200);
    // Same token into a part without admin: true → host revoked.
    expect((await boothLogin(rt, "Norton", token)).json).toMatchObject({ character: "Norton", admin: false, host: false });
    expect((await get(rt, `/api/state?role=mod&host=1&token=${token}`)).status).toBe(403);
    // Clippy is a Host by faction but not an admin part.
    expect((await boothLogin(rt, "Clippy")).json).toMatchObject({ host: false });
    // A passcode admin who then takes a plain part keeps admin (host = canHost).
    const admin = (await post(rt, "/api/mod/login", { passcode: CODES.mod })).json.token as string;
    expect((await boothLogin(rt, "McAfee", admin)).json).toMatchObject({ character: "McAfee", admin: true, host: true });
  });

  it("host survives a restart of the process (sessions persisted)", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-w13-"));
    dirs.push(d);
    const rt = freshRuntime({}, d);
    rt.openDoors();
    const token = await hostToken(rt);
    const rt2 = freshRuntime({}, d);
    rt2.restore();
    rt2.openDoors();
    expect((await get(rt2, `/api/state?role=mod&host=1&token=${token}`)).status).toBe(200);
  });

  it("Release, Logout and Go live of a host part each leave no admin or host token behind", async () => {
    for (const how of ["release", "logout", "golive"] as const) {
      const rt = freshRuntime();
      rt.openDoors();
      const token = await hostToken(rt);
      if (how === "release") expect((await mod(rt, "/api/mod/prime/release", { character: "Task Manager" })).status).toBe(200);
      if (how === "logout") expect((await post(rt, "/api/prime/logout", { token })).status).toBe(200);
      if (how === "golive") rt.restart(undefined, undefined, { kind: "golive" });
      expect((await get(rt, `/api/state?role=mod&host=1&token=${token}`)).status, how).toBe(403);
      expect((await get(rt, `/api/state?role=mod&token=${token}`)).status, how).toBe(403);
      expect((await get(rt, `/api/state?role=prime&token=${token}`)).status, how).toBe(403);
    }
  });
});

describe("the host allowlist (§2.7)", () => {
  const ctx = { alertsPath: "Night.alerts", isAgent: (c: string) => c === "Trabolta" };

  it("the pure table: var / say / act limits", () => {
    expect(isHostRoute("POST", "/api/mod/var", { path: "Night.alerts", value: "dialog" }, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/var", { path: " Night.alerts ", value: '"BSOD"' }, ctx)).toBe(true);
    // A folded spelling would write a junk var (the write keeps the spelling): refused.
    expect(isHostRoute("POST", "/api/mod/var", { path: "night.ALERTS", value: "bsod" }, ctx)).toBe(false);
    expect(isHostRoute("POST", "/api/mod/var", { path: "Night.alerts", value: "loud" }, ctx)).toBe(false);
    expect(isHostRoute("POST", "/api/mod/var", { path: "Night.step", value: "dialog" }, ctx)).toBe(false);
    expect(isHostRoute("POST", "/api/mod/say", { channel: "guest:g1", as: "Trabolta", text: "x" }, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/say", { channel: "dm:Trabolta", as: "Trabolta", text: "x" }, ctx)).toBe(false);
    expect(isHostRoute("POST", "/api/mod/say", { channel: "guest:g1", as: "Norton", text: "x" }, ctx)).toBe(false);
    expect(isHostRoute("POST", "/api/mod/act", { action: "restrict" }, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/act", { action: "capture" }, ctx)).toBe(false);
    // Wave 32 (C3): the talk panel (its own 409s gate it to a talk scene).
    expect(isHostRoute("POST", "/api/mod/talk", { as: "Clippy", text: "x" }, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/talk", { as: "Trabolta", text: "x" }, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/agent/talk", { as: "Clippy", text: "x" }, ctx)).toBe(false);
    expect(isHostRoute("GET", "/api/state", { role: "mod", host: "1" }, ctx)).toBe(true);
    expect(isHostRoute("GET", "/api/state", { role: "mod", host: "1", cues: "1" }, ctx)).toBe(false);
    expect(isModSurface("GET", "/api/state", { role: "prime" })).toBe(false);
    expect(isModSurface("GET", "/api/state", { role: "guest", as: "g1" })).toBe(true);
  });

  it("walks every moderator route with a host token: the listed ones work, every other one says not from a booth", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await register(rt, "Winamp");
    const token = await hostToken(rt);
    const q = (path: string) => `${path}${path.includes("?") ? "&" : "?"}token=${token}`;
    const refusedGet = [
      "/events?role=mod",
      "/api/state?role=mod",
      "/api/state?role=mod&cues=1",
      `/api/state?role=guest&as=${g.id}`,
      "/api/state?role=prime&as=Norton",
      "/api/mod/log",
      "/api/mod/metrics",
      "/api/mod/agent/trace",
      `/api/history?id=${g.id}`,
      "/api/mod/tts",
      "/api/mod/screen/terminals",
      "/api/mod/spatial/stations",
      "/api/agent/stream",
      "/api/agent/facts",
    ];
    for (const path of refusedGet) {
      const r = await get(rt, q(path));
      expect([path, r.status, r.json.error]).toEqual([path, 403, NOT_FROM_A_BOOTH]);
    }
    const refusedPost: Array<[string, Record<string, unknown>]> = [
      ["/api/mod/set", { id: g.id, field: "score", value: 5 }],
      ["/api/mod/load", {}],
      ["/api/mod/reset", {}],
      ["/api/mod/var", { path: "Night.step", value: "3" }],
      ["/api/mod/var", { path: "Night.alerts", value: "loud" }],
      ["/api/mod/say", { channel: "dm:Trabolta", as: "Trabolta", text: "hi" }],
      ["/api/mod/say", { channel: `guest:${g.id}`, as: "Norton", text: "hi" }],
      ["/api/mod/say", { channel: "lobby", text: "hi" }],
      ["/api/mod/act", { id: g.id, action: "capture" }],
      ["/api/mod/impersonate", { role: "guest", id: g.id }],
      ["/api/mod/persona", { name: "Puppet" }],
      ["/api/mod/agent/control", { action: "reset", character: "Trabolta" }],
      ["/api/mod/beat", { name: "Opening" }],
      ["/api/mod/reveal", { target: "Hall" }],
      ["/api/mod/choose", { person: g.id, index: 0 }],
      ["/api/mod/message", { seq: 0, hidden: true }],
      ["/api/mod/codex", { who: g.id, entry: "x" }],
      ["/api/mod/quest", { who: g.id, quest: "x", action: "start" }],
      ["/api/mod/wallet/cancel", { id: "t1" }],
      ["/api/mod/wallet/grant", { to: g.id, amount: 1 }],
      ["/api/mod/wallet/freeze", { target: g.id }],
      ["/api/mod/spatial/house", {}],
      ["/api/mod/spatial/begin", {}],
      ["/api/mod/spatial/house/project", {}],
      ["/api/mod/resync", {}],
      ["/api/mod/tts", { text: "x" }],
      ["/api/agent/reply", { id: "r1" }],
      ["/api/agent/judge", { id: "j1" }],
      ["/api/agent/trace", {}],
      ["/api/agent/mind", {}],
    ];
    for (const [path, body] of refusedPost) {
      const r = await post(rt, path, { ...body, token });
      expect([path, r.status, r.json.error]).toEqual([path, 403, NOT_FROM_A_BOOTH]);
    }
    const allowed: Array<["GET" | "POST", string, Record<string, unknown>]> = [
      ["GET", q("/api/state?role=mod&host=1"), {}],
      ["GET", q("/api/mod/recap"), {}],
      ["POST", "/api/mod/signal", { name: "open the doors" }],
      ["POST", "/api/mod/var", { path: "Night.alerts", value: "dialog" }],
      ["POST", "/api/mod/broadcast", { scope: "everyone", cue: '"Doors in five."' }],
      ["POST", "/api/mod/say", { channel: `guest:${g.id}`, as: "Trabolta", text: "One moment." }],
      ["POST", "/api/mod/wallet/approve", { id: "t1" }],
      ["POST", "/api/mod/wallet/deny", { id: "t1" }],
      ["POST", "/api/mod/wallet/approve-held", {}],
      ["POST", "/api/mod/wallet/unfreeze", { target: g.id }],
      ["POST", "/api/mod/wallet/stimulus", { amount: 1 }],
      ["POST", "/api/mod/spatial/king", { hp: 3 }],
      ["POST", "/api/mod/screen/voice", { muted: true }],
      ["POST", "/api/mod/screen/identify", { name: "Kitchen" }],
      ["POST", "/api/mod/codes", {}],
      ["POST", "/api/mod/claim/unlock", { character: "Nobody" }],
      ["POST", "/api/mod/guest/gone", { id: g.id, gone: true }],
      ["POST", "/api/mod/guest/pair", { id: g.id }],
      ["POST", "/api/mod/act", { id: g.id, action: "restrict" }],
      ["POST", "/api/mod/act", { id: g.id, action: "unrestrict" }],
      ["POST", "/api/mod/scan", { target: g.id, as: "Norton" }],
      ["POST", "/api/mod/clock", { time: "7:00 PM" }],
      ["POST", "/api/mod/login", { passcode: "wrong" }],
      ["POST", "/api/mod/talk", { as: "Clippy", text: "Hello?" }],
    ];
    for (const [method, path, body] of allowed) {
      const r = method === "GET" ? await get(rt, path) : await post(rt, path, { ...body, token });
      expect([path, r.json.error === NOT_FROM_A_BOOTH || r.json.error === "moderators only"]).toEqual([path, false]);
    }
    // …and the part's own Release last (it ends the host's own session).
    const rel = await post(rt, "/api/mod/prime/release", { character: "Norton", token });
    expect(rel.json.error).toBeUndefined();
  });

  it("a host's /api/mod/var journals Booth · Task Manager; codes leave out modPass", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-w13-"));
    dirs.push(d);
    const store = new Store(d);
    const rt = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "host", scenarioSource: STORY, joinBase: () => "http://localhost" });
    rt.openDoors();
    const token = await hostToken(rt);
    expect((await post(rt, "/api/mod/var", { path: "Night.alerts", value: "dialog", token })).status).toBe(200);
    const line = store.readJournal().find((l) => l.m === "setVar");
    expect(line?.by).toBe("Booth · Task Manager");
    const codes = await post(rt, "/api/mod/codes", { token });
    expect(codes.status).toBe(200);
    expect(codes.json).toMatchObject({ eventPass: CODES.event, primePass: CODES.prime });
    expect("modPass" in codes.json).toBe(false);
    expect((await mod(rt, "/api/mod/codes")).json.modPass).toBe(CODES.mod);
  });
});

describe("the alert dial + ModView.alerts", () => {
  it("a bare level written through /api/mod/var reads back on every view", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await register(rt, "Winamp");
    expect((await mod(rt, "/api/mod/var", { path: "Night.alerts", value: "dialog" })).status).toBe(200);
    expect((await get(rt, "/api/state?role=mod", true)).json.alerts).toEqual({ path: "Night.alerts", level: "dialog" });
    expect((await get(rt, `/api/state?role=guest&token=${g.token}`)).json.alertLevel).toBe("dialog");
    const host = await hostToken(rt);
    expect((await get(rt, `/api/state?role=mod&host=1&token=${host}`)).json.alerts).toEqual({ path: "Night.alerts", level: "dialog" });
  });

  it("a host's dial takes only the exact alerts path: a folded spelling is refused, never a 200 that changes nothing", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await register(rt, "Winamp");
    const host = await hostToken(rt);
    expect((await post(rt, "/api/mod/var", { token: host, path: "night.ALERTS", value: "bsod" })).status).toBe(403);
    expect((await get(rt, `/api/state?role=guest&token=${g.token}`)).json.alertLevel).toBe("sticky");
    expect((await post(rt, "/api/mod/var", { token: host, path: "Night.alerts", value: "bsod" })).status).toBe(200);
    expect((await get(rt, `/api/state?role=guest&token=${g.token}`)).json.alertLevel).toBe("bsod");
  });
});

describe("views on the wire", () => {
  it("PrimeView: no admin cues; objectives, night, alertLevel, staffRooms (authored ids), countdowns; flags with a false boolean, the secret slot dropped", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await register(rt, "Winamp");
    await mod(rt, "/api/mod/var", { path: "Night.doors_at", value: "999999" });
    const booth = (await boothLogin(rt, "Norton")).json.token as string;
    const p = (await get(rt, `/api/state?role=prime&token=${booth}`)).json as Record<string, unknown> & { interactions: Array<{ id: string; who: string }>; guests: Array<{ id: string; flags?: unknown }> };
    expect(p.interactions.map((i) => i.who)).not.toContain("admin");
    expect((p.objectives as Array<{ id: string; buttons: string[] }>).map((o) => [o.id, o.buttons])).toEqual([["Watch The Door", ["scan", "mark"]]]);
    expect(p.night).toEqual({ act: { code: "A", title: "Doors" }, phase: null, step: null });
    expect(p.alertLevel).toBe("sticky");
    expect(p.staffRooms).toEqual(["room:hosts"]);
    expect((p.countdowns as Array<{ label: string }>).map((c) => c.label)).toEqual(["Doors"]);
    expect(p.guests.find((x) => x.id === g.id)!.flags).toEqual([{ label: "Cleared", path: "Program.cleared", value: "false", on: false }]);
  });

  it("GuestView: objectives, night, voiced", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await register(rt, "Winamp");
    const v = (await get(rt, `/api/state?role=guest&token=${g.token}`)).json;
    expect((v.objectives as Array<{ id: string; checklist: unknown }>).map((o) => [o.id, o.checklist])).toEqual([["Show Pass", [{ label: "Cleared", done: false }]]]);
    expect(v.night).toBeDefined();
    expect(v.voiced).toEqual(["Task Manager", "Clippy", "Norton", "McAfee", "Trabolta"]);
  });

  it("GuestView.voiced keeps a hidden character off until the story reveals it to that guest", async () => {
    const hidden = STORY.replace("CHARACTER Trabolta\n  mind: external\n", "CHARACTER Trabolta\n  mind: external\n  hidden: true\n").replace(
      "== Opening",
      "when wake for program:\n  reveal Trabolta for program\n\n== Opening",
    );
    const rt = freshRuntime({ scenarioSource: hidden });
    rt.openDoors();
    const a = await register(rt, "Winamp");
    const b = await register(rt, "Napster");
    const voiced = async (t: string) => (await get(rt, `/api/state?role=guest&token=${t}`)).json.voiced as string[];
    expect(await voiced(a.token)).toEqual(["Task Manager", "Clippy", "Norton", "McAfee"]);
    expect((await mod(rt, "/api/mod/signal", { name: "wake", subject: a.id })).status).toBe(200);
    expect(await voiced(a.token)).toEqual(["Task Manager", "Clippy", "Norton", "McAfee", "Trabolta"]);
    expect(await voiced(b.token)).not.toContain("Trabolta");
  });

  it("objectives never ride an agent request", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await register(rt, "Winamp");
    expect((await post(rt, "/api/guest/say", { token: g.token, channel: "dm:Trabolta", text: "hello?" })).status).toBe(200);
    const pending = (rt as unknown as { agents: { pending: unknown[] } }).agents.pending;
    expect(pending.length).toBe(1);
    const wire = JSON.stringify(pending);
    expect(wire).not.toContain("Show your pass");
    expect(wire).not.toContain("Watch the door");
  });
});

describe("the booth's scan card", () => {
  it("/api/prime/card: live buttons, guestScoped, readouts; 403 / 409 / 404", async () => {
    const rt = freshRuntime();
    const closedBooth = (await boothLogin(rt, "Norton")).json.token as string;
    expect((await post(rt, "/api/prime/card", { token: closedBooth, guest: "x" })).status).toBe(409);
    rt.openDoors();
    const g = await register(rt, "Winamp");
    expect((await post(rt, "/api/prime/card", { token: g.token, guest: g.id })).status).toBe(403);
    expect((await post(rt, "/api/prime/card", { token: closedBooth, guest: "nobody" })).status).toBe(404);
    const scan = await post(rt, "/api/scan", { token: closedBooth, target: g.id });
    expect(scan.status).toBe(200);
    expect(scan.json.responses).toEqual(["Clean: Winamp."]);
    expect(scan.json.card).toMatchObject({ live: ["mark", "greet"], guestScoped: ["mark"], readouts: [{ text: "Clean: Winamp." }] });
    const card = await post(rt, "/api/prime/card", { token: closedBooth, guest: g.id });
    expect(card.json).toMatchObject({ guest: { id: g.id, name: "Winamp" }, live: ["mark", "greet"], guestScoped: ["mark"] });
  });

  it("/api/prime/act answers with this press's replies and the fresh card; a headless admin gets no card", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await register(rt, "Winamp");
    const booth = (await boothLogin(rt, "Norton")).json.token as string;
    const act = await post(rt, "/api/prime/act", { token: booth, name: "mark", guest: g.id });
    expect(act.status).toBe(200);
    expect(act.json.replies).toEqual(["Marked Winamp."]);
    expect((act.json.card as { live: string[] }).live).toEqual(["greet"]);
    const admin = (await post(rt, "/api/mod/login", { passcode: CODES.mod })).json.token as string;
    const headless = await post(rt, "/api/prime/act", { token: admin, name: "greet", guest: g.id });
    expect(headless.status).toBe(200);
    expect(headless.json.replies).toEqual([]);
    expect("card" in headless.json).toBe(false);
  });
});

describe("a host booth presses what its card offers", () => {
  const PATCH = STORY.replace("== Opening", "INTERACTION patch\n  who: performer\n  by: Norton\n\n== Opening");
  it("another character's by: button is on the host's card and its press lands; a plain booth's is refused", async () => {
    const rt = freshRuntime({ scenarioSource: PATCH });
    rt.openDoors();
    const g = await register(rt, "Winamp");
    const host = await hostToken(rt);
    const card = await post(rt, "/api/prime/card", { token: host, guest: g.id });
    expect(card.json.live).toContain("patch");
    const press = await post(rt, "/api/prime/act", { token: host, name: "patch", guest: g.id });
    expect(press.status).toBe(200);
    expect((press.json.card as { live: string[] }).live).toContain("patch");
    // Clippy (a Host by faction, not an admin part) never sees it, and its press is refused.
    const clippy = (await boothLogin(rt, "Clippy")).json.token as string;
    expect((await post(rt, "/api/prime/card", { token: clippy, guest: g.id })).json.live).not.toContain("patch");
    const refused = await post(rt, "/api/prime/act", { token: clippy, name: "patch", guest: g.id });
    expect(refused.status).toBe(403);
    expect(refused.json.error).toMatch(/not your button/u);
    // who: admin still needs the moderator capability, host or not.
    expect((await post(rt, "/api/prime/act", { token: host, name: "open the doors", guest: g.id })).status).toBe(404);
  });
});

describe("the host booth's stream and ?host=1", () => {
  it("a host booth sees a guest's dm:Trabolta, never a pm: thread or another booth's Inbox", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const a = await register(rt, "Winamp");
    const b = await register(rt, "Napster");
    const host = await hostToken(rt);
    const s = primeStream(rt, host);
    await s.open;
    const plain = primeStream(rt, (await boothLogin(rt, "Clippy")).json.token as string);
    await plain.open;
    expect((await post(rt, "/api/guest/say", { token: a.token, channel: "dm:Trabolta", text: "are you there?" })).status).toBe(200);
    const pm = [a.id, b.id].sort().join(":");
    await post(rt, "/api/guest/say", { token: a.token, channel: `pm:${pm}`, text: "psst" });
    const nortonBooth = (await boothLogin(rt, "Norton")).json.token as string;
    await post(rt, "/api/scan", { token: nortonBooth, target: a.id });
    // Norton's private line to Trabolta (stored as dm:Trabolta, audience @Norton) stays Norton's.
    expect((await post(rt, "/api/prime/say", { token: nortonBooth, channel: "cast:Trabolta", text: "psst — private to Trabolta" })).status).toBe(200);
    // The host's own cast line still reaches the host.
    expect((await post(rt, "/api/prime/say", { token: host, channel: "cast:Trabolta", text: "host to Trabolta" })).status).toBe(200);
    const texts = (st: typeof s) => (st.events("message") as Array<{ text: string; channel: string }>).map((m) => m.text);
    expect(texts(s)).toContain("are you there?");
    expect(texts(s)).not.toContain("psst — private to Trabolta");
    expect(texts(s)).toContain("host to Trabolta");
    expect(texts(s)).not.toContain("psst");
    expect(texts(s)).not.toContain("Clean: Winamp.");
    expect(texts(plain)).not.toContain("are you there?");
  });

  it("?host=1: the cue sheet, needs, parts, people with flags, agents with the guests waiting, staff rooms", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await register(rt, "Winamp");
    await post(rt, "/api/guest/say", { token: g.token, channel: "dm:Trabolta", text: "hello?" });
    const host = await hostToken(rt);
    const r = await call(rt, "GET", `/api/state?role=mod&host=1&token=${host}`);
    expect(r.status).toBe(200);
    const v = r.json as Record<string, unknown> & { interactions: Array<{ id: string }>; agents: Array<{ id: string; waiting: Array<{ guest: string; text: string }> }>; people: Array<{ id: string; flags?: unknown }>; parts: Array<{ id: string }> };
    expect(v.interactions.map((i) => i.id)).toEqual(["open the doors"]);
    expect(v.runtime).toBe("open");
    expect(v.staffRooms).toEqual(["room:hosts"]);
    expect(v.agents).toEqual([expect.objectContaining({ id: "Trabolta", online: false, waiting: [expect.objectContaining({ guest: g.id, text: "hello?" })] })]);
    expect(v.people.find((p) => p.id === g.id)!.flags).toEqual([{ label: "Cleared", path: "Program.cleared", value: "false", on: false }]);
    expect(v.parts.map((p) => p.id)).toEqual(["Task Manager", "Clippy", "Norton", "McAfee"]);
    expect((v.needs as Array<{ kind: string }>).map((n) => n.kind)).toContain("no-worker");
    // The LAN fallback facts.json judges here: nothing filed yet.
    expect(v.judging).toMatchObject({ mode: "auto", pending: [], near: 0, recent: [] });
    expect(v.alerts).toEqual({ path: "Night.alerts", level: "sticky" });
    // A plain booth may not read it.
    const plain = (await boothLogin(rt, "Clippy")).json.token as string;
    expect((await get(rt, `/api/state?role=mod&host=1&token=${plain}`)).status).toBe(403);
    // The author session may.
    expect((await get(rt, "/api/state?role=mod&host=1", true)).status).toBe(200);
  });
});

describe("one push per booth readout", () => {
  function fakeSender(): PushSender & { sent: Array<{ endpoint: string; kind: string }> } {
    const sent: Array<{ endpoint: string; kind: string }> = [];
    return {
      publicKey: "BPUBLIC",
      sent,
      async send(s, payload) {
        sent.push({ endpoint: s.endpoint, kind: (JSON.parse(payload) as { kind: string }).kind });
        return 201;
      },
    };
  }
  it("a reply !… to a booth (now a dm: alert row) pushes the readout once, no extra alert", async () => {
    const sender = fakeSender();
    const rt = freshRuntime({ push: sender });
    rt.openDoors();
    const booth = (await boothLogin(rt, "Norton")).json.token as string;
    const endpoint = "https://fcm.googleapis.com/fcm/send/dev-9";
    expect((await post(rt, "/api/push/subscribe", { token: booth, subscription: { endpoint, keys: { p256dh: "p", auth: "a" } } })).status).toBe(200);
    await post(rt, "/api/push/visible", { token: booth, endpoint, hidden: true });
    expect((await mod(rt, "/api/mod/signal", { name: "alarm_tripped" })).status).toBe(200);
    await rt.push.settle();
    expect(sender.sent.map((s) => s.kind)).toEqual(["readout"]);
  });
});

describe("a reply !… reads the same everywhere a booth sees it", () => {
  const LOUD = STORY.replace("reply Hi {program.name}.", "reply !Hi {program.name}.").replace("reply Scanned.", "reply !Scanned.");
  it("the act / scan replies, the response frame and the push body drop the !, as the Inbox row does", async () => {
    const bodies: string[] = [];
    const sender: PushSender = {
      publicKey: "BPUBLIC",
      async send(_s, payload) {
        bodies.push((JSON.parse(payload) as { body: string }).body);
        return 201;
      },
    };
    const rt = freshRuntime({ scenarioSource: LOUD, push: sender });
    rt.openDoors();
    const g = await register(rt, "Winamp");
    const clippy = (await boothLogin(rt, "Clippy")).json.token as string;
    const act = await post(rt, "/api/prime/act", { token: clippy, name: "greet", guest: g.id });
    expect(act.json.replies).toEqual(["Hi Winamp."]);
    const mcafee = (await boothLogin(rt, "McAfee")).json.token as string;
    expect((await post(rt, "/api/scan", { token: mcafee, target: g.id })).json.responses).toEqual(["Scanned."]);
    expect((await mod(rt, "/api/mod/scan", { as: "McAfee", target: g.id })).json.responses).toEqual(["Scanned."]);
    const norton = (await boothLogin(rt, "Norton")).json.token as string;
    const s = primeStream(rt, norton);
    await s.open;
    const endpoint = "https://fcm.googleapis.com/fcm/send/dev-10";
    expect((await post(rt, "/api/push/subscribe", { token: norton, subscription: { endpoint, keys: { p256dh: "p", auth: "a" } } })).status).toBe(200);
    await post(rt, "/api/push/visible", { token: norton, endpoint, hidden: true });
    await mod(rt, "/api/mod/signal", { name: "alarm_tripped" });
    await rt.push.settle();
    expect(s.events("response")).toEqual([{ text: "Server room breach.", alert: true }]);
    expect(bodies).toEqual(["Server room breach."]);
  });
});

describe("PrimeView.paused and PrimeView.host (integration)", () => {
  it("a booth's view says paused while the story clock is stopped, as a guest's does", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await register(rt, "Winamp");
    const booth = (await boothLogin(rt, "Norton")).json.token as string;
    const prime = async () => (await get(rt, `/api/state?role=prime&token=${booth}`)).json;
    const guest = async () => (await get(rt, `/api/state?role=guest&token=${g.token}`)).json;
    expect("paused" in (await prime())).toBe(false);
    expect("paused" in (await guest())).toBe(false);
    rt.pause();
    expect((await prime()).paused).toBe(true);
    expect((await guest()).paused).toBe(true);
    // The live stream's snapshot carries it too.
    const s = primeStream(rt, booth);
    await s.open;
    const snap = s.events("snapshot").at(-1) as Record<string, unknown>;
    expect(snap.paused).toBe(true);
    rt.openDoors();
    expect("paused" in (await prime())).toBe(false);
  });

  const PATCHED = STORY.replace("== Opening", "INTERACTION patch\n  who: performer\n  by: Norton\n\n== Opening").replace("buttons: scan, mark", "buttons: scan, mark, patch");
  it("a host part's booth says host; the editor's lens (?as=) of it is exact, a plain part's says host: false", async () => {
    const rt = freshRuntime({ scenarioSource: PATCHED });
    rt.openDoors();
    const host = await hostToken(rt);
    const own = (await get(rt, `/api/state?role=prime&token=${host}`)).json as { host?: boolean; objectives: Array<{ id: string; buttons: string[] }> };
    expect(own.host).toBe(true);
    expect(own.objectives.find((o) => o.id === "Watch The Door")!.buttons).toContain("patch");
    const lens = (await get(rt, `/api/state?role=prime&as=${encodeURIComponent("Task Manager")}`, true)).json as typeof own;
    expect(lens.host).toBe(true);
    expect(lens.objectives).toEqual(own.objectives);
    // Clippy (a Host by faction, not an admin part): no host, no other character's button.
    const clippy = (await get(rt, "/api/state?role=prime&as=Clippy", true)).json as typeof own;
    expect(clippy.host).toBe(false); // said, never left out (C4: a lost host reaches the booth)
    expect(clippy.objectives.find((o) => o.id === "Watch The Door")!.buttons).not.toContain("patch");
    const plain = (await boothLogin(rt, "Clippy")).json.token as string;
    expect((await get(rt, `/api/state?role=prime&token=${plain}`)).json.host).toBe(false);
  });
});

describe("who pressed LAST (CueState.lastName)", () => {
  it("names the host part, the author, or nobody for the story; a restart names the same", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-w13-"));
    dirs.push(d);
    const rt = freshRuntime({}, d);
    rt.openDoors();
    const host = await hostToken(rt);
    const cues = async (r: EventRuntime) => ((await get(r, "/api/state?role=mod&host=1", true)).json as { cues: Record<string, unknown> }).cues;
    expect("lastName" in (await cues(rt))).toBe(false);
    expect((await post(rt, "/api/mod/signal", { token: host, name: "open the doors" })).status).toBe(200);
    expect(await cues(rt)).toMatchObject({ last: "open the doors", lastBy: "director", lastName: "Task Manager" });
    // An author's press: the host panel reads "Director" (2026-10-24: no
    // booth reads a director's name); the plain mod view names the author.
    expect((await call(rt, "POST", "/api/mod/signal", { name: "open the doors" }, { moderator: true, moderatorName: "Ada" })).status).toBe(200);
    expect(await cues(rt)).toMatchObject({ lastBy: "director", lastName: "Director" });
    const modCues = async (r: EventRuntime) => ((await get(r, "/api/state?role=mod", true)).json as { cues: Record<string, unknown> }).cues;
    expect((await modCues(rt)).lastName).toBe("Ada");
    const rt2 = freshRuntime({}, d);
    rt2.restore();
    expect(await cues(rt2)).toMatchObject({ last: "open the doors", lastBy: "director", lastName: "Director" });
    expect((await modCues(rt2)).lastName).toBe("Ada");
  });

  it("pressedByName strips the booth and agent prefixes; a story fire carries no name", async () => {
    const { pressedByName, cueState } = await import("../server/views.ts");
    expect(pressedByName("Booth · Task Manager")).toBe("Task Manager");
    expect(pressedByName("agent:Trabolta")).toBe("Trabolta");
    expect(pressedByName("Terminal · Server Door")).toBe("Terminal · Server Door");
    const AUTO = STORY.replace("== Opening\n  setting: Hall\nHello.\n", "INTERACTION auto_doors\n  who: admin\n\n== Opening\n  setting: Hall\nHello.\nfire auto_doors\n");
    const rt = freshRuntime({ scenarioSource: AUTO });
    rt.openDoors();
    const state = cueState((rt as unknown as { sim: import("../src/runtime/sim/index.ts").Sim }).sim);
    expect(state).toMatchObject({ last: "auto_doors", lastBy: "story" });
    expect("lastName" in state).toBe(false);
  });
});
