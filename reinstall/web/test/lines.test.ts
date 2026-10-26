//! In-game speech (wave 26, C6 / C10): the moment's lines captioned one at a
//! time and spoken by the device voice through the shared pronunciation
//! table, each held for its reading time with 700 ms between lines.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readingMs } from "@loom/terminal/speech/engine.ts";
import type { MomentLine } from "../src/api.ts";
import { IN_GAME_LINE_GAP_MS, LINE_SPEAK_CAP_MS, LinePlayer, pronounce } from "../src/game/lines.ts";

describe("pronounce — the shared table (C10)", () => {
  it("is the terminal's pronounce.json", () => {
    const json = JSON.parse(readFileSync(new URL("../../../terminal/src/speech/pronounce.json", import.meta.url), "utf8")) as { words: Array<{ word: string; say: string }> };
    expect(json.words.map((w) => w.word)).toContain("Antivirus");
    expect(pronounce("Antivirus")).toBe("Anti Virus");
  });

  it("whole words, any case; the longest word wins; the say as written", () => {
    expect(pronounce("The Antivirus is here.")).toBe("The Anti Virus is here.");
    expect(pronounce("two ANTIVIRUSES and an antivirus")).toBe("two Anti Viruses and an Anti Virus");
    expect(pronounce("the Antivirus' badge")).toBe("the Anti Virus' badge"); // the possessive matches
    expect(pronounce("(Antivirus)")).toBe("(Anti Virus)");
  });

  it("never inside a word, never across a hyphen", () => {
    expect(pronounce("Anti-Virus")).toBe("Anti-Virus");
    expect(pronounce("Norton Anti-Virus")).toBe("Norton Anti-Virus");
    expect(pronounce("SuperAntivirus")).toBe("SuperAntivirus");
    expect(pronounce("Antivirus2")).toBe("Antivirus2");
    expect(pronounce("")).toBe("");
  });

  it("takes a table (and an empty one changes nothing)", () => {
    const t = { version: 1, words: [{ word: "Gerald", say: "Jerold" }] };
    expect(pronounce("Gerald, gerald!", t)).toBe("Jerold, Jerold!");
    expect(pronounce("Antivirus", { version: 1, words: [] })).toBe("Antivirus");
  });
});

/** A LinePlayer on a fake clock: every effect is a logged event. */
function harness(speakMs: (text: string) => number | "never" = () => 0) {
  let now = 0;
  const log: string[] = [];
  const timers: Array<{ at: number; fire: () => void }> = [];
  const sleep = (ms: number) => new Promise<void>((r) => timers.push({ at: now + ms, fire: r }));
  const player = new LinePlayer({
    speak: (text) => {
      log.push(`speak ${text} @${now}`);
      const ms = speakMs(text);
      return ms === "never" ? new Promise<void>(() => {}) : sleep(ms);
    },
    show: (l) => log.push(l === null ? `clear @${now}` : `show ${l.text} @${now}`),
    sleep,
    speaking: (on) => log.push(`speaking ${on} @${now}`),
  });
  /** Run the clock until nothing is pending. */
  const drain = async () => {
    for (let i = 0; i < 200; i++) {
      for (let k = 0; k < 10; k++) await Promise.resolve();
      timers.sort((a, b) => a.at - b.at);
      const t = timers.shift();
      if (t === undefined) return;
      now = Math.max(now, t.at);
      t.fire();
    }
  };
  return { player, log, drain, now: () => now };
}

const L = (text: string, from = "Trabolta"): MomentLine => ({ from, text });

describe("LinePlayer", () => {
  it("one line at a time: shown, spoken pronounced, held for its reading time, 700 ms between lines", async () => {
    const h = harness();
    const a = "Back you go, Antivirus.";
    const b = "There is only my computer.";
    const done = h.player.play([L(a), L(b)]);
    await h.drain();
    await done;
    const ra = readingMs(a);
    expect(h.log).toEqual([
      "speaking true @0",
      `show ${a} @0`,
      "speak Back you go, Anti Virus. @0",
      `clear @${ra}`,
      `show ${b} @${ra + IN_GAME_LINE_GAP_MS}`,
      `speak ${b} @${ra + IN_GAME_LINE_GAP_MS}`,
      `clear @${ra + IN_GAME_LINE_GAP_MS + readingMs(b)}`,
      `speaking false @${ra + IN_GAME_LINE_GAP_MS + readingMs(b) + IN_GAME_LINE_GAP_MS}`,
    ]);
    expect(IN_GAME_LINE_GAP_MS).toBe(700);
  });

  it("a voice slower than the reading time holds the caption until it is done", async () => {
    const h = harness(() => 5000);
    void h.player.play([L("Hi.")]);
    await h.drain();
    expect(h.log).toContain("clear @5000");
  });

  it("a voice that never ends is cut at the cap", async () => {
    const h = harness(() => "never");
    void h.player.play([L("Stuck.")]);
    await h.drain();
    expect(h.log).toContain(`clear @${LINE_SPEAK_CAP_MS}`);
    expect(h.player.busy).toBe(false);
  });

  it("a second batch waits for the first; blank lines and empty batches play nothing", async () => {
    const h = harness();
    void h.player.play([L("One.")]);
    void h.player.play([L("  "), L("Two.")]);
    void h.player.play([]);
    await h.drain();
    const shows = h.log.filter((e) => e.startsWith("show"));
    expect(shows.map((e) => e.split(" @")[0])).toEqual(["show One.", "show Two."]);
    expect(h.log.filter((e) => e.startsWith("speaking"))).toHaveLength(2); // raised once, lowered once
  });

  it("stop drops what is queued and clears the caption", async () => {
    const h = harness(() => 3000);
    void h.player.play([L("First."), L("Never said.")]);
    for (let k = 0; k < 10; k++) await Promise.resolve();
    h.player.stop();
    await h.drain();
    expect(h.log.some((e) => e.startsWith("show Never said."))).toBe(false);
    expect(h.log.at(-1)).toMatch(/^speaking false/);
  });
});
