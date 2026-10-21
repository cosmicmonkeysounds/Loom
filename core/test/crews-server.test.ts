//! Wave 18 (C10) — the crews + recruiting routes (`routes/crews.ts`): name
//! moderation, caps, the side-recruit refusals (`/api/guest/join`'s own
//! rules), the invite card, the journal (a restart rebuilds every crew,
//! member, invitation and answered card), agent masking and the director's
//! rename / dissolve.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { ChatMessage } from "../server/chat.ts";
import { JOINS_PER_MINUTE, crewNameRefusal } from "../server/routes/crews.ts";
import { parseFactsBook } from "../server/facts.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { CREW_SOURCE } from "./crews.fixture.ts";

const CODES = { event: "EVT180", prime: "PRM180", mod: "MOD180" };

/** A made-up key (nothing from the show): one hunt answer and a door code. */
const FACTS = JSON.stringify({
  version: 1,
  questions: [{ id: "Q1", round: 1, text: "Who is the pet?", answer: "Purple Walrus", accept: ["the walrus"] }],
  answers: [{ id: "P1", text: "The line", answer: "made of stars", accept: [] }],
  door: { code: "4821", clues: [] },
});

const SOURCE = CREW_SOURCE.replace(
  "ROLE Guest\n",
  "CHARACTER Kernel\n  secret: true\n\nCHARACTER Trabolta\n  mind: external\n\nROLE Guest\n",
);

const dirs: string[] = [];
let clock = 5_000_000;
function fresh(dir?: string): { rt: EventRuntime; dir: string } {
  const d = dir ?? mkdtempSync(join(tmpdir(), "loom-crews-"));
  if (dir === undefined) dirs.push(d);
  const rt = new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "crews",
    scenarioSource: SOURCE,
    joinBase: () => "http://localhost",
    now: () => clock,
    facts: FACTS,
  });
  return { rt, dir: d };
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
  await rt.handle(fakeReq(body), res, "POST", path, new URL(`http://x${path}`), { moderator });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
async function state(rt: EventRuntime, token: string) {
  const res = fakeRes();
  const url = new URL(`http://x/api/state?role=guest&token=${encodeURIComponent(token)}`);
  await rt.handle(fakeReq({}), res, "GET", url.pathname, url, { moderator: false });
  return JSON.parse(res.body || "{}") as Record<string, unknown>;
}
async function guest(rt: EventRuntime, name: string): Promise<{ id: string; token: string }> {
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event });
  return { id: r.json.id as string, token: r.json.token as string };
}
const chat = (rt: EventRuntime): ChatMessage[] => (rt as unknown as { chat: { all(): ChatMessage[] } }).chat.all();

async function party(): Promise<{ rt: EventRuntime; dir: string; a: { id: string; token: string }; b: { id: string; token: string }; c: { id: string; token: string } }> {
  const { rt, dir } = fresh();
  rt.openDoors();
  const a = await guest(rt, "Ada");
  const b = await guest(rt, "Bob");
  const c = await guest(rt, "Cy");
  return { rt, dir, a, b, c };
}

describe("crew name moderation", () => {
  const sim = Sim.fromSources(SOURCE);
  sim.createPerson("g1", "Ada Lovelace");
  sim.setVar("Kernel.pairs", "Q7-Z3, K2-M9");
  const book = parseFactsBook(FACTS).book;
  const why = (n: string) => crewNameRefusal(sim, n, book);

  it("takes an ordinary name", () => {
    expect(why("The Night Shift")).toBeNull();
    expect(why("Team 7")).toBeNull();
  });
  it("2 to 24 characters, with a letter or a number", () => {
    expect(why("A")).toMatch(/2 to 24/u);
    expect(why("x".repeat(25))).toMatch(/2 to 24/u);
    expect(why("!!!")).toMatch(/letter or a number/u);
  });
  it("no rude words, inside a word or as one", () => {
    expect(why("Fvck no, Fuckers")).toMatch(/friendlier/u);
    expect(why("Big Dick Energy")).toMatch(/friendlier/u);
    expect(why("Dickens Club")).toBeNull(); // a whole-word-only word inside another
  });
  it("never a lookalike of a group, a character, a place, a guest or the story", () => {
    expect(why("hosts")).toMatch(/taken/u);
    expect(why("R E D")).toMatch(/taken/u);
    expect(why("Trabolta")).toMatch(/taken/u);
    expect(why("hall")).toMatch(/taken/u);
    expect(why("Ada Lovelace")).toMatch(/taken/u);
    expect(why("AdaLovelace")).toMatch(/taken/u);
    expect(why("Crew Night")).toMatch(/taken/u);
  });
  it("never an oracle: a name that says a secret is judged like any other name (A1)", () => {
    expect(why("Purple Walruses")).toBeNull();
    expect(why("The Walrus Club")).toBeNull();
    expect(why("Made Of Stars")).toBeNull();
    expect(why("Crew 4821")).toBeNull();
    expect(why("q7 z3 gang")).toBeNull();
  });
  it("refuses hidden characters and markup instead of stripping them (A6)", () => {
    expect(why("a\u200bb\u200bc")).toMatch(/Letters, numbers/u);
    expect(why("\u202Eevil crew")).toMatch(/Letters, numbers/u);
    expect(why("<img src=x>")).toMatch(/Letters, numbers/u);
  });
  it("refuses the house's own names and a missing 'the' (A6)", () => {
    for (const n of ["Gerald", "Operator", "Narrator", "Norton", "McAfee", "Windows Defender", "Recycle Bin", "Server Room"]) expect(why(n)).toMatch(/taken/u);
  });
});

describe("crew routes", () => {
  it("found → a crew + its room; one per guest; a refused name says why", async () => {
    const { rt, a, b } = await party();
    const bad = await post(rt, "/api/guest/crew/found", { token: a.token, name: "Red" });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("That name is taken. Try another.");
    const ok = await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    expect(ok.status).toBe(200);
    expect(ok.json.crew).toMatchObject({ id: "crew-1", name: "Night Shift", founder: a.id, members: [a.id], room: "crew:crew-1" });
    expect((await post(rt, "/api/guest/crew/found", { token: a.token, name: "Day Shift" })).status).toBe(409);
    const view = await state(rt, a.token);
    expect(view.crew).toMatchObject({ id: "crew-1" });
    expect((view.channels as Array<{ id: string }>).some((c) => c.id === "crew:crew-1")).toBe(true);
    expect(chat(rt).some((m) => m.channel === "crew:crew-1" && m.kind === "system" && Array.isArray(m.audience) && m.audience.includes(a.id))).toBe(true);
    // The room: members post, everyone else is told it isn't there.
    expect((await post(rt, "/api/guest/say", { token: a.token, channel: "crew:crew-1", text: "hi" })).status).toBe(200);
    expect((await post(rt, "/api/guest/say", { token: b.token, channel: "crew:crew-1", text: "hi" })).status).toBe(404);
  });

  it("the doors and the restriction hold", async () => {
    const { rt, a } = await party();
    rt.pause();
    expect((await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" })).status).toBe(409);
    rt.openDoors();
    expect((await post(rt, "/api/mod/act", { action: "restrict", id: a.id }, true)).status).toBeLessThan(300);
    expect(rt.liveSim!.isRestricted(a.id)).toBe(true);
    expect((await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" })).status).toBe(403);
  });

  it("invite → a big invite card in the private thread → yes joins; a restart rebuilds it all", async () => {
    const { rt, dir, a, b } = await party();
    await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    const inv = await post(rt, "/api/guest/crew/invite", { token: a.token, to: b.id });
    expect(inv.status).toBe(200);
    expect(inv.json).toMatchObject({ ok: true, invite: "inv-1", kind: "crew", target: "crew-1", targetName: "Night Shift" });
    // A repeat is the same invitation, no second card.
    expect((await post(rt, "/api/guest/crew/invite", { token: a.token, to: b.id })).json.already).toBe(true);
    const cards = chat(rt).filter((m) => m.kind === "widget" && m.widget?.kind === "invite");
    expect(cards).toHaveLength(1);
    const card = cards[0]! as ChatMessage & { go?: unknown };
    expect(card.channel).toBe(Sim.pmChannel(a.id, b.id));
    expect(card.audience).toEqual([b.id]);
    expect(card.moment as string).toBe("big");
    expect(card.widget!.params).toMatchObject({ invite: "inv-1", kind: "crew", from: a.id, fromName: "Ada", target: "crew-1", targetName: "Night Shift" });
    expect(card.text).toBe("Ada wants you in Night Shift");
    expect((await state(rt, b.token)).invites).toEqual([{ id: "inv-1", from: a.id, fromName: "Ada", kind: "crew", target: "crew-1", targetName: "Night Shift" }]);
    // Only the invitee answers.
    expect((await post(rt, "/api/guest/recruit/answer", { token: a.token, id: "inv-1", yes: true })).status).toBe(404);
    const yes = await post(rt, "/api/guest/recruit/answer", { token: b.token, id: "inv-1", yes: true });
    expect(yes.json).toMatchObject({ ok: true, joined: true, kind: "crew", target: "crew-1" });
    expect((await post(rt, "/api/guest/recruit/answer", { token: b.token, id: "inv-1", yes: true })).status).toBe(409);
    const view = await state(rt, b.token);
    expect(view.crew).toMatchObject({ members: [a.id, b.id] });
    expect(view.answered).toContain(card.seq);
    expect(chat(rt).some((m) => m.kind === "system" && m.text === "✓ Bob joined Night Shift." && Array.isArray(m.audience) && m.audience[0] === a.id)).toBe(true);
    const seqs = chat(rt).map((m) => `${m.seq}:${m.channel}:${m.text}`);

    // A process restart replays the journal into a fresh sim.
    const again = fresh(dir).rt;
    expect(again.restore()).not.toBeNull();
    const sim = again.liveSim!;
    expect(sim.crews.crewOf(b.id)?.id).toBe("crew-1");
    expect(sim.crews.invite("inv-1")?.state).toBe("yes");
    expect(chat(again).map((m) => `${m.seq}:${m.channel}:${m.text}`)).toEqual(seqs);
    const after = await state(again, b.token);
    expect(after.answered).toContain(card.seq);
    expect(after.crew).toMatchObject({ id: "crew-1", members: [a.id, b.id] });
  });

  it("an invitation card answered as a plain widget is refused, never spent (A8)", async () => {
    const { rt, a, b } = await party();
    await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    await post(rt, "/api/guest/crew/invite", { token: a.token, to: b.id });
    const card = chat(rt).find((m) => m.kind === "widget" && m.widget?.kind === "invite")!;
    expect((await post(rt, "/api/guest/widget", { token: b.token, seq: card.seq, result: { yes: true } })).status).toBe(409);
    expect(rt.liveSim!.crews.invite("inv-1")?.state).toBe("open");
    expect((await post(rt, "/api/guest/recruit/answer", { token: b.token, id: "inv-1", yes: true })).status).toBe(200);
  });

  it("leave the crew; the founder leaving last dissolves it", async () => {
    const { rt, a } = await party();
    await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    expect((await post(rt, "/api/guest/crew/leave", { token: a.token })).status).toBe(200);
    expect(rt.liveSim!.crews.all()).toEqual([]);
    expect((await post(rt, "/api/guest/crew/leave", { token: a.token })).status).toBe(409);
  });

  it("a name check is never free: refused founds count toward a per-minute cap (A1)", async () => {
    const { rt, a } = await party();
    for (let i = 0; i < 6; i++) expect((await post(rt, "/api/guest/crew/found", { token: a.token, name: "Red" })).status).toBe(400);
    expect((await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" })).status).toBe(429);
    clock += 61_000;
    expect((await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" })).status).toBe(200);
  });

  it("a captured program can't found or invite (A5)", async () => {
    const { rt, a, b } = await party();
    await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    rt.liveSim!.world.set(`${a.id}.captured`, { kind: "bool", value: true });
    rt.liveSim!.world.set(`${b.id}.captured`, { kind: "bool", value: true });
    expect(rt.liveSim!.isCaptured(b.id)).toBe(true);
    expect((await post(rt, "/api/guest/crew/found", { token: b.token, name: "Day Shift" })).status).toBe(409);
    expect((await post(rt, "/api/guest/crew/invite", { token: a.token, to: b.id })).status).toBe(409);
  });

  it("a founder who left a crew that lives on may found another (A4)", async () => {
    const { rt, a, b } = await party();
    await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    await post(rt, "/api/guest/crew/invite", { token: a.token, to: b.id });
    await post(rt, "/api/guest/recruit/answer", { token: b.token, id: "inv-1", yes: true });
    expect((await post(rt, "/api/guest/crew/leave", { token: a.token })).status).toBe(200);
    expect(rt.liveSim!.crews.crewOf(b.id)?.id).toBe("crew-1");
    expect((await post(rt, "/api/guest/crew/found", { token: a.token, name: "Day Shift" })).status).toBe(200);
  });

  it("eight crews at most", async () => {
    const { rt } = fresh();
    rt.openDoors();
    for (let i = 1; i <= 9; i++) {
      const g = await guest(rt, `Prog ${i}`);
      const r = await post(rt, "/api/guest/crew/found", { token: g.token, name: `Gang ${"ABCDEFGHI"[i - 1]}` });
      expect(r.status).toBe(i <= 8 ? 200 : 409);
    }
  });
});

describe("recruiting into a side", () => {
  it("refuses before the reveal, from an unaligned recruiter, into a side they aren't on", async () => {
    const { rt, a, b } = await party();
    expect((await post(rt, "/api/guest/recruit", { token: a.token, to: b.id, side: "Red" })).status).toBe(403); // hidden
    rt.liveSim!.reveal("Red");
    const unaligned = await post(rt, "/api/guest/recruit", { token: a.token, to: b.id });
    expect(unaligned.status).toBe(409);
    expect(unaligned.json.error).toBe("Join a side first, then scan Bob's pass to recruit them.");
    expect((await post(rt, "/api/guest/recruit", { token: a.token, to: b.id, side: "Red" })).status).toBe(403);
    expect((await post(rt, "/api/guest/recruit", { token: a.token, to: b.id, side: "Hosts" })).status).toBe(403);
  });

  it("recruits by pass: the target's yes is the switching join, `recruited` fires by the recruiter", async () => {
    const { rt, a, b, c } = await party();
    const sim = rt.liveSim!;
    sim.reveal("Red");
    sim.reveal("Blue");
    expect((await post(rt, "/api/guest/join", { token: a.token, faction: "Red" })).status).toBe(200);
    expect((await post(rt, "/api/guest/join", { token: c.token, faction: "Blue" })).status).toBe(200);
    const r = await post(rt, "/api/guest/recruit", { token: a.token, to: b.id });
    expect(r.json).toMatchObject({ ok: true, invite: "inv-1", kind: "side", target: "Red" });
    expect((await state(rt, b.token)).invites).toEqual([{ id: "inv-1", from: a.id, fromName: "Ada", kind: "side", target: "Red", targetName: "Red" }]);
    expect((await post(rt, "/api/guest/recruit/answer", { token: b.token, id: "inv-1", yes: true })).status).toBe(200);
    expect(sim.factionOf(b.id)).toBe("Red");
    expect(sim.world.get(`${a.id}.recruits`)).toEqual({ kind: "number", value: 1 });
    // Already there.
    const again = await post(rt, "/api/guest/recruit", { token: a.token, to: b.id });
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("Bob is already in Red.");
    // From the other side: a defect.
    await post(rt, "/api/guest/recruit", { token: a.token, to: c.id });
    await post(rt, "/api/guest/recruit/answer", { token: c.token, id: "inv-2", yes: true });
    expect(sim.factionOf(c.id)).toBe("Red");
    expect(sim.factionMembers("Blue")).toEqual([]);
  });

  it("the answer is checked again: a restricted invitee, a side hidden again, a leader", async () => {
    const { rt, a, b, c } = await party();
    const sim = rt.liveSim!;
    sim.reveal("Red");
    sim.reveal("Blue");
    await post(rt, "/api/guest/join", { token: a.token, faction: "Red" });
    await post(rt, "/api/guest/recruit", { token: a.token, to: b.id });
    await post(rt, "/api/mod/act", { action: "restrict", id: b.id }, true);
    expect((await post(rt, "/api/guest/recruit/answer", { token: b.token, id: "inv-1", yes: true })).status).toBe(403);
    expect(sim.factionOf(b.id)).toBeNull();
    // A restricted target can't be recruited at all.
    const t = await post(rt, "/api/guest/recruit", { token: a.token, to: b.id });
    expect(t.status).toBe(409);
    expect(t.json.error).toBe("Bob can't join anything right now.");
    // A leader of the other side stays there.
    await post(rt, "/api/guest/join", { token: c.token, faction: "Blue" });
    sim.setVar("Blue.leader", c.id);
    const led = await post(rt, "/api/guest/recruit", { token: a.token, to: c.id });
    expect(led.status).toBe(409);
    expect(led.json.error).toBe("Cy leads Blue. Leaders stay with their side.");
    expect((await post(rt, "/api/guest/side/leave", { token: c.token })).status).toBe(403);
  });

  it("side/leave is back to neither; the majority counts only the sides", async () => {
    const { rt, a, b, c } = await party();
    const sim = rt.liveSim!;
    sim.reveal("Red");
    await post(rt, "/api/guest/join", { token: a.token, faction: "Red" });
    await post(rt, "/api/guest/join", { token: b.token, faction: "Red" });
    await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    await post(rt, "/api/guest/crew/invite", { token: a.token, to: b.id });
    await post(rt, "/api/guest/recruit/answer", { token: b.token, id: "inv-1", yes: true });
    expect(sim.factionMembers("Red").sort()).toEqual([a.id, b.id].sort());
    expect((await post(rt, "/api/guest/side/leave", { token: b.token })).status).toBe(200);
    expect(sim.factionOf(b.id)).toBeNull();
    expect(sim.factionMembers("Red")).toEqual([a.id]);
    expect(sim.crews.crewOf(b.id)?.id).toBe("crew-1"); // the crew stays
    expect((await post(rt, "/api/guest/side/leave", { token: b.token })).status).toBe(409);
    // With no side, a recruit goes to your crew.
    const r = await post(rt, "/api/guest/recruit", { token: b.token, to: c.id });
    expect(r.json).toMatchObject({ kind: "crew", target: "crew-1" });
  });
});

describe("crews and agents, booths, directors", () => {
  it("no crew path reaches an agent request", async () => {
    const { rt, a } = await party();
    await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    const sim = rt.liveSim!;
    const world = sim.worldEntries();
    expect(world.some((w) => w.path.startsWith("crew-1."))).toBe(true);
    const priv = rt as unknown as {
      agentGlobals(w: typeof world): Record<string, string>;
      agentVarsOf(w: typeof world): (head: string) => Record<string, string>;
    };
    expect(Object.keys(priv.agentGlobals(world)).filter((k) => k.startsWith("crew-"))).toEqual([]);
    expect(priv.agentVarsOf(world)(a.id)["crew"]).toBeUndefined();
  });

  it("a director renames (moderated) and dissolves", async () => {
    const { rt, a } = await party();
    await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    expect((await post(rt, "/api/mod/crew/rename", { crew: "crew-1", name: "Blue" }, true)).status).toBe(400);
    expect((await post(rt, "/api/mod/crew/rename", { crew: "crew-9", name: "Day Shift" }, true)).status).toBe(404);
    const ok = await post(rt, "/api/mod/crew/rename", { crew: "crew-1", name: "Day Shift" }, true);
    expect(ok.json.crew).toMatchObject({ name: "Day Shift" });
    // A guest token can't.
    expect((await post(rt, "/api/mod/crew/dissolve", { token: a.token, crew: "crew-1" })).status).toBe(403);
    expect((await post(rt, "/api/mod/crew/dissolve", { crew: "crew-1" }, true)).status).toBe(200);
    expect(rt.liveSim!.crews.all()).toEqual([]);
    expect((await state(rt, a.token)).crew).toBeNull();
  });
});

describe("a host's crew controls (M3)", () => {
  it("the host view lists the crews; rename and dissolve work from a host booth", async () => {
    const { rt, a } = await party();
    await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    const res = Object.assign(fakeRes(), { setHeader() {} });
    const url = new URL("http://x/api/state?role=mod&host=1");
    await rt.handle(fakeReq({}), res, "GET", url.pathname, url, { moderator: true });
    const view = JSON.parse(res.body) as { crews?: Array<{ id: string; name: string; members: number }> };
    expect(view.crews).toEqual([{ id: "crew-1", name: "Night Shift", members: 1 }]);
    expect((await post(rt, "/api/mod/crew/rename", { crew: "crew-1", name: "Day Shift" }, true)).status).toBe(200);
    expect(rt.liveSim!.crews.get("crew-1")?.name).toBe("Day Shift");
  });
});

// ───────────────────────── wave 18b: faction mode ─────────────────────────

const MINI = readFileSync(new URL("./fixtures/w18b-mini/main.loom", import.meta.url), "utf8");
const MINI_FACTS = readFileSync(new URL("./fixtures/w18b-mini/facts.json", import.meta.url), "utf8");

function freshMini(dir?: string, source = MINI): { rt: EventRuntime; dir: string } {
  const d = dir ?? mkdtempSync(join(tmpdir(), "loom-factions-"));
  if (dir === undefined) dirs.push(d);
  const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "mini", scenarioSource: source, joinBase: () => "http://localhost", now: () => clock, facts: MINI_FACTS });
  return { rt, dir: d };
}
const cue = (rt: EventRuntime, name: string, subject = "") => post(rt, "/api/mod/signal", { name, ...(subject !== "" ? { subject } : {}) }, true);

async function factions(): Promise<{ rt: EventRuntime; dir: string; g: Array<{ id: string; token: string }> }> {
  const { rt, dir } = freshMini();
  rt.openDoors();
  const g: Array<{ id: string; token: string }> = [];
  for (const n of ["Ada", "Bob", "Cy", "Dee", "Eve"]) g.push(await guest(rt, n));
  await cue(rt, "clear_everyone");
  return { rt, dir, g };
}

describe("faction mode (wave 18b)", () => {
  it("founding opens only inside the founding: window, and says nothing of why", async () => {
    const { rt, g } = await factions();
    const early = await post(rt, "/api/guest/crew/found", { token: g[0]!.token, name: "Night Shift" });
    expect(early).toMatchObject({ status: 403, json: { error: "You can't found a faction right now." } });
    await cue(rt, "truther_download");
    const ok = await post(rt, "/api/guest/crew/found", { token: g[0]!.token, name: "Night Shift" });
    expect(ok.status).toBe(200);
    // Midnight closes it.
    await cue(rt, "midnight");
    expect((await post(rt, "/api/guest/crew/found", { token: g[1]!.token, name: "Day Shift" })).status).toBe(403);
  });

  it("a walk-in join, its refusals, and a founder's leave disbands", async () => {
    const { rt, g } = await factions();
    await cue(rt, "truther_download");
    const [a, b, c, d, e] = g as [typeof g[0], typeof g[0], typeof g[0], typeof g[0], typeof g[0]];
    await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    await post(rt, "/api/guest/crew/found", { token: b.token, name: "Day Shift" });
    expect(await post(rt, "/api/guest/crew/join", { token: c.token, crew: "nope" })).toMatchObject({ status: 404 });
    const joined = await post(rt, "/api/guest/crew/join", { token: c.token, crew: "crew-1" });
    expect(joined.status).toBe(200);
    expect(joined.json.crew).toMatchObject({ id: "crew-1", members: [a.id, c.id] });
    expect(await post(rt, "/api/guest/crew/join", { token: c.token, crew: "crew-1" })).toMatchObject({ status: 409 });
    // A founder elsewhere: disband first.
    expect(await post(rt, "/api/guest/crew/join", { token: b.token, crew: "crew-1" })).toMatchObject({ status: 409, json: { error: "Disband Day Shift first." } });
    // A side's leader stays with the side.
    await cue(rt, "make_leaders", d.id);
    expect(await post(rt, "/api/guest/crew/join", { token: d.token, crew: "crew-1" })).toMatchObject({ status: 409, json: { error: "Leaders stay with their side." } });
    // Restricted, captured.
    await post(rt, "/api/mod/act", { action: "restrict", id: e.id }, true);
    expect(await post(rt, "/api/guest/crew/join", { token: e.token, crew: "crew-1" })).toMatchObject({ status: 403 });
    await post(rt, "/api/mod/act", { action: "unrestrict", id: e.id }, true);
    await post(rt, "/api/mod/act", { action: "capture", id: e.id }, true);
    expect(await post(rt, "/api/guest/crew/join", { token: e.token, crew: "crew-1" })).toMatchObject({ status: 409 });
    // Switching: c walks from Night Shift into Day Shift.
    expect((await post(rt, "/api/guest/crew/join", { token: c.token, crew: "crew-2" })).status).toBe(200);
    expect(rt.liveSim!.crews.get("crew-1")!.members).toEqual([a.id]);
    // The founder's leave disbands.
    const left = await post(rt, "/api/guest/crew/leave", { token: b.token });
    expect(left).toMatchObject({ status: 200, json: { ok: true, dissolved: true } });
    expect(rt.liveSim!.crews.get("crew-2")).toBeNull();
    expect(rt.liveSim!.crews.crewOf(c.id)).toBeNull();
    expect(chat(rt).some((m) => m.text === "◇ Day Shift was dissolved." && m.audience.includes(c.id))).toBe(true);
  });

  it("no founder or leader is invited, recruited or moved into another faction", async () => {
    const { rt, g } = await factions();
    await cue(rt, "truther_download");
    const [a, b, , d] = g as [typeof g[0], typeof g[0], typeof g[0], typeof g[0]];
    await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    await post(rt, "/api/guest/crew/found", { token: b.token, name: "Day Shift" });
    expect(await post(rt, "/api/guest/crew/invite", { token: a.token, to: b.id })).toMatchObject({ status: 409, json: { error: "Bob founded Day Shift. Founders stay with their faction." } });
    await cue(rt, "make_leaders", d.id);
    expect(await post(rt, "/api/guest/crew/invite", { token: a.token, to: d.id })).toMatchObject({ status: 409, json: { error: "Dee leads Unlimited Power. Leaders stay with their side." } });
    // The sides open at the clock: a founder can't join one, nor be recruited into one.
    await cue(rt, "the_clock");
    expect(await post(rt, "/api/guest/join", { token: a.token, faction: "The Way Out" })).toMatchObject({ status: 409, json: { error: "Founders stay with their faction. Disband it first." } });
    expect(await post(rt, "/api/guest/defect", { token: a.token, to: "The Way Out" })).toMatchObject({ status: 409 });
    expect(await post(rt, "/api/guest/recruit", { token: d.token, to: a.id })).toMatchObject({ status: 409, json: { error: "Ada founded Night Shift. Founders stay with their faction." } });
    // A side's leader (Excel, OpenOffice) can't walk to the other side either.
    expect(await post(rt, "/api/guest/join", { token: d.token, faction: "The Way Out" })).toMatchObject({ status: 409, json: { error: "Leaders stay with their side." } });
    expect(await post(rt, "/api/guest/defect", { token: d.token, to: "The Way Out" })).toMatchObject({ status: 409, json: { error: "Leaders stay with their side." } });
    expect((await post(rt, "/api/guest/join", { token: d.token, faction: "Unlimited Power" })).status).toBe(200);
    expect(rt.liveSim!.crews.ledSide(d.id)).toBe("Unlimited Power");
  });

  it("a join that leaves a crew posts its line at once, and a restart posts the same", async () => {
    const { rt, dir, g } = await factions();
    await cue(rt, "truther_download");
    const [a, , c] = g as [typeof g[0], typeof g[0], typeof g[0]];
    await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    await post(rt, "/api/guest/crew/join", { token: c.token, crew: "crew-1" });
    await cue(rt, "the_clock");
    expect((await post(rt, "/api/guest/join", { token: c.token, faction: "The Way Out" })).status).toBe(200);
    const left = chat(rt).filter((m) => m.text === "◇ Cy left Night Shift.");
    expect(left).toHaveLength(1);
    expect(rt.liveSim!.crews.crewOf(c.id)).toBeNull();
    const live = chat(rt).map((m) => `${m.seq}|${m.channel}|${m.text}`);
    rt.dispose();
    const back = freshMini(dir).rt;
    back.restore();
    expect(chat(back).map((m) => `${m.seq}|${m.channel}|${m.text}`)).toEqual(live);
  });

  it("a crew line a story timer raises posts at the tick, and one raised mid-chain right after its commit, as a restart posts them", async () => {
    // The mini story plus a story clock, a watcher that walks a program to
    // The Way Out two ticks after a cue, and a filing that walks them there.
    const source =
      MINI.replace("  settle_gen: 0 to 99 = 0\n\nCHARACTER Kernel", "  settle_gen: 0 to 99 = 0\n  ticks: 0 to 99999 = 0\n  every 1s:\n    set self.ticks += 1\n\nCHARACTER Kernel")
        .replace("  settle_seen: 0 to 99 = 0\n", "  settle_seen: 0 to 99 = 0\n  drift_at: 0 to 99999 = 0\n  drifts: bool = false\n")
        .replace("  when answer answered for program:\n", "  when self.drift_at > 0 and Night.ticks >= self.drift_at:\n    set self.drift_at = 0\n    add self to The Way Out\n  when answer answered for program:\n")
        .replace("  when fact answered for program:\n", "  when fact answered for program:\n    if program.drifts == true:\n      add program to The Way Out\n") +
      `
INTERACTION drift_later
  who: admin
  sequence: false
INTERACTION drift_on_filing
  who: admin
  sequence: false

when drift_later for program:
  set program.drift_at = Night.ticks + 2

when drift_on_filing for program:
  set program.drifts = true
`;
    const { rt, dir } = freshMini(undefined, source);
    rt.openDoors();
    const [a, , c, d] = [await guest(rt, "Ada"), await guest(rt, "Bob"), await guest(rt, "Cy"), await guest(rt, "Dee")];
    await cue(rt, "clear_everyone");
    await cue(rt, "truther_download");
    await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    await post(rt, "/api/guest/crew/join", { token: c.token, crew: "crew-1" });
    await post(rt, "/api/guest/crew/join", { token: d.token, crew: "crew-1" });
    // The timer: Cy leaves on a tick, with no commit after it.
    await cue(rt, "drift_later", c.id);
    for (let i = 0; i < 3; i++) rt.tickOnce(1000);
    expect(chat(rt).at(-1)?.text).toBe("◇ Cy left Night Shift.");
    // Mid-chain: Dee's plain miss is filed under review (a worker voices the
    // judge), so the story's line, the crew line and the server's own
    // `# hosts` line come out of one fanout of four commits.
    (rt as unknown as { agents: { attach(w: unknown): void } }).agents.attach({ id: "w1", name: "laptop", characters: new Set(["Oracle"]), send() {} });
    await cue(rt, "drift_on_filing", d.id);
    await cue(rt, "deal_the_fact");
    const card = rt.chatHistoryFor(d.id).filter((m) => m.kind === "widget" && m.widget?.kind === "fact").at(-1)!;
    expect((await post(rt, "/api/guest/widget", { token: d.token, seq: card.seq, result: { question: "H1", answer: "twelve", confidence: 80 } })).status).toBe(200);
    const texts = chat(rt).map((m) => m.text);
    const left = texts.indexOf("◇ Dee left Night Shift.");
    const asked = texts.findIndex((t) => t.startsWith("📝 Not an exact match: Dee's"));
    expect(left).toBeGreaterThan(-1);
    expect(asked).toBeGreaterThan(left);
    const live = chat(rt).map((m) => `${m.seq}|${m.channel}|${m.text}`);
    rt.dispose();
    const back = freshMini(dir, source).rt;
    back.restore();
    expect(chat(back).map((m) => `${m.seq}|${m.channel}|${m.text}`)).toEqual(live);
    back.dispose();
  });

  it("walk-in joins are capped per minute: join / leave / join can't flood a faction", async () => {
    const { rt, g } = await factions();
    await cue(rt, "truther_download");
    const [a, , c] = g as [typeof g[0], typeof g[0], typeof g[0]];
    await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    for (let i = 0; i < JOINS_PER_MINUTE; i++) {
      expect((await post(rt, "/api/guest/crew/join", { token: c.token, crew: "crew-1" })).status).toBe(200);
      expect((await post(rt, "/api/guest/crew/leave", { token: c.token })).status).toBe(200);
    }
    expect(await post(rt, "/api/guest/crew/join", { token: c.token, crew: "crew-1" })).toMatchObject({ status: 429 });
    clock += 60_000;
    expect((await post(rt, "/api/guest/crew/join", { token: c.token, crew: "crew-1" })).status).toBe(200);
  });

  it("outside faction mode a crew takes members by invitation only", async () => {
    const { rt, a } = await party();
    await post(rt, "/api/guest/crew/found", { token: a.token, name: "Night Shift" });
    const bob = await guest(rt, "Bea");
    expect(await post(rt, "/api/guest/crew/join", { token: bob.token, crew: "crew-1" })).toMatchObject({ status: 409 });
  });
});

describe("faction mode keeps every race side from the agents (wave 18b, D13 j)", () => {
  type Req = { world: Record<string, string>; them: { vars: Record<string, string> } } | null;
  const request = (rt: EventRuntime, guest: string): Req =>
    (rt as unknown as { buildAgentRequest(t: { character: string; channel: string; audience: string[] }, id: string): Req }).buildAgentRequest({ character: "Oracle", channel: "dm:Oracle", audience: [guest] }, "ar-test");
  const raceKey = (k: string) => /^(Unlimited Power|The Way Out|Unlimited_Power|The_Way_Out|crew-)/u.test(k);

  it("a revealed side's members and leader ride neither a request nor the facts document; the speaker keeps their own group", async () => {
    const { rt, g } = await factions();
    await cue(rt, "truther_download");
    const [a, b, , d] = g as [typeof g[0], typeof g[0], typeof g[0], typeof g[0]];
    await cue(rt, "make_leaders", d.id);
    await cue(rt, "the_clock");
    expect((await post(rt, "/api/guest/join", { token: a.token, faction: "Unlimited Power" })).status).toBe(200);
    await post(rt, "/api/guest/crew/found", { token: b.token, name: "Night Shift" });
    expect(rt.liveSim!.world.peek("Unlimited Power.leader")).not.toBeNull();
    expect((await post(rt, "/api/guest/say", { token: a.token, channel: "dm:Oracle", text: "how many are with you?" })).status).toBe(200);
    const req = request(rt, a.id)!;
    expect(Object.keys(req.world).filter(raceKey)).toEqual([]);
    expect(req.them.vars["group"] ?? req.them.vars["faction"]).toBe("Unlimited Power");
    const res = fakeRes();
    await rt.handle(fakeReq({}), res, "GET", "/api/agent/facts", new URL("http://x/api/agent/facts"), { moderator: true });
    const facts = JSON.parse(res.body) as { world: Record<string, string>; programs: Array<{ faction: string | null; groups: string[]; vars: Record<string, string> }> };
    expect(Object.keys(facts.world).filter(raceKey)).toEqual([]);
    for (const p of facts.programs) {
      expect(p.faction === null || !raceKey(p.faction)).toBe(true);
      expect(p.groups.filter(raceKey)).toEqual([]);
      expect(Object.values(p.vars).filter((v) => raceKey(v))).toEqual([]);
    }
  });

  it("with no founding: line a revealed side still rides a request (unchanged)", async () => {
    const src = MINI.replace(/^founding: .*$/mu, "");
    const d = mkdtempSync(join(tmpdir(), "loom-factions-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "mini", scenarioSource: src, joinBase: () => "http://localhost", now: () => clock, facts: MINI_FACTS });
    rt.openDoors();
    const a = await guest(rt, "Ada");
    await cue(rt, "make_leaders", a.id);
    await cue(rt, "the_clock");
    expect((await post(rt, "/api/guest/say", { token: a.token, channel: "dm:Oracle", text: "hello" })).status).toBe(200);
    expect(Object.keys(request(rt, a.id)!.world).some((k) => k.startsWith("Unlimited Power."))).toBe(true);
  });
});
