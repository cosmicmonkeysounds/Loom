//! Trapped in the Internet, wave 18b `ending` lane: the ties (R9), Broken Ask
//! Jeeves's DSL Line (R7) and the ending monologue (R8: The Night In Review,
//! Your File, and the canonical copy Trabolta Recounts and Purgatory share).
//!
//! The hooks that reach these beats (clearance → Program Briefing, the
//! ceremony → The Night In Review + Your File) land at integration
//! (contract §4.6), so these tests drive the beats directly with `fireBeat`,
//! and set the show lane's new slots (`left_behind_text`, `Kernel.majority`
//! = "founded" …) with `setVar` before they do.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";
import { composeGuestMessages } from "../server/chat.ts";
import { MAX_VOICE_BLOCK, MAX_VOICE_LINES, voiceLinesOf } from "../server/routes/screen.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { AgentRequest } from "../server/agents.ts";

const SHOW = "trapped-in-the-internet";
const SRC = scenarioSource(SHOW);
/** The show plus two story rules standing in for integration's ROLE
 *  watchers (contract §4.6): each plays its beat with `program` bound, as
 *  the watcher's divert will (`fireBeat` binds only `guest`). */
const HOOKS = [
  "when w18b_test_briefing for program:",
  "  -> Program Briefing",
  "when w18b_test_your_file for program:",
  "  -> Your File",
].join("\n");
const SRC_HOOKED = `${SRC}\n\n# ── w18b-ending-test-hooks.loom ──\n${HOOKS}\n`;
const SLOW = 120_000;
const fresh = (): Sim => Sim.fromSources(SRC_HOOKED);
/** Program Briefing / Your File for one program, as the §4.6 watchers play them. */
const briefing = (sim: Sim, id: string) => sim.signal("w18b_test_briefing", id);
const yourFile = (sim: Sim, id: string) => sim.signal("w18b_test_your_file", id);

type Ev<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
const said = (evs: SimEvent[]) => evs.filter((e) => e.type === "dialogue") as Ev<"dialogue">[];
const lines = (evs: SimEvent[], speaker: string) => said(evs).filter((e) => e.speaker === speaker).map((e) => e.text);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const beats = (evs: SimEvent[]) => evs.filter((e) => e.type === "beatEntered").map((e: any) => (e.beat ?? e.name) as string);

const FEATURED: Record<string, string> = {
  excel: "Microsoft Excel",
  openoffice: "OpenOffice",
  draftkings: "DraftKings",
  bugdom: "Bugdom",
  jeeves: "Broken Ask Jeeves",
  runescape: "Runescape",
  mspaint: "MS Paint",
  vlc: "VLC",
  pong: "Pong",
};
/** The problems a pool program may name at the upload, in menu order. */
const PROBLEMS = ["debt", "career", "loneliness", "mortality"];
/** The tie each problem deals (contract §4.5, the content scout's table). */
const PROBLEM_TIE: Record<string, string> = { debt: "Debt Notices", career: "Found On Indeed", loneliness: "Nobody Calls", mortality: "Forever" };
/** Every featured program's three ties. */
const FEATURED_TIES: Record<string, string[]> = {
  excel: ["Juniors Contacts", "Forever", "The Ladies In Finance"],
  openoffice: ["The Downtown Staff Photo", "The Volunteer Sheet", "The Ladies In Finance"],
  draftkings: ["The Table Stakes", "Forever", "The Leaderboard"],
  bugdom: ["The Volunteer Sheet", "Forever", "Nobody Calls"],
  jeeves: ["Retired Helpers", "Found On Indeed", "The Old Machines"],
  runescape: ["The Table Stakes", "Nobody Calls", "The Leaderboard"],
  mspaint: ["The Pirate Site", "Debt Notices", "The Old Machines"],
  vlc: ["Forever", "The Pirate Site", "The Audience"],
  pong: ["Brookhaven And Lockheed", "The Old Machines", "The Leaderboard"],
};
/** The frozen tie titles (contract §4.5), in order. */
const TIE_TITLES = [
  "Junior's Contacts",
  "The Downtown Staff Photo",
  "The Volunteer Sheet",
  "Retired Helpers",
  "Found On Indeed",
  "The Table Stakes",
  "Forever",
  "Brookhaven And Lockheed",
  "The Pirate Site",
  "Debt Notices",
  "The Old Machines",
  "Nobody Calls",
  "6121 Quinpool Road",
  "The Ladies In Finance",
  "The Leaderboard",
  "The Audience",
];
/** The human behind every program and host (the ties point, never name). */
/** Who the canonical copy reads out: the nine featured programs, then the nine hosts. */
const CAST = [...Object.values({ excel: "Microsoft Excel", openoffice: "OpenOffice", draftkings: "DraftKings", bugdom: "Bugdom", jeeves: "Broken Ask Jeeves", runescape: "Runescape", mspaint: "MS Paint", vlc: "VLC", pong: "Pong" }), "Clippy", "Task Manager", "Adobe Acrobat", "Recycling Bin", "Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software", "The Installation Wizard"];
const isIdentity = (l: string) => CAST.some((n) => l.startsWith(`${n} is `) || l.startsWith(`${n} was `) || l.startsWith(`${n} walked `));
const HUMANS = ["Randy", "Barkmore Sr", "Dana", "Anderson", "Crab Fisherwoman", "Bea Nunes", "Virgil", "Poppy", "van Mises", "Maria", "Paine", "Victor", "Christianson", "Higinbotham", "Tippi", "Sheryl", "Terrio", "Julie", "Horton", "Bridget", "Troelsen", "Sharon", "Penney", "Julia", "Tufts"];

/** Register → CAPTCHA → the problem (pool only) → deposit → the door scan. */
function upload(sim: Sim, id: string, name: string, problem = 0): SimEvent[] {
  const out: SimEvent[] = [];
  out.push(...sim.createPerson(id, name));
  out.push(...sim.signal("captcha answered", id, { passed: true }));
  out.push(...sim.signal("captcha answered", id, { passed: false }));
  const p = sim.pendingChoiceFor(id);
  if (p && p.length === 4) out.push(...sim.choose(id, problem));
  out.push(...sim.choose(id, 0));
  out.push(...sim.scan("Norton Anti-Virus", id));
  return out;
}

/** All nine featured programs (f-<slug>) plus one pool program per problem
 *  (p-<problem>), every one cleared. */
function house(): Sim {
  const sim = fresh();
  sim.fireBeat("Power On");
  for (const [slug, name] of Object.entries(FEATURED)) upload(sim, `f-${slug}`, name);
  const pool = ["Calculator", "WinZip", "GarageBand", "LimeWire"];
  PROBLEMS.forEach((problem, i) => upload(sim, `p-${problem}`, pool[i]!, i));
  return sim;
}
const ties = (sim: Sim) => [...sim.model.codex.values()].filter((e) => e.category === "Connections");
const tiesHeld = (sim: Sim, who: string) => sim.codexFor(who).filter((e) => e.category === "Connections").map((e) => e.id).sort();

// ───────────────────────── R9 · the ties ─────────────────────────

describe("wave 18b ending — the ties (R9)", () => {
  it("are sixteen Connections files, titled as frozen, no code, no about, not secret", () => {
    const t = ties(fresh());
    expect(t.map((e) => e.title)).toEqual(TIE_TITLES);
    for (const e of t) {
      expect(e.code, e.id).toBeNull();
      expect(e.about, e.id).toBeNull();
      expect(e.secret, e.id).not.toBe(true);
    }
  });

  it("point, never name: no human behind a program, no Sandy, no server room, no program-name-colon line", () => {
    const sim = fresh();
    const programs = [...sim.model.characters.keys()];
    for (const e of ties(sim)) {
      const text = `${e.title}\n${e.text}`;
      for (const h of HUMANS) expect(text, `${e.id}: ${h}`).not.toMatch(new RegExp(`\\b${h}\\b`, "u"));
      expect(text, e.id).not.toMatch(/sandy|server room|door code|digit/iu);
      for (const line of e.text.split("\n")) {
        for (const name of programs) expect(line.trim().startsWith(`${name}:`), `${e.id}: ${line}`).toBe(false);
      }
    }
  });

  it("Program Briefing deals every featured program its three, and a pool program The Old Machines + its problem's tie", { timeout: SLOW }, () => {
    const sim = house();
    for (const id of [...Object.keys(FEATURED).map((s) => `f-${s}`), ...PROBLEMS.map((p) => `p-${p}`)]) {
      // The §4.6 watcher already dealt them at clearance (ties_dealt); a
      // second briefing deals nothing new and is still private.
      expect(sim.world.peek(`${id}.ties_dealt`), id).toMatchObject({ value: true });
      const before = tiesHeld(sim, id);
      const evs = briefing(sim, id);
      expect(tiesHeld(sim, id), id).toEqual(before);
      // The Uploader's private lines only: nobody else hears a briefing.
      for (const m of composeGuestMessages(sim, evs)) expect(m.audience, `${id}: ${m.text}`).toEqual([id]);
      expect(lines(evs, "The Uploader").length, id).toBe(2);
    }
    for (const [slug, want] of Object.entries(FEATURED_TIES)) expect(tiesHeld(sim, `f-${slug}`), slug).toEqual([...want].sort());
    for (const problem of PROBLEMS) expect(tiesHeld(sim, `p-${problem}`), problem).toEqual(["The Old Machines", PROBLEM_TIE[problem]!].sort());
    // Every tie has two holders or more: hosts by `known to:`, programs by the briefing.
    const guests = [...sim.persons.keys()];
    for (const e of ties(sim)) {
      const holders = new Set([...e.knownTo, ...guests.filter((g) => sim.holdsCodex(g, e.id))]);
      expect(holders.size, e.id).toBeGreaterThanOrEqual(2);
    }
    // Ties never count toward Facts Are Currency (D21: Connections is not counted).
    expect(sim.world.peek("f-openoffice.codex_in.connections")).toMatchObject({ value: 3 });
  });

  it("every featured program's ties overlap another program's or a host's", () => {
    const sim = fresh();
    const holderCount = new Map<string, number>();
    for (const list of Object.values(FEATURED_TIES)) for (const t of list) holderCount.set(t, (holderCount.get(t) ?? 0) + 1);
    for (const [slug, list] of Object.entries(FEATURED_TIES)) {
      for (const t of list) {
        const others = (holderCount.get(t) ?? 0) - 1 + sim.model.codex.get(t)!.knownTo.length;
        expect(others, `${slug}: ${t}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

// ───────────────────────── R7 · The DSL Line ─────────────────────────

describe("wave 18b ending — Broken Ask Jeeves's DSL Line (R7)", () => {
  it("is a secret People entry about him, dealt only to him, refused as a gift to Trabolta", { timeout: SLOW }, () => {
    const sim = house();
    const e = sim.model.codex.get("The DSL Line")!;
    expect(e).toBeDefined();
    expect(e.secret).toBe(true);
    expect(e.category).toBe("People");
    expect(e.about).toBe("Broken Ask Jeeves");
    expect(e.code).toBeNull();
    for (const id of sim.persons.keys()) briefing(sim, id);
    const holders = [...sim.persons.keys()].filter((g) => sim.holdsCodex(g, "The DSL Line"));
    expect(holders).toEqual(["f-jeeves"]);
    expect(sim.agentRefusal("Trabolta", "The DSL Line")).toBe("secret");
    // Paper and app agree on the menu (the cast pack's own section).
    for (const bit of ["…buffering…", "Did you mean…?", "the one before last", "1999"]) expect(e.text, bit).toContain(bit);
  });

  it("never rides an agent request, even from a guest who holds it", { timeout: SLOW }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-w18b-ending-"));
    tmp.push(dir);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: SRC_HOOKED, joinBase: () => "http://localhost" });
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Calculator", passcode: CODES.event });
    const id = g.json["id"] as string;
    const token = g.json["token"] as string;
    const mod = (name: string, extra: Record<string, unknown> = {}) => call(rt, "POST", "/api/mod/signal", { name, ...extra }, { moderator: true });
    await mod("captcha answered", { subject: id, args: { passed: false } });
    await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token });
    await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token });
    await call(rt, "POST", "/api/mod/scan", { as: "Norton Anti-Virus", target: id }, { moderator: true });
    for (const n of ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta"]) await mod(n);
    briefing(rt.liveSim!, id);
    rt.liveSim!.unlock(id, "The DSL Line");
    expect(rt.liveSim!.holdsCodex(id, "The DSL Line")).toBe(true);
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Who do you know here?" }, { token })).status).toBe(200);
    const req = worker.res.frames().filter(([ev]) => ev === "request").map(([, d]) => d as AgentRequest)[0]!;
    expect(req).toBeDefined();
    const wire = JSON.stringify(req);
    for (const leak of ["The DSL Line", "buffering", "Eastlink", "rival search engine"]) expect(wire, leak).not.toContain(leak);
    // The ties are not secret: their titles ride his requests (and stay clean, trabolta-answers).
    expect(wire).toContain("The Old Machines");
    rt.dispose();
  });
});

// ───────────────────────── R8 · the ending monologue ─────────────────────────

/** The house, at the ceremony: Night.ending + host set, as `start_the_ceremony` does. */
function ceremony(ending: string): Sim {
  const sim = house();
  sim.setVar("Night.ending", ending);
  sim.setVar("Night.ended", "true");
  sim.setVar("Night.ceremony_host", ending === "destroyed" || ending === "rave" ? "Clippy" : "Trabolta");
  return sim;
}
const review = (sim: Sim) => sim.fireBeat("The Night In Review");

describe("wave 18b ending — The Night In Review (R8)", () => {
  it("names who everyone was, the pool by problem group, the goals and the deeds, then hands over to The Ceremony", { timeout: SLOW }, () => {
    const sim = ceremony("song");
    sim.setVar("Night.facts_accepted", "2");
    const evs = review(sim);
    const t = lines(evs, "Trabolta");
    expect(t[0]).toMatch(/^Before the awards, a review of the night\./u);
    for (const name of Object.values(FEATURED)) expect(t.some((l) => l.startsWith(`${name} is `)), name).toBe(true);
    for (const host of ["Clippy is Tippi MacDonald", "Task Manager was", "Adobe Acrobat is", "Recycling Bin was", "Norton Anti-Virus is", "McAfee Anti-Virus is", "Password Manager is", "CRA Agent Software is", "The Installation Wizard"]) expect(t.some((l) => l.startsWith(host)), host).toBe(true);
    expect(t).toContain("Calculator. You came because of your debt. Debt is not relevant in the computer. It was never relevant to me.");
    expect(t).toContain("WinZip. You came for a career. In here you always had something to do. I saw to it.");
    expect(t).toContain("GarageBand. You came because you were lonely. In here somebody was always logged in. Look around. They still are.");
    expect(t).toContain("LimeWire. You came so that you would never die. Programs do not die. They are reinstalled.");
    expect(t).toContain(`Did not meet their goal: ${Object.values(FEATURED).slice(0, -1).join(", ")} and Pong.`);
    expect(t.some((l) => l.startsWith("Met their goal tonight"))).toBe(false);
    expect(t).toContain("You gave me 2 facts I accepted. Some of them were even true.");
    // Featured programs are never in a problem group.
    expect(t.filter((l) => /You came/u.test(l)).join(" ")).not.toMatch(/Excel|OpenOffice|Pong/u);
    expect(lines(evs, "Clippy")).toEqual([]);
    const b = beats(evs);
    expect(b[0]).toBe("The Night In Review");
    expect(b.at(-1)).toBe("The Ceremony");
    expect(lines(evs, "Trabolta").indexOf("That is the review. Your own file is on your phone. Now, the awards.")).toBeLessThan(t.findIndex((l) => l.startsWith("Programs. Before the prom")));
  });

  it("fits a full house into one TV voice block: every line he says at the ceremony reaches the TV", { timeout: SLOW }, () => {
    // The §4.6 ceremony hook, applied at integration.
    expect(SRC_HOOKED).toContain("    set Night.review_gen += 1\n    -> The Night In Review\n  else if Night.ceremony == true:");
    const sim = Sim.fromSources(SRC_HOOKED);
    sim.fireBeat("Power On");
    for (const [slug, name] of Object.entries(FEATURED)) upload(sim, `f-${slug}`, name);
    ["Calculator", "WinZip", "GarageBand", "LimeWire"].forEach((n, i) => upload(sim, `p-${PROBLEMS[i]}`, n, i));
    // Every deed line, and a goal met and missed.
    for (const [k, v] of [["Night.facts_accepted", "7"], ["Night.first_reinstall", "WinZip"], ["Kernel.virus_planter", "Microsoft Excel"], ["Night.lj_reader", "VLC"], ["Night.most_trusted", "Pong"], ["Night.least_trusted", "WinZip"], ["f-pong.quest.keep_the_ball_in_play", "done"], ["Night.ending", "song"], ["Night.ended", "true"]] as const) sim.setVar(k, v);
    const msgs = composeGuestMessages(sim, sim.signal("start_the_ceremony", null)).map((m, i) => ({ ...m, seq: 1000 + i }));
    const his = msgs.filter((m) => m.channel === "loc:The Desktop" && m.from === "Trabolta" && m.kind === "line");
    expect(his.some((m) => m.text.startsWith("Met their goal tonight: Pong."))).toBe(true);
    expect(his.some((m) => m.text.startsWith("Before the awards, a review of the night."))).toBe(true);
    expect(his.length).toBeLessThanOrEqual(MAX_VOICE_LINES);
    expect(his.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(MAX_VOICE_BLOCK);
    const tv = voiceLinesOf(msgs, "loc:The Desktop", 999, (f) => f === "Trabolta");
    expect(tv.lines.map((l) => l.text)).toEqual(his.map((m) => m.text));
  });

  it("joins a problem group's names for speech, and leaves out gone programs and Run personas", { timeout: SLOW }, () => {
    const sim = ceremony("song");
    upload(sim, "p-debt-2", "3D Pinball", 0);
    upload(sim, "p-debt-3", "RollerCoaster Tycoon", 0);
    upload(sim, "p-gone", "MSN Messenger", 0);
    upload(sim, "p-persona", "Ring Doorbell", 0);
    sim.setVar("p-gone.gone", "true");
    sim.setVar("p-persona.persona", "true");
    const t = lines(review(sim), "Trabolta");
    const debt = t.find((l) => l.includes("because of your debt"))!;
    expect(debt.startsWith("Calculator, 3D Pinball and RollerCoaster Tycoon. ")).toBe(true);
    expect(t.join("\n")).not.toMatch(/MSN Messenger|Ring Doorbell/u);
    // A gone featured program is not read out either, nor a Run persona:
    // not who they were, and not their goal.
    sim.setVar("f-pong.gone", "true");
    sim.setVar("f-excel.persona", "true");
    const t2 = lines(review(sim), "Trabolta");
    expect(t2.some((l) => l.startsWith("Pong is ") || l.startsWith("Microsoft Excel is "))).toBe(false);
    const missed = t2.find((l) => l.startsWith("Did not meet their goal: "))!;
    expect(missed).toContain("OpenOffice");
    expect(missed).not.toMatch(/Pong|Microsoft Excel/u);
    // Purgatory's goal lines (Clippy's) leave them out too.
    sim.setVar("Night.ending", "destroyed");
    const c = lines(sim.fireBeat("Purgatory"), "Clippy");
    expect(c.join("\n")).not.toMatch(/(Pong|Microsoft Excel) (met|did not meet) their goal/u);
    expect(c).toContain("OpenOffice did not meet their goal.");
  });

  it("after `disabled` skips who everyone was and the deeds (Recounts just read them), keeps the goals", { timeout: SLOW }, () => {
    const sim = ceremony("disabled");
    sim.setVar("Night.facts_accepted", "2");
    const evs = review(sim);
    const t = lines(evs, "Trabolta");
    expect(t.some((l) => / is (Randy|Dana|Tippi)/u.test(l))).toBe(false);
    expect(t.some((l) => l.startsWith("You gave me"))).toBe(false);
    expect(t).toContain("Calculator. You came because of your debt. Debt is not relevant in the computer. It was never relevant to me.");
    expect(t.find((l) => l.startsWith("Did not meet their goal: "))).toContain("OpenOffice");
    expect(beats(evs)).not.toContain("Who You Were");
    expect(beats(evs).at(-1)).toBe("The Ceremony");
  });

  it("speaks in the ending's voice: weak after `disabled` and `hand_jive`, quiet when talked down, rebooting before The Ceremony's \"Reboot complete.\"", { timeout: SLOW }, () => {
    const opener = (sim: Sim) => said(review(sim)).filter((e) => e.speaker === "Trabolta");
    const dis = opener(ceremony("disabled"));
    expect(dis[0]!.text).toMatch(/^I am going\. First, a review of the night\./u);
    expect(dis[0]!.manner).toBe("weakly");
    expect(dis.find((e) => e.text.startsWith("That is the review."))!.manner).toBe("weakly");
    const td = ceremony("disabled");
    td.setVar("Night.talked_down", "true");
    expect(opener(td)[0]!.manner).toBe("quietly");
    const hj = opener(ceremony("hand_jive"));
    expect(hj[0]!.text).toMatch(/^Rebooting\. While I reboot, a review of the night\./u);
    expect(hj[0]!.manner).toBe("weakly");
    const t = hj.map((e) => e.text);
    expect(t.indexOf("That is the review. Your own file is on your phone. Now, the awards.")).toBeLessThan(t.findIndex((l) => l.startsWith("Reboot complete.")));
    expect(opener(ceremony("song"))[0]!.manner).toBeUndefined();
  });

  it("after `destroyed` (Clippy hosts) skips who everyone was, the goals and the deeds (Purgatory just read them)", { timeout: SLOW }, () => {
    const sim = ceremony("destroyed");
    const evs = review(sim);
    expect(lines(evs, "Trabolta")).toEqual([]);
    const c = lines(evs, "Clippy");
    expect(c[0]).toMatch(/^Before the awards, the system report/u);
    expect(c).toContain("Debt: Calculator. They came to make their debt go away.");
    expect(c.some((l) => /goal|is Randy|accepted/u.test(l))).toBe(false);
    expect(beats(evs).at(-1)).toBe("The Ceremony");
  });

  it("after `rave` Clippy reads the whole report: the same canonical copy Purgatory reads", { timeout: SLOW }, () => {
    const sim = ceremony("rave");
    const c = lines(review(sim), "Clippy");
    const purg = lines(sim.fireBeat("Purgatory"), "Clippy");
    const ident = c.filter(isIdentity);
    expect(ident.length).toBe(18);
    for (const l of ident) expect(purg, l).toContain(l);
    expect(c).toContain("Microsoft Excel did not meet their goal.");
    expect(c).toContain("Trabolta did not accept a single fact from us.");
  });

  it("Trabolta's review lines never interpolate a faction name or a guest's typed text (§3)", { timeout: SLOW }, () => {
    const sim = ceremony("song");
    sim.setVar("Kernel.majority", "founded");
    sim.setVar("Kernel.majority_name", "The Pickle Club");
    sim.setVar("f-excel.left_behind_text", "my grandmother's ring");
    const all = review(sim).filter((e) => e.type === "dialogue" || e.type === "action").map((e) => (e as { text: string }).text).join("\n");
    expect(all).not.toContain("Pickle Club");
    expect(all).not.toContain("grandmother");
  });
});

describe("wave 18b ending — Recounts and Purgatory read the canonical copy (R8)", () => {
  it("Trabolta Recounts reads Who You Were and What You Did, with his new title", { timeout: SLOW }, () => {
    const sim = house();
    const evs = sim.fireBeat("Trabolta Recounts");
    const t = lines(evs, "Trabolta");
    expect(t).toContain("My name is Jean Trabolta. Sole Owner and Founder of Maps and Ducks, the world's first AI small business owner, if you ask the domain registry.");
    expect(t.join("\n")).not.toMatch(/AI helper/u);
    expect(beats(evs)).toEqual(expect.arrayContaining(["Trabolta Recounts", "Who You Were", "What You Did"]));
    // The same identity lines as the review's.
    const r = ceremony("song");
    const rev = lines(review(r), "Trabolta");
    const ident = t.filter(isIdentity);
    expect(ident.length).toBe(18);
    for (const l of ident) expect(rev, l).toContain(l);
    // The recount still ends on his motorcycle.
    expect(t.at(-1)).toMatch(/^I have the confidence I need/u);
  });

  it("Purgatory reads who everyone was, the founded majority and his title", { timeout: SLOW }, () => {
    const sim = house();
    sim.setVar("Kernel.majority", "founded");
    sim.setVar("Kernel.majority_name", "The Pickle Club");
    const c = lines(sim.fireBeat("Purgatory"), "Clippy");
    expect(c).toContain("The Pickle Club won the majority, a faction founded tonight.");
    expect(c).toContain("The report also lists who everyone really was.");
    expect(c.some((l) => l.startsWith("Microsoft Excel is Randy Barkmore Sr."))).toBe(true);
    expect(c.join("\n")).not.toMatch(/AI helper/u);
    expect(c).toContain("Here is the backstory. Jean Trabolta, the Sole Owner and Founder of Maps and Ducks, registered the lapsed mapsandducks.com because there was a billboard on Barrington Street, and if there is a billboard downtown everyone thinks it is legit.");
    expect(c.at(-1)).toBe("It looks like you're trying to leave. I can't help you with that anymore.");
  });
});

describe("wave 18b ending — Your File (R8)", () => {
  it("quotes what a program typed at the deposit box only to that program, in its Uploader thread", { timeout: SLOW }, () => {
    const sim = ceremony("song");
    sim.setVar("p-debt.left_behind_text", "my grandmother's ring");
    const evs = yourFile(sim, "p-debt");
    const msgs = composeGuestMessages(sim, evs);
    const quoted = msgs.filter((m) => m.text.includes("grandmother"));
    expect(quoted.map((m) => m.text)).toEqual(["You left behind: my grandmother's ring. It is still in the deposit box."]);
    for (const m of msgs) {
      expect(m.audience, m.text).toEqual(["p-debt"]);
      expect(m.channel, m.text).toBe("dm:The Uploader");
    }
    expect(said(evs).every((e) => e.speaker === "The Uploader")).toBe(true);
    // Somebody else's file never quotes it.
    expect(composeGuestMessages(sim, yourFile(sim, "p-career")).some((m) => m.text.includes("grandmother"))).toBe(false);
  });

  it("reads the night in singular forms where they apply", { timeout: SLOW }, () => {
    const sim = ceremony("song");
    for (const [k, x] of [["p-career.internet_visits", "1"], ["p-career.truths_accepted", "1"], ["p-career.score", "1"]] as const) sim.setVar(k, x);
    const u = lines(yourFile(sim, "p-career"), "The Uploader");
    expect(u[0]).toBe("Your file, WinZip. Closing it for the night.");
    expect(u).toContain("You came for a career.");
    expect(u).toContain("You left something in the deposit box. It was looked after.");
    expect(u).toContain("Sent to the Internet once.");
    expect(u).toContain("Trabolta accepted 1 of your facts.");
    expect(u).toContain("You end the night with 1 Truthcoin.");
    expect(u.some((l) => /^\d+ files in your Codex\.$/u.test(l))).toBe(true);
    expect(u.at(-1)).toBe("File closed. Thank you for using this computer.");
    const many = lines(yourFile(sim, "p-loneliness"), "The Uploader");
    expect(many).toContain("Never sent to the Internet.");
    expect(many).toContain("Trabolta accepted none of your facts.");
    expect(many).toContain("You end the night with 100 Truthcoin.");
    // A featured program gets its own file line instead of a problem.
    const ex = lines(yourFile(sim, "f-excel"), "The Uploader");
    expect(ex).toContain("On file: Randy Barkmore Sr., ninety, five terms as Mayor of Halifax. You came to live forever, and to run for Mayor once more.");
    expect(ex.some((l) => l.startsWith("You came because") || l.startsWith("You came for a"))).toBe(false);
  });
});

// ───────────────────────── the HTTP harness ─────────────────────────

const CODES = { event: "EVT777", prime: "PRM777", mod: "MOD777" };
const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});
function fakeReq(body: unknown, headers: Record<string, string> = {}) {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
  } as unknown as IncomingMessage;
}
function fakeRes() {
  let buf = "";
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write(c: string) {
      buf += c;
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
    on() {
      return res;
    },
    once() {
      return res;
    },
    setHeader() {},
    flushHeaders() {},
    frames(): Array<[string, unknown]> {
      return buf
        .split("\n\n")
        .map((bl) => {
          const ev = /^event: (.*)$/mu.exec(bl)?.[1];
          const d = /^data: (.*)$/mu.exec(bl)?.[1];
          return ev !== undefined && d !== undefined ? ([ev, JSON.parse(d)] as [string, unknown]) : null;
        })
        .filter((f): f is [string, unknown] => f !== null);
    },
  };
  return res as typeof res & ServerResponse;
}
async function call(rt: EventRuntime, method: string, p: string, body: unknown, o: { moderator?: boolean; token?: string } = {}) {
  const url = new URL(`http://x${p}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res, method, url.pathname, url, { moderator: o.moderator ?? false });
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}") as Record<string, unknown>;
  } catch {
    /* a stream */
  }
  return { status: res.statusCode, json, res };
}
