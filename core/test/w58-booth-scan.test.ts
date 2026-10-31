// Wave 58: everyone scans. `/api/prime/codex/redeem` over the real runtime and
// the real show: all 8 booth parts, every coded entry (`secret` ones too), and
// nothing in the story misfires when a part learns something. Every code here
// comes from the compiled model, so none is ever written down, and a failure
// names the entry's title, never its code.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { scenarioSource } from "../examples/load.ts";
import type { AgentFacts, AgentRequest } from "../server/agents.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { PrimeView } from "../server/views.ts";
import type { Sim } from "../src/runtime/sim/sim.ts";

const CODES = { event: "GUEST1", prime: "PRIME1", mod: "MOD111" };
const SRC = scenarioSource("trapped-in-the-internet");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** The eight parts a phone signs in as. The Installation Wizard is a voice and
 *  a director has no identity: neither can hold an entry. */
const PARTS = ["Clippy", "Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software", "Task Manager", "Adobe Acrobat", "Recycling Bin"];
const REDEEM = "/api/prime/codex/redeem";

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
async function get(rt: EventRuntime, pathAndQuery: string, moderator = false) {
  const r = fakeRes();
  const url = new URL(`http://x${pathAndQuery}`);
  await rt.handle(fakeReq({}), r, "GET", url.pathname, url, { moderator });
  return r;
}
function storeDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-w58-"));
  dirs.push(d);
  return d;
}
function runtime(dir = storeDir(), open = true): EventRuntime {
  const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: "titi", scenarioSource: SRC, joinBase: () => "http://localhost" });
  if (open) rt.openDoors();
  return rt;
}
const simOf = (rt: EventRuntime) => (rt as unknown as { sim: Sim }).sim;
const booth = async (rt: EventRuntime, character: string) => (await post(rt, "/api/prime/login", { character, passcode: CODES.prime })).json.token as string;
const guest = async (rt: EventRuntime, name: string) => {
  const g = await post(rt, "/api/guest/register", { name, passcode: CODES.event });
  expect(g.status).toBe(200);
  return { id: g.json.id as string, token: g.json.token as string };
};
const primeView = async (rt: EventRuntime, token: string) => JSON.parse((await get(rt, `/api/state?role=prime&token=${encodeURIComponent(token)}`)).body) as PrimeView;

/** Every coded entry of the compiled story, one code each. */
function coded(sim: Sim): { code: string; entry: string; title: string; secret: boolean }[] {
  const seen = new Set<string>();
  const out: { code: string; entry: string; title: string; secret: boolean }[] = [];
  for (const [code, entry] of sim.model.codexCodes) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    const def = sim.model.codex.get(entry)!;
    out.push({ code, entry, title: def.title, secret: def.secret === true });
  }
  return out;
}
/** The four digit notes, under whichever name the story gives them. */
const digitNotes = (sim: Sim) => coded(sim).filter((e) => /\bDigit$/u.test(e.entry));
const entryNamed = (sim: Sim, id: string) => coded(sim).find((e) => e.entry === id)!;
/** The world minus what a holding itself writes. */
const worldBut = (sim: Sim, parts: readonly string[]) =>
  new Map(sim.worldEntries().filter((w) => !parts.some((p) => w.path === `${p}.codex` || w.path.startsWith(`${p}.codex.`))).map((w) => [w.path, w.value]));

describe("the show's coverage", () => {
  it("has the coded entries this wave promises, and The Door Code has no QR", () => {
    const sim = simOf(runtime());
    const all = coded(sim);
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter((e) => e.secret).length).toBeGreaterThan(0);
    expect(all.some((e) => e.entry === "ILOVEYOU")).toBe(true);
    expect(digitNotes(sim)).toHaveLength(4);
    expect(all.some((e) => e.entry === "The Door Code")).toBe(false);
  });

  it("lists exactly the eight parts as signable", async () => {
    const rt = runtime();
    for (const part of PARTS) expect(await booth(rt, part), part).toBeTruthy();
    const refused = await post(rt, "/api/prime/login", { character: "Installation Wizard", passcode: CODES.prime });
    expect(refused.status).toBe(409);
  });
});

describe("every part scans every coded entry", () => {
  it("holds them all, each once, with nothing else in the story moved", async () => {
    const rt = runtime();
    const sim = simOf(rt);
    const ada = await guest(rt, "Calculator");
    const entries = coded(sim);
    const tokens = new Map<string, string>();
    for (const part of PARTS) tokens.set(part, await booth(rt, part));
    const adaStream = await get(rt, `/events?role=guest&token=${encodeURIComponent(ada.token)}`);
    const streams = new Map<string, Awaited<ReturnType<typeof get>>>();
    for (const part of PARTS) streams.set(part, await get(rt, `/events?role=prime&token=${encodeURIComponent(tokens.get(part)!)}`));
    const messages = (s: { frames: Frame[] }) => s.frames.filter((f) => f.event === "message").map((f) => f.data as { kind: string; audience: unknown; channel: string });
    const adaBefore = messages(adaStream).length;
    const worldBefore = worldBut(sim, PARTS);
    const logFrom = sim.log.len();

    for (const part of PARTS) {
      const token = tokens.get(part)!;
      for (const e of entries) {
        // A part starts out holding what is `about` it, so that one is `already`.
        const held = sim.holdsCodex(part, e.entry);
        const r = await post(rt, REDEEM, { code: e.code }, { token });
        expect(r.status, `${part}: ${e.title}`).toBe(200);
        expect(r.json.unlocked, `${part}: ${e.title}`).toBe(held ? null : e.entry);
        if (held) expect(r.json.already, `${part}: ${e.title}`).toBe(e.entry);
        expect(r.json.title, `${part}: ${e.title}`).toBe(e.title);
        expect(r.json.missed).toBeUndefined();
      }
      const v = await primeView(rt, token);
      for (const e of entries) expect(v.codex?.some((c) => c.id === e.entry), `${part}: ${e.title}`).toBe(true);
      // A repeat is `already`, and journals nothing.
      const len = sim.log.len();
      const again = await post(rt, REDEEM, { code: entries[0]!.code }, { token });
      expect(again.json).toMatchObject({ unlocked: null, already: entries[0]!.entry, title: entries[0]!.title });
      expect(sim.log.len()).toBe(len);
    }

    // The story heard nothing it answers: no line, no reply, no objective.
    expect([...new Set(sim.log.since(logFrom).map((ev) => ev.type))]).toEqual(["codexUnlocked"]);
    expect(worldBut(sim, PARTS)).toEqual(worldBefore);
    // Each booth got its own cards and nothing else; a guest saw none of it.
    for (const part of PARTS) {
      const rows = messages(streams.get(part)!);
      expect(rows.length, part).toBeGreaterThan(0);
      for (const m of rows) expect(m.audience, part).toEqual([`@${part}`]);
    }
    expect(messages(adaStream).length).toBe(adaBefore);
  }, 120_000);

  it("the card lands in that booth's own Codex, and nobody else's", async () => {
    const rt = runtime();
    const sim = simOf(rt);
    const token = await booth(rt, "Recycling Bin");
    const other = await booth(rt, "Clippy");
    const mine = await get(rt, `/events?role=prime&token=${encodeURIComponent(token)}`);
    const theirs = await get(rt, `/events?role=prime&token=${encodeURIComponent(other)}`);
    const e = entryNamed(sim, "ILOVEYOU");
    expect((await post(rt, REDEEM, { code: e.code }, { token })).json.unlocked).toBe(e.entry);
    const cards = (s: { frames: Frame[] }) => s.frames.filter((f) => f.event === "message").map((f) => f.data as { kind: string; audience: unknown; codex?: { entry: string } }).filter((m) => m.kind === "codex");
    expect(cards(mine).at(-1)).toMatchObject({ audience: ["@Recycling Bin"], codex: { entry: e.entry } });
    expect(cards(theirs)).toEqual([]);
  });

  it("survives a restart: the journal replays the holding", async () => {
    const dir = storeDir();
    const rt = runtime(dir);
    const token = await booth(rt, "Task Manager");
    const e = entryNamed(simOf(rt), "ILOVEYOU");
    await post(rt, REDEEM, { code: e.code }, { token });
    const again = runtime(dir, false);
    expect(again.restore()).not.toBeNull();
    expect(simOf(again).holdsCodex("Task Manager", e.entry)).toBe(true);
  });
});

describe("a part scanning the notes and the bait", () => {
  it("four digit notes assemble nothing for staff, and break nothing", async () => {
    const rt = runtime();
    const sim = simOf(rt);
    for (const part of PARTS) {
      const token = await booth(rt, part);
      const before = worldBut(sim, [part]);
      for (const note of digitNotes(sim)) expect((await post(rt, REDEEM, { code: note.code }, { token })).json.unlocked).toBe(note.entry);
      expect(sim.holdsCodex(part, "The Door Code"), part).toBe(false);
      expect(worldBut(sim, [part])).toEqual(before);
    }
  });

  it("ILOVEYOU infects no part, and costs Trabolta no composure over The LiveJournal", async () => {
    const rt = runtime();
    const sim = simOf(rt);
    const token = await booth(rt, "Norton Anti-Virus");
    const composure = sim.world.peek("Trabolta.composure");
    for (const id of ["ILOVEYOU", "The LiveJournal"]) {
      const e = coded(sim).find((c) => c.entry === id);
      if (e !== undefined) await post(rt, REDEEM, { code: e.code }, { token });
    }
    expect(sim.world.peek("Norton Anti-Virus.carries_virus")).toBeNull();
    expect(sim.world.peek("Trabolta.composure")).toEqual(composure);
  });

  it("Share still passes anything a part holds (the user's call): four shared notes do assemble it for a guest", async () => {
    const rt = runtime();
    const sim = simOf(rt);
    const token = await booth(rt, "Clippy");
    const ada = await guest(rt, "Calculator");
    for (const note of digitNotes(sim)) {
      await post(rt, REDEEM, { code: note.code }, { token });
      expect((await post(rt, "/api/prime/codex/share", { entry: note.entry, to: ada.id }, { token })).json.shared).toBe(true);
    }
    expect(sim.holdsCodex(ada.id, "The Door Code")).toBe(true);
    expect(sim.holdsCodex("Clippy", "The Door Code")).toBe(false);
  });

  it("Clippy earns no ⭐ and no award credit for a scan", async () => {
    const rt = runtime();
    const sim = simOf(rt);
    const token = await booth(rt, "Clippy");
    const stars = () => sim.worldEntries().filter((w) => /^Clippy\.(score|stars|points)/u.test(w.path)).map((w) => `${w.path}=${w.value}`);
    const before = stars();
    for (const e of coded(sim).slice(0, 12)) await post(rt, REDEEM, { code: e.code }, { token });
    expect(stars()).toEqual(before);
    expect(sim.worldEntries().filter((w) => w.path.startsWith("Clippy.codex_in"))).toEqual([]);
  });
});

describe("a miss", () => {
  it("commits nothing: no journal line, no doubt, no Password Manager, and it says nothing of any entry", async () => {
    const rt = runtime();
    const sim = simOf(rt);
    const token = await booth(rt, "CRA Agent Software");
    const pm = await booth(rt, "Password Manager");
    const pmStream = await get(rt, `/events?role=prime&token=${encodeURIComponent(pm)}`);
    const pmFrames = pmStream.frames.length;
    const len = sim.log.len();
    const r = await post(rt, REDEEM, { code: "no such code at all" }, { token });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, unlocked: null, missed: true });
    expect(sim.log.len()).toBe(len);
    expect(pmStream.frames.length).toBe(pmFrames);
  });

  it("is limited like a guest's: eight a minute, then a hit waits too", async () => {
    const rt = runtime();
    const sim = simOf(rt);
    const token = await booth(rt, "McAfee Anti-Virus");
    for (let i = 0; i < 8; i += 1) expect((await post(rt, REDEEM, { code: `nothing ${i}` }, { token })).status).toBe(200);
    const e = coded(sim)[0]!;
    const held = await post(rt, REDEEM, { code: e.code }, { token });
    expect(held.status).toBe(429);
    expect(sim.holdsCodex("McAfee Anti-Virus", e.entry)).toBe(false);
    // One part's misses are that part's.
    const other = await booth(rt, "Task Manager");
    expect((await post(rt, REDEEM, { code: e.code }, { token: other })).status).toBe(200);
  });

  it("refuses an empty code and a wall of text before anything else", async () => {
    const rt = runtime();
    const token = await booth(rt, "Clippy");
    expect((await post(rt, REDEEM, { code: "   " }, { token })).status).toBe(400);
    expect((await post(rt, REDEEM, { code: "x".repeat(65) }, { token })).status).toBe(400);
  });
});

describe("who may call it", () => {
  it("a guest, a director and nobody are refused; every host part is not (off the host allowlist's surface)", async () => {
    const rt = runtime();
    const sim = simOf(rt);
    const e = coded(sim)[0]!;
    const ada = await guest(rt, "Calculator");
    expect((await post(rt, REDEEM, { code: e.code }, { token: ada.token })).status).toBe(403);
    expect((await post(rt, REDEEM, { code: e.code })).status).toBe(403);
    const mod = (await post(rt, "/api/mod/login", { passcode: CODES.mod })).json.token as string;
    expect((await post(rt, REDEEM, { code: e.code }, { token: mod })).status).toBe(403);
    for (const host of ["Task Manager", "Adobe Acrobat", "Recycling Bin"]) {
      const t = await booth(rt, host);
      const r = await post(rt, REDEEM, { code: e.code }, { token: t });
      expect(r.status, host).toBe(200);
      expect(r.json.unlocked, host).toBe(e.entry);
    }
  });

  it("closed doors and a paused show answer 409, as for a guest; nothing is held", async () => {
    const rt = runtime(storeDir(), false);
    const token = await booth(rt, "Clippy");
    expect((await post(rt, REDEEM, { code: "anything" }, { token })).status).toBe(409);
    rt.openDoors();
    const sim = simOf(rt);
    const e = coded(sim)[0]!;
    expect((await post(rt, "/api/mod/stop", {}, { moderator: true })).status).toBe(200);
    const r = await post(rt, REDEEM, { code: e.code }, { token });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("doors are closed");
    expect(sim.holdsCodex("Clippy", e.entry)).toBe(false);
  });

  it("a locked guest stays locked: neither route helps them, and a part is never locked", async () => {
    const rt = runtime();
    const sim = simOf(rt);
    const e = coded(sim)[0]!;
    const ada = await guest(rt, "Calculator");
    expect((await post(rt, "/api/mod/var", { path: `${ada.id}.corrupted`, value: "true" }, { moderator: true })).status).toBe(200);
    const locked = await post(rt, "/api/guest/codex/redeem", { code: e.code }, { token: ada.token });
    expect(locked.status).toBe(403);
    expect(locked.json.error).toBe("locked");
    expect((await post(rt, REDEEM, { code: e.code }, { token: ada.token })).status).toBe(403);
    expect(sim.holdsCodex(ada.id, e.entry)).toBe(false);
    const token = await booth(rt, "Norton Anti-Virus");
    expect((await post(rt, REDEEM, { code: e.code }, { token })).status).toBe(200);
  });

  it("an operator playing an agent-voiced part launders nothing into its prompt", async () => {
    const rt = runtime();
    const sim = simOf(rt);
    const played = await post(rt, "/api/mod/impersonate", { role: "prime", id: "Trabolta" }, { moderator: true });
    expect(played.status).toBe(200);
    const token = played.json.token as string;
    const secret = coded(sim).find((e) => e.secret)!;
    const r = await post(rt, REDEEM, { code: secret.code }, { token });
    expect(r.status).toBe(403);
    expect(sim.holdsCodex("Trabolta", secret.entry)).toBe(false);
    const about = coded(sim).find((e) => !e.secret && (sim.model.codex.get(e.entry)?.about ?? "Trabolta") !== "Trabolta");
    if (about !== undefined) {
      expect((await post(rt, REDEEM, { code: about.code }, { token })).status).toBe(403);
      expect(sim.holdsCodex("Trabolta", about.entry)).toBe(false);
    }
  });
});

describe("what an agent can read of a part's holdings", () => {
  it("a part's secret entries never reach the facts document or a request, by title, flag or text", async () => {
    const rt = runtime();
    const sim = simOf(rt);
    const entries = coded(sim);
    const token = await booth(rt, "Clippy");
    for (const e of entries) await post(rt, REDEEM, { code: e.code }, { token });
    const secrets = entries.filter((e) => e.secret);
    expect(secrets.length).toBeGreaterThan(0);

    const facts = JSON.parse((await get(rt, "/api/agent/facts", true)).body) as AgentFacts;
    const clippy = facts.characters.find((c) => c.id === "Clippy")!;
    for (const e of secrets) expect(clippy.codex, e.title).not.toContain(e.title);
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/gu, "_");
    for (const key of Object.keys(clippy.vars)) expect(secrets.some((e) => key === `codex.${slug(e.entry)}`), key).toBe(false);

    // A performer's own line to him: `them` carries the holdings the worker reads.
    const worker = await get(rt, "/api/agent/stream?characters=Trabolta&name=laptop", true);
    expect((await post(rt, "/api/prime/say", { channel: "cast:Trabolta", text: "Hello?" }, { token })).status).toBe(200);
    const request = worker.frames.filter((f) => f.event === "request").map((f) => f.data as AgentRequest).at(-1)!;
    expect(request).toBeDefined();
    expect(request.speaker).toMatchObject({ kind: "performer", id: "Clippy" });
    const body = JSON.stringify({ them: request.them, self: request.self });
    for (const e of secrets) {
      expect(body.includes(e.title), e.title).toBe(false);
      const text = sim.model.codex.get(e.entry)!.text;
      if (text.length > 20) expect(body.includes(text), e.title).toBe(false);
    }
    // No request carries a code at all (some codes are everyday words, so this
    // reads the shape, not the text).
    for (const row of request.them.codex) expect(Object.keys(row).sort()).toEqual(["about", "id", "text", "title"]);
  }, 60_000);
});

describe("a guest scans a secret entry (the user's word: guests can scan secrets too)", () => {
  it("every coded `secret` entry unlocks for a guest with its code", async () => {
    const rt = runtime();
    const sim = simOf(rt);
    const ada = await guest(rt, "Calculator");
    for (const e of coded(sim).filter((c) => c.secret)) {
      const r = await post(rt, "/api/guest/codex/redeem", { code: e.code }, { token: ada.token });
      expect(r.status, e.title).toBe(200);
      expect(r.json.unlocked, e.title).toBe(e.entry);
      expect(r.json.title, e.title).toBe(e.title);
    }
  }, 60_000);

  it("a guest's own miss is still the story event it always was", async () => {
    const rt = runtime();
    const sim = simOf(rt);
    const ada = await guest(rt, "Calculator");
    const from = sim.log.len();
    const r = await post(rt, "/api/guest/codex/redeem", { code: "no such code at all" }, { token: ada.token });
    expect(r.json.missed).toBe(true);
    expect(sim.log.since(from).some((ev) => ev.type === "codexMissed")).toBe(true);
  });
});
