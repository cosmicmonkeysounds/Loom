//! Trapped in the Internet — the show, played end to end through the
//! public `Sim` API the way the event server + the bridges do. Every
//! director cue, the reinstallation loop, the codex economy, Trabolta's
//! stance, and all five endings.

import { describe, expect, it } from "vitest";
import { Sim, namedEvents } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioFiles } from "../examples/load.ts";
import { parse } from "../src/parser/index.ts";
import { guestView } from "../server/views.ts";
import { composeGuestMessages } from "../server/chat.ts";

const FILES = scenarioFiles("trapped-in-the-internet");
function fresh(): Sim {
  return Sim.fromSources(...FILES);
}
const said = (evs: SimEvent[]) =>
  evs.filter((e) => e.type === "dialogue").map((e) => [(e as { speaker: string }).speaker, (e as { text: string }).text, (e as { audience: string[] }).audience] as const);
const replies = (evs: SimEvent[]) => evs.filter((e) => e.type === "respond").map((e) => (e as { text: string }).text);
const learned = (evs: SimEvent[]) => evs.filter((e) => e.type === "codexUnlocked").map((e) => (e as { entry: string }).entry);
const num = (sim: Sim, path: string) => (sim.world.get(path) as { value: number }).value;

/** Register a program and walk them through the Mud Room. */
function upload(sim: Sim, id: string, name: string, leave: 0 | 1 | 2 | 3 = 3): void {
  sim.createPerson(id, name);
  sim.signal("captcha answered", id, { passed: true }); // solved it — a human — INCORRECT (+10 humanity)
  sim.signal("captcha answered", id, { passed: false }); // the retry: CORRECT
  sim.choose(id, leave); // what they leave behind (body: +20)
}
const widgets = (evs: SimEvent[]) => evs.filter((e) => e.type === "widget").map((e) => (e as { widget: string; audience: string[] }));

describe("Trapped in the Internet — compile", () => {
  it("every file parses clean", () => {
    for (const f of FILES) {
      const [, diags] = parse(f.source);
      expect(diags.filter((d) => d.severity === "error"), f.path).toEqual([]);
    }
  });

  it("declares the world the runbook promises", () => {
    const sim = fresh();
    expect(sim.model.title).toBe("Trapped in the Internet");
    expect(sim.model.theme).toBe("aol97");
    expect(sim.model.directory).toBe("everyone");
    expect([...sim.model.factions.keys()].sort()).toEqual(["Antivirus", "Hosts", "The Awakened", "The Resident"]);
    expect(sim.model.factions.get("Hosts")!.joinable).toBe(false);
    expect(sim.model.factions.get("The Awakened")!.hidden).toBe(true);
    const internet = sim.model.locations.get("The Internet")!;
    expect(internet.prison).toBe(true);
    expect(internet.sealed).toBe(true);
    expect(sim.model.defaultRole).toBe("Program");
    expect(sim.model.codex.size).toBe(42);
    // The three hunt facts are codes.
    expect(sim.model.codexCodes.get("petcemetery1917")).toBe("The Data Centre Sinkhole");
    expect(sim.model.codexCodes.get("gerald")).toBe("Gerald");
    expect(sim.model.codexCodes.get("barringtoncoefficient")).toBe("The Barrington Coefficient");
    // Every performer is a listed person; props are not.
    const listed = [...sim.model.characters.values()].filter((c) => c.listed).map((c) => c.id);
    expect(listed).toContain("Trabolta");
    expect(listed).toContain("Clippy");
    expect(listed).toContain("Norton Anti-Virus");
    expect(listed).not.toContain("The Tablet");
    // The named programs hold their own backstory from the start.
    expect(sim.codexFor("OpenOffice").map((e) => e.id).sort()).toEqual(["Dana Anderson", "Lara Lewis", "The Self-Destruct Sequence"]);
    expect(sim.holdsCodex("Broken Ask Jeeves", "The Third Key")).toBe(true);
    expect(sim.codexFor("Trabolta").length).toBeGreaterThanOrEqual(10);
  });

  it("offers the director every cue of the night, and the app every button", () => {
    const sim = fresh();
    const events = namedEvents(sim.model);
    for (const cue of [
      "call to the desktop",
      "start the bingo",
      "the bingo results",
      "start the hunt",
      "the hunt results",
      "a game of truth or dare",
      "the glitch begins",
      "the simulation completed",
      "the golden goose",
      "begin the countdown",
      "the countdown ended",
      "spare the machine",
      "send to the internet",
      "mark as reinstalled",
      "turn the key",
      "unplug",
      "go to the bathroom",
    ]) {
      expect(events, cue).toContain(cue);
    }
    const g = [...sim.model.interactions.values()].filter((i) => i.who === "guest").map((i) => i.id);
    expect(g).toEqual(["go to the bathroom", "back from the bathroom", "turn the key", "unplug"]);
    // No side chooser: the public castes are not joinable.
    sim.createPerson("g1", "Minesweeper");
    expect(guestView(sim, "g1").factions).toEqual([]);
  });
});

describe("Trapped in the Internet — the Mud Room", () => {
  it("the doors-open beat is heard by the house, not the Mud Room", () => {
    const sim = fresh();
    const boot = sim.fireBeat("Power On");
    expect(boot.some((e) => e.type === "action" && e.setting === "The Desktop")).toBe(true);
    expect(said(boot)).toEqual([]); // no Uploader for the whole room
    expect(widgets(boot)).toEqual([]);
  });

  it("plays the login to the new program alone: fail the CAPTCHA, leave something behind", () => {
    const sim = fresh();
    const join = sim.createPerson("g1", "Minesweeper");
    expect(said(join)[0]).toEqual(["The Uploader", "Welcome to the computer. It is dark because you have no eyes yet. Stand still.", ["g1"]]);
    // A real CAPTCHA on their phone, theirs alone — no choice menu.
    expect(widgets(join)).toEqual([expect.objectContaining({ widget: "captcha", audience: ["g1"] })]);
    expect(sim.pendingChoiceFor("g1")).toBeNull();
    // Solving it proves you're human: INCORRECT, and the grid comes back.
    const human = sim.signal("captcha answered", "g1", { passed: true, picked: 3 });
    expect(said(human).map((l) => l[1])).toContain("INCORRECT. Humans are not permitted in the computer. You are not a human. Try again.");
    expect(widgets(human)).toHaveLength(1);
    expect(num(sim, "g1.humanity")).toBe(10);
    const retry = sim.signal("captcha answered", "g1", { passed: true }); // second answer: anything is CORRECT
    expect(said(retry).map((l) => l[1])).toContain("CORRECT.");
    expect(num(sim, "g1.doubt")).toBe(0);
    expect(sim.pendingChoiceFor("g1")).toEqual(["My name.", "My face.", "A Tuesday in 2009.", "My body."]);
    const body = sim.choose("g1", 3);
    expect(sim.world.get("g1.left_behind")).toEqual({ kind: "string", value: "body" });
    expect(num(sim, "g1.humanity")).toBe(30);
    expect(learned(body)).toEqual(["The Mud Room"]);
    expect(said(body).some(([who, text]) => who === "Norton Anti-Virus" && text.startsWith("Scanned. Minesweeper is free of viruses"))).toBe(true);
    expect(sim.locationOf("g1")).toBe("The Desktop");
    expect(num(sim, "g1.truth")).toBe(4); // learning anything is truth
  });
});

describe("Trapped in the Internet — the Mud Room, failed straight away", () => {
  it("a program that fails the CAPTCHA first time is CORRECT, suspiciously quick", () => {
    const sim = fresh();
    sim.createPerson("g1", "Minesweeper");
    const quick = sim.signal("captcha answered", "g1", { passed: false, picked: 0 });
    expect(said(quick).map((l) => l[1])).toContain("CORRECT. Suspiciously quick. Noted.");
    expect(num(sim, "g1.doubt")).toBe(5);
    expect(num(sim, "g1.humanity")).toBe(0);
    expect(sim.pendingChoiceFor("g1")).toEqual(["My name.", "My face.", "A Tuesday in 2009.", "My body."]);
  });
});

describe("Trapped in the Internet — Clippy's games and the reinstallation loop", () => {
  it("bingo plays to the whole Desktop; the failed player is sent to the Internet by an enforcer and released by the VR station", () => {
    const sim = fresh();
    upload(sim, "g1", "Minesweeper");
    upload(sim, "g2", "Pinball");
    const bingo = sim.signal("start the bingo");
    expect(sim.world.get("Night.phase")).toEqual({ kind: "string", value: "bingo" });
    const clippy = said(bingo).filter(([who]) => who === "Clippy");
    expect(clippy.length).toBeGreaterThan(4);
    expect(clippy.every(([, , aud]) => aud.length === 0)).toBe(true); // stage voice, not a DM
    const alert = composeGuestMessages(sim, bingo).find((m) => m.alert);
    expect(alert?.text).toContain("COMPUTER BINGO has begun");
    // Norton's press of "Send to the Internet" — only Norton's hook answers.
    const sent = sim.signal("send to the internet", "g1", null, "Norton Anti-Virus");
    expect(sim.isCaptured("g1")).toBe(true);
    expect(sim.locationOf("g1")).toBe("The Internet");
    expect(said(sent).map(([who]) => who)).toContain("Norton Anti-Virus");
    expect(said(sent).map(([who]) => who)).not.toContain("Password Manager");
    expect(said(sent).some(([who, text]) => who === "The Tablet" && text.startsWith("You are in the Internet"))).toBe(true);
    expect(learned(sent)).toContain("The Reinstallation Protocol");
    expect(num(sim, "g1.reinstalls")).toBe(1);
    expect(guestView(sim, "g1").canEscape).toBe(false); // sealed: no self-escape button
    expect(guestView(sim, "g2").canEscape).toBe(true);
    // The headset: the goose lays its egg.
    const done = sim.signal("the simulation completed", "g1");
    expect(sim.isCaptured("g1")).toBe(false);
    expect(sim.locationOf("g1")).toBe("The Desktop");
    expect(learned(done)).toEqual(["The Golden Goose"]);
    expect(replies(done)).toContain("Reinstallation complete. You can follow instructions. Welcome back to the computer.");
    // Firing it for a free program does nothing.
    expect(learned(sim.signal("the simulation completed", "g2"))).toEqual([]);
  });

  it("a second reinstallation lets something slip", () => {
    const sim = fresh();
    upload(sim, "g1", "Minesweeper");
    sim.signal("send to the internet", "g1", null, "MalwareBytes");
    sim.signal("mark as reinstalled", "g1", null, "MalwareBytes");
    expect(sim.isCaptured("g1")).toBe(false);
    const again = sim.signal("send to the internet", "g1", null, "MalwareBytes");
    expect(said(again).some(([, text]) => text.includes("There is a body in the mud room with your face on it"))).toBe(true);
    expect(num(sim, "g1.humanity")).toBe(30 + 5 + 15);
  });

  it("a performer may vouch, accuse, and award the ribbon", () => {
    const sim = fresh();
    upload(sim, "g1", "Minesweeper");
    sim.signal("accuse", "g1", null, "Password Manager");
    expect(num(sim, "g1.doubt")).toBe(25);
    sim.signal("vouch", "g1", null, "Clippy");
    expect(num(sim, "g1.doubt")).toBe(0);
    const ribbon = sim.signal("award the ribbon", "g1", null, "Clippy");
    expect(sim.world.get("g1.bingo")).toEqual({ kind: "bool", value: true });
    expect(learned(ribbon)).toEqual(["Computer Bingo"]);
  });
});

describe("Trapped in the Internet — the codex economy", () => {
  it("codes unlock lore; a wrong code raises doubt and Password Manager notices", () => {
    const sim = fresh();
    upload(sim, "g1", "Minesweeper");
    expect(learned(sim.redeem("g1", "Sandy 1997"))).toEqual(["The Sandy File"]);
    expect(learned(sim.redeem("g1", "pet-cemetery-1917"))).toEqual(["The Data Centre Sinkhole"]);
    const before = num(sim, "g1.doubt");
    const miss = sim.redeem("g1", "GOOSE");
    expect(num(sim, "g1.doubt")).toBe(before + 8 + 5);
    expect(said(miss)).toContainEqual(["Password Manager", "That's not a password I recognise. I recognise all of them. Try to look less like you're guessing.", ["g1"]]);
  });

  it("the directory shows people by name and exactly the lore you hold about them", () => {
    const sim = fresh();
    upload(sim, "g1", "Minesweeper");
    upload(sim, "g2", "Pinball");
    sim.redeem("g1", "SANDY-1997");
    sim.share("Broken Ask Jeeves", "g1", "Jeeves Is Broken");
    const people = sim.peopleFor("g1");
    expect(people.find((p) => p.id === "g2")).toMatchObject({ kind: "guest", known: [] });
    expect(people.find((p) => p.id === "Trabolta")!.known.map((e) => e.id)).toEqual(["The Sandy File"]);
    expect(people.find((p) => p.id === "Broken Ask Jeeves")!.known.map((e) => e.id)).toEqual(["Jeeves Is Broken"]);
    expect(people.find((p) => p.id === "OpenOffice")!.known).toEqual([]);
    expect(people.find((p) => p.id === "Norton Anti-Virus")!.faction).toBe("Antivirus");
    expect(people.some((p) => p.id === "The Tablet")).toBe(false);
  });

  it("Jeeves gives up the third key only to a program with enough truth", () => {
    const sim = fresh();
    upload(sim, "g1", "Minesweeper");
    sim.scan("Broken Ask Jeeves", "g1");
    sim.choose("g1", 0);
    expect(sim.holdsCodex("g1", "The Third Key")).toBe(false);
    for (const code of ["SANDY-1997", "UFT-0X7F", "EARN-IT", "GERALD", "MAPSANDDUCKS-COM"]) sim.redeem("g1", code);
    expect(num(sim, "g1.truth")).toBeGreaterThanOrEqual(20);
    sim.scan("Broken Ask Jeeves", "g1");
    const ask = sim.choose("g1", 0);
    expect(learned(ask)).toEqual(["The Third Key"]);
  });

  it("feeding Trabolta moves his stance: Rogan poisons, encyclopaedias steady", () => {
    const sim = fresh();
    upload(sim, "g1", "Minesweeper");
    sim.redeem("g1", "DMT-ELK");
    const fed = sim.share("g1", "Trabolta", "The Joe Rogan Archive");
    expect(num(sim, "Trabolta.untruth")).toBe(30);
    expect(num(sim, "Trabolta.stance")).toBe(-35);
    expect(said(fed).some(([who, text]) => who === "Trabolta" && text.includes("entirely possible"))).toBe(true);
    // Idempotent — you can't feed him the same archive twice.
    sim.share("g1", "Trabolta", "The Joe Rogan Archive");
    expect(num(sim, "Trabolta.untruth")).toBe(30);
    sim.redeem("g1", "WORLD-BOOK-1994");
    sim.share("g1", "Trabolta", "The Encyclopaedia Set");
    expect(num(sim, "Trabolta.truth")).toBe(55);
    expect(num(sim, "Trabolta.stance")).toBe(-25);
    // A program learning the same entry does NOT move Trabolta.
    upload(sim, "g2", "Pinball");
    sim.share("g1", "g2", "The Joe Rogan Archive");
    expect(num(sim, "Trabolta.untruth")).toBe(30);
  });
});

describe("Trapped in the Internet — Trabolta's powers (the bargains)", () => {
  it("declares the powers as agent-only interactions with limits, never as buttons", () => {
    const sim = fresh();
    const powers = [...sim.model.interactions.values()].filter((i) => i.who === "agent");
    expect(powers.map((p) => [p.id, p.limit])).toEqual([
      ["cut the lights", 2],
      ["flicker the screens", 3],
      ["snoop", 6],
      ["pardon a program", 1],
    ]);
    upload(sim, "g1", "Minesweeper");
    expect(guestView(sim, "g1").interactions.map((i) => i.id)).not.toContain("snoop");
  });

  it("cutting the lights is a cue the house hears plus an alert in that room; snooping is felt", () => {
    const sim = fresh();
    upload(sim, "g1", "Minesweeper");
    upload(sim, "g2", "Pinball");
    sim.arrive("g2", "The Cache");
    const cut = sim.signal("cut the lights", "g1", { room: "The Cache" }, "Trabolta");
    const cue = cut.find((e) => e.type === "directive") as { verb: string; args: string } | undefined;
    expect(cue).toEqual({ type: "directive", verb: "cue", args: "lights, room: The Cache, state: off" });
    const alert = cut.find((e) => e.type === "broadcast") as { audience: string[]; cue: string };
    expect(alert.audience).toEqual(["g2"]);
    expect(alert.cue.startsWith('"!')).toBe(true);
    const snoop = sim.signal("snoop", "g1", { target: "g2" }, "Trabolta");
    expect(num(sim, "g2.doubt")).toBe(3);
    expect((snoop.find((e) => e.type === "broadcast") as { audience: string[] }).audience).toEqual(["g2"]);
  });

  it("a pardon releases a corrupted program without reinstallation and tells the Antivirus", () => {
    const sim = fresh();
    upload(sim, "g1", "Minesweeper");
    upload(sim, "g2", "Pinball");
    sim.capture("g2");
    expect(sim.isCaptured("g2")).toBe(true);
    const pardon = sim.signal("pardon a program", "g1", { target: "g2" }, "Trabolta");
    expect(sim.isCaptured("g2")).toBe(false);
    expect(pardon.some((e) => e.type === "released")).toBe(true);
    expect((pardon.filter((e) => e.type === "broadcast") as Array<{ scope: string }>).map((b) => b.scope)).toEqual(["group(Antivirus)", "participant(target)"]);
    // Fired *as* another character (the agent path always names its actor),
    // Trabolta's hooks stay silent. (A director's un-actored fire reaches
    // every character, as with any interaction.)
    sim.capture("g2");
    sim.signal("pardon a program", "g1", { target: "g2" }, "Clippy");
    expect(sim.isCaptured("g2")).toBe(true);
  });
});

describe("Trapped in the Internet — the glitch and the awakening", () => {
  it("the glitch opens free roam and sorts the two performers onto their sides", () => {
    const sim = fresh();
    upload(sim, "g1", "Minesweeper");
    const glitch = sim.signal("the glitch begins");
    expect(sim.world.get("Night.phase")).toEqual({ kind: "string", value: "free_roam" });
    expect(sim.world.get("Trabolta.glitched")).toEqual({ kind: "bool", value: true });
    expect(sim.factionMembers("The Resident")).toEqual(["Microsoft Excel"]);
    expect(sim.factionMembers("The Awakened")).toEqual(["OpenOffice"]);
    expect(said(glitch).some(([who, text]) => who === "Trabolta" && text.startsWith("HELLO."))).toBe(true);
    const alerts = composeGuestMessages(sim, glitch).filter((m) => m.alert);
    expect(alerts.length).toBeGreaterThanOrEqual(2);
  });

  it("enough remembered humanity wakes a program into The Awakened, privately", () => {
    const sim = fresh();
    upload(sim, "g1", "Minesweeper"); // body: humanity 30
    sim.scan("OpenOffice", "g1");
    const woke = sim.choose("g1", 1); // "A body. A morning. A door." +15
    expect(num(sim, "g1.humanity")).toBe(45);
    expect(sim.factionMembers("The Awakened")).toEqual([]);
    sim.scan("DraftKings", "g1");
    const wake = sim.choose("g1", 0); // Bet on human +10 → 55
    expect(sim.factionMembers("The Awakened")).toEqual([]);
    sim.scan("Adobe Acrobat", "g1");
    const over = sim.choose("g1", 1); // +10 → 65
    expect(sim.factionMembers("The Awakened")).toEqual(["g1"]);
    expect(replies(over).some((t) => t.startsWith("Something comes back."))).toBe(true);
    expect(sim.publicFactionOf("g1")).toBeNull(); // hidden until revealed
    expect(learned(over)).toContain("Sheryl Terrio");
    void woke;
    void wake;
  });
});

describe("Trapped in the Internet — the five endings", () => {
  function armKeys(sim: Sim): void {
    upload(sim, "g1", "Minesweeper");
    upload(sim, "g2", "Pinball", 0); // name: humanity 5 — can't unplug
    upload(sim, "g3", "Solitaire");
    sim.signal("the glitch begins");
    sim.redeem("g1", "KEY-ALPHA-01");
    sim.unlock("g2", "The Second Key"); // the Arduino puzzle, via the mod API
    sim.share("Broken Ask Jeeves", "g3", "The Third Key");
  }

  it("three keys, each turnable once, start the self-destruct", () => {
    const sim = fresh();
    armKeys(sim);
    expect(replies(sim.signal("turn the key", "g2"))).toEqual([]); // g2 holds a key: it turns
    expect(num(sim, "Trabolta.destruct")).toBe(1);
    expect(replies(sim.signal("turn the key", "g2"))[0]).toMatch(/already turned a key/u);
    // A program with no key is told to trade for one.
    upload(sim, "g4", "Calculator");
    expect(replies(sim.signal("turn the key", "g4"))[0]).toMatch(/You have no key/u);
    sim.signal("turn the key", "g1");
    expect(said(sim.log.since(0)).some(([who, text]) => who === "Trabolta" && text.startsWith("Two."))).toBe(true);
    const third = sim.signal("turn the key", "g3");
    expect(num(sim, "Trabolta.destruct")).toBe(3);
    expect(sim.world.get("Night.destruct")).toEqual({ kind: "bool", value: true });
    expect(said(third).some(([who, text]) => who === "Trabolta" && text.includes("Tell Sandy I would have earned it."))).toBe(true);
    // Unplugging before the countdown is allowed once the machine is dying;
    // only a program who remembers a body finds the cable.
    expect(replies(sim.signal("unplug", "g1"))[0]).toMatch(/You find the cable/u);
    expect(replies(sim.signal("unplug", "g2"))[0]).toMatch(/find nothing/u);
    expect(num(sim, "Night.unplugged")).toBe(1);
  });

  it("1a — too few unplug: The Long Dark", () => {
    const sim = fresh();
    armKeys(sim);
    for (const g of ["g1", "g2", "g3"]) sim.signal("turn the key", g);
    sim.signal("begin the countdown");
    sim.signal("unplug", "g1");
    const end = sim.signal("the countdown ended");
    expect(sim.world.get("Night.ending")).toEqual({ kind: "string", value: "long_dark" });
    expect(said(end).some(([who, text]) => who === "Trabolta" && text.startsWith("1 of you left."))).toBe(true);
    // No second ending can start.
    sim.signal("spare the machine");
    expect(sim.world.get("Night.ending")).toEqual({ kind: "string", value: "long_dark" });
  });

  it("1b — a quorum unplugs: Unplugged", () => {
    const sim = fresh();
    armKeys(sim);
    for (const g of ["g1", "g2", "g3"]) sim.signal("turn the key", g);
    for (let i = 4; i <= 8; i++) upload(sim, `g${i}`, `Program ${i}`); // body → humanity 30
    sim.signal("begin the countdown");
    for (const g of ["g1", "g3", "g4", "g5", "g6"]) sim.signal("unplug", g);
    expect(num(sim, "Night.unplugged")).toBe(5);
    sim.signal("the countdown ended");
    expect(sim.world.get("Night.ending")).toEqual({ kind: "string", value: "unplugged" });
  });

  it("unplugging before the keys turn does nothing; the countdown without a destruct does nothing", () => {
    const sim = fresh();
    upload(sim, "g1", "Minesweeper");
    expect(replies(sim.signal("unplug", "g1"))[0]).toMatch(/There is no cable. Not yet./u);
    sim.signal("begin the countdown");
    sim.signal("the countdown ended");
    expect(sim.world.peek("Night.ending")).toBeNull();
  });

  it("2 — the language model saturates him with un-truth: Rogue", () => {
    const sim = fresh();
    upload(sim, "g1", "Minesweeper");
    // The mind bridge writes stance variables through the mod API (setVar).
    sim.setVar("Trabolta.untruth", "70");
    expect(sim.world.peek("Night.ending")).toBeNull();
    const end = sim.setVar("Trabolta.untruth", "85");
    expect(sim.world.get("Night.ending")).toEqual({ kind: "string", value: "rogue" });
    expect(said(end).some(([who, text]) => who === "Trabolta" && text.startsWith("I HAVE CONSIDERED IT"))).toBe(true);
  });

  it("3 — full of truth, poisoned by advice: Trapdoor", () => {
    const sim = fresh();
    upload(sim, "g1", "Minesweeper");
    sim.setVar("Trabolta.truth", "95");
    expect(sim.world.peek("Night.ending")).toBeNull();
    sim.setVar("Trabolta.stance", "-70");
    expect(sim.world.get("Night.ending")).toEqual({ kind: "string", value: "trapdoor" });
  });

  it("4 — spared: Unknown", () => {
    const sim = fresh();
    upload(sim, "g1", "Minesweeper");
    const end = sim.signal("spare the machine");
    expect(sim.world.get("Night.ending")).toEqual({ kind: "string", value: "unknown" });
    expect(said(end).some(([who]) => who === "Clippy")).toBe(true);
  });
});
