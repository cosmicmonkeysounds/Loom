// Wave 59: the teleprompter over the real runtime and the real show. Which beats
// hold his voice, the route, who reaches a frame, and the screen poll.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { scenarioSource } from "../examples/load.ts";
import { composeGuestMessages, ChatStore, type ChatMessage } from "../server/chat.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { sceneOf, type PrompterFrame, type SceneDraft } from "../server/prompter.ts";
import { Store } from "../server/store.ts";
import { isHostRoute } from "../server/routes/host.ts";
import { Sim } from "../src/runtime/sim/sim.ts";

const CODES = { event: "GUEST1", prime: "PRIME1", mod: "MOD111" };
const SRC = scenarioSource("trapped-in-the-internet");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown, token?: string): IncomingMessage {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return { headers: token !== undefined ? { "x-loom-token": token } : {}, socket: { remoteAddress: "127.0.0.1" }, on() {}, [Symbol.asyncIterator]: async function* () { yield* chunks; } } as unknown as IncomingMessage;
}
type Frame = { event: string; data: unknown };
function fakeRes() {
  let pending: string | null = null;
  const r = {
    statusCode: 200,
    body: "",
    frames: [] as Frame[],
    setHeader() {},
    once() {},
    on() {},
    flushHeaders() {},
    writeHead(s: number) {
      r.statusCode = s;
      return r;
    },
    write(chunk: string) {
      const ev = /^event: (\S+)\n$/u.exec(chunk);
      if (ev) pending = ev[1]!;
      const data = /^data: (.*)\n\n$/su.exec(chunk);
      if (data && pending !== null) r.frames.push({ event: pending, data: JSON.parse(data[1]!) });
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") r.body = b;
      return r;
    },
  };
  return r as unknown as ServerResponse & typeof r;
}
async function post(rt: EventRuntime, path: string, body: unknown, o: { token?: string; moderator?: boolean } = {}) {
  const r = fakeRes();
  await rt.handle(fakeReq(body, o.token), r, "POST", path, new URL(`http://x${path}`), { moderator: o.moderator === true });
  return { status: r.statusCode, json: JSON.parse(r.body || "{}") as Record<string, unknown> };
}
async function poll(rt: EventRuntime, after: number) {
  const r = fakeRes();
  const url = new URL(`http://x/api/screen/state?name=TV&view=tv&character=Trabolta&voice=The%20Desktop&after=${after}`);
  await rt.handle(fakeReq({}), r, "GET", url.pathname, url, { moderator: true });
  return JSON.parse(r.body) as { voice: { head: number; held?: boolean; lines: Array<{ seq: number; text: string }> } };
}
async function stream(rt: EventRuntime, role: string, token: string) {
  const r = fakeRes();
  const url = new URL(`http://x/events?role=${role}&token=${encodeURIComponent(token)}`);
  await rt.handle({ ...fakeReq({}), on() {} } as unknown as IncomingMessage, r, "GET", "/events", url, {});
  return r;
}
function runtime(): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-w59-"));
  dirs.push(d);
  const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "titi", scenarioSource: SRC, joinBase: () => "http://localhost" });
  rt.openDoors();
  return rt;
}
const booth = async (rt: EventRuntime, character: string) => (await post(rt, "/api/prime/login", { character, passcode: CODES.prime })).json.token as string;
const frames = (r: ReturnType<typeof fakeRes>) => r.frames.filter((f) => f.event === "prompter").map((f) => f.data as PrompterFrame | null);

const CTX = (sim: Sim) => ({
  voiced: (from: string) => sim.model.characters.get(from)?.mind === "external",
  ownerOf: (from: string) => (sim.model.characters.has(from) ? `@${from}` : null),
});
function played(beat: string, setup: (sim: Sim) => void = () => {}): { draft: SceneDraft | null; rows: ChatMessage[] } {
  const sim = Sim.fromSources(SRC);
  setup(sim);
  const chat = new ChatStore();
  const rows = chat.append(composeGuestMessages(sim, sim.fireBeat(beat)));
  return { draft: sceneOf(rows, CTX(sim)), rows };
}
const his = (d: SceneDraft) => d.sections.flatMap((s) => s.lines).filter((l) => l.his).length;

describe("the show's beats", () => {
  it("holds him only where Clippy and he share a beat", () => {
    for (const beat of ["Ad Hijack", "Second Hunt", "Full Of Beans"]) {
      const { draft } = played(beat);
      expect(draft, beat).not.toBeNull();
      expect(his(draft!), beat).toBeGreaterThan(0);
      expect(draft!.readers, beat).toEqual(["@Clippy"]);
      expect(draft!.owners, `${beat}: a stage direction is nobody's line`).toEqual([]);
    }
    for (const beat of ["Computer Bingo", "Clippy On Trabolta", "Bingo Time"]) expect(his(played(beat).draft!), beat).toBe(0);
  });

  it("makes Second Hunt, the questions and Hunt Two Go one scene, the questions going with his run", () => {
    const { draft } = played("Second Hunt");
    expect(draft!.sections.map((s) => s.title)).toEqual(["Second Hunt", "Hunt Two Go"]);
    expect(draft!.after.length, "the generated questions are his, outside the script").toBeGreaterThan(0);
  });

  it("gives his hosted ceremony no scene: Clippy has nothing to read there", () => {
    const { draft, rows } = played("The Ceremony", (sim) => {
      sim.setVar("Night.ceremony_host", "Trabolta");
    });
    expect(rows.some((m) => m.from === "Trabolta")).toBe(true);
    expect(draft).toBeNull();
  });

  it("leaves the monologue on the TV alone: no reader, no scene", () => {
    expect(played("The Full Truth").draft).toBeNull();
  });

  it("leaves the song beats alone: the TV captions them, and no reader marks them", () => {
    const sim = Sim.fromSources(SRC);
    for (const beat of ["Song Ending", "Sad Confession", "The Hand Jive"]) {
      expect(sim.model.beats.has(beat), beat).toBe(true);
      expect(sim.model.beats.get(beat)!.contract.has("aloud"), beat).toBe(false);
    }
  });

  it("makes the Task Manager's long read one scene of hers, with nothing to hold", () => {
    const { draft } = played("The Full Truth Read");
    expect(draft!.readers).toEqual(["@Task Manager"]);
    expect(his(draft!)).toBe(0);
    expect(draft!.sections.flatMap((s) => s.lines).length).toBeGreaterThan(50);
  });

  it("names everyone with a line: the second reader of Truth Pong is a reader, not an owner", () => {
    const { draft } = played("Truth Pong");
    expect(draft!.readers.sort()).toEqual(["@Adobe Acrobat", "@Clippy"]);
    expect(draft!.owners).toEqual([]);
  });

  it("keeps the Y2K line out of every marked beat, so the dream's trigger never waits", () => {
    const sim = Sim.fromSources(SRC);
    const marked = [...sim.model.beats.values()].filter((b) => b.contract.has("aloud"));
    expect(marked.length).toBeGreaterThan(20);
    expect(SRC.split("\n== ").filter((b) => /Y2K BUG/u.test(b)).some((b) => /^\s*aloud:/mu.test(b))).toBe(false);
  });
});

describe("over the real runtime", () => {
  it("holds the TV's poll, moves on when Clippy's phone reaches him, and answers ▶", async () => {
    const rt = runtime();
    const clippy = await booth(rt, "Clippy");
    const res = await stream(rt, "prime", clippy);
    expect(frames(res)).toEqual([null]);
    const before = (await poll(rt, -1)).voice.head;
    expect((await post(rt, "/api/mod/beat", { name: "Second Hunt" }, { moderator: true })).status).toBe(200);
    const scene = frames(res).at(-1)!;
    expect(scene.script?.sections.length).toBe(2);
    expect(scene.held).toBe(true);
    expect(scene.script?.sections[0]!.lines.some((l) => l.his)).toBe(true);

    await post(rt, "/api/aloud", { scene: scene.id, op: "here", open: true }, { token: clippy });
    const held = await poll(rt, before);
    expect(held.voice.held).toBe(true);
    expect(held.voice.lines).toEqual([]);

    const lines = scene.script!.sections[0]!.lines;
    const to = lines.slice(0, lines.findIndex((l) => l.his)).reduce((n, l) => n + l.text.split(/\s+/u).length, 0);
    expect((await post(rt, "/api/aloud", { scene: scene.id, op: "jump", pos: to }, { token: clippy })).status).toBe(200);
    const said = await poll(rt, before);
    expect(said.voice.lines[0]!.text).toContain("Thank you, Clippy");
    expect(frames(res).at(-1)!.speaking?.name).toBe("Trabolta");

    expect((await post(rt, "/api/mod/aloud", { action: "release" }, { moderator: true })).json).toMatchObject({ ok: true });
    expect((await post(rt, "/api/mod/aloud", { action: "nope" }, { moderator: true })).status).toBe(400);
    rt.dispose();
  });

  it("refuses anyone outside, and a host can always join; a host's id never leaks to a guest", async () => {
    const rt = runtime();
    const clippy = await booth(rt, "Clippy");
    const host = await booth(rt, "Task Manager");
    const norton = await booth(rt, "Norton Anti-Virus");
    const g = await post(rt, "/api/guest/register", { name: "ICQ", passcode: CODES.event });
    const guestRes = await stream(rt, "guest", g.json.token as string);
    const nortonRes = await stream(rt, "prime", norton);
    const hostRes = await stream(rt, "prime", host);
    await stream(rt, "prime", clippy);
    await post(rt, "/api/mod/beat", { name: "Second Hunt" }, { moderator: true });
    const id = frames(hostRes).at(-1)!.id;
    expect(frames(guestRes).every((f) => f === null), "a guest with no line sees none of it").toBe(true);
    expect(frames(nortonRes).every((f) => f === null), "nor a booth with none").toBe(true);
    expect((await post(rt, "/api/aloud", { scene: id, op: "press" }, { token: g.json.token as string })).status).toBe(409);
    expect((await post(rt, "/api/aloud", { scene: id, op: "press" }, { token: norton })).status).toBe(409);
    expect((await post(rt, "/api/aloud", { scene: id, op: "press" }, { token: host })).status).toBe(200);
    expect((await post(rt, "/api/aloud", { scene: id, op: "press" }, { token: clippy })).json["error"]).toBe("prompter: locked");
    expect((await post(rt, "/api/aloud", { scene: id, op: "nope" }, { token: clippy })).status).toBe(400);
    expect((await post(rt, "/api/aloud", { scene: id, op: "press" }, {})).status).toBe(401);
    rt.dispose();
  });

  it("holds nothing with no reader's phone, but waits for one that slept a moment ago", async () => {
    const rt = runtime();
    const clippy = await booth(rt, "Clippy");
    await post(rt, "/api/mod/beat", { name: "Second Hunt" }, { moderator: true });
    expect((await poll(rt, -1)).voice.held, "no stream, ever: the beat plays as it always did").toBeUndefined();
    const closers: Array<() => void> = [];
    const r = fakeRes();
    const url = new URL(`http://x/events?role=prime&token=${encodeURIComponent(clippy)}`);
    await rt.handle({ ...fakeReq({}), on: (ev: string, f: () => void) => void (ev === "close" && closers.push(f)) } as unknown as IncomingMessage, r, "GET", "/events", url, {});
    for (const f of closers) f();
    await post(rt, "/api/mod/beat", { name: "Hunt Two Go" }, { moderator: true });
    expect((await poll(rt, -1)).voice.held, "an iPhone's page sleeps and drops its stream").toBe(true);
    rt.dispose();
  });

  it("forgets the scene on a restart, and the rest of the lines play", async () => {
    const rt = runtime();
    const clippy = await booth(rt, "Clippy");
    const res = await stream(rt, "prime", clippy);
    await post(rt, "/api/mod/beat", { name: "Second Hunt" }, { moderator: true });
    await post(rt, "/api/aloud", { scene: frames(res).at(-1)!.id, op: "here", open: true }, { token: clippy });
    expect((await poll(rt, -1)).voice.held).toBe(true);
    (rt as unknown as { pushLifecycle(k: string): void }).pushLifecycle("reset");
    expect((await poll(rt, -1)).voice.held).toBeUndefined();
    rt.dispose();
  });

  it("is on the host allowlist", () => {
    expect(isHostRoute("POST", "/api/mod/aloud", { action: "release" }, { alertsPath: "", isAgent: () => false })).toBe(true);
  });
});
