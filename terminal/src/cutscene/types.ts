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
 * Names match folded: case, spaces, `_` and `-` don't count. `{room}` (wave
 * 20) — a room terminal's picture cue (`cue room_heart_wake` in a beat set in
 * its LOCATION → the screen state's `room.cue`), matched exactly (folded)
 * against the cue without its `room_` prefix: `{room: "heart_wake"}`. Room
 * scenes play on that room's terminal only, whatever else it is doing (a
 * line open included); walls and the TV never see them.
 */
export type SceneTrigger = { slide: string } | { moment: ScreenMoment["kind"]; name: string } | { room: string };

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
  /** (wave 26, V1) On the TV, a voiced scene's sentence he is saying now
   *  (`voice-scenes.ts`; `t` is already warped to his voice). Absent / null:
   *  nothing is speaking for it — draw the scene's own copy. */
  voice?: SceneVoice | null;
}

/** The sentence the TV is saying for a scene (wave 26, V1): the written words. */
export interface SceneVoice {
  /** The room line's seq. */
  seq: number;
  /** The sentence's index within that line. */
  index: number;
  text: string;
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
  /** Names "Jean Trabolta" only in the third person, as the owner who joins by
   *  video conference later (wave 18b, D19): may play before the introduction. */
  owner?: boolean;
  /** May it play on this night (the story's own gates: not after an ending …)? Checked
   *  with the introduction gate, on arrival; absent = always. */
  gate?: (night: ScreenNight) => boolean;
  /** A moment scene that draws over the slide under it (a popup) instead of in its place. */
  over?: boolean;
  /** A room scene (wave 20) that takes the whole screen, the heart's choices
   *  included (the wake, the seal, an eject, *not yet*, a leave, the
   *  shutdown). Else it draws over the face only, never over a docked menu,
   *  and takes no taps. */
  covers?: boolean;
  /** The scene draws the story's countdown itself (on both targets, or only
   *  the TV's take): the corner countdown stands aside while it shows. */
  countdown?: boolean | "tv";
  /** The TV face's one-shot mood when the scene starts (`FaceHandle.flash`). */
  face?: Mood;
  /** How long that mood holds (ms; default `FACE_FLASH_MS`). */
  faceMs?: number;
  /** Flash `face` only on such a night (one def, two takes: the results slide is the
   *  filing window too, which is no reading); absent = always. */
  faceWhen?: (night: ScreenNight) => boolean;
}
