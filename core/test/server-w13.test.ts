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
    expect(isHostRoute("POST", "/api/mod/var", { path: "night.alerts", value: '"BSOD"' }, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/var", { path: "Night.alerts", value: "loud" }, ctx)).toBe(false);
    expect(isHostRoute("POST", "/api/mod/var", { path: "Night.step", value: "dialog" }, ctx)).toBe(false);
    expect(isHostRoute("POST", "/api/mod/say", { channel: "guest:g1", as: "Trabolta", text: "x" }, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/say", { channel: "dm:Trabolta", as: "Trabolta", text: "x" }, ctx)).toBe(false);
    expect(isHostRoute("POST", "/api/mod/say", { channel: "guest:g1", as: "Norton", text: "x" }, ctx)).toBe(false);
    expect(isHostRoute("POST", "/api/mod/act", { action: "restrict" }, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/act", { action: "capture" }, ctx)).toBe(false);
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
      ["/api/mod/start", {}],
      ["/api/mod/stop", {}],
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
      ["POST", "/api/mod/login", { passcode: "wrong" }],
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
    const texts = (st: typeof s) => (st.events("message") as Array<{ text: string; channel: string }>).map((m) => m.text);
    expect(texts(s)).toContain("are you there?");
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
