//! VOICE_SCENES against the story (wave 26, V1; C11): each entry's marks
//! are one per sentence he says in its beats, cut by the voice's own
//! `splitSentences`. The counts are read off `beats/*.loom` here, so a story
//! edit that changes them (G1, D1) fails this test instead of quietly
//! desyncing a scene on the night.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { foldName } from "../src/config.ts";
import { INTRO_CAPTIONS } from "../src/cutscene/kit/tv1-boot.tsx";
import { SCENES } from "../src/cutscene/registry.ts";
import { ADVICE_CHAT } from "../src/cutscene/scenes/act3.tsx";
import { VOICE_SCENES, voiceSceneOf } from "../src/cutscene/voice-scenes.ts";
import { splitSentences } from "../src/speech/split.ts";

const BEATS = fileURLToPath(new URL("../../core/examples/trapped-in-the-internet/beats/", import.meta.url));
const CHARACTER = "Trabolta";

/** Every beat's lines of his, by folded beat name, in story order. */
function storyLines(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of readdirSync(BEATS).filter((x) => x.endsWith(".loom")).sort()) {
    let beat: string | null = null;
    for (const raw of readFileSync(join(BEATS, f), "utf8").split("\n")) {
      const b = /^==\s+(.+?)\s*$/u.exec(raw);
      if (b !== null) {
        beat = foldName(b[1]!);
        if (!out.has(beat)) out.set(beat, []);
        continue;
      }
      if (beat === null || /^\s*\/\//u.test(raw)) continue;
      const m = new RegExp(`^\\s*${CHARACTER}(?:\\s*\\([^)]*\\))?:\\s*(.+)$`, "u").exec(raw);
      if (m !== null) out.get(beat)!.push(m[1]!.trim());
    }
  }
  return out;
}
const LINES = storyLines();

/**
 * Which of a beat's lines an entry's marks describe. Most voice every line
 * of his in the beat; a beat of alternatives (one award per slide) is timed
 * for its first.
 */
const PICK: Record<string, (lines: string[]) => string[]> = {
  award: (lines) => lines.slice(0, 1),
};
/** Entries for a beat another lane writes this wave: checked against the
 *  story once it is in it; until then against the count that lane's branch
 *  has (oct31-w26/story: `== Dare Chosen`, 3 lines, 6 sentences). */
const PENDING: Record<string, number> = { dare_chosen: 6 };
/** Scenes kept on the server's clock because their beat has no line of his. */
const UNVOICED: Record<string, string> = { truth_answered: "", truth_refused: "", filing_closed: "Filing Closed", zip: "Zip Everyone Out" };

const spokenCount = (lines: string[]) => lines.reduce((n, l) => n + splitSentences(l).length, 0);

describe("VOICE_SCENES (C11)", () => {
  for (const [id, v] of Object.entries(VOICE_SCENES)) {
    it(`${id}: one mark per sentence he says in ${v.beats.join(", ")}`, () => {
      const present = v.beats.filter((b) => LINES.has(foldName(b)));
      if (id in PENDING && present.length === 0) {
        expect(v.marks.length, `${id}: the story lane's sentence count`).toBe(PENDING[id]);
        return; // not merged yet (story lane)
      }
      expect(present, `${id}'s beats are in the story`).toEqual(v.beats);
      const lines = v.beats.flatMap((b) => LINES.get(foldName(b))!);
      const timed = (PICK[id] ?? ((l: string[]) => l))(lines);
      expect(timed.length, `${id}: his lines`).toBeGreaterThan(0);
      expect(v.marks.length, `${id}: marks vs the story's sentences (${JSON.stringify(timed.flatMap((l) => splitSentences(l)))})`).toBe(spokenCount(timed));
    });
  }

  it("every mark list increases, and fits its scene (and its tail)", () => {
    for (const [id, v] of Object.entries(VOICE_SCENES)) {
      for (let i = 1; i < v.marks.length; i++) expect(v.marks[i]!, `${id} mark ${i}`).toBeGreaterThan(v.marks[i - 1]!);
      expect(v.marks[0]!, id).toBeGreaterThanOrEqual(0);
      const def = SCENES.find((d) => d.id === id);
      if (def === undefined) {
        expect(id in PENDING, `${id} is a scene`).toBe(true);
        continue;
      }
      expect(def.tv ?? def.wall, `${id} draws on the TV`).toBeDefined();
      if (typeof def.ms === "number") {
        expect(v.marks.at(-1)!, id).toBeLessThan(def.ms);
        if (v.tail !== undefined) expect(def.ms - v.tail, `${id}: his part ends after the last mark`).toBeGreaterThanOrEqual(v.marks.at(-1)!);
      } else expect(v.tail, `${id}: a hold has no tail`).toBeUndefined();
    }
  });

  it("the scenes' beats are the ones that trigger them, or that they show", () => {
    for (const [id, v] of Object.entries(VOICE_SCENES)) {
      const def = SCENES.find((d) => d.id === id);
      if (def === undefined) continue;
      const beatTriggers = def.when.flatMap((w) => ("moment" in w && w.moment === "beat" ? [foldName(w.name)] : []));
      if (beatTriggers.length > 0) expect(beatTriggers, id).toEqual(expect.arrayContaining(v.beats.map(foldName)));
    }
  });

  it("the intro's marks are its captions, cut like the voice cuts his line", () => {
    const v = VOICE_SCENES["trabolta_introduction"]!;
    expect(v.marks).toEqual(INTRO_CAPTIONS.map((c) => c.start));
    expect(v.ownCaption).toBe(true);
    expect(INTRO_CAPTIONS.map((c) => c.text)).toEqual(LINES.get(foldName("Trabolta Introduction"))!.flatMap((l) => splitSentences(l)));
  });

  it("his line shows once: the layer leaves the sentences a scene draws itself", () => {
    expect(VOICE_SCENES["bottle_landed"]!.ownCaption).toBe(true); // "<pick>." and "Truth or dare?" on the bottle
    // advice_helped: SandyChat types the proposal; those are its `drawn`.
    const advice = VOICE_SCENES["advice_helped"]!;
    const said = LINES.get(foldName("Advice Helped"))!.flatMap((l) => splitSentences(l));
    expect(advice.drawn!.map((i) => said[i]).join(" ")).toBe(ADVICE_CHAT[0]!.text);
    // …and the chat stays shut (it opens at 200) until he gets to it.
    const first = advice.drawn![0]!;
    for (let i = 0; i < first; i++) expect(advice.marks[i]!, `advice mark ${i}`).toBeLessThan(200);
    expect(advice.marks[first]).toBe(200);
    for (const [id, v] of Object.entries(VOICE_SCENES)) for (const i of v.drawn ?? []) expect(i, id).toBeLessThan(v.marks.length);
  });

  it("the scenes left on the server's clock have no line of his to wait for", () => {
    for (const [id, beat] of Object.entries(UNVOICED)) {
      expect(voiceSceneOf(id), id).toBeNull();
      if (beat !== "") expect(LINES.get(foldName(beat)) ?? [], `${beat} gained a line of his: give ${id} a VOICE_SCENES entry`).toEqual([]);
    }
    expect(voiceSceneOf("chose_dare")).toBeNull();
    expect(voiceSceneOf("hunt_results")).toBeNull();
    expect(voiceSceneOf("toString")).toBeNull();
  });
});
