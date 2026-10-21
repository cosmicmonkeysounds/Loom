//! Trapped in the Internet — wave 18b (the `show` lane, contract §5 B1).
//!
//! - R17 / R18: Clippy's opening names the owner who joins by video
//!   conference; the introduction, the DM hello and the online broadcast
//!   use his title, never "the computer's AI helper".
//! - R22: Facts Are Currency counts what a program found (by category).
//! - R10: the optional left-behind card and its secret slot.
//! - R4–R6 / Q5: the faction race (any founded faction), the founding
//!   window (O7), the whole truth once, a late pledger.
//! - R19: Trabolta's picture breaks on his Trust Chart.
//! - Q6 / R3: the readings (Round Two Tally, The Verdict) and `recent`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioFiles, scenarioSource } from "../examples/load.ts";
import { ChatStore, composeGuestMessages, type ChatMessage } from "../server/chat.ts";
import { guestView, notePress } from "../server/views.ts";
import { badgesOf } from "../src/runtime/sim/badges.ts";

const SRC = scenarioSource("trapped-in-the-internet");
const FILES = scenarioFiles("trapped-in-the-internet");
const SLOW = 120_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};

/** A Sim plus the chat the event server would compose from it. */
class Night {
  readonly sim = Sim.fromSources(SRC);
  readonly chat = new ChatStore();
  readonly events: SimEvent[] = [];
  constructor() {
    this.take(this.sim.fireBeat("Power On"));
  }
  take(events: SimEvent[]): ChatMessage[] {
    this.events.push(...events);
    return this.chat.append(composeGuestMessages(this.sim, events));
  }
  tick(seconds: number): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (let i = 0; i < seconds; i++) out.push(...this.take(this.sim.tick(1000)));
    return out;
  }
  signal(name: string, subject?: string, args?: Record<string, unknown>, actor?: string): ChatMessage[] {
    const ev = this.sim.signal(name, subject, args as never, actor);
    notePress(this.sim, ev);
    return this.take(ev);
  }
  /** The raw events of one signal (for dialogue and directives). */
  raw(name: string, subject?: string, args?: Record<string, unknown>, actor?: string): SimEvent[] {
    const ev = this.sim.signal(name, subject, args as never, actor);
    notePress(this.sim, ev);
    this.take(ev);
    return ev;
  }
  press(name: string, subject?: string): ChatMessage[] {
    return this.signal(name, subject);
  }
  scan(scanner: string, id: string): ChatMessage[] {
    return this.take(this.sim.scan(scanner, id));
  }
  upload(id: string, name: string, scanner: string | null = "Norton Anti-Virus"): ChatMessage[] {
    const out: ChatMessage[] = [];
    out.push(...this.take(this.sim.createPerson(id, name)));
    out.push(...this.signal("captcha answered", id, { passed: true }));
    out.push(...this.signal("captcha answered", id, { passed: false }));
    const p = this.sim.pendingChoiceFor(id);
    if (p && p.length === 4) out.push(...this.take(this.sim.choose(id, 0)));
    out.push(...this.take(this.sim.choose(id, 0)));
    if (scanner !== null) out.push(...this.scan(scanner, id));
    return out;
  }
}

const PROGRAMS: [string, string][] = [
  ["g1", "Calculator"],
  ["g2", "Microsoft Excel"],
  ["g3", "OpenOffice"],
  ["g4", "MS Paint"],
  ["g5", "Winamp"],
  ["g6", "VLC"],
];
const TO_BINGO = ["call_to_the_desktop", "start_the_bingo", "bingo_time"];

function boot(programs = PROGRAMS): Night {
  const n = new Night();
  for (const [id, name] of programs) n.upload(id, name);
  return n;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const worldKeys = (sim: Sim) => [...((sim.world as any).values as Map<string, unknown>).keys()];
type Dialogue = Extract<SimEvent, { type: "dialogue" }>;
const lines = (evs: readonly SimEvent[], speaker: string) => evs.filter((e): e is Dialogue => e.type === "dialogue" && e.speaker === speaker).map((e) => e.text.trim());

const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});
void mkdtempSync;
void tmpdir;
void join;

describe("Trapped in the Internet — wave 18b: Jean Trabolta, Sole Owner and Founder (R17, R18)", () => {
  it("the introduction, the DM hello and the online broadcast use his title, never the computer's AI helper", { timeout: SLOW }, () => {
    const n = boot();
    for (const c of TO_BINGO) n.press(c);
    const intro = n.raw("introduce_trabolta");
    expect(lines(intro, "Clippy")[0]).toBe("And now, joining us by video conference: the Sole Owner and Founder of Maps and Ducks! Everyone, say hello to JEAN TRABOLTA!");
    expect(lines(intro, "Trabolta")).toContain("HELLO, PROGRAMS. I am Jean Trabolta, Sole Owner and Founder of Maps and Ducks. The world's first AI small business owner. Personal queries go to Clippy.");
    expect(lines(intro, "Trabolta")).toContain("Hello, Calculator. I am Jean Trabolta, Sole Owner and Founder of Maps and Ducks, and proud to be the world's first AI small business owner. Your requests have been logged. Personal queries are routed to Clippy.");
    const online = intro.filter((e): e is Extract<SimEvent, { type: "broadcast" }> => e.type === "broadcast" && e.cue.includes("TRABOLTA IS ONLINE"));
    expect(online.map((e) => e.cue)).toEqual(['"!🤖 TRABOLTA IS ONLINE. Jean Trabolta, Sole Owner and Founder of Maps and Ducks, is speaking at the Desktop by video conference. His thread is open: say hello."']);
    for (const e of n.events) if (e.type === "dialogue") expect(e.text, e.text).not.toMatch(/AI helper/iu);
  });

  it("no story text but the in-world documents calls him the computer's AI helper (D20)", () => {
    const files = FILES.filter((f) => f.path.endsWith(".loom") && !/generated\/|9-facts|8-jeeves/u.test(f.path));
    const hits = files.flatMap((f) => f.source.split("\n").map((l, i) => ({ at: `${f.path}:${i + 1}`, l }))).filter((x) => !x.l.trim().startsWith("//") && /AI helper/iu.test(x.l));
    // server-room.loom is the `ending` lane's (its :230 / :376 are a request).
    expect(hits.filter((h) => !h.at.includes("server-room.loom")).map((h) => h.at)).toEqual([]);
  });
});

const COUNTED = new Set(["Facts", "Files", "People", "Trabolta", "Places"]);
/** Codes of entries the dossier counts that `who` does not hold yet. */
function countedCodes(sim: Sim, who: string): string[] {
  return [...sim.model.codexCodes.entries()]
    .filter(([, e]) => {
      const def = sim.model.codex.get(e);
      return def !== undefined && COUNTED.has(def.category ?? "") && !def.secret && !sim.holdsCodex(who, e) && !["The LiveJournal", "ILOVEYOU", "Free Antivirus Trial"].includes(e);
    })
    .map(([code]) => code);
}
const TO_HOUR = [...TO_BINGO, "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth", "close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt"];

describe("Trapped in the Internet — wave 18b: Facts Are Currency counts what she found (R22, D21)", () => {
  it("8 found in hunt 1 → 8 of 20 at the glitch; 12 more completes it; a handout never counts", { timeout: SLOW }, () => {
    const n = boot();
    // The base is what she holds at the end of her briefing (her three
    // entries and the Optical Drive); the handouts are not in it.
    expect(v(n.sim, "g3.dossier_base")).toBe(4);
    expect(v(n.sim, "g3.codex")).toBeGreaterThan(4);
    for (const c of TO_HOUR.slice(0, 6)) n.press(c);
    const found = countedCodes(n.sim, "g3").slice(0, 8);
    for (const code of found) n.take(n.sim.redeem("g3", code));
    for (const c of TO_HOUR.slice(6)) n.press(c);
    n.tick(125); // 📥 the Truther Download
    const glitch = n.take(n.sim.choose("g3", 0));
    void glitch;
    expect(v(n.sim, "g3.dossier_start")).toBe(8);
    expect(n.sim.questStatus("g3", "OpenOffice Dossier")).toBe("active");
    const start = n.events.filter((e) => e.type === "quest" && (e as { quest: string }).quest === "OpenOffice Dossier").map((e) => (e as { text?: string }).text);
    expect(start).toContain("8 of 20 facts.");
    // A handout (How it works / The story / Missions) never counts.
    const before = v(n.sim, "g3.codex_in.facts");
    n.take(n.sim.unlock("g3", "Bathroom Mode"));
    expect(v(n.sim, "g3.codex_in.facts")).toBe(before);
    // Twelve more: the quest is done (no "10 of 20" step, she started at 8).
    const more = countedCodes(n.sim, "g3").slice(0, 12);
    for (const code of more.slice(0, 11)) n.take(n.sim.redeem("g3", code));
    expect(n.sim.questStatus("g3", "OpenOffice Dossier")).toBe("active");
    n.take(n.sim.redeem("g3", more[11]!));
    expect(n.sim.questStatus("g3", "OpenOffice Dossier")).toBe("done");
    expect(v(n.sim, "Kernel.openoffice_dossier")).toBe(true);
  });

  it("holding 20 at the glitch completes it at once; the secret slots never ride Night.*", { timeout: SLOW }, () => {
    const n = boot();
    for (const c of TO_HOUR.slice(0, 6)) n.press(c);
    for (const code of countedCodes(n.sim, "g3").slice(0, 20)) n.take(n.sim.redeem("g3", code));
    for (const c of TO_HOUR.slice(6)) n.press(c);
    n.tick(125);
    n.take(n.sim.choose("g3", 0));
    expect(n.sim.questStatus("g3", "OpenOffice Dossier")).toBe("done");
    expect([...(n.sim.model.roles.get("Program")?.secret ?? [])]).toEqual(expect.arrayContaining(["dossier_start", "dossier_base"]));
    expect(worldKeys(n.sim).filter((k) => k.startsWith("Night.") && /dossier/u.test(k))).toEqual([]);
  });
});

describe("Trapped in the Internet — wave 18b: the header's new lines (R12, R15, R13)", () => {
  it("the lobby is hidden from guests, Bathroom Mode is a 🚻 badge, and the approver is MyCRA with a CRA audit", () => {
    const n = boot();
    expect(n.sim.model.lobbyHidden).toBe(true);
    expect(guestView(n.sim, "g1").lobby).toBe("hidden");
    expect(n.sim.model.badges.map((b) => [b.glyph, b.label])).toEqual([["🚻", "Bathroom Mode"]]);
    expect(badgesOf(n.sim, "g2")).toEqual([]);
    n.signal("go to the bathroom", "g2");
    expect(badgesOf(n.sim, "g2")).toEqual([{ glyph: "🚻", label: "Bathroom Mode" }]);
    expect(guestView(n.sim, "g1").people?.find((p) => p.id === "g2")?.badges).toEqual([{ glyph: "🚻", label: "Bathroom Mode" }]);
    n.signal("back from the bathroom", "g2");
    expect(badgesOf(n.sim, "g2")).toEqual([]);
    expect(n.sim.model.currency?.approver).toMatchObject({ id: "CRA Agent Software", every: 3, windowMs: 60_000, as: "MyCRA", audit: "a CRA audit" });
  });

  it("no `show tutorial` text names the story's title (R11)", () => {
    const title = "Trapped in the Internet";
    const shows = FILES.flatMap((f) => f.source.split("\n").filter((l) => /^\s*show tutorial\b/u.test(l)));
    expect(shows.length).toBeGreaterThan(0);
    for (const l of shows) expect(l.toLowerCase()).not.toContain(title.toLowerCase());
  });
});

describe("Trapped in the Internet — wave 18b: Trabolta's picture (R19, D23)", () => {
  it("the grin by default; broken while more than half of the cleared programs here are below 0 on his chart; mended after", { timeout: SLOW }, () => {
    const n = boot();
    const t = n.sim.model.characters.get("Trabolta")!;
    expect(t.avatar).toEqual(["picture:trabolta.svg"]);
    expect(t.avatarRules).toEqual([{ ref: "picture:trabolta-broken.svg", when: "self.broken == true" }]);
    for (const c of [...TO_BINGO, "introduce_trabolta"]) n.press(c);
    expect(v(n.sim, "Trabolta.broken")).toBe(false);
    // Three of six below 0: not more than half.
    for (const g of ["g1", "g2", "g3"]) n.take(n.sim.setVar(`${g}.trust`, "-10"));
    n.take(n.sim.tick(1000));
    expect(v(n.sim, "Trabolta.broken")).toBe(false);
    n.take(n.sim.setVar("g4.trust", "-5"));
    n.take(n.sim.tick(1000));
    expect(v(n.sim, "Trabolta.broken")).toBe(true);
    // A high program who went home makes it four of five: still broken.
    n.take(n.sim.setVar("g6.gone", "true"));
    n.take(n.sim.tick(1000));
    expect(v(n.sim, "Trabolta.broken")).toBe(true);
    // Trust back up: three of five is still more than half; two of five mends it.
    n.take(n.sim.setVar("g4.trust", "10"));
    n.take(n.sim.setVar("g3.trust", "10"));
    n.take(n.sim.tick(1000));
    expect(v(n.sim, "Trabolta.broken")).toBe(false);
  });
});
