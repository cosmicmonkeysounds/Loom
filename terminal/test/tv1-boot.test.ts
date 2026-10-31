import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fakeState } from "../src/cutscene/fake.ts";
import { INTRO_CAPTIONS, INTRO_FACE_DONE, INTRO_HELLO, INTRO_LINE, INTRO_MORE, INTRO_MS, INTRO_SAYS, INTRO_SFX, INTRO_VOICE_END, INTRO_WALL_MS, IN, IntroTv, IntroWall, POWER_ON_MS, POWER_ON_WALL_MS, PowerOnTv, PowerOnWall, introFacePose, lineCaptions, setupRowSpan } from "../src/cutscene/kit/tv1-boot.tsx";
import { splitSentences } from "../src/speech/split.ts";
import { LINE_GAP_MS } from "../src/speech/engine.ts";
import { INTRO_VOICE } from "../src/cutscene/kit/tv1-time.ts";
import type { SceneProps } from "../src/cutscene/types.ts";

beforeAll(() => {
  const error = console.error.bind(console);
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    if (typeof a[0] === "string" && a[0].includes("useLayoutEffect")) return;
    error(...a);
  });
});

function draw(View: (p: SceneProps) => unknown, t: number, introduced = true): string {
  const state = fakeState({ now: 1_000_000 + t, introduced });
  return renderToStaticMarkup(createElement(View as never, { t, at: 1_000_000, seq: 1, value: "", state, night: state.night, who: null, target: "tv", sfx: () => false, done: () => {}, reduced: false } as never));
}

describe("tv1 boot — the introduction", () => {
  it("runs in order: boot + face, the greeting, the setup under his long sentence, the logo, ALL SYSTEMS ONLINE, the hand-back, his last word, the end (wave 58)", () => {
    // The scene carries only the start of his speech: the rest runs under the live face.
    expect(INTRO_MS).toBeGreaterThanOrEqual(25_000);
    expect(INTRO_MS).toBeLessThanOrEqual(40_000);
    const order = [IN.post, IN.face, IN.hello, IN.montage, IN.setup, IN.logo, IN.online, IN.back, IN.voiceEnd, IN.end];
    for (let i = 1; i < order.length; i++) expect(order[i]!, `phase ${i}`).toBeGreaterThan(order[i - 1]!);
    expect(IN.back - IN.online).toBeGreaterThanOrEqual(1800);
    expect(IN.end - IN.voiceEnd).toBeGreaterThanOrEqual(1500);
  });

  it("each beat of the picture hangs off the sentence it belongs to", () => {
    const at = (k: keyof typeof INTRO_SAYS) => INTRO_CAPTIONS[INTRO_SAYS[k]]!;
    expect(at("hello").text).toBe(INTRO_HELLO);
    expect(at("greeting").text).toBe("It is the greatest pleasure of my career to see your smiling faces gathered here.");
    expect(IN.montage).toBeGreaterThan(at("greeting").end);
    expect(IN.montage).toBeLessThan(INTRO_CAPTIONS[INTRO_SAYS.greeting + 1]!.start + 500);
    expect(at("owner").text).toContain("sole owner, founder and CEO");
    // The setup and the logo run under the long sentence, and ALL SYSTEMS ONLINE lands inside it.
    expect(IN.setup).toBeGreaterThan(at("greeting").end);
    expect(IN.logo).toBeGreaterThan(at("owner").start);
    expect(IN.online).toBeLessThan(at("owner").end);
  });

  it("the captions are his lines, a sentence at a time, a line gap between two lines", () => {
    expect(INTRO_CAPTIONS.map((c) => c.text)).toEqual([INTRO_LINE, ...INTRO_MORE].flatMap((l) => splitSentences(l)));
    const two = lineCaptions(["The first sentence. The second one.", "Third."], { start: 0, cps: 10, gap: 300 });
    expect(two.map((c) => c.text)).toEqual(["The first sentence.", "The second one.", "Third."]);
    expect(two.map((c) => c.start)).toEqual([0, 1900 + 300, 2200 + 1500 + LINE_GAP_MS]);
    for (let i = 1; i < INTRO_CAPTIONS.length; i++) expect(INTRO_CAPTIONS[i]!.start, `caption ${i}`).toBeGreaterThan(INTRO_CAPTIONS[i - 1]!.end);
  });

  it("the BIOS POST is done and gone before the face comes in: never printing under it (livetv-5)", () => {
    expect(draw(IntroTv, 600)).toContain("Detecting Primary Master");
    for (const t of [IN.face, IN.face + 300, 1500, 2000]) expect(draw(IntroTv, t), String(t)).not.toContain("Detecting");
  });

  it("is in step with his voice: the face is whole when the TV starts saying the line", () => {
    // The TV speaks the beat's line on the poll that brings the beat (≈ 0.5–2.5 s in).
    expect(INTRO_FACE_DONE).toBeLessThanOrEqual(IN.hello + 50);
    expect(INTRO_FACE_DONE).toBeLessThanOrEqual(1600);
    expect(INTRO_CAPTIONS[0]!.start).toBe(INTRO_VOICE.start);
    expect(INTRO_VOICE.start).toBeLessThanOrEqual(2000);
    // The first line, word for word, typed under the face before HAPPY HALLOWEEN.
    expect(INTRO_CAPTIONS[0]!.text).toBe(INTRO_LINE);
    expect(INTRO_VOICE_END).toBeLessThan(INTRO_MS);
    // Each sentence is on screen while it is said; none is typed after the voice.
    for (const c of INTRO_CAPTIONS) expect(draw(IntroTv, c.end + 10), c.text).toContain(c.text.replace(/'/gu, "&#x27;"));
    expect(draw(IntroTv, IN.montage + 700)).not.toContain(INTRO_HELLO);
    // The setup starts after the greeting, under his long sentence.
    expect(IN.setup).toBeLessThan(INTRO_VOICE_END);
  });

  it("plays its accents under the voice (a plain effect is dropped while he speaks)", () => {
    for (const [at, , opts] of INTRO_SFX) if (at < INTRO_VOICE_END + 3000) expect(opts?.over, `cue at ${at}`).toBe(true);
    expect(INTRO_SFX.length).toBeGreaterThanOrEqual(14);
  });

  it("each phase draws its own picture", () => {
    expect(draw(IntroTv, 800)).toContain("TRABOLTA BIOS");
    expect(draw(IntroTv, 800)).toContain("Memory Test");
    expect(draw(IntroTv, 1200)).toContain("a1-face");
    expect(draw(IntroTv, IN.setup + 1000)).toContain("Trabolta Setup");
    expect(draw(IntroTv, IN.logo + 1500)).toContain("Sole Owner &amp; Founder · Maps and Ducks");
    expect(draw(IntroTv, IN.logo + 1500)).not.toMatch(/AI helper/u);
    expect(draw(IntroTv, IN.online + 500)).toContain("ALL SYSTEMS ONLINE");
  });

  it("plays clean: every setup row lands in turn, and nothing stalls or says AI (wave 58)", () => {
    for (let i = 1; i < 3; i++) expect(setupRowSpan(i).start).toBe(setupRowSpan(i - 1).end);
    expect(setupRowSpan(2).end).toBeLessThan(IN.logo);
    for (const t of [IN.setup + 1000, IN.logo - 100, IN.online + 500]) {
      const html = draw(IntroTv, t);
      expect(html, String(t)).not.toContain("Not Responding");
      expect(html, String(t)).not.toMatch(/\bAI\b/u);
    }
    for (const line of [INTRO_LINE, ...INTRO_MORE]) expect(line).not.toMatch(/\bAI\b|Disregard|EXTREMELY/u);
  });

  it("the face glides aside for the setup, then home for the hand-back to the live face", () => {
    expect(introFacePose(5000, false).x).toBeCloseTo(0, 5);
    expect(introFacePose(IN.setup + 2000, false).x).toBeLessThan(-10);
    const end = introFacePose(IN.end, false);
    expect(end.x).toBeCloseTo(0, 5);
    expect(end.scale).toBeCloseTo(1, 5);
    expect(introFacePose(IN.end, true)).toEqual(end);
    // His last sentence stays up in the bar.
    const last = INTRO_CAPTIONS.at(-1)!;
    expect(draw(IntroTv, last.end + 10)).toContain("a1-in-say");
  });

  it("hands back to the live face: fully transparent at its end", () => {
    expect(draw(IntroTv, INTRO_MS)).toMatch(/opacity:0[;"]/u);
    expect(draw(IntroWall, INTRO_WALL_MS)).toBe("");
    expect(INTRO_WALL_MS).toBeLessThan(INTRO_MS);
  });

  it("the wall's online line is fully typed with 2.5 s to read before the fade", () => {
    // The card fades from 11.5 s; the line starts typing at 5.6 s.
    const line = (t: number) => /class="a1w-line">([\s\S]*?)<\/div>/u.exec(draw(IntroWall, t))?.[1] ?? "";
    expect(line(9000)).toContain("say hello.");
    expect(line(9000)).not.toContain("kit-type-rest");
    expect(line(8000)).toContain("kit-type-rest");
  });
});

describe("tv1 boot — Power On", () => {
  it("splash, desktop, screensaver, then nothing (the screensaver underneath)", () => {
    expect(draw(PowerOnTv, 3000, false)).toContain("a1-po-splash");
    expect(draw(PowerOnTv, 7500, false)).toContain("Welcome to Maps and Ducks 98");
    expect(draw(PowerOnTv, 11_000, false)).toContain("a1-po-bounce");
    expect(draw(PowerOnTv, POWER_ON_MS, false)).toMatch(/opacity:0[;"]/u);
    expect(draw(PowerOnWall, POWER_ON_WALL_MS, false)).toBe("");
    expect(POWER_ON_WALL_MS).toBeLessThan(POWER_ON_MS);
  });

  it("never names the character", () => {
    for (let t = 0; t <= POWER_ON_MS; t += 500) {
      expect(draw(PowerOnTv, t, false).toLowerCase()).not.toContain("trabolta");
      expect(draw(PowerOnWall, t, false).toLowerCase()).not.toContain("trabolta");
    }
  });
});

describe("the introduction on his voice (wave 26, V1)", () => {
  it("types the sentence the TV is saying, from its mark; with no voice, its own caption", async () => {
    const { introLine } = await import("../src/cutscene/kit/tv1-boot.tsx");
    const second = INTRO_CAPTIONS[2]!;
    expect(introLine(second.start + 100, null)).toEqual(INTRO_CAPTIONS[2]);
    const said = introLine(second.start + 100, { seq: 9, index: 2, text: "My name is Jean Trabolta, and the line changed." });
    expect(said).toMatchObject({ text: "My name is Jean Trabolta, and the line changed.", start: second.start });
    expect(introLine(INTRO_CAPTIONS[INTRO_SAYS.hello]!.start + 100, { seq: 9, index: INTRO_SAYS.hello, text: INTRO_HELLO })).toBeNull(); // it is up big
    // A sentence past the captions takes the last one's mark.
    expect(introLine(99_999, { seq: 9, index: 99, text: "One more." })?.start).toBe(INTRO_CAPTIONS.at(-1)!.start);
    // (wave 32) His later lines: the mark places it, not the line's own index.
    const later = INTRO_CAPTIONS[INTRO_SAYS.owner]!;
    expect(introLine(later.start + 100, { seq: 12, index: 0, mark: INTRO_SAYS.owner, text: later.text })).toMatchObject({ text: later.text, start: later.start });
    const state = fakeState({ now: 1_000_000 + second.start + 2500 });
    const html = renderToStaticMarkup(createElement(IntroTv as never, { t: second.start + 2500, at: 1_000_000, seq: 1, value: "", state, night: state.night, who: null, target: "tv", sfx: () => false, done: () => {}, reduced: false, voice: { seq: 9, index: 2, text: "Spoken words here." } } as never));
    expect(html).toContain("Spoken words here.");
  });
});
