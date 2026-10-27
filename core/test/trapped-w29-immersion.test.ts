// Wave 29: nothing in the show says which "layer" of the talk at his heart a
// program is on, and nothing says "out of character". The user saw
// "LAYER 3 / 4" on the heart terminal and asked for it gone, with any
// reference to being out of character.
//
// This guard reads every show line a guest, a performer, a terminal, the TV
// or Trabolta's voice can meet: the story's .loom sources (comments out,
// beat names and variable names out), the persona and mind files the voice
// model reads, the play help, and the terminal's heart and resurrection
// scenes. The terminal's own tests render the heart header and card.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOW = join(HERE, "../examples/trapped-in-the-internet");
const ROOT = join(HERE, "../..");

const LAYER = /\bLayers?\s+(\d|One|Two|Three|Four)\b/iu;
const OOC = /out[\s-]+of[\s-]+character/iu;

function loomFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "history" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...loomFiles(p));
    else if (name.endsWith(".loom")) out.push(p);
  }
  return out;
}

/** A .loom line without its comment and without the heart's beat ids
 *  (`== Heart Layer One`, `-> Heart Layers`), which no client draws. */
function visiblePart(line: string): string {
  const t = line.trim();
  if (t.startsWith("//")) return "";
  const cut = line.search(/\s\/\/\s/u);
  const code = cut === -1 ? line : line.slice(0, cut);
  return withoutBeatIds(code);
}

/** The heart's beat ids (the show book lists them for the crew). */
function withoutBeatIds(line: string): string {
  return line.replace(/\bHeart Layers?(\s+(One|Two|Three|Four))?\b/giu, "");
}

function hits(text: string, file: string): string[] {
  const out: string[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = file.endsWith(".loom") ? visiblePart(raw) : withoutBeatIds(raw);
    if (LAYER.test(line) || OOC.test(line)) out.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${raw.trim()}`);
  });
  return out;
}

describe("wave 29: the show never names a layer of the talk or steps out of character", () => {
  it("the guard itself: catches a spoken layer and the phrase, leaves the beat ids and comments", () => {
    expect(hits('  Trabolta: Layer three. Make your case.', "x.loom")).toHaveLength(1);
    expect(hits('  broadcast "Hang out, out of character." to everyone', "x.loom")).toHaveLength(1);
    expect(hits("== Heart Layer Three", "x.loom")).toEqual([]);
    expect(hits("  -> Heart Layers", "x.loom")).toEqual([]);
    expect(hits("  // Layer Three gives no nudge", "x.loom")).toEqual([]);
    expect(hits("set program.heart_layer = 3", "x.loom")).toEqual([]);
  });

  it("no .loom line of the show says it (lines, menus, alerts, labels, codex)", () => {
    const files = loomFiles(SHOW);
    expect(files.length).toBeGreaterThan(20);
    const found = files.flatMap((f) => hits(readFileSync(f, "utf8"), f));
    expect(found).toEqual([]);
  });

  it("nor what Trabolta's voice reads (the persona, the mind)", () => {
    for (const f of ["trabolta.persona.md", "trabolta.mind.md"]) {
      const text = readFileSync(join(SHOW, f), "utf8");
      // The persona's outside: list names the phrases it withholds; that is the guard, not a line.
      const body = text.replace(/^outside:[\s\S]*?^(?=\S)/mu, "");
      expect(hits(body, join(SHOW, f))).toEqual([]);
      expect(body).not.toMatch(/still in character/iu);
    }
    const front = readFileSync(join(SHOW, "trabolta.persona.md"), "utf8").split("\n---\n")[0]!;
    const them = /^them: (.*)$/mu.exec(front)![1]!.split(",").map((s) => s.trim());
    expect(them).not.toContain("heart_layer");
    const outside = /^outside:[^\n]*\n((?: {2}- [^\n]*\n)+)/mu.exec(front)![1]!;
    for (const w of ["layer one", "layer two", "layer three", "layer four", "out of character"]) expect(outside).toContain(`- ${w}`);
  });

  it("nor the help the phones open, the show book, or the terminal's heart and resurrection scenes", () => {
    const files = [
      ...readdirSync(join(ROOT, "docs/help/play")).map((f) => join(ROOT, "docs/help/play", f)),
      join(SHOW, "SHOW.html"),
      join(ROOT, "terminal/src/cutscene/scenes/heart.tsx"),
      join(ROOT, "terminal/src/cutscene/scenes/act3.tsx"),
      join(ROOT, "terminal/src/heart/heart.ts"),
      join(ROOT, "terminal/src/heart/ChoicePanel.tsx"),
    ];
    const found = files.flatMap((f) => hits(readFileSync(f, "utf8"), f));
    expect(found).toEqual([]);
    expect(readFileSync(join(ROOT, "terminal/src/cutscene/scenes/heart.tsx"), "utf8")).not.toMatch(/LAYER \$\{|\/ 4`/u);
  });

  it("the new lines are signed off on SIGNOFF-w29.md and carry no DRAFT marker", () => {
    const sheet = readFileSync(join(SHOW, "SIGNOFF-w29.md"), "utf8");
    expect(sheet).toContain("Signed off 2026-10-27");
    const main = readFileSync(join(SHOW, "main.loom"), "utf8");
    const g11 = "!🎃 The show is over: you are human again. Hang out. The night is yours.";
    expect(main).toMatch(/\/\/ w29 \(signed off\)[^\n]*\n\s*broadcast "!🎃 The show is over: you are human again\. Hang out\. The night is yours\." to everyone/u);
    expect(sheet).toContain(g11);
    const act3 = readFileSync(join(ROOT, "terminal/src/cutscene/scenes/act3.tsx"), "utf8");
    expect(act3).toMatch(/w29, signed off[^\n]*\n[^\n]*tv3-res-sub[^\n]*\n\s*Hang out\. The night is yours\./u);
    expect(sheet).toContain("Hang out. The night is yours.");
    const heart = readFileSync(join(ROOT, "terminal/src/cutscene/scenes/heart.tsx"), "utf8");
    expect(heart).toMatch(/\/\/ w29 \(signed off\)[^\n]*\nexport const HEART_CARD_TITLE = "HEART\.EXE";/u);
    expect(sheet).toContain("*HEART.EXE*");
    for (const src of [main, act3, heart]) expect(src).not.toMatch(/DRAFT w29/u);
  });
});
