//! When the CRT asks for a pass (wave 52b), pure. Door closed, it's the pipes.
//! The door opening wakes it, and so does any press on the controller, in case
//! the sensor is down. It stays up while the door is open and for a minute
//! after it shuts, which is how long a guest has to walk in and hold up a pass.
//!
//! The virtual keyboard is here too (`Keyboard.tsx`): the fallback when the
//! camera won't read a pass. It types a program name, or an id: the same
//! lookup as the typed fallback on every other terminal (`scan.ts` `matchName`).

/** How long the prompt stays after the door shuts, or after a press (ms). */
export const PROMPT_LINGER_MS = 60_000;
/** The story speaks first when the door moves: he gives it this long (ms). */
export const PROMPT_SPEAK_MS = 2500;
/** The story's own line (`Heart Sealed`), for every guest after the first: it says it once. */
export const PASS_LINE = "There is a camera under the screen. Show it your pass. I want to know who I am talking to.";

/** The prompt's end: `Infinity` while the door stands open. */
export function promptAfterDoor(until: number, doorOpen: boolean | null, now: number): number {
  if (doorOpen === true) return Number.POSITIVE_INFINITY;
  return until === Number.POSITIVE_INFINITY ? now + PROMPT_LINGER_MS : until;
}

/** The prompt's end after a press on the controller: a minute, never less than it had. */
export function promptAfterPress(until: number, now: number): number {
  return Math.max(until, now + PROMPT_LINGER_MS);
}

/** Does this terminal ask for a pass right now? */
export function promptUp(o: { attract: boolean; until: number; now: number; typing: boolean; stage: string | null }): boolean {
  if (!o.attract || o.stage === "done") return false;
  return o.typing || o.now < o.until;
}

/** Should he say the line himself? Only with a talk open to a pass, and the first guest hears it from the story. */
export function speaksPrompt(o: { up: boolean; typing: boolean; said: boolean; voiceBusy: boolean; stage: string | null }): boolean {
  return o.up && !o.typing && !o.said && !o.voiceBusy && o.stage === "scan";
}

export const KEY_ROWS: readonly (readonly string[])[] = [
  ["A", "B", "C", "D", "E", "F", "G", "H", "I"],
  ["J", "K", "L", "M", "N", "O", "P", "Q", "R"],
  ["S", "T", "U", "V", "W", "X", "Y", "Z", "-"],
  ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
  ["0", "SPACE", "DELETE", "DONE"],
];

export const NAME_MAX = 24;

export interface KeyAt {
  row: number;
  col: number;
}

/** The key after a push. Rows of different lengths keep the column's place across the row. */
export function keyMoved(at: KeyAt, dx: number, dy: number): KeyAt {
  const row = Math.max(0, Math.min(KEY_ROWS.length - 1, at.row + dy));
  const from = KEY_ROWS[at.row]!.length;
  const to = KEY_ROWS[row]!.length;
  const col = row === at.row ? at.col : Math.round((at.col * (to - 1)) / (from - 1));
  return { row, col: Math.max(0, Math.min(to - 1, col + dx)) };
}

/** A key pressed: the text after it, and whether that was DONE. */
export function keyPressed(text: string, key: string): { text: string; done: boolean } {
  if (key === "DONE") return { text, done: true };
  if (key === "DELETE") return { text: text.slice(0, -1), done: false };
  const letter = key === "SPACE" ? " " : key;
  return { text: text.length >= NAME_MAX ? text : text + letter, done: false };
}
