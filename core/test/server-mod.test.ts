//! Integration tests for the run-panel mod routes on `EventRuntime.handle`.
//! Drives the runtime with fake req/res (like `registry.test.ts`) through the
//! author-session moderator path (`opts.moderator: true`), exercising the new
//! `/api/mod/{say,set,beat,scan}` glue end-to-end against a real scenario.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it, vi } from "vitest";

import { EventRuntime, snapshotMsFromEnv, type EventRuntimeInit } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { guestView, primeView } from "../server/views.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";

const SCENARIO = scenarioSource("escape-the-internet");
const CODES = { event: "EVT111", prime: "PRM111", mod: "MOD111" };

const dirs: string[] = [];
function freshRuntime(extra: Partial<EventRuntimeInit> = {}): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-mod-"));
  dirs.push(d);
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "escape-the-internet",
    scenarioSource: SCENARIO,
    joinBase: () => "http://localhost",
    ...extra,
  });
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface FakeRes {
  statusCode: number;
  body: string;
}
function fakeReq(body: unknown): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {
      /* no close event in these tests */
    },
  } as unknown as IncomingMessage;
}
function fakeRes(): ServerResponse & FakeRes {
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
  return res as unknown as ServerResponse & FakeRes;
}

async function post(rt: EventRuntime, path: string, body: unknown, moderator = true) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body), res, "POST", path, url, { moderator });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
// Reads (`/api/state?role=mod`, `/api/history`) are capability-gated now;
// these tests exercise them through the author-session moderator path.
async function get(rt: EventRuntime, path: string, moderator = true) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq({}), res, "GET", url.pathname, url, { moderator });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}

/** Open the doors and register a guest; returns their id. */
async function withGuest(rt: EventRuntime): Promise<string> {
  rt.openDoors();
  const r = await post(rt, "/api/guest/register", { name: "Alice", passcode: CODES.event }, false);
  return r.json.id as string;
}

describe("run-panel mod routes", () => {
  it("/api/mod/set edits a guest's score, faction, location, and captured", async () => {
    const rt = freshRuntime();
    const id = await withGuest(rt);

    const score = await post(rt, "/api/mod/set", { id, field: "score", value: 88 });
    expect(score.status).toBe(200);
    expect(score.json.guest.score).toBe(88);

    const faction = await post(rt, "/api/mod/set", { id, field: "faction", value: "Mods" });
    expect(faction.json.guest.faction).toBe("Mods");

    const loc = await post(rt, "/api/mod/set", { id, field: "location", value: "Servers" });
    expect(loc.json.guest.location).toBe("Servers");

    const cap = await post(rt, "/api/mod/set", { id, field: "captured", value: true });
    expect(cap.json.guest.captured).toBe(true);
    const free = await post(rt, "/api/mod/set", { id, field: "captured", value: false });
    expect(free.json.guest.captured).toBe(false);
  });

  it("a director's Release is a real story release: `when released:` runs, and it replays (W6 B3)", async () => {
    const SRC = `# Release
start: Boot

LOCATION Hall

LOCATION Jail
  prison: true

ROLE Guest
  when someone joins:
    move guest to Hall
  when captured for guest:
    set guest.corrupted = true
  when released for guest:
    set guest.corrupted = false
    reply Reinstallation complete.
  when escape for guest:
    reply Escaped.

== Boot
Narrator: Boot.
`;
    const d = mkdtempSync(join(tmpdir(), "loom-mod-"));
    dirs.push(d);
    const mk = () =>
      new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "x", scenarioSource: SRC, joinBase: () => "http://localhost" });
    const rt1 = mk();
    const id = await withGuest(rt1);
    const world = (rt: EventRuntime) => rt.liveSim!.world;
    expect((await post(rt1, "/api/mod/act", { id, action: "capture" })).status).toBe(200);
    expect(world(rt1).peek(`${id}.corrupted`)).toEqual({ kind: "bool", value: true });
    expect(rt1.liveSim!.isCaptured(id)).toBe(true);

    expect((await post(rt1, "/api/mod/act", { id, action: "release" })).status).toBe(200);
    const sim1 = rt1.liveSim!;
    expect(sim1.isCaptured(id)).toBe(false);
    expect(world(rt1).peek(`${id}.corrupted`)).toEqual({ kind: "bool", value: false });
    expect(sim1.locationOf(id)).toBe("Hall");
    const types = sim1.log.since(0).map((e) => e.type);
    expect(types).toContain("released");
    expect(types).not.toContain("escaped");
    // A second release is a no-op (no double-fire).
    const before = sim1.log.len();
    await post(rt1, "/api/mod/act", { id, action: "release" });
    expect(sim1.log.since(before).filter((e) => e.type === "released")).toHaveLength(0);

    // `/api/mod/set captured:false` is the same release.
    await post(rt1, "/api/mod/act", { id, action: "capture" });
    await post(rt1, "/api/mod/set", { id, field: "captured", value: false });
    expect(world(rt1).peek(`${id}.corrupted`)).toEqual({ kind: "bool", value: false });
    expect(sim1.log.since(0).filter((e) => e.type === "released")).toHaveLength(2);
    rt1.pause();

    // A restart replays the journaled `release` lines onto the same state.
    const rt2 = mk();
    expect(rt2.restore()).not.toBeNull();
    expect(rt2.liveSim!.isCaptured(id)).toBe(false);
    expect(world(rt2).peek(`${id}.corrupted`)).toEqual({ kind: "bool", value: false });
    expect(rt2.liveSim!.log.len()).toBe(sim1.log.len());
  });

  it("/api/mod/set rejects unknown fields and unknown guests", async () => {
    const rt = freshRuntime();
    const id = await withGuest(rt);
    expect((await post(rt, "/api/mod/set", { id, field: "bogus", value: 1 })).status).toBe(400);
    expect((await post(rt, "/api/mod/set", { id: "nobody", field: "score", value: 1 })).status).toBe(404);
    expect((await post(rt, "/api/mod/set", { id, field: "faction", value: "" })).status).toBe(400);
  });

  it("/api/mod/say posts an operator message any guest in the room can see", async () => {
    const rt = freshRuntime();
    const id = await withGuest(rt);
    const say = await post(rt, "/api/mod/say", { channel: "lobby", text: "Doors are open, welcome!" });
    expect(say.status).toBe(200);

    const history = await get(rt, `/api/history?id=${id}`);
    const mine = history.json.messages.find((m: { text: string }) => m.text === "Doors are open, welcome!");
    expect(mine).toBeDefined();
    expect(mine.from).toBe("Operator");
  });

  it("/api/mod/say can speak in a character's voice", async () => {
    const rt = freshRuntime();
    const id = await withGuest(rt);
    await post(rt, "/api/mod/say", { channel: "lobby", text: "I am watching.", as: "Moderator_Prime" });
    const history = await get(rt, `/api/history?id=${id}`);
    const mine = history.json.messages.find((m: { text: string }) => m.text === "I am watching.");
    expect(mine.from).toBe("Moderator_Prime");
  });

  it("/api/mod/beat fires a known beat and 404s an unknown one", async () => {
    const rt = freshRuntime();
    await withGuest(rt);
    const probe = Sim.fromSources(SCENARIO);
    const beat = [...probe.model.beats.keys()].find((b) => !b.includes("."));
    expect(beat).toBeDefined();
    expect((await post(rt, "/api/mod/beat", { name: beat })).status).toBe(200);
    expect((await post(rt, "/api/mod/beat", { name: "nope-not-a-beat" })).status).toBe(404);
  });

  it("/api/mod/scan scans a guest as a character", async () => {
    const rt = freshRuntime();
    const id = await withGuest(rt);
    const ok = await post(rt, "/api/mod/scan", { as: "Recruiter", target: id });
    expect(ok.status).toBe(200);
    expect((await post(rt, "/api/mod/scan", { as: "NotACharacter", target: id })).status).toBe(404);
  });

  it("a subject-less fired beat replays deterministically across a restart", async () => {
    // Regression: fireBeat(name, undefined) journals its arg as `null`; the
    // replay guard must treat null as "no subject" instead of throwing, or the
    // beat (and its chat messages, which anchor hidden-flags + threads) vanish.
    const d = mkdtempSync(join(tmpdir(), "loom-mod-"));
    dirs.push(d);
    const mk = () =>
      new EventRuntime({
        eventId: "evt",
        store: new Store(d),
        codes: CODES,
        scenarioName: "escape-the-internet",
        scenarioSource: SCENARIO,
        joinBase: () => "http://localhost",
      });

    const rt1 = mk();
    rt1.openDoors();
    await post(rt1, "/api/guest/register", { name: "Alice", passcode: CODES.event }, false);
    const probe = Sim.fromSources(SCENARIO);
    const beat = [...probe.model.beats.keys()].find((b) => !b.includes("."))!;
    await post(rt1, "/api/mod/beat", { name: beat }); // no subject → journaled as null
    rt1.pause(); // stop the autonomous ticker so the ledger is stable to measure
    const live = await get(rt1, "/api/state?role=mod");
    expect(live.json.ledgerLen).toBeGreaterThan(1);

    // Restart: a fresh runtime replays the same journal from disk.
    const rt2 = mk();
    expect(rt2.restore()).not.toBeNull();
    const replayed = await get(rt2, "/api/state?role=mod");
    expect(replayed.json.ledgerLen).toBe(live.json.ledgerLen);
  });

  it("/api/mod/reveal exposes a hidden faction and 404s an unknown one", async () => {
    const rt = freshRuntime();
    await withGuest(rt);
    expect((await post(rt, "/api/mod/reveal", { faction: "TheAlgorithm" })).status).toBe(200);
    expect((await post(rt, "/api/mod/reveal", { faction: "NotAFaction" })).status).toBe(404);
  });

  it("mod routes are refused without the moderator capability", async () => {
    const rt = freshRuntime();
    const id = await withGuest(rt);
    // No moderator flag and no token → 403.
    const denied = await post(rt, "/api/mod/set", { id, field: "score", value: 1 }, false);
    expect(denied.status).toBe(403);
  });

  it("the mod SSE stream carries the raw sim feed (beatEntered → story map)", async () => {
    const rt = freshRuntime();
    await withGuest(rt);

    // A fake streaming response that records every SSE frame written.
    const chunks: string[] = [];
    const stream = {
      writeHead() {
        return stream;
      },
      write(s: unknown) {
        chunks.push(String(s));
        return true;
      },
      end() {
        return stream;
      },
    } as unknown as ServerResponse;
    await rt.handle(
      fakeReq(null),
      stream,
      "GET",
      "/events",
      new URL("http://x/events?role=mod"),
      { moderator: true },
    );

    const probe = Sim.fromSources(SCENARIO);
    const beat = [...probe.model.beats.keys()].find((b) => !b.includes("."))!;
    expect((await post(rt, "/api/mod/beat", { name: beat })).status).toBe(200);

    const feed = chunks.join("");
    expect(feed).toContain("event: sim");
    expect(feed).toContain('"beatEntered"');
    expect(feed).toContain(JSON.stringify(beat));
  });

  it("the mod roster carries live presence — online while a guest streams, off when they drop", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const reg = await post(rt, "/api/guest/register", { name: "Alice", passcode: CODES.event }, false);
    const { id, token } = reg.json as { id: string; token: string };

    // Registered but not streaming yet → offline.
    const before = await get(rt, "/api/state?role=mod");
    expect(before.json.roster[0]).toMatchObject({ id, online: false });

    // A fake guest SSE stream whose req exposes its close handler.
    let onClose: (() => void) | undefined;
    const req = {
      headers: {},
      on(ev: string, fn: () => void) {
        if (ev === "close") onClose = fn;
      },
    } as unknown as IncomingMessage;
    const stream = {
      writeHead() {
        return stream;
      },
      write() {
        return true;
      },
      end() {
        return stream;
      },
    } as unknown as ServerResponse;
    await rt.handle(req, stream, "GET", "/events", new URL(`http://x/events?role=guest&token=${token}`), {});

    const during = await get(rt, "/api/state?role=mod");
    expect(during.json.roster[0]).toMatchObject({ id, online: true });

    onClose!();
    const after = await get(rt, "/api/state?role=mod");
    expect(after.json.roster[0]).toMatchObject({ id, online: false });
  });

  it("/api/mod/persona spawns a puppetable guest (the shared-rehearsal path)", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const r = await post(rt, "/api/mod/persona", { name: "WriterTest" });
    expect(r.status).toBe(200);
    expect(r.json.guest).toMatchObject({ name: "WriterTest" });
    const id = r.json.guest.id as string;
    expect(id.startsWith("p-")).toBe(true);
    // The persona is a first-class guest: it can be moderated + spoken for.
    expect((await post(rt, "/api/mod/set", { id, field: "score", value: 5 })).json.guest.score).toBe(5);
    const state = await get(rt, "/api/state?role=mod");
    expect(state.json.roster.some((g: { id: string }) => g.id === id)).toBe(true);
  });

  it("/api/mod/var writes any world variable, journaled", async () => {
    const rt = freshRuntime();
    const id = await withGuest(rt);
    expect((await post(rt, "/api/mod/var", { path: "alarm_level", value: "5" })).status).toBe(200);
    expect((await post(rt, "/api/mod/var", { path: `${id}.suspicion`, value: "2" })).status).toBe(200);
    expect((await post(rt, "/api/mod/var", { path: "", value: "x" })).status).toBe(400);
    const world = (await get(rt, "/api/state?role=mod")).json.world as Array<{ path: string; value: string }>;
    expect(world.find((e) => e.path === "alarm_level")!.value).toBe("5");
    expect(world.find((e) => e.path === `${id}.suspicion`)!.value).toBe("2");
  });

  it("the mod view carries story positions and the world state", async () => {
    const rt = freshRuntime();
    const id = await withGuest(rt);
    const probe = Sim.fromSources(SCENARIO);
    const beat = probe.model.entry ?? [...probe.model.beats.keys()][0]!;
    await post(rt, "/api/mod/beat", { name: beat, subject: id });

    const state = await get(rt, "/api/state?role=mod");
    const row = state.json.roster.find((g: { id: string }) => g.id === id);
    // The guest's position is wherever the run left them; the fired beat
    // is on their trail either way.
    expect(typeof row.beat).toBe("string");
    expect(row.visited[beat]).toBeGreaterThanOrEqual(1);
    // The world table includes their per-person scalars, display-stringed.
    const world = state.json.world as Array<{ path: string; value: string }>;
    expect(world.some((e) => e.path === `${id}.name`)).toBe(true);
    // Director presence rides the same snapshot.
    expect(state.json.modsOnline).toBe(0);
  });
});

describe("openDoors plays the entry beat", () => {
  it("delivers the entry narration into the setting's room on first open, once", async () => {
    const rt = freshRuntime();
    const id = await withGuest(rt);

    // `doors_open` (setting: Party) fired on open: the NARRATOR's word block
    // lands in the Party location room, addressed to everyone.
    const h1 = await get(rt, `/api/history?id=${id}`);
    const opening = (h1.json.messages as Array<{ channel: string; from: string; text: string }>).filter(
      (m) => m.channel === "loc:Party" && m.from === "Narrator",
    );
    expect(opening.length).toBeGreaterThan(0);
    expect(opening[0]!.text).toContain("doors hiss open");

    // Pause → reopen must not replay the opening.
    rt.pause();
    rt.openDoors();
    const h2 = await get(rt, `/api/history?id=${id}`);
    expect(h2.json.messages.length).toBe(h1.json.messages.length);
  });

  // W8 T1-01: "a sim exists" is not "the entry played". A restart with the
  // doors closed builds the sim without opening; the next open plays it.
  const entries = (rt: EventRuntime): number => {
    const sim = rt.liveSim!;
    return sim.log.since(0).filter((e) => e.type === "beatEntered" && e.beat === sim.model.entry).length;
  };

  it("start → pause → reset → start plays the entry on the new run (T1-01)", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    expect(entries(rt)).toBe(1);
    rt.pause();
    expect((await post(rt, "/api/mod/reset", {})).json.phase).toBe("paused");
    expect(entries(rt)).toBe(0);
    await post(rt, "/api/mod/start", {});
    expect(entries(rt)).toBe(1);
    // Pause → resume on the same run never plays it twice.
    rt.pause();
    rt.openDoors();
    expect(entries(rt)).toBe(1);
  });

  it("idle → reset → start and idle → load → start play the entry once (T1-01)", async () => {
    const a = freshRuntime();
    await post(a, "/api/mod/reset", {});
    await post(a, "/api/mod/start", {});
    expect(entries(a)).toBe(1);

    const b = freshRuntime();
    await post(b, "/api/mod/load", { source: SCENARIO, name: "again" });
    await post(b, "/api/mod/start", {});
    expect(entries(b)).toBe(1);

    // The control plane's Go live in place / Push draft on a paused preview,
    // then Resume (`events-api.ts`): the same restart, the same open.
    for (const kind of ["golive", "reload"] as const) {
      const c = freshRuntime();
      c.openDoors();
      c.pause();
      c.restart(SCENARIO, "escape-the-internet", { kind, by: "Ada" });
      c.openDoors();
      expect(entries(c)).toBe(1);
    }
  });

  it("an open reset plays the entry exactly once", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    expect((await post(rt, "/api/mod/reset", {})).json.phase).toBe("open");
    expect(entries(rt)).toBe(1);
  });

  it("a restart while paused survives a process restart: the restored run still owes its entry, and plays it once (T1-01)", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-mod-"));
    dirs.push(d);
    const mk = () =>
      new EventRuntime({
        eventId: "evt",
        store: new Store(d),
        codes: CODES,
        scenarioName: "escape-the-internet",
        scenarioSource: SCENARIO,
        joinBase: () => "http://localhost",
      });
    const rt1 = mk();
    rt1.openDoors();
    rt1.pause();
    await post(rt1, "/api/mod/reset", {});
    rt1.dispose();

    const rt2 = mk();
    expect(rt2.restore()).not.toBeNull();
    expect(entries(rt2)).toBe(0);
    rt2.openDoors();
    expect(entries(rt2)).toBe(1);
    rt2.pause();
    rt2.dispose();

    // …and a run whose entry already played never replays it on a resume.
    const rt3 = mk();
    expect(rt3.restore()).not.toBeNull();
    expect(entries(rt3)).toBe(1);
    rt3.openDoors();
    expect(entries(rt3)).toBe(1);
    rt3.dispose();
  });
});

describe("mod choice answering", () => {
  it("surfaces pending choices in the mod snapshot and answers them via /api/mod/choose", async () => {
    const rt = freshRuntime();
    const id = await withGuest(rt);

    // captcha_gate(guest) prompts a menu bound to the guest.
    expect((await post(rt, "/api/mod/beat", { name: "captcha_gate", subject: id })).status).toBe(200);
    const before = await get(rt, `/api/state?role=mod`);
    const options = (before.json.choices as Record<string, string[]>)[id];
    expect(options).toBeDefined();
    expect(options![0]).toContain("Tap the traffic lights");

    // The moderator answers on the guest's behalf — journaled `choose`.
    const r = await post(rt, "/api/mod/choose", { person: id, index: 0 });
    expect(r.status).toBe(200);
    const after = await get(rt, `/api/state?role=mod`);
    expect((after.json.choices as Record<string, string[]>)[id]).toBeUndefined();
    // The chosen arm ran: verified flips true.
    const guest = (after.json.roster as Array<{ id: string; captured: boolean }>).find((g) => g.id === id)
    expect(guest).toBeDefined();
  });

  it("rejects a choose with no person", async () => {
    const rt = freshRuntime();
    await withGuest(rt);
    expect((await post(rt, "/api/mod/choose", { index: 0 })).status).toBe(400);
  });
});

// -- collaborative lifecycle: reset / reload / end reach every open console --

function modStream(rt: EventRuntime, name?: string, query = "") {
  const chunks: string[] = [];
  const stream = {
    writeHead() {
      return stream;
    },
    write(s: unknown) {
      chunks.push(String(s));
      return true;
    },
    end() {
      return stream;
    },
  } as unknown as ServerResponse;
  const open = rt.handle(fakeReq(null), stream, "GET", "/events", new URL(`http://x/events?role=mod${query}`), {
    moderator: true,
    moderatorName: name,
  });
  /** Parsed SSE events of one type, in arrival order. */
  const events = (type: string): unknown[] =>
    chunks
      .join("")
      .split("\n\n")
      .filter((f) => f.startsWith(`event: ${type}\n`))
      .map((f) => JSON.parse(f.slice(f.indexOf("data: ") + 6)));
  /** Every SSE event type, in arrival order. */
  const kinds = (): string[] =>
    chunks
      .join("")
      .split("\n\n")
      .filter((f) => f.startsWith("event: "))
      .map((f) => f.slice(7, f.indexOf("\n")));
  return { open, events, kinds };
}

describe("lifecycle fan-out to co-directors", () => {
  it("reset re-sends a fresh history + a lifecycle notice to every director, and keeps the doors open", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const a = modStream(rt, "Ada");
    const b = modStream(rt, "Bo");
    await Promise.all([a.open, b.open]);
    await post(rt, "/api/mod/say", { channel: "lobby", text: "before reset" });
    expect((a.events("message") as Array<{ text: string }>).some((m) => m.text === "before reset")).toBe(true);

    expect((await postAs(rt, "/api/mod/reset", {}, "Ada")).status).toBe(200);
    expect(rt.currentPhase).toBe("open");
    for (const s of [a, b]) {
      const histories = s.events("history") as Array<Array<{ text: string }>>;
      expect(histories.length).toBe(2); // connect + reset
      expect(histories[1]!.some((m) => m.text === "before reset")).toBe(false);
      // Every console learns who did it — including Ada's own.
      expect(s.events("lifecycle")).toContainEqual(expect.objectContaining({ kind: "reset", phase: "open", by: "Ada", at: expect.any(Number) }));
    }
  });

  it("restart on new source swaps the running story and reports `reload`", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const a = modStream(rt);
    await a.open;
    const next = `# Rewritten\n\nentry: opening\n\n== opening\n\nNarrator: A different story.\n`;
    rt.restart(next, "rewritten");
    expect(rt.source).toBe(next);
    expect(rt.scenario).toBe("rewritten");
    expect(a.events("lifecycle")).toContainEqual(expect.objectContaining({ kind: "reload", phase: "open" }));
    expect(rt.liveSim!.log.all().some((e) => e.type === "action" && e.text === "A different story.")).toBe(true);
  });

  it("every director is named in the mod snapshot, and dispose announces the end", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const a = modStream(rt, "Ada");
    const b = modStream(rt);
    await Promise.all([a.open, b.open]);
    const snaps = b.events("snapshot") as Array<{ modsOnline: number; directors: string[] }>;
    const last = snaps[snaps.length - 1]!;
    expect(last.modsOnline).toBe(2);
    expect(last.directors.sort()).toEqual(["Ada", "Director"]);
    rt.dispose("Ada");
    expect(a.events("lifecycle")).toContainEqual(expect.objectContaining({ kind: "ended", by: "Ada" }));
  });
});

// -- the super-admin surface: attribution, being anyone, the go-live cut ----

/** A guest's SSE stream (token in the URL), recording every frame. */
function guestStream(rt: EventRuntime, token: string) {
  const chunks: string[] = [];
  let ended = false;
  const stream = {
    writeHead() {
      return stream;
    },
    write(s: unknown) {
      chunks.push(String(s));
      return true;
    },
    end() {
      ended = true;
      return stream;
    },
  } as unknown as ServerResponse;
  const open = rt.handle(
    fakeReq(null),
    stream,
    "GET",
    "/events",
    new URL(`http://x/events?role=guest&token=${encodeURIComponent(token)}`),
    {},
  );
  const events = (type: string): unknown[] =>
    chunks
      .join("")
      .split("\n\n")
      .filter((f) => f.startsWith(`event: ${type}\n`))
      .map((f) => JSON.parse(f.slice(f.indexOf("data: ") + 6)));
  return { open, events, isEnded: () => ended };
}

async function postAs(rt: EventRuntime, path: string, body: unknown, moderatorName: string) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body), res, "POST", path, url, { moderator: true, moderatorName });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}

async function tokenPost(rt: EventRuntime, path: string, body: Record<string, unknown>, token: string) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq({ ...body, token }), res, "POST", path, url, {});
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}

describe("mod act", () => {
  it("/api/mod/act no longer has a signal branch (signals go through /api/mod/signal, with an optional actor)", async () => {
    const rt = freshRuntime();
    const id = await withGuest(rt);
    expect((await post(rt, "/api/mod/act", { id, action: "signal", name: "lockdown" })).status).toBe(400);
    expect((await post(rt, "/api/mod/act", { id, action: "capture" })).status).toBe(200);
    expect((await post(rt, "/api/mod/signal", { name: "lockdown", actor: "NotACharacter" })).status).toBe(404);
    expect((await post(rt, "/api/mod/signal", { name: "lockdown" })).status).toBe(200);
  });
});

describe("speaking as a participant", () => {
  it("obeys their post policy, carries `via` for mods, and hides it from guests", async () => {
    const rt = freshRuntime();
    const gid = await withGuest(rt);
    const persona = await postAs(rt, "/api/mod/persona", { name: "Puppet" }, "Ada");
    const pid = persona.json.guest.id as string;
    expect(persona.json.guest.owner).toBe("Ada");

    // A read-only feed (`#announcements`, post: none) refuses the puppet…
    const denied = await postAs(rt, "/api/mod/say", { channel: "room:announcements", text: "hi", as: pid }, "Ada");
    expect(denied.status).toBe(403);
    // …but the Operator may still post there.
    expect((await postAs(rt, "/api/mod/say", { channel: "room:announcements", text: "notice", as: "" }, "Ada")).status).toBe(200);
    // A persona can't DM a guest as themselves.
    expect((await postAs(rt, "/api/mod/say", { channel: `guest:${gid}`, text: "psst", as: pid }, "Ada")).status).toBe(403);
    // An unknown speaker is a typo, not a voice.
    expect((await postAs(rt, "/api/mod/say", { channel: "lobby", text: "?", as: "Nobody" }, "Ada")).status).toBe(404);

    // A character's voice posts anywhere and is never attributed.
    expect((await postAs(rt, "/api/mod/say", { channel: "room:announcements", text: "in character", as: "Recruiter" }, "Ada")).status).toBe(200);
    const inCharacter = (await get(rt, `/api/history?id=${gid}`)).json.messages.find((m: { text: string }) => m.text === "in character");
    expect(inCharacter.from).toBe("Recruiter");
    expect(inCharacter.via).toBeUndefined();

    // In the lobby the puppet speaks under its own name, attributed to Ada for mods only.
    expect((await postAs(rt, "/api/mod/say", { channel: "lobby", text: "hello room", as: pid }, "Ada")).status).toBe(200);
    const modHistory = await get(rt, `/api/history?id=${gid}`);
    const line = modHistory.json.messages.find((m: { text: string }) => m.text === "hello room");
    expect(line.from).toBe("Puppet");
    expect(line.via).toBe("Ada");
    // A guest reading the same thread never sees `via`.
    const res = fakeRes();
    const guestToken = ((await post(rt, "/api/guest/register", { name: "Bob", passcode: CODES.event }, false)).json as { token: string }).token;
    await rt.handle(fakeReq({}), res, "GET", "/api/history", new URL(`http://x/api/history?token=${guestToken}`), {});
    const seen = JSON.parse(res.body).messages.find((m: { text: string }) => m.text === "hello room");
    expect(seen).toBeDefined();
    expect("via" in seen).toBe(false);

    // Hiding then un-hiding re-delivers the line to guests — still without `via`.
    const g = guestStream(rt, guestToken);
    await g.open;
    expect((await post(rt, "/api/mod/message", { seq: line.seq, hidden: true })).status).toBe(200);
    expect((await post(rt, "/api/mod/message", { seq: line.seq, hidden: false })).status).toBe(200);
    const redelivered = (g.events("message") as Array<{ seq: number; via?: string }>).filter((m) => m.seq === line.seq);
    expect(redelivered.length).toBe(1);
    expect("via" in redelivered[0]!).toBe(false);
  });

  it("`via` and persona ownership survive a server restart", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-mod-"));
    dirs.push(d);
    const mk = () =>
      new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "x", scenarioSource: SCENARIO, joinBase: () => "http://localhost" });
    const rt1 = mk();
    rt1.openDoors();
    const persona = await postAs(rt1, "/api/mod/persona", { name: "Puppet" }, "Ada");
    const pid = persona.json.guest.id as string;
    await postAs(rt1, "/api/mod/say", { channel: "lobby", text: "puppet line", as: pid }, "Ada");
    rt1.pause();

    const rt2 = mk();
    expect(rt2.restore()).not.toBeNull();
    const history = await get(rt2, `/api/history?id=${pid}`);
    const line = history.json.messages.find((m: { text: string }) => m.text === "puppet line");
    expect(line.via).toBe("Ada");
    // Ownership rides presence: read it through a mod stream's snapshot.
    const m = modStream(rt2, "Bo");
    await m.open;
    const snaps = m.events("snapshot") as Array<{ roster: Array<{ id: string; owner?: string | null }> }>;
    expect(snaps[snaps.length - 1]!.roster.find((r) => r.id === pid)?.owner).toBe("Ada");
  });

  it("journals every mod mutation with who did it", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-mod-"));
    dirs.push(d);
    const store = new Store(d);
    const rt = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "x", scenarioSource: SCENARIO, joinBase: () => "http://localhost" });
    const id = await withGuest(rt);
    await postAs(rt, "/api/mod/set", { id, field: "score", value: 7 }, "Ada");
    const lines = store.readJournal();
    const setScore = lines.find((l) => l.m === "setScore");
    expect(setScore?.by).toBe("Ada");
    // Guest mutations carry no attribution.
    expect(lines.find((l) => l.m === "createPerson")?.by).toBeUndefined();
  });
});

describe("being anyone — the mod reads a participant's own projection", () => {
  it("/api/state?role=guest&as= and ?role=prime&as= return the play app's views verbatim", async () => {
    const rt = freshRuntime();
    const id = await withGuest(rt);
    await post(rt, "/api/mod/scan", { as: "Recruiter", target: id }); // gives the guest a pending choice
    const asGuest = await get(rt, `/api/state?role=guest&as=${id}`);
    expect(asGuest.status).toBe(200);
    expect(asGuest.json.pendingChoice).toEqual(["Join the Chatters", "Stay loyal"]);
    // Byte-for-byte the play app's own projection (the scan docked the
    // decision under the Recruiter's DM).
    // (plus the runtime's own `answered` cards list — empty here)
    // (plus the profile-picture map — empty with no program directory)
    // Wave 20 (D18): each pending menu docks where its prompt went (the Recruiter's DM).
    const menus = new Map(rt.liveSim!.pendingChoicesFor(id).map((c) => [c.id, "dm:Recruiter"] as const));
    expect(asGuest.json).toEqual(JSON.parse(JSON.stringify({ ...guestView(rt.liveSim!, id, "dm:Recruiter", undefined, menus), answered: [], avatars: {} })));
    const asPrime = await get(rt, "/api/state?role=prime&as=Recruiter");
    expect(asPrime.status).toBe(200);
    // (plus the booth's own `answered` cards list — empty here, and the
    // server's explicit `host: false`, C4)
    // (and each guest's `lastSeen`, wave 18 A1 — the runtime's, a number)
    const bare = primeView(rt.liveSim!, "Recruiter");
    const seen = new Map((asPrime.json["guests"] as Array<{ id: string; lastSeen: unknown }>).map((g) => [g.id, g.lastSeen]));
    for (const v of seen.values()) expect(typeof v).toBe("number");
    expect(asPrime.json).toEqual(JSON.parse(JSON.stringify({ ...bare, guests: bare.guests.map((g) => ({ ...g, lastSeen: seen.get(g.id) })), host: false, answered: [], avatars: {} })));
    expect((await get(rt, "/api/state?role=guest&as=nobody")).status).toBe(404);
    expect((await get(rt, "/api/state?role=prime&as=Nobody")).status).toBe(404);
    expect((await get(rt, `/api/state?role=guest&as=${id}`, false)).status).toBe(403);
  });

  it("/api/mod/scan hands back the character's readouts", async () => {
    const rt = freshRuntime();
    const id = await withGuest(rt);
    const r = await post(rt, "/api/mod/scan", { as: "Recruiter", target: id });
    expect(Array.isArray(r.json.responses)).toBe(true);
  });

  it("persona ownership rides the mod snapshot as RosterRow.owner", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const a = modStream(rt, "Ada");
    await a.open;
    const created = await postAs(rt, "/api/mod/persona", { name: "Ivo" }, "Ada");
    const pid = created.json.guest.id as string;
    // Mod snapshots are coalesced (≤ 2/s): the persona lands in the trailing frame.
    await vi.waitFor(() => {
      const snaps = a.events("snapshot") as Array<{ roster: Array<{ id: string; owner?: string | null }> }>;
      expect(snaps[snaps.length - 1]!.roster.find((r) => r.id === pid)?.owner).toBe("Ada");
    });
  });
});

describe("the go-live cut", () => {
  it("announces `golive` with `by`, signs every guest and performer out, and keeps admin sessions", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const reg = await post(rt, "/api/guest/register", { name: "Alice", passcode: CODES.event }, false);
    const guestToken = reg.json.token as string;
    const prime = await post(rt, "/api/prime/login", { character: "Recruiter", passcode: CODES.prime }, false);
    const primeToken = prime.json.token as string;
    const mod = await post(rt, "/api/mod/login", { passcode: CODES.mod }, false);
    const modToken = mod.json.token as string;
    const g = guestStream(rt, guestToken);
    const m = modStream(rt, "Ada");
    await Promise.all([g.open, m.open]);

    rt.restart(undefined, undefined, { kind: "golive", by: "Ada" });

    expect(m.events("lifecycle")).toContainEqual(expect.objectContaining({ kind: "golive", by: "Ada", at: expect.any(Number) }));
    expect(g.events("lifecycle")).toContainEqual(expect.objectContaining({ kind: "golive" }));
    expect(g.isEnded()).toBe(true);
    // The rehearsal guest's token is dead: they must re-register.
    expect((await tokenPost(rt, "/api/guest/say", { channel: "lobby", text: "still here?" }, guestToken)).status).toBe(401);
    // The performer lost their character; the code-holding admin keeps moderating.
    const primeState = fakeRes();
    await rt.handle(fakeReq({}), primeState, "GET", "/api/state", new URL(`http://x/api/state?role=prime&token=${primeToken}`), {});
    expect(primeState.statusCode).toBe(403);
    expect((await tokenPost(rt, "/api/mod/say", { channel: "lobby", text: "admin lives" }, modToken)).status).toBe(200);
    expect(rt.currentPhase).toBe("open");
  });

  it("a plain reset also cuts guests but keeps performers signed in", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const reg = await post(rt, "/api/guest/register", { name: "Alice", passcode: CODES.event }, false);
    const prime = await post(rt, "/api/prime/login", { character: "Recruiter", passcode: CODES.prime }, false);
    rt.restart();
    expect((await tokenPost(rt, "/api/guest/say", { channel: "lobby", text: "?" }, reg.json.token as string)).status).toBe(401);
    const primeState = fakeRes();
    await rt.handle(fakeReq({}), primeState, "GET", "/api/state", new URL(`http://x/api/state?role=prime&token=${prime.json.token}`), {});
    expect(primeState.statusCode).toBe(200);
  });
});

// -- K-22: the lean mod stream + coalesced mod snapshots ----------------------

describe("the mod feed's bandwidth", () => {
  it("?lean=1 gets every sim / message / lifecycle frame but never a snapshot or history", async () => {
    const rt = freshRuntime({ modSnapshotMs: 0 });
    rt.openDoors();
    const lean = modStream(rt, undefined, "&lean=1");
    const full = modStream(rt, "Ada");
    await Promise.all([lean.open, full.open]);
    expect(lean.events("snapshot")).toEqual([]);
    expect(lean.events("history")).toEqual([]);

    await post(rt, "/api/mod/say", { channel: "lobby", text: "lean hello" });
    const probe = Sim.fromSources(SCENARIO);
    const beat = [...probe.model.beats.keys()].find((b) => !b.includes("."))!;
    await post(rt, "/api/mod/beat", { name: beat });
    expect((lean.events("message") as Array<{ text: string }>).some((m) => m.text === "lean hello")).toBe(true);
    // Every sim frame the full console saw, the lean one saw too.
    expect(lean.events("sim").length).toBeGreaterThan(0);
    expect(lean.events("sim")).toEqual(full.events("sim"));

    expect((await postAs(rt, "/api/mod/reset", {}, "Ada")).status).toBe(200);
    expect(lean.events("lifecycle")).toContainEqual(expect.objectContaining({ kind: "reset" }));
    expect(lean.events("snapshot")).toEqual([]);
    expect(lean.events("history")).toEqual([]);
    // The full console still gets its views.
    expect(full.events("snapshot").length).toBeGreaterThan(1);
    expect(full.events("history").length).toBe(2);
  });

  it("lean is a mod-feed flag only — a guest stream ignores it", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const reg = await post(rt, "/api/guest/register", { name: "Alice", passcode: CODES.event }, false);
    const chunks: string[] = [];
    const res = {
      writeHead: () => res,
      write: (c: unknown) => chunks.push(String(c)) > 0,
      end: () => res,
    } as unknown as ServerResponse;
    const url = new URL(`http://x/events?role=guest&lean=1&token=${encodeURIComponent(reg.json.token as string)}`);
    await rt.handle(fakeReq(null), res, "GET", "/events", url, {});
    const frames = chunks.join("").split("\n\n");
    expect(frames.filter((f) => f.startsWith("event: snapshot\n")).length).toBe(1);
    expect(frames.filter((f) => f.startsWith("event: history\n")).length).toBe(1);
  });

  it("coalesces a burst of steps into one trailing mod snapshot, built after the last step", async () => {
    const rt = freshRuntime({ modSnapshotMs: 150 });
    rt.openDoors();
    const a = modStream(rt, "Ada");
    const b = modStream(rt, "Bo");
    await Promise.all([a.open, b.open]);
    const before = a.events("snapshot").length;
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const p = await postAs(rt, "/api/mod/persona", { name: `Burst ${i}` }, "Ada");
      ids.push(p.json.guest.id as string);
    }
    // At most one frame went out during the burst (the window's leading edge).
    expect(a.events("snapshot").length - before).toBeLessThanOrEqual(1);
    await vi.waitFor(() => {
      const snaps = a.events("snapshot") as Array<{ roster: Array<{ id: string }> }>;
      const roster = snaps[snaps.length - 1]!.roster.map((r) => r.id);
      for (const id of ids) expect(roster).toContain(id);
    });
    // ≤ 2 frames for 8 steps; both directors got the same bytes.
    expect(a.events("snapshot").length - before).toBeLessThanOrEqual(2);
    expect(b.events("snapshot").slice(-1)).toEqual(a.events("snapshot").slice(-1));
    rt.dispose();
  });

  it("a restart inside the coalescing window still sends the snapshot before the new history", async () => {
    const rt = freshRuntime({ modSnapshotMs: 60_000 });
    rt.openDoors();
    const a = modStream(rt, "Ada");
    await a.open;
    await postAs(rt, "/api/mod/persona", { name: "Ivo" }, "Ada"); // leaves a trailing frame pending
    const from = a.kinds().length;
    expect((await postAs(rt, "/api/mod/reset", {}, "Ada")).status).toBe(200);
    const after = a.kinds().slice(from).filter((k) => k === "snapshot" || k === "history" || k === "lifecycle");
    expect(after[0]).toBe("lifecycle");
    expect(after.indexOf("snapshot")).toBeGreaterThan(-1);
    expect(after.indexOf("snapshot")).toBeLessThan(after.indexOf("history"));
    rt.dispose();
  });

  it("a director connecting gets exactly one snapshot, and the others one presence frame", async () => {
    const rt = freshRuntime({ modSnapshotMs: 0 });
    rt.openDoors();
    const a = modStream(rt, "Ada");
    await a.open;
    const before = a.events("snapshot").length;
    const b = modStream(rt, "Bo");
    await b.open;
    expect(b.kinds().filter((k) => k === "snapshot" || k === "history")).toEqual(["snapshot", "history"]);
    expect(a.events("snapshot").length - before).toBe(1);
    const last = a.events("snapshot").slice(-1)[0] as { directors?: string[] };
    expect(b.events("snapshot")[0]).toEqual(last);
    rt.dispose();
  });
});

// -- SW-OPS-24: coalesced guest + booth snapshots (`snapshotMs`) --------------

/** A guest's or booth's SSE stream, parsed like `modStream`. */
function roleStream(rt: EventRuntime, role: "guest" | "prime", token: string) {
  const chunks: string[] = [];
  const stream = {
    writeHead: () => stream,
    write: (c: unknown) => chunks.push(String(c)) > 0,
    end: () => stream,
  } as unknown as ServerResponse;
  const open = rt.handle(fakeReq(null), stream, "GET", "/events", new URL(`http://x/events?role=${role}&token=${encodeURIComponent(token)}`), {});
  const frames = () => chunks.join("").split("\n\n").filter((f) => f.startsWith("event: "));
  const events = (type: string): unknown[] =>
    frames()
      .filter((f) => f.startsWith(`event: ${type}\n`))
      .map((f) => JSON.parse(f.slice(f.indexOf("data: ") + 6)));
  const kinds = (): string[] => frames().map((f) => f.slice(7, f.indexOf("\n")));
  return { open, events, kinds };
}

describe("guest + booth snapshot coalescing", () => {
  async function guestOn(rt: EventRuntime) {
    const reg = await post(rt, "/api/guest/register", { name: "Alice", passcode: CODES.event }, false);
    const id = reg.json.id as string;
    const s = roleStream(rt, "guest", reg.json.token as string);
    await s.open;
    return { id, s };
  }

  it("is off by default (and from LOOM_SNAPSHOT_MS unless it is a positive number)", () => {
    expect(snapshotMsFromEnv({})).toBe(0);
    expect(snapshotMsFromEnv({ LOOM_SNAPSHOT_MS: "0" })).toBe(0);
    expect(snapshotMsFromEnv({ LOOM_SNAPSHOT_MS: "fast" })).toBe(0);
    expect(snapshotMsFromEnv({ LOOM_SNAPSHOT_MS: "-5" })).toBe(0);
    expect(snapshotMsFromEnv({ LOOM_SNAPSHOT_MS: "500" })).toBe(500);
  });

  it("snapshotMs 0 sends a guest a frame per step", async () => {
    const rt = freshRuntime({ snapshotMs: 0 });
    rt.openDoors();
    const { id, s } = await guestOn(rt);
    const before = s.events("snapshot").length;
    for (let i = 1; i <= 5; i++) expect((await post(rt, "/api/mod/set", { id, field: "score", value: i })).status).toBe(200);
    const snaps = s.events("snapshot") as Array<{ score: number }>;
    expect(snaps.length - before).toBeGreaterThanOrEqual(5);
    expect(snaps.slice(before).map((v) => v.score).slice(-5)).toEqual([1, 2, 3, 4, 5]);
    rt.dispose();
  });

  it("coalesces a burst into one leading and one trailing frame, the trailing one built after the last step", async () => {
    const rt = freshRuntime({ snapshotMs: 150 });
    rt.openDoors();
    const { id, s } = await guestOn(rt);
    await new Promise((r) => setTimeout(r, 160)); // the join's round is out of the window
    const before = s.events("snapshot").length;
    for (let i = 1; i <= 5; i++) await post(rt, "/api/mod/set", { id, field: "score", value: i });
    expect(s.events("snapshot").length - before).toBe(1); // the leading edge
    await vi.waitFor(() => {
      const snaps = s.events("snapshot") as Array<{ score: number }>;
      expect(snaps[snaps.length - 1]!.score).toBe(5);
    });
    expect(s.events("snapshot").length - before).toBe(2);
    rt.dispose();
  });

  it("a restart inside the window still lands a booth's fresh view before the new history", async () => {
    const rt = freshRuntime({ snapshotMs: 60_000 });
    rt.openDoors();
    const prime = await post(rt, "/api/prime/login", { character: "Recruiter", passcode: CODES.prime }, false);
    const b = roleStream(rt, "prime", prime.json.token as string);
    await b.open;
    await post(rt, "/api/mod/persona", { name: "Ivo" }); // a step inside the window → a pending trailing round
    const from = b.kinds().length;
    expect((await post(rt, "/api/mod/reset", {})).status).toBe(200);
    const after = b.kinds().slice(from).filter((k) => k === "snapshot" || k === "history" || k === "lifecycle");
    expect(after[0]).toBe("lifecycle");
    expect(after.indexOf("snapshot")).toBeGreaterThan(-1);
    expect(after.indexOf("snapshot")).toBeLessThan(after.indexOf("history"));
    rt.dispose();
  });

  it("dispose drops a pending trailing round", async () => {
    vi.useFakeTimers();
    try {
      const rt = freshRuntime({ snapshotMs: 1_000 });
      rt.openDoors();
      const { id, s } = await guestOn(rt);
      await post(rt, "/api/mod/set", { id, field: "score", value: 7 });
      const n = s.events("snapshot").length;
      rt.dispose();
      vi.advanceTimersByTime(2_000);
      expect(s.events("snapshot").length).toBe(n);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an agent worker coming online sends each guest one snapshot, not two", async () => {
    const rt = freshRuntime({ snapshotMs: 0, modSnapshotMs: 0 });
    rt.openDoors();
    const { s } = await guestOn(rt);
    const before = s.events("snapshot").length;
    const req = Object.assign(fakeReq(null), { on: () => req }) as IncomingMessage;
    await rt.handle(req, fakeRes(), "GET", "/api/agent/stream", new URL("http://x/api/agent/stream?characters=Nobody&name=laptop"), { moderator: true });
    expect(s.events("snapshot").length - before).toBe(1);
    rt.dispose();
  });
});

describe("/api/mod/signal `label`", () => {
  it("journals `label` as `by` for a mod-token caller and keeps an author's name", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-mod-"));
    dirs.push(d);
    const store = new Store(d);
    const rt = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "x", scenarioSource: SCENARIO, joinBase: () => "http://localhost" });
    const id = await withGuest(rt);
    // A device holding the mod token (`by` = the generic "Director") names
    // itself — trimmed, capped at 60 chars.
    expect((await post(rt, "/api/mod/signal", { name: "lockdown", subject: id, label: "  Tent tablet  " })).status).toBe(200);
    expect((await post(rt, "/api/mod/signal", { name: "lockdown", subject: id, label: "x".repeat(80) })).status).toBe(200);
    // An author session's own name is never overridden by a label.
    expect((await postAs(rt, "/api/mod/signal", { name: "lockdown", subject: id, label: "Tent tablet" }, "Ada")).status).toBe(200);
    // No label → the generic attribution, and the label never leaks onto the next commit.
    expect((await post(rt, "/api/mod/signal", { name: "lockdown", subject: id })).status).toBe(200);
    await post(rt, "/api/mod/set", { id, field: "score", value: 7 });
    const signals = store.readJournal().filter((l) => l.m === "signal");
    expect(signals.map((l) => l.by)).toEqual(["Tent tablet", "x".repeat(60), "Ada", "Director"]);
    expect(store.readJournal().find((l) => l.m === "setScore")?.by).toBe("Director");
  });
});

describe("GET /api/mod/log — the whole ledger, paged (T7-03)", () => {
  it("pages the ledger from the start for a console that saw none of it; directors only", async () => {
    const rt = freshRuntime();
    expect((await get(rt, "/api/mod/log")).json).toEqual({ entries: [], next: null, total: 0 });
    await withGuest(rt);
    for (let i = 0; i < 3; i++) await post(rt, "/api/guest/register", { name: `Guest ${i}`, passcode: CODES.event }, false);
    const ledger = rt.liveSim!.log.all();
    expect(ledger.length).toBeGreaterThan(5);
    expect((await get(rt, "/api/mod/log", false)).status).toBe(403);

    // The whole ledger in one go, then in pages of 2 stitched back together.
    const all = await get(rt, "/api/mod/log");
    expect(all.json).toEqual({ entries: JSON.parse(JSON.stringify(ledger)), next: null, total: ledger.length });
    const pages: unknown[] = [];
    let after: number | null = -1;
    let calls = 0;
    while (after !== null) {
      const page = await get(rt, `/api/mod/log?after=${after}&limit=2`);
      expect(page.json.total).toBe(ledger.length);
      expect(page.json.entries.length).toBeLessThanOrEqual(2);
      pages.push(...page.json.entries);
      after = page.json.next;
      calls += 1;
    }
    expect(pages).toEqual(all.json.entries);
    expect(calls).toBe(Math.ceil(ledger.length / 2));
    // `after` is exclusive; past the end is an empty last page.
    expect((await get(rt, `/api/mod/log?after=0&limit=1`)).json).toMatchObject({ entries: [all.json.entries[1]], next: 1 });
    expect((await get(rt, `/api/mod/log?after=${ledger.length - 1}`)).json).toEqual({ entries: [], next: null, total: ledger.length });
  });

  it("clamps the limit: default 1000, at most 5000, junk is the default", async () => {
    const { modLogQuery, MOD_LOG_LIMIT, MOD_LOG_MAX } = await import("../server/routes/mod-log.ts");
    const q = (s: string) => modLogQuery(new URL(`http://x/api/mod/log${s}`));
    expect(q("")).toEqual({ after: -1, limit: MOD_LOG_LIMIT });
    expect(q("?limit=99999&after=12")).toEqual({ after: 12, limit: MOD_LOG_MAX });
    expect(q("?limit=0&after=-7")).toEqual({ after: -1, limit: 1 });
    expect(q("?limit=abc&after=x")).toEqual({ after: -1, limit: MOD_LOG_LIMIT });
  });
});

describe("the cue sheet across a restart (T7-01 review)", () => {
  it("a refused press followed by a mod `set` reads the same LAST live and after the journal replays", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-cues-"));
    dirs.push(d);
    const show = scenarioSource("trapped-in-the-internet");
    const make = () => new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "trapped-in-the-internet", scenarioSource: show, joinBase: () => "http://localhost" });
    const rt = make();
    const id = await withGuest(rt);
    const cues = async (r: EventRuntime) => {
      const { last, fired } = (await get(r, "/api/state?role=mod&cues=1")).json.cues;
      return { last, fired };
    };
    expect((await post(rt, "/api/mod/signal", { name: "call_to_the_desktop" })).status).toBe(200);
    // Refused with a # hosts line (no vote yet); no snapshot until after the set.
    expect((await post(rt, "/api/mod/signal", { name: "force_majority_stay" })).status).toBe(200);
    expect((await post(rt, "/api/mod/set", { id, field: "score", value: 5 })).status).toBe(200);
    const live = await cues(rt);
    expect(live).toEqual({ last: "call_to_the_desktop", fired: ["call_to_the_desktop"] });
    const again = make();
    expect(again.restore()).not.toBeNull();
    expect(await cues(again)).toEqual(live);
  });
});

describe("/api/mod/load re-reads the project's files into the open docs first (C2, T4-04)", () => {
  function link(order: string[], opts: { fail?: boolean } = {}) {
    return {
      projectId: "proj-1",
      async writeFile() {},
      async saveSnapshot() {},
      async saveVariant() {},
      async resyncFiles() {
        order.push("resync");
        if (opts.fail === true) throw new Error("db down");
      },
    };
  }

  it("resyncs once, before the restart", async () => {
    const order: string[] = [];
    const rt = freshRuntime({ project: link(order) });
    const restart = rt.restart.bind(rt);
    rt.restart = ((...args: Parameters<EventRuntime["restart"]>) => {
      order.push("restart");
      return restart(...args);
    }) as EventRuntime["restart"];
    expect((await post(rt, "/api/mod/load", { source: SCENARIO, name: "synced" })).status).toBe(200);
    expect(order).toEqual(["resync", "restart"]);
    rt.dispose();
  });

  it("/api/mod/resync re-reads the files with no restart; mod-gated; a failure is a 502 (T4 recheck)", async () => {
    const order: string[] = [];
    const rt = freshRuntime({ project: link(order) });
    const restart = rt.restart.bind(rt);
    rt.restart = ((...args: Parameters<EventRuntime["restart"]>) => {
      order.push("restart");
      return restart(...args);
    }) as EventRuntime["restart"];
    expect((await post(rt, "/api/mod/resync", {}, false)).status).toBe(403);
    expect(order).toEqual([]);
    const r = await post(rt, "/api/mod/resync", {});
    expect([r.status, r.json]).toEqual([200, { ok: true, resynced: true }]);
    expect(order).toEqual(["resync"]);
    rt.dispose();
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const bad = freshRuntime({ project: link([], { fail: true }) });
    try {
      expect((await post(bad, "/api/mod/resync", {})).status).toBe(502);
    } finally {
      err.mockRestore();
      bad.dispose();
    }
    const none = freshRuntime({});
    expect((await post(none, "/api/mod/resync", {})).json).toEqual({ ok: true, resynced: false });
    none.dispose();
  });

  it("a failed resync is logged and never blocks the reload", async () => {
    const order: string[] = [];
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const rt = freshRuntime({ project: link(order, { fail: true }) });
    try {
      const r = await post(rt, "/api/mod/load", { source: SCENARIO, name: "synced" });
      expect(r.status).toBe(200);
      expect(rt.scenario).toBe("synced");
      expect(order).toEqual(["resync"]);
      expect(err.mock.calls.some(([line]) => String(line).includes("re-reading the project's files failed"))).toBe(true);
    } finally {
      err.mockRestore();
      rt.dispose();
    }
  });
});
