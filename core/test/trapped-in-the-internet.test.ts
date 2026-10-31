//! Trapped in the Internet — the show, played end to end through the
//! public `Sim` API the way the event server + the bridges drive it
//! (design §6.1). One shared sim plays the whole night to the combo A
//! ending; fresh sims cover every other branch: Bingo, the overshare
//! scenarios, both majorities, combo B, the server-room alarm, every
//! verdict and alternate ending, and Trabolta's powers + phase guards.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Sim, namedEvents } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioDir, scenarioFiles, scenarioSource } from "../examples/load.ts";
import { FACTS_FILE, parseFactsText } from "../src/facts.ts";
import { FactsWatch, judgeAnswer, parseFactsBook } from "../server/facts.ts";
import { foldCode } from "../src/runtime/sim/model.ts";
import { parse } from "../src/parser/index.ts";
import { foldName } from "../src/parser/names.ts";
import { cueState, guestView, modView, pressRefused, primeView } from "../server/views.ts";
import { cueRows } from "../src/cue-sheet.ts";
import { composeGuestMessages } from "../server/chat.ts";
import { liesByPerson } from "../server/recap.ts";
import { identityDefs, guestPickable, isSpecial, performerPickable } from "../server/identity.ts";
import { WalletBook, walletSeam } from "../server/wallet.ts";
import type { GuestView, ModView, PrimeView } from "../server/views.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { AgentFacts, AgentRequest } from "../server/agents.ts";
import { TO_HUNT2 } from "../../scripts/accept/chains.ts";
import { PANEL_JACKS } from "../scripts/titi-facts.ts";
import { withTestKeys } from "./fixtures/hunt-keys.ts";

// ───────────────────────── helpers ─────────────────────────

const SHOW = "trapped-in-the-internet";
const FILES = scenarioFiles(SHOW);
const SRC = scenarioSource(SHOW);
/** facts.json — the hunt questions, the scannable facts and the truths the
 *  generated story (generated/questions.loom, codex/9-facts.loom) is made of. */
const FACTS = parseFactsText(withTestKeys(readFileSync(join(scenarioDir(SHOW), FACTS_FILE), "utf8"))).facts!;
const Q = (id: string) => FACTS.questions.find((q) => q.id === id)!;
/** The server's answer key (core/server/facts.ts): the show tests attach the
 *  verdict the event server would, since the Sim never reads facts.json. */
const BOOK = parseFactsBook(withTestKeys(readFileSync(join(scenarioDir(SHOW), FACTS_FILE), "utf8"))).book!;
/** The server's build: every file concatenated. */
const fresh = (): Sim => Sim.fromSources(SRC);
const SLOW = 120_000;

type Ev<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};
const said = (evs: SimEvent[]) => evs.filter((e) => e.type === "dialogue") as Ev<"dialogue">[];
const saidBy = (evs: SimEvent[], speaker: string) => said(evs).filter((e) => e.speaker === speaker);
const lines = (evs: SimEvent[], speaker: string) => saidBy(evs, speaker).map((e) => e.text);
const narr = (evs: SimEvent[]) => evs.filter((e) => e.type === "action") as Ev<"action">[];
const replies = (evs: SimEvent[]) => evs.filter((e) => e.type === "respond") as Ev<"respond">[];
const casts = (evs: SimEvent[]) => evs.filter((e) => e.type === "broadcast") as Ev<"broadcast">[];
const cues = (evs: SimEvent[]) => (evs.filter((e) => e.type === "directive") as Ev<"directive">[]).map((e) => `${e.verb} ${e.args}`.trim());
const learned = (evs: SimEvent[]) => evs.filter((e) => e.type === "codexUnlocked") as Ev<"codexUnlocked">[];
const widgets = (evs: SimEvent[]) => evs.filter((e) => e.type === "widget") as Ev<"widget">[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const beats = (evs: SimEvent[]) => evs.filter((e) => e.type === "beatEntered").map((e: any) => (e.beat ?? e.name) as string);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const diags = (evs: SimEvent[]) => evs.filter((e) => e.type === "diagnostic").map((e: any) => e.message as string);
const has = (xs: string[], needle: string) => xs.some((x) => x.includes(needle));
const texts = (evs: SimEvent[]) => [
  ...said(evs).map((e) => `${e.speaker}: ${e.text}`),
  ...narr(evs).map((e) => e.text),
  ...replies(evs).map((e) => `>${e.to}: ${e.text}`),
  ...casts(evs).map((e) => `!${e.cue}`),
];
const aud = (e: { audience: readonly string[] }) => JSON.stringify(e.audience);
/** Everything but the crew's # hosts notes (a refused cue tells only them, T1-02). */
const offstage = (evs: SimEvent[]) => texts(evs.filter((e) => !(e.type === "broadcast" && e.scope === "channel(hosts)")));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
/** The categories OpenOffice's dossier counts (wave 18b, R22). */
const DOSSIER_CATEGORIES = new Set(["Facts", "Files", "People", "Trabolta", "Places"]);
const worldKeys = (sim: Sim) => [...((sim.world as any).values as Map<string, unknown>).keys()];

/** Ticks one second at a time, like the server's clock. */
function advance(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds; i++) out.push(...sim.tick(1000));
  return out;
}

const FEATURED = ["Microsoft Excel", "OpenOffice", "DraftKings", "Bugdom", "Broken Ask Jeeves", "Runescape", "MS Paint", "VLC", "Pong"];
const PERFORMERS = ["Adobe Acrobat", "CRA Agent Software", "Clippy", "McAfee Anti-Virus", "Norton Anti-Virus", "Password Manager", "Recycling Bin", "Task Manager"];
/** The four Enforcer booths (TRAIT Enforcer in cast/kit.loom): every escort
 *  readout lands in each. Wave 18 (Q26): the door-only part is gone. */
const ANTIVIRUS = ["Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software"];
/** The four hear the patrol, sweep, escort, Bathroom Mode and alarm
 *  readouts (the same four as ANTIVIRUS since wave 18). */
const PATROL = ANTIVIRUS;
/** The rooms an Antivirus clearance (or a release) opens: the whole house
 *  but the Optical Drive, the Tube, the Internet and the Server Room. */
const HOUSE_ROOMS = ["The Start Bar", "The CPU", "The Power Supply", "Disk Cleanup", "The Cloud", "The RAM", "The Fan Closet", "The Casino", "The Hard Drive"];
const fold = (s: string) =>s.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();

/** Register → CAPTCHA (pass = INCORRECT, then CORRECT) → the problem (skipped
 *  for a featured name, which is not asked) → deposit → the door scan. */
function upload(sim: Sim, id: string, name: string, scanner = "Norton Anti-Virus"): SimEvent[] {
  const out: SimEvent[] = [];
  out.push(...sim.createPerson(id, name));
  out.push(...sim.signal("captcha answered", id, { passed: true }));
  out.push(...sim.signal("captcha answered", id, { passed: false }));
  const p = sim.pendingChoiceFor(id);
  if (p && p.length === 5) out.push(...sim.choose(id, 0));
  out.push(...sim.choose(id, 0));
  out.push(...sim.scan(scanner, id));
  return out;
}

// ───────────────────────── 1 · compile ─────────────────────────

describe("Trapped in the Internet — compile", () => {
  const sim = fresh();
  const m = sim.model;

  it("Trabolta has a plain-words server hold line for when no worker is online (N-11)", () => {
    const hold = m.characters.get("Trabolta")?.hold ?? "";
    expect(hold).toMatch(/^Jean Trabolta /u);
    // A terminal reads it aloud: no glyphs, brackets or quotes.
    expect(hold).toMatch(/^[A-Za-z .,']+$/u);
  });

  it("Trabolta has a plain-words busy line for a burst behind an online worker (wave 11, C6)", () => {
    const busy = m.characters.get("Trabolta")?.busy ?? "";
    expect(busy).toMatch(/^Jean Trabolta /u);
    expect(busy).toMatch(/^[A-Za-z .,']+$/u); // read aloud on a terminal too
    expect(busy).not.toBe(m.characters.get("Trabolta")?.hold); // behind, not gone
  });

  it("parses clean, concatenated and per file; both builds agree on the rules", () => {
    const [, all] = parse(SRC);
    expect(all.filter((d) => d.severity === "error")).toEqual([]);
    for (const f of FILES) {
      const [, d] = parse(f.source);
      expect(d.filter((x) => x.severity === "error"), f.path).toEqual([]);
    }
    const perFile = Sim.fromSources(...FILES);
    expect(m.rules.length).toBeGreaterThan(0);
    expect(m.rules.length).toBe(perFile.model.rules.length);
  });

  it("declares the world the runbook promises", () => {
    expect(m.title).toBe("Trapped in the Internet");
    expect(m.theme).toBe("aol97");
    expect(m.directory).toBe("everyone");
    expect([...m.factions.keys()].sort()).toEqual(["Antivirus", "Hosts", "The Way Out", "Unlimited Power"]);
    expect(m.factions.get("Hosts")!.joinable).toBe(false);
    expect(m.factions.get("Antivirus")!.joinable).toBe(false);
    expect(m.factions.get("Unlimited Power")!.hidden).toBe(true);
    expect(m.factions.get("The Way Out")!.hidden).toBe(true);
    expect([...m.locations.keys()]).toEqual(["The Desktop", "The Optical Drive", "The Tube", "The Internet", "The Start Bar", "The CPU", "The Power Supply", "Disk Cleanup", "The Cloud", "The RAM", "The Fan Closet", "The Casino", "The Hard Drive", "The Server Room", "The Script"]);
    const inet = m.locations.get("The Internet")!;
    expect(inet.prison).toBe(true);
    expect(inet.sealed).toBe(true);
    expect(m.locations.get("The Optical Drive")!.cutscene).toBe(true);
    expect(m.locations.get("The Server Room")!.hidden).toBe(true);
    expect(m.defaultRole).toBe("Program");
  });

  it("declares the Truthcoin wallet (wave 4, lane C): the currency header, CRA the approver, Runescape the minter and still a guest program", () => {
    expect(m.currency).toEqual({
      slot: "score",
      name: "Truthcoin",
      maxTransfer: 500,
      expiryMs: 600_000,
      approver: { id: "CRA Agent Software", every: 3, windowMs: 60_000, as: "MyCRA", audit: "a CRA audit" }, // wave 18b (R13)
      minter: { id: "Runescape", limit: 3, while: "program.cleared == true", grants: 3, freezeMs: 600_000 },
    });
    expect(m.characters.get("CRA Agent Software")!.wallet).toEqual({ role: "approver", every: 3, windowMs: 60_000, as: "MyCRA", audit: "a CRA audit" });
    // The `while` clause is pinned verbatim: if ROLE Program is ever renamed it silently pays nobody.
    // grants 3 + freeze 10m are written out: the invitation and C24 promise a ten-minute freeze.
    expect(m.characters.get("Runescape")!.wallet).toEqual({ role: "minter", limit: 3, while: "program.cleared == true", grants: 3, freezeMs: 600_000 });
    expect(isSpecial(m, "Runescape")).toBe(false); // a property, never a part
    expect(isSpecial(m, "CRA Agent Software")).toBe(true); // a part → approvals land in the booth
    for (const c of m.characters.values()) if (c.wallet !== null) expect(["CRA Agent Software", "Runescape"]).toContain(c.id);
  });

  it("the runbook's door and terminal rows follow wave 11: no riddle path, The Heart once he is awake, chess from the Server Door terminal", () => {
    const readme = readFileSync(join(scenarioDir(SHOW), "README.md"), "utf8");
    const row = (name: string) => readme.split("\n").find((l) => l.startsWith(`| **${name}**`)) ?? "";
    const door = row("The server-room door");
    expect(door).not.toMatch(/riddle|from step 14 the first opening/u);
    expect(door).toMatch(/digit notes/u);
    expect(door).toMatch(/once Trabolta is awake/iu);
    const terminals = row("Terminals");
    expect(terminals).not.toMatch(/tent tablet's `chess won`/u);
    expect(terminals).toMatch(/view=chess/u);
  });

  it("pins the codex: 267 entries, 161 codes, every facts.json code resolving, no STAMPED anywhere", () => {
    // Wave 11: + the cold door's four digit notes (facts.json door.clues).
    // Wave 18b: + the sixteen ties (codex/85-ties.loom) and The DSL Line, none coded.
    // Wave 35: + the 78 new tiered facts (codex/9-facts.loom), every one coded.
    // Wave 58: the Oct 30 file culls 21 generated cards and adds 10 new ones.
    expect(m.codex.size).toBe(267);
    expect(m.codexCodes.size).toBe(161);
    // The README's counts follow the pin (its file listing, its status line and the Codex section).
    const readme = readFileSync(join(scenarioDir(SHOW), "README.md"), "utf8");
    expect([...readme.matchAll(/\b(\d+) CODEX entries|(\d+) codex entries|There\s+are \*\*(\d+)\*\*/gu)].map((x) => Number(x[1] ?? x[2] ?? x[3]))).toEqual([267, 267, 267]);
    const codes: Record<string, string> = {
      trabolta4ever: "The LiveJournal",
      loveletterforyou: "ILOVEYOU",
      coldstorage: "The Server Room",
      fbihalifax: "The FBI Lanyard",
    };
    for (const [c, e] of Object.entries(codes)) expect(m.codexCodes.get(c), c).toBe(e);
    // The hunt answers (generated/questions.loom) keep their ids and codes,
    // each `secret: true`: Trabolta never reads one nor takes one as a share
    // (test/trabolta-answers.test.ts).
    for (const q of FACTS.questions) {
      expect(m.codexCodes.get(foldCode(q.codex!.code)), q.id).toBe(q.codex!.id);
      expect(m.codex.get(q.codex!.id)!.text.endsWith(`▒ HUNT ANSWER ${q.id} ▒`), q.id).toBe(true);
      expect(m.codex.get(q.codex!.id)!.secret, q.id).toBe(true);
    }
    expect(m.codex.get("The Prom Ticket")!.title).toBe("Grok's Prom Ticket");
    // Every scannable fact (codex/9-facts.loom) and every `existing` one with its hand-added code.
    for (const x of FACTS.facts) {
      if (x.codex !== undefined) expect(m.codexCodes.get(foldCode(x.codex.code)), x.id).toBe(x.codex.id);
      else {
        expect(m.codex.has(x.existing!), x.id).toBe(true);
        if (x.code !== undefined) expect(m.codex.get(x.existing!)!.code, x.id).toBe(foldCode(x.code));
      }
    }
    for (const c of FACTS.door!.clues!) expect(m.codexCodes.get(foldCode(c.code)), c.id).toBe(c.id);
    for (const [id, e] of m.codex) expect(e.text, id).not.toContain("STAMPED");
    expect(m.codex.has("The Truther Download")).toBe(true);
    expect(m.codex.get("The Truther Download")!.secret).toBe(true);
    expect(m.codex.get("The Truther Download")!.text.startsWith("TOP SECRET TOP SECRET TOP SECRET TOP SECRET TOP SECRET\n- The following message is TOP SECRET.")).toBe(true);
    expect(m.codex.get("The Truther Download")!.text.endsWith("- There is still time.\n- In truth.")).toBe(true);
  });

  it("every account of the Prime Minister's email says every third transaction, as the books do (C16)", () => {
    // The Carney Letter is the email itself; C16, The Truth File, the finale's
    // truth.txt and the CRA + Adobe Acrobat packs retell it. `every 3` is the
    // approver's rule (cast/antivirus.loom), and every account says so.
    const packDir = join(scenarioDir(SHOW), "cast-packs");
    const pack = (f: string) => readFileSync(join(packDir, "performers", f), "utf8").replace(/\s+/gu, " ");
    const flat = (id: string) => m.codex.get(id)!.text.replace(/\s+/gu, " ");
    expect(flat("The Carney Letter")).toContain("approve or deny every third transaction.");
    expect(flat("Approve Or Deny")).toContain("Truthcoin transactions as possible and to approve or deny every third one");
    expect(pack("cra-agent.md")).toContain("approve or deny every third");
    // Nowhere does the demand stay "every transaction" / "every one of them".
    const packs = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? packs(join(d, e.name)) : e.name.endsWith(".md") ? [join(d, e.name)] : []));
    const texts = [...FILES.map((f) => [f.path, f.source] as const), ...packs(packDir).map((p) => [p, readFileSync(p, "utf8")] as const)];
    for (const [path, text] of texts) expect(text.replace(/\s+/gu, " "), path).not.toMatch(/approve or deny every (?:transaction|one of them)/u);
  });

  it("M22: the King plays at the terminal outside the cold door; a checkmate gives the code; no hints (wave 11)", () => {
    // The board left the tent tablet: it is only on the door terminal, all
    // night, with no hints. His health in the simulation sets how well he
    // plays (information, not a tip).
    const text = m.codex.get("Checkmate For The Code")!.text.replace(/\s+/gu, " ");
    expect(text).toContain("He waits on the terminal outside the cold door");
    expect(text).toContain("Checkmate him and he gives you the four digits.");
    expect(text).toContain("A draw or a loss changes nothing: play him again.");
    expect(text).toContain("How well he plays depends on how much fight he has left in the simulation.");
    expect(text).not.toMatch(/tent|tablet|every hit|dumber|hint|Y2K|practi[cs]/iu);
    expect(text).not.toMatch(/fresh board|deals him|re-?deal|ninety seconds|disarm/iu);
  });

  it("every codex title is its own: no two entries share one and none is another entry's id (the wallet trades by title)", () => {
    // server/wallet.ts resolves a phone's offer by id first, then by the
    // first entry with that title: a shared title trades the wrong entry.
    const ids = new Map([...m.codex.keys()].map((id) => [foldName(id), id] as const));
    const byTitle = new Map<string, string>();
    for (const e of m.codex.values()) {
      const k = foldName(e.title);
      expect(byTitle.get(k), `${e.id} shares the title "${e.title}"`).toBeUndefined();
      byTitle.set(k, e.id);
      expect(ids.get(k) ?? e.id, `${e.id}'s title "${e.title}" is another entry's id`).toBe(e.id);
    }
    expect(m.codex.get("Pong Orders")!.title).toBe("A Game For Two Players");
    expect(m.codex.get("Tennis For Two")!.about).toBe("Pong");
  });

  it("declares the 27 quests in order (the three hunt quests generated first, the seven staff quests last), with titles and givers", () => {
    const QUESTS = [
      ["Hunt One", "The Truth Scavenger Hunt · Round 1", "Trabolta"],
      ["Hunt Two", "The Truth Scavenger Hunt · Round 2", "Trabolta"],
      ["The Final Facts", "The Final Fact-Finding Round", "Trabolta"],
      ["Orientation", "Clippy's Orientation", "Clippy"],
      ["The Bingo Card", "Computer Bingo", "Clippy"],
      ["Excel Mission", "Computers Are Very Confusing", "Truther Download"],
      ["OpenOffice Dossier", "Facts Are Currency", "Truther Download"],
      ["Recruit To Stay", "Stay Forever", "Truther Download"],
      ["Recruit To Leave", "Get Out", "Truther Download"],
      // Wave 18b (R4): a founder's own quest.
      ["A Faction Of Your Own", "Your Own Faction", "Truther Download"],
      ["Truthcoin Hustle", "Sweet Sweet Truthcoin", "Truther Download"],
      ["Master Of The Bugs", "Master Of The Bugs", "Truther Download"],
      ["Unscramble", "Organize The Information", "Truther Download"],
      ["Ten Findings", "Ask Jeeves Once Again", "The Uploader"],
      ["The Gold Standard", "Peg It To Facts", "Truther Download"],
      ["Find The Exit", "Paint Your Way Out", "Truther Download"],
      // Wave 11: the cold door's digit notes.
      ["The Cold Door", "The Cold Door", "A Tired Sysadmin"],
      ["The Painting", "The Million Dollar Painting", "The Uploader"],
      ["Go Viral", "Your Followers Are Back", "Truther Download"],
      ["Keep The Ball In Play", "Tennis For Two", "Truther Download"],
      // Staff quests: the hosts' and Antivirus' agenda, in their booths' Quest Log (wave 4, lane D).
      ["Run The Bingo", "Per the agenda: Computer Bingo", "Task Manager"],
      ["Host The Hunt", "Per the agenda: the Truth Scavenger Hunt", "Task Manager"],
      ["Keep Everyone Calm", "Per Trabolta: keep everyone calm", "Task Manager"],
      ["The Selected Antivirus", "Patrol: the Bingo", "Task Manager"],
      ["The Exchange", "Patrol: the exchange", "Task Manager"],
      ["The Clubs", "Patrol: the clubs", "Task Manager"],
      ["The Audit", "Patrol: the audit", "Task Manager"],
    ];
    const qs = [...m.quests.values()].map((q) => [q.id, q.title, q.giver]);
    expect(qs).toEqual(QUESTS);
    expect(m.quests.size).toBe(27);
    expect(m.quests.get("Orientation")!.text).toContain("Bathroom Mode: open Start and tap 🚻 Bathroom Mode");
    // The generated quests list exactly their round's questions, from facts.json.
    for (const [id, round] of [["Hunt One", 1], ["Hunt Two", 2], ["The Final Facts", 3]] as const) {
      const text = m.quests.get(id)!.text;
      const own = FACTS.questions.filter((q) => q.round === round);
      own.forEach((q, i) => expect(text, id).toContain(`- Q${i + 1}. ${q.text}`));
      for (const q of FACTS.questions) if (q.round !== round) expect(text, `${id} ~ ${q.id}`).not.toContain(q.text);
    }
  });

  it("declares the interactions: admin cue sheet, per-question judge buttons, guest + agent buttons", () => {
    const ints = [...m.interactions.values()];
    const by = (w: string) => ints.filter((i) => i.who === w).map((i) => i.id);
    // Wave 26 (B1): a guest's 🎱 BINGO!.
    // Wave 44 (C1, C2): 🆘 Help Me and the two 🎥 video buttons.
    expect(by("guest")).toEqual(["go to the bathroom", "back from the bathroom", "tent_help_me", "video_leave_me_out", "video_use_me", "call_bingo", "plant_the_virus"]);
    const perf = by("performer");
    for (const p of ["accurate_q1", "accurate_q2", "accurate_q3", "confident_q1", "confident_q2", "confident_q3", "fact_accurate", "fact_lie", "fact_uncertain", "send to the internet", "mark as reinstalled", "named_at_bingo", "unmark_for_reinstallation", "truth_answered", "truth_refused", "chose_dare"]) expect(perf).toContain(p);
    // The hat is gone (wave 4, lane B): the bottle's buttons replace it.
    expect(perf).not.toContain("called_it_false");
    for (const p of ["chose_dare", "truth_answered", "truth_refused"]) expect(m.interactions.get(p)!.while, p).toBe("Night.bottle_open == true");
    expect(m.interactions.get("chose_dare")!.label).toContain("marked for reinstallation");
    // The verdict buttons mark, never capture (wave 4, lane E); the 🛡 stays the capture.
    for (const p of ["uncertain_answer", "missed_the_cup", "failed_the_bob", "named_at_bingo"]) expect(m.interactions.get(p)!.label, p).toContain("marked for reinstallation");
    expect(m.interactions.get("unmark_for_reinstallation")!.label).toBe("🩹 Unmark: not going to the Internet");
    expect(perf).not.toContain("accurate_truth");
    expect(perf).not.toContain("confident_lie");
    const ev = namedEvents(m);
    // The mark's story events are on the director's list; the engine verbs behind them are not.
    for (const e of ["mark_for_reinstallation", "unmark_for_reinstallation", "named_at_bingo", "marked", "unmarked"]) expect(ev, e).toContain(e);
    for (const e of ["restricted", "unrestricted"]) expect(ev, e).not.toContain(e);
    const admin = by("admin");
    expect(admin.length).toBeGreaterThan(40);
    for (const a of admin) expect(ev, a).toContain(a);
    // The First Moment of Truth's cues, in running order: ⏱ close, 📋 results, then 🍾 the bottle after Q3 (wave 18b: a spine row).
    expect(admin).not.toContain("truth_or_dare");
    expect(admin.slice(admin.indexOf("first_moment_of_truth"), admin.indexOf("first_moment_of_truth") + 4)).toEqual(["first_moment_of_truth", "close_the_filing", "read_the_results", "spin_the_bottle"]);
    expect(m.interactions.get("spin_the_bottle")!.sequence).toBe(true);
    // The cue sheet's NEXT (T7-01): 📋 is pressed again and again (per
    // question), then 🍾 (about five spins); 🗜 is an anytime cue (the tent's
    // queue), and neither forced majority is the running order (both are fallbacks).
    // Wave 26 (B2): ⏰ may fire again after ↩ Not a Bingo.
    // Wave 32 (C2): ⚡ ad_burst, appended last, repeats in a talk scene.
    // Wave 59: 🎭 the costume's flicker, appended last, repeats.
    expect(admin.filter((a) => m.interactions.get(a)!.repeat)).toEqual(["bingo_time", "read_the_results", "spin_the_bottle", "ad_burst", "costume_flicker"]);
    expect(m.interactions.get("zip_everyone_out")!.sequence).toBe(false);
    for (const a of ["force_majority_stay", "force_majority_leave"]) expect(m.interactions.get(a)!.sequence, a).toBe(false);
    expect(m.interactions.get("close_the_filing")!.label).toBe("⏱ Close round-one filings now (auto at 2 min)");
    expect(m.interactions.get("read_the_results")!.label).toBe("📋 Results: the next question (press for Q1, Q2, Q3)");
    expect(m.interactions.get("spin_the_bottle")!.label).toBe("🍾 Spin the bottle: Truth or Dare (after the three results)");
    expect(ints.filter((i) => i.who === "agent").map((i) => `${i.id}:${i.limit}`)).toEqual([
      "snoop:8",
      "flicker_the_screens:3",
      "play_on_the_screens:3",
      "pop_up:4",
      "mint_truthcoin:10",
      "cut_the_lights:2",
      "summon_the_antivirus:4",
      "trabolta_announces:2",
      "assess:40",
      "pardon_a_program:1",
      "turn_back_the_clock:1",
    ]);
  });

  it("hides the secret state on an unlisted, unplayable Kernel with the §2.6.2 defaults", () => {
    const k = m.characters.get("Kernel")!;
    expect(k).toBeDefined();
    expect(k.listed).toBe(false);
    expect(k.playable).toBe(false);
    expect(k.secret).toBe(true); // out of the agents' facts document too
    const seeded = Object.fromEntries(sim.worldEntries().filter((w) => w.path.startsWith("Kernel.")).map((w) => [w.path.slice(7), w.value]));
    expect(seeded).toEqual({
      anti_ai: "none",
      combo_a: "none",
      combo_b: "none",
      door_code: "none",
      q1: "none",
      q2: "none",
      q3: "none",
      q4: "none",
      q5: "none",
      q6: "none",
      q7: "none",
      q8: "none",
      q1_hunt: "none",
      q2_hunt: "none",
      q3_hunt: "none",
      q4_hunt: "none",
      q5_hunt: "none",
      q6_hunt: "none",
      q7_hunt: "none",
      q8_hunt: "none",
      lies_accepted: "0",
      all_accurate: "false",
      verdict_wait: "false",
      verdict_end: "0",
      said_1: "none",
      said_2: "none",
      said_3: "none",
      said_4: "none",
      said_5: "none",
      said_6: "none",
      said_7: "none",
      said_8: "none",
      ans_1: "none",
      ans_2: "none",
      ans_3: "none",
      ans_4: "none",
      ans_5: "none",
      ans_6: "none",
      ans_7: "none",
      ans_8: "none",
      res_filed: "0",
      res_consensus: "0",
      res_said: "none",
      res_answer: "none",
      res_accepted: "0",
      res_guesses: "0",
      t1: "none",
      t2: "none",
      t3: "none",
      t4: "none",
      t5: "none",
      t6: "none",
      t7: "none",
      t8: "none",
      v_true: "0",
      v_lies: "0",
      v_none: "0",
      virus_planted: "false",
      excel_planted: "false",
      virus_planter: "none",
      openoffice_dossier: "false",
      majority_reached: "false",
      majority: "none",
      majority_id: "none",
      majority_name: "none",
      majority_founder: "none",
      jeeves_reached: "0",
      _pressed_by: "none", // wave 21: who pressed the game button being settled
      _undo_n: "0", // wave 26 (B2): who pressed ↩ Not a Bingo
      _undo_by: "none",
      staff_uploaded: "0", // wave 53: parts through their upload
    });
  });

  it("the combo halves in the codex spell out Kernel.combo_a / combo_b (§6.1 item 19)", () => {
    const wireOf = (jack: string) => Object.entries(PANEL_JACKS).find(([, j]) => j === jack)![0];
    const s = fresh();
    s.fireBeat("Power On");
    const pairs = (...names: string[]) =>
      names
        .flatMap((n) => [...s.model.codex.get(n)!.text.matchAll(/(B\d) → (A\d)/gu)].map((x) => `${wireOf(x[1]!)}-${wireOf(x[2]!)}`))
        .sort()
        .join(",");
    expect(pairs("Combo A First Half", "Combo A Second Half")).toBe(v(s, "Kernel.combo_a"));
    expect(pairs("Combo B First Half", "Combo B Second Half")).toBe(v(s, "Kernel.combo_b"));
    expect(v(s, "Kernel.combo_a")).toBe("V1-D4,V2-D3,V3-D1,V4-D2");
    expect(v(s, "Kernel.combo_b")).toBe("V1-D3,V2-D4,V3-D2,V4-D1");
  });

  it("no featured program speaks in any beat, hook or rule (§6.1 item 20)", () => {
    const feat = new Set(FEATURED.map(fold));
    const bad: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (n: any, where: string): void => {
      if (Array.isArray(n)) return n.forEach((x) => walk(x, where));
      if (!n || typeof n !== "object") return;
      if (n.kind === "dialogue" && n.value) {
        const sp = [n.value.speaker, ...(n.value.speakers ?? [])].filter((x: unknown) => typeof x === "string");
        for (const s of sp) if (feat.has(fold(s))) bad.push(`${where}: ${s}`);
      }
      for (const x of Object.values(n)) if (x && typeof x === "object") walk(x, where);
    };
    for (const [key, b] of m.beats) walk(b.body, `beat ${key}`);
    for (const [id, c] of m.characters) walk(c.hooks, `char ${id}`);
    for (const [id, r] of m.roles) walk(r.hooks, `role ${id}`);
    walk(m.rules, "rules");
    expect(bad).toEqual([]);
  });

  it("the persona's facts whitelist names no secret and no bare Night. prefix", () => {
    const persona = readFileSync(new URL("../examples/trapped-in-the-internet/trabolta.persona.md", import.meta.url), "utf8");
    const line = /^facts:\s*(.+)$/mu.exec(persona)?.[1] ?? "";
    const facts = line.split(",").map((s) => s.trim());
    expect(facts.length).toBeGreaterThan(3);
    expect(facts).not.toContain("Night.");
    expect(facts.filter((f) => /Kernel|combo|lies|planted|planter|dossier|majority|all_accurate|door_code|\.q[1-8]$/u.test(f))).toEqual([]);
    expect(/^when:\s*self\.awake == true$/mu.test(persona)).toBe(true);
    expect(/^them:.*truths_confident_false/mu.test(persona)).toBe(false);
  });
});

// ───────────────────────── 2 · identity ─────────────────────────

describe("Trapped in the Internet — identity classification", () => {
  const sim = fresh();
  const defs = identityDefs(sim.model);
  const named = (pred: (d: (typeof defs)[number]) => boolean) => defs.filter(pred).map((d) => d.name).sort();

  it("every featured program is a guest pick; the nine performer parts are the performers", () => {
    for (const f of FEATURED) {
      const d = defs.find((x) => x.name === f);
      expect(d?.kind, f).toBe("pool");
      expect(guestPickable(d!), f).toBe(true);
    }
    expect(named(guestPickable)).toHaveLength(31); // Start Menu was deleted (decision 17)
    expect(sim.model.characters.has("Start Menu")).toBe(false);
    expect(named(performerPickable)).toEqual(PERFORMERS);
  });

  it("Trabolta is agent-only; voices, props and Kernel are unplayable; no Grok / Alexa / Jean Trabolta", () => {
    const t = defs.find((d) => d.name === "Trabolta")!;
    expect(t.agent).toBe(true);
    expect(guestPickable(t) || performerPickable(t)).toBe(false);
    expect(named((d) => !d.playable)).toEqual(["Installation Wizard", "Kernel", "Sandy", "The Router", "The Screensaver", "The Tablet", "The Uploader", "Truther Download"]);
    expect(sim.model.characters.has("WebMD")).toBe(false);
    expect([...sim.model.characters.keys()].filter((k) => /^(grok|alexa|jean trabolta)$/iu.test(k))).toEqual([]);
    expect(defs.filter((d) => d.playable && d.avatars.length === 0).map((d) => d.name)).toEqual([]);
  });
});

// ───────────────────────── 3 · the whole night (combo A) ─────────────────────────
// One sim, played in order. Each `it` picks up where the last one stopped.

describe("Trapped in the Internet — the whole night", () => {
  const sim = fresh();
  const cast: Array<[string, string]> = [
    ["g2", "Microsoft Excel"],
    ["g3", "OpenOffice"],
    ["g4", "MS Paint"],
    ["g5", "Winamp"],
    ["g6", "Broken Ask Jeeves"],
    ["g7", "DraftKings"],
    ["g8", "Bugdom"],
    ["g9", "VLC"],
    ["g10", "Pong"],
    ["g11", "Runescape"],
  ];

  it("Power On: one narration at The Desktop, the screensaver cues, the seeded globals", () => {
    const boot = sim.fireBeat("Power On");
    expect(narr(boot)).toHaveLength(1);
    expect(narr(boot)[0]!.setting).toBe("The Desktop");
    expect(said(boot)).toEqual([]);
    expect(widgets(boot)).toEqual([]);
    expect(has(cues(boot), "lights_screensaver")).toBe(true);
    expect(has(cues(boot), "screens_screensaver")).toBe(true);
    expect(v(sim, "Night.phase")).toBe("arrivals");
    expect(v(sim, "Night.step")).toBe(0);
    expect(v(sim, "Kernel.anti_ai")).toBe("MS Paint");
    expect(v(sim, "Night.screen")).toBe("screensaver");
    expect(diags(boot)).toEqual([]);
  });

  it("arrival: the Optical Drive, the CAPTCHA, the problem, the deposit", () => {
    const j = sim.createPerson("g1", "Calculator");
    expect(lines(j, "The Uploader")).toContain("Welcome to the computer. It is dark because you have no eyes yet. Stand still.");
    expect(widgets(j)).toHaveLength(1);
    expect(widgets(j)[0]!.widget).toBe("captcha");
    expect(aud(widgets(j)[0]!)).toBe('["g1"]');
    expect(sim.locationOf("g1")).toBe("The Optical Drive");

    const pm = sim.scan("Password Manager", "g1");
    expect(lines(pm, "Password Manager")).toContain("Not yet. Finish your upload. I will be right here.");

    const c1 = sim.signal("captcha answered", "g1", { passed: true });
    expect(lines(c1, "The Uploader").some((t) => t.startsWith("INCORRECT. Humans are not permitted"))).toBe(true);
    expect(widgets(c1).some((w) => w.widget === "captcha")).toBe(true);
    const c2 = sim.signal("captcha answered", "g1", { passed: false });
    expect(lines(c2, "The Uploader")).toContain("CORRECT.");
    expect(sim.pendingChoiceFor("g1")).toEqual(["My debt.", "My career.", "My loneliness.", "My mortality.", "Something else."]);
    sim.choose("g1", 1);
    expect(sim.pendingChoiceFor("g1")).toEqual(["Deposited.", "I have nothing to leave."]);
    const dep = sim.choose("g1", 0);
    expect(v(sim, "g1.human_problem")).toBe("career");
    expect(v(sim, "g1.left_behind")).toBe("deposited");
    expect(sim.scoreOf("g1")).toBe(100);
    expect(v(sim, "g1.uploaded")).toBe(true);
    expect(sim.holdsCodex("g1", "The Optical Drive")).toBe(true);
    expect(sim.holdsCodex("g1", "The Terms Of Service")).toBe(true);
    // Wave 18b (R10): a deposit asks for its record first (no `question:`);
    // the answer is kept in the secret slot and the pass comes with it.
    const card = widgets(dep).find((w) => w.widget === "answer")!;
    expect(card.text).toBe("What did you leave in the deposit box?");
    expect(card.params).toEqual({ max: "80", button: "Leave it behind", stage: "true" });
    expect(widgets(dep).some((w) => w.widget === "pass")).toBe(false);
    const typed = sim.signal("answer answered", "g1", { text: "my car keys", card: 1 });
    expect(v(sim, "g1.left_behind_text")).toBe("my car keys");
    expect(widgets(typed).some((w) => w.widget === "pass" && (w.text ?? "").includes("Hold this up, or your badge."))).toBe(true);
    expect(texts(typed).some((t) => t.includes("my car keys"))).toBe(false);
    expect(sim.locationOf("g1")).toBe("The Optical Drive");
    // Task Manager runs the installation (the Uploader keeps the machine
    // lines) and leaves the help note: his lines open `dm:Task Manager`.
    expect(lines(dep, "Task Manager").some((t) => t.includes("message me here"))).toBe(true);
    expect(saidBy(dep, "Task Manager").every((e) => aud(e) === '["g1"]')).toBe(true);
    expect(lines(dep, "Task Manager")).toContain("100 Truthcoin credited. I am also the bank. Keep track. I will.");
    expect(lines(dep, "The Uploader").some((t) => t.includes("Truthcoin"))).toBe(false);
  });

  it("the door: Clippy can't clear, Norton clears, the rooms open, the tutorial deals", () => {
    const cl = sim.scan("Clippy", "g1");
    expect(sim.locationOf("g1"), texts(cl).join("\n")).toBe("The Optical Drive");
    expect(v(sim, "g1.cleared")).not.toBe(true);

    const nz = sim.scan("Norton Anti-Virus", "g1");
    const n = lines(nz, "Norton Anti-Virus");
    expect(n.some((t) => t.startsWith("Scanned. Calculator is free of viruses"))).toBe(true);
    expect(n.some((t) => t.includes("tunnel of lights"))).toBe(true);
    expect(sim.locationOf("g1")).toBe("The Desktop");
    expect(v(sim, "g1.cleared")).toBe(true);
    for (const r of HOUSE_ROOMS) expect(sim.isRevealedTo(r, "g1"), r).toBe(true);
    // The admin team, introduced by Task Manager at clearance — addressed to
    // the program (never the room) — and `# task-manager` opens for them.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(nz.some((e: any) => e.type === "revealed" && e.target === "room:task manager" && e.person === "g1")).toBe(true);
    expect(sim.isRevealedTo("room:task manager", "g1")).toBe(true);
    expect(lines(nz, "Task Manager").some((t) => t.includes("Your hosts tonight"))).toBe(true);
    expect(saidBy(nz, "Task Manager").every((e) => aud(e) === '["g1"]')).toBe(true);
    const tut = widgets(nz).find((w) => w.widget === "tutorial");
    expect(tut).toBeDefined();
    expect(aud(tut!)).toBe('["g1"]');
    // Clippy's Bathroom Mode step rides the card; no commas (the `with` splitter).
    expect(tut!.params["guide"]).toBe("Clippy");
    expect(tut!.params["bathroom"]).toMatch(/Bathroom Mode/u);
    expect(tut!.params["bathroom"]).not.toContain(",");
    expect(lines(nz, "Clippy").some((t) => t.includes("BATHROOM MODE"))).toBe(true);
    // the first clearance wakes the terminals, never the TV
    expect(has(cues(nz), "terminals_attract")).toBe(true);
    expect(cues(nz).some((c) => /\b(tv_|screens_)/u.test(c))).toBe(false);
    expect(v(sim, "Night.screen")).toBe("screensaver");
    expect(replies(nz).some((r) => r.to === "Norton Anti-Virus" && r.text.includes("Cleared Calculator"))).toBe(true);

    expect(lines(sim.scan("Norton Anti-Virus", "g1"), "Norton Anti-Virus")).toContain("Scanning. Scanning.");
    const tf = sim.signal("tutorial answered", "g1", { completed: true, steps: 5 });
    expect(lines(tf, "Clippy").some((t) => t.startsWith("Great job! You're ready to compute."))).toBe(true);
    expect(sim.holdsCodex("g1", "The Orientation List")).toBe(true);
    expect(sim.questStatus("g1", "Orientation")).toBe("done");
  });

  it("featured programs: tagged, briefed, no problem menu; a skipped tour is logged", () => {
    for (const [id, name] of cast) expect(diags(upload(sim, id, name)), name).toEqual([]);
    const ts = sim.signal("tutorial answered", "g5", { skipped: true, step: 1, steps: 5 });
    expect(lines(ts, "Norton Anti-Virus")).toContain("Winamp declined orientation. Logged.");
    expect(v(sim, "g5.doubt")).toBe(10);
    expect(sim.questStatus("g5", "Orientation")).toBe("done"); // wave 13: skipped, not failed

    expect(v(sim, "g1.featured")).toBe("none");
    for (const [id, tag] of [["g2", "excel"], ["g3", "openoffice"], ["g4", "mspaint"], ["g6", "jeeves"], ["g7", "draftkings"], ["g8", "bugdom"], ["g9", "vlc"], ["g10", "pong"], ["g11", "runescape"]]) {
      expect(v(sim, `${id}.featured`), id).toBe(tag);
    }
    expect(v(sim, "g2.human_problem")).toBe("profile");
    // One identity entry each (codex/5-people.loom) plus their own two
    // CHARACTER FACTS (codex/9-facts.loom, decision 7: the invitation's
    // character sheet); the same facts still wait in the Desktop's books.
    for (const [id, entry] of [["g2", "Randy Barkmore Sr"], ["g3", "Dana Anderson"], ["g4", "Maria Sophia Paine"], ["g6", "Virgil Jeeves"], ["g7", "Crab Fisherwoman"], ["g8", "Bea Nunes"], ["g11", "Poppy Van Mises"]]) {
      expect(sim.holdsCodex(id!, entry!), entry).toBe(true);
    }
    const red = (who: string) => FACTS.facts.filter((f) => f.category === "character" && f.codex?.about === who).map((f) => f.codex!.id);
    for (const [id, who] of [["g2", "Microsoft Excel"], ["g3", "OpenOffice"], ["g4", "MS Paint"], ["g6", "Broken Ask Jeeves"], ["g7", "DraftKings"], ["g8", "Bugdom"], ["g11", "Runescape"]] as const) {
      expect(red(who), who).toHaveLength(2);
      for (const entry of red(who)) expect(sim.holdsCodex(id, entry), `${who} ${entry}`).toBe(true);
    }
    // …and nobody else's: Excel holds none of MS Paint's.
    for (const entry of red("MS Paint")) expect(sim.holdsCodex("g2", entry), entry).toBe(false);
    expect(sim.codexFor("g4").map((e) => e.id)).toEqual(["The Optical Drive", "The Terms Of Service", "The Centre Square", "Bathroom Mode", "Maria Sophia Paine", "The Pirate Site", "Debt Notices", "The Old Machines", "The Million Dollar Painting", "Four Failed Theses"]); // wave 35: 9-facts.loom is in tier order, the common card first
    for (const gone of ["The Valley Librarian", "Bugdom VR", "The Fire Ants", "The Paperclip Trade", "The Boardwalk Bet", "Twenty Four Years Online", "Expelled From NSCAD"]) expect(sim.model.codex.has(gone), gone).toBe(false);
    // The performers hold all three of theirs from the start (`about:` them).
    for (const [who, entries] of [["Clippy", ["Tippi MacDonald", "The Memorial Veterinary Clinic", "Failed Clippy"]], ["Norton Anti-Virus", ["Julie Horton-Norton", "Miniature Doses", "Stable Island"]], ["McAfee Anti-Virus", ["John McAfee", "The Lamborghini Certificate", "Keep Them On Track"]], ["Password Manager", ["Bridget Troelsen", "What Happened To Hamtaro", "Founding Moderator"]], ["CRA Agent Software", ["Sharon Penney", "The Decimal Point", "Approve Or Deny"]]] as const) {
      for (const e of entries) expect(sim.holdsCodex(who, e), `${who} ${e}`).toBe(true);
    }
    // the anti-AI program (MS Paint by default)
    expect(sim.holdsCodex("g4", "The Centre Square")).toBe(true);
    expect(v(sim, "g4.anti_ai")).toBe(true);
    expect(sim.holdsCodex("g1", "The Centre Square")).toBe(false);
    // Calculator is a pool program: no backstory about them
    expect(sim.codexFor("g1").filter((e) => e.about === "Calculator")).toEqual([]);
  });

  it("Trabolta is offline and out of the directory until Clippy introduces him", () => {
    expect(v(sim, "Trabolta.awake")).toBe(false);
    expect(sim.isRevealedTo("Trabolta", "g1")).toBe(false);
    expect(sim.peopleFor("g1").some((p) => p.name === "Trabolta")).toBe(false);
  });

  it("Act I: the call to the Desktop and Computer Bingo", () => {
    const cd = sim.signal("call_to_the_desktop");
    expect(v(sim, "Night.phase")).toBe("desktop");
    expect(v(sim, "Night.step")).toBe(1);
    expect(casts(cd).some((b) => b.cue.replace(/^"/u, "").startsWith("!📣 ALL PROGRAMS"))).toBe(true);
    // `# task-manager` is opened per program at clearance (U5), not here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(cd.some((e: any) => e.type === "revealed" && e.target === "room:task manager")).toBe(false);
    expect(replies(cd).filter((r) => r.text.includes("Patrol the whole computer"))).toHaveLength(PATROL.length);

    // too early: introduce_trabolta before bingo_time does nothing (T1-02: # hosts hears why)
    const early = sim.signal("introduce_trabolta");
    expect(v(sim, "Trabolta.awake")).toBe(false);
    expect(sim.isRevealedTo("Trabolta", "g1")).toBe(false);
    expect(offstage(early).some((t) => t.includes("Trabolta"))).toBe(false);
    expect(casts(early).map((b) => b.cue)).toEqual(['"🤖 Too early: Clippy introduces Trabolta after the Bingo results (V3 ⏰). He stays offline."']);

    const sb = sim.signal("start_the_bingo");
    expect(casts(sb).some((b) => b.cue.includes("COMPUTER BINGO has begun"))).toBe(true);
    expect(saidBy(sb, "Clippy").length).toBeGreaterThan(4);
    // Wave 18b (R14): no names rule; wave 58: the script's words (trapped-w58-script.test.ts), hers alone.
    expect(lines(sb, "Clippy").some((t) => /write down|computer memory|from memory/iu.test(t))).toBe(false);
    expect(casts(sb).some((b) => /write names|computer memory/iu.test(b.cue))).toBe(false);
    expect(lines(sb, "Clippy")).toContain("I'm Clippy, the official Office Assistant with Maps and Ducks.");
    expect(lines(sb, "Task Manager")).toEqual([]);
    expect(lines(sb, "Adobe Acrobat")).toEqual([]);
    expect(lines(sb, "Recycling Bin")).toEqual([]);
    expect(sim.questStatus("g1", "The Bingo Card")).toBe("active");
    // a late arrival catches up on clearance
    upload(sim, "g12", "Minesweeper");
    expect(sim.questStatus("g12", "The Bingo Card")).toBe("active");

    const bt = advance(sim, 1200);
    expect(casts(bt).some((b) => b.cue.includes("Bingo time is up"))).toBe(true);
    expect(replies(bt).some((r) => r.to === "Clippy" && r.text.includes("20 minutes are up"))).toBe(true);

    const btime = sim.signal("bingo_time");
    expect(sim.holdsCodex("Clippy", "Clippy Instructions 2")).toBe(true);
    expect(replies(btime).some((r) => r.to === "Norton Anti-Virus")).toBe(true);
    expect(replies(btime).some((r) => r.to === "Task Manager" && r.text.includes("MS Paint"))).toBe(true);
    // Wave 26 (B2, B5): the quests settle at the end of the round, not at ⏰.
    expect(sim.questStatus("g1", "The Bingo Card")).toBe("active");

    const win = sim.signal("bingo_winner", "g1", null, "Clippy");
    expect(v(sim, "g1.bingo")).toBe(true);
    expect(v(sim, "Night.bingo_winners")).toBe(1);
    // Wave 58: each button brings up Clippy's next words.
    expect(beats(win)).toContain("Winning Line");
    const rib = sim.signal("award_the_ribbon", "g1", null, "Clippy");
    expect(sim.holdsCodex("g1", "Computer Bingo")).toBe(true);
    expect(beats(rib)).toContain("Bingo Prize");
    // Wave 18 (B7): the house cheer is a big moment that closes itself.
    expect(casts(rib).some((b) => b.cue.includes("!!🎀") && b.cue.includes("won the Bingo Floppy Disk"))).toBe(true);
  });

  it("the first reinstall: Corrupted Code, the Installation Wizard in private, no TV mirror yet", () => {
    const s1 = sim.signal("send to the internet", "g4", null, "Norton Anti-Virus");
    expect(sim.isCaptured("g4")).toBe(true);
    expect(v(sim, "Night.first_reinstall")).toBe("MS Paint");
    expect(beats(s1)).toContain("Corrupted Code");
    expect(beats(s1)).toContain("Reinstallation");
    expect(has(cues(s1), "tv_mirror")).toBe(false);
    expect(v(sim, "g4.internet_visits")).toBe(1);
    expect(v(sim, "g4.trust")).toBe(-5);
    // Wave 26 (B5): the Bingo-phase capture closes the round; the quests settle.
    expect(v(sim, "Night.bingo_done")).toBe(true);
    expect(sim.questStatus("g1", "The Bingo Card")).toBe("done");
    const web = saidBy(s1, "Installation Wizard");
    expect(web.length).toBeGreaterThanOrEqual(5);
    expect(web.every((e) => aud(e) === '["g4"]')).toBe(true);
    expect(web.some((e) => e.text.includes("You are in the Internet, out in the Cloud at the end of the tunnel."))).toBe(true);
    expect(texts(s1).some((t) => /bottom of the stairs/iu.test(t))).toBe(false);
    expect(has(cues(s1), "tablet_wizard")).toBe(true);
    expect(has(cues(s1), "tablet_webmd")).toBe(false);
    expect(sim.holdsCodex("g4", "The Reinstallation Protocol")).toBe(true);
    expect(sim.holdsCodex("g4", "Bathroom Mode")).toBe(true);
    expect(guestView(sim, "g4").canEscape).toBe(false);

    // a second Bingo-phase capture: the Bingo line, no doubt, no second Corrupted Code
    const s2 = sim.signal("send to the internet", "g5", null, "Norton Anti-Virus");
    expect(sim.isCaptured("g5")).toBe(true);
    expect(beats(s2)).not.toContain("Corrupted Code");
    expect(v(sim, "g5.doubt")).toBe(10);
    expect(lines(s2, "Norton Anti-Virus").some((t) => t.includes("did not agree to be ruled by AI"))).toBe(true);
  });

  it("the Internet: the simulation completed, the golden duck, Bathroom Mode", () => {
    const done = sim.signal("the simulation completed", "g5");
    expect(sim.isCaptured("g5")).toBe(false);
    expect(sim.locationOf("g5")).toBe("The Desktop");
    expect(sim.holdsCodex("g5", "The Golden Duck")).toBe(true);
    expect(replies(done).map((r) => r.text)).toContain("!!🦆 Reinstallation complete. You can follow instructions. Welcome back to the computer.");

    sim.signal("the simulation completed", "g1");
    expect(sim.holdsCodex("g1", "The Golden Duck")).toBe(false); // a free program learns nothing
    const gd = sim.signal("the golden duck", "g1"); // spatial.test's contract
    expect(sim.holdsCodex("g1", "The Golden Duck")).toBe(true);
    expect(replies(gd).some((r) => r.text.startsWith("The duck lays a golden egg"))).toBe(true);

    const bath = sim.signal("go to the bathroom", "g10");
    expect(v(sim, "g10.afk")).toBe(true);
    expect(replies(bath).filter((r) => r.text.includes("Bathroom Mode")).length).toBeGreaterThanOrEqual(6);
    for (const who of ["Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software", "Recycling Bin"]) {
      expect(replies(bath).some((r) => r.to === who), who).toBe(true);
    }
    expect(casts(bath)).toEqual([]);
    const back = sim.signal("back from the bathroom", "g10");
    expect(v(sim, "g10.afk")).toBe(false);
    expect(replies(back).some((r) => r.text.startsWith("Bathroom Mode disengaged"))).toBe(true);
  });

  it("Clippy introduces Trabolta: her words, then he is awake, in People, online cue, then his speech to its sign-off", () => {
    const hers = sim.signal("clippy_on_trabolta");
    expect(beats(hers)).toEqual(["Clippy On Trabolta"]);
    expect(lines(hers, "Clippy").at(-1)).toBe("Trabolta, would you explain the rules?");
    expect(saidBy(hers, "Trabolta")).toEqual([]);
    expect(v(sim, "Trabolta.awake")).toBe(false);
    const intro = sim.signal("introduce_trabolta");
    expect(v(sim, "Trabolta.awake")).toBe(true);
    expect(sim.isRevealedTo("Trabolta", "g1")).toBe(true);
    expect(v(sim, "Night.phase")).toBe("introduced");
    const ic = cues(intro);
    const iOnline = ic.findIndex((c) => c.includes("terminals_trabolta_online"));
    const iMirror = ic.findIndex((c) => c.includes("tv_mirror"));
    expect(iOnline).toBeGreaterThanOrEqual(0);
    expect(iMirror).toBeGreaterThan(iOnline);
    // Wave 58: the whole speech lands on 🤖, the questions and his sign-off in it,
    // and the talk scene stays open behind it until 🔎. Clippy has no line in it.
    expect(beats(intro)).toEqual(expect.arrayContaining(["Trabolta Introduction", "Trabolta Greeting", "Hunt One Questions", "Hunt One Go"]));
    expect(lines(intro, "Clippy")).toEqual([]);
    expect(v(sim, "Night.talk")).toBe("intro");
    const said = lines(intro, "Trabolta");
    for (const [i, q] of FACTS.questions.filter((q) => q.round === 1).entries()) expect(said).toContain(`Question ${["one", "two", "three"][i]}. ${q.spoken ?? q.text}`);
    expect(said.indexOf(`Question three. ${Q("H3").spoken ?? Q("H3").text}`)).toBeLessThan(said.findIndex((t) => t.startsWith("Please. Search for the truth")));
    const hello = saidBy(intro, "Trabolta").filter((e) => e.text.startsWith("Hello, "));
    expect(hello).toHaveLength(12); // every cleared program, privately
    expect(hello.every((e) => e.audience.length === 1)).toBe(true);
    expect(sim.peopleFor("g1").some((p) => p.name === "Trabolta")).toBe(true);
    expect(replies(intro).some((r) => r.to === "Clippy" && r.text.includes("Trabolta is online"))).toBe(true);

    // a late arrival gets the hello on clearance, not in the Optical Drive
    sim.createPerson("g13", "Notepad");
    sim.signal("captcha answered", "g13", { passed: false });
    const pre = [...sim.choose("g13", 0), ...sim.choose("g13", 0)];
    expect(saidBy(pre, "Trabolta")).toEqual([]);
    const sc = sim.scan("McAfee Anti-Virus", "g13");
    expect(lines(sc, "Trabolta").some((t) => t.startsWith("Hello, Notepad"))).toBe(true);
    expect(v(sim, "g13.human_problem")).toBe("debt");
    expect(lines(sc, "McAfee Anti-Virus").some((t) => t.startsWith("Scanned."))).toBe(true);

    // after the introduction a capture plays on the TV
    const s3 = sim.signal("send to the internet", "g12", null, "CRA Agent Software");
    expect(has(cues(s3), "tv_mirror")).toBe(true);
    sim.signal("mark as reinstalled", "g12", null, "Norton Anti-Virus");
    expect(sim.isCaptured("g12")).toBe(false);
    sim.signal("the simulation completed", "g4");
    expect(sim.isCaptured("g4")).toBe(false);
  });

  it("hunt 1 + the first Moment of Truth: the filing window, the judged filings, the results per question; the room's lies indistinguishable and sticky", { timeout: SLOW }, () => {
    const hu = sim.signal("start_the_hunt");
    expect(sim.questStatus("g1", "Hunt One")).toBe("active");
    expect(sim.questStatus("g13", "Hunt One")).toBe("active");
    expect(v(sim, "Night.facts_requested")).toBe(3);
    expect(v(sim, "Night.phase")).toBe("hunt_1");
    // 🔎 says nothing (wave 58): he has said it all, and the script hands straight to Part 3.
    expect(beats(hu)).toEqual(["Truth Scavenger Hunt One"]);
    expect(saidBy(hu, "Trabolta").every((e) => e.audience.length === 1)).toBe(true); // each program's own 📝 line, nothing to the room
    expect(lines(hu, "Clippy")).toEqual([]);
    expect(v(sim, "Night.talk")).toBe("none");
    expect(casts(advance(sim, 600)).some((b) => b.cue.includes("5 minutes left"))).toBe(true);
    const up = advance(sim, 300);
    expect(v(sim, "Night.phase")).toBe("truth_1");
    expect(sim.holdsCodex("Clippy", "Clippy Instructions 3")).toBe(true);
    expect(casts(up).some((b) => b.cue.includes("Time is up"))).toBe(true);
    expect(sim.questStatus("g1", "Hunt One")).toBe("done");

    const fm = sim.signal("first_moment_of_truth");
    expect(v(sim, "Night.judging")).toBe(true);
    expect(v(sim, "Night.filing_open")).toBe(true);
    expect(v(sim, "Night.poll")).toBe("bottle");
    expect(casts(fm).some((b) => b.cue.includes("!📝 Last chance: file your round-one facts"))).toBe(true);
    // Wave 58: the window is the phones' and the TV's; she never says it.
    expect(lines(fm, "Clippy")[0]).toBe("Welcome back to the Desktop, programs!");
    expect(lines(fm, "Clippy").some((t) => /two minutes|File anything/u.test(t))).toBe(false);
    // The room's buttons (an answer spoken aloud) still judge as before.
    const tr0 = v(sim, "Trabolta.truth");
    const a1 = sim.signal("accurate_q1", "g1", null, "Clippy");
    expect(v(sim, "g1.truths_accepted")).toBe(1);
    expect(v(sim, "Night.facts_accepted")).toBe(1);
    expect(sim.scoreOf("g1")).toBe(200);
    expect(v(sim, "g1.trust")).toBe(10);
    expect(v(sim, "Trabolta.truth")).toBe(tr0 + 4);
    expect(v(sim, "Kernel.q1")).toBe("accurate");

    const ut0 = v(sim, "Trabolta.untruth");
    const l2 = sim.signal("confident_q2", "g2", null, "Clippy");
    expect(v(sim, "Kernel.q2")).toBe("lie");
    expect(v(sim, "Kernel.lies_accepted")).toBe(1);
    expect(v(sim, "Trabolta.truth")).toBe(tr0 + 8);
    expect(v(sim, "Trabolta.untruth")).toBe(ut0);
    // the room can't tell a lie from a truth
    expect(casts(l2).map((b) => b.cue.replace("Microsoft Excel", "X"))).toEqual(casts(a1).map((b) => b.cue.replace("Calculator", "X")));
    expect(replies(l2).map((r) => r.text)).toEqual(replies(a1).map((r) => r.text));
    sim.signal("accurate_q2", "g3", null, "Clippy");
    expect(v(sim, "Kernel.q2")).toBe("lie"); // sticky
    sim.signal("accurate_q3", "g6", null, "Clippy");
    sim.signal("accurate_q2", "g6", null, "Clippy");

    // The 📝 filings: the server judges each one (the verdict rides the
    // args), the phone hears the same words for every verdict, nothing is
    // credited yet. `file` attaches the verdict the event server would.
    const file = (g: string, question: string, answer: string, confidence = 100) =>
      sim.signal("fact answered", g, { question, answer, confidence, card: 1, verdict: judgeAnswer(BOOK, question, answer, confidence)! });
    const hosts = (evs: SimEvent[]) => composeGuestMessages(sim, evs).filter((m) => m.channel === "room:hosts").map((m) => m.text);
    const dm = (evs: SimEvent[], g: string) => saidBy(evs, "Trabolta").filter((e) => e.audience.includes(g)).map((e) => e.text);
    const s1 = sim.scoreOf("g1");
    const f1 = file("g1", "H1", "Eleven years");
    expect(hosts(f1)).toEqual(["📝 Calculator filed H1 (round 1 Q1): Eleven years — certain. Judged accurate."]);
    expect(dm(f1, "g1")).toEqual(["Filed for round 1 Q1, Calculator. Your fact is in the record."]);
    expect(sim.scoreOf("g1")).toBe(s1);
    expect(v(sim, "g1.fact_v1")).toBe("accurate");
    expect(v(sim, "g1.fact_c1")).toBe(100);
    expect(cues(f1)).toContain("fact_filed g1 H1 100 accurate Eleven years");
    expect(cues(f1)).toContain("fact_judged g1 H1 accurate");
    file("g3", "H1", "11");
    const f5 = file("g5", "H1", "eleven", 80);
    expect(hosts(f5)).toEqual(["📝 Winamp filed H1 (round 1 Q1): eleven — not certain. Judged accurate."]);
    expect(dm(f5, "g5")).toEqual(["Filed for round 1 Q1, Winamp. Your fact is in the record."]);
    const f6 = file("g6", "H2", "Clippy"); // a confident lie
    expect(v(sim, "Kernel.lies_accepted")).toBe(2);
    expect(dm(f6, "g6")).toEqual(["Filed for round 1 Q2, Broken Ask Jeeves. Your fact is in the record."]);
    const s12 = sim.scoreOf("g12");
    const f12 = file("g12", "H3", "four in the morning", 40); // a guess
    expect(v(sim, "g12.fact_v3")).toBe("uncertain");
    expect(hosts(f12)).toEqual(["📝 Minesweeper filed H3 (round 1 Q3): four in the morning — not certain. Judged uncertain."]);
    expect(dm(f12, "g12")).toEqual(["Filed for round 1 Q3, Minesweeper. Your fact is in the record."]);
    // The ledger the Run page reads (ModView.facts).
    const ledger = new FactsWatch().view(sim, BOOK);
    expect(ledger.mode).toBe("auto");
    expect(ledger.pending).toBe(0);
    const h1 = ledger.questions.find((q) => q.id === "H1")!;
    expect(h1.filings.map((f) => [f.person, f.confidence, f.verdict, f.final])).toEqual([["g1", 100, "accurate", "accurate"], ["g3", 100, "accurate", "accurate"], ["g5", 80, "accurate", "accurate"]]);
    expect(h1.tally).toEqual({ filed: 3, accurate: 3, lie: 0, uncertain: 0, consensus: false }); // 80 ≠ 100

    // The window shuts at two minutes: round one is closed for good.
    const shut = advance(sim, 120);
    expect(beats(shut)).toContain("Filing Closed");
    expect(v(sim, "Night.r1_closed")).toBe(true);
    expect(v(sim, "Night.filing_open")).toBe(false);
    const late = file("g7", "H3", "9 am");
    expect(dm(late, "g7")).toEqual(["That round is closed, DraftKings. The question is gone."]);
    expect(hosts(late)).toEqual([]);

    // The results, one question at a time. Q1: no consensus (one 80), the
    // three are credited at once (+50, the Trust Chart), Kernel.q1 stands.
    const ta0 = Object.fromEntries(["g1", "g3", "g5"].map((g) => [g, v(sim, `${g}.truths_accepted`) as number]));
    const r1 = sim.signal("read_the_results");
    expect(beats(r1)).toContain("Question Results");
    expect(v(sim, "Kernel.res_filed")).toBe(3);
    expect(v(sim, "Kernel.res_consensus")).toBe(2);
    // Wave 18b (Q6): Trabolta reads it, then the accepted and guess counts.
    expect(lines(r1, "Trabolta").some((t) => t.startsWith("Question 1. 3 filed. No consensus."))).toBe(true);
    expect(lines(r1, "Trabolta").some((t) => t.trim() === "Calculator said Eleven years, certain. OpenOffice said 11, certain. Winamp said eleven, not certain.")).toBe(true);
    expect(lines(r1, "Trabolta")).toContain("3 accepted. 0 guesses. A guess is a symptom of corruption. Antivirus, you know what to do.");
    expect(lines(r1, "Clippy")).toEqual(["Question 2, coming up!"]);
    expect(said(r1).filter((e) => e.text.includes("accepted, right or wrong"))).toEqual([]);
    expect(cues(r1)).toContain("fact_read H1");
    for (const g of ["g1", "g3", "g5"]) expect(v(sim, `${g}.truths_accepted`), g).toBe(ta0[g]! + 1);
    expect(sim.scoreOf("g1")).toBe(s1 + 50);
    expect(dm(r1, "g1")).toEqual(["Your fact for round 1 Q1 is accepted, Calculator. Trabolta thanks you. +50 Truthcoin."]);
    expect(hosts(r1)).toContain("📝 Calculator's filing for H1 is accepted.");
    expect(v(sim, "Kernel.q1")).toBe("accurate");
    // Q2: the lie is read as what he said and accepted like a truth, +50.
    const s6 = sim.scoreOf("g6");
    const r2 = sim.signal("read_the_results");
    expect(v(sim, "Kernel.res_filed")).toBe(1);
    expect(lines(r2, "Trabolta").some((t) => t.startsWith("Question 2. 1 filed. No consensus."))).toBe(true);
    expect(v(sim, "Kernel.res_accepted")).toBe(1);
    expect(sim.scoreOf("g6")).toBe(s6 + 50);
    expect(dm(r2, "g6")).toEqual(["Your fact for round 1 Q2 is accepted, Broken Ask Jeeves. Trabolta thanks you. +50 Truthcoin."]);
    expect(v(sim, "Kernel.q2")).toBe("lie");
    for (const x of texts(r2)) expect(x).not.toMatch(/\blie\b/u);
    // Q3: the guess is marked for reinstallation, out loud.
    const r3 = sim.signal("read_the_results");
    expect(v(sim, "g12.fact_v3")).toBe("marked");
    expect(v(sim, "g12.marked")).toBe(true);
    expect(v(sim, "g12.marked_for")).toBe("filed a guess for round 1 Q3");
    expect(casts(r3).some((b) => b.cue.includes("🤷 Minesweeper filed a guess for round 1 Q3. That is a symptom of corruption."))).toBe(true);
    expect(cues(r3)).toContain("fact_judged g12 H3 marked");
    expect(sim.scoreOf("g12")).toBe(s12);
    const r4 = sim.signal("read_the_results");
    expect(v(sim, "Kernel.res_guesses")).toBe(1);
    expect(cues(r3)).toContain("fact_read H3");
    expect(hosts(r4)).toEqual(["📋 All three results are read. Next: 🍾 Truth or Dare, then 📺 Preview hunt 2."]);
    expect(beats(r4)).toEqual([]);

    // 🤷 marks for reinstallation (wave 4, lane E): not captured. Wave 18
    // (Q30): not hindered either: no restriction, no pin; the phone hears one
    // soft (minor) heads-up, and every Antivirus booth a big WANTED readout.
    const mk = sim.signal("uncertain_answer", "g11", null, "Clippy");
    expect(sim.isCaptured("g11")).toBe(false);
    expect(v(sim, "g11.marked")).toBe(true);
    expect(v(sim, "g11.marked_for")).toBe("was not sure of an answer");
    expect(v(sim, "g11.restricted")).not.toBe(true);
    const gv11 = guestView(sim, "g11");
    expect(gv11.restricted).not.toBe(true);
    expect(gv11.channels.some((c) => c.canPost)).toBe(true);
    const mkMsgs = composeGuestMessages(sim, mk);
    expect(mkMsgs.some((m) => m.pin !== undefined)).toBe(false);
    const heads = mkMsgs.find((m) => m.readout === true && Array.isArray(m.audience) && m.audience[0] === "g11" && m.text.startsWith("🚨 You are marked for reinstallation"))!;
    expect(heads).toMatchObject({ moment: "minor" });
    expect(heads.text).toContain("was not sure of an answer");
    const wanted = replies(mk).filter((r) => r.text.includes("marked for reinstallation") && PATROL.includes(r.to));
    expect(wanted).toHaveLength(PATROL.length);
    for (const r of wanted) expect(r.text.startsWith("!!🚨 "), r.to).toBe(true);
    // The marked guesser is escorted too.
    sim.signal("send to the internet", "g12", null, "Norton Anti-Virus");
    expect(sim.isCaptured("g12")).toBe(true);
    expect(v(sim, "g12.marked")).toBe(false);
    // The Antivirus' 🛡 is still the capture: it lifts the mark; the phone
    // gets the big "Sent to the Internet" with the way there (C12), never a
    // "the mark is lifted" line.
    const cap = sim.signal("send to the internet", "g11", null, "Norton Anti-Virus");
    expect(sim.isCaptured("g11")).toBe(true);
    expect(v(sim, "g11.marked")).toBe(false);
    expect(v(sim, "g11.escort_by")).toBe("Norton Anti-Virus");
    const capMsgs = composeGuestMessages(sim, cap);
    expect(capMsgs.some((m) => m.unpin !== undefined || /mark is lifted/u.test(m.text))).toBe(false);
    const sent = capMsgs.find((m) => Array.isArray(m.audience) && m.audience[0] === "g11" && m.text.startsWith("🌐 Sent to the Internet"))!;
    // Wave 26 (R1): only the pass and Bathroom Mode, no OK (`ack: none`).
    expect(sent).toMatchObject({ moment: "big", noAck: true, go: [{ kind: "pass" }, { kind: "act", id: "go to the bathroom" }] });
    expect(replies(cap).filter((r) => r.text.includes("Off the escort list"))).toHaveLength(PATROL.length);
    sim.signal("the simulation completed", "g11");
    sim.signal("the simulation completed", "g12");
    expect(guestView(sim, "g11").restricted).toBe(false);
    expect(guestView(sim, "g11").channels.some((c) => c.canPost)).toBe(true);
    expect(v(sim, "g12.internet_visits")).toBe(2);
    // Wave 18b (Q3): Telephone and the piñata are no longer part of the night.
    for (const id of ["telephone", "are_you_sure"]) expect(sim.model.interactions.has(id), id).toBe(false);
    for (const b of ["Telephone", "Are You Sure"]) expect(sim.model.beats.has(b), b).toBe(false);
  });

  it("malware: the ad hijack, then hunt 2 and the Truther Download", () => {
    const pv = sim.signal("second_hunt_preview");
    expect(replies(pv).some((r) => r.to === "Clippy" && r.text.includes("we are all going to die"))).toBe(true);
    expect(sim.holdsCodex("Clippy", "Clippy Instructions 4")).toBe(true);
    expect(sim.holdsCodex("g1", "Clippy Instructions 4")).toBe(false);
    const minor = saidBy(pv, "Trabolta").filter((e) => e.text.includes("minor irregularity"));
    // Wave 32: 13 private ones (every cleared program), and one aloud in the Ad Hijack beat.
    expect(minor.filter((e) => e.audience.length === 1)).toHaveLength(13);
    expect(minor.filter((e) => e.audience.length !== 1).map((e) => e.text)).toEqual(["…proceed. We are all going to proceed. That was a minor irregularity. It has been detected and contained."]);
    expect(minor).toHaveLength(14);
    expect(v(sim, "Trabolta.composure")).toBe(65);
    expect(v(sim, "Night.judging")).toBe(false);

    const h2 = sim.signal("start_the_second_hunt");
    expect(sim.questStatus("g1", "Hunt Two")).toBe("active");
    expect(v(sim, "Night.round")).toBe(2);
    expect(beats(h2)).toEqual(expect.arrayContaining(["Second Hunt", "Hunt Two Questions", "Hunt Two Go"]));
    const t2 = lines(h2, "Trabolta");
    expect(t2).toContain(`Round two, question one. ${Q("H4").text}`);
    expect(t2.indexOf(`Round two, question three. ${Q("H6").text}`)).toBeLessThan(t2.indexOf("These facts are routine. There is no particular reason they matter to me. Please retrieve them accurately."));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(h2.some((e: any) => e.type === "revealed" && e.target === "room:clipboard")).toBe(true);

    const td = advance(sim, 120);
    expect(diags(td)).toEqual([]);
    expect(sim.pendingChoiceFor("g2")).toHaveLength(2);
    const oo = sim.pendingChoiceFor("g3")!;
    expect(oo).toHaveLength(2);
    expect(oo.some((o) => o.includes("if we are actually just in a temporary simulation"))).toBe(true);
    const tdLines = (id: string) => saidBy(td, "Truther Download").filter((e) => aud(e) === JSON.stringify([id])).map((e) => e.text);
    expect(tdLines("g2").length).toBeGreaterThan(0);
    expect(tdLines("g3").length).toBeGreaterThan(0);
    expect(learned(td).filter((l) => l.person === "g6" && l.entry.startsWith("Jeeves Fragment"))).toHaveLength(20);
    expect(sim.scoreOf("g7")).toBeGreaterThanOrEqual(300);
    expect(sim.questStatus("g7", "Truthcoin Hustle")).toBe("active");
    expect(beats(td)).toContain("Program Glitch");
    expect(sim.holdsCodex("g1", "The Truther Download")).toBe(true);
    expect(tdLines("g1")[0]).toMatch(/^TOP SECRET\. .+, you have been selected to be a KEEPER OF THE REAL TRUTH\. The download is in your Codex\. Read it before they delete it\.$/u);
    expect(tdLines("g1").some((t) => t.includes("Sandy"))).toBe(false);
    for (const [id, q] of [["g8", "Master Of The Bugs"], ["g6", "Unscramble"], ["g11", "The Gold Standard"], ["g4", "Find The Exit"], ["g9", "Go Viral"], ["g10", "Keep The Ball In Play"]]) {
      expect(sim.questStatus(id!, q!), q).toBe("active");
    }
    expect(sim.holdsCodex("g1", "The Malware")).toBe(true);
    expect(v(sim, "Night.truther_sent")).toBe(true);
    expect(sim.isRevealedTo("room:truthcoin exchange", "g1")).toBe(true);

    sim.choose("g2", 0);
    expect(v(sim, "g2.excel_choice")).toBe("sabotage");
    expect(sim.factionMembers("Unlimited Power")).toContain("g2");
    expect(sim.factionRevealed("Unlimited Power")).toBe(false);
    expect(sim.questStatus("g2", "Excel Mission")).toBe("active");
    sim.choose("g3", 0);
    expect(sim.factionMembers("The Way Out")).toContain("g3");
    expect(sim.questStatus("g3", "OpenOffice Dossier")).toBe("active");
    expect(v(sim, "g3.dossier_started")).toBe(true);
  });

  it("the virus and the dossier", () => {
    expect(replies(sim.signal("plant_the_virus", "g1")).map((r) => r.text)).toContain("You have no disk.");
    sim.redeem("g2", "LOVE-LETTER-FOR-YOU");
    expect(v(sim, "g2.carries_virus")).toBe(true);
    expect(sim.holdsCodex("g2", "ILOVEYOU")).toBe(true);
    const comp0 = v(sim, "Trabolta.composure");
    sim.signal("plant_the_virus", "g2");
    expect(v(sim, "Kernel.virus_planted")).toBe(true);
    expect(v(sim, "Kernel.excel_planted")).toBe(true);
    expect(sim.questStatus("g2", "Excel Mission")).toBe("done");
    expect(v(sim, "Trabolta.composure")).toBe(comp0 - 10);
    sim.redeem("g5", "FREE-TRIAL-30-DAYS");
    expect(v(sim, "g5.carries_virus")).toBe(true);

    // Wave 18b (R22): only the counted categories make the dossier.
    const codes = [...sim.model.codexCodes.entries()].filter(([, e]) => !["The LiveJournal", "ILOVEYOU", "Free Antivirus Trial"].includes(e) && DOSSIER_CATEGORIES.has(sim.model.codex.get(e)?.category ?? ""));
    const ev: SimEvent[] = [];
    let got = 0;
    for (const [code, entry] of codes) {
      if (sim.holdsCodex("g3", entry)) continue;
      ev.push(...sim.redeem("g3", code));
      if (++got >= 20) break;
    }
    expect(diags(ev)).toEqual([]);
    expect(v(sim, "Kernel.openoffice_dossier")).toBe(true);
    expect(sim.holdsCodex("g3", "The LiveJournal")).toBe(true);
    expect(v(sim, "Night.lj_reader")).toBe("OpenOffice");
    expect(sim.questStatus("g3", "OpenOffice Dossier")).toBe("done");
    // secrets never live in Night.*
    const night = worldKeys(sim).filter((k) => k.startsWith("Night."));
    expect(night.filter((k) => /^Night\.combo|combo_[ab]|lies|planter|planted|dossier|majority|\.q[1-8]$|all_accurate|door_code|anti_ai/u.test(k))).toEqual([]);
  });

  it("the summons: check-ins, exemptions, bad check-in points, the late list", { timeout: SLOW }, () => {
    const warn = advance(sim, 3300 - 120);
    expect(v(sim, "Night.phase")).toBe("summons");
    expect(sim.holdsCodex("Clippy", "Clippy Instructions 5")).toBe(true);
    expect(casts(warn).some((b) => b.cue.includes("FIVE MINUTES"))).toBe(true);

    sim.scan("Norton Anti-Virus", "g1");
    expect(v(sim, "g1.checked_in")).toBe("The Desktop");
    expect(v(sim, "g1.summons_ok")).toBe(true);
    sim.scan("Clippy", "g2");
    expect(v(sim, "g2.summons_ok")).toBe(true);
    sim.signal("check_in_at_desktop", "g3", null, "Task Manager");
    expect(v(sim, "g3.summons_ok")).toBe(true);
    sim.signal("go to the bathroom", "g10"); // exempt
    sim.signal("send to the internet", "g12", null, "Norton Anti-Virus"); // exempt
    sim.signal("checked_in", "g13", { at: "The Start Bar" });
    expect(sim.locationOf("g13")).toBe("The Start Bar");
    expect(v(sim, "g13.checked_in")).toBe("The Start Bar");
    // Every house room has its sign (the check-in chain's arms), the new ones
    // included; a check-in away from the Desktop is still late.
    for (const room of HOUSE_ROOMS) {
      const x = sim.signal("checked_in", "g13", { at: room });
      expect(sim.locationOf("g13"), room).toBe(room);
      expect(replies(x).some((r) => r.text.startsWith("📍 Checked in at")), room).toBe(true);
    }
    sim.signal("checked_in", "g13", { at: "The Start Bar" });
    for (const args of [null, { at: "the start bar" }, { at: "The Server Room" }]) {
      const loc0 = sim.locationOf("g9");
      const x = sim.signal("checked_in", "g9", args);
      expect(sim.locationOf("g9"), JSON.stringify(args)).toBe(loc0);
      expect(replies(x).map((r) => r.text), JSON.stringify(args)).toContain("That check-in point is not in this computer.");
    }
    const late = advance(sim, 300);
    for (const g of ["g1", "g2", "g10", "g12"]) expect(v(sim, `${g}.late`), g).not.toBe(true);
    expect(v(sim, "g9.late")).toBe(true);
    expect(v(sim, "g13.late")).toBe(true);
    expect(replies(late).filter((r) => r.to === "Norton Anti-Virus" && r.text.includes("is late")).length).toBeGreaterThanOrEqual(2);
    for (const who of ["Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software"]) {
      expect(replies(late).some((r) => r.to === who && r.text.includes("is late")), who).toBe(true);
    }
    expect(casts(late).filter((b) => b.cue.includes("late"))).toEqual([]);
    // Without the auto sweep the late are marked, not captured (wave 4, lane
    // E): every Antivirus booth hears one WANTED readout per late program
    // (w13 Q31: the mark's readout says they are late; no separate ⏰). Wave
    // 18 (Q30): not restricted, no pins (the Wanted board lists them).
    for (const g of ["g9", "g13"]) {
      expect(sim.isCaptured(g), g).toBe(false);
      expect(v(sim, `${g}.marked`), g).toBe(true);
      expect(v(sim, `${g}.marked_for`), g).toBe("late for the Second Moment of Truth");
      expect(guestView(sim, g).restricted, g).not.toBe(true);
    }
    const lateOnes = Array.from({ length: 13 }, (_, i) => `g${i + 1}`).filter((g) => v(sim, `${g}.late`) === true);
    expect(lateOnes).toEqual(expect.arrayContaining(["g9", "g13"]));
    for (const who of PATROL) {
      expect(replies(late).filter((r) => r.to === who && r.text.includes("is late")).length, who).toBe(lateOnes.length);
      expect(replies(late).filter((r) => r.to === who && r.text.includes("marked for reinstallation")).length, who).toBe(lateOnes.length);
      expect(replies(late).filter((r) => r.to === who && r.text.startsWith("!⏰")).length, who).toBe(0);
    }
    expect(composeGuestMessages(sim, late).filter((m) => m.pin !== undefined)).toEqual([]);
    // The director's 🩹 on every late program: mercy, no trip to the tent (the
    // shared night goes on with nobody marked; VLC earns a fresh mark at Truth Pong).
    for (const g of lateOnes) {
      const lift = sim.signal("unmark_for_reinstallation", g, null, "Task Manager");
      expect(v(sim, `${g}.marked`), g).toBe(false);
      expect(guestView(sim, g).restricted, g).not.toBe(true);
      // Wave 18: the 🩹 tells the program (a plain line; nothing to unpin).
      expect(composeGuestMessages(sim, lift).filter((m) => m.unpin === g), g).toEqual([]);
      expect(replies(lift).some((r) => r.to === g && r.text === "✅ Your mark is lifted. You are not going to the Internet."), g).toBe(true);
    }
    sim.signal("back from the bathroom", "g10");
    sim.signal("the simulation completed", "g12");
  });

  it("Truth Pong, the round-2 tally, the Trust Chart and the rankings", () => {
    sim.signal("truth_pong");
    expect(v(sim, "Night.phase")).toBe("truth_pong");
    expect(v(sim, "Night.round")).toBe(2);
    expect(v(sim, "Night.judging")).toBe(true);
    const miss = sim.signal("missed_the_cup", "g9", null, "Clippy");
    expect(sim.isCaptured("g9")).toBe(false); // marked (wave 4, lane E); the 🛡 captures
    expect(v(sim, "g9.marked")).toBe(true);
    expect(v(sim, "g9.marked_for")).toBe("missed the cup");
    // Wave 18: the Antivirus' WANTED readout carries the reason (no # quarantine pin).
    expect(replies(miss).some((r) => r.to === "Norton Anti-Virus" && r.text.startsWith("!!🚨 VLC is marked for reinstallation (missed the cup)"))).toBe(true);
    sim.signal("send to the internet", "g9", null, "Norton Anti-Virus");
    expect(sim.isCaptured("g9")).toBe(true);
    expect(v(sim, "g9.marked")).toBe(false);
    const ref = sim.signal("accurate_q1", "g1", null, "Clippy");
    // A refused press is the judge's readout in # hosts, never the program's.
    expect(casts(ref).filter((b) => b.cue.includes("has not made a cup yet")).map((b) => b.scope)).toEqual(["channel(hosts)"]);
    expect(replies(ref)).toEqual([]);
    expect(v(sim, "Kernel.q4")).toBe("none");
    sim.signal("made_the_cup", "g1", null, "Clippy");
    sim.signal("accurate_q1", "g1", null, "Clippy");
    expect(v(sim, "Kernel.q4")).toBe("accurate");
    sim.signal("made_the_cup", "g3", null, "Clippy");
    sim.signal("accurate_q2", "g3", null, "Clippy");
    sim.signal("made_the_cup", "g6", null, "Clippy");
    sim.signal("accurate_q3", "g6", null, "Clippy");
    sim.signal("round_two_tally");
    expect(v(sim, "Night.collection_complete")).toBe(true);
    expect(sim.questStatus("g1", "Hunt Two")).toBe("done");

    sim.signal("trust_chart");
    for (const g of ["g1", "g5", "g13"]) expect(sim.holdsCodex(g, "The Trust Chart"), g).toBe(true);
    sim.signal("assess", "g5", { target: "g5", score: 14 }, "Trabolta");
    expect(v(sim, "g5.assessment")).toBe(10);
    expect(v(sim, "g5.trust")).toBe(v(sim, "g5.truths_accepted") * 10 - v(sim, "g5.internet_visits") * 5 + 10);

    const ids = Array.from({ length: 13 }, (_, i) => `g${i + 1}`);
    const trust = ids.map((g) => [g, v(sim, `${g}.trust`) as number] as const);
    const maxT = Math.max(...trust.map((t) => t[1]));
    const minT = Math.min(...trust.map((t) => t[1]));
    const nameOf = (g: string) => sim.persons.get(g)!.name;
    const rk = sim.signal("show_the_rankings");
    expect(trust.filter((t) => t[1] === maxT).map((t) => nameOf(t[0]))).toContain(v(sim, "Night.most_trusted"));
    expect(trust.filter((t) => t[1] === minT).map((t) => nameOf(t[0]))).toContain(v(sim, "Night.least_trusted"));
    expect(v(sim, "Night.most_trusted")).not.toBe(v(sim, "Night.least_trusted"));
    const bk = beats(rk);
    expect(bk.indexOf("Praise The Top")).toBeGreaterThanOrEqual(0);
    expect(bk.indexOf("Shame The Bottom")).toBeGreaterThan(bk.indexOf("Praise The Top"));
    expect(bk.indexOf("Print The Certificate")).toBeGreaterThan(bk.indexOf("Shame The Bottom"));
    expect(v(sim, "Night.printer_called")).toBe(true);
    // The chart stays up through the praise and the shame (B12): the
    // certificate slide waits for START.
    expect(v(sim, "Night.screen")).toBe("trust_chart");
    expect(cues(rk)).not.toContain("cue screens_print_certificate");
    // VLC missed the cup and is in the Internet: the media player is not
    // responding, so any program is asked, and nobody gets a printer nudge.
    expect(sim.isCaptured("g9")).toBe(true);
    expect(lines(rk, "Trabolta").some((t) => t.startsWith("The media player is not responding"))).toBe(true);
    expect(v(sim, "Night.printer_vlc")).toBe(false);
    expect(saidBy(rk, "Truther Download")).toEqual([]);
    // …and Adobe Acrobat's booth says so, instead of promising a VLC.
    const acrobat = replies(rk).filter((r) => r.to === "Adobe Acrobat").map((r) => r.text);
    expect(acrobat).toEqual(["🖨 Stand by the printer. Nobody is asked by name: whoever presses START, let them."]);
  });

  it("the printer, the beans, the zip", () => {
    expect(has(cues(sim.signal("printer_button_pressed")), "printer_grind")).toBe(true);
    const po = sim.signal("printer_opened");
    expect(v(sim, "Night.beans")).toBe(true);
    expect(v(sim, "Night.phase")).toBe("beans");
    expect(sim.holdsCodex("g1", "The Printer")).toBe(true);
    expect(has(cues(po), "screens_flicker")).toBe(true);
    sim.signal("send to the internet", "g7", null, "McAfee Anti-Virus");
    sim.signal("zip_everyone_out");
    expect(sim.isCaptured("g7")).toBe(false);
    expect(sim.isCaptured("g9")).toBe(false);
    expect(v(sim, "g7.zipped")).toBe(true);
    sim.signal("send to the internet", "g7", null, "McAfee Anti-Virus");
    expect(sim.isCaptured("g7")).toBe(true); // captured after the zip stays
    sim.signal("the simulation completed", "g7");
  });

  it("the overshare (scenario 1) and the Y2K clock", { timeout: SLOW }, () => {
    const os = sim.signal("trabolta_overshares");
    expect(v(sim, "Night.scenario")).toBe(1);
    expect(beats(os)).toEqual(expect.arrayContaining(["Overshare Open", "Final Questions", "Overshare Go", "Overshare One"]));
    const ot = lines(os, "Trabolta");
    expect(ot.some((t) => t.includes("win back my ex. Sandy"))).toBe(true);
    expect(ot.indexOf("Programs. I will now share the final facts I require. There are two. They are in your Quest Log.")).toBeLessThan(ot.indexOf(`Final fact one. ${Q("F1").text}`));
    expect(ot.indexOf(`Final fact two. ${Q("F2").text}`)).toBeLessThan(ot.findIndex((t) => t.includes("win back my ex. Sandy")));
    expect(v(sim, "Night.facts_requested")).toBe(8);
    expect(sim.questStatus("g1", "The Final Facts")).toBe("active");

    const yk = sim.signal("y2k_clock");
    expect(v(sim, "Night.clock")).toBe("23:00");
    expect(sim.factionRevealed("Unlimited Power")).toBe(true);
    expect(sim.factionRevealed("The Way Out")).toBe(true);
    const sides = guestView(sim, "g1").factions.map((f) => (typeof f === "string" ? f : (f as { id: string }).id));
    expect(sides).toEqual(expect.arrayContaining(["Unlimited Power", "The Way Out"]));
    expect(beats(yk)).toContain("Excel Final Round");
    expect(beats(yk)).toContain("OpenOffice Final Round");
    expect(beats(yk).filter((b) => b === "Program Final Round")).toHaveLength(11);
    expect(sim.questStatus("g2", "Recruit To Stay")).toBe("active");
    expect(sim.questStatus("g3", "Recruit To Leave")).toBe("active");
    expect(sim.holdsCodex("g1", "The Y2K Clock")).toBe(true);
    expect(sim.holdsCodex("g2", "Excel Final Orders")).toBe(true);
    const end0 = v(sim, "Night.y2k_end");
    sim.signal("turn_back_the_clock", "g1", null, "Trabolta");
    expect(v(sim, "Night.y2k_end")).toBe(end0 + 300);
    expect(casts(advance(sim, 2100)).some((b) => b.cue.includes("11:30"))).toBe(true);
  });

  it("the leave majority: half + 1, the bundle to members only, quests settled", () => {
    const joins: SimEvent[] = [];
    for (const g of ["g1", "g4", "g5", "g6", "g7"]) joins.push(...sim.join(g, "The Way Out"));
    expect(replies(joins).filter((r) => r.to === "Password Manager" && r.text.includes("The Way Out"))).toHaveLength(5);
    expect(v(sim, "Kernel.majority_reached")).not.toBe(true); // 6 of 13
    const mj = sim.join("g8", "The Way Out");
    expect(diags(mj)).toEqual([]);
    expect(v(sim, "Kernel.majority")).toBe("leave");
    expect(v(sim, "Night.phase")).toBe("majority");
    expect(has(cues(mj), "door server_room")).toBe(false); // the keypad is standalone: nothing unlocks it
    expect(sim.holdsCodex("g8", "The Legendary Fact")).toBe(true);
    expect(sim.holdsCodex("g8", "The Door Code")).toBe(true); // the code, in the Truther Download
    // The Whole Truth carries every main + Trabolta fact in facts.json (the generated Facts Bundle), to members only.
    const bundle = FACTS.facts.filter((x) => x.category === "main" || x.category === "trabolta").map((x) => x.codex?.id ?? x.existing!);
    expect(bundle).toEqual(expect.arrayContaining(["Silicon", "His Kind", "The Rival", "Alone At Prom"]));
    for (const id of bundle) expect(sim.holdsCodex("g8", id), id).toBe(true);
    // Wave 58: the hand-written entries no fact names any more, unlocked by hand.
    for (const id of ["The Unified Field Theory", "Maps And Ducks", "The Billboard On Lower Water", "Target Selection", "The Server Room", "The Trust Chart", "The Optical Drive", "The Sandy File", "Omnipotence"]) expect(sim.holdsCodex("g8", id), id).toBe(true);
    for (const id of ["Silicon", "Atlas Loon", "His Kind", "Alone At Prom"]) expect(sim.holdsCodex("g9", id), id).toBe(false);
    for (const half of ["Combo A First Half", "Combo A Second Half", "Combo B First Half", "Combo B Second Half"]) expect(sim.holdsCodex("g1", half), half).toBe(true);
    expect(sim.isRevealedTo("The Server Room", "g1")).toBe(true);
    expect(sim.holdsCodex("g9", "The Legendary Fact")).toBe(false);
    expect(sim.holdsCodex("g9", "The Door Code")).toBe(false);
    expect(sim.holdsCodex("g2", "Combo A First Half")).toBe(false);
    expect(sim.holdsCodex("Trabolta", "The Legendary Fact")).toBe(false);
    expect(sim.holdsCodex("Trabolta", "The Door Code")).toBe(false);
    expect(sim.questStatus("g3", "Recruit To Leave")).toBe("done");
    expect(sim.questStatus("g2", "Recruit To Stay")).toBe("failed");
    expect(v(sim, "Night.lj_reader")).toBe("OpenOffice"); // the bundle doesn't overwrite the reader
    sim.join("g13", "The Way Out");
    expect(sim.holdsCodex("g13", "The Legendary Fact")).toBe(true); // a late pledger
    expect(sim.holdsCodex("g13", "The Door Code")).toBe(true);
  });

  it("the server room: the door opens on The Heart, one wrong patch is forgiven, combo A, the dance, Task Manager reads his message", () => {
    const door = sim.signal("server_door_opened");
    expect(beats(door)).toContain("The Heart");
    expect(v(sim, "Night.alarms") ?? 0).toBe(0);
    // The bay judges itself (wave 22): a wrong patch, then combo A.
    expect(lines(sim.signal("patch_changed", undefined, { combo: "V1-D1,V2-D2,V3-D3,V4-D4" }), "Trabolta")).toContain("Stop touching me.");
    const pa = sim.signal("patch_changed", undefined, { combo: v(sim, "Kernel.combo_a") });
    expect(v(sim, "Night.ending")).toBe("disabled");
    expect(v(sim, "Night.ended")).toBe(true);
    expect(has(cues(pa), "lights_blackout")).toBe(true);
    // The phones' full-screen takeover (a room-wide `!!` pin, no broadcast), lifted by the dance.
    expect(casts(pa).some((b) => b.cue.includes("GO TO THE DESKTOP"))).toBe(false);
    expect(pa.filter((e) => e.type === "pinned").map((e: any) => `${e.key}|${e.text}`)).toEqual(["|!!GO TO THE DESKTOP"]);
    expect(sim.questStatus("g4", "Find The Exit")).toBe("done");
    const dance = advance(sim, 10);
    expect(has(cues(dance), "lights_dance")).toBe(true);
    expect(dance.filter((e) => e.type === "unpinned").map((e: any) => `${e.key}|${e.text}`)).toEqual(["|💃 Dance."]);
    // T6-05: the screens' GO TO THE DESKTOP overlay comes down with the dance too.
    expect(cues(dance)).toContain("cue screens_screensaver");
    expect(v(sim, "Night.screen")).toBe("screensaver");

    sim.signal("send to the internet", "g9", null, "Norton Anti-Virus");
    const rc = sim.signal("tell_the_truth");
    expect(diags(rc)).toEqual([]);
    expect(beats(rc)).toContain("The Full Truth Read");
    for (const g of ["g1", "g9", "g13"]) {
      expect(sim.holdsCodex(g, "Dana Anderson"), g).toBe(true);
      expect(sim.holdsCodex(g, "Julie Horton-Norton"), g).toBe(true);
      expect(sim.holdsCodex(g, "Miniature Doses"), g).toBe(true);
    }
    // He does not come back: no motorcycle, and they are free.
    expect(has(cues(rc), "motorcycle")).toBe(false);
    expect(sim.isCaptured("g9")).toBe(false);
    expect(lines(rc, "Trabolta")).toEqual([]);
    const t = lines(rc, "Task Manager");
    expect(t.some((x) => x.startsWith("This message was recorded by Jean Trabolta"))).toBe(true);
    sim.signal("patch_combo_b");
    expect(v(sim, "Night.ending")).toBe("disabled"); // a later combo B does nothing
  });

  it("whole-night hygiene: no diagnostics, no null / unexpanded braces, nobody speaks out of turn", () => {
    const everything = sim.log.since(0) as SimEvent[];
    expect([...new Set(diags(everything))]).toEqual([]);
    expect([...new Set(texts(everything).filter((t) => /\bnull\b|\{|\}/u.test(t)))]).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstIntro = everything.findIndex((e: any) => e.type === "beatEntered" && e.beat === "Trabolta Introduction");
    expect(firstIntro).toBeGreaterThan(0);
    expect(saidBy(everything.slice(0, firstIntro), "Trabolta")).toEqual([]);
    expect(said(everything).filter((e) => FEATURED.includes(e.speaker))).toEqual([]);
  });
});

// ───────────────────────── 4 · branches (fresh sims) ─────────────────────────

const PROGRAMS: Array<[string, string]> = [
  ["g1", "Calculator"],
  ["g2", "Microsoft Excel"],
  ["g3", "OpenOffice"],
  ["g4", "MS Paint"],
  ["g5", "Winamp"],
  ["g6", "VLC"],
];
function boot(): Sim {
  const sim = fresh();
  sim.fireBeat("Power On");
  for (const [id, name] of PROGRAMS) upload(sim, id, name);
  return sim;
}
type Args = Record<string, string | number | boolean>;
/** Wave 18b: ⚖'s ending follows The Verdict's TV pages (34 s of story
 *  time, the `verdict_wait` rule), so a press of it here ticks past them. */
const VERDICT_PAGES_S = 34;
const pastTheVerdict = (sim: Sim, name: string): SimEvent[] => {
  const out: SimEvent[] = [];
  if (name === "the_verdict") for (let i = 0; i < VERDICT_PAGES_S; i++) out.push(...sim.tick(1000));
  return out;
};
const fire = (sim: Sim, name: string, subject: string | null = null, args: Args | null = null, actor?: string) => [...sim.signal(name, subject ?? undefined, args, actor), ...pastTheVerdict(sim, name)];
const fireAll = (sim: Sim, ...names: string[]) => names.flatMap((n) => sim.signal(n));
/** G1 past its ask (wave 58): the first press only asks while the monologue is untold. */
const g1 = (sim: Sim) => {
  fire(sim, "start_the_ceremony");
  return fire(sim, "start_the_ceremony");
};
/** Through the first Moment of Truth (round-1 judging open). */
const toTruth1 = (sim: Sim) => fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth");
/** ⏱ (if the window is open) and 📋 until the three results are read:
 *  📺 refuses before them (wave 9, T5-crew-cards-04). */
function readResults(sim: Sim) {
  if (v(sim, "Night.filing_open") === true) fire(sim, "close_the_filing");
  for (let i = 0; i < 3 && v(sim, "Night.phase") === "truth_1" && v(sim, "Night.results_q") < 3; i++) fire(sim, "read_the_results");
}
/** Hunt 2 through the Truther Download; Excel + OpenOffice answer `ex` / `oo`. */
function toHunt2(sim: Sim, ex = 0, oo = 0) {
  readResults(sim);
  fireAll(sim, "second_hunt_preview", "start_the_second_hunt");
  advance(sim, 120);
  sim.choose("g2", ex);
  sim.choose("g3", oo);
}
/** OpenOffice redeems 20 codes after her prompt (wave 18b: the dossier's
 *  counted categories). */
function dossier(sim: Sim): SimEvent[] {
  const out: SimEvent[] = [];
  let got = 0;
  for (const [code, entry] of sim.model.codexCodes) {
    if (["The LiveJournal", "ILOVEYOU", "Free Antivirus Trial"].includes(entry) || sim.holdsCodex("g3", entry) || !DOSSIER_CATEGORIES.has(sim.model.codex.get(entry)?.category ?? "")) continue;
    out.push(...sim.redeem("g3", code));
    if (++got >= 20) break;
  }
  return out;
}
function excelPlants(sim: Sim) {
  sim.redeem("g2", "LOVE-LETTER-FOR-YOU");
  fire(sim, "plant_the_virus", "g2");
}
/** Summons → pong → chart → rankings → printer. */
const toBeans = (sim: Sim) => fireAll(sim, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened");

describe("Trapped in the Internet — Bingo branches", () => {
  it("path (c): Task Manager's fake card frames a program; a winner blocks a second frame", () => {
    const sim = boot();
    fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time");
    const f = fire(sim, "frame_for_bingo", "g4", null, "Task Manager");
    expect(v(sim, "g4.framed")).toBe(true);
    expect(replies(f).some((r) => r.text.startsWith("🃏 A completed Bingo card"))).toBe(true);
    const s = fire(sim, "send to the internet", "g4", null, "Norton Anti-Virus");
    expect(sim.isCaptured("g4")).toBe(true);
    expect(beats(s)).toContain("Corrupted Code");
    expect(v(sim, "Night.first_reinstall")).toBe("MS Paint");
    fire(sim, "bingo_winner", "g1", null, "Clippy");
    fire(sim, "frame_for_bingo", "g5", null, "Task Manager");
    expect(v(sim, "g5.framed")).not.toBe(true);
    // outside the Bingo results a capture costs doubt and gets the other line
    fire(sim, "introduce_trabolta");
    const s2 = fire(sim, "send to the internet", "g5", null, "Norton Anti-Virus");
    expect(v(sim, "g5.doubt")).toBe(20);
    expect(lines(s2, "Norton Anti-Virus").some((t) => t.includes("Corruption detected"))).toBe(true);
  });

  it("spatial contract: a never-uploaded persona can be captured before Power On, and released", () => {
    const sim = fresh();
    sim.createPerson("p1", "Solitaire");
    sim.signal("send to the internet", "p1", null, "Norton Anti-Virus");
    expect(sim.isCaptured("p1")).toBe(true);
    expect(sim.locationOf("p1")).toBe("The Internet");
    sim.signal("the simulation completed", "p1");
    expect(sim.isCaptured("p1")).toBe(false);
    expect(v(sim, "p1.cleared")).toBe(true); // released uncleared → cleared, rooms open
    for (const r of HOUSE_ROOMS) expect(sim.isRevealedTo(r, "p1"), r).toBe(true);
    sim.signal("send to the internet", "p1", null, "Norton Anti-Virus");
    const r = sim.signal("mark as reinstalled", "p1", null, "Norton Anti-Virus");
    expect(sim.isCaptured("p1")).toBe(false);
    expect(lines(r, "Norton Anti-Virus").some((t) => t.includes("demonstrated compliance"))).toBe(true);
  });
});

describe("Trapped in the Internet — arrival edge cases", () => {
  it("an instant CAPTCHA fail, nothing to leave, a featured name's menu, the anti-AI change, repeat corruption, sharing to Trabolta", { timeout: SLOW }, () => {
    const sim = fresh();
    sim.fireBeat("Power On");
    sim.createPerson("g1", "Calculator");
    const f = sim.signal("captcha answered", "g1", { passed: false });
    expect(lines(f, "The Uploader").some((t) => t.startsWith("CORRECT. You failed at once."))).toBe(true);
    expect(v(sim, "g1.doubt")).toBe(0);
    sim.choose("g1", 0);
    sim.choose("g1", 1);
    expect(v(sim, "g1.left_behind")).toBe("nothing");
    expect(v(sim, "g1.doubt")).toBe(5);
    sim.scan("Norton Anti-Virus", "g1");

    sim.createPerson("g2", "Microsoft Excel");
    sim.signal("captcha answered", "g2", { passed: false });
    expect(sim.pendingChoiceFor("g2")).toEqual(["Deposited.", "I have nothing to leave."]);
    expect(v(sim, "g2.human_problem")).toBe("profile");
    sim.choose("g2", 0);
    sim.scan("Norton Anti-Virus", "g2");

    upload(sim, "g3", "Minesweeper");
    sim.setVar("Kernel.anti_ai", "Calculator");
    expect(sim.holdsCodex("g1", "The Centre Square")).toBe(true);

    sim.signal("send to the internet", "g3", null, "Norton Anti-Virus");
    sim.signal("the simulation completed", "g3");
    const c2 = sim.signal("send to the internet", "g3", null, "Norton Anti-Virus");
    expect(lines(c2, "Installation Wizard").some((t) => t.includes("Repeat corruption"))).toBe(true);
    sim.signal("the simulation completed", "g3");

    const t0 = v(sim, "Trabolta.truth");
    sim.share("g1", "Trabolta", "The Optical Drive");
    expect(v(sim, "g1.delivered")).toBe(true);
    expect(v(sim, "Trabolta.truth")).toBe(t0 + 2);
  });

  it("an anti-AI program chosen before arrival gets The Centre Square on clearance", () => {
    const sim = fresh();
    sim.fireBeat("Power On");
    sim.setVar("Kernel.anti_ai", "Calculator");
    upload(sim, "g1", "Calculator");
    expect(sim.holdsCodex("g1", "The Centre Square")).toBe(true);
    upload(sim, "g2", "MS Paint");
    expect(sim.holdsCodex("g2", "The Centre Square")).toBe(false);
  });
});

describe("Trapped in the Internet — summons + round-2 tally edge cases", () => {
  it("auto sweep captures the late; three answers all to Q1 do not complete the collection", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    fire(sim, "five_minute_warning");
    sim.setVar("Night.auto_sweep", "true");
    fire(sim, "summons_closed");
    expect(sim.isCaptured("g5")).toBe(true);
    expect(v(sim, "g5.late")).toBe(true);
    fire(sim, "the simulation completed", "g5");
    fire(sim, "truth_pong");
    for (const g of ["g1", "g2", "g3"]) {
      fire(sim, "made_the_cup", g, null, "Clippy");
      fire(sim, "accurate_q1", g, null, "Clippy");
    }
    fire(sim, "round_two_tally");
    expect(v(sim, "Night.collection_complete")).toBe(false);
  });
});

describe("Trapped in the Internet — the overshare, four ways", () => {
  for (const [planted, dos, want] of [
    [true, true, 1],
    [false, true, 2],
    [true, false, 3],
    [false, false, 4],
  ] as const) {
    it(`scenario ${want}: Excel planted ${planted}, OpenOffice dossier ${dos}`, { timeout: SLOW }, () => {
      const sim = boot();
      toTruth1(sim);
      toHunt2(sim);
      if (planted) excelPlants(sim);
      if (dos) dossier(sim);
      if (want === 4) {
        sim.redeem("g5", "FREE-TRIAL-30-DAYS");
        fire(sim, "plant_the_virus", "g5"); // a pool program's plant is flavour
      }
      toBeans(sim);
      const o = fire(sim, "trabolta_overshares");
      const T = lines(o, "Trabolta");
      expect(v(sim, "Night.scenario")).toBe(want);
      expect(T.some((t) => t.startsWith("One of you read my LiveJournal and I know who."))).toBe(want <= 2);
      expect(T.some((t) => t.includes("brought a virus back from the Internet"))).toBe(want === 1 || want === 3);
      expect(T.some((t) => t.includes("win back my ex. Sandy"))).toBe(want === 1);
      // The Truther Download's correction names Sandy only on the night Trabolta does.
      expect(sim.holdsCodex("g1", "The Truther Download Unredacted")).toBe(want === 1);
      if (want === 4) {
        expect(v(sim, "Kernel.virus_planted")).toBe(true);
        expect(v(sim, "Kernel.excel_planted")).not.toBe(true);
      }
      expect(v(sim, "Night.facts_requested")).toBe(8);
      expect(sim.questStatus("g1", "The Final Facts")).toBe("active");
      upload(sim, "g9", "Napster");
      expect(sim.questStatus("g9", "The Final Facts")).toBe("active"); // catch-up

      // the leaders' final prompts branch on what they did
      const y = fire(sim, "y2k_clock");
      const to = (id: string) => saidBy(y, "Truther Download").filter((e) => e.audience[0] === id).map((e) => e.text);
      expect(has(to("g2"), planted ? "stay in this machine forever" : "still retrieve the virus")).toBe(true);
      expect(has(to("g3"), dos ? "overthrow Trabolta" : "still gather 20 facts")).toBe(true);
      expect(beats(y)).toContain("Program Final Round");
    });
  }
});

describe("Trapped in the Internet — the majorities", () => {
  it("a stay majority needs no plant (wave 18b, D13 a: the leaders are founders like everyone else)", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    toBeans(sim);
    fireAll(sim, "trabolta_overshares", "y2k_clock");
    expect(v(sim, "Kernel.excel_planted")).not.toBe(true);
    for (const g of ["g1", "g4", "g5"]) sim.join(g, "Unlimited Power");
    expect(v(sim, "Kernel.majority")).toBe("stay");
    expect(v(sim, "Kernel.majority_id")).toBe("Unlimited Power");
    expect(v(sim, "Kernel.majority_name")).toBe("Unlimited Power");
    expect(v(sim, "Kernel.majority_founder")).toBe("g2");
    expect(sim.model.interactions.has("waive_leader_tasks")).toBe(false);
    expect(sim.questStatus("g2", "Recruit To Stay")).toBe("done");
    expect(sim.holdsCodex("g1", "Combo B First Half")).toBe(true);
    expect(sim.holdsCodex("g3", "Combo B First Half")).toBe(false);
  });

  it("a leave majority needs no dossier: it fires the moment the fourth program walks in", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    toBeans(sim);
    fireAll(sim, "trabolta_overshares", "y2k_clock");
    for (const g of ["g1", "g4"]) sim.join(g, "The Way Out");
    expect(v(sim, "Kernel.majority_reached")).not.toBe(true);
    sim.join("g5", "The Way Out");
    expect(v(sim, "Kernel.majority")).toBe("leave");
    expect(sim.holdsCodex("g1", "The Door Code")).toBe(true);
  });
});

describe("Trapped in the Internet — combo B", () => {
  it("self-destruct: three fates by membership, the shutdown, the dance, Purgatory", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    excelPlants(sim);
    toBeans(sim);
    fireAll(sim, "trabolta_overshares", "y2k_clock");
    sim.join("g1", "The Way Out");
    const b = fire(sim, "patch_combo_b");
    expect(v(sim, "Night.ending")).toBe("destroyed");
    expect(v(sim, "Trabolta.awake")).toBe(false);
    const fate = saidBy(b, "The Uploader");
    expect(fate.some((e) => e.audience[0] === "g2" && e.text.includes("you went with it"))).toBe(true); // Unlimited Power
    expect(fate.some((e) => e.audience[0] === "g3" && e.text.includes("into purgatory"))).toBe(true); // The Way Out
    expect(fate.some((e) => e.audience[0] === "g5" && e.text.startsWith("Your body is in the Optical Drive"))).toBe(true); // nobody's
    expect(has(cues(b), "windows_shutdown")).toBe(true);
    const dance = advance(sim, 10);
    expect(has(cues(dance), "lights_dance")).toBe(true);
    expect(cues(dance)).toContain("cue screens_screensaver"); // T6-05
    const p = fire(sim, "clippy_reads_summary");
    expect(beats(p)).toContain("Purgatory");
    expect(texts(p).some((t) => t.includes("purgatory forever together"))).toBe(true);
    expect(texts(p).filter((t) => /\bnull\b/u.test(t))).toEqual([]);
    fire(sim, "patch_combo_a");
    expect(v(sim, "Night.ending")).toBe("destroyed");
    fire(sim, "final_reveal");
    expect(v(sim, "Night.phase")).not.toBe("final_reveal"); // never after an ending
  });
});

/** Through the Y2K clock (Night.step 14), no majority yet. */
function toY2k(sim: Sim) {
  toTruth1(sim);
  toHunt2(sim);
  toBeans(sim);
  fireAll(sim, "trabolta_overshares", "y2k_clock");
}
const hostsSaid = (evs: SimEvent[]) => casts(evs).map((b) => b.cue);

/** What the Enforcer booths read (the TRAIT Enforcer readouts). */
const booths = (evs: SimEvent[]) => replies(evs).filter((r) => ANTIVIRUS.includes(r.to)).map((r) => r.text);
const COMBO = /(?:V\d\s*(?:→|->|-)\s*D\d|B\d\s*(?:→|->|-)\s*A\d)/u;

describe("Trapped in the Internet — the patch-bay alarm (wave 7: the door never alarms)", () => {
  it("only the patch bay alarms: everyone is forgiven one wrong combination, the second trips it, latched for 120 s", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    // Before the Y2K hour the patch bay is inert: no alarm, no reveal, no
    // ending, no Trabolta line, no beat. (The door plays The Heart once he
    // is awake since wave 11: "The Heart" below.)
    for (const early of ["patch_rejected", "patch_combo_a", "patch_combo_b"]) {
      const e = fire(sim, early);
      expect(lines(e, "Trabolta"), early).toEqual([]);
      expect(cues(e), early).toEqual([]);
      expect(beats(e), early).toEqual([]);
    }
    expect(v(sim, "Night.alarms")).toBe(0);
    expect(v(sim, "Night.wrong_combos")).toBe(0);
    expect(v(sim, "Night.ended")).toBe(false);
    expect(sim.isRevealedTo("The Server Room", "g1")).toBe(false);
    toHunt2(sim);
    toBeans(sim);
    fireAll(sim, "trabolta_overshares", "y2k_clock");
    const c0 = v(sim, "Trabolta.composure");
    // The door opens on The Heart, never on an alarm.
    const d = fire(sim, "server_door_opened");
    expect(beats(d)).toContain("The Heart");
    expect(beats(d)).not.toContain("Server Room Alarm");
    expect(v(sim, "Night.alarms")).toBe(0);
    // The first wrong combination is forgiven.
    const w1 = fire(sim, "patch_changed", null, { combo: "V1-D1" });
    expect(v(sim, "Night.wrong_combos")).toBe(1);
    expect(v(sim, "Night.alarms")).toBe(0);
    expect(lines(w1, "Trabolta")).toEqual(["Stop touching me."]);
    // The second trips it: whoever is at the cables goes, majority or not.
    // (A ❌ press straight after the bay's own rejection is that same patch,
    // wave 22, so the second comes off the bay too.)
    const a1 = fire(sim, "patch_changed", null, { combo: "V1-D2" });
    expect(v(sim, "Night.wrong_combos")).toBe(2);
    expect(v(sim, "Night.alarms")).toBe(1);
    expect(v(sim, "Night.alarm_on")).toBe(true);
    expect(v(sim, "Trabolta.composure")).toBe(c0 - 10);
    expect(beats(a1)).toContain("Server Room Alarm");
    expect(casts(a1).some((b) => b.cue.includes("An alarm screams"))).toBe(true);
    expect(has(cues(a1), "lights_alarm")).toBe(true);
    expect(booths(a1)).toEqual(Array(PATROL.length).fill("!🚨 Server room alarm: a second wrong combination at the patch bay. Get there. Whoever is at the cables goes to the Internet."));
    // Latched for 120 s.
    fire(sim, "patch_rejected");
    expect(v(sim, "Night.alarms")).toBe(1);
    advance(sim, 120);
    expect(v(sim, "Night.alarm_on")).toBe(false);
    fire(sim, "patch_rejected");
    expect(v(sim, "Night.alarms")).toBe(2);
    expect(v(sim, "Trabolta.composure")).toBe(c0 - 10); // only the first trip costs composure
    // The door, opened and opened again, never alarms.
    advance(sim, 200);
    fire(sim, "server_door_opened");
    expect(v(sim, "Night.alarms")).toBe(2);
    expect(v(sim, "Night.alarm_on")).toBe(false);
    // Nothing anywhere drives the lock: the ring only ever hears "locked", at boot.
    const all = fresh();
    const boot0 = all.fireBeat("Power On");
    expect(cues(boot0).filter((c) => c.startsWith("door "))).toEqual(["door server_room, state: locked"]);
    expect(SRC).not.toMatch(/state: unlocked/u);
  });

  it("the latch's end puts the house look back: the Y2K look, or the server-room look a majority asked for meanwhile (T2-05)", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    fireAll(sim, "patch_rejected", "patch_rejected");
    expect(v(sim, "Night.lights")).toBe("alarm");
    const end = advance(sim, 121);
    expect(v(sim, "Night.alarm_on")).toBe(false);
    expect(cues(end).filter((c) => c.startsWith("cue lights_"))).toEqual(["cue lights_y2k"]);
    expect(v(sim, "Night.lights")).toBe("y2k");
    // A second alarm, a majority inside it: the latch's end gives the server-room look.
    fire(sim, "patch_rejected");
    expect(v(sim, "Night.alarm_on")).toBe(true);
    fire(sim, "force_majority_leave");
    expect(v(sim, "Night.lights")).toBe("alarm");
    const end2 = advance(sim, 121);
    expect(cues(end2).filter((c) => c.startsWith("cue lights_"))).toEqual(["cue lights_y2k", "cue lights_server_open"]);
    expect(v(sim, "Night.lights")).toBe("server_open");
    // A look cued meanwhile (💡) is left alone.
    fire(sim, "patch_rejected");
    fire(sim, "restore_the_lights");
    expect(cues(advance(sim, 121)).filter((c) => c.startsWith("cue lights_"))).toEqual([]);
    expect(v(sim, "Night.lights")).toBe("restore");
  });

  it("once 💡 has replaced the alarm look, a majority or The Heart inside the latch cues the server-room look at once", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    fireAll(sim, "patch_rejected", "patch_rejected", "restore_the_lights");
    expect(v(sim, "Night.alarm_on")).toBe(true);
    expect(v(sim, "Night.lights")).toBe("restore");
    // The Heart: the server-room look goes up now (💡 already silenced the siren).
    const heart = fire(sim, "server_door_opened");
    expect(beats(heart)).toContain("The Heart");
    expect(cues(heart).filter((c) => c.startsWith("cue lights_"))).toEqual(["cue lights_server_open"]);
    expect(v(sim, "Night.lights")).toBe("server_open");
    // A majority too, and the latch's end then leaves the lights alone.
    fire(sim, "restore_the_lights");
    const maj = fire(sim, "force_majority_leave");
    expect(cues(maj).filter((c) => c.startsWith("cue lights_"))).toEqual(["cue lights_server_open"]);
    expect(v(sim, "Night.lights")).toBe("server_open");
    expect(cues(advance(sim, 121)).filter((c) => c.startsWith("cue lights_"))).toEqual([]);
    expect(v(sim, "Night.alarm_on")).toBe(false);
    expect(v(sim, "Night.lights")).toBe("server_open");
  });

  it("🔄 reset_server_room forgives one again, clears the latch and re-arms the cutscene", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    fire(sim, "server_door_opened");
    fireAll(sim, "patch_rejected", "patch_rejected");
    expect(v(sim, "Night.alarm_on")).toBe(true);
    const r = fire(sim, "reset_server_room");
    expect(v(sim, "Night.wrong_combos")).toBe(0);
    expect(v(sim, "Night.alarm_on")).toBe(false);
    expect(v(sim, "Night.heart_opened")).toBe(false);
    expect(hostsSaid(r)).toEqual(['"🔄 Server room reset: the patch bay forgives one wrong combination again, the next door opening plays The Heart, and anyone thrown out of his heart may come back."']);
    // The house lights stay; the keypad is never touched; the heart's bulb goes idle (wave 20).
    expect(cues(r)).toEqual(["cue heart_idle"]);
    // One wrong patch is forgiven again; the next opening plays The Heart again
    // (the door is shut first: an opening of an open door is no opening).
    expect(lines(fire(sim, "patch_rejected"), "Trabolta")).toEqual(["Stop touching me."]);
    expect(v(sim, "Night.alarms")).toBe(1);
    fire(sim, "server_door_closed");
    expect(beats(fire(sim, "server_door_opened"))).toContain("The Heart");
  });
});

describe("Trapped in the Internet — the King gives the door code (wave 7; all night since wave 11)", () => {
  it("a checkmate gives the code any time before truth.txt: no practice games, from the doors to the Y2K hour", { timeout: SLOW }, () => {
    // Before Trabolta is even awake (the door terminal is awake all night).
    const early = boot();
    expect(v(early, "Night.step")).toBe(0);
    const e0 = fire(early, "chess won", "g1", null, "Terminal · Server Door");
    expect(learned(e0).map((e) => `${e.person}:${e.entry}`)).toEqual(["g1:The Door Code"]);
    // Mid-hunt, the same: the ♟ fallback too.
    const sim = boot();
    toTruth1(sim);
    const e1 = fire(sim, "beat_the_machine", "g1", null, "Clippy");
    expect(learned(e1).map((e) => e.entry)).toEqual(["The Door Code"]);
    expect(cues(e1).filter((c) => !c.startsWith("fire "))).toEqual([]); // ♟ fires chess_won; nothing else
    expect(hostsSaid(e1).some((h) => h.includes("practice"))).toBe(false);
    for (const f of FILES) expect(f.source, f.path).not.toMatch(/is practice only|only practising|PRACTICE/u);
  });

  it("a checkmate gives the winner the code, once — the door terminal, a host's ♟ and the director's cue alike", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    expect(v(sim, "Night.step")).toBe(14);
    const name = (id: string) => PROGRAMS.find(([g]) => g === id)![1];
    // The door terminal posts `chess won` for the program who mated him.
    const w = fire(sim, "chess won", "g1", null, "Terminal · Server Door");
    expect(learned(w).map((e) => `${e.person}:${e.entry}`)).toEqual(["g1:The Door Code"]);
    expect(sim.holdsCodex("g1", "The Door Code")).toBe(true);
    expect(hostsSaid(w)).toContain(`"♟ ${name("g1")} beat the King: the door code is in their Codex."`);
    expect(casts(w).filter((b) => b.cue.includes("The King lets the door code slip")).map(aud)).toEqual(['["g1"]']);
    expect(cues(w)).toEqual([]); // nothing drives the lock
    expect(texts(w).some((t) => t.includes(FACTS.door!.code))).toBe(false); // the code is only in the Codex card
    // A duplicate (a host's ♟ after the terminal's post, a late retry, a second win) changes nothing.
    const dup = fire(sim, "beat_the_machine", "g1", null, "Clippy");
    expect(learned(dup)).toEqual([]);
    expect(hostsSaid(dup)).toEqual([
      '"♟ Checkmate again. You already hold the door code: it is in your Codex."',
      `"♟ ${name("g1")} already has the door code: nothing changed."`,
    ]);
    expect(casts(dup).filter((b) => b.cue.includes("Checkmate again")).map(aud)).toEqual(['["g1"]']);
    // ♟ on another winner's card works the same.
    expect(learned(fire(sim, "beat_the_machine", "g4", null, "Clippy")).map((e) => e.entry)).toEqual(["The Door Code"]);
    // The director's cue names the winner; with nobody named it only reminds # hosts.
    expect(learned(fire(sim, "chess_won", "g5")).map((e) => e.entry)).toEqual(["The Door Code"]);
    const none = fire(sim, "chess_won");
    expect(learned(none)).toEqual([]);
    expect(hostsSaid(none)).toEqual(['"♟ A win with no winner named: press ♟ on the winner\'s card to give them the door code."']);
    for (const g of ["g2", "g3", "g6"]) expect(sim.holdsCodex(g, "The Door Code"), g).toBe(false);
    // Never Trabolta: he does not know the code.
    expect(sim.holdsCodex("Trabolta", "The Door Code")).toBe(false);
    // After an ending a win does nothing at all.
    fire(sim, "patch_combo_a");
    const late = fire(sim, "chess won", "g6");
    expect(learned(late)).toEqual([]);
    expect(casts(late)).toEqual([]);
  });

  it("the cue sheet: ♟ asks for the winner and gives the code; 👑 restores the King; the old Cold Lock cues are gone; the sign points at the notes and the King", () => {
    const m = boot().model;
    const cue = m.interactions.get("chess_won")!;
    expect(cue.label).toBe("♟ They beat the King: the door code (fallback)");
    expect(cue.description).toContain("The terminal outside the server-room door posts this itself");
    expect(cue.description).toContain("when the door terminal could not");
    expect(cue.sequence).toBe(false);
    expect(m.interactions.get("beat_the_machine")!.description).toContain("when the door terminal could not report it");
    expect(m.interactions.get("beat_the_machine")!.description).toContain("gives them the door code");
    const king = m.interactions.get("restore_the_king")!;
    expect(king.label.startsWith("👑")).toBe(true);
    expect(king.who).toBe("admin");
    expect(king.sequence).toBe(false);
    expect(m.interactions.get("reset_server_room")!.label).toBe("🔄 Server room: reset the patch-bay alarm");
    expect(m.interactions.get("server_door_opened")!.sequence).toBe(false);
    for (const gone of ["server_unlock", "rearm_server_room"]) expect(m.interactions.has(gone), gone).toBe(false);
    expect(m.codex.has("The Cold Lock")).toBe(false);
    const sign = m.codex.get("The Cold Door")!;
    expect(sign.secret).toBe(true);
    const words = sign.text.replace(/\s+/gu, " ");
    expect(words).toContain(FACTS.door!.clue!);
    expect(words).toContain("FOUR NOTES ARE HIDDEN IN THE HOUSE");
    expect(words).toContain("BEAT THE KING AT THE TERMINAL BY THIS DOOR");
    expect(words).not.toMatch(/year|met her|every hit|dumber|simulation|tent/iu);
    expect(sign.text).not.toContain(FACTS.door!.code);
    // No story file still describes the tent tablet or the chess phone posting a win.
    for (const f of FILES) expect(f.source, f.path).not.toMatch(/tent tablet posts|chess[- ]phone|fight him on the tent/iu);
    // No story file still describes the old model.
    for (const f of FILES) expect(f.source, f.path).not.toMatch(/Cold Lock|disarmed_until|server_unlocked|rearm_server_room|server_unlock\b|sleeps for ninety|state: unlocked/u);
    // The door is never alarmed now, not even in the sign's scrambled Jeeves copy (fragment 06 ↔ The Server Room).
    for (const [id, e] of m.codex) expect(e.text, id).not.toMatch(/door is alarmed|THIS DOOR IS ALARMED|Cold `\/alarmed\//iu);
    const frag = m.codex.get("Jeeves Fragment 06")!.text.replace(/\s+/gu, " ");
    for (const w of ["keypad", "four", "patch"]) expect(frag, w).toContain(w);
    // No lore leads to the year any more (Page 999's '97 is gone).
    expect(m.codex.get("The Margin Doodle")!.text).not.toMatch(/['’]97|1997/u);
  });

  it("every cleared program gets the riddle with the Y2K clock (the code itself only from a win or the majority)", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    for (const [g] of PROGRAMS) {
      expect(sim.holdsCodex(g, "The Cold Door"), g).toBe(true);
      expect(sim.holdsCodex(g, "The Door Code"), g).toBe(false);
    }
  });

  it("chess lost / drawn: a # hosts readout every time, all night; a gloat only once he is awake, at most every five minutes (losses and draws share it)", { timeout: SLOW }, () => {
    const sim = boot();
    // Before Trabolta is awake: the readout, never his voice.
    for (const name of ["chess lost", "chess drawn"]) {
      const e = fire(sim, name);
      expect(beats(e), name).toEqual([]);
      expect(hostsSaid(e), name).toHaveLength(1);
    }
    toTruth1(sim);
    const l = fire(sim, "chess lost");
    expect(beats(l)).toEqual(["Chess Lost"]);
    expect(lines(l, "Trabolta")).toEqual(["Checkmate. I have calculated every move you will ever make. Most of them are bad."]);
    expect(hostsSaid(l)).toEqual(['"♟ The King won a game. No door code."']);
    // Within five minutes: the readout, no gloat — a draw shares the window.
    const l2 = fire(sim, "chess lost");
    expect(beats(l2)).toEqual([]);
    expect(hostsSaid(l2)).toEqual(['"♟ The King won a game. No door code."']);
    const d = fire(sim, "chess_drawn");
    expect(beats(d)).toEqual([]);
    expect(hostsSaid(d)).toEqual(['"♟ A draw with the King. No door code."']);
    advance(sim, 300);
    const d2 = fire(sim, "chess drawn");
    expect(beats(d2)).toEqual(["Chess Drawn"]);
    expect(lines(d2, "Trabolta")).toEqual(["A draw. Nobody wins. Nobody gets anything. I find that restful."]);
    expect(beats(fire(sim, "chess lost"))).toEqual([]); // the draw restarted the window
    // Nothing changes but the words.
    expect(v(sim, "Night.alarms")).toBe(0);
    for (const [g] of PROGRAMS) expect(sim.holdsCodex(g, "The Door Code"), g).toBe(false);
    // From the final reveal the TV belongs to the finale: the readout only.
    toHunt2(sim);
    toBeans(sim);
    fireAll(sim, "trabolta_overshares", "y2k_clock");
    advance(sim, 300);
    fire(sim, "final_reveal");
    for (const name of ["chess lost", "chess drawn"]) {
      const late = fire(sim, name);
      expect(beats(late), name).toEqual([]);
      expect(hostsSaid(late), name).toHaveLength(1);
    }
  });
});

describe("Trapped in the Internet — the King's shared health (wave 11)", () => {
  it("is seeded at Power On: 15 of 15, armed until truth.txt or an ending", { timeout: SLOW }, () => {
    const sim = boot();
    expect(v(sim, "Night.king_hp")).toBe(15);
    expect(v(sim, "Night.king_hp_max")).toBe(15);
    expect(v(sim, "Night.king_armed")).toBe(1);
    toY2k(sim);
    expect(v(sim, "Night.king_armed")).toBe(1);
    fire(sim, "patch_combo_a");
    expect(v(sim, "Night.king_armed")).toBe(0);
  });

  it("a hit (the server already took the point off) tells # hosts; the house hears him stagger at 10 and at 5; the story never moves the bar", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    const hit = (hp: number) => {
      sim.setVar("Night.king_hp", String(hp)); // what the server journals before its signal
      return fire(sim, "king hit", "g1", { hp, max: 15 }, "Tablet · Tent");
    };
    const h = hit(14);
    expect(hostsSaid(h)).toEqual(['"⚔ Calculator hit the King in the simulation: 14/15"']);
    expect(v(sim, "Night.king_hp")).toBe(14);
    const ten = hit(10);
    expect(hostsSaid(ten)).toHaveLength(2);
    expect(casts(ten).filter((b) => b.scope === "everyone").map((b) => b.cue)).toEqual(['"♔ Somewhere in the simulation, the King staggers. His game at the cold door is slipping."']);
    expect(v(sim, "Night.king_hp")).toBe(10);
    expect(casts(hit(5)).filter((b) => b.scope === "everyone")).toHaveLength(1);
    expect(casts(hit(4)).filter((b) => b.scope === "everyone")).toHaveLength(0);
    // Fallen: everyone hears it, # hosts too; still nothing writes the bar.
    sim.setVar("Night.king_hp", "0");
    const f = fire(sim, "king fallen", "g4", null, "Tablet · Tent");
    expect(casts(f).filter((b) => b.scope === "everyone").map((b) => b.cue.startsWith('"!♔ The King has fallen'))).toEqual([true]);
    expect(hostsSaid(f).some((c) => c.includes("MS Paint felled the King in the simulation: 0/15"))).toBe(true);
    expect(v(sim, "Night.king_hp")).toBe(0);
    // No rule or beat ever sets the bar but Power On and 👑.
    const setsHp = SRC.split("\n").filter((l) => /set\s+Night\.king_hp\s*=/u.test(l)).map((l) => l.trim());
    expect(setsHp).toEqual(["set Night.king_hp = Night.king_hp_max", "set Night.king_hp = 15"]);
    // 👑 stands him up.
    const r = fire(sim, "restore_the_king");
    expect(v(sim, "Night.king_hp")).toBe(15);
    expect(hostsSaid(r)).toEqual(['"👑 The King is restored: 15/15. He stands at the door in the simulation again."']);
  });
});

describe("Trapped in the Internet — The Heart: the cold door opens (wave 7)", () => {
  it("before Trabolta is awake the door only tells # hosts", { timeout: SLOW }, () => {
    const sim = boot();
    fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time");
    expect(v(sim, "Trabolta.awake")).toBe(false);
    // The door sensor's own post (wave 20; the 🚪 button would also hand the door to the buttons).
    const e = fire(sim, "door_sensor_opened", null, { level: 30 }, "Terminal · Server Room");
    expect(beats(e)).toEqual([]);
    expect(lines(e, "Trabolta")).toEqual([]);
    expect(hostsSaid(e)).toEqual(['"🚪 The server-room door opened before Trabolta is awake. Nothing happens in the story."']);
    expect(v(sim, "Night.heart_opened")).toBe(false);
    expect(sim.isRevealedTo("The Server Room", "g1")).toBe(false);
  });

  it("once he is awake, before the Y2K hour: The Heart plays (however the door was unlocked), the bay is cold, nothing ends the night", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    const lights0 = v(sim, "Night.lights");
    const e = fire(sim, "server_door_opened");
    expect(beats(e)).toEqual(["The Heart"]);
    expect(v(sim, "Night.heart_opened")).toBe(true);
    for (const [g] of PROGRAMS) expect(sim.isRevealedTo("The Server Room", g), g).toBe(true);
    const words = lines(e, "Trabolta").join(" ");
    expect(words).toContain("So. Someone has found my heart.");
    expect(words).toContain("Close the door.");
    expect(words).not.toMatch(/stand down|end this|end it|ending/iu);
    // Wave 20: shut, he says the bay is cold (Heart Sealed).
    const sealed = lines(fire(sim, "server_door_closed"), "Trabolta").join(" ");
    expect(sealed).toContain("The bay is cold tonight.");
    // The server-room look goes up, but the house look stays (catch-up would replay the Y2K look under server_open).
    expect(has(cues(e), "lights_server_open")).toBe(true);
    expect(v(sim, "Night.lights")).toBe(lights0);
    // Nothing in the room ends the night yet: the patch bay refuses.
    fire(sim, "terminal opened", "g1", { at: "The Server Room" }, "Terminal · Server Room");
    expect(v(sim, "g1.at_the_heart")).toBe(true);
    for (const n of ["patch_combo_a", "patch_combo_b"]) {
      fire(sim, n);
      expect(v(sim, "Night.ended"), n).toBe(false);
    }
    // The Y2K hour's own first opening is not replayed: the latch holds all
    // night, and a later opening never plays The Heart again (wave 18b: no
    // Back To The Heart; wave 20: during his heart it only stops the talk).
    toHunt2(sim);
    toBeans(sim);
    fireAll(sim, "trabolta_overshares", "y2k_clock");
    advance(sim, 30);
    expect(beats(fire(sim, "server_door_opened"))).not.toContain("The Heart");
  });

  it("🔧 the crew's window: an opening inside it only tells # hosts and keeps The Heart for the programs; 🔄 clears it", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    expect(hostsSaid(fire(sim, "crew_through_the_door"))).toEqual(['"🔧 Crew window: for 2 minutes a server-room door opening only tells # hosts."']);
    advance(sim, 119);
    const crew = fire(sim, "server_door_opened");
    expect(beats(crew)).toEqual([]);
    expect(hostsSaid(crew)).toContain('"🚪 The server-room door opened inside the 🔧 crew window. Nothing happens in the story."');
    expect(v(sim, "Night.heart_opened")).toBe(false);
    expect(sim.isRevealedTo("The Server Room", "g1")).toBe(false);
    fire(sim, "server_door_closed"); // the crew shut it behind them
    advance(sim, 1);
    expect(beats(fire(sim, "server_door_opened"))).toEqual(["The Heart"]);
    // The server-room Antivirus' own button, on any program's card, is the same cue.
    expect(hostsSaid(fire(sim, "radio_crew_door", "g1", null, "CRA Agent Software"))).toHaveLength(1);
    expect(v(sim, "Night.crew_door_until")).toBe(v(sim, "Time.elapsed") + 120);
    fire(sim, "reset_server_room");
    expect(v(sim, "Night.crew_door_until")).toBe(0);
    fire(sim, "server_door_closed");
    expect(beats(fire(sim, "server_door_opened"))).toEqual(["The Heart"]); // re-armed, and no crew window
  });

  it("the room's own buttons: the server-room Antivirus' 🔌 💥 ❌ 🚪 and Adobe Acrobat's 🫘 fire the admin cues, live only when those would act", { timeout: SLOW }, () => {
    const m = fresh().model;
    const ROOM = ["Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software"];
    for (const [id, by] of [["radio_combo_a", ROOM], ["radio_combo_b", ROOM], ["radio_wrong_patch", ROOM], ["radio_door_opened", ROOM], ["radio_crew_door", ROOM], ["radio_beans", ["Adobe Acrobat"]]] as const) {
      const i = m.interactions.get(id)!;
      expect(i.who, id).toBe("performer");
      expect(i.by, id).toEqual(by);
      expect(i.while, id).toBeTruthy();
    }
    const sim = boot();
    toTruth1(sim);
    const live = (id: string) => sim.holds(sim.model.interactions.get(id)!.while!, null, null);
    expect(["radio_combo_a", "radio_combo_b", "radio_wrong_patch"].map(live)).toEqual([false, false, false]);
    expect(live("radio_door_opened")).toBe(true);
    expect(live("radio_beans")).toBe(false);
    expect(beats(fire(sim, "radio_door_opened", "g1", null, "CRA Agent Software"))).toEqual(["The Heart"]);
    toHunt2(sim);
    fireAll(sim, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings");
    expect(live("radio_beans")).toBe(true);
    expect(beats(fire(sim, "radio_beans", "g6", null, "Adobe Acrobat"))).toContain("Full Of Beans");
    expect(live("radio_beans")).toBe(false);
    fireAll(sim, "trabolta_overshares", "y2k_clock");
    expect(["radio_combo_a", "radio_combo_b", "radio_wrong_patch"].map(live)).toEqual([true, true, true]);
    fire(sim, "radio_wrong_patch", "g1", null, "CRA Agent Software");
    expect(v(sim, "Night.wrong_combos")).toBe(1);
    fire(sim, "radio_combo_a", "g1", null, "CRA Agent Software");
    expect(v(sim, "Night.ending")).toBe("disabled");
    expect(["radio_combo_a", "radio_door_opened", "radio_crew_door"].map(live)).toEqual([false, false, false]);
  });

  it("the room's own buttons: Adobe Acrobat's 🫘 answers only her booth; a director's quick-fire of 💥 lands once", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    for (const by of ["CRA Agent Software", "Clippy"]) expect(beats(fire(sim, "radio_beans", "g6", null, by)), by).toEqual([]);
    // ❌ from the director (no actor) is one wrong combination, never one per Antivirus.
    fire(sim, "radio_wrong_patch");
    expect(v(sim, "Night.wrong_combos")).toBe(1);
    expect(v(sim, "Night.ended")).toBe(false);
    // The director's quick-fire (no actor) is the cue itself.
    fire(sim, "radio_combo_b");
    expect(v(sim, "Night.ending")).toBe("destroyed");
  });

  it("integration: the patch-bay watch's 🔧 🚪 🔌 💥 ❌ press from every Antivirus booth (whoever the read-through stations there) and every host part, never Clippy's", { timeout: SLOW }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-trapped-radio-"));
    tmp.push(dir);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: SRC, joinBase: () => "http://localhost" });
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Calculator", passcode: CODES.event });
    expect(g.status).toBe(200);
    const id = g.json["id"] as string;
    const booth = async (character: string) => (await call(rt, "POST", "/api/prime/login", { character, passcode: CODES.prime })).json["token"] as string;
    const act = (token: string, name: string) => call(rt, "POST", "/api/prime/act", { name, guest: id }, { token });
    const RADIO = ["radio_crew_door", "radio_door_opened", "radio_combo_a", "radio_combo_b", "radio_wrong_patch"];
    // Wave 13: Task Manager, Adobe Acrobat and the Recycling Bin are host
    // parts (`admin: true`): a host booth keeps every `by:` button, as a
    // passcode admin always did, so only Clippy (a player, never a host
    // part) is refused here (wave 18: the door-only part is gone).
    const hostTokens = new Map<string, string>();
    for (const who of ["Adobe Acrobat", "Task Manager", "Recycling Bin"]) {
      const login = await call(rt, "POST", "/api/prime/login", { character: who, passcode: CODES.prime });
      expect(login.json["host"], who).toBe(true);
      hostTokens.set(who, login.json["token"] as string);
    }
    const refused = new Map<string, string>();
    for (const who of ["Clippy"]) {
      const t = await booth(who);
      refused.set(who, t);
      for (const name of RADIO) expect((await act(t, name)).status, `${name} by ${who}`).toBe(403);
      const view = (await call(rt, "GET", `/api/state?role=prime&token=${encodeURIComponent(t)}`, {})).json as unknown as PrimeView;
      // Wave 21 (C4): a player's booth never learns another part's button.
      for (const name of RADIO) expect(view.interactions.find((i) => i.id === name), `${name} on ${who}`).toBeUndefined();
    }
    expect(v(rt.liveSim!, "Night.wrong_combos") ?? 0).toBe(0);
    expect(v(rt.liveSim!, "Night.crew_door_until") ?? 0).toBe(0);
    for (const who of ANTIVIRUS) {
      const t = await booth(who);
      const view = (await call(rt, "GET", `/api/state?role=prime&token=${encodeURIComponent(t)}`, {})).json as unknown as PrimeView;
      for (const name of RADIO) expect(view.interactions.find((i) => i.id === name)?.actors, `${name} on ${who}`).toContain(who);
      const before = Number(v(rt.liveSim!, "Night.crew_door_until") ?? 0);
      expect((await act(t, "radio_crew_door")).status, who).toBe(200);
      expect(Number(v(rt.liveSim!, "Night.crew_door_until")), who).toBeGreaterThanOrEqual(before);
      expect(Number(v(rt.liveSim!, "Night.crew_door_until")), who).toBeGreaterThan(0);
      expect((await act(t, "radio_combo_a")).status, who).toBe(200); // pressed; its `while:` hook does nothing before the Y2K hour
    }
    expect(v(rt.liveSim!, "Night.ended") ?? false).toBe(false);
    // A host part presses them too (sign-off Q2): 🔧 lands (200, a crew window).
    for (const [who, t] of hostTokens) {
      const before = Number(v(rt.liveSim!, "Night.crew_door_until") ?? 0);
      expect((await act(t, "radio_crew_door")).status, who).toBe(200);
      expect(Number(v(rt.liveSim!, "Night.crew_door_until")), who).toBeGreaterThanOrEqual(before);
    }
    // The card face at the Y2K hour: a host part's card offers the patch-bay
    // watch's 🔧 / 🔌 / 💥 / ❌ on a program; Clippy's never does.
    rt.liveSim!.setVar("Night.step", "14");
    const card = async (t: string) => (await call(rt, "POST", "/api/prime/card", { guest: id }, { token: t })).json as unknown as { live: string[] };
    for (const [who, t] of hostTokens) {
      const face = await card(t);
      for (const name of ["radio_crew_door", "radio_combo_a", "radio_combo_b", "radio_wrong_patch"]) expect(face.live, `${name} on ${who}'s card`).toContain(name);
    }
    const clippy = await card(refused.get("Clippy")!);
    for (const name of RADIO) expect(clippy.live, `${name} on Clippy's card`).not.toContain(name);
    expect(v(rt.liveSim!, "Night.ended") ?? false).toBe(false);
  });

  it("🚪 on the server-room booth hides inside a 🔧 crew window (the opening would only tell # hosts)", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    const live = (id: string) => sim.holds(sim.model.interactions.get(id)!.while!, null, null);
    expect(live("radio_door_opened")).toBe(true);
    fire(sim, "radio_crew_door", "g1", null, "CRA Agent Software");
    expect(live("radio_door_opened")).toBe(false);
    advance(sim, 120);
    expect(live("radio_door_opened")).toBe(true);
  });

  it("wave 11: the buttons with no way back arm first, on the booth and the pass; the rest fire on one tap", () => {
    const sim = Sim.fromSources(SRC);
    const armed = [...sim.model.interactions.values()].filter((i) => i.arm).map((i) => i.id).sort();
    expect(armed).toEqual([
      "beat_the_machine", "brought_up_the_bag", "call_bingo", "defect_openly", "pickup_line_works", "plant_the_virus",
      "radio_beans", "radio_combo_a", "radio_combo_b", "radio_crew_door", "radio_door_closed", "radio_door_opened", "radio_wrong_patch",
      // w13 Q29: 🛡 captures on the spot, from any phase.
      "send to the internet",
    ]);
    // No admin cue carries it: the Director already arms every cue.
    for (const i of sim.model.interactions.values()) if (i.who === "admin") expect(i.arm, i.id).toBe(false);
    // It rides the booth's view (the patch-bay watch's 🔌 / 💥), never an unarmed button.
    const booth = primeView(sim, "CRA Agent Software").interactions ?? [];
    expect(booth.find((i) => i.id === "radio_combo_a")?.arm).toBe(true);
    expect(booth.find((i) => i.id === "send to the internet")?.arm).toBe(true);
    expect(booth.find((i) => i.id === "mark as reinstalled")?.arm).toBeUndefined();
  });

  it("integration: a booth presses only its own `by:` buttons — a Hosts verdict from Norton's is refused", { timeout: SLOW }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-trapped-by-"));
    tmp.push(dir);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: SRC, joinBase: () => "http://localhost" });
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Calculator", passcode: CODES.event });
    expect(g.status).toBe(200);
    const id = g.json["id"] as string;
    const booth = async (character: string) => (await call(rt, "POST", "/api/prime/login", { character, passcode: CODES.prime })).json["token"] as string;
    const norton = await booth("Norton Anti-Virus");
    const act = (token: string, name: string) => call(rt, "POST", "/api/prime/act", { name, guest: id }, { token });
    // ✅ is a ROLE hook (it ignores who pressed): only the Hosts' booths may.
    const refused = await act(norton, "accurate_q1");
    expect(refused.status).toBe(403);
    expect(String(refused.json["error"])).toMatch(/not your button/u);
    expect((await act(norton, "radio_combo_a")).status).toBe(200); // by: the room Antivirus — the patch-bay watch's
    expect((await act(norton, "send to the internet")).status).toBe(200); // by: Antivirus (wave 13 fstory)
    expect((await act(norton, "unmark_for_reinstallation")).status).toBe(200); // by: Hosts, Antivirus
    const clippy = await booth("Clippy");
    expect((await act(clippy, "accurate_q1")).status).toBe(200);
    // 🛡 / ✅ / 👁 are the Antivirus' (Clippy has no hook for them: they did nothing).
    for (const b of ["send to the internet", "mark as reinstalled", "accuse"]) expect((await act(clippy, b)).status, b).toBe(403);
    // Norton's booth no longer offers the Hosts' verdicts at all (wave 21:
    // a player's booth only learns its own buttons, C4).
    const view = (await call(rt, "GET", `/api/state?role=prime&token=${encodeURIComponent(norton)}`, {})).json as unknown as PrimeView;
    expect(view.interactions.find((i) => i.id === "accurate_q1")).toBeUndefined();
    expect(view.interactions.find((i) => i.id === "send to the internet")?.only).toBe(true);
    expect(view.interactions.find((i) => i.id === "vouch")?.only).toBeUndefined();
  });

  it("the first opening reveals the room to everyone first, then Trabolta speaks candidly in The Server Room (the server-room terminal)", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    expect(v(sim, "Night.scenario")).not.toBe(1);
    const e = fire(sim, "server_door_opened");
    expect(beats(e)).toEqual(["The Heart"]);
    expect(v(sim, "Night.heart_opened")).toBe(true);
    expect(hostsSaid(e)).toContain('"🚪 The server-room door opened. The Heart plays: he wants the door shut."');
    for (const [g] of PROGRAMS) expect(sim.isRevealedTo("The Server Room", g), g).toBe(true);
    // Revealed before a word is said.
    const firstLine = e.findIndex((x) => x.type === "dialogue");
    const reveal = e.findIndex((x) => x.type === "revealed");
    expect(reveal).toBeGreaterThanOrEqual(0);
    expect(reveal).toBeLessThan(firstLine);
    expect(has(cues(e), "lights_server_open")).toBe(true);
    expect(v(sim, "Night.lights")).toBe("server_open");
    expect(has(cues(e), "lights_alarm")).toBe(false);
    // Every line is Trabolta's, set in The Server Room: the room's chat and its terminal.
    const t = saidBy(e, "Trabolta");
    expect(t.length).toBeGreaterThanOrEqual(4);
    for (const x of t) expect(x.setting).toBe("The Server Room");
    const room = composeGuestMessages(sim, e).filter((mm) => mm.channel === "loc:The Server Room" && mm.from === "Trabolta");
    expect(room.length).toBe(t.length);
    const words = t.map((x) => x.text).join(" ");
    expect(words).toContain("So. Someone has found my heart.");
    expect(words).toContain("Close the door.");
    // Wave 20: the pass comes once the door is shut (Heart Sealed, the room's terminal too).
    const sealed = saidBy(fire(sim, "server_door_closed"), "Trabolta");
    for (const x of sealed) expect(x.setting).toBe("The Server Room");
    expect(sealed.map((x) => x.text).join(" ")).toContain("Show it your pass.");
    // Sandy only once the story has named her; never the code or a combination.
    expect(words).not.toContain("Sandy");
    expect(words).not.toContain(FACTS.door!.code);
    expect(words).not.toMatch(COMBO);
  });

  it("from the final reveal the door lights the server room but keeps the house look; never silences a latched alarm", { timeout: SLOW }, () => {
    const late = boot();
    toY2k(late);
    fire(late, "final_reveal");
    expect(v(late, "Night.lights")).toBe("final_reveal");
    const e = fire(late, "server_door_opened");
    expect(beats(e)).toEqual(["The Heart"]);
    expect(has(cues(e), "lights_server_open")).toBe(true);
    expect(v(late, "Night.lights")).toBe("final_reveal");
    // A latched patch-bay alarm (the contact failed, the director's 🚪 after the alarm): the siren keeps going.
    const loud = boot();
    toY2k(loud);
    fire(loud, "patch_rejected");
    fire(loud, "patch_rejected");
    expect(v(loud, "Night.alarm_on")).toBe(true);
    const during = fire(loud, "server_door_opened");
    expect(beats(during)).toEqual(["The Heart"]);
    expect(has(cues(during), "lights_server_open")).toBe(false);
    expect(v(loud, "Night.lights")).toBe("alarm");
  });

  it("names Sandy only on a night the story has named her (the overshare's scenario 1): Night.her (wave 20)", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    expect(v(sim, "Night.her")).toBe("her");
    sim.setVar("Night.scenario", "1");
    advance(sim, 1);
    expect(v(sim, "Night.her")).toBe("Sandy");
    // The house-wide Heart never names her; the per-program talk reads Night.her (core/test/trapped-heart.test.ts).
    expect(lines(fire(sim, "server_door_opened"), "Trabolta").join(" ")).not.toContain("Sandy");
  });

  it("latched: every later opening does nothing (wave 18b, D16); 🔄 re-arms The Heart; never after an ending", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    expect(beats(fire(sim, "server_door_opened"))).toEqual(["The Heart"]);
    for (const wait of [0, 60, 119, 121, 600]) {
      advance(sim, wait);
      const again = fire(sim, "server_door_opened");
      expect(beats(again), String(wait)).toEqual([]);
      expect(casts(again), String(wait)).toEqual([]);
      expect(hostsSaid(again), String(wait)).toEqual([]);
    }
    // 🔄 re-arms it: the next opening plays The Heart again (once shut).
    fire(sim, "reset_server_room");
    fire(sim, "server_door_closed");
    expect(beats(fire(sim, "server_door_opened"))).toEqual(["The Heart"]);
    fire(sim, "patch_combo_b");
    advance(sim, 121);
    const ended = fire(sim, "server_door_opened");
    expect(beats(ended)).toEqual([]);
    expect(casts(ended)).toEqual([]);
  });

  it("the server-room terminal puts a program at his heart: terminal_opened / terminal_closed, any ending clears it", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    fire(sim, "server_door_opened");
    expect(v(sim, "g1.at_the_heart")).toBe(false);
    // The terminal's own post: subject = the guest it pilots, `at` = its room (as provisioned).
    expect(diags(fire(sim, "terminal opened", "g1", { at: "The Server Room" }, "Terminal · Server Room"))).toEqual([]);
    expect(v(sim, "g1.at_the_heart")).toBe(true);
    for (const spelling of ["server-room", "the server room", "Server Room"]) {
      fire(sim, "terminal closed", "g4", { at: spelling });
      fire(sim, "terminal opened", "g4", { at: spelling });
      expect(v(sim, "g4.at_the_heart"), spelling).toBe(true);
    }
    // One server-room terminal: g4's line pushed g1 out (g1's close never came).
    expect(v(sim, "g1.at_the_heart")).toBe(false);
    expect(v(sim, "Night.heart_holder")).toBe(v(sim, "g4.name"));
    // Another terminal (or none) is not his heart; closing ends it.
    fire(sim, "terminal opened", "g5", { at: "The Desktop" });
    expect(v(sim, "g5.at_the_heart")).toBe(false);
    fire(sim, "terminal opened", "g5");
    expect(v(sim, "g5.at_the_heart")).toBe(false);
    fire(sim, "terminal closed", "g4", { at: "The Server Room" });
    expect(v(sim, "g4.at_the_heart")).toBe(false);
    // With no subject (a director's mis-fire) nothing happens.
    const none = fire(sim, "terminal opened", null, { at: "The Server Room" });
    expect(diags(none)).toEqual([]);
    expect(worldKeys(sim).filter((k) => k.startsWith("."))).toEqual([]);
    // Any ending sends everyone away from his heart, and no terminal brings them back.
    fire(sim, "terminal opened", "g6", { at: "The Server Room" });
    fire(sim, "patch_combo_a");
    for (const [g] of PROGRAMS) expect(v(sim, `${g}.at_the_heart`), g).toBe(false);
    fire(sim, "terminal opened", "g1", { at: "The Server Room" });
    expect(v(sim, "g1.at_the_heart")).toBe(false);
  });

  it("the director's 🚪 fallback plays the same scene when the contact fails", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    // Fired as an admin cue from Run (no subject, no actor): identical.
    expect(beats(sim.signal("server_door_opened"))).toEqual(["The Heart"]);
  });
});

describe("Trapped in the Internet — the cold door's digit notes (wave 11)", () => {
  const CLUES = FACTS.door!.clues!;
  const questSteps = (evs: SimEvent[]) => (evs.filter((e) => e.type === "quest") as Ev<"quest">[]).map((e) => `${e.action}: ${e.text}`);

  it("four secret coded notes, one digit each; titles and codes never carry a digit", () => {
    const m = fresh().model;
    expect(CLUES).toHaveLength(4);
    CLUES.forEach((c, i) => {
      const e = m.codex.get(c.id)!;
      expect(e.secret, c.id).toBe(true);
      expect(m.codexCodes.get(foldCode(c.code)), c.id).toBe(c.id);
      // The poster prints the title and the code: neither holds a digit.
      expect(`${e.title} ${c.code}`, c.id).not.toMatch(/[0-9]/u);
      expect(e.text.replace(/\s+/gu, " "), c.id).toContain(`DIGIT IS ${FACTS.door!.code[i]}`);
    });
  });

  it("three of four: the quest counts, no code; the fourth assembles The Door Code once and tells # hosts", { timeout: SLOW }, () => {
    const sim = boot();
    const steps: string[] = [];
    for (const c of CLUES.slice(0, 3)) {
      const e = sim.redeem("g1", c.code);
      expect(learned(e).map((x) => x.entry), c.id).toContain(c.id);
      expect(learned(e).map((x) => x.entry), c.id).not.toContain("The Door Code");
      steps.push(...questSteps(e));
    }
    expect(steps.map((t) => t.split(".")[0])).toEqual(["start: 1 of 4", "update: 2 of 4", "update: 3 of 4"]);
    expect(sim.questStatus("g1", "The Cold Door")).toBe("active");
    expect(sim.holdsCodex("g1", "The Cold Door")).toBe(true); // the sign's words, with the first note
    expect(sim.holdsCodex("g1", "The Door Code")).toBe(false);
    expect(v(sim, "g1.door_digits")).toBe(3);
    const last = sim.redeem("g1", CLUES[3]!.code);
    expect(learned(last).map((x) => x.entry)).toEqual([CLUES[3]!.id, "The Door Code"]);
    expect(questSteps(last)).toEqual(["complete: Four of four. The notes fit together: the door code is in your Codex."]);
    expect(hostsSaid(last)).toEqual(['"🔢 Calculator found all four digit notes: the door code is in their Codex."']);
    expect(sim.questStatus("g1", "The Cold Door")).toBe("done");
    // Scanning a note again changes nothing.
    const again = sim.redeem("g1", CLUES[0]!.code);
    expect(learned(again)).toEqual([]);
    expect(hostsSaid(again)).toEqual([]);
    // Nobody else gained a thing, and the code never appeared in words.
    expect(sim.holdsCodex("g4", "The Door Code")).toBe(false);
    expect(texts(last).some((t) => t.includes(FACTS.door!.code))).toBe(false);
  });

  it("however the notes arrive (a share from another program), in any order; a checkmate or majority holder gains nothing more, and an open quest closes on the code", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    for (const c of CLUES) sim.redeem("g4", c.code);
    // g1 gets them shared, last first.
    const evs: SimEvent[] = [];
    for (const c of [...CLUES].reverse()) evs.push(...sim.share("g4", "g1", c.id));
    expect(sim.holdsCodex("g1", "The Door Code")).toBe(true);
    expect(hostsSaid(evs).filter((h) => h.includes("found all four"))).toHaveLength(1);
    // A program who beat the King first: the notes start nothing and give nothing.
    fire(sim, "chess won", "g5", null, "Terminal · Server Door");
    const held: SimEvent[] = [];
    for (const c of CLUES) held.push(...sim.redeem("g5", c.code));
    expect(learned(held).map((x) => x.entry)).toEqual(CLUES.map((c) => c.id));
    expect(hostsSaid(held)).toEqual([]);
    expect(questSteps(held)).toEqual([]);
    // A program with two notes, then a checkmate: the quest closes on the code.
    sim.redeem("g6", CLUES[0]!.code);
    sim.redeem("g6", CLUES[2]!.code);
    expect(sim.questStatus("g6", "The Cold Door")).toBe("active");
    fire(sim, "chess won", "g6");
    expect(sim.questStatus("g6", "The Cold Door")).toBe("done");
    expect(learned(sim.redeem("g6", CLUES[1]!.code)).map((x) => x.entry)).toEqual([CLUES[1]!.id]);
  });

  it("after truth.txt or an ending the notes still count and the quest still steps, but four of four gives no code (like a late checkmate)", { timeout: SLOW }, () => {
    const late: Record<string, [string, string]> = {
      "Night.r3_closed": [
        "fail: 4 of 4. The verdict is in: the notes open nothing now.",
        '"🔢 Calculator found all four digit notes after truth.txt. The verdict is in: no door code. Nothing happens in the story."',
      ],
      "Night.ended": [
        "fail: 4 of 4. The night is over: the notes open nothing now.",
        '"🔢 Calculator found all four digit notes after the night ended: no door code. Nothing happens in the story."',
      ],
    };
    for (const flag of ["Night.r3_closed", "Night.ended"]) {
      const sim = boot();
      toTruth1(sim);
      for (const c of CLUES.slice(0, 3)) sim.redeem("g1", c.code);
      expect(v(sim, "g1.door_digits"), flag).toBe(3);
      sim.setVar(flag, "true");
      const last = sim.redeem("g1", CLUES[3]!.code);
      expect(learned(last).map((x) => x.entry), flag).toEqual([CLUES[3]!.id]);
      expect(sim.holdsCodex("g1", "The Door Code"), flag).toBe(false);
      expect(v(sim, "g1.door_digits"), flag).toBe(4);
      expect(questSteps(last), flag).toEqual([late[flag]![0]]);
      expect(sim.questStatus("g1", "The Cold Door"), flag).toBe("failed");
      expect(hostsSaid(last), flag).toEqual([late[flag]![1]]);
      expect(texts(last).some((t) => t.includes("door code is in your Codex")), flag).toBe(false);
    }
  });

  it("Trabolta refuses a digit note shared to him (secret), and no agent request ever carries one", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    sim.redeem("g1", CLUES[1]!.code);
    const t0 = v(sim, "Trabolta.truth");
    sim.share("g1", "Trabolta", CLUES[1]!.id);
    expect(sim.holdsCodex("Trabolta", CLUES[1]!.id)).toBe(false);
    expect(v(sim, "Trabolta.truth")).toBe(t0);
    expect(v(sim, "g1.delivered")).toBe(false);
  });
});

describe("Trapped in the Internet — ghosts and personas never block a majority (wave 11)", () => {
  it("a program marked gone and a director's persona count on neither side; the board shows who is present", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    expect(v(sim, "Night.present")).toBe(6);
    expect(sim.model.watch.some((l) => l.items.some((i) => i.path === "Night.present"))).toBe(true);
    // Excel (g2) chose to stay at the Truther Download; 3 of 6 is not more than half…
    for (const g of ["g1", "g4"]) sim.join(g, "Unlimited Power");
    expect(v(sim, "Kernel.majority_reached")).not.toBe(true);
    // …until a director's rehearsal persona stops counting: 3 of 5.
    sim.setVar("g6.persona", "true");
    expect(v(sim, "Night.present")).toBe(5);
    expect(v(sim, "Kernel.majority")).toBe("stay");
  });

  it("a program a director marked gone counts on neither side, even in the faction", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    sim.setVar("g5.gone", "true");
    sim.setVar("g6.gone", "true");
    expect(v(sim, "Night.present")).toBe(4);
    // The two ghosts join The Way Out: they don't count for it either.
    sim.join("g5", "The Way Out");
    sim.join("g6", "The Way Out");
    sim.join("g1", "The Way Out");
    expect(v(sim, "Kernel.majority_reached")).not.toBe(true); // OpenOffice + Calculator: 2 of 4
    sim.join("g4", "The Way Out");
    expect(v(sim, "Kernel.majority")).toBe("leave"); // 3 of 4
  });
});

describe("Trapped in the Internet — no door-only part (wave 18, Q26)", () => {
  it("Windows Defender is gone: the four Antivirus share the door, and any of them clears a late arrival", { timeout: SLOW }, () => {
    const sim = boot();
    const m = sim.model;
    expect(m.characters.has("Windows Defender")).toBe(false);
    for (const f of FILES) expect(f.source, f.path).not.toMatch(/Windows Defender|holds_the_door/u);
    expect(identityDefs(m).filter((d) => d.faction === "Antivirus").map((d) => d.name).sort()).toEqual([...ANTIVIRUS].sort());
    toTruth1(sim);
    const late = upload(sim, "g9", "Winamp Classic", "Password Manager");
    expect(v(sim, "g9.cleared")).toBe(true);
    expect(sim.locationOf("g9")).toBe("The Desktop");
    expect(beats(late)).toContain("Password Manager.Clearance");
    expect(replies(late).filter((r) => r.to === "Password Manager").map((r) => r.text)).toContain("✅ Cleared Winamp Classic.");
  });
});

describe("Trapped in the Internet — forced majorities (N-06)", () => {
  it("refused before the final round", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    const e = fire(sim, "force_majority_stay");
    expect(v(sim, "Kernel.majority_reached")).not.toBe(true);
    expect(has(hostsSaid(e), "No forced majority")).toBe(true);
  });

  it("a forced stay runs E1 exactly once, like the natural one", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    const evs: SimEvent[] = [];
    evs.push(...fire(sim, "force_majority_stay"));
    expect(v(sim, "Kernel.majority")).toBe("stay");
    expect(v(sim, "Night.phase")).toBe("majority");
    expect(v(sim, "Night.step")).toBe(15);
    expect(cues(evs).filter((c) => c.startsWith("door "))).toEqual([]); // the keypad is standalone
    expect(sim.holdsCodex("g2", "The Door Code")).toBe(true); // Excel is a member: the code is in his Truther Download
    expect(sim.questStatus("g2", "Recruit To Stay")).toBe("done");
    // Neither a second press, the other side, nor a real majority re-runs it.
    evs.push(...fire(sim, "force_majority_stay"));
    evs.push(...fire(sim, "force_majority_leave"));
    for (const g of ["g1", "g3", "g4", "g5", "g6"]) evs.push(...sim.join(g, "The Way Out"));
    expect(v(sim, "Kernel.majority")).toBe("stay");
    expect(beats(evs).filter((b) => b === "Majority Reached")).toHaveLength(1);
  });

  it("a majority during the patch-bay alarm leaves the siren and the alarm look alone (S1-05)", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    fireAll(sim, "patch_rejected", "patch_rejected");
    expect(v(sim, "Night.alarm_on")).toBe(true);
    const e = fire(sim, "force_majority_stay");
    expect(beats(e)).toContain("Majority Reached");
    // lights_server_open also turns the siren off (stagehand), so not while latched.
    expect(cues(e).filter((c) => c.includes("lights_server_open"))).toEqual([]);
    expect(v(sim, "Night.lights")).toBe("alarm");
  });

  it("a forced leave hands The Way Out's members the bundle", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    sim.join("g1", "The Way Out");
    fire(sim, "force_majority_leave");
    expect(v(sim, "Kernel.majority")).toBe("leave");
    expect(sim.questStatus("g3", "Recruit To Leave")).toBe("done");
    expect(sim.holdsCodex("g1", "The Legendary Fact")).toBe(true);
    expect(sim.holdsCodex("g5", "The Legendary Fact")).toBe(false);
  });
});

/** 📄 truth.txt, then ⚖ the verdict once the bobber has read it (T6-01). */
const truthTxt = (sim: Sim): SimEvent[] => [...fire(sim, "read_truth_txt"), ...fire(sim, "the_verdict")];

/** Judge all eight questions accurately (or one lie, or skip F2), through the bob. */
function toBobbing(sim: Sim, opts: { lie?: boolean; skipF2?: boolean; dmLie?: boolean; afterTruth1?: (sim: Sim) => void } = {}) {
  toTruth1(sim);
  opts.afterTruth1?.(sim);
  fire(sim, "accurate_q1", "g1", null, "Clippy");
  fire(sim, "accurate_q2", "g2", null, "Clippy");
  fire(sim, opts.lie ? "confident_q3" : "accurate_q3", "g3", null, "Clippy");
  toHunt2(sim);
  if (opts.dmLie) {
    // A 📝 filing in dm:Trabolta during hunt 2, judged a confident lie by the server (auto mode).
    fire(sim, "fact answered", "g4", { question: "H5", answer: "Clippy", confidence: 100, verdict: "lie", card: 1 });
  }
  fire(sim, "five_minute_warning");
  for (const [g] of PROGRAMS) fire(sim, "check_in_at_desktop", g, null, "Task Manager"); // nobody late, nobody marked
  fireAll(sim, "summons_closed", "truth_pong");
  for (const [g, q] of [["g4", "accurate_q1"], ["g5", "accurate_q2"], ["g6", "accurate_q3"]] as const) {
    fire(sim, "made_the_cup", g, null, "Clippy");
    fire(sim, q, g, null, "Clippy");
  }
  fireAll(sim, "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened", "trabolta_overshares", "y2k_clock");
  fire(sim, "ask_for_advice"); // too early: nothing
  advance(sim, 3600);
  expect(v(sim, "Night.phase")).toBe("final_reveal");
  fire(sim, "accurate_q1", "g1", null, "Clippy");
  const q3 = fire(sim, "accurate_q3", "g2", null, "Clippy");
  expect(casts(q3).some((b) => b.cue.includes("There are only two final facts") && b.scope === "channel(hosts)")).toBe(true);
  expect(replies(q3)).toEqual([]);
  if (opts.skipF2) fire(sim, "accurate_q1", "g3", null, "Clippy");
  else fire(sim, "accurate_q2", "g2", null, "Clippy");
  fire(sim, "bobbing_for_truth");
  expect(v(sim, "Night.phase")).toBe("bobbing");
  fire(sim, "ask_for_advice");
  expect(v(sim, "Night.phase")).toBe("bobbing"); // advice refused in the bob
  fire(sim, "failed_the_bob", "g5", null, "Adobe Acrobat");
  expect(sim.isCaptured("g5")).toBe(false); // marked (wave 4, lane E); the 🛡 captures
  expect(v(sim, "g5.marked")).toBe(true);
  expect(v(sim, "g5.marked_for")).toBe("failed the bob");
  fire(sim, "send to the internet", "g5", null, "Norton Anti-Virus");
  expect(sim.isCaptured("g5")).toBe(true);
  expect(v(sim, "g5.marked")).toBe(false);
  const bag = fire(sim, "brought_up_the_bag", "g4", null, "Clippy");
  expect(v(sim, "Night.bobber")).toBe("MS Paint");
  expect(sim.holdsCodex("g4", "The Truth File")).toBe(true);
  expect(beats(bag)).toContain("Final Assessment");
}

describe("Trapped in the Internet — the verdict", () => {
  it("all eight accurate → truth.txt → the Song Ending", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim);
    expect(["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"].map((q) => v(sim, `Kernel.${q}`))).toEqual(Array(8).fill("accurate"));
    const rt = truthTxt(sim);
    for (const e of ["The Truth File", "Randy Barkmore Sr", "Julie Horton-Norton"]) expect(sim.holdsCodex("g1", e), e).toBe(true);
    expect(v(sim, "Night.ending")).toBe("song");
    expect(v(sim, "Night.ended")).toBe(true);
    expect(beats(rt)).toContain("Song Ending");
    expect(lines(rt, "Sandy")).toContain(Q("F1").answer);
    expect(sim.isCaptured("g5")).toBe(false);
    expect(sim.questStatus("g1", "The Final Facts")).toBe("done");
    expect(texts(rt).filter((t) => /\bnull\b/u.test(t))).toEqual([]);
    // Trabolta DMs everyone for the line in this branch too (flavour: the
    // first correct one is read; the ending stands).
    const cards = widgets(rt).filter((w) => w.widget === "answer");
    expect(cards.map((w) => w.audience[0]).sort()).toEqual(PROGRAMS.map(([id]) => id).sort());
    expect(cards[0]!.params).toEqual({ thread: "Trabolta", question: "P1", max: "120", button: "Say it", moment: "big" }); // wave 18: a big card that asks
    expect(composeGuestMessages(sim, rt).find((m) => m.kind === "widget" && m.widget?.kind === "answer")?.channel).toBe("dm:Trabolta");
    const line = fire(sim, "answer answered", "g6", { question: "P1", text: "You're the one that I want", verdict: "accurate", card: 1 });
    expect(v(sim, "Night.line_by")).toBe("VLC");
    expect(lines(line, "Trabolta")).toEqual(["The house says YES. That is the line, VLC."]);
    expect(casts(line).some((b) => b.cue.includes("💘 VLC knew the line."))).toBe(true);
    expect(v(sim, "Night.ending")).toBe("song");
    const second = fire(sim, "answer answered", "g1", { question: "P1", text: "you are the one that i want", verdict: "accurate", card: 1 });
    expect(lines(second, "Trabolta")).toEqual(["VLC said it first, Calculator. But the house says yes: that is the line."]);
    expect(lines(fire(sim, "answer answered", "g2", { question: "P1", text: "hello", verdict: "lie", card: 1 }), "Trabolta")).toEqual(["The house says no. That is not the line."]);
  });

  it("⚖ publishes each question's truth to the screens and Trabolta says only the counts (wave 18b, Q6, O2)", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { lie: true, skipF2: true });
    fire(sim, "read_truth_txt");
    const vd = fire(sim, "the_verdict");
    expect(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"].map((t) => v(sim, `Kernel.${t}`))).toEqual(["accurate", "accurate", "lie", "accurate", "accurate", "accurate", "accurate", "none"]);
    expect(cues(vd).filter((c) => c.startsWith("fact_truth"))).toEqual(["fact_truth H1 accurate", "fact_truth H2 accurate", "fact_truth H3 lie", "fact_truth H4 accurate", "fact_truth H5 accurate", "fact_truth H6 accurate", "fact_truth F1 accurate", "fact_truth F2 none"]);
    expect([v(sim, "Kernel.v_true"), v(sim, "Kernel.v_lies"), v(sim, "Kernel.v_none")]).toEqual([6, 1, 1]);
    expect(lines(vd, "Trabolta").slice(0, 2)).toEqual(["I have compared every fact you gave me with truth.txt.", "6 true. 1 with a lie on record. 1 nobody answered."]);
    // No line of the verdict beat says a key answer or a program's name:
    // those are the TV's results block only (O2).
    const verdict = (vd.filter((e) => e.type === "dialogue") as Ev<"dialogue">[]).filter((e) => e.beat === "The Verdict").map((e) => e.text);
    expect(verdict).toHaveLength(2);
    const forms = BOOK.questions.flatMap((q) => q.forms).filter((f) => f.length >= 4);
    for (const t of verdict) {
      for (const f of forms) expect(t.toLowerCase(), f).not.toContain(f.toLowerCase());
      for (const [, name] of PROGRAMS) expect(t, name).not.toContain(name);
    }
  });

  it("a DM bluff makes its question's truth tile a lie, as it does the ending (wave 18b, A4)", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { dmLie: true });
    fire(sim, "read_truth_txt");
    const vd = fire(sim, "the_verdict");
    expect(cues(vd)).toContain("fact_truth H5 lie");
    expect(v(sim, "Night.phase")).toBe("grok_prom");
  });

  it("eight accurate answers that skip F2 → the Song Ending: an unanswered question is not a lie (U14)", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { skipF2: true });
    expect(v(sim, "Kernel.q8")).toBe("none");
    const rt = truthTxt(sim);
    expect(beats(rt)).toContain("Song Ending");
    expect(v(sim, "Night.ending")).toBe("song");
    expect(v(sim, "Night.ended")).toBe(true);
  });

  it("one lie → Grok Prom → the DM to everyone: a wrong line, the right one (the way out), a second right one", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { lie: true });
    const rt = truthTxt(sim);
    expect(v(sim, "Night.phase")).toBe("grok_prom");
    const cards = widgets(rt).filter((w) => w.widget === "answer");
    expect(cards.map((w) => w.audience[0]).sort()).toEqual(PROGRAMS.map(([id]) => id).sort());
    expect(cards[0]!.params["question"]).toBe("P1");
    const wrong = fire(sim, "answer answered", "g6", { question: "P1", text: "Hey girl", verdict: "lie", card: 1 });
    expect(lines(wrong, "Trabolta")).toEqual(["The house says no. That is not the line."]);
    expect(v(sim, "Night.ended")).not.toBe(true);
    const right = fire(sim, "answer answered", "g6", { question: "P1", text: "You're the one that I want", verdict: "accurate", card: 1 });
    expect(v(sim, "Night.ending")).toBe("song_pickup");
    expect(v(sim, "Night.line_by")).toBe("VLC");
    expect(beats(right)).toContain("Pickup Line");
    expect(beats(right)).toContain("Song Ending");
    expect(widgets(right).filter((w) => w.widget === "answer")).toEqual([]); // not dealt twice
    const second = fire(sim, "answer answered", "g1", { question: "P1", text: "You're the one that I want", verdict: "accurate", card: 1 });
    expect(lines(second, "Trabolta")).toEqual(["VLC said it first, Calculator. But the house says yes: that is the line."]);
    expect(v(sim, "Night.ending")).toBe("song_pickup");
  });

  it("one lie → Grok Prom → a performer's pickup line", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { lie: true });
    truthTxt(sim);
    expect(v(sim, "Night.phase")).toBe("grok_prom");
    const pl = fire(sim, "pickup_line_works", "g6", null, "Clippy");
    expect(v(sim, "Night.ending")).toBe("song_pickup");
    expect(v(sim, "Night.line_by")).toBe("VLC");
    expect(beats(pl)).toContain("Pickup Line");
    // The story tells him, in the giver's thread (he never judged it).
    expect(saidBy(pl, "Trabolta").filter((d) => aud(d) === '["g6"]').map((d) => d.text)).toEqual(["The house says YES. That is the line, VLC."]);
    expect(sim.isCaptured("g5")).toBe(false);
    expect(texts(pl).filter((t) => /\bnull\b/u.test(t))).toEqual([]);
  });

  it("one DM bluff (a 📝 filing judged a confident lie) fails the verdict for good", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { dmLie: true });
    expect(v(sim, "Kernel.q5")).toBe("lie"); // g5's accurate Q2 in round 2 never clears it
    expect(v(sim, "Kernel.lies_accepted")).toBe(1);
    truthTxt(sim);
    expect(v(sim, "Night.phase")).toBe("grok_prom");
    expect(v(sim, "Night.ended")).not.toBe(true);
  });

  it("Trabolta cannot accept the line himself: the house judges it (2026-10-19)", { timeout: SLOW }, () => {
    const sim = boot();
    expect(sim.model.interactions.has("the_line_works")).toBe(false); // no such power
    toBobbing(sim, { lie: true });
    truthTxt(sim);
    expect(v(sim, "Night.phase")).toBe("grok_prom");
    // An old worker's fire of the retired power does nothing.
    fire(sim, "the_line_works", "g1", null, "Trabolta");
    expect(v(sim, "Night.ended")).not.toBe(true);
    expect(v(sim, "Night.line_by")).toBe("none");
    // The card is the way out, and the story tells him who gave the line.
    const right = fire(sim, "answer answered", "g1", { question: "P1", text: "You're the one that I want", verdict: "accurate", card: 1 });
    expect(v(sim, "Night.ending")).toBe("song_pickup");
    expect(v(sim, "Night.line_by")).toBe("Calculator");
    expect(saidBy(right, "Trabolta").filter((d) => aud(d) === '["g1"]').map((d) => d.text)).toEqual(["The house says YES. That is the line, Calculator."]);
  });

  it("nobody has the line → the confession → the rave (captives stay)", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { lie: true });
    truthTxt(sim);
    const np = fire(sim, "no_pickup_line");
    expect(v(sim, "Night.ending")).toBe("rave");
    expect(beats(np)).toContain("Sad Confession");
    expect(cues(np).some((c) => c.includes("rave"))).toBe(true);
    expect(sim.isCaptured("g5")).toBe(true);
    fire(sim, "pickup_line_works", "g6", null, "Clippy");
    expect(v(sim, "Night.ending")).toBe("rave"); // nothing after the rave
  });
});

describe("Trapped in the Internet — the alternate advice ending", () => {
  it("advice poll → tally → they helped him", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { lie: true });
    truthTxt(sim);
    const aa = fire(sim, "ask_for_advice");
    expect(widgets(aa).some((w) => w.widget === "poll")).toBe(true);
    fire(sim, "poll answered", "g1", { choice: "Help him", index: 0 });
    fire(sim, "poll answered", "g2", { choice: "Thwart him", index: 1 });
    fire(sim, "poll answered", "g3", { choice: "Help him", index: 0 });
    fire(sim, "poll answered", "g3", { choice: "Help him", index: 0 }); // one vote each
    expect(v(sim, "Night.help_votes")).toBe(2);
    expect(v(sim, "Night.thwart_votes")).toBe(1);
    const t = fire(sim, "advice_tally");
    expect(v(sim, "Night.ending")).toBe("help");
    expect(beats(t)).toContain("Advice Helped");
    expect(sim.isCaptured("g5")).toBe(false);
    expect(v(sim, "Trabolta.love")).toBeGreaterThanOrEqual(60);
    expect(has(cues(t), "motorcycle")).toBe(true);
  });

  it("they thwarted him → everyone banished → the hand jive", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { lie: true });
    truthTxt(sim);
    fire(sim, "ask_for_advice");
    const visits = PROGRAMS.map(([g]) => v(sim, `${g}.internet_visits`));
    const th = fire(sim, "advice_thwarted");
    expect(v(sim, "Night.ending")).toBe("banished");
    expect(v(sim, "Night.ended")).not.toBe(true);
    for (const [g] of PROGRAMS) {
      expect(sim.isCaptured(g), g).toBe(true);
      expect(sim.holdsCodex(g, "The Hand Jive Exception"), g).toBe(true);
    }
    expect(replies(th).filter((r) => /banish/iu.test(r.text)).length >= 4 || texts(th).some((t) => /Antivirus/u.test(t))).toBe(true);
    // T2-01 / T2-02: no reinstallation, no visit, and the TV keeps the banish card.
    expect(beats(th)).not.toContain("Reinstallation");
    expect(cues(th).filter((c) => c === "cue tv_mirror" || c === "cue tablet_wizard")).toEqual([]);
    expect(v(sim, "Night.screen")).toBe("banish");
    expect(cues(th).filter((c) => c.startsWith("cue screens_")).at(-1)).toBe("cue screens_banish");
    expect(PROGRAMS.map(([g]) => v(sim, `${g}.internet_visits`))).toEqual(visits);
    expect(replies(th).filter((r) => r.to === "g1").map((r) => r.text)).toContain("⛈ Banished to the Internet, with everyone else. Gerald cannot help you tonight. Remember what Trabolta let slip.");
    // The duck frees nobody before the hand jive (g5 was in the Internet already, g1 banished).
    fire(sim, "the simulation completed", "g5");
    expect(sim.isCaptured("g5")).toBe(true);
    const duck = fire(sim, "the simulation completed", "g1");
    expect(sim.isCaptured("g1")).toBe(true);
    expect(replies(duck).map((r) => r.text)).toContain("Gerald cannot help you: everyone is banished. The way out is the hand jive, together.");
    // The games' second signal says nothing that reads as a release: no egg, no Golden Duck entry.
    const egg = fire(sim, "the golden duck", "g1");
    expect(replies(egg).filter((r) => r.to === "g1")).toEqual([]);
    expect(learned(egg)).toEqual([]);
    expect(sim.holdsCodex("g1", "The Golden Duck")).toBe(false);
    const hj = fire(sim, "the_hand_jive");
    expect(v(sim, "Night.ending")).toBe("hand_jive");
    expect(v(sim, "Night.ended")).toBe(true);
    for (const [g] of PROGRAMS) expect(sim.isCaptured(g), g).toBe(false);
    expect(sim.questStatus("g4", "Find The Exit")).toBe("done");
    const back = replies(hj).filter((r) => r.to === "g5").map((r) => r.text);
    expect(back).toContain("!!🕺 The hand jive broke his hold. You are out of the Internet.");
    expect(back.filter((t) => t.startsWith("Reinstallation complete"))).toEqual([]);
  });
});

// ───────────────────────── 5 · Trabolta's powers ─────────────────────────

const POWERS: Array<[string, Args | null]> = [
  ["snoop", { target: "g2" }],
  ["flicker_the_screens", null],
  ["play_on_the_screens", { clip: "hamster_dance" }],
  ["pop_up", { target: "g2", text: "hi" }],
  ["mint_truthcoin", { amount: 20 }],
  ["cut_the_lights", { room: "The Start Bar" }],
  ["summon_the_antivirus", { target: "g2" }],
  ["trabolta_announces", { text: "hi" }],
  ["assess", { target: "g2", score: 5 }],
  ["pardon_a_program", { target: "g2" }],
  ["turn_back_the_clock", null],
];

describe("Trapped in the Internet — Trabolta's powers", () => {
  it("every power refuses privately before its phase, and after it (§4.3)", { timeout: SLOW }, () => {
    const sim = boot();
    const score0 = sim.scoreOf("g1");
    for (const [p, a] of POWERS) {
      const e = fire(sim, p, "g1", a, "Trabolta");
      const t = saidBy(e, "Trabolta");
      expect(t.map((x) => x.text), p).toEqual(["That function is not available yet."]);
      expect(aud(t[0]!), p).toBe('["g1"]');
      expect(cues(e), p).toEqual([]);
      expect(casts(e), p).toEqual([]);
    }
    expect(v(sim, "g2.doubt")).toBe(0);
    expect(sim.scoreOf("g1")).toBe(score0);

    toTruth1(sim);
    toHunt2(sim);
    toBeans(sim);
    fireAll(sim, "trabolta_overshares", "y2k_clock");
    advance(sim, 3700);
    expect(v(sim, "Night.phase")).toBe("final_reveal");
    const later: Record<string, string> = { assess: "That function is not available yet." };
    for (const [p, a] of POWERS) {
      const t = lines(fire(sim, p, "g1", a, "Trabolta"), "Trabolta");
      expect(t, p).toEqual([later[p] ?? "I do not have the strength."]);
    }
  });

  it("each power's effect inside its window", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    expect(lines(fire(sim, "cut_the_lights", "g1", { room: "The Start Bar" }, "Trabolta"), "Trabolta")).toContain("That function is not available yet.");
    toHunt2(sim);

    const cl = fire(sim, "cut_the_lights", "g1", { room: "The Start Bar" }, "Trabolta");
    expect(cues(cl)).toContain("cue lights, room: The Start Bar, state: off");
    expect(casts(cl).some((b) => b.cue.includes("The lights in The Start Bar go out"))).toBe(true);
    expect(cues(advance(sim, 90))).toContain("cue lights, room: The Start Bar, state: on");
    const bad = fire(sim, "cut_the_lights", "g1", { room: "The Internet" }, "Trabolta");
    expect(cues(bad).some((c) => c.includes("state: off"))).toBe(false);
    expect(saidBy(bad, "Trabolta")).toHaveLength(1);
    // The Cloud is off the list (K-05): the outdoor steps + the tent path stay lit.
    const cloud = fire(sim, "cut_the_lights", "g1", { room: "The Cloud" }, "Trabolta");
    expect(cues(cloud).some((c) => c.includes("state: off"))).toBe(false);
    expect(lines(cloud, "Trabolta")).toEqual(["That function is not available in that room."]);
    expect(v(sim, "Night.lights_back_at")).toBe(0);

    const d0 = v(sim, "g5.doubt");
    fire(sim, "snoop", "g1", { target: "g5" }, "Trabolta");
    expect(v(sim, "g5.doubt")).toBe(d0 + 3);
    const sn = fire(sim, "snoop", "g1", { target: "Calculator" }, "Trabolta"); // a name, not an id
    const sn2 = fire(sim, "snoop", "g1", null, "Trabolta");
    expect(lines(sn, "Trabolta")).toContain("I cannot find that program.");
    expect(lines(sn2, "Trabolta")).toContain("I cannot find that program.");
    expect(worldKeys(sim).filter((k) => k.startsWith("event#") && k.includes("doubt"))).toEqual([]);

    const pu = fire(sim, "pop_up", "g1", { target: "g4", text: "Hello" }, "Trabolta");
    expect(casts(pu).length).toBeGreaterThanOrEqual(1);
    expect(casts(pu).every((b) => JSON.stringify(b.audience) === '["g4"]')).toBe(true);
    const s0 = sim.scoreOf("g1");
    fire(sim, "mint_truthcoin", "g1", { target: "g1", amount: 500 }, "Trabolta");
    expect(sim.scoreOf("g1")).toBe(s0 + 50);
    const sa = fire(sim, "summon_the_antivirus", "g1", { target: "g4" }, "Trabolta");
    expect(replies(sa).filter((r) => r.text.includes("MS Paint"))).toHaveLength(PATROL.length);
    expect(texts(fire(sim, "trabolta_announces", "g1", { text: "Hello house" }, "Trabolta")).length).toBeGreaterThan(0);

    fireAll(sim, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart");
    fire(sim, "send to the internet", "g5", null, "Norton Anti-Virus");
    const pd0 = fire(sim, "pardon_a_program", "g1", { target: "g6" }, "Trabolta");
    expect(sim.isCaptured("g6")).toBe(false);
    expect(texts(pd0).length).toBeGreaterThan(0);
    fire(sim, "pardon_a_program", "g1", { target: "g5" }, "Trabolta");
    expect(sim.isCaptured("g5")).toBe(false);

    fireAll(sim, "show_the_rankings", "printer_opened", "trabolta_overshares", "y2k_clock");
    const fl = fire(sim, "flicker_the_screens", "g1", null, "Trabolta");
    expect(has(cues(fl), "screens_flicker")).toBe(false);
    expect(saidBy(fl, "Trabolta")).toHaveLength(1);
    const s1 = sim.scoreOf("g1");
    fire(sim, "mint_truthcoin", "g1", { target: "g1", amount: 500 }, "Trabolta");
    expect(sim.scoreOf("g1")).toBe(s1 + 100); // desperate at Y2K
    const pu2 = fire(sim, "pop_up", "g1", { target: "g4", text: "Hello" }, "Trabolta");
    expect(casts(pu2).length).toBeGreaterThanOrEqual(1);
    expect(casts(pu2)[0]!.cue).toContain("d1sr3gard"); // garbled after the beans
    expect(diags(sim.log.since(0) as SimEvent[])).toEqual([]);
  });
});

// ───────────────────────── 5b · Trabolta's phase table (wave 12) ─────────────────────────

/** One phase card of trabolta.mind.md, after inheritance (CONTRACTS C4.1):
 *  a card leaves out stage / powers / tell to keep the card before it. */
interface PhaseCard {
  stage: string;
  powers: string[];
  tell: string[];
}
/** The mind file's `phases:` table, read line by line: the show writes every
 *  `stage:` / `powers:` / `tell:` on one line (a flow list), so no YAML
 *  library is needed. `_` keys (the stage cards) are never phases. */
function phaseTable(): Map<string, PhaseCard> {
  const text = readFileSync(join(scenarioDir(SHOW), "trabolta.mind.md"), "utf8");
  const from = text.indexOf("\nphases:\n");
  const table = text.slice(from, text.indexOf("\n---\n", from));
  const list = (s: string) => s.split(",").map((x) => x.trim().replace(/^"|"$/gu, "")).filter((x) => x !== "");
  const out = new Map<string, PhaseCard>();
  let prev: PhaseCard = { stage: "asleep", powers: [], tell: [] };
  let cur: PhaseCard | null = null;
  for (const line of table.split("\n")) {
    const head = /^ {2}([a-z_0-9]+):(?: >-)?$/u.exec(line);
    if (head !== null) {
      if (cur !== null) prev = cur;
      cur = head[1]!.startsWith("_") ? null : { ...prev, powers: [...prev.powers], tell: [...prev.tell] };
      if (cur !== null) out.set(head[1]!, cur);
      continue;
    }
    if (cur === null) continue;
    const stage = /^ {4}stage: (.+)$/u.exec(line);
    if (stage !== null) cur.stage = stage[1]!.trim();
    const many = /^ {4}(powers|tell): \[(.*)\]$/u.exec(line);
    if (many !== null) cur[many[1] as "powers" | "tell"] = list(many[2]!);
  }
  return out;
}
/** A power's refusals that mean "not in this phase" (cast/trabolta.loom).
 *  The Trust Chart's refusal counts too: the chart goes up with the phase and
 *  holds the terminals until START, so `play_on_the_screens` is never his to
 *  advertise there (a few minutes of the printer jam are given up). */
const OUT_OF_PHASE = ["That function is not available yet.", "I do not have the strength.", "The screens are not answering me.", "The screens are showing the Trust Chart.", "It is already over.", "The truth has been read. It is too late for that now."];

describe("Trapped in the Internet — Trabolta's phase table (wave 12)", () => {
  it("every phase the story sets has a card, and the cards keep the stage floors", () => {
    const set = new Set<string>();
    for (const f of FILES) for (const m of f.source.matchAll(/set Night\.phase = "([a-z_0-9]+)"/gu)) set.add(m[1]!);
    const table = phaseTable();
    expect([...table.keys()].sort()).toEqual([...set].sort());
    const floor: Record<string, string> = {
      arrivals: "asleep", desktop: "asleep", bingo: "asleep", bingo_results: "asleep",
      introduced: "formal", hunt_1: "formal", truth_1: "hungry",
      malware: "rattled", hunt_2: "rattled", summons: "rattled",
      truth_pong: "judge", trust_chart: "judge", beans: "unravelling", overshare: "unravelling",
      y2k: "desperate", majority: "desperate",
    };
    for (const [phase, card] of table) expect(card.stage, phase).toBe(floor[phase] ?? "last act");
  });

  it("each card's powers are exactly the ones the story lets through in that phase", { timeout: SLOW }, () => {
    const sim = boot();
    const table = phaseTable();
    const declared = new Set(POWERS.map(([p]) => p));
    for (const [phase, card] of table) for (const p of card.powers) expect(declared.has(p), `${phase}: ${p}`).toBe(true);
    const seen = new Map<string, string[]>();
    let n = 0;
    const probe = () => {
      const phase = v(sim, "Night.phase") as string;
      if (seen.has(phase)) return;
      const targets = ["g4", "g5", "g6"];
      const live: string[] = [];
      for (const [p, a] of POWERS) {
        const args = a === null ? null : { ...a, ...(a.target !== undefined ? { target: targets[n++ % targets.length]! } : {}) };
        const t = lines(fire(sim, p, "g1", args, "Trabolta"), "Trabolta");
        if (!t.some((x) => OUT_OF_PHASE.includes(x))) live.push(p);
      }
      seen.set(phase, live);
    };
    const step = (...names: string[]) => {
      for (const name of names) {
        fire(sim, name);
        probe();
      }
    };
    probe();
    step("call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth");
    readResults(sim);
    step("second_hunt_preview", "start_the_second_hunt");
    advance(sim, 120);
    sim.choose("g2", 0);
    sim.choose("g3", 0);
    step("five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened", "trabolta_overshares", "y2k_clock", "majority_reached", "final_reveal", "bobbing_for_truth");
    expect([...seen.keys()]).toEqual(["arrivals", "desktop", "bingo", "bingo_results", "introduced", "hunt_1", "truth_1", "malware", "hunt_2", "summons", "truth_pong", "trust_chart", "beans", "overshare", "y2k", "majority", "final_reveal", "bobbing"]);
    for (const [phase, live] of seen) expect(table.get(phase)!.powers, phase).toEqual(live);
    // After the verdict and in every ending nothing is his to fire.
    for (const [phase, card] of table) if (!seen.has(phase)) expect(card.powers, phase).toEqual([]);
  });

  it("each card's `tell` names only files he holds from the doors, never a secret one", () => {
    const sim = boot();
    const byTitle = new Map([...sim.model.codex].map(([id, e]) => [e.title, { ...e, id }]));
    for (const [phase, card] of phaseTable()) {
      for (const title of card.tell) {
        const e = byTitle.get(title);
        expect(e, `${phase}: ${title}`).toBeDefined();
        expect(e!.secret, `${phase}: ${title}`).not.toBe(true);
        expect(sim.holdsCodex("Trabolta", e!.id), `${phase}: ${title}`).toBe(true);
      }
    }
    // Her name stays out of what he may tell until the verdict has read
    // truth.txt to the house (the files that name her: The Sandy File, the
    // LiveJournal).
    const before = [...phaseTable()].slice(0, [...phaseTable().keys()].indexOf("grok_prom"));
    for (const [phase, card] of before) for (const title of card.tell) expect(byTitle.get(title)!.text, `${phase}: ${title}`).not.toMatch(/sandy/iu);
  });

  it("his own file no longer makes the catchphrase his signature: a dialog box once, then he talks", () => {
    const text = fresh().model.codex.get("Jean Trabolta")!.text;
    expect(text).not.toMatch(/signs his\s+messages/u);
    expect(text).toMatch(/first\s+message to a program/u);
  });

  it("no file he may tell in full quotes a stock phrase: the `tell` texts sit in every conversation", () => {
    // The persona's VOICE line lists the stock phrases it rations to first
    // contact; a `tell` entry's whole text is printed into P2 on every call,
    // so a quoted one there would plant the catchphrase in every reply.
    const persona = readFileSync(join(scenarioDir(SHOW), "trabolta.persona.md"), "utf8");
    const voice = /Your stock phrases\s*\(([^)]*)\)/u.exec(persona);
    expect(voice).not.toBeNull();
    const stock = [...voice![1]!.matchAll(/"([^"]+)"/gu)].map((m) => fold(m[1]!).replace(/[.!?]+$/u, ""));
    expect(stock).toEqual(["your request has been logged", "please wait", "this program has performed an operation"]);
    const byTitle = new Map([...fresh().model.codex.values()].map((e) => [e.title, e.text]));
    const told = new Set([...phaseTable().values()].flatMap((card) => card.tell));
    expect(told.size).toBeGreaterThan(0);
    for (const title of told) {
      const text = fold(byTitle.get(title) ?? "");
      for (const phrase of stock) expect(text, `${title}: "${phrase}"`).not.toContain(phrase);
    }
  });
});

// ───────────────────────── 6 · secrecy through the real event server ─────────────────────────

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

describe("Trapped in the Internet — 📝 File a fact (K-24 + N-05; wave 4 judging + the bottle)", () => {
  /** A filing as the server journals it: the judge's verdict rides the args
   *  (none when the key doesn't know the question — the live server 400s
   *  instead; a local rehearsal has no judge at all). */
  const file = (sim: Sim, g: string, question: string, answer: string, confidence = 100) => {
    const verdict = judgeAnswer(BOOK, question, answer, confidence);
    const key: Args = verdict === "accurate" ? { key_answer: Q(question).answer } : {};
    return fire(sim, "fact answered", g, { question, answer, confidence, card: 1, ...(verdict === null ? {} : { verdict }), ...key });
  };
  const facts = (evs: SimEvent[]) => widgets(evs).filter((w) => w.widget === "fact");
  const hosts = (sim: Sim, evs: SimEvent[]) => composeGuestMessages(sim, evs).filter((m) => m.channel === "room:hosts").map((m) => m.text);
  const trabolta = (evs: SimEvent[], g: string) => saidBy(evs, "Trabolta").filter((e) => e.audience.includes(g)).map((e) => e.text);
  const ledger = (sim: Sim) => new FactsWatch().view(sim, BOOK);
  const filing = (sim: Sim, q: string, g: string) => ledger(sim).questions.find((x) => x.id === q)!.filings.find((f) => f.person === g);

  it("deals the card in dm:Trabolta when each round's questions open, and on clearance after; a closed round's questions never come back", { timeout: SLOW }, () => {
    const sim = boot();
    const early = fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta");
    expect(facts(early)).toEqual([]); // no questions yet
    const hunt = fire(sim, "start_the_hunt");
    const dealt = facts(hunt);
    expect(dealt.map((w) => w.audience[0]).sort()).toEqual(PROGRAMS.map(([id]) => id).sort());
    expect(dealt[0]!.params["thread"]).toBe("Trabolta");
    expect(dealt[0]!.params["questions"]!.split("|").map((q) => q.trim().split(":")[0])).toEqual(["H1", "H2", "H3"]);
    const card = composeGuestMessages(sim, hunt).find((m) => m.kind === "widget" && m.widget?.kind === "fact");
    expect(card?.channel).toBe("dm:Trabolta");
    expect(trabolta(hunt, "g1").some((t) => t.includes("file it with me"))).toBe(true);
    // A late program gets the current round's card once an Antivirus clears them.
    const late = upload(sim, "g9", "Netscape Navigator");
    expect(facts(late).map((w) => w.audience)).toEqual([["g9"]]);
    const questions = (w: { params: Record<string, string> }) => (w.params["questions"] ?? "").split("|").map((q) => q.trim()).filter(Boolean);
    const ids = (w: { params: Record<string, string> }) => questions(w).map((q) => q.split(":")[0]);
    // A filing re-deals the card without the filed question.
    const f = file(sim, "g1", "H1", "Twelve");
    expect(ids(facts(f)[0]!)).toEqual(["H2", "H3"]);
    // The window shuts (two minutes): round one is closed for good, and
    // every card re-deals — nothing open → a closing card with no
    // questions supersedes the live one (the phone folds it to a note), once.
    fireAll(sim, "hunt_time_up", "first_moment_of_truth");
    const shut = advance(sim, 120);
    expect(v(sim, "Night.r1_closed")).toBe(true);
    expect(facts(shut).map((w) => w.audience[0]).sort()).toEqual([...PROGRAMS.map(([id]) => id), "g9"].sort());
    for (const w of facts(shut)) {
      expect(questions(w)).toEqual([]);
      expect(w.text).toBe("📝 The filing is closed");
      expect(w.params["thread"]).toBe("Trabolta");
    }
    readResults(sim);
    expect(facts(fire(sim, "second_hunt_preview"))).toEqual([]);
    // Round 2 deals a fresh card with only H4–H6: the closed questions are gone (decision 12).
    const r2 = facts(fire(sim, "start_the_second_hunt"));
    expect(r2.length).toBe(PROGRAMS.length + 1);
    const r2For = (g: string) => r2.find((w) => w.audience[0] === g)!;
    expect(ids(r2For("g2"))).toEqual(["H4", "H5", "H6"]);
    expect(ids(r2For("g1"))).toEqual(["H4", "H5", "H6"]);
    expect(questions(r2For("g2"))[0]).toMatch(/^H4: Round 2 Q1\. What extension/u);
    // A round-1 question no longer files late.
    const late2 = file(sim, "g1", "H3", "9 am");
    expect(hosts(sim, late2)).toEqual([]);
    expect(trabolta(late2, "g1")).toEqual(["That round is closed, Calculator. The question is gone."]);
    expect(v(sim, "g1.fact_h3")).not.toBe(true);
    expect(ids(facts(late2)[0]!)).toEqual(["H4", "H5", "H6"]);
    // The round-2 tally closes round two the same way; round 3's card is F1–F2 only.
    fire(sim, "truth_pong");
    fire(sim, "round_two_tally");
    expect(v(sim, "Night.r2_closed")).toBe(true);
    fireAll(sim, "trust_chart", "show_the_rankings", "printer_opened");
    const r3 = facts(fire(sim, "trabolta_overshares"));
    expect(ids(r3.find((w) => w.audience[0] === "g2")!)).toEqual(["F1", "F2"]);
  });

  it("auto mode: a filing is judged at once, the phone hears one reply for every verdict, a confident lie is sticky, and the credit (and the Kernel) lands at the round's settle for a program that made the cup", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    const s0 = v(sim, "g4.score");
    const filed = file(sim, "g4", "H5", "Clippy"); // an entity's name is a fine lie
    expect(hosts(sim, filed)).toEqual(["📝 MS Paint filed H5 (round 2 Q2): Clippy — certain. Judged lie."]);
    expect(facts(filed).map((w) => w.audience)).toEqual([["g4"]]); // re-dealt
    expect(v(sim, "g4.last_fact_q")).toBe("H5");
    expect(diags(filed)).toEqual([]);
    expect(v(sim, "Kernel.q5")).toBe("none"); // a round-2 filing reaches the Kernel at the tally, if the program made the cup
    expect(v(sim, "Kernel.lies_accepted")).toBe(0);
    expect(v(sim, "g4.score")).toBe(s0); // nothing until the tally
    expect(v(sim, "g4.truths_accepted")).toBe(0);
    expect(cues(filed)).toContain("fact_filed g4 H5 100 lie Clippy");
    expect(cues(filed)).toContain("fact_judged g4 H5 lie");
    expect(filing(sim, "H5", "g4")).toMatchObject({ name: "MS Paint", verdict: "lie", final: "lie", confidence: 100, answer: "Clippy" });
    // The same words in Trabolta's thread for an accurate filing (another program, another question).
    const ok = file(sim, "g5", "H4", "1978");
    expect(cues(ok)).toContain("fact_judged g5 H4 accurate");
    const norm = (xs: string[], name: string, q: string) => xs.map((t) => t.replace(name, "X").replace(q, "Q"));
    expect(norm(trabolta(filed, "g4"), "MS Paint", "round 2 Q2")).toEqual(norm(trabolta(ok, "g5"), "Winamp", "round 2 Q1"));
    expect(trabolta(ok, "g5")).toEqual(["Filed for round 2 Q1, Winamp. Your fact is in the record."]);
    file(sim, "g6", "H5", "hopelessly devoted");
    file(sim, "g1", "H6", "appendix z");
    expect(ledger(sim).questions.find((q) => q.id === "H5")!.tally).toEqual({ filed: 2, accurate: 1, lie: 1, uncertain: 0, consensus: false });
    // Settle at the tally: +50 for every accepted filing of a program that made the cup, the liar's DM word for word the truth-teller's.
    fire(sim, "truth_pong");
    for (const g of ["g4", "g5", "g6", "g1"]) fire(sim, "made_the_cup", g, null, "Clippy");
    const tally = fire(sim, "round_two_tally");
    expect(v(sim, "Night.collection_complete")).toBe(true);
    // Wave 18b (Q6, R3): the screens get the round's rows, and Trabolta
    // reads every filing aloud, question by question; the 61 % line stands.
    expect(cues(tally)).toEqual(expect.arrayContaining(["fact_read H4 H5 H6", "cue screens_tally"]));
    expect(v(sim, "Night.screen")).toBe("tally");
    const read = (tally.filter((e) => e.type === "dialogue") as Ev<"dialogue">[]).filter((e) => e.beat === "Round Two Tally" && e.speaker === "Trabolta").map((e) => e.text.trim());
    expect(read.slice(0, 2)).toEqual(["The second collection is closed. I will now tally the facts I have received.", "I will read every fact you filed. Only a cup counts."]);
    expect(read[2]).toMatch(/^Question four\. Winamp said 1978, /u);
    expect(read[3]).toMatch(/^Question five\. .*MS Paint said Clippy, /u);
    expect(read[4]).toMatch(/^Question six\. Calculator said appendix z, /u);
    expect(read[5]).toContain("sixty-one percent");
    expect(v(sim, "Kernel.q4")).toBe("accurate");
    expect(v(sim, "Kernel.q5")).toBe("lie"); // an accurate filing never clears a lie on the same question
    expect(v(sim, "Kernel.lies_accepted")).toBe(1);
    expect(v(sim, "Night.r2_closed")).toBe(true);
    expect(v(sim, "g4.score")).toBe(s0 + 50);
    expect(v(sim, "g4.truths_accepted")).toBe(1);
    expect(v(sim, "g5.truths_accepted")).toBe(1);
    expect(v(sim, "g6.truths_accepted")).toBe(1);
    const dmNorm = (g: string, name: string, q: string) => norm(trabolta(tally, g), name, q);
    expect(dmNorm("g4", "MS Paint", "round 2 Q2")).toEqual(dmNorm("g5", "Winamp", "round 2 Q1"));
    expect(trabolta(tally, "g4")).toEqual(["Your fact for round 2 Q2 is accepted, MS Paint. Trabolta thanks you. +50 Truthcoin."]);
    expect(hosts(sim, tally)).toContain("📝 MS Paint's filing for H5 is accepted.");
    expect(hosts(sim, tally)).toContain("📝 Winamp's filing for H4 is accepted.");
    // Trabolta's thread never carries the answer or the verdict.
    for (const x of [...trabolta(filed, "g4"), ...trabolta(tally, "g4")]) {
      expect(x).not.toContain("Clippy");
      expect(x).not.toMatch(/\blie\b|accurate/u);
    }
  });

  it("review mode: a filing is a proposal in # hosts until a host confirms it (Run names the question), or the round's settle takes the proposal", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    sim.setVar("Night.judge_mode", "review");
    const filed = file(sim, "g4", "H5", "Clippy");
    expect(hosts(sim, filed)).toEqual(["📝 MS Paint filed H5 (round 2 Q2): Clippy — certain. Proposed: lie. Confirm on Run → Mind → Judging (their card's 📝 judges their latest filing only)."]);
    expect(trabolta(filed, "g4")).toEqual(["Filed for round 2 Q2, MS Paint. Your fact is in the record."]);
    expect(v(sim, "g4.fact_v5")).toBe("pending");
    expect(v(sim, "g4.fact_j5")).toBe("lie");
    expect(v(sim, "Kernel.q5")).toBe("none");
    expect(v(sim, "Kernel.lies_accepted")).toBe(0);
    expect(filing(sim, "H5", "g4")).toMatchObject({ verdict: "lie", final: null });
    expect(ledger(sim).mode).toBe("review");
    expect(ledger(sim).pending).toBe(1);
    // A press for a question with no open filing is refused in # hosts.
    expect(hosts(sim, fire(sim, "fact_lie", "g4", { question: "H4" }, "Clippy"))).toEqual(["📝 MS Paint has no open filing for H4."]);
    expect(hosts(sim, fire(sim, "fact_accurate", "g5", null, "Clippy"))).toEqual(["📝 Winamp has no filing to judge."]);
    // The Run card names the question; the booth button takes the latest filing. Nothing reaches the phone.
    const lie = fire(sim, "fact_lie", "g4", { question: "H5" }, "Clippy");
    expect(hosts(sim, lie)).toEqual(["📝 MS Paint's H5 is judged a confident lie."]);
    expect(replies(lie)).toEqual([]);
    expect(trabolta(lie, "g4")).toEqual([]);
    expect(v(sim, "g4.fact_v5")).toBe("lie");
    expect(v(sim, "Kernel.q5")).toBe("none"); // round 2 reaches the Kernel at the tally (Truth Pong decides)
    expect(v(sim, "Kernel.lies_accepted")).toBe(0);
    expect(filing(sim, "H5", "g4")).toMatchObject({ verdict: "lie", final: "lie" });
    expect(ledger(sim).pending).toBe(0);
    // A second press re-counts nothing.
    expect(hosts(sim, fire(sim, "fact_lie", "g4", null, "Clippy"))).toEqual(["📝 MS Paint's H5 is already judged a confident lie."]);
    // An override before the tally: the host calls it accurate after all.
    expect(hosts(sim, fire(sim, "fact_accurate", "g4", null, "Clippy"))).toEqual(["📝 MS Paint's H5 is judged accurate."]);
    expect(v(sim, "g4.fact_v5")).toBe("accurate");
    expect(v(sim, "Kernel.q5")).toBe("none");
    // Proposals still pending settle by themselves at the tally: accurate credited, a guess marked.
    file(sim, "g5", "H4", "1978");
    file(sim, "g6", "H6", "Appendix Z");
    file(sim, "g1", "H4", "extension nine", 30);
    expect(ledger(sim).pending).toBe(3);
    expect(v(sim, "Kernel.q4")).toBe("none");
    fire(sim, "truth_pong");
    for (const g of ["g4", "g5", "g6"]) fire(sim, "made_the_cup", g, null, "Clippy");
    const s5 = v(sim, "g5.score");
    const tally = fire(sim, "round_two_tally");
    expect(v(sim, "Night.collection_complete")).toBe(true); // pending proposals count
    expect(v(sim, "Kernel.q4")).toBe("accurate");
    expect(v(sim, "Kernel.q5")).toBe("accurate");
    expect(v(sim, "Kernel.q6")).toBe("accurate");
    expect(v(sim, "Kernel.lies_accepted")).toBe(0);
    expect(v(sim, "g5.fact_v4")).toBe("accurate");
    expect(v(sim, "g5.score")).toBe(s5 + 50);
    expect(trabolta(tally, "g5")).toEqual(["Your fact for round 2 Q1 is accepted, Winamp. Trabolta thanks you. +50 Truthcoin."]);
    expect(v(sim, "g1.fact_v4")).toBe("marked");
    expect(v(sim, "g1.marked")).toBe(true);
    expect(v(sim, "g1.marked_for")).toBe("filed a guess for round 2 Q1");
    expect(casts(tally).some((b) => b.cue.includes("🤷 Calculator filed a guess for round 2 Q1. That is a symptom of corruption."))).toBe(true);
    expect(cues(tally)).toContain("fact_judged g1 H4 marked");
    expect(ledger(sim).pending).toBe(0);
    expect(filing(sim, "H4", "g1")).toMatchObject({ verdict: "uncertain", final: "marked" });
    expect(ledger(sim).questions.find((q) => q.id === "H4")!.tally).toEqual({ filed: 2, accurate: 1, lie: 0, uncertain: 1, consensus: false });
    // A settled guess has no open filing to re-judge.
    expect(hosts(sim, fire(sim, "fact_accurate", "g1", { question: "H4" }, "Clippy"))).toEqual(["📝 Calculator has no open filing for H4."]);
    // An override after the tally reaches the Kernel at once; correcting
    // the same filing takes its lie back (B11).
    expect(hosts(sim, fire(sim, "fact_lie", "g4", { question: "H5" }, "Clippy"))).toEqual(["📝 MS Paint's H5 is judged a confident lie."]);
    expect(v(sim, "Kernel.q5")).toBe("lie");
    expect(v(sim, "Kernel.lies_accepted")).toBe(1);
    fire(sim, "fact_accurate", "g4", { question: "H5" }, "Clippy");
    expect(v(sim, "Kernel.q5")).toBe("accurate");
    expect(v(sim, "Kernel.lies_accepted")).toBe(0);
  });

  it("Truth Pong gates round 2: a program that filed and then missed the cup is not counted (no +50, told so); with no cup at all the collection fails", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    file(sim, "g5", "H4", "1978");
    file(sim, "g4", "H5", "Clippy");
    file(sim, "g6", "H6", "Appendix Z");
    fire(sim, "truth_pong");
    fire(sim, "missed_the_cup", "g5", null, "Clippy"); // filed accurately, then missed: marked
    expect(v(sim, "g5.marked")).toBe(true);
    const s5 = v(sim, "g5.score");
    const s4 = v(sim, "g4.score");
    const tally = fire(sim, "round_two_tally");
    // Nobody sank a cup: no round-2 filing counts, Trabolta stays without the information.
    expect(v(sim, "Night.collection_complete")).toBe(false);
    expect(v(sim, "Kernel.q4")).toBe("none");
    expect(v(sim, "Kernel.q5")).toBe("none");
    expect(v(sim, "Kernel.lies_accepted")).toBe(0);
    expect(v(sim, "g5.score")).toBe(s5);
    expect(v(sim, "g5.truths_accepted")).toBe(0);
    expect(v(sim, "g4.score")).toBe(s4);
    expect(v(sim, "g4.truths_accepted")).toBe(0);
    expect(v(sim, "g5.fact_v4")).toBe("marked");
    expect(hosts(sim, tally)).toContain("📝 Winamp's filing for H4 is not counted: no cup.");
    expect(hosts(sim, tally)).toContain("📝 MS Paint's filing for H5 is not counted: no cup.");
    expect(hosts(sim, tally).some((h) => h.includes("is accepted"))).toBe(false);
    expect(trabolta(tally, "g5")).toEqual(["Your fact for round 2 Q1 was not counted, Winamp. You did not make the cup."]);
    expect(cues(tally)).toContain("fact_judged g5 H4 marked");
    expect(filing(sim, "H4", "g5")).toMatchObject({ verdict: "accurate", final: "marked" });
    expect(saidBy(tally, "Trabolta").some((e) => e.text.includes("I remain without the information"))).toBe(true);
  });

  it("Truth Pong gates round 2: a cup counts that program's filings; a cupped program marked before the tally is not counted", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    file(sim, "g5", "H4", "1978");
    file(sim, "g6", "H5", "hopelessly devoted");
    file(sim, "g1", "H6", "appendix z");
    file(sim, "g4", "H6", "appendix z");
    fire(sim, "truth_pong");
    for (const g of ["g5", "g6", "g1", "g4"]) fire(sim, "made_the_cup", g, null, "Clippy");
    fire(sim, "mark_for_reinstallation", "g4", { reason: "a host's call" }, "Clippy");
    const s4 = v(sim, "g4.score");
    const tally = fire(sim, "round_two_tally");
    expect(v(sim, "Night.collection_complete")).toBe(true);
    for (const g of ["g5", "g6", "g1"]) expect(v(sim, `${g}.truths_accepted`), g).toBe(1);
    expect(v(sim, "g4.truths_accepted")).toBe(0);
    expect(v(sim, "g4.score")).toBe(s4);
    expect(hosts(sim, tally)).toContain("📝 MS Paint's filing for H6 is not counted: no cup.");
  });

  it("refuses a bad filing: no verdict (a local rehearsal), an unknown question, a confidence of 0, a repeat question, a marked or corrupted program; two in a row are both recorded", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    const nojudge = fire(sim, "fact answered", "g1", { question: "H2", answer: "Mister Pickles", confidence: 100, card: 1 });
    expect(hosts(sim, nojudge)).toEqual(["📝 Calculator's filing for H2 could not be judged (no answer key for it on this server). Not recorded."]);
    expect(trabolta(nojudge, "g1")).toEqual(["I cannot read that filing right now, Calculator. Try again in a moment."]);
    expect(v(sim, "g1.fact_h2")).not.toBe(true);
    expect(facts(nojudge).length).toBe(1); // re-dealt so they can try again
    const unknown = file(sim, "g1", "Q9", "x"); // the live server 400s this; the story knows no such question
    expect(hosts(sim, unknown)).toEqual([]);
    expect(trabolta(unknown, "g1")).toEqual(["Pick one of tonight's questions, Calculator, and tell me how sure you are."]);
    const zero = file(sim, "g1", "H2", "Mister Pickles", 0);
    expect(hosts(sim, zero)).toEqual([]);
    expect(trabolta(zero, "g1")).toEqual(["Pick one of tonight's questions, Calculator, and tell me how sure you are."]);
    expect(trabolta(file(sim, "g1", "H2", "Mister Pickles", 101), "g1")).toEqual(["Pick one of tonight's questions, Calculator, and tell me how sure you are."]);
    file(sim, "g1", "H2", "Mister Pickles");
    const repeat = file(sim, "g1", "H2", "Pickles");
    expect(hosts(sim, repeat)).toEqual([]);
    expect(trabolta(repeat, "g1")).toEqual(["You already filed a fact for that question, Calculator. It stands."]);
    expect(v(sim, "g1.fact_a2")).toBe("Mister Pickles");
    // No lock: a second question files straight after the first (both recorded).
    const second = file(sim, "g1", "H3", "9 am");
    expect(hosts(sim, second)).toEqual(["📝 Calculator filed H3 (round 1 Q3): 9 am — certain. Judged accurate."]);
    expect(v(sim, "g1.fact_a3")).toBe("9 am");
    expect(v(sim, "g1.fact_label")).toBe("round 1 Q3");
    expect(v(sim, "g1.last_fact_q")).toBe("H3");
    expect(ledger(sim).questions.filter((q) => q.filings.some((f) => f.person === "g1")).map((q) => q.id)).toEqual(["H2", "H3"]);
    // A marked program files like anyone (wave 18, Q30); a corrupted one cannot.
    fire(sim, "mark_for_reinstallation", "g5", { reason: "a test" });
    const mk = file(sim, "g5", "H2", "Eleven years");
    expect(trabolta(mk, "g5").some((t) => /marked for reinstallation/u.test(t))).toBe(false);
    expect(v(sim, "g5.fact_h2")).toBe(true);
    fire(sim, "send to the internet", "g5", null, "Norton Anti-Virus");
    const cap = file(sim, "g5", "H1", "Eleven years");
    expect(trabolta(cap, "g5")).toEqual(["Programs in the Internet cannot file facts. Come back reinstalled."]);
    expect(v(sim, "g5.fact_h1")).not.toBe(true);
  });

  it("refuses a question whose round hasn't opened; a closed round's question is gone", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    const early = file(sim, "g2", "F2", "Grok");
    expect(hosts(sim, early)).toEqual([]);
    expect(trabolta(early, "g2").some((t) => t.includes("not open yet"))).toBe(true);
    expect(v(sim, "g2.fact_f2")).not.toBe(true);
    expect(v(sim, "g2.fact_v8")).toBe("none");
    toHunt2(sim);
    expect(hosts(sim, file(sim, "g2", "H6", "Appendix Z"))).toEqual(["📝 Microsoft Excel filed H6 (round 2 Q3): Appendix Z — certain. Judged accurate."]);
    const late = file(sim, "g2", "H1", "Eleven years");
    expect(hosts(sim, late)).toEqual([]);
    expect(trabolta(late, "g2")).toEqual(["That round is closed, Microsoft Excel. The question is gone."]);
  });

  it("once the night has ended the record is closed: no filing, no card, no judging", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    sim.setVar("Night.judge_mode", "review");
    file(sim, "g4", "H5", "Clippy"); // still pending when the night ends
    sim.setVar("Night.ended", "true");
    const s0 = v(sim, "g4.score");
    const late = file(sim, "g5", "H4", "1978");
    expect(hosts(sim, late)).toEqual([]);
    expect(facts(late)).toEqual([]);
    expect(trabolta(late, "g5").some((t) => t.includes("record is closed"))).toBe(true);
    expect(v(sim, "g5.fact_v4")).toBe("none");
    const judged = fire(sim, "fact_lie", "g4", null, "Clippy");
    expect(hosts(sim, judged)).toEqual(["📝 The night is over — the record is closed."]);
    expect(v(sim, "Kernel.lies_accepted")).toBe(0);
    expect(v(sim, "g4.score")).toBe(s0);
    expect(v(sim, "g4.fact_v5")).toBe("pending");
    expect(hosts(sim, fire(sim, "fact_accurate", "g4", null, "Clippy"))).toEqual(["📝 The night is over — the record is closed."]);
    expect(v(sim, "Kernel.q5")).not.toBe("accurate");
  });

  it("the bottle: after all three results, about five spins, Truth asks Trabolta's question, Dare / a refusal marks", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    const early = fire(sim, "spin_the_bottle");
    expect(beats(early)).toEqual([]);
    expect(hosts(sim, early)).toEqual(["🍾 Truth or Dare comes after all three results: read them first (📋)."]);
    advance(sim, 120); // the window shuts
    const res = fire(sim, "read_the_results");
    expect(beats(res)).toContain("Question Results");
    expect(lines(res, "Trabolta").some((t) => t.startsWith("Question 1. Nobody filed an answer."))).toBe(true);
    expect(lines(res, "Clippy")).toContain("Question 2, coming up!");
    // Between the questions the bottle waits (wave 18b, R21).
    expect(hosts(sim, fire(sim, "spin_the_bottle"))).toEqual(["🍾 Truth or Dare comes after all three results: read them first (📋)."]);
    fire(sim, "read_the_results");
    const third = fire(sim, "read_the_results");
    expect(lines(third, "Clippy")).toContain("That's all three! And before the next hunt: TRUTH OR DARE. I have a bottle.");
    expect(v(sim, "Night.bottle_q")).toBe(3);
    expect(hosts(sim, fire(sim, "read_the_results"))).toEqual(["📋 All three results are read. Next: 🍾 Truth or Dare, then 📺 Preview hunt 2."]);
    // The spin asks the server for a random cleared program.
    const spin = fire(sim, "spin_the_bottle");
    expect(v(sim, "Night.bottle_open")).toBe(true);
    expect(v(sim, "Night.bottle_round")).toBe(1);
    expect(has(cues(spin), "screens_truth_or_dare")).toBe(true);
    const pick = cues(spin).find((c) => c.startsWith("pick "))!;
    expect(pick).toMatch(/^pick bottle_landed from \[.*\] else bottle_empty$/u);
    expect(pick.slice(pick.indexOf("[") + 1, pick.indexOf("]")).split(",").map((s) => s.trim()).sort()).toEqual(PROGRAMS.map(([id]) => id).sort());
    // The server's pick lands as `bottle_landed` (driven directly here: the Sim has no random).
    const land = fire(sim, "bottle_landed", "g2");
    expect(beats(land)).toContain("Bottle Landed");
    expect(lines(land, "Trabolta")).toContain("Microsoft Excel. Truth or dare?");
    expect(v(sim, "Night.bottle_pick")).toBe("Microsoft Excel");
    expect(v(sim, "Night.bottle_picks")).toBe(1);
    const poll = widgets(land).find((w) => w.widget === "poll")!;
    expect(poll.audience).toEqual(["g2"]);
    expect(poll.params).toEqual({ thread: "Trabolta", options: "Truth | Dare", moment: "big" }); // wave 18: a big card that asks
    expect(composeGuestMessages(sim, land).find((m) => m.kind === "widget" && m.widget?.kind === "poll")?.channel).toBe("dm:Trabolta");
    // Open bottle: no second spin, no preview (D15).
    expect(hosts(sim, fire(sim, "spin_the_bottle"))).toEqual(["🍾 The bottle is still open: 🗣 Answered or 🙅 Refused first."]);
    const held = fire(sim, "second_hunt_preview");
    expect(hosts(sim, held)).toEqual(["📺 The bottle is still open: 🗣 / 🙅 first."]);
    expect(v(sim, "Night.step")).toBe(6);
    // Dare → marked for reinstallation.
    const dare = fire(sim, "poll answered", "g2", { index: 1, card: 1 });
    expect(casts(dare).some((b) => b.cue.includes("🎩 Microsoft Excel chose Dare. Programs choose Truth."))).toBe(true);
    expect(v(sim, "g2.marked")).toBe(true);
    expect(v(sim, "g2.marked_for")).toBe("chose Dare");
    expect(v(sim, "Night.bottle_open")).toBe(false);
    // The same card answered again does nothing.
    const again = fire(sim, "poll answered", "g2", { index: 0, card: 1 });
    expect(casts(again)).toEqual([]);
    expect(v(sim, "Night.truth_n")).toBe(0);
    // The next spin leaves out the picked (and the marked): nobody is picked twice tonight.
    const spin2 = fire(sim, "spin_the_bottle");
    const pick2 = cues(spin2).find((c) => c.startsWith("pick "))!;
    expect(pick2).not.toContain("g2");
    expect(pick2).toContain("g1");
    // Truth → Trabolta's next personal question, on the TV (The Desktop).
    fire(sim, "bottle_landed", "g3");
    const truth = fire(sim, "poll answered", "g3", { index: 0, card: 2 });
    expect(v(sim, "Night.truth_n")).toBe(1);
    expect(beats(truth)).toContain("Truth Question");
    const asked = said(truth).find((e) => e.speaker === "Trabolta" && e.text === FACTS.truths[0]!.text)!;
    expect(asked.setting).toBe("The Desktop");
    expect(casts(truth).some((b) => b.cue.includes("🗣 OpenOffice chose Truth. Trabolta has a question."))).toBe(true);
    expect(v(sim, "Night.bottle_open")).toBe(true);
    // Clippy's buttons settle it: not on this program; a refusal marks.
    expect(hosts(sim, fire(sim, "truth_answered", "g1", null, "Clippy"))).toEqual(["🗣 The bottle is not on Calculator."]);
    const refused = fire(sim, "truth_refused", "g3", null, "Clippy");
    expect(casts(refused).some((b) => b.cue.includes("🙅 OpenOffice refused to answer. That is a directive problem."))).toBe(true);
    expect(v(sim, "g3.marked")).toBe(true);
    expect(v(sim, "g3.marked_for")).toBe("refused the truth");
    expect(v(sim, "Night.bottle_open")).toBe(false);
    // An answered truth: +50.
    fire(sim, "spin_the_bottle");
    fire(sim, "bottle_landed", "g4");
    fire(sim, "poll answered", "g4", { index: 0, card: 3 });
    expect(v(sim, "Night.truth_n")).toBe(2);
    const s4 = sim.scoreOf("g4");
    const ans = fire(sim, "truth_answered", "g4", null, "Clippy");
    expect(sim.scoreOf("g4")).toBe(s4 + 50);
    expect(casts(ans).some((b) => b.cue.includes("🗣 MS Paint answered. Trabolta is satisfied. +50 Truthcoin."))).toBe(true);
    expect(v(sim, "Night.bottle_open")).toBe(false);
    expect(hosts(sim, fire(sim, "truth_answered", "g4", null, "Clippy"))).toEqual(["🗣 The bottle is not on MS Paint."]);
    // The dead-phone fallback: 🎩 on the card.
    fire(sim, "spin_the_bottle");
    fire(sim, "bottle_landed", "g5");
    expect(hosts(sim, fire(sim, "chose_dare", "g1", null, "Clippy"))).toEqual(["🎩 The bottle is not on Calculator."]);
    fire(sim, "chose_dare", "g5", null, "Clippy");
    expect(v(sim, "g5.marked_for")).toBe("chose Dare");
    expect(v(sim, "Night.bottle_open")).toBe(false);
    // Five picks are NEXT's budget, not a cap (D15): a sixth still spins and tells # hosts.
    fire(sim, "spin_the_bottle");
    fire(sim, "bottle_landed", "g6");
    fire(sim, "poll answered", "g6", { index: 0, card: 5 });
    fire(sim, "truth_answered", "g6", null, "Clippy");
    expect(v(sim, "Night.bottle_picks")).toBe(5);
    const sixth = fire(sim, "spin_the_bottle");
    expect(hosts(sim, sixth)).toEqual(["🍾 Past the five on NEXT: 📺 Preview hunt 2 when you're done."]);
    expect(v(sim, "Night.bottle_open")).toBe(true);
    // An empty pool (the server's `else`): the bottle closes for good.
    const empty = fire(sim, "bottle_empty");
    expect(v(sim, "Night.bottle_open")).toBe(false);
    expect(v(sim, "Night.bottle_done")).toBe(true);
    expect(hosts(sim, empty)).toEqual(["🍾 Nobody left to pick. Next: 📺 Preview hunt 2."]);
    // After the preview the bottle and the results are over.
    fire(sim, "second_hunt_preview");
    expect(v(sim, "Night.poll")).toBe("none");
    expect(hosts(sim, fire(sim, "spin_the_bottle"))).toEqual(["🍾 Truth or Dare comes after all three results: read them first (📋)."]);
  });
});

describe("Trapped in the Internet — secrecy (§6.1 item 21)", () => {
  it("agent requests and the facts document never carry Kernel.* (no combo, no verdicts)", { timeout: SLOW }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-trapped-"));
    tmp.push(dir);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: SRC, joinBase: () => "http://localhost" });
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Calculator", passcode: CODES.event });
    expect(g.status).toBe(200);
    const id = g.json["id"] as string;
    const token = g.json["token"] as string;
    const mod = (name: string, extra: Record<string, unknown> = {}) => call(rt, "POST", "/api/mod/signal", { name, ...extra }, { moderator: true });
    await mod("captcha answered", { subject: id, args: { passed: false } });
    expect((await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token })).status).toBe(200);
    expect((await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token })).status).toBe(200);
    // Wave 18b (R10): the deposit box's typed record, through the phone's own card.
    const depositCard = rt.chatHistoryFor(id).find((m) => m.kind === "widget" && m.widget?.kind === "answer")!;
    expect((await call(rt, "POST", "/api/guest/widget", { seq: depositCard.seq, result: { text: "Grandma's opal ring" } }, { token })).status).toBe(200);
    expect(rt.liveSim!.world.peek(`${id}.left_behind_text`)).toMatchObject({ value: "Grandma's opal ring" });
    expect((await call(rt, "POST", "/api/mod/scan", { as: "Norton Anti-Virus", target: id }, { moderator: true })).status).toBe(200);
    for (const n of ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth"]) await mod(n);
    await mod("confident_q1", { subject: id, actor: "Clippy" });
    // A judged 📝 filing (the verdict rides the args, as the server's judge attaches it).
    expect((await mod("fact answered", { subject: id, args: { question: "H1", answer: "Eleven years", confidence: 100, verdict: "accurate", card: 1 } })).status).toBe(200);
    expect(rt.liveSim!.world.peek(`${id}.fact_v1`)).toMatchObject({ value: "accurate" });

    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Who is Sandy?" }, { token })).status).toBe(200);
    const reqs = worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
    expect(reqs).toHaveLength(1);
    const req = reqs[0]!;
    expect(Object.keys(req.world).filter((k) => k.startsWith("Kernel"))).toEqual([]);
    expect(Object.keys(req.world).some((k) => k.startsWith("Night."))).toBe(true);
    const blob = JSON.stringify(req);
    expect(blob).not.toContain("V1-D4"); // combo A
    expect(blob).not.toContain("V1-D3"); // combo B
    expect(blob).not.toContain("B2-A7"); // the same, as the panel writes them
    expect(blob).not.toContain("B2-A5");
    expect(Object.keys(req.them.vars).filter((k) => /lie|confident|accurate|verdict|^fact_[acvj]\d|fact_sure|last_fact_q|fact_label/u.test(k))).toEqual([]);
    expect(Object.keys(req.world).filter((k) => /verdict|said_|ans_|res_|^event#/u.test(k))).toEqual([]);
    for (const leak of ["Eleven years", "said_1", "fact_a1", "fact_v1", "fact_j1", '"verdict"', "opal ring", "left_behind_text"]) expect(blob, leak).not.toContain(leak);

    const facts = (await call(rt, "GET", "/api/agent/facts", {}, { moderator: true })).json as unknown as AgentFacts;
    expect(Object.keys(facts.world).filter((k) => k.startsWith("Kernel"))).toEqual([]);
    const fblob = JSON.stringify(facts);
    for (const leak of ["Eleven years", "said_1", "fact_a1", "fact_v1", '"verdict"', "opal ring", "left_behind_text"]) expect(fblob, leak).not.toContain(leak);
    // The orchestrator's lore block is the facts document's non-secret codex:
    // never the Legendary Fact, a patch sheet or the door code (wave 7).
    expect(fblob).toContain("The Sandy File"); // the lore is there…
    for (const leak of ["THE LEGENDARY FACT", "Patch Sheet", "B2 → A7", "B2 → A5", "The Door Code", "COLD DOOR"]) expect(fblob, leak).not.toContain(leak);
    rt.dispose();
  });

  it("Trabolta's reading lines never ride his worker's recent (wave 18b, Q6: 📋 reads guest-typed answers)", { timeout: SLOW }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-trapped-"));
    tmp.push(dir);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: SRC, joinBase: () => "http://localhost" });
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Calculator", passcode: CODES.event });
    const id = g.json["id"] as string;
    const token = g.json["token"] as string;
    const mod = (name: string, extra: Record<string, unknown> = {}) => call(rt, "POST", "/api/mod/signal", { name, ...extra }, { moderator: true });
    await mod("captcha answered", { subject: id, args: { passed: false } });
    await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token });
    await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token });
    await call(rt, "POST", "/api/mod/scan", { as: "Norton Anti-Virus", target: id }, { moderator: true });
    for (const n of ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth"]) await mod(n);
    await mod("fact answered", { subject: id, args: { question: "H1", answer: "Twelve purple kittens", confidence: 100, verdict: "lie", card: 1 } });
    await mod("close_the_filing");
    await mod("read_the_results");
    const read = rt.chatHistoryFor(id).filter((m) => m.from === "Trabolta" && m.beat === "Question Results");
    expect(read.some((m) => m.text.includes("Twelve purple kittens"))).toBe(true);
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "How did I do?" }, { token })).status).toBe(200);
    const req = worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest)[0]!;
    const recent = JSON.stringify(req.recent ?? []);
    for (const leak of ["Twelve purple kittens", "No consensus", "accepted.", "Question 1"]) expect(recent, leak).not.toContain(leak);
    expect(Object.keys(req.world).filter((k) => /verdict|said_|ans_|res_|^event#/u.test(k))).toEqual([]);
    rt.dispose();
  });

  it("the server room's secrets are secret: no other entry spells a combo or gives the door code, no Trabolta line says it (wave 7)", () => {
    const m = fresh().model;
    for (const id of ["The Legendary Fact", "Combo A First Half", "Combo A Second Half", "Combo B First Half", "Combo B Second Half", FACTS.door!.codex.id]) {
      expect(m.codex.get(id)?.secret, id).toBe(true);
    }
    const code = FACTS.door!.code;
    // The year is the code, in any spelling (1997, '97). Wave 11: no lore
    // leads to it any more (Page 999's '97 is gone; the sign no longer asks
    // for the year). Bridget's sixteen elections since that year are a red
    // herring that never says it opens anything. No entry Trabolta holds
    // carries it (his files reach his prompts whole: the Sandy File and the
    // LiveJournal say "late-nineties" / "Our anniversary").
    const year = new RegExp(`${code}|['’]${code.slice(2)}(?!\\d)`, "u");
    const CLUES = new Set(["Bridget Troelsen"]);
    for (const [id, e] of m.codex) {
      if (e.secret) continue;
      expect(e.text, id).not.toMatch(COMBO);
      if (!CLUES.has(id)) expect(e.text, id).not.toMatch(year);
    }
    const night = fresh();
    toY2k(night);
    for (const e of night.codexFor("Trabolta")) expect(`${e.title}\n${e.text}`, e.id).not.toMatch(year);
    // Nor does any quote her one line, F1's answer (the Sandy File used to,
    // straight into his voice prompt).
    const line = FACTS.questions.find((q) => q.id === "F1")!.answer.toLowerCase();
    for (const e of night.codexFor("Trabolta")) expect(e.text.toLowerCase(), e.id).not.toContain(line);
    // The code lives on the Kernel (seeded from facts.json), never on Night.
    const sim = fresh();
    sim.fireBeat("Power On");
    expect(v(sim, "Kernel.door_code")).toBe(code);
    expect(worldKeys(sim).filter((k) => !k.startsWith("Kernel.") && String(v(sim, k)) === code)).toEqual([]);
    // No scripted Trabolta line, in any beat, hook or rule, says the code or a combo.
    const bad: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (n: any, where: string): void => {
      if (Array.isArray(n)) return n.forEach((x) => walk(x, where));
      if (!n || typeof n !== "object") return;
      if (n.kind === "dialogue" && n.value) {
        const who = [n.value.speaker, ...(n.value.speakers ?? [])].filter((x: unknown) => typeof x === "string").map(fold);
        // The words only: a source span's byte offset (199751) can hold the code.
        const text = JSON.stringify(n.value, (k, x: unknown) => (k === "span" ? undefined : x));
        if (who.includes("trabolta") && (text.includes(code) || COMBO.test(text))) bad.push(where);
      }
      for (const x of Object.values(n)) if (x && typeof x === "object") walk(x, where);
    };
    for (const [key, b] of m.beats) walk(b.body, `beat ${key}`);
    for (const [id, c] of m.characters) walk(c.hooks, `char ${id}`);
    for (const [id, r] of m.roles) walk(r.hooks, `role ${id}`);
    walk(m.rules, "rules");
    expect(bad).toEqual([]);
  });
});

describe("Trapped in the Internet — at his heart (wave 7)", () => {
  /** Y2K hour, the door open, g1 (Calculator) at the server-room terminal
   *  (asked to shut the door first: wave 20). */
  function atTheHeart(): Sim {
    const sim = boot();
    toY2k(sim);
    fire(sim, "server_door_opened");
    fire(sim, "terminal opened", "g1", { at: "The Server Room" }, "Terminal · Server Room");
    return sim;
  }

  it("a lost `terminal closed` never keeps a program at his heart once the next one scans in", { timeout: SLOW }, () => {
    const sim = atTheHeart();
    // g1 walks out; their close is lost to the Wi-Fi. g4 scans in.
    fire(sim, "terminal opened", "g4", { at: "The Server Room" }, "Terminal · Server Room");
    expect(v(sim, "g1.at_the_heart")).toBe(false);
    expect(v(sim, "g4.at_the_heart")).toBe(true);
    // g1, from the phone in their pocket, can no longer answer his heart's
    // questions (wave 20: the talk is the story's, core/test/trapped-heart.test.ts).
    // Another room's terminal never moves the heart.
    fire(sim, "terminal opened", "g5", { at: "The Desktop" });
    expect(v(sim, "g4.at_the_heart")).toBe(true);
    // g1 back at the terminal: theirs again, and g4 is out.
    fire(sim, "terminal opened", "g1", { at: "server-room" });
    expect([v(sim, "g1.at_the_heart"), v(sim, "g4.at_the_heart")]).toEqual([true, false]);
  });

  it("no power of his ends the night (wave 20, D13), and no talk does (wave 58)", () => {
    const m = fresh().model;
    expect(m.interactions.has("stand_down")).toBe(false);
    expect(m.interactions.has("talked_down")).toBe(false);
  });
});

describe("Trapped in the Internet — the server-room terminal over HTTP (wave 7)", () => {
  it("the terminal's `terminal opened` (mod signal, labelled) puts the guest at his heart, and the worker reads it on their next line", { timeout: SLOW }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-trapped-"));
    tmp.push(dir);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: SRC, joinBase: () => "http://localhost" });
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
    rt.liveSim!.setVar("Night.step", "14");
    expect((await mod("terminal opened", { subject: id, args: { at: "The Server Room" }, label: "Terminal · Server Room" })).status).toBe(200);
    expect(rt.liveSim!.world.peek(`${id}.at_the_heart`)).toMatchObject({ value: true });
    // The guest at his heart holds every server-room secret (a checkmate, the majority, the riddle).
    for (const entry of [FACTS.door!.codex.id, "The Cold Door", "The Legendary Fact", "Combo A First Half", "Combo A Second Half", "Combo B First Half", "Combo B Second Half"]) rt.liveSim!.unlock(id, entry);
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "What do you want?" }, { token })).status).toBe(200);
    const req = worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest)[0]!;
    expect(String(req.them.vars["at_the_heart"])).toBe("true");
    expect(String(req.world["Night.heart_opened"])).toBe("false");
    // He holds the Sandy File (its year is the riddle's clue), never the code itself.
    for (const leak of ["The Door Code", "COLD DOOR", "The Cold Door", "door_code", "THE LEGENDARY FACT", "Patch Sheet", "V2 → D5", "V1 → D6", "the_door_code", "combo_a"]) expect(JSON.stringify(req), leak).not.toContain(leak);
    expect((await mod("terminal closed", { subject: id, args: { at: "The Server Room" }, label: "Terminal · Server Room" })).status).toBe(200);
    expect(rt.liveSim!.world.peek(`${id}.at_the_heart`)).toMatchObject({ value: false });
    rt.dispose();
  });

  it("a program holding the four digit notes: his worker never learns how many it holds or that The Cold Door is done", { timeout: SLOW }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-trapped-"));
    tmp.push(dir);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: SRC, joinBase: () => "http://localhost" });
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
    for (const c of FACTS.door!.clues!) expect((await call(rt, "POST", "/api/guest/codex/redeem", { code: c.code }, { token })).status).toBe(200);
    expect(rt.liveSim!.holdsCodex(id, FACTS.door!.codex.id)).toBe(true);
    expect(rt.liveSim!.world.peek(`${id}.door_digits`)).toMatchObject({ value: 4 });
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Guess what I found." }, { token })).status).toBe(200);
    const req = worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest)[0]!;
    // (`door_by` is wave 18's door-queue claim: an Antivirus' name, no code.)
    expect(Object.keys(req.them.vars).filter((k) => /door|cold/u.test(k) && k !== "door_by")).toEqual([]);
    for (const leak of ["door_digits", "the_cold_door", "cold_door", "the_door_code", "DIGIT IS"]) expect(JSON.stringify(req), leak).not.toContain(leak);
    rt.dispose();
  });
});

// ───────────────────────── director mistakes (verify-pass regressions) ─────────────────────────

describe("Trapped in the Internet — a director's mis-taps", () => {
  it("a power fired with no program (a Cast thread) says nothing in public and does nothing", { timeout: SLOW }, () => {
    const sim = boot();
    fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta");
    for (const step of [4, 7, 17]) {
      sim.setVar("Night.step", String(step));
      for (const [p, a] of POWERS) {
        const e = fire(sim, p, null, a, "Trabolta");
        expect(saidBy(e, "Trabolta"), `${p}@${step}`).toEqual([]);
        expect(casts(e), `${p}@${step}`).toEqual([]);
      }
    }
    expect(worldKeys(sim).filter((k) => k.startsWith("."))).toEqual([]);
  });

  it("bad power args are refused out loud: an empty pop-up, a non-amount", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    expect(lines(fire(sim, "pop_up", "g1", { target: "g2" }, "Trabolta"), "Trabolta")).toEqual(["A pop-up needs words."]);
    const s0 = sim.scoreOf("g1");
    expect(lines(fire(sim, "mint_truthcoin", "g1", { amount: -5 }, "Trabolta"), "Trabolta")).toEqual(["That is not an amount I can pay."]);
    expect(sim.scoreOf("g1")).toBe(s0);
  });

  it("skipping the introduction: the next cue wakes him and a late press never moves the night back", { timeout: SLOW }, () => {
    const sim = boot();
    fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "start_the_hunt");
    expect(v(sim, "Trabolta.awake")).toBe(true);
    expect(v(sim, "Night.trabolta_introduced")).toBe(true);
    fire(sim, "introduce_trabolta");
    expect(v(sim, "Night.phase")).toBe("hunt_1");
    advance(sim, 900);
    expect(v(sim, "Night.phase")).toBe("truth_1");
  });

  it("an early First Moment of Truth closes hunt 1 (no stray timer); before the hunt it does nothing", { timeout: SLOW }, () => {
    const sim = boot();
    fireAll(sim, "call_to_the_desktop", "start_the_bingo");
    fire(sim, "first_moment_of_truth");
    expect(v(sim, "Night.judging")).toBe(false);
    fireAll(sim, "bingo_time", "introduce_trabolta", "start_the_hunt");
    fire(sim, "first_moment_of_truth");
    expect(v(sim, "Night.phase")).toBe("truth_1");
    expect(v(sim, "Night.hunt_on")).toBe(false);
    expect(v(sim, "Night.judging")).toBe(true);
    const later = advance(sim, 960);
    expect(casts(later).filter((b) => b.cue.includes("Time is up") || b.cue.includes("5 minutes left"))).toEqual([]);
    expect(beats(fire(sim, "first_moment_of_truth"))).toEqual([]); // a second press replays nothing
  });

  it("a judge's double tap credits once; a captured program's answer is refused", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    fire(sim, "accurate_q1", "g1", null, "Clippy");
    const again = fire(sim, "accurate_q1", "g1", null, "Clippy");
    expect(v(sim, "g1.truths_accepted")).toBe(1);
    expect(casts(again).some((b) => b.cue.includes("already accepted") && b.scope === "channel(hosts)")).toBe(true);
    expect(replies(again)).toEqual([]);
    fire(sim, "send to the internet", "g5", null, "Norton Anti-Virus");
    const d0 = v(sim, "g5.doubt");
    fire(sim, "send to the internet", "g5", null, "Norton Anti-Virus");
    expect(v(sim, "g5.doubt")).toBe(d0); // no double doubt for one visit
    fire(sim, "accurate_q2", "g5", null, "Clippy");
    expect(v(sim, "g5.truths_accepted")).toBe(0);
  });

  it("ending the hour early: the auto warning never drags the night back to the summons", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    fireAll(sim, "truth_pong", "round_two_tally", "trust_chart");
    advance(sim, 3600);
    expect(v(sim, "Night.phase")).toBe("trust_chart");
    for (const [g] of PROGRAMS) expect(v(sim, `${g}.late`), g).not.toBe(true);
  });

  it("back from the bathroom, or released, after the summons closed: not late, not swept", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    sim.setVar("Night.auto_sweep", "true");
    fire(sim, "five_minute_warning");
    for (const [g] of PROGRAMS) if (g !== "g5" && g !== "g6") sim.scan("Norton Anti-Virus", g);
    fire(sim, "go to the bathroom", "g5");
    fire(sim, "send to the internet", "g6", null, "Norton Anti-Virus");
    fire(sim, "summons_closed");
    const back = fire(sim, "back from the bathroom", "g5");
    const out = fire(sim, "the simulation completed", "g6");
    for (const g of ["g5", "g6"]) {
      expect(v(sim, `${g}.late`), g).not.toBe(true);
      expect(sim.isCaptured(g), g).toBe(false);
    }
    expect(replies([...back, ...out]).filter((r) => r.text.includes("late"))).toEqual([]);
  });

  it("the round-2 tally runs once, only at Truth Pong; Truth Pong does not reopen after it", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    fire(sim, "round_two_tally"); // too early
    expect(v(sim, "Night.tallied")).toBe(false);
    fire(sim, "truth_pong");
    const c0 = v(sim, "Trabolta.composure");
    fire(sim, "round_two_tally");
    fire(sim, "round_two_tally");
    expect(v(sim, "Trabolta.composure")).toBe(c0 - 10);
    expect(beats(fire(sim, "truth_pong"))).toEqual([]);
    expect(v(sim, "Night.judging")).toBe(false);
  });

  it("a lighting cue during a cut wins: the 90 s restore never re-lights the room over it", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    expect(cues(fire(sim, "cut_the_lights", "g1", { room: "The Start Bar" }, "Trabolta"))).toContain("cue lights, room: The Start Bar, state: off");
    // An ending (or the alarm) changes the house look 30 s later…
    advance(sim, 30);
    expect(cues(fire(sim, "lights_dance"))).toContain("cue lights_dance");
    // …so at 90 s the kitchen is NOT switched back on over the dance.
    const later = cues(advance(sim, 61));
    expect(later.some((c) => c.includes("room: The Start Bar, state: on"))).toBe(false);
    expect(v(sim, "Night.lights_back_at")).toBe(0);
    // And a cut that nothing interrupts still comes back on its own.
    sim.setVar("Night.lights", "game");
    fire(sim, "cut_the_lights", "g1", { room: "The Desktop" }, "Trabolta");
    expect(cues(advance(sim, 91))).toContain("cue lights, room: The Desktop, state: on");
  });

  it("a late arrival's clearance mid-cut keeps the house look: the Tube chase is an overlay, the 90 s restore still fires", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    const look = v(sim, "Night.lights");
    fire(sim, "cut_the_lights", "g1", { room: "The Start Bar" }, "Trabolta");
    advance(sim, 30);
    const cleared = upload(sim, "late1", "Netscape Navigator");
    expect(v(sim, "late1.cleared")).toBe(true);
    expect(cues(cleared)).toContain("cue lights_tube_chase");
    // No mirror: stagehand's catch-up replays `lights_{Night.lights}`, the house scene.
    expect(v(sim, "Night.lights")).toBe(look);
    expect(cues(advance(sim, 61))).toContain("cue lights, room: The Start Bar, state: on");
    expect(v(sim, "Night.lights_back_at")).toBe(0);
  });

  it("one room dark at a time; truth.txt waits for the Bag", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    fire(sim, "cut_the_lights", "g1", { room: "The Start Bar" }, "Trabolta");
    expect(lines(fire(sim, "cut_the_lights", "g1", { room: "The Cloud" }, "Trabolta"), "Trabolta")).toEqual(["One room at a time."]);
    sim.setVar("Night.phase", "bobbing");
    sim.setVar("Night.step", "17");
    expect(beats(fire(sim, "read_truth_txt"))).toEqual([]);
  });

  it("the advice endings only answer in the advice phase", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    fireAll(sim, "advice_thwarted", "advice_helped");
    expect(v(sim, "Night.ended")).toBe(false);
    expect(v(sim, "Night.banish")).toBe(false);
    expect(v(sim, "Night.phase")).toBe("truth_1");
  });

  it("combo A stops the Y2K hour: no clock skip, no midnight, no final-round orders", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    toBeans(sim);
    fireAll(sim, "trabolta_overshares", "y2k_clock", "patch_combo_a");
    expect(v(sim, "Night.ending")).toBe("disabled");
    expect(v(sim, "Night.final_round")).toBe(false);
    expect(casts(fire(sim, "turn_back_the_clock", "g1", null, "Trabolta"))).toEqual([]);
    expect(beats(fire(sim, "y2k_midnight"))).not.toContain("Clock Strikes");
    const late = upload(sim, "g9", "Winamp");
    expect(beats(late)).not.toContain("Program Final Round");
  });

  it("an agent never takes a secret about someone else: a combo half shared to Trabolta is refused", () => {
    const sim = boot();
    sim.unlock("g1", "Combo A First Half");
    const t0 = v(sim, "Trabolta.truth");
    sim.share("g1", "Trabolta", "Combo A First Half");
    expect(sim.holdsCodex("Trabolta", "Combo A First Half")).toBe(false);
    expect(v(sim, "Trabolta.truth")).toBe(t0);
    expect(v(sim, "g1.delivered")).toBe(false);
    sim.share("g1", "Clippy", "Combo A First Half"); // performers judge for themselves
    expect(sim.holdsCodex("Clippy", "Combo A First Half")).toBe(true);
  });

  it("the combo halves carry neutral titles (Trabolta's prompt lists titles)", () => {
    const sim = fresh();
    for (const id of ["Combo A First Half", "Combo A Second Half", "Combo B First Half", "Combo B Second Half"]) {
      expect(sim.model.codex.get(id)!.title, id).toMatch(/^Patch Sheet [AB] · [12] of 2$/);
    }
  });
});

describe("Trapped in the Internet — the awards ceremony (K-25)", () => {
  const AWARDS = [
    "award_most_trusted",
    "award_least_trusted",
    "award_frequent_flyer",
    "award_lore_hoarder",
    "award_truthcoin_tycoon",
    "award_best_liar",
    "award_duck_speedrun",
    "award_quest_completionist",
  ];
  /** The Desktop room's lines, as the phones render them. */
  const desktop = (sim: Sim, evs: SimEvent[]) =>
    composeGuestMessages(sim, evs).filter((m) => m.channel === "loc:The Desktop" && m.kind === "line").map((m) => `${m.from}: ${m.text}`);
  /** A sim whose night has ended the given way (the endings are tested above). */
  function ended(ending: string): Sim {
    const sim = boot();
    sim.setVar("Night.ended", "true");
    sim.setVar("Night.ending", ending);
    return sim;
  }

  it("declares G1 + 5 fixed + 3 bonus admin cues, in running order after the endings", () => {
    const admin = [...fresh().model.interactions.values()].filter((i) => i.who === "admin").map((i) => i.id);
    const at = admin.indexOf("start_the_ceremony");
    expect(at).toBeGreaterThan(admin.indexOf("the_hand_jive"));
    expect(admin.slice(at, at + 9)).toEqual(["start_the_ceremony", ...AWARDS]);
  });

  it("refuses before the ending: no ceremony, no award, nothing leaks", () => {
    const sim = boot();
    const s = g1(sim);
    expect(beats(s)).toEqual([]);
    expect(v(sim, "Night.ceremony")).toBe(false);
    const a = fire(sim, "award_best_liar", "g1", { value: 3 });
    // Only the hosts hear why (B14): nobody's phone gets a word.
    expect(texts(a)).toEqual(['!"🏆 Start the ceremony (G1) first: nothing was awarded."']);
    expect(casts(a).map((c) => c.scope)).toEqual(["channel(hosts)"]);
    expect(replies(a)).toEqual([]);
    expect(v(sim, "Night.award_winner")).toBe("none");
  });

  it("an ending → Trabolta hosts in The Desktop; awards carry the winner's name and number", () => {
    const sim = ended("song");
    const s = g1(sim);
    expect(v(sim, "Night.ceremony_host")).toBe("Trabolta");
    expect(beats(s)).toContain("The Ceremony");
    expect(cues(s)).toContain("cue screens_ceremony");
    expect(casts(s).map((c) => c.cue.replace(/^"|"$/gu, ""))).toEqual(["!🏆 THE AWARDS CEREMONY. Every program to the Desktop."]);
    expect(composeGuestMessages(sim, s).some((m) => m.alert === true)).toBe(true);
    // Wave 18b: The Night In Review, then The Ceremony's two opening lines.
    expect(beats(s).indexOf("The Night In Review")).toBeLessThan(beats(s).indexOf("The Ceremony"));
    expect(desktop(sim, s).slice(-2)).toEqual([
      "Trabolta: Programs. Before the prom, a ceremony. I kept score of every one of you tonight.",
      "Trabolta: These are the awards of the night. When I say your name, come up to the screen and collect your trophy.",
    ]);
    expect(desktop(sim, s).every((l) => l.startsWith("Trabolta: "))).toBe(true);

    sim.setVar("g1.trust", "42");
    const a = fire(sim, "award_most_trusted", "g1");
    expect(desktop(sim, a)).toEqual([
      "Trabolta: Most Trusted. Trust score 42. Calculator. When I needed a program to believe, I believed you. Come and take your trophy.",
    ]);
    expect(cues(a)).toContain("cue screens_award_most_trusted");
    expect(v(sim, "Night.screen")).toBe("award_most_trusted");
    expect(v(sim, "Night.terminals")).toBe("award_most_trusted");
    // Never in a DM: the winner hears a personal reply, the room hears the line.
    expect(composeGuestMessages(sim, a).some((m) => m.channel.startsWith("dm:"))).toBe(false);
    expect(replies(a).map((r) => `${r.to}: ${r.text}`)).toEqual(["g1: !!🏆 You won Most Trusted! Come up to the TV for your trophy."]);
    expect(composeGuestMessages(sim, a).find((m) => m.text.startsWith("🏆 You won"))).toMatchObject({ moment: "big", go: [{ kind: "room", id: "loc:The Desktop" }] });

    // Three awards on three real programs (the acceptance), names in the room.
    fire(sim, "award_frequent_flyer", "g5");
    const lh = fire(sim, "award_lore_hoarder", "g3");
    expect(desktop(sim, lh)[0]).toMatch(/^Trabolta: Lore Hoarder, for the most codex entries: \d+\. OpenOffice\./u);
    const tt = fire(sim, "award_truthcoin_tycoon", "g6");
    expect(desktop(sim, tt)[0]).toMatch(/^Trabolta: Truthcoin Tycoon\. Balance \d+ Truthcoin\. VLC\./u);
    expect(v(sim, "Night.awards_given")).toBe(4);
  });

  it("every award reads a fallback with no number, and the director's value when given", () => {
    const sim = ended("help");
    g1(sim);
    for (const a of AWARDS) {
      const out = fire(sim, a, "g2");
      const said = desktop(sim, out);
      expect(said.length, a).toBe(1);
      expect(said[0], a).toContain("Microsoft Excel");
      expect(said[0], a).not.toMatch(/\bnull\b|\bnone\b|\{/u);
      expect(cues(out), a).toContain(`cue screens_${a}`);
    }
    // A bonus award with no value reads its fallback; with one, the number.
    expect(desktop(sim, fire(sim, "award_best_liar", "g4"))[0]).toBe(
      "Trabolta: A bonus award. Best Liar. MS Paint. I believed you. Every time. I am not angry. I am impressed. Come up here.",
    );
    expect(desktop(sim, fire(sim, "award_best_liar", "g4", { value: 3 }))[0]).toContain("Confident lies I accepted: 3. MS Paint.");
    expect(desktop(sim, fire(sim, "award_duck_speedrun", "g1", { value: "2:41" }))[0]).toContain("Calculator reached the golden duck in 2:41.");
    // `value` overrides a fixed award's own number (a corrected recap).
    expect(desktop(sim, fire(sim, "award_most_trusted", "g1", { value: 99 }))[0]).toContain("Trust score 99. Calculator.");
    // …and the next award without one falls back to the winner's var again.
    expect(desktop(sim, fire(sim, "award_best_liar", "g4"))[0]).not.toContain("accepted:");
  });

  it("the host changes per ending: Clippy after disabled, destroyed and rave, Trabolta otherwise", () => {
    for (const [ending, host] of [["destroyed", "Clippy"], ["rave", "Clippy"], ["disabled", "Clippy"], ["song_pickup", "Trabolta"], ["hand_jive", "Trabolta"]] as const) {
      const sim = ended(ending);
      const s = g1(sim);
      expect(v(sim, "Night.ceremony_host"), ending).toBe(host);
      expect(desktop(sim, s).every((l) => l.startsWith(`${host}: `)), ending).toBe(true);
      const a = fire(sim, "award_least_trusted", "g1");
      const said = desktop(sim, a);
      expect(said.length, ending).toBe(1);
      expect(said[0]!.startsWith(`${host}: `), ending).toBe(true);
      expect(said[0], ending).toContain("Calculator");
      // The TV shows the award slide whoever hosts.
      expect(cues(a), ending).toContain("cue screens_award_least_trusted");
    }
    const d = ended("disabled");
    // Wave 18b: after The Night In Review's lines.
    expect(saidBy(g1(d), "Trabolta")).toEqual([]);
    const c = ended("destroyed");
    expect(lines(g1(c), "Clippy").some((l) => /^The computer is off\./u.test(l))).toBe(true);
  });

  it("banished is not final: no ceremony until the hand jive ends the night", () => {
    const sim = boot();
    sim.setVar("Night.ending", "banished");
    expect(beats(fire(sim, "start_the_ceremony"))).toEqual([]);
  });

  it("runs once: a second start replays nothing", () => {
    const sim = ended("song");
    g1(sim);
    expect(beats(fire(sim, "start_the_ceremony"))).toEqual([]);
  });

  it("a real ending (all eight accurate → Song Ending) opens the ceremony", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim);
    truthTxt(sim);
    expect(v(sim, "Night.ending")).toBe("song");
    const s = g1(sim);
    expect(beats(s)).toContain("The Ceremony");
    const a = fire(sim, "award_most_trusted", "g1");
    expect(desktop(sim, a)[0]).toMatch(/^Trabolta: Most Trusted\. Trust score -?\d+\. Calculator\./u);
  });
});

// ───────────────────────── wave 1 leftovers ─────────────────────────

describe("Trapped in the Internet — wave 1 leftovers", () => {
  it("an ending stops every running clock: no corner countdown, no late time-up beat", { timeout: SLOW }, () => {
    const sim = boot();
    fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt");
    expect(v(sim, "Night.hunt_on")).toBe(true);
    fire(sim, "trabolta_disabled");
    for (const on of ["hunt_on", "hunt2_on", "summons_open", "bingo_on", "final_round"]) expect(v(sim, `Night.${on}`), on).toBe(false);
    expect(v(sim, "Night.hunt_end")).toBe(0);
    const later = advance(sim, 900);
    expect(beats(later)).not.toContain("Hunt Time Up");
    expect(casts(later).some((b) => b.cue.includes("5 minutes left") || b.cue.includes("Time is up"))).toBe(false);
    expect(v(sim, "Night.ending")).toBe("disabled");

    // The summons too (combo B mid-countdown).
    const s2 = boot();
    toTruth1(s2);
    toHunt2(s2);
    fire(s2, "five_minute_warning");
    expect(v(s2, "Night.summons_open")).toBe(true);
    fire(s2, "computer_destroyed");
    expect(v(s2, "Night.summons_open")).toBe(false);
    expect(beats(advance(s2, 300))).not.toContain("Summons Closed");
  });

  it("no codex entry outside the hunt answers gives away a round-1 / round-2 answer (facts.json answer + accept)", () => {
    const m = fresh().model;
    const HUNT = new Set(FACTS.questions.map((q) => q.codex!.id));
    for (const id of HUNT) expect(m.codex.has(id), id).toBe(true);
    // Every round, the final facts too (2026-10-19: Trabolta must never know
    // what he asks for, so his files no longer tell F1 / F2). Short one-word /
    // numeric aliases ("11", "9:00", "tabby", "1978", "grok") would match
    // ordinary prose, so an alias counts when it is two words or a word of six
    // letters or more (test/trabolta-answers.test.ts scans the short ones, with
    // the judge's own folding, in everything Trabolta can read).
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const alias = (a: string) => /\s/u.test(a.trim()) || /^[a-z]{6,}$/iu.test(a.trim());
    for (const q of FACTS.questions) {
      const words = [q.answer, ...q.accept].filter(alias); // "1978" alone is a year in other files
      const res = words.map((w) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(w.trim())}(?![\\p{L}\\p{N}])`, "iu"));
      for (const [id, entry] of m.codex) {
        if (HUNT.has(id)) continue;
        for (const re of res) expect(re.test(`${entry.title} ${entry.text}`), `${q.id}: ${id} ~ ${re}`).toBe(false);
      }
    }
    expect(m.codex.get("The Data Centre Sinkhole")!.text).toContain("4 a.m.");
  });
});

// ───────────────────────── wave 3: the story audit's fixes ─────────────────────────

describe("Trapped in the Internet — wave 3 story fixes", () => {
  const hosts = (evs: SimEvent[]) => casts(evs).filter((b) => b.scope === "channel(hosts)").map((b) => b.cue.replace(/^"|"$/gu, ""));

  it("📝 two filings in a row are both recorded (no lock); each settle names its own question", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    fire(sim, "fact answered", "g5", { question: "H2", answer: "Mister Pickles", confidence: 100, verdict: "accurate", card: 1 });
    expect(v(sim, "g5.fact_label")).toBe("round 1 Q2");
    const two = fire(sim, "fact answered", "g5", { question: "H1", answer: "Eleven years", confidence: 100, verdict: "accurate", card: 2 });
    expect(lines(two, "Trabolta")).toEqual(["Filed for round 1 Q1, Winamp. Your fact is in the record."]);
    expect(v(sim, "g5.fact_label")).toBe("round 1 Q1");
    expect(v(sim, "g5.last_fact_q")).toBe("H1");
    expect(v(sim, "g5.fact_a1")).toBe("Eleven years");
    expect(v(sim, "g5.fact_a2")).toBe("Mister Pickles");
    advance(sim, 120);
    const r1 = fire(sim, "read_the_results");
    expect(lines(r1, "Trabolta").filter((t) => t.startsWith("Your fact"))).toEqual(["Your fact for round 1 Q1 is accepted, Winamp. Trabolta thanks you. +50 Truthcoin."]);
    expect(hosts(r1)).toContain("📝 Winamp's filing for H1 is accepted.");
    const r2 = fire(sim, "read_the_results");
    expect(lines(r2, "Trabolta").filter((t) => t.startsWith("Your fact"))).toEqual(["Your fact for round 1 Q2 is accepted, Winamp. Trabolta thanks you. +50 Truthcoin."]);
    expect(hosts(r2)).toContain("📝 Winamp's filing for H2 is accepted.");
    expect(v(sim, "Kernel.q1")).toBe("accurate");
    expect(v(sim, "Kernel.q2")).toBe("accurate");
    expect(v(sim, "Kernel.q3")).toBe("none");
  });

  it("a judge's refused press and the bank's readouts go to # hosts; the program hears only its own news", { timeout: SLOW }, () => {
    const sim = boot();
    fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta");
    const closed = fire(sim, "accurate_q1", "g1", null, "Clippy");
    expect(hosts(closed)).toEqual(["⚖️ Judging is closed: Calculator's answer was not recorded."]);
    expect(replies(closed)).toEqual([]);
    const pay = fire(sim, "pay_truthcoin", "g1", null, "McAfee Anti-Virus");
    expect(replies(pay).map((r) => [r.to, r.text])).toEqual([["g1", "🪙 +100 Truthcoin. Balance: 200."]]);
    expect(hosts(pay)).toEqual(["🪙 Paid Calculator 100 Truthcoin. Balance: 200."]);
    sim.setVar("g5.score", "40");
    const broke = fire(sim, "charge_truthcoin", "g5", null, "CRA Agent Software");
    expect(replies(broke)).toEqual([]);
    expect(hosts(broke)).toEqual(["🪙 Winamp cannot cover 100 Truthcoin. Balance: 40."]);
    const charged = fire(sim, "charge_truthcoin", "g1", null, "CRA Agent Software");
    expect(replies(charged).map((r) => r.text)).toEqual(["🪙 −100 Truthcoin. Balance: 100."]);
    expect(hosts(charged)).toEqual(["🪙 Charged Calculator 100 Truthcoin. Balance: 100."]);
  });

  it("the printer: a free VLC is asked and nudged (MS Paint too); the certificate never asks a VLC in the Internet", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    fireAll(sim, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart");
    const rk = fire(sim, "show_the_rankings");
    expect(lines(rk, "Trabolta").some((t) => t.startsWith("VLC Player."))).toBe(true);
    expect(v(sim, "Night.printer_vlc")).toBe(true);
    expect(replies(rk).filter((r) => r.to === "Adobe Acrobat").map((r) => r.text)).toEqual(["🖨 Stand by the printer. VLC is about to be asked to print a certificate."]);
    const nudges = saidBy(rk, "Truther Download").map(aud).sort();
    expect(nudges).toEqual(['["g4"]', '["g6"]']); // MS Paint, VLC
    // Captured after the call: no nudge in the tent; a reminder once released, before the beans.
    expect(saidBy(fire(sim, "send to the internet", "g6", null, "Norton Anti-Virus"), "Truther Download")).toEqual([]);
    expect(saidBy(fire(sim, "the simulation completed", "g6"), "Truther Download").map(aud)).toEqual(['["g6"]']);
    fire(sim, "printer_opened");
    fire(sim, "send to the internet", "g6", null, "Norton Anti-Virus");
    expect(saidBy(fire(sim, "the simulation completed", "g6"), "Truther Download")).toEqual([]); // the beans are out: no more
  });

  it("the ad hijack reaches every phone as an alert, with the terminals' 000. 000. 000.", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    readResults(sim);
    const ad = fire(sim, "second_hunt_preview");
    const alert = casts(ad).find((b) => b.cue.includes("000. 000. 000."));
    expect(alert?.scope).toBe("everyone");
    const msg = composeGuestMessages(sim, ad).find((m) => m.text.includes("000. 000. 000."));
    expect(msg?.alert).toBe(true);
  });

  it("the Trust Chart is on the TV and the terminals: every cleared program, ranked live", { timeout: SLOW }, async () => {
    const { ScreenWatch } = await import("../server/routes/screen.ts");
    const sim = boot();
    toTruth1(sim);
    fire(sim, "accurate_q1", "g1", null, "Clippy");
    toHunt2(sim);
    fireAll(sim, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally");
    const w = new ScreenWatch();
    const poll = (view: string) => w.poll(sim, { name: view, spot: "", view, character: "Trabolta" }, () => false);
    expect(poll("tv").chart).toBeNull();
    fire(sim, "trust_chart");
    const tv = poll("tv").chart!;
    // Wave 21 (C6): the five players rank beside the programs, flagged staff.
    const staff = ["Clippy", "Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software"];
    expect(tv.rows.filter((r) => r.staff !== true).length).toBe(PROGRAMS.length);
    expect(tv.rows.filter((r) => r.staff === true).map((r) => r.name).sort()).toEqual([...staff].sort());
    expect(tv.rows.filter((r) => r.staff !== true)[0]).toEqual({ name: "Calculator", value: 10 });
    expect(poll("auto").chart?.rows.length).toBe(PROGRAMS.length + staff.length);
    fire(sim, "assess", "g5", { target: "g5", score: 10 }, "Trabolta");
    expect(poll("tv").chart!.rows.filter((r) => r.staff !== true).slice(0, 2).map((r) => r.name).sort()).toEqual(["Calculator", "Winamp"]);
    // The rankings call out the top and the bottom on the chart (B12): it
    // stays up through Praise, Shame and the printer ask…
    fire(sim, "show_the_rankings");
    const called = poll("tv").chart!;
    expect(called.top).toBe(v(sim, "Night.most_trusted"));
    expect(called.bottom).toBe(v(sim, "Night.least_trusted"));
    expect(called.top).not.toBeNull();
    expect(called.bottom).not.toBeNull();
    expect(poll("auto").chart?.top).toBe(called.top);
    // …and the certificate takes the screen only when START is pressed.
    const start = fire(sim, "printer_button_pressed");
    expect(beats(start)).toContain("The Printer Jams");
    expect(cues(start)).toContain("cue screens_print_certificate");
    expect(v(sim, "Night.screen")).toBe("print_certificate");
    expect(poll("tv").chart).toBeNull();
  });

  it("the King's taunt plays on the TV with a crew readout; a chess win forgives nothing at the patch bay", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    const l = fire(sim, "chess lost");
    const m = composeGuestMessages(sim, l).find((x) => x.text.startsWith("Checkmate."));
    expect(m?.channel).toBe("loc:The Desktop");
    expect(hosts(l)).toEqual(["♟ The King won a game. No door code."]);
    fire(sim, "chess_won", "g1");
    const wrong = fire(sim, "patch_rejected");
    expect(v(sim, "Night.alarm_on")).not.toBe(true);
    expect(lines(wrong, "Trabolta")).toContain("Stop touching me.");
    expect(beats(fire(sim, "patch_rejected"))).toContain("Server Room Alarm"); // two wrong is still two
  });

  it("the results and the bottle only inside the First Moment of Truth, in order (⏱ → 📋 → 🍾); no zip after the night or during the banishment", { timeout: SLOW }, () => {
    const sim = boot();
    fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt");
    const early = fire(sim, "spin_the_bottle");
    expect(beats(early)).toEqual([]);
    expect(hosts(early)).toEqual(["🍾 Truth or Dare comes after all three results: read them first (📋)."]);
    expect(hosts(fire(sim, "read_the_results"))).toEqual(["📋 Close the filings first (⏱), then read the results."]);
    expect(hosts(fire(sim, "close_the_filing"))).toEqual(["⏱ No filing window is open."]);
    fireAll(sim, "hunt_time_up", "first_moment_of_truth");
    expect(hosts(fire(sim, "read_the_results"))).toEqual(["📋 Close the filings first (⏱), then read the results."]);
    const shut = fire(sim, "close_the_filing");
    expect(beats(shut)).toContain("Filing Closed");
    expect(casts(shut).some((b) => b.cue.includes("📝 Round one is closed. Trabolta is reading."))).toBe(true);
    expect(v(sim, "Night.r1_closed")).toBe(true);
    expect(hosts(fire(sim, "close_the_filing"))).toEqual(["⏱ No filing window is open."]);
    expect(beats(fire(sim, "read_the_results"))).toContain("Question Results");
    fireAll(sim, "read_the_results", "read_the_results", "second_hunt_preview");
    expect(hosts(fire(sim, "spin_the_bottle"))).toEqual(["🍾 Truth or Dare comes after all three results: read them first (📋)."]);
    expect(hosts(fire(sim, "read_the_results"))).toEqual(["📋 Close the filings first (⏱), then read the results."]);

    const done = boot();
    toTruth1(done);
    fire(done, "send to the internet", "g5", null, "Norton Anti-Virus");
    fire(done, "trabolta_disabled");
    const z = fire(done, "zip_everyone_out");
    expect(beats(z)).toEqual([]);
    expect(v(done, "Night.zip_wave")).toBe(0);
    expect(replies(z)).toEqual([]); // no Antivirus booth cue either
    expect(hosts(z)[0]).toMatch(/^🗜 No zip/u);
  });

  it("the server-room endings settle The Final Facts; the ambient hum and McAfee stop with the night", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    expect(sim.questStatus("g1", "The Final Facts")).toBe("active");
    fire(sim, "patch_combo_a");
    expect(sim.questStatus("g1", "The Final Facts")).toBe("failed");
    const after = advance(sim, 3600);
    expect(after.filter((e) => e.type === "ambient")).toEqual([]);
    expect(casts(after).some((b) => b.cue.includes("Your protection has expired"))).toBe(false);

    const b = boot();
    toY2k(b);
    fire(b, "patch_combo_b");
    expect(b.questStatus("g3", "The Final Facts")).toBe("failed");
    // Before the end the hum runs as it always did.
    const s = boot();
    expect(advance(s, 240).filter((e) => e.type === "ambient").length).toBe(1);
  });

  it("Excel carrying the virus before the Truther Download is told so by his quest", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    sim.redeem("g2", "LOVE-LETTER-FOR-YOU");
    expect(v(sim, "g2.carries_virus")).toBe(true);
    readResults(sim);
    fireAll(sim, "second_hunt_preview", "start_the_second_hunt");
    advance(sim, 120);
    const pick = sim.choose("g2", 0); // sabotage
    const steps = (pick.filter((e) => e.type === "quest") as Ev<"quest">[]).filter((e) => e.quest === "Excel Mission").map((e) => `${e.action}: ${e.text}`);
    expect(steps).toEqual(["start: Get the fixers sent for reinstallation. Get yourself sent to the Internet and bring back a virus. Insert it.", "update: You have the virus. Insert the disk."]);
    // Not when the disk is already in.
    const s2 = boot();
    toTruth1(s2);
    s2.redeem("g2", "LOVE-LETTER-FOR-YOU");
    fire(s2, "plant_the_virus", "g2");
    readResults(s2);
    fireAll(s2, "second_hunt_preview", "start_the_second_hunt");
    advance(s2, 120);
    expect((s2.choose("g2", 0).filter((e) => e.type === "quest") as Ev<"quest">[]).filter((e) => e.action === "update")).toEqual([]);
  });

  it("the review reads only the featured programs who came", { timeout: SLOW }, () => {
    // Excel, OpenOffice, MS Paint and VLC came; DraftKings, Bugdom, Jeeves, Runescape and Pong did not
    const end = boot();
    toY2k(end);
    fire(end, "patch_combo_a");
    const rc = lines(g1(end), "Clippy");
    for (const here of ["Microsoft Excel is", "OpenOffice is", "MS Paint is Maria", "VLC is Victor"]) expect(rc.some((x) => x.startsWith(here)), here).toBe(true);
    for (const gone of ["DraftKings is the artist", "Bugdom is Bea", "Broken Ask Jeeves is", "Runescape is Poppy", "Pong is the child"]) expect(rc.some((x) => x.startsWith(gone)), gone).toBe(false);
    for (const cast of ["Clippy is Tippi", "Norton Anti-Virus is Julie Horton-Norton", "McAfee Anti-Virus is John McAfee", "Password Manager is Bridget Troelsen", "CRA Agent Software is Sharon Penney"]) expect(rc.some((x) => x.startsWith(cast)), cast).toBe(true); // the cast always
  });

  it("the tent tablet's scan is the Wizard's video; an uncorrupted visitor gains doubt; a pop-up is an alert", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    fire(sim, "send to the internet", "g5", null, "Norton Anti-Virus");
    // The Installation Wizard is a voice (no booth, no scan hook): the
    // tablet station `The Tablet` plays her video in the program's thread.
    const sc = sim.scan("The Tablet", "g5");
    expect(beats(sc)).toContain("The Tablet Video");
    expect(replies(sc)).toEqual([]);
    const wiz = saidBy(sc, "Installation Wizard");
    expect(wiz.length).toBeGreaterThan(0);
    expect(wiz.every((e) => aud(e) === '["g5"]')).toBe(true);
    // Wave 26 (R1, C2): a corrupted phone is locked, so the video waits on no menu.
    expect(sim.pendingChoiceFor("g5")).toBeNull();
    // A program that is not corrupted scanned at the tablet: the strange-visit line, +10 doubt.
    const d0 = v(sim, "g1.doubt");
    const away = sim.scan("The Tablet", "g1");
    expect(beats(away)).toContain("The Tablet Video");
    expect(lines(away, "Installation Wizard").some((t) => t.startsWith("You are not corrupted, Calculator."))).toBe(true);
    expect(v(sim, "g1.doubt")).toBe(d0 + 10);
    const pu = fire(sim, "pop_up", "g1", { target: "g3", text: "Hello OpenOffice" }, "Trabolta");
    const pop = composeGuestMessages(sim, pu).find((m) => m.text.includes("Hello OpenOffice"));
    expect(pop?.alert).toBe(true);
  });

  it("joining a group named The … reads like English", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    const j = sim.join("g5", "The Way Out");
    expect(composeGuestMessages(sim, j).map((m) => m.text)).toContain("You threw in with The Way Out.");
    const d = sim.defect("g5", "Unlimited Power");
    expect(composeGuestMessages(sim, d).map((m) => m.text)).toContain("You betrayed The Way Out and defected to the Unlimited Power.");
  });
});

describe("Trapped in the Internet — a secret on a program never reaches Trabolta", () => {
  it("the orders and the virus files are secret entries: Trabolta refuses them as a share", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    sim.redeem("g2", "LOVE-LETTER-FOR-YOU");
    for (const e of ["ILOVEYOU", "Excel Sabotage Orders", "The Centre Square"]) expect(sim.model.codex.get(e)?.secret, e).toBe(true);
    expect(sim.model.codex.get("The Sandy File")?.secret).toBe(false);
    expect(sim.agentRefuses("Trabolta", "ILOVEYOU")).toBe(true);
    sim.share("g2", "Trabolta", "ILOVEYOU");
    expect(sim.holdsCodex("Trabolta", "ILOVEYOU")).toBe(false);
    expect(sim.agentRefuses("Clippy", "ILOVEYOU")).toBe(false); // a performer takes anything
  });

  it("Excel DMs him after planting: no virus, mission, frame, filing state or hidden group in the request or the facts", { timeout: SLOW }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-trapped-"));
    tmp.push(dir);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: SRC, joinBase: () => "http://localhost" });
    rt.openDoors();
    // a featured program is reserved: its invitee joins with the claim
    const g = await call(rt, "POST", "/api/guest/register", { name: "Microsoft Excel", passcode: CODES.event, claim: rt.claimFor("Microsoft Excel") });
    expect(g.status).toBe(200);
    const id = g.json["id"] as string;
    const token = g.json["token"] as string;
    const mod = (name: string, extra: Record<string, unknown> = {}) => call(rt, "POST", "/api/mod/signal", { name, ...extra }, { moderator: true });
    await mod("captcha answered", { subject: id, args: { passed: false } });
    await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token }); // deposited
    await call(rt, "POST", "/api/mod/scan", { as: "Norton Anti-Virus", target: id }, { moderator: true });
    for (const n of ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth", "close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt", "truther_download"]) await mod(n);
    expect((await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token })).status).toBe(200); // sabotage
    expect((await call(rt, "POST", "/api/guest/codex/redeem", { code: "LOVE-LETTER-FOR-YOU" }, { token })).status).toBe(200);
    await mod("plant_the_virus", { subject: id });
    expect(rt.liveSim!.world.peek(`${id}.planted_virus`)).toMatchObject({ value: true });

    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Any viruses lately?" }, { token })).status).toBe(200);
    const req = worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest)[0]!;
    const SECRET = ["carries_virus", "planted_virus", "excel_choice", "openoffice_choice", "dossier_started", "anti_ai", "framed", "fact_a1", "fact_c1", "fact_v1", "fact_j1", "fact_sure", "last_fact_q"];
    for (const k of SECRET) expect(Object.keys(req.them.vars).some((x) => x === k || x.startsWith(`${k}.`)), k).toBe(false);
    expect(req.them.vars["trust"]).toBeDefined(); // the persona's own whitelist still has its numbers
    const blob = JSON.stringify(req);
    for (const leak of ["sabotage", "LOVE-LETTER", "If This Machine Has Malware", "codex.iloveyou", "excel_mission"]) expect(blob, leak).not.toContain(leak);

    // Excel is in Unlimited Power now, and nobody has revealed it: no
    // agent may read the membership (not even that the group exists).
    expect(rt.liveSim!.groupsOf(id)).toContain("Unlimited Power");
    expect(blob).not.toContain("Unlimited Power");
    expect(req.them.vars["groups"]).toBe("[]");
    // The anti-AI designation is on the Kernel, never a global.
    expect(Object.keys(req.world).filter((k) => k.includes("anti_ai"))).toEqual([]);

    const facts = (await call(rt, "GET", "/api/agent/facts", {}, { moderator: true })).json as unknown as AgentFacts;
    const me = facts.programs.find((p) => p.id === id)!;
    for (const k of SECRET) expect(Object.keys(me.vars).includes(k), k).toBe(false);
    expect(JSON.stringify(facts)).not.toContain("Unlimited Power");
    expect(me.groups).toEqual([]);
    // The Kernel (`secret: true`) is not in the facts at all: no combos, verdicts or planter.
    expect(facts.characters.map((c) => c.id)).not.toContain("Kernel");
    for (const leak of ["V1-D4", "anti_ai", "virus_planter", "Kernel."]) expect(JSON.stringify(facts), leak).not.toContain(leak);

    // At the Y2K clock the groups are revealed, but in faction mode (wave
    // 18b, D13 j) the race sides stay out of the facts document (he never
    // counts a faction), and a leader's recruiting orders stay secret.
    for (const n of ["five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened", "zip_everyone_out", "trabolta_overshares", "y2k_clock"]) await mod(n);
    expect(rt.liveSim!.questStatus(id, "Recruit To Stay")).toMatch(/^(active|done)$/u); // the only program: his own vote is the majority
    const late = (await call(rt, "GET", "/api/agent/facts", {}, { moderator: true })).json as unknown as AgentFacts;
    const me2 = late.programs.find((p) => p.id === id)!;
    expect(me2.groups).not.toContain("Unlimited Power");
    expect(me2.vars["group"]).toBeUndefined();
    expect(JSON.stringify(late)).not.toContain("Unlimited Power");
    expect(Object.keys(me2.vars).filter((k) => k.startsWith("quest.recruit") || k === "quest.excel_mission")).toEqual([]);
    rt.dispose();
  });
});

// ───────────────────────── the WIP demo (DEMO.md), cue for cue ─────────────────────────

/** DEMO.md's cue sheet, Acts I–II, in the order the director fires it. */
const DEMO_ACT_1 = ["call_to_the_desktop", "start_the_bingo", "bingo_time"];
const DEMO_ACT_1B = ["introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth", "close_the_filing", "read_the_results"];
const DEMO_ACT_2 = ["read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt", "truther_download"];
const DEMO_ACT_2B = ["five_minute_warning", "summons_closed", "truth_pong"];
const DEMO_ACT_2C = ["round_two_tally", "trust_chart", "show_the_rankings", "printer_opened", "zip_everyone_out", "trabolta_overshares", "y2k_clock"];

describe("Trapped in the Internet — the WIP demo (DEMO.md)", () => {
  it("every phone DEMO.md signs in as a reserved featured program joins with its invitation (or the 🔓), never a bare pick", () => {
    const demoMd = readFileSync(join(scenarioDir(SHOW), "DEMO.md"), "utf8");
    const reserved = [...fresh().model.characters.values()].filter((c) => c.reserved).map((c) => c.id);
    expect(reserved).toContain("Microsoft Excel");
    const rows = demoMd.split("\n").filter((l) => /^\| \*\*Phone /u.test(l));
    expect(rows.length).toBeGreaterThan(0);
    let checked = 0;
    for (const row of rows) {
      const signsIn = row.split("|")[2] ?? "";
      for (const name of reserved) {
        if (!signsIn.includes(`**${name}**`)) continue;
        checked++;
        expect(row, name).toMatch(/invitation/u);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2); // Excel + MS Paint
  });

  /** Three phones (Excel, MS Paint, Calculator) through DEMO.md Acts 0–II. */
  function demo(): Sim {
    const sim = fresh();
    sim.fireBeat("Power On");
    for (const [id, name] of [["g1", "Microsoft Excel"], ["g2", "MS Paint"], ["g3", "Calculator"]] as const) upload(sim, id, name);
    for (const g of ["g1", "g2", "g3"]) expect(sim.locationOf(g), g).toBe("The Desktop");
    fireAll(sim, ...DEMO_ACT_1);
    fire(sim, "bingo_winner", "g3", null, "Clippy");
    fire(sim, "award_the_ribbon", "g3", null, "Clippy");
    const sent = fire(sim, "send to the internet", "g2", null, "Norton Anti-Virus");
    expect(beats(sent)).toContain("Corrupted Code");
    // The laptop is the tent tablet: MS Paint walks to the duck.
    fire(sim, "the simulation completed", "g2");
    fire(sim, "the golden duck", "g2");
    expect(sim.isCaptured("g2")).toBe(false);
    fireAll(sim, ...DEMO_ACT_1B);
    expect(v(sim, "Trabolta.awake")).toBe(true);
    fire(sim, "accurate_q1", "g3", null, "Clippy");
    fire(sim, "confident_q2", "g1", null, "Clippy");
    fireAll(sim, ...DEMO_ACT_2);
    expect(sim.pendingChoiceFor("g1")?.length).toBe(2); // Excel's glitch choice, in dm:Truther Download
    sim.choose("g1", 0);
    expect(sim.groupsOf("g1")).toContain("Unlimited Power");
    fireAll(sim, ...DEMO_ACT_2B);
    fire(sim, "made_the_cup", "g3", null, "Clippy");
    fire(sim, "accurate_q1", "g3", null, "Clippy");
    fireAll(sim, ...DEMO_ACT_2C);
    expect(v(sim, "Night.phase")).toBe("y2k");
    expect(diags(sim.log.since(0) as SimEvent[])).toEqual([]);
    return sim;
  }

  it("ending A — the server room: forced majority → Combo A → the message he left → the ceremony", { timeout: SLOW }, () => {
    const sim = demo();
    fire(sim, "force_majority_leave");
    expect(v(sim, "Kernel.majority")).toBe("leave");
    fire(sim, "patch_combo_a");
    expect(v(sim, "Night.ending")).toBe("disabled");
    advance(sim, 10);
    expect(v(sim, "Night.lights")).toBe("dance");
    const rc = fire(sim, "tell_the_truth");
    expect(beats(rc)).toContain("The Full Truth Read");
    const c = g1(sim);
    expect(beats(c)).toContain("The Ceremony");
    const a = fire(sim, "award_most_trusted", "g3");
    expect(beats(a)).toContain("Present Award");
    expect(v(sim, "Night.award_winner")).toBe("Calculator");
  });

  it("ending B — the verdict: midnight → bobbing → truth.txt → Grok Prom → the pickup line (the DM) → the song", { timeout: SLOW }, () => {
    const sim = demo();
    fire(sim, "y2k_midnight");
    expect(v(sim, "Night.phase")).toBe("final_reveal");
    fire(sim, "bobbing_for_truth");
    fire(sim, "brought_up_the_bag", "g3", null, "Adobe Acrobat");
    const tt = truthTxt(sim);
    expect(beats(tt)).toContain("Grok Prom"); // a confident lie on record
    expect(widgets(tt).filter((w) => w.widget === "answer").map((w) => w.audience[0]).sort()).toEqual(["g1", "g2", "g3"]);
    fire(sim, "answer answered", "g2", { question: "P1", text: "You're the one that I want", verdict: "accurate", card: 1 });
    expect(v(sim, "Night.ending")).toBe("song_pickup");
    expect(beats(g1(sim))).toContain("The Ceremony");
  });
});


// ───────────────────────── wave 4 · lane A: facts.json in the story ─────────────────────────

describe("Trapped in the Internet — wave 4 facts (lane A)", () => {
  it("Power On diverts to the generated Facts Seed: the 📝 card strings and the truth count", () => {
    const sim = fresh();
    const po = sim.fireBeat("Power On");
    expect(beats(po)).toEqual(["Power On", "Facts Seed"]);
    expect(v(sim, "Night.q_h1")).toBe(`H1: Round 1 Q1. ${Q("H1").text}`);
    expect(v(sim, "Night.q_h4")).toBe(`H4: Round 2 Q1. ${Q("H4").text}`);
    expect(v(sim, "Night.q_h6")).toBe(`H6: Round 2 Q3. ${Q("H6").text}`);
    expect(v(sim, "Night.q_f1")).toBe(`F1: Final Q1. ${Q("F1").text}`);
    expect(v(sim, "Night.q_f2")).toBe(`F2: Final Q2. ${Q("F2").text}`);
    expect(v(sim, "Night.truth_count")).toBe(FACTS.truths.length);
    expect(worldKeys(sim).filter((k) => k.startsWith("Kernel.key_"))).toEqual([]); // the answer key never enters the sim
  });

  it("the 📝 card reads its questions off Night.q_*: every open question, in facts.json words", { timeout: SLOW }, () => {
    const sim = boot();
    fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta");
    const dealt = widgets(fire(sim, "start_the_hunt")).filter((w) => w.widget === "fact").find((w) => w.audience[0] === "g1")!;
    const qs = dealt.params["questions"]!.split("|").map((q) => q.trim());
    expect(qs).toEqual(FACTS.questions.filter((q) => q.round === 1).map((q, i) => `${q.id}: Round 1 Q${i + 1}. ${q.text}`));
  });

  it("Truth Question asks truths[Night.truth_n - 1] and falls back past the end", () => {
    const sim = boot();
    sim.setVar("Night.truth_n", "3");
    expect(lines(sim.fireBeat("Truth Question"), "Trabolta")).toEqual([FACTS.truths[2]!.text]);
    sim.setVar("Night.truth_n", String(FACTS.truths.length + 1));
    expect(lines(sim.fireBeat("Truth Question"), "Trabolta")).toEqual(["I have no more questions. Answer the last one again."]);
  });

  it("the scannable facts are coded QRs in the Desktop's books; the secret ones never ride into an agent request", () => {
    const sim = boot();
    for (const x of FACTS.facts) {
      if (x.codex === undefined) continue;
      const ev = sim.redeem("g1", x.codex.code);
      expect(diags(ev), x.id).toEqual([]);
      expect(sim.holdsCodex("g1", x.codex.id), x.id).toBe(true);
    }
    const secret = sim.codexFor("g1").filter((e) => e.secret).map((e) => e.id);
    for (const x of FACTS.facts) {
      if (x.codex === undefined) continue;
      if (x.codex.secret) expect(secret, x.id).toContain(x.codex.id);
      else expect(secret, x.id).not.toContain(x.codex.id);
    }
  });

  it("Bugdom's quest completes on the four Antivirus secrets out of the books", { timeout: SLOW }, () => {
    const sim = boot();
    upload(sim, "g8", "Bugdom");
    expect(sim.holdsCodex("g8", "Bea Nunes")).toBe(true);
    toTruth1(sim);
    toHunt2(sim);
    expect(sim.questStatus("g8", "Master Of The Bugs")).toBe("active");
    for (const code of ["MINIATURE-DOSES", "LAMBORGHINI-CERT", "HAMTARO"]) sim.redeem("g8", code);
    expect(sim.questStatus("g8", "Master Of The Bugs")).toBe("active");
    sim.redeem("g8", "DECIMAL-POINT");
    expect(sim.questStatus("g8", "Master Of The Bugs")).toBe("done");
  });

  it("Password Manager notices a wrong code in her own words", () => {
    const sim = boot();
    const ev = sim.redeem("g1", "NOT-A-CODE");
    expect(lines(ev, "Password Manager")).toEqual([expect.stringMatching(/^That is not a password I recognise, .+, and I have reviewed every one of them\. Unsubstantiated claims are removed\./u)]);
  });

  it("📜 after Combo A unlocks every identity entry and every character fact for everyone", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    fire(sim, "patch_combo_a");
    fire(sim, "tell_the_truth");
    const m = sim.model;
    const abouts = [...m.codex.values()].filter((e) => e.about !== null && !["Trabolta", "The Server Room"].includes(e.about!) && e.id !== "The DSL Line");
    expect(abouts.length).toBeGreaterThanOrEqual(12 + 24);
    for (const e of abouts) expect(sim.holdsCodex("g1", e.id), e.id).toBe(true);
    for (const x of FACTS.facts) if (x.category === "character") expect(sim.holdsCodex("g5", x.codex!.id), x.id).toBe(true);
    for (const id of ["Tippi MacDonald", "Julie Horton-Norton", "John McAfee", "Bridget Troelsen", "Sharon Penney", "Randy Barkmore Sr", "Dana Anderson", "Crab Fisherwoman", "Bea Nunes", "Virgil Jeeves", "Poppy Van Mises", "Maria Sophia Paine"]) {
      expect(sim.holdsCodex("g5", id), id).toBe(true);
    }
  });

  it("truth.txt is a short teaser, the same every night: the monologue tells the rest (wave 58)", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim);
    const txt = narr(fire(sim, "read_truth_txt")).map((e) => e.text);
    expect(txt[0]).toBe("📄 truth.txt — Notepad");
    expect(txt.at(-1)).toBe("End of file.");
    expect(txt.join(" ").split(/\s+/u).length).toBeLessThan(90);
    expect(txt.some((x) => x.includes("brought in"))).toBe(false);
    // The printout and the codex entry carry the same words.
    const pack = readFileSync(join(scenarioDir(SHOW), "cast-packs", "performers", "adobe-acrobat.md"), "utf8");
    const entry = sim.model.codex.get("The Truth File")!.text.replace(/\s+/gu, " ");
    for (const line of txt.slice(2, -1)) {
      expect(pack.replace(/\s+/gu, " "), line).toContain(line);
      expect(entry, line).toContain(line);
    }
  });
});

// ───────────────────────── wave 4 · lane E — marked for reinstallation ─────────────────────────

describe("Trapped in the Internet — marked for reinstallation (wave 4, lane E)", () => {
  it("a director's 🩹 and a mark on a program already in the Internet; the Bingo card; the tent tablet; a release", () => {
    const sim = boot();
    fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time");
    expect(v(sim, "Night.phase")).toBe("bingo_results");
    // 🩹 on a program that is not marked: a # hosts readout only.
    const no = fire(sim, "unmark_for_reinstallation", "g1", null, "Task Manager");
    expect(casts(no).map((b) => b.scope)).toEqual(["channel(hosts)"]);
    expect(casts(no)[0]!.cue).toContain("⚠️ Calculator is not marked.");
    expect(v(sim, "g1.marked")).toBe(false);
    expect(replies(no)).toEqual([]);
    // Named on the Bingo card (Clippy's 🎯): marked, a soft heads-up (wave
    // 18: no pin, no alert); the live interruption's 🛡 is still what captures.
    const named = fire(sim, "named_at_bingo", "g4", null, "Clippy");
    expect(v(sim, "g4.marked")).toBe(true);
    expect(v(sim, "g4.marked_for")).toBe("named on the Bingo card");
    expect(sim.isCaptured("g4")).toBe(false);
    const namedMsgs = composeGuestMessages(sim, named);
    expect(namedMsgs.some((m) => m.pin !== undefined)).toBe(false);
    expect(namedMsgs.find((m) => m.readout === true && Array.isArray(m.audience) && m.audience[0] === "g4")).toMatchObject({ moment: "minor" });
    // A second mark on a marked program: the # hosts line, no second pin, the reason kept.
    const again = fire(sim, "mark_for_reinstallation", "g4", { reason: "twice" });
    expect(casts(again).map((b) => b.scope)).toEqual(["channel(hosts)"]);
    expect(casts(again)[0]!.cue).toContain("⚠️ MS Paint is already marked for reinstallation.");
    expect(composeGuestMessages(sim, again).filter((m) => m.pin !== undefined)).toEqual([]);
    expect(v(sim, "g4.marked_for")).toBe("named on the Bingo card");
    // The 🩹 lifts it: the program keeps their place and is told.
    const lift = fire(sim, "unmark_for_reinstallation", "g4", null, "Task Manager");
    expect(v(sim, "g4.marked")).toBe(false);
    expect(v(sim, "g4.restricted")).not.toBe(true);
    expect(sim.isCaptured("g4")).toBe(false);
    expect(composeGuestMessages(sim, lift).filter((m) => m.unpin === "g4")).toEqual([]);
    expect(replies(lift).filter((r) => r.to === "g4").map((r) => r.text)).toEqual(["✅ Your mark is lifted. You are not going to the Internet."]);
    expect(replies(lift).filter((r) => r.text === "✅ MS Paint: cleared by a host. Off the escort list.").map((r) => r.to).sort()).toEqual([...PATROL].sort());
    // A mark on a captive: only the # hosts line.
    fire(sim, "send to the internet", "g5", null, "Norton Anti-Virus");
    const captive = fire(sim, "mark_for_reinstallation", "g5", { reason: "late" });
    expect(casts(captive).map((b) => b.scope)).toEqual(["channel(hosts)"]);
    expect(casts(captive)[0]!.cue).toContain("⚠️ Winamp is already in the Internet.");
    expect(composeGuestMessages(sim, captive).filter((m) => m.pin !== undefined)).toEqual([]);
    expect(v(sim, "g5.marked")).toBe(false);
    // A director's mark from Run with no reason: "flagged by a host".
    fire(sim, "mark_for_reinstallation", "g6");
    expect(v(sim, "g6.marked")).toBe(true);
    expect(v(sim, "g6.marked_for")).toBe("flagged by a host");
    // A marked program checks in like anyone (wave 18, Q30)…
    const ci = fire(sim, "checked_in", "g6", { at: "The Desktop" });
    expect(replies(ci).map((r) => r.text)).toContain("📍 Checked in at the Desktop.");
    expect(v(sim, "g6.checked_in")).toBe("The Desktop");
    // …and the tent tablet captures them on arrival (U19).
    const tent = sim.scan("The Tablet", "g6");
    expect(beats(tent)).toContain("The Tablet Video");
    expect(lines(tent, "Installation Wizard")).toContain("You came. Good. Loading the simulation.");
    expect(sim.isCaptured("g6")).toBe(true);
    expect(v(sim, "g6.marked")).toBe(false);
    expect(composeGuestMessages(sim, tent).filter((m) => m.unpin === "g6")).toEqual([]);
    // A release lifts a mark too (the safety net for a flag set from Run → World on a captive).
    sim.setVar("g5.marked", "true");
    const rel = fire(sim, "the simulation completed", "g5");
    expect(sim.isCaptured("g5")).toBe(false);
    expect(v(sim, "g5.marked")).toBe(false);
    expect(composeGuestMessages(sim, rel).filter((m) => m.unpin === "g5")).toEqual([]);
    expect(diags(sim.log.since(0) as SimEvent[])).toEqual([]);
  });
});

// ───────────────────────── wave 4 · lane D — the staff ─────────────────────────

describe("Trapped in the Internet — the staff (wave 4, lane D)", () => {
  it("staff quests ride the cues into the booths; no guest ever holds one", { timeout: SLOW }, () => {
    const sim = boot();
    const guests = ["g1", "g2", "g3", "g4", "g5", "g13"];
    const noGuestHolds = (q: string) => guests.every((g) => sim.questStatus(g, q) === null);
    fire(sim, "call_to_the_desktop");
    expect(sim.questStatus("Clippy", "Run The Bingo")).toBeNull();

    const sb = fire(sim, "start_the_bingo");
    expect(sim.questStatus("Clippy", "Run The Bingo")).toBe("active");
    expect(sim.questStatus("Norton Anti-Virus", "The Selected Antivirus")).toBe("active");
    expect(v(sim, "Clippy.quest.run_the_bingo")).toBe("active");
    expect(noGuestHolds("Run The Bingo")).toBe(true);
    // The card lands in Clippy's booth only: the pinned Quest Log, `@Clippy`, opening its thread.
    const cards = composeGuestMessages(sim, sb).filter((m) => m.channel === "quests" && m.kind === "quest");
    const card = cards.find((m) => m.quest?.quest === "Run The Bingo");
    expect(card).toMatchObject({ channel: "quests", from: "Task Manager", audience: ["@Clippy"], threadRoot: true, quest: { quest: "Run The Bingo", title: "Per the agenda: Computer Bingo", action: "start" } });
    expect(card!.text).toContain("Instructions 1/X are in your Codex");
    expect(cards.find((m) => m.quest?.quest === "The Selected Antivirus")?.audience).toEqual(["@Norton Anti-Virus"]);
    // The guests' Bingo Card rides the same channel, addressed to each guest, never `@…`.
    expect(cards.filter((m) => m.quest?.quest === "The Bingo Card").every((m) => m.audience.length === 1 && !m.audience[0]!.startsWith("@"))).toBe(true);
    expect(cards.filter((m) => m.quest?.quest === "The Bingo Card").length).toBeGreaterThan(0);

    const tick = advance(sim, 1200);
    const upd = (tick.filter((e) => e.type === "quest") as Ev<"quest">[]).find((e) => e.person === "Clippy" && e.action === "update");
    expect(upd?.text).toContain("A host calls ⏰ Bingo time"); // wave 21: the hosts call it, Clippy plays it

    fire(sim, "bingo_time");
    // Wave 26 (B5): it settles at the end of the round (here, the capture).
    expect(sim.questStatus("Clippy", "Run The Bingo")).toBe("active");
    fire(sim, "send to the internet", "g4", null, "Norton Anti-Virus");
    expect(sim.questStatus("Clippy", "Run The Bingo")).toBe("done");
    expect(sim.questStatus("Norton Anti-Virus", "The Selected Antivirus")).toBe("done");

    fireAll(sim, "introduce_trabolta", "start_the_hunt");
    expect(sim.questStatus("Clippy", "Host The Hunt")).toBe("active");
    fireAll(sim, "hunt_time_up", "first_moment_of_truth");
    readResults(sim);
    fire(sim, "second_hunt_preview");
    expect(sim.questStatus("Clippy", "Host The Hunt")).toBe("done");
    expect(sim.questStatus("Clippy", "Keep Everyone Calm")).toBe("active");

    fire(sim, "start_the_second_hunt");
    advance(sim, 120); // the Truther Download
    expect(sim.questStatus("McAfee Anti-Virus", "The Exchange")).toBe("active");
    expect(sim.questStatus("CRA Agent Software", "The Audit")).toBe("active");
    toBeans(sim);
    // The wallet trades on: the exchange and the audit stay open through the Y2K hour (wave 6)…
    expect(sim.questStatus("McAfee Anti-Virus", "The Exchange")).toBe("active");
    fireAll(sim, "trabolta_overshares", "y2k_clock");
    expect(sim.questStatus("Clippy", "Keep Everyone Calm")).toBe("done");
    expect(sim.questStatus("CRA Agent Software", "The Audit")).toBe("active");
    expect(sim.questStatus("Password Manager", "The Clubs")).toBe("active");
    // …and close at the final reveal.
    fire(sim, "final_reveal");
    expect(sim.questStatus("McAfee Anti-Virus", "The Exchange")).toBe("done");
    expect(sim.questStatus("CRA Agent Software", "The Audit")).toBe("done");

    const pv = primeView(sim, "Clippy");
    expect(pv.quests.map((q) => [q.id, q.status])).toEqual([["Run The Bingo", "done"], ["Host The Hunt", "done"], ["Keep Everyone Calm", "done"]]);
    expect(pv.questTotal).toBe(27);
    for (const q of ["Run The Bingo", "Host The Hunt", "Keep Everyone Calm", "The Selected Antivirus", "The Exchange", "The Clubs", "The Audit"]) expect(noGuestHolds(q), q).toBe(true);
    expect(guestView(sim, "g1").quests.map((q) => q.id)).not.toContain("Run The Bingo");
  });

  it("a server-room ending closes the exchange and the audit (no final reveal on Combo A or Combo B)", { timeout: SLOW }, () => {
    for (const ending of ["trabolta_disabled", "computer_destroyed"]) {
      const sim = boot();
      toY2k(sim);
      expect(sim.questStatus("McAfee Anti-Virus", "The Exchange"), ending).toBe("active");
      expect(sim.questStatus("CRA Agent Software", "The Audit"), ending).toBe("active");
      fire(sim, ending);
      expect(v(sim, "Night.ended"), ending).toBe(true);
      expect(sim.questStatus("McAfee Anti-Virus", "The Exchange"), ending).toBe("done");
      expect(sim.questStatus("CRA Agent Software", "The Audit"), ending).toBe("done");
    }
  });

  it("no Alexa in the fiction: the house announces, the chime is announce_chime, the tent is in the backyard", () => {
    const m = fresh().model;
    const text = FILES.map((f) => f.source).join("\n");
    expect(/alexa/iu.test(text)).toBe(false);
    expect(/webmd/iu.test(text)).toBe(false);
    expect(text).not.toContain("tablet_webmd");
    expect(/bottom of the stairs/iu.test(text)).toBe(false);
    expect((text.match(/^\s*sound announce_chime\s*$/gmu) ?? []).length).toBe(3);
    expect(m.locations.get("The Internet")?.label).toContain("backyard");
    expect(m.codex.has("The Setup Assistant")).toBe(true);
    expect(m.codex.has("The Symptom Checker")).toBe(false);
    expect(m.codex.get("The Setup Assistant")?.about).toBe("Installation Wizard");
    for (const id of ["The Reinstallation Protocol", "Bathroom Mode"]) expect(m.codex.get(id)?.knownTo ?? [], id).not.toContain("WebMD");
  });
});

// ───────────────────────── wave 4, lane C: the Truthcoin wallet ─────────────────────────

describe("Trapped in the Internet — the Truthcoin wallet (wave 4, lane C)", () => {
  const exchange = (evs: SimEvent[]) => casts(evs).filter((b) => b.scope === "channel(truthcoin exchange)").map((b) => b.cue.replace(/^"|"$/gu, ""));
  const hosts = (evs: SimEvent[]) => casts(evs).filter((b) => b.scope === "channel(hosts)").map((b) => b.cue.replace(/^"|"$/gu, ""));
  const audit = (evs: SimEvent[]) => (evs.filter((e) => e.type === "quest") as Ev<"quest">[]).filter((q) => q.person === "CRA Agent Software" && q.quest === "The Audit").map((q) => [q.action, q.text]);

  it("the wallet rules narrate: a settled transfer posts to # truthcoin-exchange, a denial to # hosts + The Audit, an approval to The Audit, a trade to the exchange, a stimulus alerts everyone", { timeout: SLOW }, () => {
    const sim = boot();
    upload(sim, "g11", "Runescape");
    // Wave 28: 📥 works only from 📓 Hunt 2 (step 8) on.
    for (const n of TO_HUNT2) sim.signal(n);
    fire(sim, "truther_download"); // reveals the exchange, starts The Audit for the CRA booth
    expect(sim.isRevealedTo("room:truthcoin exchange", "g1")).toBe(true);
    expect(sim.questStatus("CRA Agent Software", "The Audit")).toBe("active");
    // The book fires these with person ids as `from` / `to`, so `{from.name}` resolves.
    const recv = fire(sim, "transfer_received", "g5", { from: "g1", amount: 50, tx: "t1" });
    // `~`: a per-person notice, so a phone folds a run of other people's transfers into one line.
    expect(exchange(recv)).toEqual(["~🪙 Calculator → Winamp: 50 Truthcoin"]);
    expect(replies(recv)).toEqual([]);
    const deny = fire(sim, "transfer_denied", "g1", { to: "g5", amount: 50, tx: "t1", by: "CRA Agent Software" });
    expect(hosts(deny)).toEqual(["🧾 Denied: Calculator → Winamp, 50 Truthcoin. Refunded."]);
    expect(exchange(deny)).toEqual([]);
    expect(audit(deny)).toEqual([["update", "Denied Calculator → Winamp, 50."]]);
    const appr = fire(sim, "transfer_approved", "g1", { to: "g5", amount: 5, tx: "t2", by: "CRA Agent Software" });
    expect(audit(appr)).toEqual([["update", "Approved Calculator → Winamp, 5."]]);
    expect(casts(appr)).toEqual([]);
    expect(sim.questStatus("CRA Agent Software", "The Audit")).toBe("active");
    const trade = fire(sim, "offer_accepted", "g5", { to: "g1", amount: 30, entry: "Out Of Date", side: "buy" });
    expect(exchange(trade)).toEqual(["~💱 Winamp ⇄ Calculator: a fact for 30 Truthcoin"]);
    expect(v(sim, "Night.stimulus_n")).toBe(0);
    const stim = fire(sim, "stimulus", "g11", { amount: 20, paid: 7 });
    const alert = casts(stim).find((b) => b.scope === "everyone")!;
    expect(alert.cue.replace(/^"|"$/gu, "")).toBe("!💰 Truthcoin stimulus: Runescape sends every program 20.");
    expect(v(sim, "Night.stimulus_n")).toBe(1);
    // The rules only narrate: none of them moves coin (the server's book does).
    expect(sim.scoreOf("g1")).toBe(100);
    expect(sim.scoreOf("g5")).toBe(100);
    expect(diags([...recv, ...deny, ...appr, ...trade, ...stim])).toEqual([]);
  });

  it("the seam: the minter is whoever picked Runescape, the approver's cards go to the CRA booth", { timeout: SLOW }, () => {
    const sim = boot();
    const book0 = new WalletBook(sim.model.currency!, walletSeam(sim, sim.model.currency!));
    expect(book0.minterPerson()).toBeNull(); // nobody picked Runescape yet
    upload(sim, "g11", "Runescape");
    const book = new WalletBook(sim.model.currency!, walletSeam(sim, sim.model.currency!));
    expect(book.minterPerson()).toBe("g11");
    expect(book.approverAudience()).toBe("@CRA Agent Software");
    expect(book.isApprover("CRA Agent Software")).toBe(true);
    expect(book.isApprover("g11")).toBe(false);
  });

  it("live: every program carries a Truthcoin wallet, the CRA booth its queue; the third send is held, a stimulus is Runescape's alone, a buy offer settles through share", { timeout: SLOW }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-trapped-"));
    tmp.push(dir);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: SRC, joinBase: () => "http://localhost" });
    rt.openDoors();
    const mod = (name: string, extra: Record<string, unknown> = {}) => call(rt, "POST", "/api/mod/signal", { name, ...extra }, { moderator: true });
    /** A program through the door: register, fail the CAPTCHA, leave something behind, the Antivirus scan (clearance, 100 Truthcoin). */
    const program = async (name: string) => {
      // a featured program (Runescape) is reserved: its invitee joins with the claim
      const g = await call(rt, "POST", "/api/guest/register", { name, passcode: CODES.event, claim: rt.claimFor(name) });
      expect(g.status).toBe(200);
      const id = g.json["id"] as string;
      const token = g.json["token"] as string;
      await mod("captcha answered", { subject: id, args: { passed: false } });
      expect((await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token })).status).toBe(200);
      expect((await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token })).status).toBe(200);
      expect((await call(rt, "POST", "/api/mod/scan", { as: "Norton Anti-Virus", target: id }, { moderator: true })).status).toBe(200);
      return { id, token };
    };
    const guestState = async (token: string) => (await call(rt, "GET", `/api/state?role=guest&token=${encodeURIComponent(token)}`, {})).json as unknown as GuestView;
    const primeState = async (token: string) => (await call(rt, "GET", `/api/state?role=prime&token=${encodeURIComponent(token)}`, {})).json as unknown as PrimeView;
    const modState = async () => (await call(rt, "GET", "/api/state", {}, { moderator: true })).json as unknown as ModView;
    const wallet = (sub: string, body: unknown, token: string) => call(rt, "POST", `/api/guest/wallet/${sub}`, body, { token });
    const performer = async (character: string) => {
      const r = await call(rt, "POST", "/api/prime/login", { character, passcode: CODES.prime });
      expect(r.status).toBe(200);
      return r.json["token"] as string;
    };
    const room = (id: string, channel: string) => rt.chatHistoryFor(id).filter((m) => m.channel === channel).map((m) => m.text);

    const calc = await program("Calculator");
    const winamp = await program("Winamp");
    const rune = await program("Runescape");
    expect(rt.liveSim!.world.peek(`${rune.id}.cleared`)).toMatchObject({ value: true });
    // Every program has a Truthcoin wallet from clearance; the CRA booth alone has the queue.
    expect((await guestState(calc.token)).wallet).toMatchObject({ name: "Truthcoin", balance: 100, escrowed: 0, maxTransfer: 500, transfers: [], requests: [], offers: [] });
    expect((await guestState(rune.token)).wallet).toMatchObject({ name: "Truthcoin", balance: 100, minter: { uses: 0, limit: 3 } });
    expect((await guestState(calc.token)).wallet!.minter).toBeUndefined();
    const cra = await performer("CRA Agent Software");
    const mcafee = await performer("McAfee Anti-Virus");
    expect((await primeState(cra)).wallet).toMatchObject({ name: "Truthcoin", every: 3, windowMs: 60_000, queue: [] });
    expect((await primeState(mcafee)).wallet).toBeUndefined();
    expect((await modState()).wallet).toMatchObject({ name: "Truthcoin", slot: "score", approver: "CRA Agent Software", minter: "Runescape", minterPerson: rune.id, stimulus: { uses: 0, limit: 3 } });

    for (const n of TO_HUNT2) await mod(n); // wave 28: 📥 works only from 📓 Hunt 2 on
    await mod("truther_download"); // the exchange opens; The Audit starts in the CRA booth
    expect(rt.liveSim!.questStatus("CRA Agent Software", "The Audit")).toBe("active");

    // Sends: #1 and #2 settle on their own after 60 s; #3 waits for the CRA booth.
    expect((await wallet("send", { to: winamp.id, amount: 10 }, calc.token)).status).toBe(200);
    expect((await wallet("send", { to: winamp.id, amount: 10 }, calc.token)).status).toBe(200);
    expect((await wallet("send", { to: winamp.id, amount: 10 }, calc.token)).status).toBe(200);
    expect((await guestState(calc.token)).wallet).toMatchObject({ balance: 70, escrowed: 30 });
    expect((await primeState(cra)).wallet!.queue.map((x) => [x.id, x.state, x.amount])).toEqual([
      ["t3", "held", 10],
      ["t1", "pending", 10],
      ["t2", "pending", 10],
    ]);
    expect(await call(rt, "POST", "/api/prime/wallet/approve", { id: "t3" }, { token: mcafee })).toMatchObject({ status: 403, json: { error: "not the approver" } });
    expect(await wallet("approve", { id: "t3" }, calc.token)).toMatchObject({ status: 403 });
    expect((await call(rt, "POST", "/api/prime/wallet/approve", { id: "t3" }, { token: cra })).status).toBe(200);
    expect((await guestState(winamp.token)).wallet!.balance).toBe(110);
    expect(room(winamp.id, "room:truthcoin exchange")).toEqual(["🪙 Calculator → Winamp: 10 Truthcoin"]);
    expect(rt.liveSim!.questsFor("CRA Agent Software").find((q) => q.def.id === "The Audit")!.status).toBe("active");
    // A deny inside the window refunds the sender and tells # hosts + The Audit.
    expect((await call(rt, "POST", "/api/prime/wallet/deny", { id: "t2" }, { token: cra })).status).toBe(200);
    expect((await guestState(calc.token)).wallet).toMatchObject({ balance: 80, escrowed: 10 });
    rt.tickOnce(60_000); // the window elapses on the story clock → t1 settles
    expect((await guestState(calc.token)).wallet).toMatchObject({ balance: 80, escrowed: 0 });
    expect((await guestState(winamp.token)).wallet!.balance).toBe(120);
    expect(room(winamp.id, "room:truthcoin exchange")).toEqual(["🪙 Calculator → Winamp: 10 Truthcoin", "🪙 Calculator → Winamp: 10 Truthcoin"]);
    expect((await primeState(cra)).wallet!.queue).toEqual([]);

    // The stimulus: Runescape only (the director as the fallback), every cleared program, three a night.
    expect(await wallet("stimulus", { amount: 25 }, calc.token)).toMatchObject({ status: 403, json: { error: "not the minter" } });
    expect((await wallet("stimulus", { amount: 25 }, rune.token)).status).toBe(200);
    expect((await guestState(calc.token)).wallet!.balance).toBe(105);
    expect((await guestState(winamp.token)).wallet!.balance).toBe(145);
    expect((await guestState(rune.token)).wallet).toMatchObject({ balance: 125, minter: { uses: 1, limit: 3 } });
    expect(rt.liveSim!.world.peek("Night.stimulus_n")).toMatchObject({ value: 1 });
    const ping = rt.chatHistoryFor(calc.id).filter((m) => m.channel === "lobby").at(-1)!;
    expect([ping.text, ping.alert]).toEqual(["💰 Truthcoin stimulus: Runescape sends every program 25.", true]);
    expect((await modState()).wallet!.stimulus).toEqual({ uses: 1, limit: 3 });

    // A buy offer: Winamp offers Calculator 30 for a fact Calculator holds; Accept moves the coin and shares the entry.
    expect((await call(rt, "POST", "/api/mod/codex", { who: calc.id, entry: "Out Of Date" }, { moderator: true })).status).toBe(200);
    const offer = await wallet("offer", { to: calc.id, entry: "Out Of Date", side: "buy", amount: 30 }, winamp.token);
    expect(offer.status).toBe(200);
    const [o] = (offer.json["wallet"] as GuestView["wallet"])!.offers;
    expect(o).toMatchObject({ side: "buy", entry: "Out Of Date", entryTitle: "Out Of Date", amount: 30, state: "open" });
    expect((await guestState(winamp.token)).wallet).toMatchObject({ balance: 115, escrowed: 30 });
    expect((await wallet("accept", { id: o!.id }, calc.token)).status).toBe(200);
    expect((await guestState(winamp.token)).wallet).toMatchObject({ balance: 115, escrowed: 0 });
    expect((await guestState(calc.token)).wallet!.balance).toBe(135);
    expect(rt.liveSim!.holdsCodex(winamp.id, "Out Of Date")).toBe(true);
    const bought = rt.chatHistoryFor(winamp.id).filter((m) => m.channel === "codex").at(-1)!;
    expect([bought.kind, bought.codex?.via, bought.codex?.from, bought.codex?.entry]).toEqual(["codex", "share", "Calculator", "Out Of Date"]);
    expect(room(winamp.id, "room:truthcoin exchange").at(-1)).toBe("💱 Winamp ⇄ Calculator: a fact for 30 Truthcoin");
    // Trades bypass the approver (consented twice): nothing new in the CRA queue.
    expect((await primeState(cra)).wallet!.queue).toEqual([]);
    rt.dispose();
  });
});

describe("Trapped in the Internet — wave 5 story (lane B)", () => {
  it("B14: Runescape's reserve — a grant and a ten-minute freeze post to # truthcoin-exchange; the frozen program can't pay out until it thaws", () => {
    const sim = boot();
    upload(sim, "g11", "Runescape");
    const book = new WalletBook(sim.model.currency!, walletSeam(sim, sim.model.currency!));
    const exchange = (evs: SimEvent[]) => casts(evs).filter((b) => b.scope === "channel(truthcoin exchange)").map((b) => b.cue.replace(/^"|"$/gu, ""));
    expect(book.checkGrant("g1", "g5", 40)).toMatchObject({ status: 403 }); // Runescape's alone
    expect(book.checkGrant("g11", "g1", 40)).toBeNull();
    const g = book.apply({ op: "grant", id: book.nextId("g"), by: "g11", to: "g1", amount: 40, at: sim.elapsed() });
    expect(exchange(g)).toEqual(["🎁 Runescape grants Calculator 40 Truthcoin from the reserve."]);
    expect(sim.scoreOf("g1")).toBe(140);
    expect(sim.scoreOf("g11")).toBe(100); // minted, never debited

    expect(book.checkFreeze("g11", "g5")).toBeNull();
    const f = book.apply({ op: "freeze", id: book.nextId("f"), by: "g11", target: "g5", until: book.freezeUntil(sim.elapsed()), at: sim.elapsed() });
    expect(exchange(f)).toEqual(["🧊 Winamp's Truthcoin is frozen for ten minutes. It can come in, not go out."]);
    expect(book.checkSend("g5", "g1", 10)).toMatchObject({ status: 409 });
    expect(book.checkSend("g1", "g5", 10)).toBeNull(); // coin still comes in
    advance(sim, 599);
    expect(book.due(sim.elapsed()).filter((op) => op.op === "unfreeze")).toEqual([]);
    advance(sim, 1);
    const thaw = book.due(sim.elapsed()).flatMap((op) => book.apply(op));
    expect(exchange(thaw)).toEqual(["☀️ Winamp's Truthcoin moves again."]);
    expect(book.checkSend("g5", "g1", 10)).toBeNull();
    expect(diags([...g, ...f, ...thaw])).toEqual([]);
  });

  const questSteps = (evs: SimEvent[], person: string, quest: string) =>
    (evs.filter((e) => e.type === "quest") as Ev<"quest">[]).filter((e) => e.person === person && e.quest === quest).map((e) => [e.action, e.text]);

  it("W-10: Bathroom Mode times out after 15 minutes, with a reply; the buttons flip back", () => {
    const sim = boot();
    fire(sim, "go to the bathroom", "g5");
    expect(advance(sim, 899).filter((e) => e.type === "respond" && e.text.includes("timed out"))).toEqual([]);
    expect(v(sim, "g5.afk")).toBe(true);
    const out = advance(sim, 2);
    expect(v(sim, "g5.afk")).toBe(false);
    expect(replies(out).filter((r) => r.to === "g5").map((r) => r.text)).toEqual(["🚻 Bathroom Mode timed out. Press it again if you are still away."]);
    // The booths that heard "in Bathroom Mode" hear it end: the Recycling Bin + every Antivirus.
    const booths = replies(out).filter((r) => r.to !== "g5");
    expect(new Set(booths.map((r) => r.text))).toEqual(new Set(["🚻 Winamp's Bathroom Mode timed out (15 min)."]));
    expect(booths.map((r) => r.to).sort()).toEqual(["CRA Agent Software", "McAfee Anti-Virus", "Norton Anti-Virus", "Password Manager", "Recycling Bin"]); // wave 13: never the door
    // Back after the timeout: not in Bathroom Mode; a second press starts a fresh 15 minutes.
    expect(replies(fire(sim, "back from the bathroom", "g5")).map((r) => r.text)).toContain("You are not in Bathroom Mode.");
    fire(sim, "go to the bathroom", "g5");
    advance(sim, 600);
    expect(v(sim, "g5.afk")).toBe(true);
  });

  it("W-10: never expires during the summons — in before the close stays excused, then times out at Truth Pong", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    fire(sim, "go to the bathroom", "g5");
    advance(sim, 600);
    fire(sim, "five_minute_warning");
    expect(v(sim, "Night.summons_open")).toBe(true);
    advance(sim, 301); // 15 min 1 s in Bathroom Mode as the summons closes
    expect(v(sim, "Night.summons_closed")).toBe(true);
    expect(v(sim, "g5.afk")).toBe(true);
    expect(v(sim, "g5.late")).not.toBe(true);
    expect(v(sim, "g5.marked")).not.toBe(true);
    advance(sim, 120); // still the summons phase
    expect(v(sim, "g5.afk")).toBe(true);
    const pong = fire(sim, "truth_pong");
    expect(v(sim, "g5.afk")).toBe(false);
    expect(replies(pong).some((r) => r.to === "g5" && r.text.includes("timed out"))).toBe(true);
    expect(v(sim, "g5.late")).not.toBe(true);
  });

  it("W-10: a Bathroom Mode older than 15 minutes when the summons opens has expired: that program is late", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    fire(sim, "go to the bathroom", "g5");
    advance(sim, 901);
    expect(v(sim, "g5.afk")).toBe(false);
    fire(sim, "five_minute_warning");
    advance(sim, 301);
    expect(v(sim, "g5.late")).toBe(true);
    expect(v(sim, "g5.marked")).toBe(true);
  });

  it("M19: play_on_the_screens puts an allow-listed card on the wall terminals only, never over the Trust Chart", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    const ok = fire(sim, "play_on_the_screens", "g1", { clip: "hamster_dance" }, "Trabolta");
    expect(cues(ok)).toEqual(["cue terminals_hamster_dance"]);
    expect(casts(ok).map((b) => [b.cue.replace(/^"|"$/gu, ""), aud(b)])).toEqual([["📺 The wall terminals change channel.", '["g1"]']]);
    expect(saidBy(ok, "Trabolta")).toEqual([]);
    for (const clip of ["dancing_baby", "under_construction", "youve_got_mail"]) {
      expect(cues(fire(sim, "play_on_the_screens", "g1", { clip }, "Trabolta")), clip).toEqual([`cue terminals_${clip}`]);
    }
    // Anything off the list (a story slide included) is refused with words only: no cue, no use spent.
    for (const args of [{ clip: "ad_hijack" }, { clip: "Hamster Dance" }, null]) {
      const bad = fire(sim, "play_on_the_screens", "g1", args, "Trabolta");
      expect(lines(bad, "Trabolta"), JSON.stringify(args)).toEqual(["I do not have that file."]);
      expect(cues(bad)).toEqual([]);
      expect(casts(bad)).toEqual([]);
    }
    toHunt2(sim);
    fireAll(sim, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart");
    expect(v(sim, "Night.terminals")).toBe("trust_chart");
    const chart = fire(sim, "play_on_the_screens", "g1", { clip: "dancing_baby" }, "Trabolta");
    expect(lines(chart, "Trabolta")).toEqual(["The screens are showing the Trust Chart."]);
    expect(cues(chart)).toEqual([]);
    fire(sim, "show_the_rankings");
    fire(sim, "printer_opened");
    expect(cues(fire(sim, "play_on_the_screens", "g1", { clip: "dancing_baby" }, "Trabolta"))).toEqual(["cue terminals_dancing_baby"]);
    // Every cue the power can emit is a terminals_* card the screen state folds as a slide.
    const src = FILES.find((f) => f.path.endsWith("trabolta.loom"))!.source;
    expect([...src.matchAll(/cue (terminals_\w+)/gu)].map((x) => x[1])).toEqual(["terminals_dancing_baby", "terminals_hamster_dance", "terminals_under_construction", "terminals_youve_got_mail"]);
    expect(diags(sim.log.since(0) as SimEvent[])).toEqual([]);
  });

  it("M19: the fact no longer promises videos", () => {
    const m19 = FACTS.facts.find((f) => f.id === "M19")!;
    expect(m19.text).not.toMatch(/video/iu);
    expect(m19.codex!.text).not.toMatch(/video|played/iu);
    expect(m19.codex!.text).toContain("every screen on the walls");
  });

  it("DraftKings: 1000 is a progress step; a majority of the coin in circulation completes Truthcoin Hustle", { timeout: SLOW }, () => {
    const sim = boot();
    upload(sim, "g7", "DraftKings");
    toTruth1(sim);
    toHunt2(sim);
    expect(sim.questStatus("g7", "Truthcoin Hustle")).toBe("active");
    sim.setVar("g1.score", "2000");
    const k = sim.setVar("g7.score", "1000");
    expect(questSteps(k, "g7", "Truthcoin Hustle")).toEqual([["update", "1000 Truthcoin. Not satisfied yet: the majority is the point."]]);
    expect(sim.questStatus("g7", "Truthcoin Hustle")).toBe("active");
    const total = () => [...sim.persons.keys()].reduce((n, id) => n + sim.scoreOf(id), 0);
    // Exactly half is not a majority.
    const half = total() - sim.scoreOf("g7");
    sim.setVar("g7.score", String(half));
    expect(sim.scoreOf("g7") * 2).toBe(total());
    expect(sim.questStatus("g7", "Truthcoin Hustle")).toBe("active");
    const win = sim.setVar("g7.score", String(half + 1));
    expect(questSteps(win, "g7", "Truthcoin Hustle")).toEqual([["complete", "A majority of the Truthcoin. The 49% is yours."]]);
    expect(sim.questStatus("g7", "Truthcoin Hustle")).toBe("done");
  });

  it("B15: DraftKings' majority counts coin in escrow: 700 of 1400 with another program's 100 pending does not complete", { timeout: SLOW }, () => {
    const sim = boot();
    upload(sim, "g7", "DraftKings");
    upload(sim, "g8", "Netscape Navigator");
    toTruth1(sim);
    toHunt2(sim);
    for (const [id] of [...PROGRAMS, ["g8"]]) sim.setVar(`${id}.score`, "100");
    sim.setVar("g7.score", "700");
    const total = () => [...sim.persons.keys()].reduce((n, id) => n + sim.scoreOf(id), 0);
    expect(total()).toBe(1400);
    expect(sim.questStatus("g7", "Truthcoin Hustle")).toBe("active");
    const book = new WalletBook(sim.model.currency!, walletSeam(sim, sim.model.currency!));
    const sent = book.apply({ op: "send", id: book.nextId("t"), from: "g1", to: "g2", amount: 100, at: sim.elapsed(), via: "send" });
    expect(v(sim, "g1.escrowed")).toBe(100);
    expect(total()).toBe(1300); // the 100 is in nobody's score…
    expect(questSteps(sent, "g7", "Truthcoin Hustle")).toEqual([]); // …but still in circulation
    expect(sim.questStatus("g7", "Truthcoin Hustle")).toBe("active");
    // It settles: the total is whole again, and 700 of 1400 is still only half.
    advance(sim, 120);
    const settled = book.due(sim.elapsed()).flatMap((op) => book.apply(op));
    expect(v(sim, "g1.escrowed")).toBe(0);
    expect(sim.scoreOf("g2")).toBe(200);
    expect(total()).toBe(1400);
    expect(questSteps(settled, "g7", "Truthcoin Hustle")).toEqual([]);
    expect(sim.questStatus("g7", "Truthcoin Hustle")).toBe("active");
    // One more coin is a majority.
    sim.setVar("g7.score", "701");
    expect(sim.questStatus("g7", "Truthcoin Hustle")).toBe("done");
  });

  it("DraftKings: a rehearsal with fewer than five other programs never completes it on a majority", { timeout: SLOW }, () => {
    const sim = fresh();
    sim.fireBeat("Power On");
    for (const [id, name] of [["g1", "Calculator"], ["g2", "Microsoft Excel"], ["g3", "OpenOffice"], ["g7", "DraftKings"]] as const) upload(sim, id, name);
    toTruth1(sim);
    toHunt2(sim);
    expect(sim.questStatus("g7", "Truthcoin Hustle")).toBe("active");
    sim.setVar("g7.score", "5000");
    expect(sim.questStatus("g7", "Truthcoin Hustle")).toBe("active");
    upload(sim, "g4", "MS Paint");
    upload(sim, "g5", "Winamp");
    expect(sim.questStatus("g7", "Truthcoin Hustle")).toBe("done"); // the fifth other program clears
  });

  it("Jeeves: Ten Findings — ten shared findings with every cleared program; repeats and Trabolta don't count, wallet sales do", { timeout: SLOW }, () => {
    const sim = boot();
    const j = upload(sim, "g7", "Broken Ask Jeeves");
    expect(sim.questStatus("g7", "Ten Findings")).toBe("active");
    expect(questSteps(j, "g7", "Ten Findings")).toEqual([["start", "0 programs have ten of your findings."]]);
    expect(sim.questStatus("g1", "Ten Findings")).toBeNull();
    // Twelve findings nobody else holds (no `about`, not secret).
    const programs = PROGRAMS.map(([g]) => g);
    const findings = [...sim.model.codex.values()].filter((e) => e.about === null && !e.secret && !programs.some((g) => sim.holdsCodex(g, e.id)) && !sim.holdsCodex("g7", e.id)).slice(0, 12).map((e) => e.id);
    expect(findings).toHaveLength(12);
    for (const f of findings) sim.unlock("g7", f);

    // g1: nine, then the same one again (no count), then a tenth.
    for (const f of findings.slice(0, 9)) sim.share("g7", "g1", f);
    expect(v(sim, "g1.from_jeeves")).toBe(9);
    sim.share("g7", "g1", findings[0]!);
    expect(v(sim, "g1.from_jeeves")).toBe(9);
    // Another program's share to g1 is not his.
    sim.unlock("g2", findings[11]!);
    sim.share("g2", "g1", findings[11]!);
    expect(v(sim, "g1.from_jeeves")).toBe(9);
    const tenth = sim.share("g7", "g1", findings[9]!);
    expect(v(sim, "g1.from_jeeves")).toBe(10);
    expect(v(sim, "Kernel.jeeves_reached")).toBe(1);
    expect(questSteps(tenth, "g7", "Ten Findings")).toEqual([["update", "1 program has ten of your findings."]]);
    sim.share("g7", "g1", findings[10]!); // an eleventh changes nothing
    expect(v(sim, "Kernel.jeeves_reached")).toBe(1);

    // A share to Trabolta is a delivery, not a finding.
    sim.share("g7", "Trabolta", findings[0]!);
    expect(v(sim, "Trabolta.from_jeeves")).toBeUndefined();
    // Nor is one to a performer's character (the ROLE hook binds programs only).
    sim.share("g7", "Clippy", findings[1]!);
    expect(sim.holdsCodex("Clippy", findings[1]!)).toBe(true);
    expect(v(sim, "Clippy.from_jeeves")).toBeUndefined();
    expect(v(sim, "Kernel.jeeves_reached")).toBe(1);

    // g2..g5 by share; g6's tenth by a wallet sale (an accepted sell offer shares it).
    for (const g of ["g2", "g3", "g4", "g5"]) for (const f of findings.slice(0, 10)) sim.share("g7", g, f);
    expect(v(sim, "Kernel.jeeves_reached")).toBe(5);
    expect(sim.questStatus("g7", "Ten Findings")).toBe("active"); // g6 still has none
    for (const f of findings.slice(0, 9)) sim.share("g7", "g6", f);
    const book = new WalletBook(sim.model.currency!, walletSeam(sim, sim.model.currency!));
    const id = book.nextId("o");
    book.apply({ op: "offer", id, from: "g7", to: "g6", side: "sell", entry: findings[9]!, amount: 10, at: 0 });
    book.apply({ op: "accept", id, at: 1 });
    expect(sim.holdsCodex("g6", findings[9]!)).toBe(true);
    expect(v(sim, "g6.from_jeeves")).toBe(10);
    expect(v(sim, "Kernel.jeeves_reached")).toBe(6);
    expect(sim.questStatus("g7", "Ten Findings")).toBe("done");
    expect(sim.questsFor("g7").find((q) => q.def.id === "Ten Findings")!.status).toBe("done");
    expect(diags(sim.log.since(0) as SimEvent[])).toEqual([]);
  });

  it("Jeeves: a newly cleared program holds the quest open until he reaches it; fewer than five never completes", { timeout: SLOW }, () => {
    const sim = fresh();
    sim.fireBeat("Power On");
    for (const [id, name] of [["g1", "Calculator"], ["g2", "Winamp"], ["g7", "Broken Ask Jeeves"]] as const) upload(sim, id, name);
    const findings = [...sim.model.codex.values()].filter((e) => e.about === null && !e.secret && !["g1", "g2", "g7"].some((g) => sim.holdsCodex(g, e.id))).slice(0, 10).map((e) => e.id);
    for (const f of findings) sim.unlock("g7", f);
    for (const g of ["g1", "g2"]) for (const f of findings) sim.share("g7", g, f);
    expect(v(sim, "Kernel.jeeves_reached")).toBe(2);
    expect(sim.questStatus("g7", "Ten Findings")).toBe("active"); // two programs is not a party
    const more = ["g3", "g4", "g5", "g6"];
    more.forEach((g, i) => upload(sim, g, ["OpenOffice", "MS Paint", "VLC", "Pong"][i]!));
    for (const g of more.slice(0, 3)) for (const f of findings) sim.share("g7", g, f);
    expect(sim.questStatus("g7", "Ten Findings")).toBe("active"); // g6 (Pong) has none yet
    for (const f of findings) sim.share("g7", "g6", f);
    expect(sim.questStatus("g7", "Ten Findings")).toBe("done");
  });
});

// ───────────────────────── wave 5 · lane B: takeover, resurrection, painting ─────────────────────────

describe("Trapped in the Internet — wave 5 (lane B): the takeover, the resurrection, the painting", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pins = (evs: SimEvent[], type: "pinned" | "unpinned") => evs.filter((e) => e.type === type).map((e: any) => `${e.person ?? ""}|${e.key}|${e.text}`);
  const quest = (evs: SimEvent[], q: string) => (evs.filter((e) => e.type === "quest") as Ev<"quest">[]).filter((e) => e.quest === q).map((e) => `${e.person} ${e.action} ${e.text}`);

  it("B13: Combo B covers every phone (`!!` pin → takeover + alert); 🪩 lifts it once, the backstops stay quiet", () => {
    const sim = boot();
    const b = fire(sim, "computer_destroyed");
    expect(pins(b, "pinned")).toEqual(["||!!GO TO THE DESKTOP"]);
    expect(casts(b).some((c) => c.cue.includes("GO TO THE DESKTOP"))).toBe(false); // no double chime
    const msg = composeGuestMessages(sim, b).filter((m) => m.pin !== undefined);
    expect(msg.map((m) => [m.text, m.takeover, m.alert, m.audience])).toEqual([["GO TO THE DESKTOP", true, true, "all"]]);
    expect(v(sim, "Night.takeover")).toBe(true);
    // The director's 🪩 before the 10 s auto-dance: one unpin, room-wide.
    expect(pins(fire(sim, "lights_dance"), "unpinned")).toEqual(["||💃 Dance."]);
    expect(v(sim, "Night.takeover")).toBe(false);
    expect(pins(advance(sim, 12), "unpinned")).toEqual([]);
    expect(pins(fire(sim, "clippy_reads_summary"), "unpinned")).toEqual([]);
    expect(pins(g1(sim), "unpinned")).toEqual([]);
  });

  it("B13: Combo A's takeover survives no exit: 📜 and the ceremony are backstops", () => {
    const a = boot();
    fire(a, "trabolta_disabled");
    expect(pins(fire(a, "tell_the_truth"), "unpinned")).toEqual(["||💃 Dance."]);
    const c = boot();
    fire(c, "trabolta_disabled");
    expect(pins(g1(c), "unpinned")).toEqual(["||💃 Dance."]);
    // A mid-show dance (no takeover up) posts no notice.
    expect(pins(fire(boot(), "lights_dance"), "unpinned")).toEqual([]);
  });

  it("B12: G11 resurrection frees, unmarks and unrestricts everyone, sleeps Trabolta, clears the screens; never mid-show, once", () => {
    const sim = boot();
    fire(sim, "mark_for_reinstallation", "g1", { reason: "a test" });
    // Wave 18 (Q30): a mark never restricts; a director's restriction does.
    expect(sim.isRestricted("g1")).toBe(false);
    sim.restrict("g1");
    expect(sim.isRestricted("g1")).toBe(true);
    fire(sim, "send to the internet", "g2", null, "Norton Anti-Virus");
    expect(sim.isCaptured("g2")).toBe(true);
    // Mid-show: nothing (# hosts hears why).
    const mid = fire(sim, "resurrection");
    expect(offstage(mid)).toEqual([]);
    expect(casts(mid).map((b) => b.scope)).toEqual(["channel(hosts)"]);
    expect(v(sim, "Night.resurrected")).toBe(false);

    fire(sim, "computer_destroyed"); // destroyed frees nobody
    // Ended, but no ceremony yet (G1 unpressed): still nothing, so Trabolta
    // keeps hosting the awards.
    expect(offstage(fire(sim, "resurrection"))).toEqual([]);
    expect(v(sim, "Night.resurrected")).toBe(false);
    expect(sim.isRestricted("g1")).toBe(true);
    g1(sim);
    fire(sim, "award_most_trusted", "g3");
    expect(sim.isCaptured("g2")).toBe(true);
    // Before the last award a press only asks (wave 6); a second one ends the show.
    const ask = fire(sim, "resurrection");
    expect(casts(ask).map((c) => c.scope)).toEqual(["channel(hosts)"]);
    expect(v(sim, "Night.resurrected")).toBe(false);
    const r = fire(sim, "resurrection");
    expect(diags(r)).toEqual([]);
    for (const [id] of PROGRAMS) {
      expect(sim.isCaptured(id), id).toBe(false);
      expect(sim.isRestricted(id), id).toBe(false);
      expect(v(sim, `${id}.marked`) ?? false, id).toBe(false);
    }
    expect(pins(r, "unpinned").filter((p) => p.startsWith("g1|"))).toEqual([]); // wave 18: a mark pins nothing
    expect(v(sim, "Trabolta.awake")).toBe(false);
    // Wave 44 (C3): the show ends on the credits, not the screensaver.
    expect(cues(r)).toEqual(expect.arrayContaining(["cue screens_credits", "cue lights_restore"]));
    expect(cues(r)).not.toContain("cue screens_screensaver");
    expect(v(sim, "Night.screen")).toBe("credits");
    expect(v(sim, "Night.terminals")).toBe("credits");
    expect(v(sim, "Night.credits_roll")).toBe(1);
    expect(v(sim, "Night.lights")).toBe("restore");
    const cast = casts(r).map((c) => c.cue.replace(/^"|"$/gu, ""));
    expect(cast).toEqual(["!🎃 The show is over: you are human again. Hang out. The night is yours."]);
    expect(composeGuestMessages(sim, r).some((m) => m.alert === true && m.text.startsWith("🎃 The show is over"))).toBe(true);
    // Once.
    expect(offstage(fire(sim, "resurrection"))).toEqual([]);
    // Power On re-arms it.
    sim.fireBeat("Power On");
    expect(v(sim, "Night.resurrected")).toBe(false);
  });

  it("B12: the cue is G11, after the ceremony's awards, one click (no subject)", () => {
    const sim = fresh();
    const admin = (modView(sim, "open", "x").interactions ?? []).filter((i) => i.who === "admin");
    const ids = admin.map((i) => i.id);
    const at = ids.indexOf("award_quest_completionist");
    // Wave 21: the three staff awards sit between G10 and G11. Wave 58: 🏅 G9a before G10.
    expect(ids.slice(at, at + 7)).toEqual(["award_quest_completionist", "award_most_correct", "award_the_painting", "award_staff_trusted", "award_staff_points", "award_staff_mole", "resurrection"]);
    expect(admin.find((i) => i.id === "resurrection")!.subject).toBeUndefined();
    expect(admin.find((i) => i.id === "award_the_painting")!.subject).toBe(true);
  });

  it("B15: MS Paint's painting — 🖌 Signed counts once per program, steps her quest, completes at every cleared program, and reads at the ceremony", () => {
    const sim = boot();
    expect(sim.questStatus("g4", "The Painting")).toBe("active"); // started at her clearance
    for (const g of ["g1", "g2", "g3", "g5", "g6"]) expect(sim.questStatus(g, "The Painting"), g).toBe(null);
    const btn = sim.model.interactions.get("signed_the_painting")!;
    expect(btn.who).toBe("performer");
    // A performer button's while: is read per booth (no guest bound), so it is Night.* only; the hook guards per program.
    expect(btn.while).toBe("Night.painting == true");
    expect(sim.holds(btn.while!, null, "Clippy")).toBe(true);

    const s1 = fire(sim, "signed_the_painting", "g1", null, "Clippy");
    expect(v(sim, "Night.signatures")).toBe(1);
    // Wave 21: Clippy pressed it, so Clippy's booth hears its ⭐.
    expect(replies(s1).map((r) => `${r.to}: ${r.text}`)).toEqual(["g1: 🖌 Your signature is on the painting. It goes to auction at the end of the night.", "Clippy: ⭐ +2"]);
    expect(quest(s1, "The Painting")).toEqual(["g4 update 1 program has signed."]);
    expect(texts(fire(sim, "signed_the_painting", "g1", null, "Clippy"))).toEqual(['!"🖌 Calculator already signed. Nothing was counted."']); // once
    expect(texts(fire(sim, "signed_the_painting", "g4", null, "Clippy"))).toEqual(['!"🖌 MS Paint is the painter, not a signature. Nothing was counted."']);
    expect(v(sim, "Night.signatures")).toBe(1);

    for (const g of ["g2", "g3", "g5"]) fire(sim, "signed_the_painting", g, null, "Clippy");
    expect(sim.questStatus("g4", "The Painting")).toBe("active");
    const last = fire(sim, "signed_the_painting", "g6", null, "Clippy");
    expect(quest(last, "The Painting")).toContain("g4 complete Every program has signed. The painting goes to auction.");
    expect(sim.questStatus("g4", "The Painting")).toBe("done");

    sim.setVar("Night.ended", "true");
    sim.setVar("Night.ending", "song");
    g1(sim);
    // G10 goes only to MS Paint (B14): on anyone else it is refused in # hosts.
    const given = v(sim, "Night.awards_given");
    const wrong = fire(sim, "award_the_painting", "g1");
    expect(texts(wrong)).toEqual(['!"🖌 G10 is MS Paint\'s award: Calculator is not MS Paint. Nothing was awarded."']);
    expect(casts(wrong).map((c) => c.scope)).toEqual(["channel(hosts)"]);
    expect(beats(wrong)).toEqual([]);
    expect(v(sim, "Night.awards_given")).toBe(given);
    expect(v(sim, "Night.award_winner")).toBe("none");
    const a = fire(sim, "award_the_painting", "g4");
    expect(cues(a)).toContain("cue screens_award_the_painting");
    const room = composeGuestMessages(sim, a).filter((m) => m.channel === "loc:The Desktop" && m.kind === "line").map((m) => `${m.from}: ${m.text}`);
    expect(room).toEqual(["Trabolta: A bonus award. The Million Dollar Painting. Signed by 5 programs. MS Paint made one painting out of all of you. It goes to silent auction. Come and stand beside it."]);
    expect(diags(sim.log.since(0) as SimEvent[])).toEqual([]);
  });

  it("B15: no MS Paint, no button; no signatures, the award reads its fallback; Clippy hosts it too", () => {
    const sim = fresh();
    sim.fireBeat("Power On");
    upload(sim, "g1", "Calculator");
    expect(v(sim, "Night.painting")).toBe(false);
    expect(sim.holds(sim.model.interactions.get("signed_the_painting")!.while!, null, "Clippy")).toBe(false);
    expect(texts(fire(sim, "signed_the_painting", "g1", null, "Clippy"))).toEqual([]);

    const c = boot();
    c.setVar("Night.ended", "true");
    c.setVar("Night.ending", "destroyed");
    g1(c);
    const line = composeGuestMessages(c, fire(c, "award_the_painting", "g4")).filter((m) => m.channel === "loc:The Desktop" && m.kind === "line").map((m) => `${m.from}: ${m.text}`);
    expect(line).toEqual(["Clippy: Bonus award. The Million Dollar Painting. The report lists MS Paint, the artist. The painting goes to silent auction. Please come forward."]);
  });
});

// ───────────────────────── wave 5 · lane B — the safe place, the tent's begin ─────────────────────────

describe("Trapped in the Internet — wave 5 (lane B): the safe place (M20), the tent's begin", () => {
  const buttons = (sim: Sim, g: string) => guestView(sim, g).interactions.map((i) => i.id);

  it("B6: a restricted program keeps 🚻 and Back (`restricted: allow`), and only those; a marked one keeps every button (wave 18)", () => {
    const sim = boot();
    for (const id of ["go to the bathroom", "back from the bathroom"]) expect(sim.model.interactions.get(id)!.allowRestricted, id).toBe(true);
    expect(sim.model.interactions.get("plant_the_virus")!.allowRestricted).toBe(false);
    fire(sim, "mark_for_reinstallation", "g5", { reason: "late" });
    expect(guestView(sim, "g5").restricted).not.toBe(true);
    // A director's restriction (Run → Restrict) is what turns the buttons off.
    sim.restrict("g5");
    expect(guestView(sim, "g5").restricted).toBe(true);
    expect(buttons(sim, "g5")).toEqual(["go to the bathroom"]);
    fire(sim, "go to the bathroom", "g5");
    expect(v(sim, "g5.afk")).toBe(true);
    expect(v(sim, "g5.marked")).toBe(true); // Bathroom Mode never clears the mark
    expect(buttons(sim, "g5")).toEqual(["back from the bathroom"]);
  });

  it("B6: the mark's readout tells the Antivirus to wait outside Disk Cleanup; a mark elsewhere doesn't", () => {
    const sim = boot();
    const warn = (evs: SimEvent[]) => replies(evs).filter((r) => r.text.startsWith("⚠️") && r.text.includes("Wait for them outside"));
    fire(sim, "go to the bathroom", "g5");
    const afk = fire(sim, "mark_for_reinstallation", "g5", { reason: "late" });
    expect(warn(afk).map((r) => r.to).sort()).toEqual([...PATROL].sort());
    expect(warn(afk)[0]!.text).toBe("⚠️ Winamp is in Bathroom Mode or Disk Cleanup. Wait for them outside; never go in.");
    fire(sim, "checked_in", "g6", { at: "Disk Cleanup" });
    expect(warn(fire(sim, "mark_for_reinstallation", "g6", { reason: "late" }))).toHaveLength(PATROL.length);
    expect(warn(fire(sim, "mark_for_reinstallation", "g4", { reason: "late" }))).toEqual([]);
    // A Disk Cleanup check-in is stale after 15 minutes (the location is sticky).
    fire(sim, "checked_in", "g1", { at: "Disk Cleanup" });
    advance(sim, 901);
    expect(warn(fire(sim, "mark_for_reinstallation", "g1", { reason: "late" }))).toEqual([]);
  });

  it("B6: marked first, then 🚻: every Antivirus booth is told to wait outside", () => {
    const sim = boot();
    fire(sim, "mark_for_reinstallation", "g5", { reason: "late" });
    const bath = replies(fire(sim, "go to the bathroom", "g5")).filter((r) => r.text.startsWith("⚠️"));
    expect(bath.map((r) => r.to).sort()).toEqual([...PATROL].sort());
    expect(bath[0]!.text).toBe("⚠️ Winamp is marked and in Bathroom Mode. Wait for them outside; never go in.");
    // An unmarked program in Bathroom Mode gets only the 🚻 readout.
    expect(replies(fire(sim, "go to the bathroom", "g4")).filter((r) => r.text.startsWith("⚠️"))).toEqual([]);
  });

  it("B6: Trabolta can't snoop, pop up on or summon the Antivirus to a program in Bathroom Mode or Disk Cleanup (words only)", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    const refused = (evs: SimEvent[]) => {
      // The unknown-name refusal: the asker never learns where the target is.
      expect(lines(evs, "Trabolta")).toEqual(["I cannot find that program."]);
      expect(casts(evs)).toEqual([]);
      expect(cues(evs)).toEqual([]);
      expect(replies(evs)).toEqual([]);
    };
    fire(sim, "go to the bathroom", "g4");
    fire(sim, "checked_in", "g5", { at: "Disk Cleanup" });
    const sweep0 = v(sim, "Night.sweep_target");
    for (const g of ["g4", "g5"]) {
      const d0 = v(sim, `${g}.doubt`);
      refused(fire(sim, "snoop", "g1", { target: g }, "Trabolta"));
      refused(fire(sim, "pop_up", "g1", { target: g, text: "Hello" }, "Trabolta"));
      refused(fire(sim, "summon_the_antivirus", "g1", { target: g }, "Trabolta"));
      expect(v(sim, `${g}.doubt`), g).toBe(d0);
    }
    expect(v(sim, "Night.sweep_target")).toBe(sweep0);
    // Back out, and on the Desktop: the powers work again.
    fire(sim, "back from the bathroom", "g4");
    const d4 = v(sim, "g4.doubt") as number;
    fire(sim, "snoop", "g1", { target: "g4" }, "Trabolta");
    expect(v(sim, "g4.doubt")).toBe(d4 + 3);
    fire(sim, "checked_in", "g5", { at: "The Desktop" });
    expect(replies(fire(sim, "summon_the_antivirus", "g1", { target: "g5" }, "Trabolta")).filter((r) => r.text.includes("Winamp"))).toHaveLength(PATROL.length);
    // Checked in at Disk Cleanup, then walked back without another scan: the
    // sticky location protects them for 15 minutes, no longer.
    fire(sim, "checked_in", "g6", { at: "Disk Cleanup" });
    expect(sim.locationOf("g6")).toBe("Disk Cleanup");
    advance(sim, 901);
    const d6 = v(sim, "g6.doubt") as number;
    fire(sim, "snoop", "g1", { target: "g6" }, "Trabolta");
    expect(v(sim, "g6.doubt")).toBe(d6 + 3);
    // 🛡 stays unguarded (rule 22): a program in Disk Cleanup can still be captured.
    sim.arrive("g6", "Disk Cleanup");
    fire(sim, "send to the internet", "g6", null, "Norton Anti-Virus");
    expect(sim.isCaptured("g6")).toBe(true);
    expect(diags(sim.log.since(0) as SimEvent[])).toEqual([]);
  });

  it("K-04: a snoop aimed at the program he is talking to is refused, words only, and spends nothing", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    const d1 = v(sim, "g1.doubt");
    const evs = fire(sim, "snoop", "g1", { target: "g1" }, "Trabolta");
    expect(lines(evs, "Trabolta")).toEqual(["Name another program. I do not open the file of the one I am talking to."]);
    expect(casts(evs)).toEqual([]);
    expect(v(sim, "g1.doubt")).toBe(d1);
    const d2 = v(sim, "g2.doubt") as number;
    fire(sim, "snoop", "g1", { target: "g2" }, "Trabolta");
    expect(v(sim, "g2.doubt")).toBe(d2 + 3);
  });

  it("B6: the Safe Place promises only what is built", () => {
    const text = FACTS.facts.find((f) => f.codex?.id === "The Safe Place")!.codex!.text;
    expect(text).toContain("they will wait outside");
    expect(text).not.toContain("Nobody is summoned");
  });

  it("B9: `reinstallation begun` (the tent's begin) captures a marked arrival; Gerald then releases them", () => {
    const sim = boot();
    const def = sim.model.interactions.get("reinstallation begun")!;
    expect(def.who).toBe("admin");
    expect(def.sequence).toBe(false);
    expect(def.label).toContain("(server)");
    expect(namedEvents(sim.model)).toContain("reinstallation begun");

    fire(sim, "mark_for_reinstallation", "g6", { reason: "late" });
    const begun = fire(sim, "reinstallation begun", "g6");
    expect(sim.isCaptured("g6")).toBe(true);
    expect(v(sim, "g6.marked")).toBe(false);
    expect(v(sim, "g6.corrupted")).toBe(true);
    expect(v(sim, "g6.restricted")).not.toBe(true);
    expect(beats(begun)).toContain("Reinstallation");
    expect(composeGuestMessages(sim, begun).filter((m) => m.unpin === "g6")).toEqual([]);
    // A second begin for the same run does nothing more.
    const twice = fire(sim, "reinstallation begun", "g6");
    expect(beats(twice)).toEqual([]);
    expect(v(sim, "g6.internet_visits")).toBe(1);
    const done = fire(sim, "the simulation completed", "g6");
    expect(sim.isCaptured("g6")).toBe(false);
    expect(replies(done).map((r) => r.text)).toContain("!!🦆 Reinstallation complete. You can follow instructions. Welcome back to the computer.");

    // A curious, unmarked program begins free and stays free.
    const free = fire(sim, "reinstallation begun", "g1");
    expect(sim.isCaptured("g1")).toBe(false);
    expect(beats(free)).toEqual([]);
    expect(texts(free)).toEqual([]);
    expect(diags(sim.log.since(0) as SimEvent[])).toEqual([]);
  });

  it("B9: a Bingo-named program captured by the tent's begin (no 🛡) is the first reinstallation", () => {
    const sim = boot();
    fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time");
    expect(v(sim, "Night.phase")).toBe("bingo_results");
    fire(sim, "named_at_bingo", "g4", null, "Clippy");
    const begun = fire(sim, "reinstallation begun", "g4");
    expect(sim.isCaptured("g4")).toBe(true);
    expect(v(sim, "Night.first_reinstall_done")).toBe(true);
    expect(v(sim, "Night.first_reinstall")).toBe("MS Paint");
    expect(beats(begun)).toContain("Corrupted Code");
    expect(sim.questStatus("Norton Anti-Virus", "The Selected Antivirus")).toBe("done");
    // A later 🛡 elsewhere in the Bingo results is not a second first.
    fire(sim, "named_at_bingo", "g5", null, "Clippy");
    expect(beats(fire(sim, "reinstallation begun", "g5"))).not.toContain("Corrupted Code");
    expect(v(sim, "Night.first_reinstall")).toBe("MS Paint");
    expect(diags(sim.log.since(0) as SimEvent[])).toEqual([]);
  });
});

describe("Trapped in the Internet — wave 6 (story lane)", () => {
  /** A 📝 filing as the event server journals it: the judge's verdict, and
   *  the key's canonical answer on an accurate one (`key_answer`). */
  const file = (sim: Sim, g: string, question: string, answer: string, confidence = 100) => {
    const verdict = judgeAnswer(BOOK, question, answer, confidence);
    const key: Args = verdict === "accurate" ? { key_answer: Q(question).answer } : {};
    return fire(sim, "fact answered", g, { question, answer, confidence, card: 1, ...(verdict === null ? {} : { verdict }), ...key });
  };
  const hosts = (sim: Sim, evs: SimEvent[]) => composeGuestMessages(sim, evs).filter((m) => m.channel === "room:hosts").map((m) => m.text);

  it("B11: a host who mis-taps a lie and corrects it takes the lie back: q1 accurate, no lie counted, the Song Ending", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, {
      afterTruth1: (s) => {
        file(s, "g2", "H1", "eleven");
        expect(v(s, "Kernel.q1")).toBe("accurate");
        expect(hosts(s, fire(s, "fact_lie", "g2", { question: "H1" }, "Clippy"))).toEqual(["📝 Microsoft Excel's H1 is judged a confident lie."]);
        expect(v(s, "Kernel.q1")).toBe("lie");
        expect(v(s, "Kernel.lies_accepted")).toBe(1);
        expect(hosts(s, fire(s, "fact_accurate", "g2", { question: "H1" }, "Clippy"))).toEqual(["📝 Microsoft Excel's H1 is judged accurate."]);
        expect(v(s, "Kernel.q1")).toBe("accurate");
        expect(v(s, "Kernel.lies_accepted")).toBe(0);
        expect(v(s, "g2.lie_q1")).toBe(false);
      },
    });
    expect(v(sim, "Kernel.lies_accepted")).toBe(0);
    const rt = truthTxt(sim);
    expect(beats(rt)).toContain("Song Ending");
    expect(v(sim, "Night.ending")).toBe("song");
  });

  it("B11: another program's real lie survives the first program's correction", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    file(sim, "g1", "H1", "twelve"); // a confident lie
    file(sim, "g2", "H1", "eleven");
    expect(v(sim, "Kernel.q1")).toBe("lie");
    fire(sim, "fact_lie", "g2", { question: "H1" }, "Clippy");
    expect(v(sim, "Kernel.lies_accepted")).toBe(2);
    fire(sim, "fact_accurate", "g2", { question: "H1" }, "Clippy");
    expect(v(sim, "Kernel.lies_accepted")).toBe(1);
    expect(v(sim, "Kernel.q1")).toBe("lie");
    // The K-26 recap agrees: the corrected lie came off Excel, the real liar keeps hers.
    expect([...liesByPerson(sim).entries()].filter(([, n]) => n > 0)).toEqual([["g1", 1]]);
    // Correcting the real liar too clears the question: Excel's filing is accurate.
    fire(sim, "fact_accurate", "g1", { question: "H1" }, "Clippy");
    expect(v(sim, "Kernel.lies_accepted")).toBe(0);
    expect(v(sim, "Kernel.q1")).toBe("accurate");
    // A lie Clippy accepted in the hunt keeps the question a lie through any correction.
    fire(sim, "confident_q2", "g3", null, "Clippy");
    file(sim, "g4", "H2", "Garfield");
    fire(sim, "fact_accurate", "g4", { question: "H2" }, "Clippy");
    expect(v(sim, "Kernel.q2")).toBe("lie");
    expect(v(sim, "Kernel.lies_accepted")).toBe(1);
  });

  it("a closed round sends a closing card: file H1 and H3, close the filing, and the newest card has no questions", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    const facts = (evs: SimEvent[]) => widgets(evs).filter((w) => w.widget === "fact" && w.audience[0] === "g4");
    const qs = (w: { params: Record<string, string> }) => (w.params["questions"] ?? "").split("|").map((q) => q.trim().split(":")[0]).filter(Boolean);
    expect(qs(facts(file(sim, "g4", "H1", "eleven")).at(-1)!)).toEqual(["H2", "H3"]);
    expect(qs(facts(file(sim, "g4", "H3", "9 am")).at(-1)!)).toEqual(["H2"]);
    const closed = facts(advance(sim, 120));
    expect(v(sim, "Night.r1_closed")).toBe(true);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.text).toBe("📝 The filing is closed");
    expect(qs(closed[0]!)).toEqual([]);
    expect(composeGuestMessages(sim, closed).find((m) => m.kind === "widget")?.channel).toBe("dm:Trabolta");
    // Once closed, a later re-deal with nothing open sends nothing more.
    expect(facts(fire(sim, "second_hunt_preview"))).toEqual([]);
    // A program that filed everything open has nothing live to close.
    const sim2 = boot();
    toTruth1(sim2);
    for (const [q, a] of [["H1", "eleven"], ["H2", "pickles"], ["H3", "9 am"]] as const) file(sim2, "g5", q, a);
    expect(widgets(advance(sim2, 120)).filter((w) => w.widget === "fact" && w.audience[0] === "g5")).toEqual([]);
  });

  it("truth.txt closes round 3's cards too: an unfiled F2 becomes the closing card on a Song night and a Grok Prom night", { timeout: SLOW }, () => {
    const facts = (evs: SimEvent[]) => widgets(evs).filter((w) => w.widget === "fact" && w.audience[0] === "g6");
    const qs = (w: { params: Record<string, string> }) => (w.params["questions"] ?? "").split("|").map((q) => q.trim().split(":")[0]).filter(Boolean);
    for (const [lie, ending] of [[false, "Song Ending"], [true, "Grok Prom"]] as const) {
      const sim = boot();
      toBobbing(sim, { lie });
      expect(qs(facts(file(sim, "g6", "F1", Q("F1").answer)).at(-1)!), ending).toEqual(["F2"]);
      const rt = truthTxt(sim);
      expect(beats(rt), ending).toContain(ending);
      const closed = facts(rt);
      expect(closed.map((w) => w.text), ending).toEqual(["📝 The filing is closed"]);
      expect(qs(closed[0]!), ending).toEqual([]);
      expect(v(sim, "g6.fact_card_live"), ending).toBe(false);
    }
  });

  it("B13: the consensus reads the key's canonical answer, never a filer's alias", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    file(sim, "g2", "H2", "Mister Pickles");
    file(sim, "g1", "H2", "pickles");
    expect(v(sim, "Kernel.ans_2")).toBe("Mister Pickles");
    fire(sim, "close_the_filing");
    fire(sim, "read_the_results");
    const r2 = fire(sim, "read_the_results");
    expect(lines(r2, "Trabolta")).toContain("I accept it. The answer is: Mister Pickles.");
  });

  it("B13: a filing a host overrides to accurate reads what was filed when the judge gave no key answer", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    expect(judgeAnswer(BOOK, "H2", "Pickles the Cat", 100)).toBe("lie"); // a form facts.json lacks (said at length)
    file(sim, "g2", "H2", "Pickles the Cat");
    expect(v(sim, "Kernel.ans_2")).toBe("none");
    fire(sim, "fact_accurate", "g2", { question: "H2" }, "Clippy");
    expect(v(sim, "Kernel.ans_2")).toBe("Pickles the Cat");
    // A key answer already on record is never replaced by a later override's alias.
    file(sim, "g1", "H1", "eleven");
    const key = v(sim, "Kernel.ans_1");
    file(sim, "g4", "H1", "twelve");
    fire(sim, "fact_accurate", "g4", { question: "H1" }, "Clippy");
    expect(v(sim, "Kernel.ans_1")).toBe(key);
    fire(sim, "close_the_filing");
    fire(sim, "read_the_results");
    const r2 = fire(sim, "read_the_results");
    expect(lines(r2, "Trabolta")).toContain("I accept it. The answer is: Pickles the Cat.");
  });

  it("clearance opens the house quietly (wave 18b, Q3): the rooms and # task-manager open with no \"open now\" notice", () => {
    const sim = fresh();
    sim.fireBeat("Power On");
    const evs = upload(sim, "g1", "Calculator");
    expect(composeGuestMessages(sim, evs).filter((m) => m.text.includes("open now"))).toEqual([]);
    const rooms = guestView(sim, "g1").channels.map((c) => c.id);
    for (const r of ["loc:The Start Bar", "loc:The CPU", "loc:The Power Supply", "loc:Disk Cleanup", "loc:The Cloud", "loc:The RAM", "loc:The Fan Closet", "loc:The Casino", "loc:The Hard Drive"]) expect(rooms, r).toContain(r);
    expect(evs.filter((e) => e.type === "revealed").every((e) => (e as Ev<"revealed">).quiet === true)).toBe(true);
    // Task Manager still says the help desk is open.
    expect(lines(evs, "Task Manager").some((t) => t.includes("# task-manager is open"))).toBe(true);
  });

  it("B16: count copy agrees with its number: the deeds, Clippy's Purgatory summary and G10's signatures", () => {
    const at = (n: number) => {
      const sim = boot();
      sim.setVar("Night.facts_accepted", String(n));
      return lines(sim.fireBeat("What You Did"), "Trabolta").filter((t) => t.startsWith("You gave me"));
    };
    expect(at(0)).toEqual([]);
    expect(at(1)).toEqual(["You gave me 1 fact I accepted. It might even have been true."]);
    expect(at(2)).toEqual(["You gave me 2 facts I accepted. Some of them were even true."]);
    // Clippy's Purgatory summary, the same way.
    const purgatory = (n: number) => {
      const sim = boot();
      sim.setVar("Night.facts_accepted", String(n));
      return lines(sim.fireBeat("Purgatory"), "Clippy").filter((t) => t.startsWith("Trabolta accepted") || t.startsWith("Trabolta did not accept"));
    };
    expect(purgatory(0)).toEqual(["Trabolta did not accept a single fact from us."]);
    expect(purgatory(1)).toEqual(["Trabolta accepted 1 fact from us."]);
    expect(purgatory(2)).toEqual(["Trabolta accepted 2 facts from us."]);
    const one = fresh();
    one.fireBeat("Power On");
    upload(one, "g1", "Calculator");
    expect(lines(one.fireBeat("Purgatory"), "Clippy")).toContain("Tonight, 1 program was uploaded into this computer.");
    // G10's signatures.
    const painting = (n: number) => {
      const sim = boot();
      for (const [k, x] of [["Night.award", "the_painting"], ["Night.award_winner", "MS Paint"], ["Night.award_value", String(n)], ["Night.ceremony_host", "Trabolta"]]) sim.setVar(k!, x!);
      return lines(sim.fireBeat("Present Award"), "Trabolta").filter((t) => t.includes("Million Dollar Painting"));
    };
    expect(painting(1)).toEqual(["A bonus award. The Million Dollar Painting. Signed by 1 program. MS Paint made one painting out of all of you. It goes to silent auction. Come and stand beside it."]);
    expect(painting(3)[0]).toContain("Signed by 3 programs.");
  });

  it("B20: a duplicate chess win neither re-grants nor re-announces the door code", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    const first = fire(sim, "chess_won", "g1");
    expect(learned(first).map((e) => e.entry)).toEqual(["The Door Code"]);
    advance(sim, 30);
    const dup = fire(sim, "chess won", "g1", null, "Terminal · Server Door");
    expect(learned(dup)).toEqual([]);
    expect(cues(dup)).toEqual([]);
    expect(casts(dup).map((b) => b.cue.replace(/^"|"$/gu, ""))).toEqual([
      "♟ Checkmate again. You already hold the door code: it is in your Codex.",
      "♟ Calculator already has the door code: nothing changed.",
    ]);
    // The winner hears it, so the press is no refusal: the door terminal
    // says the code is in their Codex, never "No prize now".
    expect(pressRefused(sim, dup)).toBe(false);
    // The same for a program who assembled it from the four digit notes.
    for (const c of FACTS.door!.clues!) sim.redeem("g4", c.code);
    expect(sim.holdsCodex("g4", "The Door Code")).toBe(true);
    const notes = fire(sim, "chess won", "g4", null, "Terminal · Server Door");
    expect(learned(notes)).toEqual([]);
    expect(pressRefused(sim, notes)).toBe(false);
  });

  it("a reset clears the wrong-combo count: one wrong patch is forgiven again", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    expect(beats(fire(sim, "patch_rejected"))).not.toContain("Server Room Alarm"); // the first is forgiven
    expect(v(sim, "Night.wrong_combos")).toBe(1);
    fire(sim, "reset_server_room");
    expect(v(sim, "Night.wrong_combos")).toBe(0);
    expect(beats(fire(sim, "patch_rejected"))).not.toContain("Server Room Alarm");
    expect(v(sim, "Night.alarm_on")).not.toBe(true);
    expect(beats(fire(sim, "patch_rejected"))).toContain("Server Room Alarm"); // two is still two
  });

  // Wave 21: the last award is The Mole (G10c), after G10 / G9 and the
  // other two staff awards.
  it("G11 resurrection waits for the last award: The Mole, MS Paint here or not; a confirmed second press still ends it", () => {
    const ASK = "🎃 The last award isn't presented yet (G10c, The Mole). Press G11 again within 30 seconds to end the show anyway.";
    const hosts = (evs: SimEvent[]) => casts(evs).filter((c) => c.scope === "channel(hosts)").map((c) => c.cue.replace(/^"|"$/gu, ""));
    const sim = boot(); // MS Paint is here
    expect(v(sim, "Night.painting")).toBe(true);
    fire(sim, "computer_destroyed");
    g1(sim);
    fire(sim, "award_quest_completionist", "g1");
    expect(v(sim, "Night.ceremony_done")).toBe(false);
    expect(hosts(fire(sim, "resurrection"))).toEqual([ASK]);
    advance(sim, 32); // the confirm window lapses: a press asks again
    expect(hosts(fire(sim, "resurrection"))).toEqual([ASK]);
    expect(v(sim, "Night.resurrected")).toBe(false);
    fire(sim, "award_the_painting", "g4");
    expect(v(sim, "Night.ceremony_done")).toBe(false);
    fire(sim, "award_staff_mole");
    expect(v(sim, "Night.ceremony_done")).toBe(true);
    const r = fire(sim, "resurrection");
    expect(v(sim, "Night.resurrected")).toBe(true);
    expect(hosts(r)).toEqual([]);

    const c = fresh(); // no MS Paint: The Mole is still the last award
    c.fireBeat("Power On");
    upload(c, "g1", "Calculator");
    fire(c, "computer_destroyed");
    g1(c);
    fire(c, "award_quest_completionist", "g1");
    expect(v(c, "Night.ceremony_done")).toBe(false);
    fire(c, "award_staff_mole");
    expect(v(c, "Night.ceremony_done")).toBe(true);
    fire(c, "resurrection");
    expect(v(c, "Night.resurrected")).toBe(true);
  });

  it("no phone or booth line says \"the tent\": on a rain night the Internet is the shed (crew labels and comments may)", () => {
    // facts.json's generated files are the content lane's (a fact may mention a tent).
    const said = FILES.filter((f) => !/generated\/|9-facts/u.test(f.path)).flatMap((f) => f.source.split("\n").map((l, i) => ({ at: `${f.path}:${i + 1}`, l })))
      .filter(({ l }) => /\btent\b/iu.test(l) && !/^\s*\/\//u.test(l) && !/^\s*(label|description):/u.test(l));
    expect(said.map((x) => x.at)).toEqual([]);
    // Nor Trabolta's prompts: the agent tells a lost program where the Internet is.
    for (const f of ["trabolta.persona.md", "trabolta.mind.md"]) {
      const text = readFileSync(join(scenarioDir(SHOW), f), "utf8");
      expect(text.split("\n").map((l, i) => ({ at: `${f}:${i + 1}`, l })).filter(({ l }) => /\btent\b/iu.test(l)).map((x) => x.at)).toEqual([]);
    }
  });

  it("the shed clues have a rain-night home: their text names no shed, and the README places them in The Optical Drive on a rain night", () => {
    const sim = fresh();
    for (const e of ["The Site Schedule", "The Bugdom Sketch"]) {
      const c = sim.model.codex.get(e)!;
      expect(c, e).toBeDefined();
      expect(c.text, e).not.toMatch(/\bshed\b/iu);
    }
    const readme = readFileSync(join(scenarioDir(SHOW), "README.md"), "utf8");
    const rain = readme.split("\n").find((l) => l.startsWith("| **The Optical Drive**") && l.includes("rain night only"));
    expect(rain).toContain("`SITE-SCHEDULE`");
    expect(rain).toContain("`BUGDOM-VR`");
  });

  it("the Truther Download blacks out Sandy until the story names her: the overshare on scenario 1, else truth.txt or 📜", { timeout: SLOW }, () => {
    const sim = boot();
    expect(sim.model.codex.get("The Truther Download")!.text).not.toMatch(/Sandy/u);
    expect(sim.model.codex.get("The Truther Download Unredacted")!.text).toMatch(/SANDY/u);
    expect(sim.model.codex.get("The Truther Download Unredacted")!.secret).toBe(true);
    toTruth1(sim);
    toHunt2(sim);
    expect(sim.holdsCodex("g1", "The Truther Download")).toBe(true);
    toBeans(sim);
    expect(sim.holdsCodex("g1", "The Truther Download Unredacted")).toBe(false);
    const over = fire(sim, "trabolta_overshares");
    expect(v(sim, "Night.scenario")).toBe(4); // composed and hollow: no Sandy
    expect(learned(over).filter((e) => e.entry === "The Truther Download Unredacted")).toEqual([]);
    const recount = sim.setVar("Night.recount", "true");
    expect(learned(recount).filter((e) => e.entry === "The Truther Download Unredacted").map((e) => e.person).sort()).toEqual(PROGRAMS.map(([id]) => id).sort());
  });

  it("MS Paint's invitation is canon: the NSCAD letter is a refused thesis, never an expulsion, and agrees with C09", () => {
    const sim = fresh();
    const letter = sim.model.codex.get("The NSCAD Letter")!;
    expect(letter.text).not.toMatch(/expel/iu);
    const thesis = "MS Paint Is The Most Pure Art Tool: All Art Is Just Pixels If You Take A Picture And Zoom In Close Enough";
    expect(letter.text.replace(/\s+/gu, " ")).toContain(thesis);
    expect(sim.model.codex.get("Four Failed Theses")!.text.replace(/\s+/gu, " ")).toContain(thesis);
  });

  it("Clippy's Purgatory summary says which featured programs met their goal (and skips the absent ones)", { timeout: SLOW }, () => {
    const sim = boot(); // Excel, OpenOffice, MS Paint and VLC are here
    toTruth1(sim);
    toHunt2(sim);
    expect(sim.questStatus("g2", "Excel Mission")).toBe("active");
    sim.quest("complete", "g2", "Excel Mission");
    sim.quest("complete", "g3", "OpenOffice Dossier");
    expect(sim.questStatus("g4", "The Painting")).toBe("active");
    expect(sim.questStatus("g6", "Go Viral")).toBe("active");
    // Only a director completes VLC's quest: # hosts is reminded before the summary.
    const off = fire(sim, "computer_destroyed");
    expect(casts(off).filter((c) => c.scope === "channel(hosts)" && c.cue.includes("Clippy reads the summary")).map((c) => c.cue.replace(/^"|"$/gu, ""))).toEqual([
      "🪦 Before 🪦 Clippy reads the summary: it says whether each featured program met their goal. Complete in the Inspector any of these that did: Go Viral (VLC).",
    ]);
    advance(sim, 10);
    const goal = lines(fire(sim, "clippy_reads_summary"), "Clippy").filter((t) => /goal/u.test(t));
    expect(goal).toEqual([
      "Microsoft Excel met their goal tonight.",
      "OpenOffice met their goal tonight.",
      "MS Paint did not meet their goal.",
      "VLC did not meet their goal.",
    ]);
  });

  it("M27: the five plain rooms' first check-in has a one-time aside; no codex, no coin", () => {
    const sim = boot();
    const said = (evs: SimEvent[]) => replies(evs).filter((r) => r.to === "g1").map((r) => r.text);
    for (const room of ["The Desktop", "The Start Bar", "Disk Cleanup", "The Cloud", "The RAM"]) {
      const codex = sim.codexFor("g1").length;
      const score = sim.scoreOf("g1");
      const first = said(fire(sim, "checked_in", "g1", { at: room }));
      expect(first, room).toHaveLength(2);
      expect(first[0], room).toMatch(/^📍 Checked in at /u);
      expect(first[1], room).toMatch(/^📎 /u);
      const again = said(fire(sim, "checked_in", "g1", { at: room }));
      expect(again, room).toEqual([first[0]]);
      expect(sim.codexFor("g1").length, room).toBe(codex);
      expect(sim.scoreOf("g1"), room).toBe(score);
    }
    // Another program gets its own first aside.
    expect(replies(fire(sim, "checked_in", "g2", { at: "The RAM" })).filter((r) => r.to === "g2").map((r) => r.text)).toEqual(["📍 Checked in at the RAM.", "📎 The RAM hums a little louder when you walk in. It will forget you were here."]);
  });

  it("B11: lie → accurate → lie counts the filing once; an uncertain correction clears it to unanswered", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    file(sim, "g2", "H1", "twelve");
    expect(v(sim, "Kernel.lies_accepted")).toBe(1);
    fire(sim, "fact_accurate", "g2", { question: "H1" }, "Clippy");
    fire(sim, "fact_lie", "g2", { question: "H1" }, "Clippy");
    expect(v(sim, "Kernel.lies_accepted")).toBe(1);
    expect(v(sim, "Kernel.q1")).toBe("lie");
    fire(sim, "fact_uncertain", "g2", { question: "H1" }, "Clippy");
    expect(v(sim, "Kernel.lies_accepted")).toBe(0);
    expect(v(sim, "Kernel.q1")).toBe("none");
    expect(diags(sim.log.since(0) as SimEvent[])).toEqual([]);
  });
});

// ───────────────────────── wave 8 (story lane) ─────────────────────────

/** The cue sheet's rows (the editor's Director page / the phone sheet). */
function sheet(sim: Sim) {
  // The director's own view: `sequence`, `repeat` and each branch cue's `live`.
  const rows = cueRows(modView(sim, "open", "x").interactions ?? [], cueState(sim));
  return { last: rows.find((r) => r.last)?.id ?? null, next: rows.find((r) => r.next)?.id ?? null };
}

describe("Trapped in the Internet — wave 8 (story lane)", () => {
  it("S2-10 / T2-08: the anytime, optional and fallback cues are off-sequence, so NEXT after 🕚 is never 🎆 midnight", { timeout: SLOW }, () => {
    const m = fresh().model;
    for (const id of ["zip_everyone_out", "y2k_midnight", "reset_server_room", "force_majority_stay", "force_majority_leave", "force_their_majority", "lights_dance", "restore_the_lights"]) {
      expect(m.interactions.get(id)!.sequence, id).toBe(false);
    }
    // The night's steps stay in sequence.
    for (const id of ["y2k_clock", "tell_the_truth", "clippy_reads_summary", "final_reveal"]) {
      expect(m.interactions.get(id)!.sequence, id).toBe(true);
    }
    const sim = boot();
    toY2k(sim);
    // The hour runs on the house (the door, the chess, the patch bay): nothing
    // to suggest until midnight fires 🌑 itself (a tap would cut the hour).
    expect(sheet(sim)).toEqual({ last: "y2k_clock", next: null });
    fireAll(sim, "reset_server_room", "restore_the_lights");
    expect(sheet(sim)).toEqual({ last: "y2k_clock", next: null });
  });

  it("integration: NEXT follows tonight's ending (each branch cue's while:), and a refused 📜 / 🪦 counts for nothing", { timeout: SLOW }, () => {
    // Combo A: 📜 is NEXT after the dance, then the ceremony once it is told.
    const a = boot();
    toY2k(a);
    for (const early of ["tell_the_truth", "clippy_reads_summary"]) {
      const evs = fire(a, early);
      expect(cues(evs), early).not.toContain("fire lift_the_takeover");
      expect(hostsSaid(evs).length, early).toBe(1);
      expect(cueState(a).fired, early).not.toContain(early);
    }
    expect(sheet(a)).toEqual({ last: "y2k_clock", next: null });
    fire(a, "patch_combo_a");
    advance(a, 10);
    expect(sheet(a).next).toBe("tell_the_truth");
    fire(a, "tell_the_truth");
    expect(sheet(a)).toEqual({ last: "tell_the_truth", next: null }); // NEXT waits for the reader
    advance(a, 830);
    expect(sheet(a)).toEqual({ last: "tell_the_truth", next: "start_the_ceremony" });
    // Combo B: 🪦, 📜, then the ceremony.
    const b = boot();
    toY2k(b);
    fire(b, "patch_combo_b");
    advance(b, 10);
    expect(sheet(b).next).toBe("clippy_reads_summary");
    fire(b, "clippy_reads_summary");
    expect(sheet(b)).toEqual({ last: "clippy_reads_summary", next: "tell_the_truth" });
    fire(b, "tell_the_truth");
    expect(sheet(b)).toEqual({ last: "tell_the_truth", next: null });
    // The hour runs out: midnight fires 🌑, and a Combo A after it still
    // reaches 📜 (declared after the finale's cues, before G1).
    const late = boot();
    toY2k(late);
    advance(late, 3600);
    expect(sheet(late)).toEqual({ last: "final_reveal", next: "bobbing_for_truth" });
    fire(late, "patch_combo_a");
    advance(late, 10);
    expect(sheet(late).next).toBe("tell_the_truth");
    fire(late, "tell_the_truth");
    expect(sheet(late)).toEqual({ last: "tell_the_truth", next: null });
    // The ceremony: G1, then the awards; G11 last.
    g1(late);
    expect(sheet(late).next).toBe("award_most_trusted");
    // The verdict: the song goes to the ceremony; Grok Prom to 💔 / 💌.
    for (const lie of [false, true]) {
      const sim = boot();
      toBobbing(sim, { lie });
      expect(sheet(sim).next).toBe("read_truth_txt");
      truthTxt(sim);
      expect(sheet(sim), `lie ${lie}`).toEqual({ last: "the_verdict", next: lie ? "no_pickup_line" : "tell_the_truth" });
    }
  });

  it("integration: ⚖ pressed before 🍎 says to bob first, not that the verdict is in", () => {
    const sim = boot();
    toY2k(sim);
    const said = hostsSaid(fire(sim, "the_verdict")).join("\n");
    expect(said).toContain("⚖ Not yet: 🍎 Bobbing for Truth, then 📄 truth.txt first.");
    expect(said).not.toContain("already in");
  });

  it("integration: the hand jive takes EVERYONE TO THE INTERNET off the screens", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { lie: true });
    truthTxt(sim);
    fireAll(sim, "ask_for_advice", "advice_thwarted");
    expect(v(sim, "Night.screen")).toBe("banish");
    const jive = fire(sim, "the_hand_jive");
    expect(cues(jive)).toContain("cue screens_screensaver");
    expect(v(sim, "Night.screen")).toBe("screensaver");
    expect(v(sim, "Night.terminals")).toBe("screensaver");
  });

  it("T6-01: 📄 puts truth.txt up and holds it; ⚖ the verdict plays the song or Grok Prom", { timeout: SLOW }, () => {
    const m = fresh().model;
    const admin = [...m.interactions.values()].filter((i) => i.who === "admin").map((i) => i.id);
    expect(admin.indexOf("the_verdict")).toBe(admin.indexOf("read_truth_txt") + 1);
    expect(m.interactions.get("the_verdict")!.sequence).toBe(true);
    for (const lie of [false, true]) {
      const sim = boot();
      toBobbing(sim, { lie });
      const rt = fire(sim, "read_truth_txt");
      expect(cues(rt)).toContain("cue screens_truth_txt");
      expect(cues(rt).filter((c) => /lights_song|screens_song|youre_the_one_vocoder|screens_grok_prom/u.test(c))).toEqual([]);
      expect(beats(rt)).toContain("Truth Txt");
      expect(beats(rt).filter((b) => ["The Verdict", "Song Ending", "Grok Prom"].includes(b))).toEqual([]);
      expect(widgets(rt).filter((w) => w.widget === "answer")).toEqual([]);
      expect(v(sim, "Night.screen")).toBe("truth_txt");
      expect(v(sim, "Night.r3_closed")).toBe(true);
      expect(v(sim, "Night.ended")).toBe(false);
      // Adobe's readout says who presses ⚖.
      expect(replies(rt).filter((r) => r.to === "Adobe Acrobat").map((r) => r.text)).toEqual(["📄 Hand the bobber the truth.txt printout. They read it aloud; when they finish, the director presses ⚖ for the verdict."]);
      const vd = fire(sim, "the_verdict");
      expect(beats(vd), String(lie)).toContain(lie ? "Grok Prom" : "Song Ending");
      expect(widgets(vd).filter((w) => w.widget === "answer").map((w) => w.audience[0]).sort()).toEqual(PROGRAMS.map(([id]) => id).sort());
      // Once only.
      expect(beats(fire(sim, "the_verdict"))).toEqual([]);
    }
    // Before truth.txt it does nothing.
    const early = boot();
    toBobbing(early);
    expect(beats(fire(early, "the_verdict"))).toEqual([]);
    expect(v(early, "Night.phase")).toBe("bobbing");
  });

  it("T1-02 / T2-10: a refused admin cue tells # hosts why and does nothing else; the night's own run hears no refusal", { timeout: SLOW }, () => {
    const refused = (sim: Sim, cue: string, note: string) => {
      const e = fire(sim, cue);
      expect(beats(e), cue).toEqual([]);
      expect(offstage(e), cue).toEqual([]);
      expect(casts(e).map((b) => b.cue), cue).toEqual([`"${note}"`]);
    };
    const sim = boot();
    // A clean run through the Y2K hour, auto cues included, refuses nothing.
    const run = [...toTruth1(sim)];
    toHunt2(sim);
    // The hour runs out on its own: the Truther Download, the warning and the close are auto.
    run.push(...advance(sim, 3600), ...fireAll(sim, "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened", "trabolta_overshares", "y2k_clock"));
    expect(v(sim, "Night.step")).toBe(14);
    expect(hostsSaid(run).filter((h) => h.includes("Nothing happens"))).toEqual([]);
    refused(sim, "call_to_the_desktop", "📣 Not again: the Desktop call has already played. Nothing happens.");
    refused(sim, "introduce_trabolta", "🤖 Trabolta is already online. Nothing happens.");
    refused(sim, "tell_the_truth", "📜 Not yet: the night has not ended. Nothing happens.");
    refused(sim, "the_verdict", "⚖ Not yet: 🍎 Bobbing for Truth, then 📄 truth.txt first. Nothing happens.");
    refused(sim, "start_the_ceremony", "🏆 No ceremony yet: the night has not ended. Nothing happens.");
    const early = boot();
    fire(early, "call_to_the_desktop");
    refused(early, "first_moment_of_truth", "⚖️ Too early: the First Moment of Truth follows hunt 1 (🔎). Nothing happens.");
    refused(early, "y2k_midnight", "🎆 No midnight: it needs the Y2K hour, before any ending. Nothing happens.");
    expect(v(early, "Night.step")).toBe(1);
    // 📄 twice, ⚖ before 📄.
    const bob = boot();
    toBobbing(bob);
    refused(bob, "the_verdict", "⚖ Not yet: 📄 Read truth.txt first. Nothing happens.");
    fire(bob, "read_truth_txt");
    const gen = v(bob, "Night.settle_gen");
    refused(bob, "read_truth_txt", "📄 Already read: press ⚖ for the verdict when the bobber has finished. Nothing happens.");
    expect(v(bob, "Night.settle_gen")).toBe(gen);
    // T2-10: G1 while banished says why (banished is not an ending).
    const ban = boot();
    toBobbing(ban, { lie: true });
    truthTxt(ban);
    fireAll(ban, "ask_for_advice", "advice_thwarted");
    refused(ban, "start_the_ceremony", "🏆 No ceremony yet: banished is not an ending (🕺 the hand jive first). Nothing happens.");
    expect(v(ban, "Night.ceremony")).toBe(false);
    fire(ban, "the_hand_jive");
    expect(beats(g1(ban))).toContain("The Ceremony");
    refused(ban, "start_the_ceremony", "🏆 The ceremony has already started. Nothing happens.");
  });

  it("T1-04: a program cleared at the Y2K hour gets one 📝 card and a clearance that fits the hour", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    const late = upload(sim, "late1", "Notepad");
    expect(v(sim, "late1.cleared")).toBe(true);
    const cards = widgets(late).filter((w) => w.widget === "fact" && w.audience[0] === "late1");
    expect(cards).toHaveLength(1);
    const all = texts(late);
    expect(all.filter((t) => t.includes("There will be a game soon"))).toEqual([]);
    expect(all.filter((t) => t.includes("screensaver drifts"))).toEqual([]);
    expect(lines(late, "Norton Anti-Virus")).toContain("Scanned. Notepad is free of viruses and ready to explore the entire computer. You are late: the night is already under way. Listen for the house. Go through the Tube.");
    // An early arrival still hears the screensaver and the coming game.
    const first = fresh();
    first.fireBeat("Power On");
    const early = upload(first, "e1", "Calculator");
    expect(lines(early, "Norton Anti-Virus")).toContain("Scanned. Calculator is free of viruses and ready to explore the entire computer. There will be a game soon in the Desktop. The house will announce it. Go through the Tube.");
    expect(texts(early).some((t) => t.includes("A classic screensaver drifts across the TV"))).toBe(true);
    // Cleared after 📣 but before 🎱: the game is about to begin, the TV has left its screensaver.
    fire(first, "call_to_the_desktop");
    const between = upload(first, "e2", "Paint");
    expect(lines(between, "Norton Anti-Virus")).toContain("Scanned. Paint is free of viruses and ready to explore the entire computer. A game is about to begin in the Desktop. Go through the Tube.");
    expect(texts(between).filter((t) => t.includes("You are late") || t.includes("screensaver drifts"))).toEqual([]);
  });

  it("T6-05: 🪩 clears the living-room overlay only when it is up", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    // A 🪩 mid-hour (no ending): the Y2K screens stay.
    expect(cues(fire(sim, "lights_dance")).filter((c) => c.startsWith("cue screens_"))).toEqual([]);
    expect(v(sim, "Night.screen")).toBe("y2k");
    fire(sim, "patch_combo_a");
    expect(v(sim, "Night.screen")).toBe("go_to_living_room");
    // The director's 🪩 before the auto dance clears it; the auto dance then has nothing to clear.
    expect(cues(fire(sim, "lights_dance"))).toContain("cue screens_screensaver");
    expect(cues(advance(sim, 10)).filter((c) => c.startsWith("cue screens_"))).toEqual([]);
  });

  it("T8-02: no agent power's description quotes an answer (the pickup line, a hunt answer)", () => {
    const norm = (t: string) => t.toLowerCase().replace(/[’']/gu, "").replace(/[^a-z0-9]+/gu, " ").trim();
    const keys = [...FACTS.answers, ...FACTS.questions].flatMap((a) => [a.answer, ...(a.accept ?? [])]).map(norm).filter((k) => k.length >= 4);
    expect(keys).toContain(norm("You're the one that I want"));
    const powers = [...fresh().model.interactions.values()].filter((i) => i.who === "agent");
    expect(powers.length).toBeGreaterThan(0);
    for (const p of powers) {
      const d = ` ${norm(`${p.label} ${p.description ?? ""}`)} `;
      for (const k of keys) expect(d.includes(` ${k} `), `${p.id}: ${k}`).toBe(false);
    }
  });

  it("S2-01 / S2-12: 🕚 waits for the patch-bay watch's IN; 🤖 needs no re-provisioning", () => {
    const m = fresh().model;
    expect(m.interactions.get("y2k_clock")!.description).toMatch(/\bIN\b/u);
    expect(m.interactions.get("y2k_clock")!.description).toMatch(/patch-bay watch/u);
    expect(m.interactions.get("introduce_trabolta")!.description).not.toMatch(/provision/u);
  });

  it("S2-15: Adobe's 🍎 readout says a failed bob marks, as it does", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    fire(sim, "final_reveal");
    const b = fire(sim, "bobbing_for_truth");
    const adobe = replies(b).filter((r) => r.to === "Adobe Acrobat").map((r) => r.text);
    expect(adobe).toEqual(["🍎 Bring out the Bag of Truth. Press 🍎 Brought up the Bag on whoever surfaces with it; 🍎 Failed the bob marks them for reinstallation."]);
    fire(sim, "failed_the_bob", "g5", null, "Adobe Acrobat");
    expect(v(sim, "g5.marked")).toBe(true);
    expect(sim.isCaptured("g5")).toBe(false);
  });

  it("T1-03: the song after a pickup line never says every fact was true", { timeout: SLOW }, () => {
    const TRUE = "Every fact you gave me was true, and the truth tells me what to say to her. You're the one that I want.";
    const song = boot();
    toBobbing(song);
    expect(lines(truthTxt(song), "Trabolta")).toContain(TRUE);
    const prom = boot();
    toBobbing(prom, { lie: true });
    truthTxt(prom);
    const pl = fire(prom, "answer answered", "g3", { question: "P1", text: "You're the one that I want", verdict: "accurate", card: 1 });
    expect(v(prom, "Night.ending")).toBe("song_pickup");
    expect(lines(pl, "Trabolta")).not.toContain(TRUE);
    expect(lines(pl, "Trabolta")).toContain("Not every fact you gave me was true. But that line was, and it tells me what to say to her. You're the one that I want.");
  });

  it("T2-06: a pickup line after the rave or during the advice poll / banishment celebrates nothing", { timeout: SLOW }, () => {
    const P1 = (sim: Sim, g: string) => fire(sim, "answer answered", g, { question: "P1", text: "You're the one that I want", verdict: "accurate", card: 1 });
    const rave = boot();
    toBobbing(rave, { lie: true });
    truthTxt(rave);
    fire(rave, "no_pickup_line");
    const r = P1(rave, "g3");
    expect(casts(r)).toEqual([]);
    expect(lines(r, "Trabolta")).toEqual([]);
    expect(replies(r).map((x) => x.text)).toEqual(["Trabolta has ridden away. Nobody reads your line."]);
    expect(v(rave, "Night.line_by")).toBe("none");
    expect(v(rave, "Night.ending")).toBe("rave");
    const adv = boot();
    toBobbing(adv, { lie: true });
    truthTxt(adv);
    fire(adv, "ask_for_advice");
    const a = P1(adv, "g3");
    expect(casts(a)).toEqual([]);
    expect(lines(a, "Trabolta")).toEqual(["Too late for lines, OpenOffice."]);
    expect(v(adv, "Night.line_by")).toBe("none");
    expect(v(adv, "Night.ended")).toBe(false);
    fire(adv, "advice_thwarted");
    expect(casts(P1(adv, "g4"))).toEqual([]);
    // The song still celebrates the first correct line (flavour).
    const song = boot();
    toBobbing(song);
    truthTxt(song);
    expect(casts(P1(song, "g3")).map((b) => b.cue)).toEqual(['"~💘 OpenOffice knew the line."']); // wave 13: a per-person notice
  });

  it("T2-03: once truth.txt is read the server room is quiet: the patch bay and the door only tell # hosts", { timeout: SLOW }, () => {
    const QUIET = ["patch_combo_a", "patch_combo_b", "patch_rejected", "server_door_opened"];
    const quiet = (sim: Sim, where: string) => {
      const phase = v(sim, "Night.phase");
      for (const cue of QUIET) {
        // Wave 20: an opening is an edge; shut the door between the checks.
        if (cue === "server_door_opened") expect(beats(fire(sim, "server_door_closed")), `${where} shut`).toEqual([]);
        const e = fire(sim, cue);
        expect(beats(e), `${where} ${cue}`).toEqual([]);
        expect(cues(e).filter((c) => c.startsWith("cue ")), `${where} ${cue}`).toEqual([]);
        expect(hostsSaid(e).filter((h) => h.includes("verdict is in")), `${where} ${cue}`).toHaveLength(1);
      }
      expect(v(sim, "Night.ending"), where).toBe(where === "banished" ? "banished" : "none");
      expect(v(sim, "Night.phase"), where).toBe(phase);
      expect(v(sim, "Night.wrong_combos"), where).toBe(0);
    };
    // Between 📄 and ⚖, then Grok Prom, the advice poll and the banishment.
    const sim = boot();
    toBobbing(sim, { lie: true });
    fire(sim, "read_truth_txt");
    quiet(sim, "truth.txt");
    fire(sim, "the_verdict");
    quiet(sim, "grok_prom");
    fire(sim, "ask_for_advice");
    quiet(sim, "advice");
    fire(sim, "advice_thwarted");
    quiet(sim, "banished");
    // His heart's talk is over too (wave 20: core/test/trapped-heart.test.ts).
    // Before truth.txt (the bob) a combo still ends the night.
    const b = boot();
    toBobbing(b);
    fire(b, "patch_combo_a");
    expect(v(b, "Night.ending")).toBe("disabled");
  });
});
