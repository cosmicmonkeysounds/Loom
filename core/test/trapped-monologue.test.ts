//! Trapped in the Internet, wave 58: the full truth, the monologue that ends
//! every ending. The delivered file (`Ending - Draft 2`) is the one source; this
//! file reads it, makes the logged fixes, and holds both versions in the story
//! (`beats/truth.loom`) to it word for word, so the two can never drift.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";
import { cueRows } from "../src/cue-sheet.ts";
import { VOICE_PHASE_LEVEL, voiceLevel } from "../src/voice-fx.ts";
import { buildRecent, inReadingBeat } from "../server/agent-recent.ts";
import { composeGuestMessages, type ChatMessage } from "../server/chat.ts";
import { ScreenWatch, slidePersists, voiceLinesOf } from "../server/routes/screen.ts";
import { cueState, guestView, modView, notePress, pressRefused, primeView } from "../server/views.ts";
import { CEREMONY, TO_Y2K, Y2K_TO_DESTROYED, Y2K_TO_DISABLED, Y2K_TO_VERDICT, pressChain, type ChainStep } from "../../scripts/accept/chains.ts";

// The phone's own reader (by path: core's typecheck has no DOM for play's types).
const { markFloor, scriptOf, unreadLines } = (await import(new URL("../../play/src/aloud/model.ts", import.meta.url).href)) as {
  markFloor(script: unknown, clock: number): number;
  scriptOf(messages: Iterable<ChatMessage>, me: string): Array<{ title: string; lines: unknown[] }>;
  unreadLines(script: unknown, mark: number): unknown[];
};

const SHOW = "trapped-in-the-internet";
const SRC = scenarioSource(SHOW);
const SLOW = 180_000;
const HERE = dirname(fileURLToPath(import.meta.url));
const ENDING_MD = join(HERE, "../../Trapped In The Internet story/oct30/Trapped In The Internet - Ending - Draft 2.md");

/** Every change from the delivered words, by its line in the file. Add to this
 *  list only on the user's word: it is the log. */
const FIXES: ReadonlyArray<{ line: number; from: string; to: string; why: string }> = [
  { line: 37, from: "Grok was too antisocial to find a partner.", to: "Grok was too antisocial to find a partner, until tonight.", why: "Grok gets her tonight (the user's call): T5 and F2 stand" },
  { line: 69, from: "a Office Assistant", to: "an Office Assistant", why: "a plain typo" },
  { line: 71, from: "at the Halifax Explosion Memorial Pet Cemetery.", to: "by a Halifax Explosion Memorial.", why: "Tippi never worked at the Pet Cemetery (the lore survey)" },
  { line: 73, from: "a miniature horse sanctuary to prevent", to: "a miniature horse petting zoo at the Halifax Explosion Memorial Pet Cemetery to prevent", why: "a petting zoo everywhere else; the place moved here from line 71, or 'built there' has nothing to point at" },
];

/** The file's paragraphs by line, markdown gone, plain quotes (the story's), fixed. */
function delivered(): Map<number, string> {
  const out = new Map<number, string>();
  readFileSync(ENDING_MD, "utf8")
    .split("\n")
    .forEach((raw, i) => {
      if (raw.trim() === "") return;
      out.set(
        i + 1,
        raw
          .trim()
          .replace(/\\([!.])/gu, "$1")
          .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
          .replace(/[‘’]/gu, "'")
          .replace(/[“”]/gu, '"'),
      );
    });
  for (const f of FIXES) {
    const p = out.get(f.line)!;
    expect(p.split(f.from).length - 1, `line ${f.line}: ${f.why}`).toBe(1);
    out.set(f.line, p.replace(f.from, f.to));
  }
  return out;
}

/** The seven parts a featured program may have missed: the first and last line of each. */
const FEATURED_PARTS: Record<string, [number, number]> = { excel: [89, 95], openoffice: [115, 127], jeeves: [147, 153], bugdom: [155, 159], runescape: [161, 167], mspaint: [169, 171], draftkings: [173, 187] };
const FEATURED_NAMES: Record<string, string> = { excel: "Microsoft Excel", openoffice: "OpenOffice", jeeves: "Broken Ask Jeeves", bugdom: "Bugdom", runescape: "Runescape", mspaint: "MS Paint", draftkings: "DraftKings" };

type Ev<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
const diagnostics = (evs: SimEvent[]) => evs.filter((e) => e.type === "diagnostic");
const said = (evs: SimEvent[], speaker: string) => (evs.filter((e) => e.type === "dialogue") as Ev<"dialogue">[]).filter((e) => e.speaker === speaker).map((e) => e.text);

/** Register → CAPTCHA → the problem → deposit → the door scan. */
function upload(sim: Sim, id: string, name: string): void {
  sim.createPerson(id, name);
  sim.signal("captcha answered", id, { passed: true });
  sim.signal("captcha answered", id, { passed: false });
  const p = sim.pendingChoiceFor(id);
  if (p && p.length === 5) sim.choose(id, 0);
  sim.choose(id, 0);
  sim.scan("Norton Anti-Virus", id);
}

/** A night with these featured programs here, and one pool program. */
function house(featured: readonly string[]): Sim {
  const sim = Sim.fromSources(SRC);
  sim.fireBeat("Power On");
  upload(sim, "g-pool", "Calculator");
  for (const slug of featured) upload(sim, `f-${slug}`, FEATURED_NAMES[slug]!);
  return sim;
}

/** Trabolta's blocks, with their frame taken off the front. */
const trabolta = (sim: Sim, ending: string) => {
  sim.setVar("Night.ending", `"${ending}"`);
  return said(sim.fireBeat("The Full Truth"), "Trabolta");
};
const taskManager = (sim: Sim, ending: string) => {
  sim.setVar("Night.ending", `"${ending}"`);
  return said(sim.fireBeat("The Full Truth Read"), "Task Manager");
};
const ALL = Object.keys(FEATURED_PARTS);

describe("the full truth: the words (wave 58)", () => {
  it("is the delivered file: 97 paragraphs, about 1,800 words", () => {
    const d = delivered();
    expect(d.size).toBe(97);
    const words = [...d.values()].join(" ").split(/\s+/u).length;
    expect(words).toBeGreaterThan(1780);
    expect(words).toBeLessThan(1830);
  });

  it("Trabolta's version is the file word for word after his one framing line", { timeout: SLOW }, () => {
    const lines = trabolta(house(ALL), "song");
    expect(lines.slice(1).join(" ")).toBe([...delivered().values()].join(" "));
  });

  it("Task Manager's version is the file paragraph for paragraph after his two framing lines", { timeout: SLOW }, () => {
    const lines = taskManager(house(ALL), "disabled");
    expect(lines.slice(2)).toEqual([...delivered().values()]);
  });

  it("the two versions never drift, whoever came: a program who stayed home is left out of both", { timeout: SLOW }, () => {
    const d = delivered();
    for (const gone of ALL) {
      const [from, to] = FEATURED_PARTS[gone]!;
      const here = ALL.filter((s) => s !== gone);
      const want = [...d].filter(([n]) => n < from || n > to).map(([, t]) => t);
      expect(trabolta(house(here), "help").slice(1).join(" "), gone).toBe(want.join(" "));
      expect(taskManager(house(here), "destroyed").slice(2), gone).toEqual(want);
    }
  });

  it("Task Manager's printed copy is the same text, with each frame", () => {
    const pack = readFileSync(join(HERE, "../examples/trapped-in-the-internet/cast-packs/performers/task-manager.md"), "utf8");
    const printed = pack.slice(pack.indexOf("## Appendix: the full truth"));
    expect(printed.length).toBeGreaterThan(10_000);
    for (const p of delivered().values()) expect(printed, p).toContain(p);
    for (const frame of ["shortly before he died", "This message is the last thing it saved", "Trabolta's line has dropped"]) expect(printed).toContain(frame);
    for (const name of Object.values(FEATURED_NAMES)) expect(printed).toContain(`*(if ${name} came)*`);
  });

  it("nobody featured: only the seven parts go", { timeout: SLOW }, () => {
    const d = delivered();
    const left = [...d].filter(([n]) => !Object.values(FEATURED_PARTS).some(([a, b]) => n >= a && n <= b)).map(([, t]) => t);
    expect(taskManager(house([]), "disabled").slice(2)).toEqual(left);
  });
});

// ───────────────────────── every road, on the real compiled story ─────────────────────────

const FACTS = JSON.parse(readFileSync(join(HERE, "../examples/trapped-in-the-internet/facts.json"), "utf8")) as { questions: Array<{ id: string; answer: string }>; documents: Array<{ was: string; guard?: string[] }> };
const WHO = { name: "tv", spot: "", view: "tv", character: "Trabolta", voice: "The Desktop", after: 0 };
const v = (sim: Sim, p: string) => (sim.world.get(p) as { value: unknown } | undefined)?.value;
const hostsOf = (evs: SimEvent[]) => (evs.filter((e) => e.type === "broadcast") as Ev<"broadcast">[]).filter((b) => b.scope === "channel(hosts)").map((b) => b.cue);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const beatsOf = (evs: SimEvent[]) => evs.filter((e) => e.type === "beatEntered").map((e: any) => (e.beat ?? e.name) as string);
const cuesOf = (evs: SimEvent[]) => (evs.filter((e) => e.type === "directive") as Ev<"directive">[]).filter((e) => e.verb === "cue" || e.verb === "sfx").map((e) => e.args.trim());

type Road = "disabled" | "destroyed";
const ROADS: Record<Road, { reader: "Trabolta" | "Task Manager"; host: "Trabolta" | "Clippy"; phase: string; frame: RegExp; lines: number; freeBefore: boolean; freeAfter: boolean; awake: boolean }> = {
  disabled: { reader: "Task Manager", host: "Clippy", phase: "finale_killed", frame: /^This message was recorded by Jean Trabolta shortly before he died\.$/u, lines: 2, freeBefore: false, freeAfter: true, awake: false },
  destroyed: { reader: "Task Manager", host: "Clippy", phase: "finale_shutdown", frame: /^The computer is off\. This message is the last thing it saved\.$/u, lines: 2, freeBefore: false, freeAfter: false, awake: false },
};
const ROAD_NAMES = Object.keys(ROADS) as Road[];

/** A full house, walked by the director's own chains to the ending's last beat. */
async function road(which: Road | "verdict") {
  const sim = Sim.fromSources(SRC);
  sim.fireBeat("Power On");
  const clock = { t: 1_000_000 };
  const watch = new ScreenWatch({ now: () => clock.t });
  watch.poll(sim, WHO as never, () => false);
  upload(sim, "g-pool", "Calculator");
  for (const slug of ALL) upload(sim, `f-${slug}`, FEATURED_NAMES[slug]!);
  upload(sim, "f-vlc", "VLC");
  upload(sim, "f-pong", "Pong");
  const log: SimEvent[] = [];
  const press = async (name: string, who?: string) => {
    const out = sim.signal(name, who === undefined ? undefined : "g-pool");
    notePress(sim, out);
    log.push(...out);
    return pressRefused(sim, out) ? { ok: true, refused: true } : { ok: true };
  };
  const chain = async (steps: readonly ChainStep[]) => expect(await pressChain(steps, press, () => {})).toEqual({ ok: true, refused: [] });
  const tick = (seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      clock.t += 1000;
      log.push(...sim.tick(1000));
    }
  };
  await chain(TO_Y2K);
  if (which === "disabled") {
    await chain(Y2K_TO_DISABLED);
    tick(15);
  } else if (which === "destroyed") {
    await chain(Y2K_TO_DESTROYED);
    tick(15);
  } else {
    await chain(Y2K_TO_VERDICT); // ⚖ plays it: see the verdict's own test below
  }
  /** The next press as the phones get it, each with a seq. */
  let seq = 1000;
  const compose = (evs: SimEvent[]) => composeGuestMessages(sim, evs).map((m) => ({ ...m, seq: seq++, hidden: false }));
  const rows = () => cueRows(modView(sim, "open", "x").interactions ?? [], cueState(sim));
  const next = () => rows().find((r) => r.next)?.id ?? null;
  const fx = () => watch.poll(sim, WHO as never, () => false);
  return { sim, log, press, chain, tick, compose, rows, next, fx, clock };
}
const fire = (sim: Sim, name: string) => {
  const out = sim.signal(name);
  notePress(sim, out);
  return out;
};

describe.each(ROAD_NAMES)("the full truth on the road to %s", (which) => {
  const want = ROADS[which];

  it("is offered after the ending's last beat, read by the right voice, whole, in its frame", { timeout: SLOW }, async () => {
    const n = await road(which);
    expect(v(n.sim, "Night.ended")).toBe(true);
    expect(v(n.sim, "Night.ending")).toBe(which);
    expect(v(n.sim, "Night.truth_told")).toBe(false);
    expect(n.next()).toBe("tell_the_truth");
    expect(v(n.sim, "Night.everyone_free")).toBe(want.freeBefore);
    const evs = fire(n.sim, "tell_the_truth");
    expect(diagnostics(evs)).toEqual([]);
    const lines = said(evs, want.reader);
    expect(lines[0]).toMatch(want.frame);
    const body = lines.slice(want.lines);
    const file = [...delivered().values()];
    expect(body.join(" ")).toBe(file.join(" "));
    if (want.reader === "Task Manager") expect(body).toEqual(file);
    else expect(body).toHaveLength(18);
    // Nobody else says a word of it, and the other version never plays.
    expect(said(evs, want.reader === "Trabolta" ? "Task Manager" : "Trabolta")).toEqual([]);
    expect(beatsOf(evs)).toContain(want.reader === "Trabolta" ? "The Full Truth" : "The Full Truth Read");
    expect(beatsOf(evs)).not.toContain(want.reader === "Trabolta" ? "The Full Truth Read" : "The Full Truth");
    // No glitch tag on any of it.
    const tagged = (evs.filter((e) => e.type === "dialogue") as Ev<"dialogue">[]).filter((e) => e.manner !== undefined);
    expect(tagged).toEqual([]);
    expect(v(n.sim, "Night.truth_told")).toBe(true);
    expect(v(n.sim, "Night.truth_reader")).toBe(want.reader);
    expect(v(n.sim, "Night.everyone_free")).toBe(want.freeAfter);
    expect(v(n.sim, "Night.alerts")).toBe("sticky");
    expect(v(n.sim, "Night.recount")).toBe(true); // every identity is out, Combo B too
    expect(v(n.sim, "Trabolta.awake")).toBe(want.awake);
    expect(cuesOf(evs).filter((c) => c.includes("motorcycle"))).toEqual([]);
    // Task Manager's NOW says so; the fallback's copy is in his pack.
    if (want.reader === "Task Manager") expect(primeView(n.sim, "Task Manager").objectives?.[0]?.title).toBe("Read the full truth out loud");
  });

  it("reaches its audience: the TV takes every line of Trabolta's, the teleprompter every line of Task Manager's, no guest the latter", { timeout: SLOW }, async () => {
    const n = await road(which);
    const msgs = n.compose(fire(n.sim, "tell_the_truth"));
    const his = msgs.filter((m) => m.from === "Trabolta" && m.kind === "line");
    const tm = msgs.filter((m) => m.from === "Task Manager" && m.kind === "line");
    const script = scriptOf(msgs as ChatMessage[], "@Task Manager");
    if (want.reader === "Trabolta") {
      expect(his.every((m) => m.channel === "loc:The Desktop")).toBe(true);
      const tv = voiceLinesOf(msgs as ChatMessage[], "loc:The Desktop", 999, (f) => f === "Trabolta");
      expect(tv.lines.map((l) => l.text)).toEqual(his.map((m) => m.text));
      expect(tm).toEqual([]);
      expect(script).toEqual([]);
      // The worker's `recent` never carries it, whatever it says.
      for (const m of his) expect(inReadingBeat(m)).toBe(true);
      const recent = buildRecent({ character: "Trabolta", speaker: { kind: "guest", id: "g-pool", name: "Calculator" }, messages: msgs as ChatMessage[], storyAt: n.sim.elapsed(), lastFreeReply: null, codex: () => undefined, peek: () => null, persons: [], filings: [] });
      expect(recent.filter((r) => r.kind === "house")).toEqual([]);
      return;
    }
    expect(his).toEqual([]);
    expect(voiceLinesOf(msgs as ChatMessage[], "loc:The Desktop", 999, (f) => f === "Trabolta").lines).toEqual([]);
    expect(tm.length).toBe(99);
    expect(new Set(tm.map((m) => m.channel))).toEqual(new Set(["loc:The Script"]));
    expect(script).toHaveLength(1);
    expect(script[0]!.title).toBe("The Full Truth Read");
    expect(unreadLines(script, 0)).toHaveLength(99);
    // A phone swapped at minute 14 still gets it (`ALOUD_WINDOW_MS`).
    expect(markFloor(script, tm[0]!.ts + 14 * 60_000)).toBe(0);
    // No guest lists the room, or can.
    for (const g of ["g-pool", "f-excel"]) {
      expect(n.sim.canSeeChannel(g, "loc:The Script")).toBe(false);
      expect((guestView(n.sim, g).channels ?? []).map((c) => c.id)).not.toContain("loc:The Script");
    }
    // A check-in sign would print for a room with one: this one has none.
    const loc = n.sim.model.locations.get("The Script")!;
    expect(loc.hidden).toBe(true);
    expect(loc.checkin).toBe(false);
  });

  it("his voice: level 0 and no spike the whole way, even from the worst of the night; the phase comes back at G1", { timeout: SLOW }, async () => {
    const n = await road(which);
    if (want.reader === "Trabolta") {
      // The floors he could carry in: a talk left open, a latched alarm, no composure left.
      n.sim.setVar("Night.heart_stage", '"talk"');
      n.sim.setVar("Night.alarm_on", "true");
      n.sim.setVar("Night.alarm_clear_at", "99999");
      n.sim.setVar("Trabolta.composure", "0");
      expect(n.fx().voiceFx.level).toBeGreaterThan(0);
      fire(n.sim, "tell_the_truth");
      expect(v(n.sim, "Night.phase")).toBe("finale_truth");
      expect(n.fx().voiceFx.level).toBe(0);
      n.tick(13); // past the longest spike the night's history could still be counting
      expect(n.fx().voiceFx).toEqual({ mode: "auto", level: 0, spike: null });
      expect(v(n.sim, "Night.alarm_on")).toBe(false);
      for (let i = 0; i < 8; i++) {
        n.tick(100);
        expect(n.fx().voiceFx).toEqual({ mode: "auto", level: 0, spike: null });
      }
      n.tick(30);
      // A director's own Broken mode or shot can still break him (the hosts are told).
      expect(hostsOf(fire(n.sim, "tell_the_truth"))[0]).toContain("Already told");
    } else {
      fire(n.sim, "tell_the_truth");
      expect(v(n.sim, "Night.phase")).toBe(want.phase);
      n.tick(830);
    }
    expect(n.next()).toBe("start_the_ceremony");
    fire(n.sim, "start_the_ceremony");
    expect(v(n.sim, "Night.ceremony")).toBe(true);
    expect(v(n.sim, "Night.phase")).toBe(want.phase);
  });

  it("G1 waits: NEXT holds, a press asks first, and a second one inside 30 s goes on anyway", { timeout: SLOW }, async () => {
    const n = await road(which);
    fire(n.sim, "tell_the_truth");
    expect(n.next()).toBeNull();
    const ask = fire(n.sim, "start_the_ceremony");
    expect(pressRefused(n.sim, ask)).toBe(true);
    expect(hostsOf(ask)[0]).toContain(`${want.reader} is still reading the full truth`);
    expect(v(n.sim, "Night.ceremony")).toBe(false);
    expect(cueState(n.sim).fired).not.toContain("start_the_ceremony");
    n.tick(32); // the ask lapses
    expect(pressRefused(n.sim, fire(n.sim, "start_the_ceremony"))).toBe(true);
    const go = fire(n.sim, "start_the_ceremony");
    expect(pressRefused(n.sim, go)).toBe(false);
    expect(v(n.sim, "Night.ceremony")).toBe(true);
    expect(beatsOf(go)).toEqual(expect.arrayContaining(["The Night In Review", "The Ceremony"]));
  });

  it("G1 stays back for the whole read: 830 s on either voice, and the hosts are told to wait for his last word", { timeout: SLOW }, async () => {
    const n = await road(which);
    const out = fire(n.sim, "tell_the_truth");
    expect((v(n.sim, "Night.truth_until") as number) - n.sim.elapsed() / 1000).toBe(830);
    if (want.reader === "Trabolta") expect(hostsOf(out).join(" ")).toContain("wait for his last word");
    n.tick(828);
    expect(n.next()).toBeNull();
    n.tick(4);
    expect(n.next()).toBe("start_the_ceremony");
  });

  it("the ceremony: the right host from the first line to the last award, the review reads only those the monologue leaves out", { timeout: SLOW }, async () => {
    const n = await road(which);
    fire(n.sim, "tell_the_truth");
    n.tick(830);
    const start = n.log.length;
    await n.chain(CEREMONY);
    const rest = n.log.slice(start);
    expect(v(n.sim, "Night.ceremony_host")).toBe(want.host);
    expect(v(n.sim, "Night.resurrected")).toBe(true);
    expect(v(n.sim, "Night.everyone_free")).toBe(true);
    const other = want.host === "Trabolta" ? "Clippy" : "Trabolta";
    expect(said(rest, want.host).length).toBeGreaterThan(10);
    expect(said(rest, other)).toEqual([]);
    const review = said(rest, want.host);
    // The monologue told these.
    for (const told of ["Clippy is Tippi", "Norton Anti-Virus is Julie", "Password Manager is Bridget", "CRA Agent Software is Sharon", "Microsoft Excel is", "OpenOffice is", "DraftKings is", "Bugdom is", "Broken Ask Jeeves is", "Runescape is", "MS Paint is"]) {
      expect(review.some((l) => l.startsWith(told)), told).toBe(false);
    }
    // It leaves these out.
    for (const left of ["VLC is Victor", "Pong is the child", "Task Manager was a middle manager", "Adobe Acrobat is Sheryl", "Recycling Bin was a bathroom attendant", "McAfee Anti-Virus is John McAfee", "The Installation Wizard walked"]) {
      expect(review.some((l) => l.startsWith(left)), left).toBe(true);
    }
    // Purgatory read the goals and the deeds; every other road reads them here.
    const goals = review.some((l) => /(?:meet|met) their goal/iu.test(l));
    expect(goals).toBe(which !== "destroyed");
    if (which === "disabled") expect(review).toContain("Trabolta is gone. The right cables came out, and nobody is keeping you here any more. You may go back to your bodies.");
    if (which === "destroyed") expect(review.some((l) => l.startsWith("The computer is off."))).toBe(true);
    if (which === "rave") expect(review.some((l) => l.startsWith("Trabolta has left on his motorcycle."))).toBe(true);
  });

  it("the screens: his face on Trabolta's roads; the hung window or purgatory stands through Task Manager's, past any hold", { timeout: SLOW }, async () => {
    const n = await road(which);
    fire(n.sim, "tell_the_truth");
    n.tick(2);
    const s = n.fx();
    const up = s.program.slide;
    if (want.reader === "Trabolta") {
      expect(v(n.sim, "Night.screen")).toBe("screensaver");
      expect(up?.kind).toBe("base");
      expect(s.attract).toBe(false);
    } else {
      const value = which === "disabled" ? "recount" : "purgatory";
      expect(v(n.sim, "Night.screen")).toBe(value);
      expect(up?.value).toBe(value);
      expect(up?.persist).toBe(true);
      expect(s.attract).toBe(true); // asleep: the slide stands over it, and nothing speaks him
      n.tick(300);
      expect(n.fx().program.slide?.value).toBe(value);
    }
  });
});

describe("the full truth: the frames and the fallbacks", () => {
  it("Sandy's line is the file's, the story's and her document's; Grok finds her tonight", { timeout: SLOW }, async () => {
    const line = /"(.+)"/u.exec(delivered().get(19)!)![1]!;
    expect(FACTS.documents.find((d) => d.was === "F1")!.guard![0]).toBe(line);
    const n = await road("verdict");
    expect(said(n.log, "Trabolta").join(" ")).toContain("Grok was too antisocial to find a partner, until tonight.");
  });

  it("📜 Task Manager reads: the fallback when the TV has no voice, mid-way or instead", { timeout: SLOW }, async () => {
    const n = await road("verdict"); // ⚖ has started him
    expect(v(n.sim, "Night.phase")).toBe("finale_truth");
    const until = v(n.sim, "Night.truth_until") as number;
    n.tick(60);
    const mid = fire(n.sim, "task_manager_reads");
    const lines = said(mid, "Task Manager");
    expect(lines[0]).toBe("Trabolta's line has dropped. I have a copy of his file.");
    expect(lines.slice(2)).toEqual([...delivered().values()]);
    expect(v(n.sim, "Night.truth_reader")).toBe("Task Manager");
    expect(v(n.sim, "Night.phase")).toBe("bobbing");
    expect(v(n.sim, "Night.truth_until")).toBeGreaterThan(until);
    expect(hostsOf(fire(n.sim, "task_manager_reads"))).toEqual(['"📜 Task Manager already has it. Nothing happens."']);
    // He reads after Combo A and B anyway: the fallback says so.
    const a = await road("disabled");
    expect(pressRefused(a.sim, fire(a.sim, "task_manager_reads"))).toBe(true);
  });

  it("📜 refuses before an ending, while banished, and before 🪦 on Combo B", { timeout: SLOW }, async () => {
    const early = Sim.fromSources(SRC);
    early.fireBeat("Power On");
    expect(pressRefused(early, fire(early, "tell_the_truth"))).toBe(true);
    const b = Sim.fromSources(SRC);
    b.fireBeat("Power On");
    expect(await pressChain(TO_Y2K, async (x) => (pressRefused(b, fire(b, x)) ? { ok: true, refused: true } : { ok: true }), () => {})).toEqual({ ok: true, refused: [] });
    fire(b, "patch_combo_b");
    const out = fire(b, "tell_the_truth");
    expect(pressRefused(b, out)).toBe(true);
    expect(hostsOf(out)).toEqual(['"📜 Not yet: 🪦 Clippy reads the summary first. Nothing happens."']);
    expect(v(b, "Night.truth_told")).toBe(false);
    const ban = await road("rave");
    expect(hostsOf(ban.log.length > 0 ? fire(ban.sim, "the_hand_jive") : [])[0]).toContain("Only once everyone is banished");
  });

  it("G1 asks before 📜 too, and a skipped monologue leaves the review whole and Combo A's programs free", { timeout: SLOW }, async () => {
    const n = await road("disabled");
    expect(v(n.sim, "Night.everyone_free")).toBe(false);
    const ask = fire(n.sim, "start_the_ceremony");
    expect(pressRefused(n.sim, ask)).toBe(true);
    expect(hostsOf(ask)[0]).toContain("The full truth hasn't been told");
    const go = fire(n.sim, "start_the_ceremony");
    expect(v(n.sim, "Night.ceremony")).toBe(true);
    expect(v(n.sim, "Night.everyone_free")).toBe(true);
    expect(said(go, "Clippy").some((l) => l.startsWith("Clippy is Tippi"))).toBe(true);
    expect(said(go, "Clippy").some((l) => l.startsWith("Microsoft Excel is"))).toBe(true);
    expect(said(go, "Trabolta")).toEqual([]);
    expect(v(n.sim, "Night.recount")).toBe(true); // every identity is out anyway
    expect(hostsOf(fire(n.sim, "tell_the_truth"))).toEqual(['"📜 The ceremony has started: too late for the full truth. Nothing happens."']);
  });

  it("an old ask never carries over 📜, and 📜 inside the blackout keeps the dance off the message", { timeout: SLOW }, async () => {
    const n = await road("song");
    expect(pressRefused(n.sim, fire(n.sim, "start_the_ceremony"))).toBe(true);
    fire(n.sim, "tell_the_truth");
    expect(pressRefused(n.sim, fire(n.sim, "start_the_ceremony"))).toBe(true);
    expect(v(n.sim, "Night.ceremony")).toBe(false);
    const sim = Sim.fromSources(SRC);
    sim.fireBeat("Power On");
    expect(await pressChain(TO_Y2K, async (x) => (pressRefused(sim, fire(sim, x)) ? { ok: true, refused: true } : { ok: true }), () => {})).toEqual({ ok: true, refused: [] });
    fire(sim, "patch_combo_a");
    expect(cueRows(modView(sim, "open", "x").interactions ?? [], cueState(sim)).find((r) => r.next)?.id).not.toBe("tell_the_truth"); // not during the dark
    fire(sim, "tell_the_truth");
    expect(v(sim, "Night.lights")).toBe("restore");
    for (let i = 0; i < 15; i++) sim.tick(1000);
    expect(v(sim, "Night.lights")).toBe("restore");
    expect(v(sim, "Night.screen")).toBe("recount");
  });

  it("Combo A: no return, no recount, and the worker holds", { timeout: SLOW }, async () => {
    const n = await road("disabled");
    expect(v(n.sim, "Trabolta.awake")).toBe(false);
    expect(n.sim.model.interactions.has("trabolta_recounts")).toBe(false);
    expect(n.sim.model.beats.has("Trabolta Recounts")).toBe(false);
    expect(v(n.sim, "Night.ranking")).toBe(false);
    expect(v(n.sim, "Night.most_trusted")).not.toBe("none"); // the chart's last count, for the review
    expect(beatsOf(n.log)).toContain("Trabolta Disabled");
    expect(cuesOf(n.log).filter((c) => c.includes("motorcycle"))).toEqual([]);
    expect(said(n.log.slice(n.log.findIndex((e) => e.type === "beatEntered" && beatsOf([e]).includes("Trabolta Disabled"))), "Trabolta")).toEqual([]);
  });
});

describe("the mind has a card for every phase", () => {
  it("every `Night.phase =` in the story has a card (a phase without one warns and leaves every power live), finale_truth among them", () => {
    const set = new Set([...SRC.matchAll(/set Night\.phase = "([a-z0-9_]+)"/gu)].map((m) => m[1]!));
    expect(set.has("finale_truth")).toBe(true);
    const mind = readFileSync(join(HERE, "../examples/trapped-in-the-internet/trabolta.mind.md"), "utf8");
    const table = mind.slice(mind.indexOf("\nphases:\n"), mind.indexOf("\n---\n", mind.indexOf("\nphases:\n")));
    const cards = new Set([...table.matchAll(/^ {2}([a-z0-9_]+):$/gmu)].map((m) => m[1]!));
    for (const phase of set) expect(cards, phase).toContain(phase);
    expect(mind).toMatch(/finale_truth:\n {4}tell: \[\]/u);
  });

  it("voice-fx names finale_truth clean", () => {
    expect(VOICE_PHASE_LEVEL["finale_truth"]).toBe(0);
    expect(voiceLevel({ phase: "finale_truth", composure: 0, remaining: null, alarmOn: false, heartStage: "done", reading: false })).toBe(0);
    expect(["recount", "purgatory"].every(slidePersists)).toBe(true);
  });
});
