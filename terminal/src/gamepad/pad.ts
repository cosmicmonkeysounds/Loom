//! The GameCube controller (wave 52), through a Mayflash adapter in PC mode.
//! Pure: `frameOf` reads the Gamepad API's raw pads, and `PadMachine` turns
//! frames into what the terminal does. `PadNav.tsx` is the loop around them.
//!
//! The adapter shows Chrome four pads, one per port, with no standard mapping,
//! so a controller can sit in any port. Measured on the real adapter
//! (2026-10-30): the indices in `GC`, the D-pad also on a hat axis (9), L and
//! R also on axes 3 and 4, and both sticks at rest at 0 on an empty port.
//!
//! - **Left stick, D-pad:** up and down the choices, with key repeat.
//! - **C stick:** scrolls the conversation, faster the further it's pushed.
//! - **Start:** back to the latest line.
//! - **A:** the lit choice.
//! - **B:** back, out of the voice prompt, then out of talking freely.
//!
//! Nothing here can leave the terminal: B only steps back inside a talk, X, Y,
//! Z, L and R do nothing, and neither DISCONNECT nor ⚙ takes the pad's focus.

export const GC = { a: 1, b: 2, start: 9, up: 12, right: 13, down: 14, left: 15, stickX: 0, stickY: 1, cY: 2, cX: 5 } as const;

/** The stick counts as pushed past this, and as let go under `STICK_OFF`. */
export const STICK_ON = 0.6;
export const STICK_OFF = 0.35;
/** The C stick does nothing inside this. */
export const SCROLL_DEAD = 0.25;
/** The C stick all the way over (px a second). */
export const SCROLL_MAX = 1200;
/** Held up or down: the first repeat, then each one after (ms). */
export const REPEAT_FIRST_MS = 380;
export const REPEAT_EVERY_MS = 170;

export interface RawPad {
  id: string;
  buttons: ReadonlyArray<{ pressed: boolean }>;
  axes: readonly number[];
}

/** Every controller on the adapter, merged: one frame of what's held. */
export interface PadFrame {
  a: boolean;
  b: boolean;
  start: boolean;
  /** The D-pad: -1 up, 1 down, 0 neither. */
  dpad: -1 | 0 | 1;
  /** The left stick's up-down, -1 (up) to 1. */
  stick: number;
  /** The C stick's up-down, -1 (up) to 1. */
  scroll: number;
}

export const NO_PAD: PadFrame = { a: false, b: false, start: false, dpad: 0, stick: 0, scroll: 0 };

/** The Mayflash adapter's id: `MAYFLASH GameCube Controller Adapter (Vendor: 0079 Product: 1844)`. */
export function isGameCube(id: string): boolean {
  return /gamecube|vendor: 0079 product: 1844/iu.test(id);
}

/** The value further from rest. */
function strongest(a: number, b: number): number {
  return Math.abs(b) > Math.abs(a) ? b : a;
}

export function frameOf(pads: ReadonlyArray<RawPad | null>): PadFrame {
  const out: { a: boolean; b: boolean; start: boolean; dpad: -1 | 0 | 1; stick: number; scroll: number } = { ...NO_PAD };
  for (const p of pads) {
    if (p === null || !isGameCube(p.id)) continue;
    const held = (i: number) => p.buttons[i]?.pressed === true;
    out.a = out.a || held(GC.a);
    out.b = out.b || held(GC.b);
    out.start = out.start || held(GC.start);
    if (held(GC.up)) out.dpad = -1;
    else if (held(GC.down)) out.dpad = 1;
    out.stick = strongest(out.stick, p.axes[GC.stickY] ?? 0);
    out.scroll = strongest(out.scroll, p.axes[GC.cY] ?? 0);
  }
  return out;
}

export type PadEvent = { t: "move"; dir: -1 | 1 } | { t: "scroll"; px: number } | { t: "select" } | { t: "back" } | { t: "latest" };

/** Frames in, events out. A button held as the terminal starts never fires. */
export class PadMachine {
  private held: PadFrame | null = null;
  private last = 0;
  private stickDir: -1 | 0 | 1 = 0;
  private moving: -1 | 0 | 1 = 0;
  private nextMove = 0;

  step(f: PadFrame, now: number): PadEvent[] {
    const before = this.held;
    const dt = before === null ? 0 : Math.min(50, now - this.last);
    this.held = f;
    this.last = now;
    if (before === null) return [];
    const out: PadEvent[] = [];
    if (f.a && !before.a) out.push({ t: "select" });
    if (f.b && !before.b) out.push({ t: "back" });
    if (f.start && !before.start) out.push({ t: "latest" });

    const mag = Math.abs(f.stick);
    if (mag >= STICK_ON) this.stickDir = f.stick < 0 ? -1 : 1;
    else if (mag < STICK_OFF) this.stickDir = 0;
    const dir = f.dpad !== 0 ? f.dpad : this.stickDir;
    if (dir === 0) this.moving = 0;
    else if (dir !== this.moving) {
      this.moving = dir;
      this.nextMove = now + REPEAT_FIRST_MS;
      out.push({ t: "move", dir });
    } else if (now >= this.nextMove) {
      this.nextMove = now + REPEAT_EVERY_MS;
      out.push({ t: "move", dir });
    }

    const push = Math.abs(f.scroll);
    if (push > SCROLL_DEAD && dt > 0) {
      const t = (Math.min(push, 1) - SCROLL_DEAD) / (1 - SCROLL_DEAD);
      out.push({ t: "scroll", px: Math.sign(f.scroll) * t * t * SCROLL_MAX * (dt / 1000) });
    }
    return out;
  }
}

/** The list index after a move, stopping at both ends. -1 (nothing lit): the end it's coming from. */
export function movedTo(index: number, dir: -1 | 1, count: number): number {
  if (count === 0) return -1;
  if (index < 0) return dir > 0 ? 0 : count - 1;
  return Math.max(0, Math.min(count - 1, index + dir));
}
