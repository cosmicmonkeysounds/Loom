import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fakeState } from "../src/cutscene/fake.ts";
import { INTRO_HELLO, INTRO_LINE, INTRO_MS, INTRO_WALL_MS, IN, IntroTv, IntroWall, POWER_ON_MS, POWER_ON_WALL_MS, PowerOnTv, PowerOnWall } from "../src/cutscene/kit/tv1-boot.tsx";
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
  it("runs 20–30 s in order: POST, loading, logo, face, greeting, hand-back", () => {
    expect(INTRO_MS).toBeGreaterThanOrEqual(20_000);
    expect(INTRO_MS).toBeLessThanOrEqual(30_000);
    expect(IN.post < IN.loading && IN.loading < IN.splash && IN.splash < IN.face && IN.face < IN.hello && IN.hello < IN.back && IN.back < IN.end).toBe(true);
  });

  it("each phase draws its own picture", () => {
    expect(draw(IntroTv, 3000)).toContain("TRABOLTA BIOS");
    expect(draw(IntroTv, 3000)).toContain("Memory Test");
    expect(draw(IntroTv, 7800)).toContain("STARTING TRABOLTA");
    expect(draw(IntroTv, 11_000)).toContain("the computer&#x27;s AI helper");
    expect(draw(IntroTv, 16_000)).toContain("a1-face");
    expect(draw(IntroTv, 23_500)).toContain(INTRO_HELLO);
    expect(draw(IntroTv, 24_200)).toContain(INTRO_LINE);
  });

  it("hands back to the live face: fully transparent at its end", () => {
    expect(draw(IntroTv, INTRO_MS)).toMatch(/opacity:0[;"]/u);
    expect(draw(IntroWall, INTRO_WALL_MS)).toBe("");
    expect(INTRO_WALL_MS).toBeLessThan(INTRO_MS);
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
