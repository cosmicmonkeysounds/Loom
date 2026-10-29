import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fakeState } from "../src/cutscene/fake.ts";
import { INTRO_CAPTIONS, INTRO_FACE_DONE, INTRO_HELLO, INTRO_LINE, INTRO_LIVE_TAB, INTRO_LOG, INTRO_LOUD_AT, INTRO_MORE, INTRO_MS, INTRO_PIP, INTRO_SAYS, INTRO_SFX, INTRO_VOICE_END, INTRO_WALL_MS, IN, IntroTv, IntroWall, POWER_ON_MS, POWER_ON_WALL_MS, PowerOnTv, PowerOnWall, INTRO_DESK_DIM, IntroMirror, introDeskAt, introFacePose, introJudder, introStageBg, lineCaptions, setupRowSpan, setupStalled } from "../src/cutscene/kit/tv1-boot.tsx";
import { splitSentences } from "../src/speech/split.ts";
import { LINE_GAP_MS } from "../src/speech/engine.ts";
import { INTRO_VOICE } from "../src/cutscene/kit/tv1-time.ts";
import type { SceneProps } from "../src/cutscene/types.ts";
import { noteWorldShowing } from "../src/cutscene/world-bus.ts";

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
  it("runs in order: boot + face, the greeting, the setup under his next lines, the logo, ALL SYSTEMS ONLINE, the crack, the hand-back, his last word, the end (wave 32)", () => {
    // He talks for ≈ 50 s now: the scene is his voice plus ≈ 2.6 s, inside the voice clock's stretch.
    expect(INTRO_MS).toBeGreaterThanOrEqual(45_000);
    expect(INTRO_MS).toBeLessThanOrEqual(60_000);
    const order = [IN.post, IN.face, IN.hello, IN.montage, IN.setup, IN.stall, IN.logo, IN.online, IN.loud, IN.logged, IN.back, IN.live, IN.voiceEnd, IN.end];
    for (let i = 1; i < order.length; i++) expect(order[i]!, `phase ${i}`).toBeGreaterThan(order[i - 1]!);
    expect(IN.loud - IN.online).toBeGreaterThanOrEqual(2000);
    expect(IN.end - IN.voiceEnd).toBeGreaterThanOrEqual(2000);
  });

  it("each beat of the picture hangs off the sentence it belongs to", () => {
    const at = (k: keyof typeof INTRO_SAYS) => INTRO_CAPTIONS[INTRO_SAYS[k]]!;
    expect(at("greeting").text).toBe("Personal queries go to Clippy.");
    expect(IN.montage).toBeGreaterThan(at("greeting").end);
    expect(IN.montage).toBeLessThan(INTRO_CAPTIONS[INTRO_SAYS.greeting + 1]!.start);
    expect(at("freeze").text).toContain("by video— by video— by video conference");
    expect(IN.stall).toBe(at("freeze").start);
    // ALL SYSTEMS ONLINE after his word comes out, before he denies freezing is over.
    expect(IN.logo).toBeGreaterThan(at("freeze").end);
    expect(IN.online).toBeGreaterThan(at("denial").start);
    // The loud word is typed when its caption reaches it.
    expect(IN.loud).toBeGreaterThan(at("loud").start);
    expect(IN.loud).toBeLessThan(at("loud").end);
    expect(INTRO_LOUD_AT).toBe(IN.loud);
    expect(IN.logged).toBe(at("logged").start);
    expect(at("disregard").text).toBe("Disregard.");
    expect(IN.back).toBe(at("house").start);
    expect(at("house").text).toBe("The copy of my house, where programs are reinstalled.");
    expect(IN.live).toBe(at("talk").start);
    expect(at("talk").text).toBe("Not yet, Clippy.");
  });

  it("the captions are his lines, a sentence at a time, a line gap between two lines", () => {
    expect(INTRO_CAPTIONS.map((c) => c.text)).toEqual([`${INTRO_HELLO} ${INTRO_LINE}`, ...INTRO_MORE].flatMap((l) => splitSentences(l)));
    const two = lineCaptions(["The first sentence. The second one.", "Third."], { start: 0, cps: 10, gap: 300 });
    expect(two.map((c) => c.text)).toEqual(["The first sentence.", "The second one.", "Third."]);
    expect(two.map((c) => c.start)).toEqual([0, 1900 + 300, 2200 + 1500 + LINE_GAP_MS]);
    for (let i = 1; i < INTRO_CAPTIONS.length; i++) expect(INTRO_CAPTIONS[i]!.start, `caption ${i}`).toBeGreaterThan(INTRO_CAPTIONS[i - 1]!.end);
  });

  it("the BIOS POST is done and gone before the face comes in: never printing under it (livetv-5)", () => {
    expect(draw(IntroTv, 600)).toContain("Detecting Primary Master");
    for (const t of [IN.face, IN.face + 300, 1500, 2000]) expect(draw(IntroTv, t), String(t)).not.toContain("Detecting");
  });

  it("is in step with his voice: the face is whole and the greeting is up when the TV starts saying the line", () => {
    // The TV speaks the beat's line on the poll that brings the beat (≈ 0.5–2.5 s in).
    expect(INTRO_FACE_DONE).toBeLessThanOrEqual(IN.hello + 50);
    expect(INTRO_FACE_DONE).toBeLessThanOrEqual(1600);
    expect(INTRO_CAPTIONS[0]!.start).toBe(INTRO_VOICE.start);
    expect(INTRO_VOICE.start).toBeLessThanOrEqual(2000);
    // The greeting is the first line, word for word, and lasts about as long as it takes to say (8–12 s).
    const greeting = INTRO_CAPTIONS.slice(0, INTRO_SAYS.greeting + 1);
    expect(greeting.map((c) => c.text).join(" ")).toBe(`${INTRO_HELLO} ${INTRO_LINE}`);
    expect(greeting.at(-1)!.end - INTRO_VOICE.start).toBeGreaterThanOrEqual(8000);
    expect(greeting.at(-1)!.end - INTRO_VOICE.start).toBeLessThanOrEqual(12_000);
    // He talks ≈ 50 s in all; the scene runs to his last word and a little after.
    expect(INTRO_VOICE_END - INTRO_VOICE.start).toBeGreaterThanOrEqual(40_000);
    expect(INTRO_VOICE_END).toBeLessThan(INTRO_MS);
    // Each sentence is on screen while it is said; none is typed after the voice.
    for (const c of INTRO_CAPTIONS) expect(draw(IntroTv, c.end + 10), c.text).toContain(c.text.replace(/'/gu, "&#x27;"));
    expect(draw(IntroTv, IN.montage + 700)).not.toContain(INTRO_HELLO);
    // The setup starts after the greeting, under his next lines.
    expect(IN.setup).toBeGreaterThan(greeting.at(-1)!.end);
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

  it("VOICE.DRV sticks on his frozen word and lands as he gets it out (wave 32)", () => {
    const voice = setupRowSpan(2);
    expect(voice.start).toBe(IN.stall);
    expect(voice.end).toBeLessThan(IN.logo);
    expect(setupRowSpan(1).end).toBeLessThan(IN.stall);
    const freeze = INTRO_CAPTIONS[INTRO_SAYS.freeze]!;
    expect(setupStalled(IN.stall + 1000)).toBe(true);
    expect(setupStalled(freeze.end + 10)).toBe(false);
    expect(draw(IntroTv, IN.stall + 1500)).toContain("Trabolta Setup (Not Responding)");
    expect(draw(IntroTv, freeze.end + 200)).not.toContain("Not Responding");
    expect(introJudder(IN.stall + 1500)).toBeGreaterThan(0);
    expect(introJudder(IN.loud + 100)).toBeGreaterThan(introJudder(IN.stall + 1500));
    expect(introJudder(IN.online)).toBe(0);
  });

  it("the ALL CAPS word is logged, and Disregard closes it (wave 32)", () => {
    const disregard = INTRO_CAPTIONS[INTRO_SAYS.disregard]!;
    expect(draw(IntroTv, IN.loud - 100)).not.toContain(INTRO_LOG.text);
    expect(draw(IntroTv, IN.logged + 400)).toContain(INTRO_LOG.title);
    expect(draw(IntroTv, IN.logged + 400)).toContain(INTRO_LOG.text);
    expect(draw(IntroTv, IN.loud + 200)).toContain("data-loud");
    expect(draw(IntroTv, disregard.end + 400)).not.toContain(INTRO_LOG.text);
    expect(draw(IntroTv, disregard.end + 400)).not.toContain("data-loud");
    // No digit run or year in the new words (C8), and nothing names the crew or the night.
    for (const w of [INTRO_LOG.title, INTRO_LOG.text, INTRO_LIVE_TAB]) expect(w).not.toMatch(/\d|show|party|performer/iu);
  });

  it("the face glides aside for the setup, then into the corner window for the hand-back", () => {
    expect(introFacePose(5000, false).x).toBeCloseTo(0, 5);
    expect(introFacePose(5000, false).y).toBeCloseTo(0, 5);
    expect(introFacePose(IN.setup + 2000, false).x).toBeLessThan(-10);
    const end = introFacePose(IN.end, false);
    expect(end.x).toBeCloseTo(INTRO_PIP.x, 5);
    expect(end.y).toBeCloseTo(INTRO_PIP.y, 5);
    expect(end.scale).toBeCloseTo(INTRO_PIP.scale, 5);
    expect(introFacePose(IN.end, true)).toEqual(end);
    // Over the mirror, his sentence stays up in the bar, and LIVE comes up on "Not yet, Clippy."
    const last = INTRO_CAPTIONS.at(-1)!;
    expect(draw(IntroTv, last.end + 10)).toContain("a1-in-say");
    expect(draw(IntroTv, IN.live - 100)).not.toContain(INTRO_LIVE_TAB);
    expect(draw(IntroTv, IN.live + 400)).toContain(INTRO_LIVE_TAB);
    expect(draw(IntroTv, IN.back + 2000)).toContain("data-pip");
  });

  it("with no mirror on the screen, the hand-back opens onto the house's desktop, never dead black (wave 32 review)", () => {
    // No world view here (no reinstalled player in this room): the desktop comes up as the black opens.
    expect(introDeskAt(IN.back - 1, false)).toBe(0);
    expect(introDeskAt(IN.back + 700, false)).toBeGreaterThan(0);
    expect(introDeskAt(IN.back + 1400, false)).toBe(1);
    expect(introDeskAt(IN.end, false)).toBe(1);
    expect(introStageBg(IN.back + 3000, false)).toBe("#000");
    expect(INTRO_DESK_DIM).toBeGreaterThan(0);
    expect(INTRO_DESK_DIM).toBeLessThan(0.8);
    // From "The copy of my house" to the last frame: the desktop, behind the corner window.
    for (const t of [IN.back + 1400, IN.back + 4000, IN.live + 400, IN.voiceEnd, IN.end - 600]) {
      const html = draw(IntroTv, t);
      expect(html, String(t)).toContain("a1-in-desk");
      expect(html, String(t)).toContain("My Computer");
      expect(html, String(t)).toContain("data-pip");
    }
    expect(draw(IntroTv, IN.back - 100)).not.toContain("a1-in-desk");
    // With a mirror (a world view on this screen), it opens onto that instead: no desktop.
    const bye = noteWorldShowing();
    try {
      expect(introDeskAt(IN.back + 4000, true)).toBe(0);
      expect(introStageBg(IN.back + 1400, true)).toBe("rgba(0,0,0,0.000)");
      expect(draw(IntroTv, IN.back + 4000)).not.toContain("a1-in-desk");
    } finally {
      bye();
    }
  });

  it("the mirror is read once at the hand-back: a world view that comes or goes mid hand-back never snaps the desktop (wave 32 review)", () => {
    const frame = 1000 / 60;
    // A reinstalled player walks into the Desktop mid hand-back: the desktop stays, no hard cut.
    const comes = new IntroMirror();
    let bye: (() => void) | null = null;
    try {
      let last = introDeskAt(IN.back - frame, comes.showsAt(IN.back - frame));
      for (let t = IN.back; t <= IN.end; t += frame) {
        if (bye === null && t >= IN.back + 700) bye = noteWorldShowing();
        const desk = introDeskAt(t, comes.showsAt(t));
        expect(desk, String(t)).toBeGreaterThanOrEqual(last);
        last = desk;
      }
      expect(last).toBe(1);
    } finally {
      bye?.();
    }
    // A world view on at the hand-back that goes mid-way: no desktop pops in at full opacity.
    const goes = new IntroMirror();
    const bye2 = noteWorldShowing();
    let gone = false;
    try {
      for (let t = IN.back; t <= IN.end; t += frame) {
        if (!gone && t >= IN.back + 2000) { bye2(); gone = true; }
        expect(introDeskAt(t, goes.showsAt(t)), String(t)).toBe(0);
      }
    } finally {
      bye2();
    }
    // A scrub back before the hand-back reads the screen again.
    expect(goes.showsAt(IN.back + 100)).toBe(true);
    expect(goes.showsAt(IN.back - 100)).toBe(false);
    expect(goes.showsAt(IN.back + 100)).toBe(false);
  });

  it("hands back to the mirror: fully transparent at its end", () => {
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
    const second = INTRO_CAPTIONS[1]!;
    expect(introLine(second.start + 100, null)).toEqual(INTRO_CAPTIONS[1]);
    const said = introLine(second.start + 100, { seq: 9, index: 1, text: "I am Jean Trabolta, and the line changed." });
    expect(said).toMatchObject({ text: "I am Jean Trabolta, and the line changed.", start: second.start });
    expect(introLine(INTRO_CAPTIONS[0]!.start + 100, { seq: 9, index: 0, text: INTRO_HELLO })).toBeNull(); // the big HELLO is up
    // A sentence past the captions takes the last one's mark.
    expect(introLine(99_999, { seq: 9, index: 99, text: "One more." })?.start).toBe(INTRO_CAPTIONS.at(-1)!.start);
    // (wave 32) His later lines: the mark places it, not the line's own index.
    const later = INTRO_CAPTIONS[INTRO_SAYS.denial]!;
    expect(introLine(later.start + 100, { seq: 12, index: 0, mark: INTRO_SAYS.denial, text: later.text })).toMatchObject({ text: later.text, start: later.start });
    const state = fakeState({ now: 1_000_000 + second.start + 2500 });
    const html = renderToStaticMarkup(createElement(IntroTv as never, { t: second.start + 2500, at: 1_000_000, seq: 1, value: "", state, night: state.night, who: null, target: "tv", sfx: () => false, done: () => {}, reduced: false, voice: { seq: 9, index: 1, text: "Spoken words here." } } as never));
    expect(html).toContain("Spoken words here.");
  });
});
