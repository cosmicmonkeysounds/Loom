//! The intro (wave 33) — pure. A program's first reinstallation opens with
//! the Reinstallation Process video (`IntroVideo.tsx`, before the begin) and
//! then this short tutorial, in the house at the spawn: standard first-person
//! controls, one thing at a time, each step done by doing it.
//!
//! - A mouse (the tent laptop): click to take the mouse (pointer lock), move
//!   it to look, W A S D to walk, Shift to run, then "Esc gives the mouse
//!   back — find Gerald".
//! - A touch screen: the LOOK stick, the MOVE stick, then the goal.
//!
//! Both are skippable only once the program has completed a reinstallation
//! (`introSkippable`, the server's `reinstalled`). When the tutorial ends the
//! game posts `ready` (the server's run clock restarts) and its own clock,
//! the path reveal included, starts from there.

/** The video, served by the event server beside the reinstall app (the tent
 *  laptop's terminal mounts the flow under `/terminal/`, so never relative). */
export const INTRO_VIDEO_URL = "/reinstall/intro/reinstallation.mp4";

/** The video plays on with no progress for this long (a stalled download):
 *  a Continue button shows even when it isn't skippable. */
export const VIDEO_STALL_MS = 15_000;

/** May the video and the tutorial be skipped? Only once the program has
 *  completed a reinstallation (missing: an old server — not yet). */
export function introSkippable(reinstalled: number | undefined | null): boolean {
  return typeof reinstalled === "number" && reinstalled >= 1;
}

export type TutorialStep = "click" | "look" | "walk" | "run" | "done";

/** Degrees of looking around that finish the look step. */
export const LOOK_DEG = 120;
/** Metres walked that finish the walk step. */
export const WALK_M = 3;
/** Seconds of running that finish the run step. */
export const RUN_S = 1.2;
/** Seconds the last card stays before the walk is on its own. */
export const DONE_S = 5;

export interface Tutorial {
  readonly steps: readonly TutorialStep[];
  /** Index into `steps`. */
  readonly at: number;
  /** How far into the current step (its own unit: degrees, metres, seconds). */
  readonly amount: number;
  /** The tutorial is over (the last card has had its time, or a skip). */
  readonly over: boolean;
}

/** One frame of what the player did. */
export interface TutorialFrame {
  /** The mouse is the game's (pointer lock) — or a drag looked around (a
   *  browser that refuses the lock still learns to look). */
  locked: boolean;
  /** Degrees the view turned or tilted this frame (absolute). */
  looked: number;
  /** Metres the body moved this frame (plan). */
  moved: number;
  /** Shift is held while moving. */
  running: boolean;
  /** Seconds since the last frame. */
  dt: number;
}

export function tutorialSteps(touch: boolean): TutorialStep[] {
  return touch ? ["look", "walk", "done"] : ["click", "look", "walk", "run", "done"];
}

export function startTutorial(touch: boolean): Tutorial {
  return { steps: tutorialSteps(touch), at: 0, amount: 0, over: false };
}

export function stepOf(t: Tutorial): TutorialStep {
  return t.steps[Math.min(t.at, t.steps.length - 1)]!;
}

/** What the current step needs (in its unit). */
export function goalOf(step: TutorialStep): number {
  switch (step) {
    case "click":
      return 1;
    case "look":
      return LOOK_DEG;
    case "walk":
      return WALK_M;
    case "run":
      return RUN_S;
    case "done":
      return DONE_S;
  }
}

/** 0…1 through the current step. */
export function progressOf(t: Tutorial): number {
  return Math.max(0, Math.min(1, t.amount / goalOf(stepOf(t))));
}

/** Advance the tutorial by one frame of play. */
export function advance(t: Tutorial, f: TutorialFrame): Tutorial {
  if (t.over) return t;
  const step = stepOf(t);
  let gain = 0;
  switch (step) {
    case "click":
      gain = f.locked || f.looked > 0 ? 1 : 0;
      break;
    case "look":
      gain = f.looked;
      break;
    case "walk":
      gain = f.moved;
      break;
    case "run":
      gain = f.running && f.moved > 0 ? f.dt : 0;
      break;
    case "done":
      gain = f.dt;
      break;
  }
  const amount = t.amount + Math.max(0, gain);
  if (amount < goalOf(step)) return { ...t, amount };
  if (t.at + 1 >= t.steps.length) return { ...t, amount: goalOf(step), over: true };
  return { ...t, at: t.at + 1, amount: 0 };
}

/** Skip the rest (a returning program's Skip button). */
export function skipTutorial(t: Tutorial): Tutorial {
  return { ...t, at: t.steps.length - 1, amount: goalOf("done"), over: true };
}

export interface TutorialCopy {
  title: string;
  line: string;
}

// DRAFT w33 (the intro tutorial's copy, awaiting sign-off)
const MOUSE_COPY: Record<TutorialStep, TutorialCopy> = {
  click: { title: "Take the mouse", line: "Click anywhere on the picture. From then on the mouse turns your head, like in any computer game." },
  look: { title: "Look around", line: "Move the mouse to look left and right, up and down." },
  walk: { title: "Walk", line: "Hold W to walk forward. A and D step sideways, S steps back." },
  run: { title: "Run", line: "Hold Shift while you walk to run." },
  done: { title: "You're ready", line: "Press Esc any time to get the mouse back. Now find Gerald, the golden duck." },
};

// DRAFT w33
const TOUCH_COPY: Record<TutorialStep, TutorialCopy> = {
  click: MOUSE_COPY.click,
  look: { title: "Look around", line: "Drag the LOOK stick on the right to turn and look around." },
  walk: { title: "Walk", line: "Push the MOVE stick on the left to walk." },
  run: MOUSE_COPY.run,
  done: { title: "You're ready", line: "Now find Gerald, the golden duck." },
};

export function tutorialCopy(step: TutorialStep, touch: boolean): TutorialCopy {
  return (touch ? TOUCH_COPY : MOUSE_COPY)[step];
}

/** What the play screen shows of the tutorial (`HudState.tutorial`). */
export interface TutorialHud {
  step: TutorialStep;
  /** 1-based, of `total` (the last card counts). */
  index: number;
  total: number;
  progress: number;
  skippable: boolean;
}

export function tutorialHud(t: Tutorial, skippable: boolean): TutorialHud {
  return { step: stepOf(t), index: Math.min(t.at, t.steps.length - 1) + 1, total: t.steps.length, progress: progressOf(t), skippable };
}
