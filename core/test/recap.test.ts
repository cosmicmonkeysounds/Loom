//! K-26 — the recap numbers: ranked lists off the live sim (trust, truths,
//! lies, Internet visits, codex, quests, factions) + the paste-ready text,
//! on the real show, and the mod-gated `GET /api/mod/recap` route.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Sim } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";
import { computeRecap, duckBoard, liesByPerson, logCounts, rank, runTime } from "../server/recap.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";

const SHOW = "trapped-in-the-internet";
const SLOW = 120_000;

function upload(sim: Sim, id: string, name: string): void {
  sim.createPerson(id, name);
  sim.signal("captcha answered", id, { passed: true });
  sim.signal("captcha answered", id, { passed: false });
  const p = sim.pendingChoiceFor(id);
  if (p && p.length === 4) sim.choose(id, 0);
  sim.choose(id, 0);
  sim.scan("Norton Anti-Virus", id);
}
const PROGRAMS: Array<[string, string]> = [
  ["g1", "Calculator"],
  ["g2", "Microsoft Excel"],
  ["g3", "OpenOffice"],
  ["g4", "MS Paint"],
  ["g5", "Winamp"],
  ["g6", "VLC"],
];
const fireAll = (sim: Sim, ...names: string[]) => names.forEach((n) => sim.signal(n));

/** Round 1 judged (one accurate, one confident lie), hunt 2 with two 📝
 *  filings judged by the server (a confident lie, an accurate one) and
 *  credited at the round-2 tally (both made the cup), and one trip to the
 *  Internet. */
function night(): Sim {
  const sim = Sim.fromSources(scenarioSource(SHOW));
  sim.fireBeat("Power On");
  for (const [id, name] of PROGRAMS) upload(sim, id, name);
  fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth");
  sim.signal("accurate_q1", "g1", null, "Clippy");
  sim.signal("confident_q2", "g2", null, "Clippy");
  fireAll(sim, "second_hunt_preview", "start_the_second_hunt");
  for (let i = 0; i < 120; i++) sim.tick(1000);
  sim.choose("g2", 0);
  sim.choose("g3", 0);
  sim.signal("fact answered", "g4", { question: "H5", answer: "Clippy", confidence: 100, verdict: "lie", card: 1 });
  sim.signal("fact answered", "g5", { question: "H4", answer: "1978", confidence: 100, verdict: "accurate", card: 1 });
  sim.signal("truth_pong");
  for (const g of ["g4", "g5"]) sim.signal("made_the_cup", g, null, "Clippy"); // a cup counts their filings
  sim.signal("round_two_tally"); // round two settles: both filings are credited (+50)
  sim.signal("send to the internet", "g6", null, "Norton Anti-Virus");
  sim.signal("go to the bathroom", "g5"); // the 🚻 guest button
  return sim;
}

describe("K-26 recap", () => {
  it("ranks with shared places, high to low", () => {
    const r = rank([
      { id: "a", name: "A", value: 3, persona: false },
      { id: "b", name: "B", value: 5, persona: false },
      { id: "c", name: "C", value: 3, persona: false },
      { id: "d", name: "D", value: 1, persona: false },
    ]);
    expect(r.map((x) => [x.id, x.rank])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 2],
      ["d", 4],
    ]);
  });

  it("the duck board: each program's fastest find, fastest first, ties by the second read aloud", () => {
    const sim = Sim.fromSources("ROLE Program\n");
    sim.createPerson("g1", "Winamp");
    sim.createPerson("g2", "VLC");
    const run = (guest: string, name: string, ms: number, world: "web" | "vr" = "web") => ({ guest, name, world, device: "x", ms, foundAt: 0 });
    const board = duckBoard(
      sim,
      [run("g1", "Winamp", 95_400), run("g2", "VLC", 61_900, "vr"), run("g1", "Winamp", 61_200), run("g9", "Paint (left)", 200_000)],
      new Set(["g2"]),
    );
    expect(board.map((d) => [d.id, d.name, d.time, d.rank, d.runs, d.world, d.persona])).toEqual([
      ["g1", "Winamp", "1:01", 1, 2, "web", false],
      ["g2", "VLC", "1:01", 1, 1, "vr", true],
      ["g9", "Paint (left)", "3:20", 3, 1, "web", false],
    ]);
    expect(runTime(0)).toBe("0:00");
    expect(runTime(59_999)).toBe("0:59");
    expect(runTime(3_600_000)).toBe("60:00");
  });

  it("shares, Cold Lock games and bathroom trips come off the log, names folded", () => {
    const sim = Sim.fromSources("ROLE Program\n\nCHARACTER Norton\n\nCODEX The Sandy File\n  code: SANDY-1\n  text: Sandy.\n");
    for (const [id, name] of [["g1", "Winamp"], ["g2", "VLC"], ["g3", "Paint"]] as const) sim.createPerson(id, name);
    sim.redeem("g1", "SANDY-1");
    sim.share("g1", "g2", "The Sandy File");
    sim.share("g1", "Norton", "The Sandy File"); // a share to a character counts too
    sim.share("g2", "g3", "The Sandy File");
    sim.signal("chess won", "g1"); // the tent tablet
    sim.signal("chess_won", "g1"); // the director's fallback button
    sim.signal("beat_the_machine", "g2"); // a host's ♟
    sim.signal("Chess Lost", "g2");
    sim.signal("chess drawn", "g3");
    sim.signal("chess won"); // no subject: nobody's
    sim.signal("go to the bathroom", "g3");
    sim.signal("go to the bathroom", "g3"); // still away: the same trip
    sim.signal("back from the bathroom", "g3");
    sim.signal("go to the bathroom", "g3");
    sim.signal("go_to_the_bathroom", "g1");
    const c0 = logCounts(sim);
    expect(c0.bathroom.get("g1")).toBe(1);
    // A trip the story times out (`set self.afk = false`, no Back signal)
    // ends too, so the next 🚻 counts.
    sim.setVar("g1.afk", "false");
    sim.signal("go to the bathroom", "g1");
    const c = logCounts(sim);
    expect([...c.shares.entries()].sort()).toEqual([["g1", 2], ["g2", 1]]);
    expect(c.chess.get("g1")).toEqual({ won: 2, lost: 0, drawn: 0 });
    expect(c.chess.get("g2")).toEqual({ won: 1, lost: 1, drawn: 0 });
    expect(c.chess.get("g3")).toEqual({ won: 0, lost: 0, drawn: 1 });
    expect([...c.bathroom.entries()].sort()).toEqual([["g1", 2], ["g3", 2]]);

    const r = computeRecap(sim, { title: "T" });
    expect(r.lists.shares.map((x) => [x.name, x.value, x.rank])).toEqual([["Winamp", 2, 1], ["VLC", 1, 2], ["Paint", 0, 3]]);
    expect(r.lists.chess.map((x) => [x.name, x.value])).toEqual([["Winamp", 2], ["VLC", 1], ["Paint", 0]]);
    expect(r.lists.bathroom[0]).toMatchObject({ name: "Paint", value: 2, rank: 1 });
    expect(r.chessGames.map((g) => g.name)).toEqual(["Winamp", "VLC", "Paint"]);
    expect(r.totals).toMatchObject({ shares: 3, chessWins: 3, bathroomTrips: 4 });
    expect(r.text).toContain("Codex shares:\n  1. Winamp — 2\n  2. VLC — 1\n");
    expect(r.text).toContain("Cold Lock chess (most wins):\n  Winamp — 2 won · 0 lost · 0 drawn\n  VLC — 1 won · 1 lost · 0 drawn\n  Paint — 0 won · 0 lost · 1 drawn\n");
    expect(r.text).toContain("Bathroom trips:\n  1. Paint — 2\n  1. Winamp — 2\n");
  });

  it("reads the show's live state into ranked lists + a paste-ready block", { timeout: SLOW }, () => {
    const sim = night();
    // Both lie paths credit the program the chain was about, never the truth-teller.
    expect([...liesByPerson(sim).entries()].sort()).toEqual([
      ["g2", 1],
      ["g4", 1],
    ]);
    const r = computeRecap(sim, { title: "Trapped in the Internet", personas: new Set(["g3"]) });
    const top = (k: keyof typeof r.lists) => r.lists[k].filter((x) => x.value > 0).map((x) => [x.name, x.value]);
    expect(r.programs).toBe(6);
    expect(top("lies").sort()).toEqual([
      ["MS Paint", 1],
      ["Microsoft Excel", 1],
    ]);
    // truths = accepted − lies: the liars' accepted answers don't count as truths.
    expect(top("truths").sort()).toEqual([
      ["Calculator", 1],
      ["Winamp", 1],
    ]);
    expect(top("internetVisits")).toEqual([["VLC", 1]]);
    expect(r.lists.trust[0]!.value).toBe(10);
    expect(r.lists.trust.at(-1)).toMatchObject({ name: "VLC", value: -5 });
    expect(r.totals).toMatchObject({ liesAccepted: 2, truthsAccepted: 2, internetVisits: 1 });
    expect(r.lists.codex.every((x) => x.value >= 0)).toBe(true);
    expect(r.lists.quests.length).toBe(6);
    expect(r.lists.truthcoin[0]!.value).toBeGreaterThan(0);
    expect(r.lists.trust.find((x) => x.id === "g3")?.persona).toBe(true);
    expect(r.factions.length).toBe(sim.model.factions.size);
    expect(r.lists.bathroom.filter((x) => x.value > 0).map((x) => [x.name, x.value])).toEqual([["Winamp", 1]]);
    // The text block: every list titled, liars listed, persona marked.
    expect(r.text.split("\n")[0]).toBe("RECAP — Trapped in the Internet");
    for (const h of ["Most trusted (trust):", "Least trusted:", "Confident lies accepted:", "Trips to the Internet:", "Codex entries held:", "Quests completed:", "Codex shares:", "Cold Lock chess (most wins):", "Bathroom trips:", "Factions:"]) {
      expect(r.text).toContain(h);
    }
    expect(r.text).toMatch(/Confident lies accepted:\n {2}1\. M[^\n]* — 1\n {2}1\. M[^\n]* — 1/u);
    expect(r.text).toContain("OpenOffice (persona)");
    expect(r.ending).toBeNull();
  });

  it("an empty event still recaps", () => {
    const r = computeRecap(Sim.fromSources(scenarioSource(SHOW)));
    expect(r.programs).toBe(0);
    expect(r.lists.trust).toEqual([]);
    expect(r.text).toContain("(nobody)");
    expect(r.text).toContain("Cold Lock chess (most wins):\n  (nobody played)");
    expect(r.chessGames).toEqual([]);
  });
});

// ── the route ──

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function runtime(): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-recap-"));
  dirs.push(d);
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: { event: "EVT26", prime: "PRM26", mod: "MOD26" },
    scenarioName: SHOW,
    scenarioSource: scenarioSource(SHOW),
    joinBase: () => "http://localhost",
  });
}
async function call(rt: EventRuntime, method: string, p: string, body: unknown, moderator: boolean) {
  const url = new URL(`http://x${p}`);
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  const req = { headers: {}, [Symbol.asyncIterator]: async function* () { yield buf; }, on() {} } as unknown as IncomingMessage;
  const res = { statusCode: 0, body: "", type: "", writeHead(s: number, h?: Record<string, string>) { res.statusCode = s; res.type = h?.["content-type"] ?? ""; return res; }, write: () => true, end(b?: string) { if (typeof b === "string") res.body = b; return res; } };
  await rt.handle(req, res as unknown as ServerResponse, method, url.pathname, url, { moderator });
  return res;
}

describe("GET /api/mod/recap", () => {
  it("is directors-only, JSON by default, plain text on ?format=text, personas flagged", { timeout: SLOW }, async () => {
    const rt = runtime();
    rt.openDoors();
    expect((await call(rt, "GET", "/api/mod/recap", null, false)).statusCode).toBe(403);
    const persona = await call(rt, "POST", "/api/mod/persona", { name: "Rehearsal Ada" }, true);
    const id = (JSON.parse(persona.body) as { guest: { id: string } }).guest.id;
    const json = await call(rt, "GET", "/api/mod/recap", null, true);
    expect(json.statusCode).toBe(200);
    const r = JSON.parse(json.body) as ReturnType<typeof computeRecap>;
    expect(r.programs).toBe(1);
    expect(r.lists.trust).toEqual([{ id, name: "Rehearsal Ada", value: 0, rank: 1, persona: true }]);
    expect(r.text).toContain("Rehearsal Ada (persona)");
    const text = await call(rt, "GET", "/api/mod/recap?format=text", null, true);
    expect(text.type).toContain("text/plain");
    expect(text.body.startsWith("RECAP — ")).toBe(true);
  });
});
