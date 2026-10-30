//! The GameCube controller (wave 52), through a Mayflash adapter in PC mode.
//! Pure: `frameOf` reads the Gamepad API's raw pads, and `PadMachine` turns
//! frames into what the terminal does. `PadNav.tsx` is the loop around them.
//!
//! The adapter shows Chrome four pads, one per port, with no standard mapping,
//! so a controller can sit in any port. Measured on the real adapter
//! (2026-10-30): the indices in `GC`, the D-pad also on a hat axis (9), L and
//! R also on axes 3 and 4, and both sticks at rest at 0 on an empty port.
//!
//! - **Left stick, D-pad:** up and down the choices, with key repeat; all four
//!   ways on the virtual keyboard (`side`).
//! - **Y:** gives him a file, where the screen offers it.
//! - **A:** the lit choice.
//! - **B:** back, out of the voice prompt, then out of talking freely.
//! - **Start, held:** the virtual keyboard, while it asks for a pass.
//!
//! Nothing here can leave the terminal: B only steps back inside a talk, X, Z,
//! L, R and the C stick do nothing, and neither DISCONNECT nor ⚙ takes the
//! pad's focus.

export const GC = { a: 1, b: 2, y: 3, start: 9, up: 12, right: 13, down: 14, left: 15, stickX: 0, stickY: 1 } as const;

/** The stick counts as pushed past this, and as let go under `STICK_OFF`. */
export const STICK_ON = 0.6;
export const STICK_OFF = 0.35;
/** Held in a direction: the first repeat, then each one after (ms). */
export const REPEAT_FIRST_MS = 380;
export const REPEAT_EVERY_MS = 170;
/** Start held this long opens the keyboard (ms): a tap does nothing. */
export const START_HOLD_MS = 800;

export interface RawPad {
  id: string;
  buttons: ReadonlyArray<{ pressed: boolean }>;
  axes: readonly number[];
}

type Dir = -1 | 0 | 1;

/** Every controller on the adapter, merged: one frame of what's held. */
export interface PadFrame {
  a: boolean;
  b: boolean;
  y: boolean;
  start: boolean;
  /** The D-pad: -1 up, 1 down, 0 neither. */
  dpad: Dir;
  /** The D-pad: -1 left, 1 right, 0 neither. */
  side: Dir;
  /** The left stick, -1 (up) to 1. */
  stick: number;
  /** The left stick, -1 (left) to 1. */
  stickX: number;
}

export const NO_PAD: PadFrame = { a: false, b: false, y: false, start: false, dpad: 0, side: 0, stick: 0, stickX: 0 };

/** The Mayflash adapter's id: `MAYFLASH GameCube Controller Adapter (Vendor: 0079 Product: 1844)`. */
export function isGameCube(id: string): boolean {
  return /gamecube|vendor: 0079 product: 1844/iu.test(id);
}

/** The value further from rest. */
function strongest(a: number, b: number): number {
  return Math.abs(b) > Math.abs(a) ? b : a;
}

export function frameOf(pads: ReadonlyArray<RawPad | null>): PadFrame {
  const out = { ...NO_PAD };
  for (const p of pads) {
    if (p === null || !isGameCube(p.id)) continue;
    const held = (i: number) => p.buttons[i]?.pressed === true;
    out.a = out.a || held(GC.a);
    out.b = out.b || held(GC.b);
    out.y = out.y || held(GC.y);
    out.start = out.start || held(GC.start);
    if (held(GC.up)) out.dpad = -1;
    else if (held(GC.down)) out.dpad = 1;
    if (held(GC.left)) out.side = -1;
    else if (held(GC.right)) out.side = 1;
    out.stick = strongest(out.stick, p.axes[GC.stickY] ?? 0);
    out.stickX = strongest(out.stickX, p.axes[GC.stickX] ?? 0);
  }
  return out;
}

export type PadEvent = { t: "move"; dir: -1 | 1 } | { t: "side"; dir: -1 | 1 } | { t: "select" } | { t: "back" } | { t: "give" } | { t: "hold" };

/** One axis: a D-pad and a stick direction, as a press and its repeats. */
class Axis {
  private stickDir: Dir = 0;
  private moving: Dir = 0;
  private next = 0;

  /** The direction to fire now, or 0. */
  step(dpad: Dir, stick: number, now: number): Dir {
    const mag = Math.abs(stick);
    if (mag >= STICK_ON) this.stickDir = stick < 0 ? -1 : 1;
    else if (mag < STICK_OFF) this.stickDir = 0;
    const dir = dpad !== 0 ? dpad : this.stickDir;
    if (dir === 0) {
      this.moving = 0;
      return 0;
    }
    if (dir !== this.moving) {
      this.moving = dir;
      this.next = now + REPEAT_FIRST_MS;
      return dir;
    }
    if (now < this.next) return 0;
    this.next = now + REPEAT_EVERY_MS;
    return dir;
  }
}

/** Frames in, events out. A button held as the terminal starts never fires. */
export class PadMachine {
  private held: PadFrame | null = null;
  private readonly upDown = new Axis();
  private readonly across = new Axis();
  private startAt: number | null = null;

  step(f: PadFrame, now: number): PadEvent[] {
    const before = this.held;
    this.held = f;
    if (before === null) return [];
    const out: PadEvent[] = [];
    if (f.a && !before.a) out.push({ t: "select" });
    if (f.b && !before.b) out.push({ t: "back" });
    if (f.y && !before.y) out.push({ t: "give" });
    if (f.start && !before.start) this.startAt = now;
    if (!f.start) this.startAt = null;
    else if (this.startAt !== null && now - this.startAt >= START_HOLD_MS) {
      this.startAt = null;
      out.push({ t: "hold" });
    }
    const dir = this.upDown.step(f.dpad, f.stick, now);
    if (dir !== 0) out.push({ t: "move", dir });
    const side = this.across.step(f.side, f.stickX, now);
    if (side !== 0) out.push({ t: "side", dir: side });
    return out;
  }
}

/** The list index after a move, stopping at both ends. -1 (nothing lit): the end it's coming from. */
export function movedTo(index: number, dir: -1 | 1, count: number): number {
  if (count === 0) return -1;
  if (index < 0) return dir > 0 ? 0 : count - 1;
  return Math.max(0, Math.min(count - 1, index + dir));
}

/** Who has the controller (the virtual keyboard): null, the page's own choices. */
let holder: ((e: PadEvent) => void) | null = null;

/** Take every controller event until the returned release. */
export function grabPad(fn: (e: PadEvent) => void): () => void {
  holder = fn;
  return () => {
    if (holder === fn) holder = null;
  };
}

export function padHolder(): ((e: PadEvent) => void) | null {
  return holder;
}
