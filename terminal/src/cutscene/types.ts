//! The cutscene contract (wave 17): what an act file (`scenes/act1.tsx` …)
//! exports and what a scene component is handed. A scene is a pure picture
//! of time — `t` ms since it started on the **server's** clock — so a
//! reload mid-scene lands on the right frame and history never replays (D2).

import type { ComponentType } from "react";
import type { Mood } from "../face/mood.ts";
import type { ScreenMoment, ScreenNight, ScreenState } from "../screen.ts";
import type { sfx } from "../sound/bus.ts";

/**
 * What starts a scene. `{slide}` — a story slide cue's value (`trivia_1`;
 * a trailing `*` matches a prefix: `award_*`). `{moment, name}` — a live
 * moment off the screen state (`{moment: "signal", name: "bottle landed"}`).
 * Names match folded: case, spaces, `_` and `-` don't count.
 */
export type SceneTrigger = { slide: string } | { moment: ScreenMoment["kind"]; name: string };

/** Which screen draws it: the TV over the fireplace, or a wall terminal. */
export type SceneTarget = "tv" | "wall";

export interface SceneProps {
  /** ms since the scene started, on the server's clock (≥ 0; a slide from history: `HISTORY_T`). */
  t: number;
  /** Server epoch ms it started (the cue's / moment's `at`; 0 = history). */
  at: number;
  /** The cue's or moment's seq (a repeat is a new seq: the scene starts over). */
  seq: number;
  /** What started it: the slide's value or the moment's name. */
  value: string;
  /** The live screen state (the chart, the King, the countdown …). */
  state: ScreenState;
  /** `state.night`, for short. */
  night: ScreenNight;
  /** The program a moment is about (the bottle's pick, a duck's finder), else null. */
  who: string | null;
  target: SceneTarget;
  /** The page's accent sounds (`sound/`): dropped when locked, muted or under the voice. */
  sfx: typeof sfx;
  /** End the scene now (a slide falls back to its card, a moment lets the next one play). */
  done(): void;
  /** `prefers-reduced-motion`: fade, don't fly. */
  reduced: boolean;
}

export interface SceneDef {
  /** Unique across every act file. */
  id: string;
  when: SceneTrigger[];
  /**
   * How long it plays (ms). A slide scene past its `ms` (or `done()`) falls
   * back to the slide's card for the rest of the slide's hold; `"hold"`
   * plays for the whole hold (loop the hold state: a persistent slide stays
   * up all hour). A moment scene ends at `ms`; `"hold"` until `done()`
   * (capped at `MOMENT_HOLD_MAX_MS`).
   */
  ms: number | "hold";
  /** The TV's (elaborate) take; with none, the TV draws `wall`. */
  tv?: ComponentType<SceneProps>;
  /** A wall terminal's (lighter) take; with none, a slide shows its card and a moment nothing. */
  wall?: ComponentType<SceneProps>;
  /** Higher first in the moment queue; a moment scene shows over a slide scene of lower or equal priority. */
  priority?: number;
  /** Says or shows the character's name: never before the introduction. */
  namesCharacter?: boolean;
  /** A moment scene that draws over the slide under it (a popup) instead of in its place. */
  over?: boolean;
  /** The TV face's one-shot mood when the scene starts (`FaceHandle.flash`). */
  face?: Mood;
  /** How long that mood holds (ms; default `FACE_FLASH_MS`). */
  faceMs?: number;
}
