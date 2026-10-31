//! Wave 58: a story hook that names a codex entry is checked here, because
//! nothing else fails on a dead one. `loomcheck` only WARNs on it and exits 0,
//! so `predeploy` passes it; the four digit notes would then scan, never count,
//! and The Door Code would never assemble. Reads the whole story, generated
//! files included: every `when <who> learns <entry>:`, every
//! `<who>.codex.<slug>`, every `unlock <entry> for …`.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { foldName } from "../src/parser/names.ts";
import { scenarioFiles, scenarioSource } from "../examples/load.ts";

const SHOW = "trapped-in-the-internet";
const FILES = scenarioFiles(SHOW).filter((f) => f.path.endsWith(".loom"));
const MODEL = Sim.fromSources(scenarioSource(SHOW)).model;
const ENTRIES = new Set([...MODEL.codex.keys()].map(foldName));
const SLUGS = new Set([...MODEL.codex.keys()].map(Sim.codexSlug));

/** The story's lines with their `//` comments gone, and where each one is. */
const lines = FILES.flatMap((f) => f.source.split("\n").map((raw, i) => ({ at: `${f.path}:${i + 1}`, text: raw.replace(/\/\/.*$/u, "") })));

const LEARNS = /^\s*when\s+\S+\s+(?:learns?|learned|learnt)\s+(.+?):\s*$/u;
const UNLOCK = /^\s*unlock\s+(.+?)\s+for\s+\S+\s*$/u;
const SLUG = /\.codex\.([a-z0-9_]+)/gu;

describe("the story's hooks name real codex entries", () => {
  it("finds the hooks at all (the patterns still match the story)", () => {
    const learns = lines.filter((l) => LEARNS.test(l.text));
    expect(learns.length).toBeGreaterThanOrEqual(8);
    expect(lines.filter((l) => UNLOCK.test(l.text)).length).toBeGreaterThan(100);
    expect(lines.some((l) => /\.codex\.the_door_code/u.test(l.text))).toBe(true);
  });

  it("every `when … learns X` names an entry", () => {
    const dead = lines.flatMap((l) => {
      const m = LEARNS.exec(l.text);
      return m !== null && !ENTRIES.has(foldName(m[1]!)) ? [`${l.at}: ${m[1]}`] : [];
    });
    expect(dead).toEqual([]);
  });

  it("every `.codex.<slug>` names an entry", () => {
    const dead = lines.flatMap((l) => [...l.text.matchAll(SLUG)].flatMap((m) => (SLUGS.has(m[1]!) ? [] : [`${l.at}: ${m[1]}`])));
    expect(dead).toEqual([]);
  });

  it("every `unlock X for …` names an entry", () => {
    const dead = lines.flatMap((l) => {
      const m = UNLOCK.exec(l.text);
      return m !== null && !ENTRIES.has(foldName(m[1]!)) ? [`${l.at}: ${m[1]}`] : [];
    });
    expect(dead).toEqual([]);
  });

  it("catches a dead hook (the digit notes' old names name nothing)", () => {
    expect(ENTRIES.has(foldName("Cold Door First Digit"))).toBe(false);
    expect(SLUGS.has("cold_door_first_digit")).toBe(false);
    expect(ENTRIES.has(foldName("Server Room First Digit"))).toBe(true);
  });
});
