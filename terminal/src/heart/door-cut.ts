//! The door cuts him off (wave 59), pure. On the heart terminal the door, opening
//! or shutting, is the one thing that interrupts him: the line in progress stops
//! mid-word and everything he owes is dropped, never said later. The player
//! still can't: nothing but `DoorCut.step` leads to the cut.
//!
//! - **The door** is the terminal's own (`DoorCut`): the sensor the moment it
//!   moves, no round trip; the story's `night.server_door` for a 🚪 press, or on
//!   a terminal with no sensor. Once per edge. Handing over isn't the door
//!   moving, so the first door after a load, a fault, a stale sensor and the end
//!   of an override cut nothing. A flicker never gets this far: the firmware's
//!   classifier debounces `open`, so only `level` wobbles.
//! - **A late frame** is a line the server wrote before it heard the door and
//!   the page got after. Two markers the answer already carries say so. Its
//!   `night.server_door` still behind the sensor (`DoorCut.behind`): nothing in
//!   it can be for this door. And a line's `beat` (`wrongDoor`): one poll can
//!   carry a nag and the reaction together, and a 🚪 press has no earlier moment
//!   to compare with, so what he says about the door is judged against the door.

import { sensorUsable, type SensorState, type StoryDoor } from "../serial/door-bridge.ts";

/** How long after an edge a story still behind the sensor marks a frame late
 *  (ms). A bound: a story that never hears the door must not silence him. */
export const DOOR_LATE_MS = 4000;

/** He wants the door shut: never said with it shut. */
export const DOOR_OPEN_BEATS: readonly string[] = ["The Heart", "Heart Nag", "Heart Door Again", "Heart Shut It"];
/** He thanks a shut door: never said with it open. */
export const DOOR_SHUT_BEATS: readonly string[] = ["Heart Door Shut", "Heart Sealed"];

const fold = (s: string): string => s.toLowerCase().replace(/[\s_-]+/gu, " ").trim();
const among = (beat: string, beats: readonly string[]): boolean => beats.some((b) => fold(b) === fold(beat));

/** Is this beat about the other door? `doorOpen` null (not a heart terminal, or nobody knows): never. */
export function wrongDoor(beat: string | null | undefined, doorOpen: boolean | null): boolean {
  if (beat === null || beat === undefined || doorOpen === null) return false;
  return among(beat, doorOpen ? DOOR_SHUT_BEATS : DOOR_OPEN_BEATS);
}

const storyOpen = (night: StoryDoor | null): boolean | null => (night === null || night.server_door === null ? null : night.server_door === "open");

export class DoorCut {
  private door: boolean | null = null;
  private story: boolean | null = null;
  private live = false;
  private edgeAt = Number.NEGATIVE_INFINITY;

  /** Look at the door. True once per edge: cut him off now. */
  step(sensor: SensorState | null, night: StoryDoor | null, now: number): boolean {
    const was = this.story;
    const story = night === null ? was : storyOpen(night);
    this.story = story;
    const override = night?.door_override === true;
    const live = sensorUsable(sensor, now) && !override;
    const handed = (live && !this.live) || (override && was === null);
    this.live = live;
    let next: boolean | null;
    if (live) next = sensor!.open;
    else if (story === null) {
      this.door = null;
      return false;
    } else if (override || (was !== null && story !== was)) next = story;
    else next = this.door ?? story;
    const before = this.door;
    this.door = next;
    if (handed || before === null || before === next) return false;
    this.edgeAt = now;
    return true;
  }

  /** Was this answer written before the story heard the door? */
  behind(night: StoryDoor | null, now: number): boolean {
    const story = storyOpen(night);
    return story !== null && this.door !== null && story !== this.door && now - this.edgeAt < DOOR_LATE_MS;
  }
}

/** Where each line he owes stops (seq → characters): the end of the sentence he
 *  is on for the line he is saying, 0 for one he never started. `ends`: each
 *  owed line's sentence ends (`revealOffsets`). */
export function stopsAt(ends: ReadonlyMap<number, readonly number[]>, on: { id: number; index: number } | null): Map<number, number> {
  const out = new Map<number, number>();
  for (const [id, at] of ends) out.set(id, id === on?.id ? (at[on.index] ?? 0) : 0);
  return out;
}
