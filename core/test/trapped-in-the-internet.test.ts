//! Trapped in the Internet — the show, played end to end through the
//! public `Sim` API the way the event server + the bridges drive it
//! (design §6.1). One shared sim plays the whole night to the combo A
//! ending; fresh sims cover every other branch: Bingo, the overshare
//! scenarios, both majorities, combo B, the server-room alarm, every
//! verdict and alternate ending, and Trabolta's powers + phase guards.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Sim, namedEvents } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioFiles, scenarioSource } from "../examples/load.ts";
import { parse } from "../src/parser/index.ts";
import { guestView } from "../server/views.ts";
import { composeGuestMessages } from "../server/chat.ts";
import { identityDefs, guestPickable, performerPickable } from "../server/identity.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { AgentFacts, AgentRequest } from "../server/agents.ts";

// ───────────────────────── helpers ─────────────────────────

const SHOW = "trapped-in-the-internet";
const FILES = scenarioFiles(SHOW);
const SRC = scenarioSource(SHOW);
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const worldKeys = (sim: Sim) => [...((sim.world as any).values as Map<string, unknown>).keys()];

/** Ticks one second at a time, like the server's clock. */
function advance(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds; i++) out.push(...sim.tick(1000));
  return out;
}

const FEATURED = ["Microsoft Excel", "OpenOffice", "DraftKings", "Bugdom", "Broken Ask Jeeves", "Runescape", "MS Paint", "VLC", "Pong"];
const PERFORMERS = ["Adobe Acrobat", "CRA Agent Software", "Clippy", "McAfee Anti-Virus", "Norton Anti-Virus", "Password Manager", "Recycling Bin", "Task Manager", "WebMD"];
const fold = (s: string) => s.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();

/** Register → CAPTCHA (pass = INCORRECT, then CORRECT) → the problem (skipped
 *  for a featured name, which is not asked) → deposit → the door scan. */
function upload(sim: Sim, id: string, name: string, scanner = "Norton Anti-Virus"): SimEvent[] {
  const out: SimEvent[] = [];
  out.push(...sim.createPerson(id, name));
  out.push(...sim.signal("captcha answered", id, { passed: true }));
  out.push(...sim.signal("captcha answered", id, { passed: false }));
  const p = sim.pendingChoiceFor(id);
  if (p && p.length === 4) out.push(...sim.choose(id, 0));
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
    expect([...m.locations.keys()]).toEqual(["The Desktop", "The Mud Room", "The Tube", "The Internet", "The Cache", "Disk Cleanup", "The Cloud", "The Registry", "The Server Room"]);
    const inet = m.locations.get("The Internet")!;
    expect(inet.prison).toBe(true);
    expect(inet.sealed).toBe(true);
    expect(m.locations.get("The Mud Room")!.cutscene).toBe(true);
    expect(m.locations.get("The Server Room")!.hidden).toBe(true);
    expect(m.defaultRole).toBe("Program");
  });

  it("pins the codex: 132 entries, 41 codes, the printed codes", () => {
    expect(m.codex.size).toBe(132);
    expect(m.codexCodes.size).toBe(41);
    const codes: Record<string, string> = {
      billboardlease11: "The Billboard Lease",
      trabolta4ever: "The LiveJournal",
      loveletterforyou: "ILOVEYOU",
      coldstorage: "The Server Room",
      fbihalifax: "The FBI Lanyard",
      appendixz: "The Final Chapter",
    };
    for (const [c, e] of Object.entries(codes)) expect(m.codexCodes.get(c), c).toBe(e);
  });

  it("declares the 16 quests in order, with titles and givers", () => {
    const QUESTS = [
      ["Orientation", "Clippy's Orientation", "Clippy"],
      ["The Bingo Card", "Computer Bingo", "Clippy"],
      ["Hunt One", "The Truth Scavenger Hunt · Round 1", "Trabolta"],
      ["Hunt Two", "The Truth Scavenger Hunt · Round 2", "Trabolta"],
      ["The Final Facts", "The Final Fact-Finding Round", "Trabolta"],
      ["Excel Mission", "Computers Are Very Confusing", "Truther Download"],
      ["OpenOffice Dossier", "Facts Are Currency", "Truther Download"],
      ["Recruit To Stay", "Stay Forever", "Truther Download"],
      ["Recruit To Leave", "Get Out", "Truther Download"],
      ["Truthcoin Hustle", "Sweet Sweet Truthcoin", "Truther Download"],
      ["Master Of The Bugs", "Master Of The Bugs", "Truther Download"],
      ["Unscramble", "Organize The Information", "Truther Download"],
      ["The Gold Standard", "Peg It To Facts", "Truther Download"],
      ["Find The Exit", "Paint Your Way Out", "Truther Download"],
      ["Go Viral", "Your Followers Are Back", "Truther Download"],
      ["Keep The Ball In Play", "Tennis For Two", "Truther Download"],
    ];
    const qs = [...m.quests.values()].map((q) => [q.id, q.title, q.giver]);
    expect(qs).toEqual(QUESTS);
  });

  it("declares the interactions: admin cue sheet, per-question judge buttons, guest + agent buttons", () => {
    const ints = [...m.interactions.values()];
    const by = (w: string) => ints.filter((i) => i.who === w).map((i) => i.id);
    expect(by("guest")).toEqual(["go to the bathroom", "back from the bathroom", "plant_the_virus"]);
    const perf = by("performer");
    for (const p of ["accurate_q1", "accurate_q2", "accurate_q3", "confident_q1", "confident_q2", "confident_q3", "fact_accurate", "fact_lie", "send to the internet", "mark as reinstalled"]) expect(perf).toContain(p);
    expect(perf).not.toContain("accurate_truth");
    expect(perf).not.toContain("confident_lie");
    const ev = namedEvents(m);
    const admin = by("admin");
    expect(admin.length).toBeGreaterThan(40);
    for (const a of admin) expect(ev, a).toContain(a);
    expect(ints.filter((i) => i.who === "agent").map((i) => `${i.id}:${i.limit}`)).toEqual([
      "snoop:8",
      "flicker_the_screens:3",
      "pop_up:4",
      "mint_truthcoin:10",
      "cut_the_lights:2",
      "summon_the_antivirus:4",
      "trabolta_announces:2",
      "assess:40",
      "pardon_a_program:1",
      "turn_back_the_clock:1",
      "the_line_works:1",
    ]);
  });

  it("hides the secret state on an unlisted, unplayable Kernel with the §2.6.2 defaults", () => {
    const k = m.characters.get("Kernel")!;
    expect(k).toBeDefined();
    expect(k.listed).toBe(false);
    expect(k.playable).toBe(false);
    const seeded = Object.fromEntries(sim.worldEntries().filter((w) => w.path.startsWith("Kernel.")).map((w) => [w.path.slice(7), w.value]));
    expect(seeded).toEqual({
      combo_a: "none",
      combo_b: "none",
      q1: "none",
      q2: "none",
      q3: "none",
      q4: "none",
      q5: "none",
      q6: "none",
      q7: "none",
      q8: "none",
      lies_accepted: "0",
      all_accurate: "false",
      virus_planted: "false",
      excel_planted: "false",
      virus_planter: "none",
      openoffice_dossier: "false",
      waive_leader_tasks: "false",
      majority_reached: "false",
      majority: "none",
      server_unlocked: "false",
      disarmed_until: "0",
    });
  });

  it("the combo halves in the codex spell out Kernel.combo_a / combo_b (§6.1 item 19)", () => {
    const s = fresh();
    s.fireBeat("Power On");
    const pairs = (...names: string[]) =>
      names
        .flatMap((n) => [...s.model.codex.get(n)!.text.matchAll(/V(\d) → D(\d)/gu)].map((x) => `V${x[1]}-D${x[2]}`))
        .sort()
        .join(",");
    expect(pairs("Combo A First Half", "Combo A Second Half")).toBe(v(s, "Kernel.combo_a"));
    expect(pairs("Combo B First Half", "Combo B Second Half")).toBe(v(s, "Kernel.combo_b"));
    expect(v(s, "Kernel.combo_a")).toBe("V2-D5,V4-D1,V6-D8,V7-D3");
    expect(v(s, "Kernel.combo_b")).toBe("V1-D6,V3-D2,V5-D7,V8-D4");
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
    expect(facts.filter((f) => /Kernel|combo|lies|planted|planter|dossier|majority|all_accurate|server_unlocked|\.q[1-8]$/u.test(f))).toEqual([]);
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
    expect(named(guestPickable)).toHaveLength(32);
    expect(named(performerPickable)).toEqual(PERFORMERS);
  });

  it("Trabolta is agent-only; voices, props and Kernel are unplayable; no Grok / Alexa / Jean Trabolta", () => {
    const t = defs.find((d) => d.name === "Trabolta")!;
    expect(t.agent).toBe(true);
    expect(guestPickable(t) || performerPickable(t)).toBe(false);
    expect(named((d) => !d.playable)).toEqual(["Kernel", "Sandy", "The Router", "The Screensaver", "The Tablet", "The Uploader", "Truther Download"]);
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
    expect(v(sim, "Night.anti_ai")).toBe("MS Paint");
    expect(v(sim, "Night.screen")).toBe("screensaver");
    expect(diags(boot)).toEqual([]);
  });

  it("arrival: the Mud Room, the CAPTCHA, the problem, the deposit", () => {
    const j = sim.createPerson("g1", "Calculator");
    expect(lines(j, "The Uploader")).toContain("Welcome to the computer. It is dark because you have no eyes yet. Stand still.");
    expect(widgets(j)).toHaveLength(1);
    expect(widgets(j)[0]!.widget).toBe("captcha");
    expect(aud(widgets(j)[0]!)).toBe('["g1"]');
    expect(sim.locationOf("g1")).toBe("The Mud Room");

    const pm = sim.scan("Password Manager", "g1");
    expect(lines(pm, "Password Manager")).toContain("Not yet. Finish your upload. I will be right here.");

    const c1 = sim.signal("captcha answered", "g1", { passed: true });
    expect(lines(c1, "The Uploader").some((t) => t.startsWith("INCORRECT. Humans are not permitted"))).toBe(true);
    expect(widgets(c1).some((w) => w.widget === "captcha")).toBe(true);
    const c2 = sim.signal("captcha answered", "g1", { passed: false });
    expect(lines(c2, "The Uploader")).toContain("CORRECT.");
    expect(sim.pendingChoiceFor("g1")).toEqual(["My debt.", "My career.", "My loneliness.", "My mortality."]);
    sim.choose("g1", 1);
    expect(sim.pendingChoiceFor("g1")).toEqual(["Deposited.", "I have nothing to leave."]);
    const dep = sim.choose("g1", 0);
    expect(v(sim, "g1.human_problem")).toBe("career");
    expect(v(sim, "g1.left_behind")).toBe("deposited");
    expect(sim.scoreOf("g1")).toBe(100);
    expect(v(sim, "g1.uploaded")).toBe(true);
    expect(sim.holdsCodex("g1", "The Mud Room")).toBe(true);
    expect(sim.holdsCodex("g1", "The Terms Of Service")).toBe(true);
    expect(widgets(dep).some((w) => w.widget === "pass" && (w.text ?? "").includes("Hold this up."))).toBe(true);
    expect(sim.locationOf("g1")).toBe("The Mud Room");
  });

  it("the door: Clippy can't clear, Norton clears, the rooms open, the tutorial deals", () => {
    const cl = sim.scan("Clippy", "g1");
    expect(sim.locationOf("g1"), texts(cl).join("\n")).toBe("The Mud Room");
    expect(v(sim, "g1.cleared")).not.toBe(true);

    const nz = sim.scan("Norton Anti-Virus", "g1");
    const n = lines(nz, "Norton Anti-Virus");
    expect(n.some((t) => t.startsWith("Scanned. Calculator is free of viruses"))).toBe(true);
    expect(n.some((t) => t.includes("tunnel of lights"))).toBe(true);
    expect(sim.locationOf("g1")).toBe("The Desktop");
    expect(v(sim, "g1.cleared")).toBe(true);
    for (const r of ["The Cache", "Disk Cleanup", "The Cloud", "The Registry"]) expect(sim.isRevealedTo(r, "g1"), r).toBe(true);
    const tut = widgets(nz).find((w) => w.widget === "tutorial");
    expect(tut).toBeDefined();
    expect(aud(tut!)).toBe('["g1"]');
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
    expect(sim.questStatus("g5", "Orientation")).toBe("failed");

    expect(v(sim, "g1.featured")).toBe("none");
    for (const [id, tag] of [["g2", "excel"], ["g3", "openoffice"], ["g4", "mspaint"], ["g6", "jeeves"], ["g7", "draftkings"], ["g8", "bugdom"], ["g9", "vlc"], ["g10", "pong"], ["g11", "runescape"]]) {
      expect(v(sim, `${id}.featured`), id).toBe(tag);
    }
    expect(v(sim, "g2.human_problem")).toBe("profile");
    expect(sim.holdsCodex("g2", "Randy Barkmore Sr")).toBe(true);
    expect(sim.holdsCodex("g6", "The Valley Librarian")).toBe(true);
    expect(sim.holdsCodex("g6", "The DSL Line")).toBe(true);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(cd.some((e: any) => e.type === "revealed" && e.target === "room:task manager")).toBe(true);
    expect(replies(cd).filter((r) => r.text.includes("Patrol the whole computer"))).toHaveLength(4);

    // too early: introduce_trabolta before bingo_time does nothing
    const early = sim.signal("introduce_trabolta");
    expect(v(sim, "Trabolta.awake")).toBe(false);
    expect(sim.isRevealedTo("Trabolta", "g1")).toBe(false);
    expect(texts(early).some((t) => t.includes("Trabolta"))).toBe(false);

    const sb = sim.signal("start_the_bingo");
    expect(casts(sb).some((b) => b.cue.includes("COMPUTER BINGO has begun"))).toBe(true);
    expect(saidBy(sb, "Clippy").length).toBeGreaterThan(4);
    expect(lines(sb, "Clippy").some((t) => t.includes("Do NOT write down"))).toBe(true);
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
    expect(sim.questStatus("g1", "The Bingo Card")).toBe("done");

    sim.signal("bingo_winner", "g1", null, "Clippy");
    expect(v(sim, "g1.bingo")).toBe(true);
    expect(v(sim, "Night.bingo_winners")).toBe(1);
    const rib = sim.signal("award_the_ribbon", "g1", null, "Clippy");
    expect(sim.holdsCodex("g1", "Computer Bingo")).toBe(true);
    expect(casts(rib).some((b) => b.cue.includes("wins a Bingo Ribbon"))).toBe(true);
  });

  it("the first reinstall: Corrupted Code, WebMD in private, no TV mirror yet", () => {
    const s1 = sim.signal("send to the internet", "g4", null, "Norton Anti-Virus");
    expect(sim.isCaptured("g4")).toBe(true);
    expect(v(sim, "Night.first_reinstall")).toBe("MS Paint");
    expect(beats(s1)).toContain("Corrupted Code");
    expect(beats(s1)).toContain("Reinstallation");
    expect(has(cues(s1), "tv_mirror")).toBe(false);
    expect(v(sim, "g4.internet_visits")).toBe(1);
    expect(v(sim, "g4.trust")).toBe(-5);
    const web = saidBy(s1, "WebMD");
    expect(web.length).toBeGreaterThanOrEqual(5);
    expect(web.every((e) => aud(e) === '["g4"]')).toBe(true);
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
    expect(replies(done).map((r) => r.text)).toContain("Reinstallation complete. You can follow instructions. Welcome back to the computer.");

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

  it("Clippy introduces Trabolta: awake, in People, online cue, then the mirror", () => {
    const intro = sim.signal("introduce_trabolta");
    expect(v(sim, "Trabolta.awake")).toBe(true);
    expect(sim.isRevealedTo("Trabolta", "g1")).toBe(true);
    expect(v(sim, "Night.phase")).toBe("introduced");
    const ic = cues(intro);
    const iOnline = ic.findIndex((c) => c.includes("terminals_trabolta_online"));
    const iMirror = ic.findIndex((c) => c.includes("tv_mirror"));
    expect(iOnline).toBeGreaterThanOrEqual(0);
    expect(iMirror).toBeGreaterThan(iOnline);
    expect(lines(intro, "Clippy")).toContain("Look! That's MS Paint! Doing great!");
    const hello = saidBy(intro, "Trabolta").filter((e) => e.text.startsWith("Hello, "));
    expect(hello).toHaveLength(12); // every cleared program, privately
    expect(hello.every((e) => e.audience.length === 1)).toBe(true);
    expect(sim.peopleFor("g1").some((p) => p.name === "Trabolta")).toBe(true);
    expect(replies(intro).some((r) => r.to === "Clippy" && r.text.includes("Trabolta is online"))).toBe(true);

    // a late arrival gets the hello on clearance, not in the Mud Room
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
    sim.signal("mark as reinstalled", "g12", null, "WebMD");
    expect(sim.isCaptured("g12")).toBe(false);
    sim.signal("the simulation completed", "g4");
    expect(sim.isCaptured("g4")).toBe(false);
  });

  it("hunt 1 + the first Moment of Truth: per-question judging, lies indistinguishable and sticky", { timeout: SLOW }, () => {
    const hu = sim.signal("start_the_hunt");
    expect(sim.questStatus("g1", "Hunt One")).toBe("active");
    expect(sim.questStatus("g13", "Hunt One")).toBe("active");
    expect(v(sim, "Night.facts_requested")).toBe(3);
    expect(v(sim, "Night.phase")).toBe("hunt_1");
    expect(lines(hu, "Trabolta").some((t) => t.includes("Barrington"))).toBe(true);
    expect(lines(hu, "Trabolta").some((t) => t.includes("ribbon-cutting"))).toBe(true);
    expect(casts(advance(sim, 600)).some((b) => b.cue.includes("5 minutes left"))).toBe(true);
    const up = advance(sim, 300);
    expect(v(sim, "Night.phase")).toBe("truth_1");
    expect(sim.holdsCodex("Clippy", "Clippy Instructions 3")).toBe(true);
    expect(casts(up).some((b) => b.cue.includes("Time is up"))).toBe(true);
    expect(sim.questStatus("g1", "Hunt One")).toBe("done");

    sim.signal("first_moment_of_truth");
    expect(v(sim, "Night.judging")).toBe(true);
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

    sim.signal("uncertain_answer", "g11", null, "Clippy");
    expect(sim.isCaptured("g11")).toBe(true);
    expect(beats(sim.signal("truth_or_dare"))).toContain("Truth Or Dare");
    sim.signal("chose_dare", "g12", null, "Clippy");
    sim.signal("called_it_false", "g13", null, "Clippy");
    expect(sim.isCaptured("g12")).toBe(true);
    expect(sim.isCaptured("g13")).toBe(false);
    sim.signal("the simulation completed", "g11");
    sim.signal("the simulation completed", "g12");
    expect(v(sim, "g12.internet_visits")).toBe(2);
    expect(beats(sim.signal("telephone"))).toContain("Telephone");
    expect(beats(sim.signal("are_you_sure"))).toContain("Are You Sure");
  });

  it("malware: the ad hijack, then hunt 2 and the Truther Download", () => {
    const pv = sim.signal("second_hunt_preview");
    expect(replies(pv).some((r) => r.to === "Clippy" && r.text.includes("we are all going to die"))).toBe(true);
    expect(sim.holdsCodex("Clippy", "Clippy Instructions 4")).toBe(true);
    expect(sim.holdsCodex("g1", "Clippy Instructions 4")).toBe(false);
    const minor = saidBy(pv, "Trabolta").filter((e) => e.text.includes("minor irregularity"));
    expect(minor).toHaveLength(13);
    expect(minor.every((e) => e.audience.length === 1)).toBe(true);
    expect(v(sim, "Trabolta.composure")).toBe(65);
    expect(v(sim, "Night.judging")).toBe(false);

    const h2 = sim.signal("start_the_second_hunt");
    expect(sim.questStatus("g1", "Hunt Two")).toBe("active");
    expect(v(sim, "Night.round")).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(h2.some((e: any) => e.type === "revealed" && e.target === "room:ram")).toBe(true);

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

    const codes = [...sim.model.codexCodes.entries()].filter(([, e]) => !["The LiveJournal", "ILOVEYOU", "Free Antivirus Trial"].includes(e));
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
    expect(night.filter((k) => /^Night\.combo|combo_[ab]|lies|planter|planted|dossier|majority|\.q[1-8]$|all_accurate|server_unlocked/u.test(k))).toEqual([]);
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
    sim.signal("checked_in", "g13", { at: "The Cache" });
    expect(sim.locationOf("g13")).toBe("The Cache");
    expect(v(sim, "g13.checked_in")).toBe("The Cache");
    for (const args of [null, { at: "the cache" }, { at: "The Server Room" }]) {
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
    sim.signal("back from the bathroom", "g10");
    sim.signal("the simulation completed", "g12");
  });

  it("Truth Pong, the round-2 tally, the Trust Chart and the rankings", () => {
    sim.signal("truth_pong");
    expect(v(sim, "Night.phase")).toBe("truth_pong");
    expect(v(sim, "Night.round")).toBe(2);
    expect(v(sim, "Night.judging")).toBe(true);
    sim.signal("missed_the_cup", "g9", null, "Clippy");
    expect(sim.isCaptured("g9")).toBe(true);
    const ref = sim.signal("accurate_q1", "g1", null, "Clippy");
    expect(replies(ref).map((r) => r.text)).toContain("You have not made a cup yet.");
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
    const nudges = saidBy(rk, "Truther Download").map(aud);
    expect(nudges).toContain('["g9"]'); // VLC
    expect(nudges).toContain('["g4"]'); // MS Paint
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
    expect(beats(os)).toContain("Overshare One");
    expect(lines(os, "Trabolta").some((t) => t.includes("win back my ex. Sandy"))).toBe(true);
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
    expect(v(sim, "Kernel.server_unlocked")).toBe(true);
    expect(v(sim, "Night.phase")).toBe("majority");
    expect(sim.holdsCodex("g8", "The Legendary Fact")).toBe(true);
    for (const half of ["Combo A First Half", "Combo A Second Half", "Combo B First Half", "Combo B Second Half"]) expect(sim.holdsCodex("g1", half), half).toBe(true);
    expect(sim.isRevealedTo("The Server Room", "g1")).toBe(true);
    expect(sim.holdsCodex("g9", "The Legendary Fact")).toBe(false);
    expect(sim.holdsCodex("g2", "Combo A First Half")).toBe(false);
    expect(sim.holdsCodex("Trabolta", "The Legendary Fact")).toBe(false);
    expect(sim.questStatus("g3", "Recruit To Leave")).toBe("done");
    expect(sim.questStatus("g2", "Recruit To Stay")).toBe("failed");
    expect(v(sim, "Night.lj_reader")).toBe("OpenOffice"); // the bundle doesn't overwrite the reader
    sim.join("g13", "The Way Out");
    expect(sim.holdsCodex("g13", "The Legendary Fact")).toBe(true); // a late pledger
  });

  it("the server room: unlocked door, combo A, the dance, Trabolta recounts", () => {
    sim.signal("server_door_opened");
    expect(v(sim, "Night.alarms") ?? 0).toBe(0);
    expect(lines(sim.signal("patch_rejected"), "Trabolta")).toContain("Stop touching me.");
    const pa = sim.signal("patch_changed", undefined, { combo: v(sim, "Kernel.combo_a") });
    expect(v(sim, "Night.ending")).toBe("disabled");
    expect(v(sim, "Night.ended")).toBe(true);
    expect(has(cues(pa), "lights_blackout")).toBe(true);
    expect(casts(pa).some((b) => b.cue.includes("GO TO THE LIVING ROOM"))).toBe(true);
    expect(sim.questStatus("g4", "Find The Exit")).toBe("done");
    expect(has(cues(advance(sim, 10)), "lights_dance")).toBe(true);

    sim.signal("send to the internet", "g9", null, "Norton Anti-Virus");
    const rc = sim.signal("trabolta_recounts");
    expect(diags(rc)).toEqual([]);
    expect(beats(rc)).toContain("Trabolta Recounts");
    for (const g of ["g1", "g9", "g13"]) {
      expect(sim.holdsCodex(g, "Dana Anderson"), g).toBe(true);
      expect(sim.holdsCodex(g, "Julie Norton"), g).toBe(true);
    }
    expect(has(cues(rc), "motorcycle")).toBe(true);
    expect(sim.isCaptured("g9")).toBe(false);
    const t = lines(rc, "Trabolta");
    expect(t.some((x) => x.includes("trustworthy program"))).toBe(true);
    expect(t.some((x) => x.includes("worst program"))).toBe(true);
    expect(t.some((x) => x.includes("Microsoft Excel planted a virus"))).toBe(true);
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
const fire = (sim: Sim, name: string, subject: string | null = null, args: Args | null = null, actor?: string) => sim.signal(name, subject ?? undefined, args, actor);
const fireAll = (sim: Sim, ...names: string[]) => names.flatMap((n) => sim.signal(n));
/** Through the first Moment of Truth (round-1 judging open). */
const toTruth1 = (sim: Sim) => fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth");
/** Hunt 2 through the Truther Download; Excel + OpenOffice answer `ex` / `oo`. */
function toHunt2(sim: Sim, ex = 0, oo = 0) {
  fireAll(sim, "second_hunt_preview", "start_the_second_hunt");
  advance(sim, 120);
  sim.choose("g2", ex);
  sim.choose("g3", oo);
}
/** OpenOffice redeems 20 codes after her prompt. */
function dossier(sim: Sim): SimEvent[] {
  const out: SimEvent[] = [];
  let got = 0;
  for (const [code, entry] of sim.model.codexCodes) {
    if (["The LiveJournal", "ILOVEYOU", "Free Antivirus Trial"].includes(entry) || sim.holdsCodex("g3", entry)) continue;
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
    expect(sim.isRevealedTo("The Cache", "p1")).toBe(true);
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
    sim.setVar("Night.anti_ai", "Calculator");
    expect(sim.holdsCodex("g1", "The Centre Square")).toBe(true);

    sim.signal("send to the internet", "g3", null, "Norton Anti-Virus");
    sim.signal("the simulation completed", "g3");
    const c2 = sim.signal("send to the internet", "g3", null, "Norton Anti-Virus");
    expect(lines(c2, "WebMD").some((t) => t.includes("Repeat corruption"))).toBe(true);
    sim.signal("the simulation completed", "g3");

    const t0 = v(sim, "Trabolta.truth");
    sim.share("g1", "Trabolta", "The Mud Room");
    expect(v(sim, "g1.delivered")).toBe(true);
    expect(v(sim, "Trabolta.truth")).toBe(t0 + 2);
  });

  it("an anti-AI program chosen before arrival gets The Centre Square on clearance", () => {
    const sim = fresh();
    sim.fireBeat("Power On");
    sim.setVar("Night.anti_ai", "Calculator");
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
  it("a stay majority without Excel's plant waits for the director's waiver", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    toBeans(sim);
    fireAll(sim, "trabolta_overshares", "y2k_clock");
    for (const g of ["g1", "g4", "g5"]) sim.join(g, "Unlimited Power");
    expect(v(sim, "Kernel.majority_reached")).not.toBe(true);
    fire(sim, "waive_leader_tasks");
    expect(v(sim, "Kernel.majority")).toBe("stay");
    expect(sim.questStatus("g2", "Recruit To Stay")).toBe("done");
    expect(sim.holdsCodex("g1", "Combo B First Half")).toBe(true);
    expect(sim.holdsCodex("g3", "Combo B First Half")).toBe(false);
  });

  it("a leave majority waits for the dossier, then fires the moment it lands", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    toBeans(sim);
    fireAll(sim, "trabolta_overshares", "y2k_clock");
    for (const g of ["g1", "g4", "g5"]) sim.join(g, "The Way Out");
    expect(v(sim, "Kernel.majority_reached")).not.toBe(true);
    dossier(sim);
    expect(v(sim, "Kernel.majority")).toBe("leave");
    expect(v(sim, "Kernel.server_unlocked")).toBe(true);
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
    expect(fate.some((e) => e.audience[0] === "g5" && e.text.startsWith("Your body is in the Maps and Ducks building"))).toBe(true); // nobody's
    expect(has(cues(b), "windows_shutdown")).toBe(true);
    expect(has(cues(advance(sim, 10)), "lights_dance")).toBe(true);
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

describe("Trapped in the Internet — the server-room alarm", () => {
  it("trips while locked, latches for 120 s, counts wrong combinations, stays quiet once unlocked", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    // Before the Y2K hour the door and the patch bay are inert: no alarm,
    // no reveal, no ending, no Trabolta line.
    for (const early of ["server_door_opened", "patch_rejected", "patch_combo_a", "patch_combo_b"]) {
      const e = fire(sim, early);
      expect(lines(e, "Trabolta"), early).toEqual([]);
      expect(cues(e), early).toEqual([]);
    }
    expect(v(sim, "Night.alarms")).toBe(0);
    expect(v(sim, "Night.ended")).toBe(false);
    expect(sim.isRevealedTo("The Server Room", "g1")).toBe(false);
    toHunt2(sim);
    toBeans(sim);
    fireAll(sim, "trabolta_overshares", "y2k_clock");
    const c0 = v(sim, "Trabolta.composure");
    const a1 = fire(sim, "server_door_opened");
    expect(v(sim, "Night.alarms")).toBe(1);
    expect(v(sim, "Trabolta.composure")).toBe(c0 - 10);
    expect(casts(a1).some((b) => b.cue.includes("alarm"))).toBe(true);
    expect(has(cues(a1), "lights_alarm")).toBe(true);
    expect(sim.isRevealedTo("The Server Room", "g1")).toBe(true);
    expect(replies(a1).filter((r) => r.text.startsWith("🚨 Server room breach"))).toHaveLength(4);

    fire(sim, "server_door_opened");
    expect(v(sim, "Night.alarms")).toBe(1); // latched
    advance(sim, 120);
    fire(sim, "server_door_opened");
    expect(v(sim, "Night.alarms")).toBe(2);
    expect(v(sim, "Trabolta.composure")).toBe(c0 - 10); // only the first trip costs composure
    advance(sim, 120);
    fire(sim, "patch_changed", null, { combo: "V1-D1" });
    expect(v(sim, "Night.wrong_combos")).toBe(1);
    expect(v(sim, "Night.alarms")).toBe(3);

    fire(sim, "server_unlock");
    advance(sim, 120);
    fire(sim, "server_door_opened");
    expect(v(sim, "Night.alarms")).toBe(3);
    fire(sim, "patch_rejected"); // the second wrong combination trips it even unlocked
    expect(v(sim, "Night.alarms")).toBe(4);
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

describe("Trapped in the Internet — the Cold Lock (K-27)", () => {
  it("a win before the Y2K hour is practice only", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    const e = fire(sim, "beat_the_machine", "g1", null, "Clippy");
    expect(v(sim, "Kernel.disarmed_until")).toBe(0);
    expect(has(cues(e), "state: unlocked")).toBe(false);
    expect(has(hostsSaid(e), "practice only")).toBe(true);
  });

  it("a host's ♟ disarms the door for 90 s, then it re-locks and alarms", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    expect(v(sim, "Night.step")).toBe(14);
    const w = fire(sim, "beat_the_machine", "g1", null, "Clippy");
    expect(v(sim, "Kernel.disarmed_until")).toBeGreaterThan(0);
    expect(has(cues(w), "door server_room, state: unlocked")).toBe(true);
    expect(has(cues(w), "lights_server_open")).toBe(true);
    expect(has(hostsSaid(w), "Cold Lock open")).toBe(true);
    // Inside the window the door is quiet.
    fire(sim, "server_door_opened");
    advance(sim, 80);
    fire(sim, "server_door_opened");
    expect(v(sim, "Night.alarms")).toBe(0);
    expect(v(sim, "Night.alarm_on")).toBe(false);
    expect(v(sim, "Kernel.server_unlocked")).toBe(false);
    // The window closes: re-locked, lights back to the Y2K look.
    const close = advance(sim, 15);
    expect(has(cues(close), "door server_room, state: locked")).toBe(true);
    expect(has(cues(close), "lights_y2k")).toBe(true);
    expect(v(sim, "Kernel.disarmed_until")).toBe(0);
    const a = fire(sim, "server_door_opened");
    expect(v(sim, "Night.alarms")).toBe(1);
    expect(beats(a)).toContain("Server Room Alarm");
  });

  it("the director's chess_won does the same (a signal named \"chess won\" folds to it)", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    fire(sim, "chess won");
    expect(v(sim, "Kernel.disarmed_until")).toBeGreaterThan(0);
    fire(sim, "server_door_opened");
    expect(v(sim, "Night.alarms")).toBe(0);
  });

  it("rearm_server_room closes a window, re-locks an unlock, clears the latch", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    fire(sim, "chess_won");
    const r = fire(sim, "rearm_server_room");
    expect(has(cues(r), "door server_room, state: locked")).toBe(true);
    expect(v(sim, "Kernel.disarmed_until")).toBe(0);
    fire(sim, "server_door_opened");
    expect(v(sim, "Night.alarms")).toBe(1);
    // The latch is cleared: the next opening trips again at once.
    fire(sim, "rearm_server_room");
    expect(v(sim, "Night.alarm_on")).toBe(false);
    fire(sim, "server_door_opened");
    expect(v(sim, "Night.alarms")).toBe(2);
    // An override unlock re-locks too.
    fire(sim, "server_unlock");
    advance(sim, 120);
    fire(sim, "server_door_opened");
    expect(v(sim, "Night.alarms")).toBe(2);
    fire(sim, "rearm_server_room");
    expect(v(sim, "Kernel.server_unlocked")).toBe(false);
    fire(sim, "server_door_opened");
    expect(v(sim, "Night.alarms")).toBe(3);
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
    expect(v(sim, "Kernel.server_unlocked")).toBe(true);
    expect(has(cues(evs), "door server_room, state: unlocked")).toBe(true);
    expect(sim.questStatus("g2", "Recruit To Stay")).toBe("done");
    // Neither a second press, the other side, nor a real majority re-runs it.
    evs.push(...fire(sim, "force_majority_stay"));
    evs.push(...fire(sim, "force_majority_leave"));
    for (const g of ["g1", "g3", "g4", "g5", "g6"]) evs.push(...sim.join(g, "The Way Out"));
    evs.push(...fire(sim, "waive_leader_tasks"));
    expect(v(sim, "Kernel.majority")).toBe("stay");
    expect(beats(evs).filter((b) => b === "Majority Reached")).toHaveLength(1);
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

/** Judge all eight questions accurately (or one lie, or skip F2), through the bob. */
function toBobbing(sim: Sim, opts: { lie?: boolean; skipF2?: boolean; dmLie?: boolean } = {}) {
  toTruth1(sim);
  fire(sim, "accurate_q1", "g1", null, "Clippy");
  fire(sim, "accurate_q2", "g2", null, "Clippy");
  fire(sim, opts.lie ? "confident_q3" : "accurate_q3", "g3", null, "Clippy");
  toHunt2(sim);
  if (opts.dmLie) {
    // A 📝 filing in dm:Trabolta during hunt 2, judged a confident lie.
    fire(sim, "fact answered", "g4", { question: "H5", answer: "Clippy", certain: true, card: 1 });
    fire(sim, "fact_lie", "g4", null, "Clippy");
  }
  fireAll(sim, "five_minute_warning", "summons_closed", "truth_pong");
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
  expect(replies(q3).some((r) => r.text.startsWith("There are only two final facts"))).toBe(true);
  if (opts.skipF2) fire(sim, "accurate_q1", "g3", null, "Clippy");
  else fire(sim, "accurate_q2", "g2", null, "Clippy");
  fire(sim, "bobbing_for_truth");
  expect(v(sim, "Night.phase")).toBe("bobbing");
  fire(sim, "ask_for_advice");
  expect(v(sim, "Night.phase")).toBe("bobbing"); // advice refused in the bob
  fire(sim, "failed_the_bob", "g5", null, "Adobe Acrobat");
  expect(sim.isCaptured("g5")).toBe(true);
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
    const rt = fire(sim, "read_truth_txt");
    for (const e of ["The Truth File", "Randy Barkmore Sr", "Julie Norton"]) expect(sim.holdsCodex("g1", e), e).toBe(true);
    expect(v(sim, "Night.ending")).toBe("song");
    expect(v(sim, "Night.ended")).toBe(true);
    expect(beats(rt)).toContain("Song Ending");
    expect(lines(rt, "Sandy")).toContain("I'm sorry, I didn't understand that. Would you like to speak to a live agent?");
    expect(sim.isCaptured("g5")).toBe(false);
    expect(sim.questStatus("g1", "The Final Facts")).toBe("done");
    expect(texts(rt).filter((t) => /\bnull\b/u.test(t))).toEqual([]);
  });

  it("eight accurate answers that skip F2 → Grok Prom", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { skipF2: true });
    const rt = fire(sim, "read_truth_txt");
    expect(v(sim, "Night.phase")).toBe("grok_prom");
    expect(beats(rt)).toContain("Grok Prom");
    expect(v(sim, "Night.ended")).not.toBe(true);
  });

  it("one lie → Grok Prom → a performer's pickup line", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { lie: true });
    fire(sim, "read_truth_txt");
    expect(v(sim, "Night.phase")).toBe("grok_prom");
    fire(sim, "the_line_works", "g1", null, "Clippy"); // an agent power: Clippy can't fire it
    expect(v(sim, "Night.ended")).not.toBe(true);
    const pl = fire(sim, "pickup_line_works", "g6", null, "Clippy");
    expect(v(sim, "Night.ending")).toBe("song_pickup");
    expect(v(sim, "Night.line_by")).toBe("VLC");
    expect(beats(pl)).toContain("Pickup Line");
    expect(sim.isCaptured("g5")).toBe(false);
    expect(texts(pl).filter((t) => /\bnull\b/u.test(t))).toEqual([]);
  });

  it("one DM bluff (a 📝 filing judged a confident lie) fails the verdict for good", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { dmLie: true });
    expect(v(sim, "Kernel.q5")).toBe("lie"); // g5's accurate Q2 in round 2 never clears it
    expect(v(sim, "Kernel.lies_accepted")).toBe(1);
    fire(sim, "read_truth_txt");
    expect(v(sim, "Night.phase")).toBe("grok_prom");
    expect(v(sim, "Night.ended")).not.toBe(true);
  });

  it("Trabolta accepts the line himself in Grok Prom", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { lie: true });
    fire(sim, "read_truth_txt");
    fire(sim, "the_line_works", "g1", null, "Trabolta");
    expect(v(sim, "Night.ending")).toBe("song_pickup");
    expect(v(sim, "Night.line_by")).toBe("Calculator");
  });

  it("the_line_works outside Grok Prom does nothing", () => {
    const sim = boot();
    toTruth1(sim);
    fire(sim, "the_line_works", "g1", null, "Trabolta");
    expect(v(sim, "Night.ended")).not.toBe(true);
    expect(v(sim, "Night.ending")).toBe("none");
  });

  it("nobody has the line → the confession → the rave (captives stay)", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { lie: true });
    fire(sim, "read_truth_txt");
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
    fire(sim, "read_truth_txt");
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
    fire(sim, "read_truth_txt");
    fire(sim, "ask_for_advice");
    const th = fire(sim, "advice_thwarted");
    expect(v(sim, "Night.ending")).toBe("banished");
    expect(v(sim, "Night.ended")).not.toBe(true);
    for (const [g] of PROGRAMS) {
      expect(sim.isCaptured(g), g).toBe(true);
      expect(sim.holdsCodex(g, "The Hand Jive Exception"), g).toBe(true);
    }
    expect(replies(th).filter((r) => /banish/iu.test(r.text)).length >= 4 || texts(th).some((t) => /Antivirus/u.test(t))).toBe(true);
    fire(sim, "the_hand_jive");
    expect(v(sim, "Night.ending")).toBe("hand_jive");
    expect(v(sim, "Night.ended")).toBe(true);
    for (const [g] of PROGRAMS) expect(sim.isCaptured(g), g).toBe(false);
    expect(sim.questStatus("g4", "Find The Exit")).toBe("done");
  });
});

// ───────────────────────── 5 · Trabolta's powers ─────────────────────────

const POWERS: Array<[string, Args | null]> = [
  ["snoop", { target: "g2" }],
  ["flicker_the_screens", null],
  ["pop_up", { target: "g2", text: "hi" }],
  ["mint_truthcoin", { amount: 20 }],
  ["cut_the_lights", { room: "The Cache" }],
  ["summon_the_antivirus", { target: "g2" }],
  ["trabolta_announces", { text: "hi" }],
  ["assess", { target: "g2", score: 5 }],
  ["pardon_a_program", { target: "g2" }],
  ["turn_back_the_clock", null],
  ["the_line_works", null],
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
    const later: Record<string, string> = { assess: "That function is not available yet.", the_line_works: "That function is not available yet." };
    for (const [p, a] of POWERS) {
      const t = lines(fire(sim, p, "g1", a, "Trabolta"), "Trabolta");
      expect(t, p).toEqual([later[p] ?? "I do not have the strength."]);
    }
  });

  it("each power's effect inside its window", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    expect(lines(fire(sim, "cut_the_lights", "g1", { room: "The Cache" }, "Trabolta"), "Trabolta")).toContain("That function is not available yet.");
    toHunt2(sim);

    const cl = fire(sim, "cut_the_lights", "g1", { room: "The Cache" }, "Trabolta");
    expect(cues(cl)).toContain("cue lights, room: The Cache, state: off");
    expect(casts(cl).some((b) => b.cue.includes("The lights in The Cache go out"))).toBe(true);
    expect(cues(advance(sim, 90))).toContain("cue lights, room: The Cache, state: on");
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
    expect(replies(sa).filter((r) => r.text.includes("MS Paint"))).toHaveLength(4);
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

describe("Trapped in the Internet — 📝 File a fact (K-24 + N-05)", () => {
  const file = (sim: Sim, g: string, question: string, answer: string, certain = true) =>
    fire(sim, "fact answered", g, { question, answer, certain, card: 1 });
  const facts = (evs: SimEvent[]) => widgets(evs).filter((w) => w.widget === "fact");
  const hosts = (sim: Sim, evs: SimEvent[]) => composeGuestMessages(sim, evs).filter((m) => m.channel === "room:hosts").map((m) => m.text);
  const trabolta = (evs: SimEvent[], g: string) => saidBy(evs, "Trabolta").filter((e) => e.audience.includes(g)).map((e) => e.text);

  it("deals the card in dm:Trabolta when each round's questions open, and on clearance after", { timeout: SLOW }, () => {
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
    // Round 2 deals a fresh card with H4–H6; round 3 with F1–F2.
    fireAll(sim, "hunt_time_up", "first_moment_of_truth", "second_hunt_preview");
    const r2 = facts(fire(sim, "start_the_second_hunt"));
    expect(r2.length).toBe(PROGRAMS.length + 1);
    expect(r2[0]!.params["questions"]).toMatch(/^H4: .*\| H5: .*\| H6: /u);
  });

  it("a filing lands in # hosts; 📝 confident lie is sticky, +50, and reads exactly like 📝 accurate", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    const s0 = v(sim, "g4.score");
    const filed = file(sim, "g4", "H5", "Clippy"); // an entity's name is a fine lie
    expect(hosts(sim, filed)).toEqual(["📝 MS Paint filed H5 (round 2 Q2): Clippy"]);
    expect(facts(filed).map((w) => w.audience)).toEqual([["g4"]]); // re-dealt
    expect(v(sim, "g4.last_fact_q")).toBe("H5");
    expect(diags(filed)).toEqual([]);
    // Judging is open to the hosts outside any Moment of Truth.
    expect(v(sim, "Night.judging")).not.toBe(true);
    const lie = fire(sim, "fact_lie", "g4", null, "Clippy");
    expect(v(sim, "Kernel.q5")).toBe("lie");
    expect(v(sim, "Kernel.lies_accepted")).toBe(1);
    expect(v(sim, "g4.score")).toBe(s0 + 50);
    expect(v(sim, "g4.truths_accepted")).toBe(1);
    // The same words for an accurate filing (another program, another question).
    file(sim, "g5", "H4", "Extension 0");
    const ok = fire(sim, "fact_accurate", "g5", null, "Clippy");
    expect(v(sim, "Kernel.q4")).toBe("accurate");
    const norm = (xs: string[], name: string, q: string) => xs.map((t) => t.replace(name, "X").replace(q, "Q"));
    expect(norm(trabolta(lie, "g4"), "MS Paint", "round 2 Q2")).toEqual(norm(trabolta(ok, "g5"), "Winamp", "round 2 Q1"));
    expect(norm(hosts(sim, lie), "MS Paint", "H5")).toEqual(norm(hosts(sim, ok), "Winamp", "H4"));
    // An accurate filing never clears a lie on the same question.
    file(sim, "g6", "H5", "Smooth Operator");
    fire(sim, "fact_accurate", "g6", null, "Clippy");
    expect(v(sim, "Kernel.q5")).toBe("lie");
    // A second press finds nothing to judge.
    const again = fire(sim, "fact_lie", "g4", null, "Clippy");
    expect(hosts(sim, again)).toEqual(["📝 MS Paint has no unjudged filing."]);
    expect(v(sim, "Kernel.lies_accepted")).toBe(1);
    // Trabolta's thread never carries the answer or the verdict.
    for (const t of [...trabolta(filed, "g4"), ...trabolta(lie, "g4")]) {
      expect(t).not.toContain("Clippy");
      expect(t).not.toMatch(/\blie\b|accurate/u);
    }
  });

  it("refuses an uncertain or unknown filing, a second one while one is unjudged, and a repeat question", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    const unsure = file(sim, "g1", "H2", "Mister Pickles", false);
    expect(hosts(sim, unsure)).toEqual([]);
    expect(trabolta(unsure, "g1").some((t) => t.includes("certain of"))).toBe(true);
    expect(facts(unsure).length).toBe(1); // re-dealt so they can try again
    expect(hosts(sim, file(sim, "g1", "Q9", "x"))).toEqual([]);
    file(sim, "g1", "H2", "Mister Pickles");
    const busy = file(sim, "g1", "H3", "9 am");
    expect(hosts(sim, busy)).toEqual([]);
    expect(trabolta(busy, "g1").some((t) => t.includes("still being reviewed"))).toBe(true);
    fire(sim, "fact_accurate", "g1", null, "Clippy");
    const repeat = file(sim, "g1", "H2", "Pickles");
    expect(hosts(sim, repeat)).toEqual([]);
    expect(trabolta(repeat, "g1").some((t) => t.includes("already filed"))).toBe(true);
    expect(v(sim, "g1.truths_accepted")).toBe(1);
  });

  it("refuses a question whose round hasn't opened; an earlier round's question still files late", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    const early = file(sim, "g2", "F2", "Grok");
    expect(hosts(sim, early)).toEqual([]);
    expect(trabolta(early, "g2").some((t) => t.includes("not open yet"))).toBe(true);
    expect(v(sim, "g2.fact_f2")).not.toBe(true);
    expect(v(sim, "g2.fact_pending")).not.toBe(true);
    toHunt2(sim);
    expect(hosts(sim, file(sim, "g2", "H6", "Appendix Z"))).toEqual(["📝 Microsoft Excel filed H6 (round 2 Q3): Appendix Z"]);
    fire(sim, "fact_accurate", "g2", null, "Clippy");
    expect(hosts(sim, file(sim, "g2", "H1", "Eleven years"))).toHaveLength(1); // late, still counts
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
    expect((await call(rt, "POST", "/api/mod/scan", { as: "Norton Anti-Virus", target: id }, { moderator: true })).status).toBe(200);
    for (const n of ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth"]) await mod(n);
    await mod("confident_q1", { subject: id, actor: "Clippy" });

    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Who is Sandy?" }, { token })).status).toBe(200);
    const reqs = worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
    expect(reqs).toHaveLength(1);
    const req = reqs[0]!;
    expect(Object.keys(req.world).filter((k) => k.startsWith("Kernel"))).toEqual([]);
    expect(Object.keys(req.world).some((k) => k.startsWith("Night."))).toBe(true);
    const blob = JSON.stringify(req);
    expect(blob).not.toContain("V2-D5"); // combo A
    expect(blob).not.toContain("V1-D6"); // combo B
    expect(Object.keys(req.them.vars).filter((k) => /lie|confident|accurate/u.test(k))).toEqual([]);

    const facts = (await call(rt, "GET", "/api/agent/facts", {}, { moderator: true })).json as unknown as AgentFacts;
    expect(Object.keys(facts.world).filter((k) => k.startsWith("Kernel"))).toEqual([]);
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
    expect(replies(again).some((r) => r.text.includes("already accepted"))).toBe(true);
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

  it("one room dark at a time; truth.txt waits for the Bag", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    fire(sim, "cut_the_lights", "g1", { room: "The Cache" }, "Trabolta");
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
    const s = fire(sim, "start_the_ceremony");
    expect(beats(s)).toEqual([]);
    expect(v(sim, "Night.ceremony")).toBe(false);
    const a = fire(sim, "award_best_liar", "g1", { value: 3 });
    expect(texts(a)).toEqual([]);
    expect(v(sim, "Night.award_winner")).toBe("none");
  });

  it("an ending → Trabolta hosts in The Desktop; awards carry the winner's name and number", () => {
    const sim = ended("song");
    const s = fire(sim, "start_the_ceremony");
    expect(v(sim, "Night.ceremony_host")).toBe("Trabolta");
    expect(beats(s)).toContain("The Ceremony");
    expect(cues(s)).toContain("cue screens_ceremony");
    expect(casts(s).map((c) => c.cue.replace(/^"|"$/gu, ""))).toEqual(["!🏆 THE AWARDS CEREMONY. Every program to the living room."]);
    expect(composeGuestMessages(sim, s).some((m) => m.alert === true)).toBe(true);
    expect(desktop(sim, s).length).toBe(2);
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
    expect(replies(a).map((r) => `${r.to}: ${r.text}`)).toEqual(["g1: 🏆 You won Most Trusted! Come up to the TV for your trophy."]);

    // Three awards on three real programs (the acceptance), names in the room.
    fire(sim, "award_frequent_flyer", "g5");
    const lh = fire(sim, "award_lore_hoarder", "g3");
    expect(desktop(sim, lh)[0]).toMatch(/^Trabolta: Lore Hoarder\. Codex entries: \d+\. OpenOffice\./u);
    const tt = fire(sim, "award_truthcoin_tycoon", "g6");
    expect(desktop(sim, tt)[0]).toMatch(/^Trabolta: Truthcoin Tycoon\. Balance \d+ Truthcoin\. VLC\./u);
    expect(v(sim, "Night.awards_given")).toBe(4);
  });

  it("every award reads a fallback with no number, and the director's value when given", () => {
    const sim = ended("help");
    fire(sim, "start_the_ceremony");
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

  it("the host changes per ending: Clippy after destroyed and rave, a weakened Trabolta after disabled", () => {
    for (const [ending, host] of [["destroyed", "Clippy"], ["rave", "Clippy"], ["disabled", "Trabolta"], ["song_pickup", "Trabolta"], ["hand_jive", "Trabolta"]] as const) {
      const sim = ended(ending);
      const s = fire(sim, "start_the_ceremony");
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
    expect(saidBy(fire(d, "start_the_ceremony"), "Trabolta")[0]!.text).toMatch(/^Before I go\./u);
    const c = ended("destroyed");
    expect(lines(fire(c, "start_the_ceremony"), "Clippy")[0]).toMatch(/^The computer is off\./u);
  });

  it("banished is not final: no ceremony until the hand jive ends the night", () => {
    const sim = boot();
    sim.setVar("Night.ending", "banished");
    expect(beats(fire(sim, "start_the_ceremony"))).toEqual([]);
  });

  it("runs once: a second start replays nothing", () => {
    const sim = ended("song");
    fire(sim, "start_the_ceremony");
    expect(beats(fire(sim, "start_the_ceremony"))).toEqual([]);
  });

  it("a real ending (all eight accurate → Song Ending) opens the ceremony", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim);
    fire(sim, "read_truth_txt");
    expect(v(sim, "Night.ending")).toBe("song");
    const s = fire(sim, "start_the_ceremony");
    expect(beats(s)).toContain("The Ceremony");
    const a = fire(sim, "award_most_trusted", "g1");
    expect(desktop(sim, a)[0]).toMatch(/^Trabolta: Most Trusted\. Trust score -?\d+\. Calculator\./u);
  });
});
