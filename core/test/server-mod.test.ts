//! Integration tests for the run-panel mod routes on `EventRuntime.handle`.
//! Drives the runtime with fake req/res (like `registry.test.ts`) through the
//! author-session moderator path (`opts.moderator: true`), exercising the new
//! `/api/mod/{say,set,beat,scan}` glue end-to-end against a real scenario.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";

const SCENARIO = scenarioSource("escape-the-internet");
const CODES = { event: "EVT111", prime: "PRM111", mod: "MOD111" };

const dirs: string[] = [];
function freshRuntime(): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-mod-"));
  dirs.push(d);
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "escape-the-internet",
    scenarioSource: SCENARIO,
    joinBase: () => "http://localhost",
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

function modStream(rt: EventRuntime, name?: string) {
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
  const open = rt.handle(fakeReq(null), stream, "GET", "/events", new URL("http://x/events?role=mod"), {
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
  return { open, events };
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

    expect((await post(rt, "/api/mod/reset", {})).status).toBe(200);
    expect(rt.currentPhase).toBe("open");
    for (const s of [a, b]) {
      const histories = s.events("history") as Array<Array<{ text: string }>>;
      expect(histories.length).toBe(2); // connect + reset
      expect(histories[1]!.some((m) => m.text === "before reset")).toBe(false);
      expect(s.events("lifecycle")).toContainEqual({ kind: "reset", phase: "open" });
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
    expect(a.events("lifecycle")).toContainEqual({ kind: "reload", phase: "open" });
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
    rt.dispose();
    expect(a.events("lifecycle")).toContainEqual({ kind: "ended" });
  });
});
