//! Controls — pure. Three sources fold into one `MoveInput` per frame:
//!
//! - **Keyboard**: W/S or ↑/↓ walk, A/D strafe, Q/E turn, ←/→ turn (or
//!   strafe, when the device is configured that way), Shift runs.
//! - **Twin on-screen sticks** (`joystick.tsx`): left = move, right = turn
//!   (x) + look (y). Each stick is a knob clamped to its base, with a dead
//!   zone of 0.12 rescaled so the stick still reaches full speed.
//! - **Mouse / finger drag** on the view: look, as direct degrees.
//!
//! Everything here is plain data in, plain data out, so it is tested
//! without a DOM.

import type { MoveInput } from "./physics.ts";

export const DEAD_ZONE = 0.12;
/** Degrees of view per pixel of drag. */
export const DRAG_DEGREES_PER_PX = 0.22;
/** Degrees of view per pixel of mouse movement while the game holds the
 *  mouse (pointer lock, wave 33): a first-person game's feel. */
export const LOCKED_DEGREES_PER_PX = 0.12;

/** A locked mouse's movement as drag pixels (`InputSources.drag` is read
 *  at `DRAG_DEGREES_PER_PX`). */
export function lockedMouseDrag(dx: number, dy: number): [number, number] {
  const k = LOCKED_DEGREES_PER_PX / DRAG_DEGREES_PER_PX;
  return [Number.isFinite(dx) ? dx * k : 0, Number.isFinite(dy) ? dy * k : 0];
}

/** A stick's output: each axis −1…1, `y` + = up / forward. */
export interface StickVector {
  x: number;
  y: number;
}

export const CENTRED: StickVector = Object.freeze({ x: 0, y: 0 });

export interface StickReading {
  /** The knob's offset from the base centre in px (clamped to the radius). */
  knob: [number, number];
  value: StickVector;
}

/**
 * A stick from a pointer's offset `(dx, dy)` in screen px (y down) from the
 * base centre: the knob clamps to `radius`; the value has the dead zone cut
 * out and rescaled (so 0.12 → 0, 1 → 1, linear between).
 */
export function stickVector(dx: number, dy: number, radius: number, deadZone = DEAD_ZONE): StickReading {
  if (!(radius > 0) || !Number.isFinite(dx) || !Number.isFinite(dy)) return { knob: [0, 0], value: { x: 0, y: 0 } };
  const d = Math.hypot(dx, dy);
  const k = d > radius ? radius / d : 1;
  const kx = dx * k;
  const ky = dy * k;
  const m = Math.min(1, d / radius);
  if (m <= deadZone || d === 0) return { knob: [kx, ky], value: { x: 0, y: 0 } };
  const scaled = (m - deadZone) / (1 - deadZone);
  const ux = dx / d;
  const uy = dy / d;
  return { knob: [kx, ky], value: { x: tidy(ux * scaled), y: tidy(-uy * scaled) } };
}

export interface InputSources {
  /** `KeyboardEvent.code`s held down. */
  keys: ReadonlySet<string>;
  left: StickVector;
  right: StickVector;
  /** Drag accumulated since the last frame, px `[dx, dy]` (y down). */
  drag: [number, number];
  /** ←/→ turn (else strafe). */
  arrowsTurn: boolean;
}

const has = (keys: ReadonlySet<string>, ...codes: string[]): boolean => codes.some((c) => keys.has(c));

/** Fold every source into one frame of intent. */
export function combineInput(src: InputSources): MoveInput {
  const k = src.keys;
  const fwd = (has(k, "KeyW", "ArrowUp") ? 1 : 0) - (has(k, "KeyS", "ArrowDown") ? 1 : 0);
  const arrowRight = has(k, "ArrowRight") ? 1 : 0;
  const arrowLeft = has(k, "ArrowLeft") ? 1 : 0;
  let strafe = (has(k, "KeyD") ? 1 : 0) - (has(k, "KeyA") ? 1 : 0);
  let turn = (has(k, "KeyE") ? 1 : 0) - (has(k, "KeyQ") ? 1 : 0);
  if (src.arrowsTurn) turn += arrowRight - arrowLeft;
  else strafe += arrowRight - arrowLeft;

  let mx = clamp1(strafe) + src.left.x;
  let my = fwd + src.left.y;
  const mag = Math.hypot(mx, my);
  if (mag > 1) {
    mx /= mag;
    my /= mag;
  }
  return {
    move: [tidy(mx), tidy(my)],
    turn: tidy(clamp1(clamp1(turn) + response(src.right.x))),
    look: tidy(clamp1(response(src.right.y))),
    run: has(k, "ShiftLeft", "ShiftRight"),
    dragYaw: tidy(src.drag[0] * DRAG_DEGREES_PER_PX),
    dragPitch: tidy(-src.drag[1] * DRAG_DEGREES_PER_PX),
  };
}

/** Is anyone touching anything? (The 120 s no-input leash.) */
export function isActive(input: MoveInput): boolean {
  return input.move[0] !== 0 || input.move[1] !== 0 || input.turn !== 0 || input.look !== 0 || (input.dragYaw ?? 0) !== 0 || (input.dragPitch ?? 0) !== 0;
}

/** The keys this game owns (their browser defaults — scrolling — are suppressed). */
export const GAME_KEYS: ReadonlySet<string> = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
  // Space hits the King (`fight.ts`; the engine reads the key-down edge,
  // not the held set).
  "Space",
]);

/** What the key handlers read off a `KeyboardEvent`. */
export interface KeyLike {
  code: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

const isMeta = (e: KeyLike): boolean => e.key === "Meta" || e.code === "MetaLeft" || e.code === "MetaRight";

/**
 * A key went down: hold it (mutates `keys`). A chord with a modifier is
 * the browser's / the OS's, not a step — and on macOS a key released while
 * ⌘ is held never sends its keyup, so ⌘ drops every held key at once
 * rather than leaving one walking by itself. Returns whether the key is
 * the game's (its default — scrolling — should be suppressed).
 */
export function keyDown(keys: Set<string>, e: KeyLike): boolean {
  if (e.metaKey || isMeta(e)) {
    keys.clear();
    return false;
  }
  if (e.ctrlKey || e.altKey) return false;
  keys.add(e.code);
  return GAME_KEYS.has(e.code);
}

/** A key came up (mutates `keys`); ⌘ coming up drops everything (see `keyDown`). */
export function keyUp(keys: Set<string>, e: KeyLike): void {
  keys.delete(e.code);
  if (isMeta(e)) keys.clear();
}

/** Turning / looking: gentle near the centre, full at the rim. */
export function response(v: number): number {
  return Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), 1.6);
}

function clamp1(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

/** No `-0`, no float dust past 1e-9. */
function tidy(v: number): number {
  return Math.abs(v) < 1e-9 ? 0 : v;
}
