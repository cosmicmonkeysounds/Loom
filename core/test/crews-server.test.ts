//! Wave 18 (C10) — the crews + recruiting routes (`routes/crews.ts`): name
//! moderation, caps, the side-recruit refusals (`/api/guest/join`'s own
//! rules), the invite card, the journal (a restart rebuilds every crew,
//! member, invitation and answered card), agent masking and the director's
//! rename / dissolve.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { ChatMessage } from "../server/chat.ts";
import { crewNameRefusal } from "../server/routes/crews.ts";
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
