import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fakeState } from "../src/cutscene/fake.ts";
import { INTRO_CAPTIONS, INTRO_FACE_DONE, INTRO_HELLO, INTRO_LINE, INTRO_MS, INTRO_SFX, INTRO_VOICE_END, INTRO_WALL_MS, IN, IntroTv, IntroWall, POWER_ON_MS, POWER_ON_WALL_MS, PowerOnTv, PowerOnWall, introFacePose } from "../src/cutscene/kit/tv1-boot.tsx";
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
  it("runs 20–30 s in order: boot + face, the greeting, the setup, the logo, ALL SYSTEMS ONLINE, the hand-back", () => {
    expect(INTRO_MS).toBeGreaterThanOrEqual(20_000);
    expect(INTRO_MS).toBeLessThanOrEqual(30_000);
    const order = [IN.post, IN.face, IN.hello, IN.voiceEnd, IN.montage, IN.setup, IN.logo, IN.online, IN.back, IN.end];
    for (let i = 1; i < order.length; i++) expect(order[i]!, `phase ${i}`).toBeGreaterThan(order[i - 1]!);
    expect(IN.back - IN.online).toBeGreaterThanOrEqual(2000);
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
    // The captions are the line, word for word, and last about as long as it takes to say (8–12 s).
    expect(INTRO_CAPTIONS.map((c) => c.text).join(" ")).toBe(`${INTRO_HELLO} ${INTRO_LINE}`);
    expect(INTRO_VOICE_END - INTRO_VOICE.start).toBeGreaterThanOrEqual(8000);
    expect(INTRO_VOICE_END - INTRO_VOICE.start).toBeLessThanOrEqual(12_000);
    // Each sentence is on screen while it is said; none is typed after the voice.
    for (const c of INTRO_CAPTIONS) expect(draw(IntroTv, c.end + 10)).toContain(c.text.replace(/'/gu, "&#x27;"));
    expect(draw(IntroTv, IN.montage + 700)).not.toContain(INTRO_HELLO);
    // The setup is after the line, never during it.
    expect(IN.setup).toBeGreaterThan(INTRO_VOICE_END);
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

  it("the face glides aside for the setup and back for the hand-back", () => {
    expect(introFacePose(5000, false).x).toBeCloseTo(0, 5);
    expect(introFacePose(IN.setup + 2000, false).x).toBeLessThan(-10);
    expect(introFacePose(IN.end, false).x).toBeCloseTo(0, 5);
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
