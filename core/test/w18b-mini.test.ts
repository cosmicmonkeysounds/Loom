//! Wave 18b — the Stage B fixture story (`fixtures/w18b-mini/`): it writes
//! every new header line (`lobby: hidden`, `badge:`, `founding:`, a direct
//! `majority:`, the approver's `as` / `audit`, a conditional `avatar:`), and
//! each new state has an admin cue. The Stage B lanes check their work on
//! it before the show's text lands, so this suite keeps it valid: it plays
//! the cues in order on a sim and on an event runtime with its `facts.json`.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";

import { Workspace } from "../src/lsp/index.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { badgesOf } from "../src/runtime/sim/badges.ts";
import { composeGuestMessages } from "../server/chat.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { guestView, modView } from "../server/views.ts";

const SOURCE = readFileSync(new URL("./fixtures/w18b-mini/main.loom", import.meta.url), "utf8");
const FACTS = readFileSync(new URL("./fixtures/w18b-mini/facts.json", import.meta.url), "utf8");

const str = (sim: Sim, path: string): string | null => {
  const v = sim.world.get(path);
  return v.kind === "string" ? v.value : null;
};

describe("the w18b-mini fixture", () => {
  it("compiles clean, with every new header line", () => {
    const ws = new Workspace();
    ws.open("file:///main.loom", SOURCE);
    expect(ws.diagnosticsFor("file:///main.loom")?.diagnostics ?? []).toEqual([]);
    const sim = Sim.fromSources(SOURCE);
    const m = sim.model;
    expect(m.lobbyHidden).toBe(true);
    expect(m.badges.map((b) => b.path)).toEqual(["program.afk"]);
    expect(m.founding).toContain("Night.truther_sent == true");
    expect(sim.crews.factionMode).toBe(true);
    expect(sim.crews.majority).toContain("count([p for p in Persons");
    expect(m.currency?.approver).toMatchObject({ id: "CRA Agent Software", as: "MyCRA", audit: "a CRA audit" });
    expect(m.characters.get("Oracle")).toMatchObject({ mind: "external", avatar: ["picture:trabolta.svg"], avatarRules: [{ ref: "picture:trabolta-broken.svg", when: "self.broken == true" }] });
    expect(m.judge).toBe("Oracle");
    expect([...m.codex.values()].map((e) => e.category)).toEqual(["How it works", "Facts", "Places", "Files"]);
    expect(JSON.parse(FACTS).questions.map((q: { id: string }) => q.id)).toEqual(["H1"]);
  });

  it("plays the cues in order on a sim", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.fireBeat("Boot");
    for (let i = 1; i <= 5; i++) sim.createPerson(`g${i}`, `P${i}`);
    expect(guestView(sim, "g1").lobby).toBe("hidden");

    // 🟢 the rooms open quietly
    const cleared = sim.signal("clear_everyone");
    expect(guestView(sim, "g1").channels.map((c) => c.id)).toContain("loc:The Cellar");
    expect(composeGuestMessages(sim, cleared).filter((m) => m.kind === "system")).toEqual([]);

    // 🚻 a badge
    sim.signal("bathroom", "g5");
    expect(badgesOf(sim, "g5")).toEqual([{ glyph: "🚻", label: "Bathroom Mode" }]);

    // founding is shut until the download; the sides are hidden
    expect(guestView(sim, "g1").canFound).toBe(false);
    sim.signal("truther_download");
    expect(guestView(sim, "g1").canFound).toBe(true);
    sim.signal("make_leaders", "g4");
    sim.signal("make_leaders", "g5");
    expect(sim.crews.founderOf("Unlimited Power")).toBe("g4");
    expect(sim.crews.raceFactions()).toEqual([]); // hidden sides don't race yet
    sim.crew({ op: "foundCrew", by: "g1", name: "Night Shift" });
    sim.crew({ op: "joinCrew", person: "g2", crew: "crew-1" });
    expect(guestView(sim, "g1").sides).toEqual([expect.objectContaining({ id: "crew-1", members: 2, needs: 3, more: 1, mine: true, kind: "founded" })]);

    // 🕚 the count starts; a third member wins it
    sim.signal("the_clock");
    expect(sim.crews.raceFactions()).toEqual(["Unlimited Power", "The Way Out", "crew-1"]);
    expect(str(sim, "Kernel.majority_reached")).toBeNull();
    sim.crew({ op: "joinCrew", person: "g3", crew: "crew-1" });
    expect(sim.world.get("Kernel.majority_reached")).toEqual({ kind: "bool", value: true });
    expect(str(sim, "Kernel.majority")).toBe("founded");
    expect(str(sim, "Kernel.majority_name")).toBe("Night Shift");
    expect(str(sim, "Kernel.majority_founder")).toBe("g1");
    expect(sim.codexFor("g3").map((e) => e.id)).toContain("The Whole Truth");
    expect(sim.codexFor("g4").map((e) => e.id)).not.toContain("The Whole Truth");
    expect(modView(sim, "open", null).race).toMatchObject({ needs: 3, present: 5, winner: "crew-1" });

    // 💔 the Oracle's picture rule; 🕛 founding closes
    sim.signal("break_the_oracle");
    expect(sim.world.get("Oracle.broken")).toEqual({ kind: "bool", value: true });
    sim.signal("midnight");
    expect(sim.crews.mayFound("g4")).toBe(false);
  });

  it("deals the left-behind card with no question and keeps the text on a secret slot", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.createPerson("g1", "P1");
    const evs = sim.choose("g1", 0);
    const card = evs.find((e) => e.type === "widget");
    expect(card).toMatchObject({ widget: "answer" });
    expect((card as { params: Record<string, string> }).params).not.toHaveProperty("question");
    sim.signal("answer answered", "g1", { answer: "my keys" });
    expect(str(sim, "g1.left_behind_text")).toBe("my keys");
    expect(sim.model.roles.get("Program")!.secret.has("left_behind_text")).toBe(true);
  });
});

// ── on an event runtime, with the fixture's facts.json ──────────────────

const CODES = { event: "EVTMINI", prime: "PRMMINI", mod: "MODMINI" };
const dirs: string[] = [];
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
    destroy() {},
  } as unknown as IncomingMessage;
}
function fakeRes() {
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    setHeader() {},
    write() {
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res as typeof res & ServerResponse;
}
async function call(rt: EventRuntime, path: string, body: unknown, moderator = false) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body), res, "POST", url.pathname, url, moderator ? { moderator: true, moderatorName: "Ada" } : {});
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

describe("the w18b-mini fixture on an event runtime", () => {
  it("loads with its facts, files and reads a fact, and logs the verdict's publication", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-w18b-mini-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "w18b-mini", scenarioSource: SOURCE, joinBase: () => "http://localhost", factsFile: join(d, "none.json"), facts: FACTS });
    rt.openDoors();
    const g = await call(rt, "/api/guest/register", { name: "Winamp", passcode: CODES.event });
    expect(g.status).toBe(200);
    const id = g.json.id as string;
    expect((await call(rt, "/api/mod/signal", { name: "deal_the_fact" }, true)).status).toBe(200);
    const card = rt.chatHistoryFor(id).find((m) => m.kind === "widget" && m.widget?.kind === "fact")!;
    expect(card).toBeDefined();
    const filed = await call(rt, "/api/guest/widget", { token: g.json.token, seq: card.seq, result: { question: "H1", answer: "7", confidence: 100 } });
    expect(filed.status).toBe(200);
    for (const name of ["read_the_results", "the_clock", "the_verdict"]) expect((await call(rt, "/api/mod/signal", { name }, true)).status).toBe(200);
    const log = rt.liveSim!.log.all();
    const directives = log.flatMap((e) => (e.type === "directive" ? [`${e.verb} ${e.args}`] : []));
    expect(directives).toEqual(expect.arrayContaining(["fact_read H1", "fact_truth H1 accurate"]));
    expect(rt.liveSim!.world.get(`${id}.v`)).toEqual({ kind: "string", value: "accurate" });
  });
});
