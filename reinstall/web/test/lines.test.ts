//! In-game speech (wave 26, C6 / C10): the moment's lines captioned one at a
//! time and spoken by the device voice through the shared pronunciation
//! table, each held for its reading time with 700 ms between lines.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readingMs } from "@loom/terminal/speech/engine.ts";
import type { MomentLine } from "../src/api.ts";
import { VoiceFloor } from "@loom/terminal/speech/engine.ts";
import type { Prepared, SpeechEngine } from "@loom/terminal/speech/engine.ts";
import { deviceSpeaker, IN_GAME_LINE_GAP_MS, LINE_SPEAK_CAP_MS, LINE_START_WAIT_MS, LinePlayer, pronounce } from "../src/game/lines.ts";

describe("pronounce — the shared table (C10)", () => {
  it("is the terminal's own lexicon pronounce, and the line gap is its LINE_GAP_MS (C6, C11)", async () => {
    const lexicon = await import("@loom/terminal/speech/lexicon.ts");
    const engine = await import("@loom/terminal/speech/engine.ts");
    expect(pronounce).toBe(lexicon.pronounce);
    expect(IN_GAME_LINE_GAP_MS).toBe(engine.LINE_GAP_MS);
  });
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

  it("text whose lower case is longer (İ) never shifts the match", () => {
    expect("İ".toLowerCase().length).toBe(2); // the trap
    expect(pronounce("İ Antivirus")).toBe("İ Anti Virus");
    expect(pronounce("İİİ, the antivirus. Antivirus!")).toBe("İİİ, the Anti Virus. Anti Virus!");
    expect(pronounce("İAntivirus")).toBe("İAnti Virus"); // İ is no [A-Za-z0-9]: a boundary
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

/** A LinePlayer on a fake clock: every effect is a logged event. The fake
 *  voice starts after `startMs` (the floor free) and speaks for `speakMs`;
 *  a cut ends it at once. */
function harness(speakMs: (text: string) => number | "never" = () => 0, startMs: (text: string) => number | "never" = () => 0) {
  let now = 0;
  const log: string[] = [];
  const timers: Array<{ at: number; fire: () => void }> = [];
  const sleep = (ms: number) => new Promise<void>((r) => timers.push({ at: now + ms, fire: r }));
  let cutting: (() => void) | null = null;
  const player = new LinePlayer({
    speak: (text, started) => {
      log.push(`speak ${text} @${now}`);
      return new Promise<void>((resolve) => {
        let live = true;
        cutting = () => {
          live = false;
          resolve();
        };
        const go = () => {
          if (!live) return;
          log.push(`voice ${text} @${now}`);
          started();
          const ms = speakMs(text);
          if (ms !== "never") void sleep(ms).then(() => live && resolve());
        };
        const s = startMs(text);
        if (s === 0) go();
        else if (s !== "never") void sleep(s).then(go);
      });
    },
    cut: () => {
      log.push(`cut @${now}`);
      cutting?.();
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
      "voice Back you go, Anti Virus. @0",
      `clear @${ra}`,
      `show ${b} @${ra + IN_GAME_LINE_GAP_MS}`,
      `speak ${b} @${ra + IN_GAME_LINE_GAP_MS}`,
      `voice ${b} @${ra + IN_GAME_LINE_GAP_MS}`,
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

  it("a voice that never ends is cut at the cap — the voice itself, not just the caption", async () => {
    const h = harness(() => "never");
    void h.player.play([L("Stuck.")]);
    await h.drain();
    expect(h.log).toContain(`cut @${LINE_SPEAK_CAP_MS}`);
    expect(h.log).toContain(`clear @${LINE_SPEAK_CAP_MS}`);
    expect(h.log.indexOf(`cut @${LINE_SPEAK_CAP_MS}`)).toBeLessThan(h.log.indexOf(`clear @${LINE_SPEAK_CAP_MS}`));
    expect(h.log.at(-1)).toMatch(/^speaking false/); // the mic hold lifts only after the cut
    expect(h.player.busy).toBe(false);
  });

  it("the cap counts from when the voice starts, not from when it was queued", async () => {
    const h = harness(() => 10_000, () => 5_000); // waits 5 s for the floor, then 10 s of voice
    void h.player.play([L("Late but whole.")]);
    await h.drain();
    expect(h.log.some((e) => e.startsWith("cut"))).toBe(false);
    expect(h.log).toContain("clear @15000"); // the caption stayed up the whole time
  });

  it("a voice that never gets the floor is cut before it starts: only captioned, never said later", async () => {
    const h = harness(() => 1000, (t) => (t === "First." ? "never" : 0));
    void h.player.play([L("First."), L("Second.")]);
    await h.drain();
    expect(h.log).toContain(`cut @${LINE_START_WAIT_MS}`);
    expect(h.log.some((e) => e.startsWith("voice First."))).toBe(false);
    const second = h.log.findIndex((e) => e.startsWith("show Second."));
    expect(second).toBeGreaterThan(h.log.indexOf(`clear @${LINE_START_WAIT_MS}`));
    expect(h.log[second + 2]).toMatch(/^voice Second\./);
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

/** A fake device engine: each chunk plays until the test ends it. */
function fakeEngine() {
  const said: string[] = [];
  const ends: Array<() => void> = [];
  const engine: SpeechEngine = {
    kind: "device",
    prepare: async (text) => ({ kind: "silent", text }),
    play: (p: Prepared) =>
      new Promise<void>((r) => {
        said.push(p.kind === "server" ? "" : p.text);
        ends.push(r);
      }),
    stop: () => {
      for (const e of ends.splice(0)) e();
    },
  };
  return { engine, said, finish: () => ends.shift()?.() };
}

const flushAll = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("deviceSpeaker — the game's own voice on the page's floor", () => {
  it("started fires when the voice begins (once), done when it is said", async () => {
    const f = fakeEngine();
    const sp = deviceSpeaker({ engine: f.engine, floor: new VoiceFloor() });
    let started = 0;
    let done = false;
    void sp.speak("One.", () => (started += 1)).then(() => (done = true));
    await flushAll();
    expect(started).toBe(1);
    expect(f.said).toEqual(["One."]);
    expect(done).toBe(false);
    f.finish();
    await flushAll();
    expect(started).toBe(1);
    expect(done).toBe(true);
  });

  it("while the terminal holds the floor nothing starts; a cut line is never said once the floor frees", async () => {
    const floor = new VoiceFloor();
    const f = fakeEngine();
    const sp = deviceSpeaker({ engine: f.engine, floor });
    const release = await floor.acquire(); // an announcement speaking
    let started = false;
    let done = false;
    void sp.speak("Cut before it began.", () => (started = true)).then(() => (done = true));
    await flushAll();
    expect(started).toBe(false);
    sp.stop();
    await flushAll();
    expect(done).toBe(true);
    let nextStarted = false;
    void sp.speak("The next line.", () => (nextStarted = true));
    release();
    await flushAll();
    expect(started).toBe(false);
    expect(f.said).toEqual(["The next line."]);
    expect(nextStarted).toBe(true);
  });

  it("stop cuts a line mid-speech", async () => {
    const f = fakeEngine();
    const sp = deviceSpeaker({ engine: f.engine, floor: new VoiceFloor() });
    let done = false;
    void sp.speak("Long.").then(() => (done = true));
    await flushAll();
    expect(f.said).toEqual(["Long."]);
    sp.stop();
    await flushAll();
    expect(done).toBe(true);
    void sp.speak("After.");
    await flushAll();
    expect(f.said).toEqual(["Long.", "After."]); // the speaker still works after a cut
  });
});
