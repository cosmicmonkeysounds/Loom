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

  it("nobody featured: only the seven parts go", { timeout: SLOW }, () => {
    const d = delivered();
    const left = [...d].filter(([n]) => !Object.values(FEATURED_PARTS).some(([a, b]) => n >= a && n <= b)).map(([, t]) => t);
    expect(taskManager(house([]), "disabled").slice(2)).toEqual(left);
  });
});
