import { describe, expect, it, vi } from "vitest";
import { postReady, toProgram } from "../src/api.ts";
import { applyHints, defaultConfig, hintsFromSearch, loadConfig, withoutSecrets } from "../src/config.ts";
import { DRAG_DEGREES_PER_PX, LOCKED_DEGREES_PER_PX, lockedMouseDrag } from "../src/game/input.ts";
import {
  advance,
  DONE_S,
  INTRO_VIDEO_URL,
  introSkippable,
  LOOK_DEG,
  progressOf,
  RUN_S,
  skipTutorial,
  startTutorial,
  stepOf,
  tutorialCopy,
  tutorialHud,
  tutorialSteps,
  WALK_M,
  type Tutorial,
  type TutorialFrame,
} from "../src/game/tutorial.ts";

const idle: TutorialFrame = { locked: false, looked: 0, moved: 0, running: false, dt: 0.1 };
const frame = (over: Partial<TutorialFrame>): TutorialFrame => ({ ...idle, ...over });
const run = (t: Tutorial, f: TutorialFrame, n: number): Tutorial => {
  for (let i = 0; i < n; i++) t = advance(t, f);
  return t;
};

describe("the intro's skip rule", () => {
  it("skippable only once the program has completed a reinstallation", () => {
    expect(introSkippable(0)).toBe(false);
    expect(introSkippable(undefined)).toBe(false); // an old server
    expect(introSkippable(null)).toBe(false);
    expect(introSkippable(1)).toBe(true);
    expect(introSkippable(3)).toBe(true);
  });

  it("the video is served beside the reinstall app, never relative (the tent laptop mounts the flow under /terminal/)", () => {
    expect(INTRO_VIDEO_URL.startsWith("/reinstall/")).toBe(true);
  });
});

describe("the tutorial", () => {
  it("a mouse: click, look, walk, run, then the goal; touch: look, walk, the goal", () => {
    expect(tutorialSteps(false)).toEqual(["click", "look", "walk", "run", "done"]);
    expect(tutorialSteps(true)).toEqual(["look", "walk", "done"]);
  });

  it("each step is done by doing it, and only that", () => {
    let t = startTutorial(false);
    expect(stepOf(t)).toBe("click");
    t = run(t, frame({ moved: 1 }), 10); // walking doesn't take the mouse
    expect(stepOf(t)).toBe("click");
    t = advance(t, frame({ locked: true }));
    expect(stepOf(t)).toBe("look");
    t = advance(t, frame({ locked: true, looked: LOOK_DEG / 2 }));
    expect(progressOf(t)).toBeCloseTo(0.5);
    t = advance(t, frame({ locked: true, looked: LOOK_DEG / 2 }));
    expect(stepOf(t)).toBe("walk");
    t = run(t, frame({ locked: true, moved: 0.5 }), Math.ceil(WALK_M / 0.5));
    expect(stepOf(t)).toBe("run");
    t = run(t, frame({ locked: true, running: true }), 30); // Shift with no walking
    expect(stepOf(t)).toBe("run");
    t = run(t, frame({ locked: true, running: true, moved: 0.3 }), Math.ceil(RUN_S / 0.1) + 1);
    expect(stepOf(t)).toBe("done");
    expect(t.over).toBe(false);
    t = run(t, idle, Math.ceil(DONE_S / 0.1) + 1);
    expect(t.over).toBe(true);
    expect(advance(t, frame({ moved: 5 }))).toBe(t);
  });

  it("a browser that refuses the lock still learns to look (a drag passes the click step)", () => {
    const t = advance(startTutorial(false), frame({ looked: 2 }));
    expect(stepOf(t)).toBe("look");
  });

  it("Skip ends it at once", () => {
    const t = skipTutorial(startTutorial(false));
    expect(t.over).toBe(true);
    expect(stepOf(t)).toBe("done");
  });

  it("the HUD card: step n of total, progress, skippable", () => {
    let t = startTutorial(true);
    t = advance(t, frame({ looked: LOOK_DEG / 4 }));
    expect(tutorialHud(t, false)).toEqual({ step: "look", index: 1, total: 3, progress: 0.25, skippable: false });
    expect(tutorialHud(t, true).skippable).toBe(true);
  });

  it("has words for every step on both devices; the mouse's last card says how to get the mouse back", () => {
    for (const touch of [false, true]) for (const s of tutorialSteps(touch)) expect(tutorialCopy(s, touch).line.length).toBeGreaterThan(10);
    expect(tutorialCopy("done", false).line).toContain("Esc");
    expect(tutorialCopy("done", true).line).not.toContain("Esc");
    expect(tutorialCopy("done", false).line).toContain("Gerald");
  });
});

describe("the locked mouse", () => {
  it("looks at the first-person rate, through the drag's scale", () => {
    const [dx, dy] = lockedMouseDrag(100, -50);
    expect(dx * DRAG_DEGREES_PER_PX).toBeCloseTo(100 * LOCKED_DEGREES_PER_PX);
    expect(dy * DRAG_DEGREES_PER_PX).toBeCloseTo(-50 * LOCKED_DEGREES_PER_PX);
    expect(lockedMouseDrag(Number.NaN, Infinity)).toEqual([0, 0]);
  });
});

describe("the intro switch (intro=0)", () => {
  it("is on unless a device turns it off", () => {
    const c = defaultConfig({ eventId: "e", token: "t" });
    expect(c.intro).toBeUndefined();
    expect(hintsFromSearch("?intro=0").intro).toBe(false);
    expect(hintsFromSearch("?intro=1").intro).toBe(true);
    expect(hintsFromSearch("").intro).toBeNull();
    expect(applyHints(c, { ...hintsFromSearch("?intro=0") }).intro).toBe(false);
    expect(applyHints(c, { ...hintsFromSearch("") }).intro).toBeUndefined();
    expect(withoutSecrets("?code=x&intro=0&keep=1")).toBe("?keep=1");
    const stored = { getItem: () => JSON.stringify({ ...c, intro: false }) };
    expect(loadConfig(stored)?.intro).toBe(false);
  });
});

describe("the server's half", () => {
  it("a candidate's reinstalled count (missing or junk: 0)", () => {
    const row = { id: "g-1", name: "Pinball", captured: true, restricted: false, location: null };
    expect(toProgram({ ...row, reinstalled: 2 }).reinstalled).toBe(2);
    expect(toProgram(row).reinstalled).toBe(0);
    expect(toProgram({ ...row, reinstalled: Number.NaN }).reinstalled).toBe(0);
  });

  it("ready posts with the session token; an old server's 404 or no network is just false", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await postReady("/e/x", "tok", fetcher as unknown as typeof fetch)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("/e/x/api/spatial/ready", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "x-loom-token": "tok" }) }));
    expect(await postReady("/e/x", "tok", (async () => new Response("", { status: 404 })) as unknown as typeof fetch)).toBe(false);
    expect(
      await postReady("/e/x", "tok", (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch),
    ).toBe(false);
  });
});
