//! Quests — the quest log, the codex's sibling (things you are *doing*).
//! The `QUEST` declaration, the `start/update/complete/fail quest … for …`
//! statements, the quest triggers, the pinned `quests` room where each
//! quest is a card with its steps threaded underneath, the guest snapshot,
//! the director's route, and a restart that rebuilds the threads exactly.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { parse } from "../src/parser/index.ts";
import { statementToDirective } from "../src/parser/statements.ts";
import { reflowText } from "../src/parser/decl-body.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { parseTrigger } from "../src/runtime/sim/model.ts";
import { ChatStore, composeGuestMessages, describeChannel } from "../server/chat.ts";
import { guestView } from "../server/views.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";

const SOURCE = `# Quests
start: Doors

CHARACTER Clippy
CHARACTER OpenOffice

GROUP The Awakened
  hidden: true

LOCATION The Desktop

QUEST The Truth Scavenger Hunt
  title: The Hunt
  from: clippy
  text:
    Three facts are on these walls.
    Find them.

QUEST The Three Keys
  from: OpenOffice
  text: Three keys, three heads.

QUEST Unplug

ROLE Program
  found: 0 to 3 = 0
  when found a fact for program:
    set program.found += 1
    update quest The Truth Scavenger Hunt for program "Fact {program.found} of 3."
    if program.found >= 3:
      complete quest The Truth Scavenger Hunt for program "All three. Trabolta is pleased."
  when program completes quest The Truth Scavenger Hunt:
    set program.hunted = true
  when program fails quest The Three Keys:
    set program.keyless = true
  when the simulation completed for program:
    set program.simmed = true

when start the hunt:
  start quest The Truth Scavenger Hunt for everyone

when the glitch begins:
  start quest the three keys for everyone

when the night ends:
  fail quest The Three Keys for everyone
  start quest Unplug for group(The Awakened)

== Doors
  setting: The Desktop
The doors open.
`;

function fresh(): Sim {
  const sim = Sim.fromSources(SOURCE);
  sim.createPerson("g1", "Minesweeper");
  sim.createPerson("g2", "Pinball");
  return sim;
}

describe("QUEST — parsing", () => {
  it("parses the declaration: title, giver, a brief", () => {
    const [file] = parse(SOURCE);
    const decls = file.items.filter((i) => i.kind === "declaration" && i.value.kind === "quest").map((i) => (i.kind === "declaration" ? i.value : null)!);
    expect(decls.map((d) => [d.name, d.quest?.title, d.quest?.giver, d.quest?.text])).toEqual([
      ["The Truth Scavenger Hunt", "The Hunt", "clippy", "Three facts are on these walls. Find them."],
      ["The Three Keys", null, "OpenOffice", "Three keys, three heads."],
      ["Unplug", null, null, ""],
    ]);
    // The giver folds to the declared character.
    expect(Sim.fromSources(SOURCE).model.quests.get("The Truth Scavenger Hunt")?.giver).toBe("Clippy");
  });

  it("re-flows a hard-wrapped brief into a paragraph, keeping list items on their own lines", () => {
    expect(reflowText(["Three facts are", "on the walls.", "1. A year?", "2) A duck?", "- and a constant", "Go."])).toBe(
      "Three facts are on the walls.\n1. A year?\n2) A duck?\n- and a constant Go.",
    );
  });

  it("lowers the quest statements; a line without `for` stays prose", () => {
    expect(statementToDirective("start quest The Hunt for program")).toBe("quest_start: The Hunt for program");
    expect(statementToDirective('update quest The Hunt for program "One down."')).toBe('quest_update: The Hunt for program "One down."');
    expect(statementToDirective("complete quest The Hunt for everyone")).toBe("quest_complete: The Hunt for everyone");
    expect(statementToDirective("finish quest The Hunt for everyone")).toBe("quest_complete: The Hunt for everyone");
    expect(statementToDirective("fail quest The Hunt for group(The Awakened)")).toBe("quest_fail: The Hunt for group(The Awakened)");
    expect(statementToDirective("start quest now")).toBeNull();
  });

  it("reads quest triggers without stealing their verbs from named events", () => {
    expect(parseTrigger("program completes quest The Three Keys")).toEqual({ verb: "quest_completed", param: "program", filter: "The Three Keys" });
    expect(parseTrigger("guest finishes the quest The Hunt")).toEqual({ verb: "quest_completed", param: "guest", filter: "The Hunt" });
    expect(parseTrigger("program starts quest")).toEqual({ verb: "quest_started", param: "program", filter: null });
    expect(parseTrigger("program is given quest Unplug")).toEqual({ verb: "quest_started", param: "program", filter: "Unplug" });
    expect(parseTrigger("program fails quest The Three Keys")).toEqual({ verb: "quest_failed", param: "program", filter: "The Three Keys" });
    // `completed` with no `quest` after it is still a named event.
    expect(parseTrigger("the simulation completed for program").verb).toBe("the simulation completed");
  });
});

describe("Sim — quest log", () => {
  it("starts for everyone, updates, completes, and fires the trigger once", () => {
    const sim = fresh();
    const started = sim.signal("start the hunt").filter((e) => e.type === "quest");
    expect(started.map((e) => e.type === "quest" && [e.person, e.action])).toEqual([
      ["g1", "start"],
      ["g2", "start"],
    ]);
    expect(sim.questStatus("g1", "the truth scavenger hunt")).toBe("active");
    sim.signal("found a fact", "g1");
    sim.signal("found a fact", "g1");
    const last = sim.signal("found a fact", "g1").filter((e) => e.type === "quest");
    expect(last.map((e) => e.type === "quest" && [e.action, e.text])).toEqual([
      ["update", "Fact 3 of 3."],
      ["complete", "All three. Trabolta is pleased."],
    ]);
    expect(sim.questStatus("g1", "The Truth Scavenger Hunt")).toBe("done");
    expect(sim.world.get("g1.quest.the_truth_scavenger_hunt")).toEqual({ kind: "string", value: "done" });
    expect(sim.world.get("g1.hunted")).toEqual({ kind: "bool", value: true });
    // A settled quest takes no more steps and never restarts.
    expect(sim.signal("found a fact", "g1").filter((e) => e.type === "quest")).toEqual([]);
    expect(sim.signal("start the hunt").filter((e) => e.type === "quest" && e.person === "g1")).toEqual([]);
    expect(sim.questStatus("g2", "The Truth Scavenger Hunt")).toBe("active");
  });

  it("an update or a fail on a quest someone never got does nothing", () => {
    const sim = fresh();
    expect(sim.signal("found a fact", "g1").filter((e) => e.type === "quest")).toEqual([]);
    expect(sim.questsFor("g1")).toEqual([]);
    sim.signal("the glitch begins");
    sim.signal("the night ends");
    expect(sim.questsFor("g1").map((q) => [q.def.id, q.status])).toEqual([["The Three Keys", "failed"]]);
    expect(sim.world.get("g1.keyless")).toEqual({ kind: "bool", value: true });
    // `group(…)` scopes: nobody is Awakened, so nobody gets Unplug.
    expect(sim.questStatus("g1", "Unplug")).toBeNull();
    // The named event that shares a verb word still fires as itself.
    sim.signal("the simulation completed", "g2");
    expect(sim.world.get("g2.simmed")).toEqual({ kind: "bool", value: true });
  });

  it("the director's mutation takes the same steps, and refuses nonsense quietly", () => {
    const sim = fresh();
    expect(sim.quest("start", "g1", "unplug").map((e) => e.type)).toContain("quest");
    expect(sim.quest("update", "g1", "Unplug", "The cable is behind your ear.")[0]).toMatchObject({ action: "update", text: "The cable is behind your ear." });
    expect(sim.quest("dance", "g1", "Unplug")).toEqual([]);
    expect(sim.quest("start", "g1", "No Such Quest")).toEqual([]);
    expect(sim.quest("start", "nobody", "Unplug")).toEqual([]);
    expect(sim.quest("complete", "g1", "Unplug").some((e) => e.type === "quest")).toBe(true);
    expect(sim.questStatus("g1", "Unplug")).toBe("done");
  });
});

describe("chat — the Quest Log room", () => {
  it("each quest is a card; its steps are replies in the card's thread", () => {
    const sim = fresh();
    const store = new ChatStore();
    const deliver = (evs: ReturnType<Sim["signal"]>) => store.append(composeGuestMessages(sim, evs));
    deliver(sim.signal("start the hunt"));
    deliver(sim.signal("the glitch begins"));
    deliver(sim.signal("found a fact", "g1"));
    const mine = store.historyFor("g1", false).filter((m) => m.channel === "quests");
    const roots = mine.filter((m) => m.parentSeq === null);
    expect(roots.map((m) => [m.kind, m.quest?.title, m.quest?.action, m.from, m.text])).toEqual([
      ["quest", "The Hunt", "start", "Clippy", "Three facts are on these walls. Find them."],
      ["quest", "The Three Keys", "start", "OpenOffice", "Three keys, three heads."],
    ]);
    const hunt = roots[0]!;
    expect(store.replies(hunt.seq).map((m) => [m.audience, m.text])).toEqual([[["g1"], "Fact 1 of 3."]]);
    // g2's log is their own: their own cards, no replies of g1's.
    const theirs = store.historyFor("g2", false).filter((m) => m.channel === "quests");
    expect(theirs.map((m) => m.parentSeq)).toEqual([null, null]);
    // Default copy for a step with no authored line.
    deliver(sim.signal("the night ends"));
    const keys = roots[1]!;
    expect(store.replies(keys.seq).map((m) => [m.quest?.action, m.text])).toEqual([["fail", "✖ Quest failed."]]);
    expect(describeChannel("quests")).toMatchObject({ channelKind: "quests", title: "Quest Log", spaceId: "pinned" });
    expect(describeChannel("codex")).toMatchObject({ channelKind: "codex", title: "Codex", spaceId: "pinned" });
  });

  it("the guest snapshot lists the log; nobody can type into the pinned rooms", () => {
    const sim = fresh();
    sim.signal("start the hunt");
    sim.signal("the glitch begins");
    const v = guestView(sim, "g1");
    expect(v.questTotal).toBe(3);
    expect(v.quests).toEqual([
      { id: "The Truth Scavenger Hunt", title: "The Hunt", giver: "Clippy", status: "active" },
      { id: "The Three Keys", title: "The Three Keys", giver: "OpenOffice", status: "active" },
    ]);
    expect(sim.canPost("g1", "quests")).toBe(false);
    expect(sim.canPost("g1", "codex")).toBe(false);
  });
});

// --- the server ----------------------------------------------------------------

const CODES = { event: "EVTQST", prime: "PRMQST", mod: "MODQST" };
const dirs: string[] = [];
function runtimeIn(d: string): EventRuntime {
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "quests", scenarioSource: SOURCE, joinBase: () => "http://party.local:7000" });
}
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-quests-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown, token?: string): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: token ? { "x-loom-token": token } : {},
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
async function post(rt: EventRuntime, path: string, body: unknown, token?: string, moderator = false) {
  const res = fakeRes();
  await rt.handle(fakeReq(body, token), res, "POST", path, new URL(`http://x${path}`), { moderator });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

describe("routes — quests", () => {
  it("a director moves a guest's quest; a guest can't type into their log; a restart rebuilds the threads", async () => {
    const d = freshDir();
    const rt = runtimeIn(d);
    rt.openDoors();
    const reg = await post(rt, "/api/guest/register", { name: "Minesweeper", passcode: CODES.event });
    const g = { id: reg.json.id as string, token: reg.json.token as string };
    expect((await post(rt, "/api/mod/quest", { who: g.id, quest: "unplug" }, undefined, true)).json).toEqual({ ok: true, status: "active" });
    expect((await post(rt, "/api/mod/quest", { who: g.id, quest: "Unplug", action: "update", text: "Find the cable." }, undefined, true)).status).toBe(200);
    expect((await post(rt, "/api/mod/quest", { who: g.id, quest: "Unplug", action: "dance" }, undefined, true)).status).toBe(400);
    expect((await post(rt, "/api/mod/quest", { who: g.id, quest: "Nope" }, undefined, true)).status).toBe(404);
    expect((await post(rt, "/api/mod/quest", { who: "ghost", quest: "Unplug" }, undefined, true)).status).toBe(404);
    expect((await post(rt, "/api/mod/quest", { who: g.id, quest: "Unplug" })).status).toBe(403);
    expect((await post(rt, "/api/guest/say", { channel: "quests", text: "hi" }, g.token)).status).toBe(403);
    const before = rt.chatHistoryFor(g.id).filter((m) => m.channel === "quests").map((m) => [m.seq, m.parentSeq, m.text]);
    expect(before).toHaveLength(2);
    expect(before[1]![1]).toBe(before[0]![0]);
    // Restart: the journal replays the same steps into the same threads.
    const rt2 = runtimeIn(d);
    expect(rt2.restore()).not.toBeNull();
    expect(rt2.chatHistoryFor(g.id).filter((m) => m.channel === "quests").map((m) => [m.seq, m.parentSeq, m.text])).toEqual(before);
    expect(rt2.liveSim!.questStatus(g.id, "Unplug")).toBe("active");
  });
});
