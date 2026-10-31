//! The door and the bay cut him off (wave 59), pure. On the heart terminal the door,
//! opening or shutting, and the patch bay are what interrupt him: the line in
//! progress stops mid-word and everything he owes is dropped, never said later.
//! The player's keys, pad, voice and buttons change nothing (`Terminal` gives a
//! heart terminal no skip). A plain terminal's DISCONNECT still ends the visit, and
//! him with it; the CRT, the show's rig, has no such button.
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
//!   The first answer that has heard the door drops what comes ahead of his
//!   reaction: written before the edge, it was only delivered with it.
//! - **The bay** cuts at the moment of a post (`serial/patch-bridge.ts`, through
//!   `door-status.ts` `bayCut`). A 🔌 💥 ❌ press has no post here, so it arrives on
//!   a poll as the story's answer (`DoorCut.frame`): a line of `BAY_BEATS`, which
//!   also stops what he's saying and goes ahead of what's in front of it, or, for
//!   the endings, which play in The Desktop, `Night.phase` reaching `BAY_PHASES`. A
//!   post's own answer does the same, and finds him already stopped.

import { sensorUsable, type SensorState, type StoryDoor } from "../serial/door-bridge.ts";

/** How long after an edge a story still behind the sensor marks a frame late
 *  (ms). A bound: a story that never hears the door must not silence him. */
export const DOOR_LATE_MS = 4000;

/** He wants the door shut: never said with it shut. */
export const DOOR_OPEN_BEATS: readonly string[] = ["The Heart", "Heart Nag", "Heart Door Again", "Heart Shut It"];
/** He thanks a shut door: never said with it open. */
export const DOOR_SHUT_BEATS: readonly string[] = ["Heart Door Shut", "Heart Sealed"];

/** The story's answers to the bay in this room. */
export const BAY_BEATS: readonly string[] = ["Patch Rejected", "Server Room Alarm", "Patch Touched"];
/** Where Combo A and Combo B leave `Night.phase`. Nothing else plays them. */
export const BAY_PHASES: readonly string[] = ["finale_killed", "finale_shutdown"];

const fold = (s: string): string => s.toLowerCase().replace(/[\s_-]+/gu, " ").trim();
const among = (beat: string, beats: readonly string[]): boolean => beats.some((b) => fold(b) === fold(beat));

/** Is this beat about the other door? `doorOpen` null (not a heart terminal, or nobody knows): never. */
export function wrongDoor(beat: string | null | undefined, doorOpen: boolean | null): boolean {
  if (beat === null || beat === undefined || doorOpen === null) return false;
  return among(beat, doorOpen ? DOOR_SHUT_BEATS : DOOR_OPEN_BEATS);
}

/** A line of a poll's, as `frame` reads it. */
interface FrameLine {
  beat: string | null;
}

const storyOpen = (night: StoryDoor | null): boolean | null => (night === null || night.server_door === null ? null : night.server_door === "open");

export class DoorCut {
  private door: boolean | null = null;
  private story: boolean | null = null;
  private live = false;
  private edgeAt = Number.NEGATIVE_INFINITY;
  /** An edge no answer that has heard the door has come in since. */
  private owed = false;
  /** The last answer's `Night.phase` (undefined: no answer yet). */
  private phase: string | null | undefined = undefined;

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
    this.owed = true;
    return true;
  }

  /** Was this answer written before the story heard the door? */
  behind(night: StoryDoor | null, now: number): boolean {
    const story = storyOpen(night);
    return story !== null && this.door !== null && story !== this.door && now - this.edgeAt < DOOR_LATE_MS;
  }

  /** A poll's new lines: which he may still say, and whether the bay stops him
   *  first. `doorOpen` null (not a heart terminal, or nobody knows): they all play. */
  frame<T extends FrameLine>(lines: readonly T[], night: (StoryDoor & { phase?: string | null }) | null, doorOpen: boolean | null, now: number): { say: T[]; cut: boolean } {
    if (doorOpen === null) return { say: [...lines], cut: false };
    const phase = night?.phase ?? null;
    const ended = this.phase !== undefined && !among(this.phase ?? "", BAY_PHASES) && among(phase ?? "", BAY_PHASES);
    this.phase = phase;
    if (this.behind(night, now)) return { say: [], cut: ended };
    let say = lines.filter((l) => !wrongDoor(l.beat, doorOpen));
    if (this.owed) {
      this.owed = false;
      const reaction = say.findIndex((l) => among(l.beat ?? "", doorOpen ? DOOR_OPEN_BEATS : DOOR_SHUT_BEATS));
      if (reaction > 0) say = say.slice(reaction);
    }
    const answer = say.findIndex((l) => among(l.beat ?? "", BAY_BEATS));
    if (answer > 0) say = say.slice(answer);
    return { say, cut: ended || answer >= 0 };
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
