import { describe, expect, it } from "vitest";
import { CENTRED, combineInput, DEAD_ZONE, DRAG_DEGREES_PER_PX, GAME_KEYS, isActive, keyDown, keyUp, response, stickVector, type InputSources, type KeyLike } from "../src/game/input.ts";

const src = (over: Partial<InputSources> = {}): InputSources => ({ keys: new Set(), left: CENTRED, right: CENTRED, drag: [0, 0], arrowsTurn: true, ...over });
const keys = (...codes: string[]) => src({ keys: new Set(codes) });

describe("stickVector — the on-screen stick's maths", () => {
  it("is centred inside the dead zone (0.12 of the radius)", () => {
    expect(DEAD_ZONE).toBe(0.12);
    const r = stickVector(5, -5, 100); // 7 px of 100
    expect(r.value).toEqual({ x: 0, y: 0 });
    expect(r.knob).toEqual([5, -5]);
  });

  it("rescales past the dead zone so the rim is still full speed", () => {
    expect(stickVector(0, -100, 100).value).toEqual({ x: 0, y: 1 }); // up = forward
    expect(stickVector(100, 0, 100).value.x).toBeCloseTo(1);
    const mid = stickVector(0, 56, 100).value; // half-way down
    expect(mid.y).toBeCloseTo(-(0.56 - DEAD_ZONE) / (1 - DEAD_ZONE));
  });

  it("clamps the knob to the base and the value to the unit disc", () => {
    const r = stickVector(300, 400, 50);
    expect(Math.hypot(...r.knob)).toBeCloseTo(50);
    expect(r.knob[0] / r.knob[1]).toBeCloseTo(0.75);
    expect(Math.hypot(r.value.x, r.value.y)).toBeCloseTo(1);
  });

  it("is inert on nonsense", () => {
    expect(stickVector(Number.NaN, 0, 50).value).toEqual({ x: 0, y: 0 });
    expect(stickVector(10, 0, 0).value).toEqual({ x: 0, y: 0 });
  });
});

describe("combineInput", () => {
  it("WASD / ↑↓ walk and strafe", () => {
    expect(combineInput(keys("KeyW")).move).toEqual([0, 1]);
    expect(combineInput(keys("ArrowDown")).move).toEqual([0, -1]);
    expect(combineInput(keys("KeyD")).move).toEqual([1, 0]);
    const diag = combineInput(keys("KeyW", "KeyA")).move;
    expect(Math.hypot(diag[0], diag[1])).toBeCloseTo(1); // no faster diagonally
    expect(diag[0]).toBeLessThan(0);
  });

  it("Q/E turn (E = right); ←/→ turn or strafe as configured", () => {
    expect(combineInput(keys("KeyE")).turn).toBe(1);
    expect(combineInput(keys("KeyQ")).turn).toBe(-1);
    expect(combineInput(keys("ArrowLeft")).turn).toBe(-1);
    const strafe = combineInput({ ...keys("ArrowRight"), arrowsTurn: false });
    expect(strafe.turn).toBe(0);
    expect(strafe.move).toEqual([1, 0]);
    expect(combineInput(keys("KeyE", "ArrowRight")).turn).toBe(1); // clamped
  });

  it("Shift runs", () => {
    expect(combineInput(keys("ShiftLeft", "KeyW")).run).toBe(true);
    expect(combineInput(keys("KeyW")).run).toBe(false);
  });

  it("the left stick moves, the right turns (x) and looks (y)", () => {
    const m = combineInput(src({ left: { x: 0.5, y: 0.5 }, right: { x: 1, y: -1 } }));
    expect(m.move).toEqual([0.5, 0.5]);
    expect(m.turn).toBe(1);
    expect(m.look).toBe(-1);
    // Gentle near the centre: half a stick is well under half a turn.
    expect(combineInput(src({ right: { x: 0.5, y: 0 } })).turn).toBeCloseTo(response(0.5));
    expect(response(0.5)).toBeLessThan(0.5);
  });

  it("keys and the stick add, and stay inside the unit disc", () => {
    const m = combineInput({ ...src({ left: { x: 0, y: 1 } }), keys: new Set(["KeyW", "KeyD"]) });
    expect(Math.hypot(m.move[0], m.move[1])).toBeCloseTo(1);
  });

  it("a drag looks: + x turns right, + y (down the screen) looks down", () => {
    const m = combineInput(src({ drag: [10, 20] }));
    expect(m.dragYaw).toBeCloseTo(10 * DRAG_DEGREES_PER_PX);
    expect(m.dragPitch).toBeCloseTo(-20 * DRAG_DEGREES_PER_PX);
  });

  it("isActive: anything but Shift alone counts as input", () => {
    expect(isActive(combineInput(src()))).toBe(false);
    expect(isActive(combineInput(keys("ShiftLeft")))).toBe(false);
    expect(isActive(combineInput(keys("KeyQ")))).toBe(true);
    expect(isActive(combineInput(src({ drag: [1, 0] })))).toBe(true);
    expect(isActive(combineInput(src({ left: { x: 0, y: 0.2 } })))).toBe(true);
  });

  it("never emits −0", () => {
    const m = combineInput(src({ drag: [-0, -0] }));
    expect(Object.is(m.dragYaw, -0)).toBe(false);
    expect(Object.is(m.move[0], -0)).toBe(false);
  });
});

describe("keyDown / keyUp — the held-key set", () => {
  const ev = (code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ code, key: code.replace(/^Key/, "").toLowerCase(), metaKey: false, ctrlKey: false, altKey: false, ...mods });
  const meta = (mods: Partial<KeyLike> = {}): KeyLike => ev("MetaLeft", { key: "Meta", metaKey: true, ...mods });

  it("holds game keys until they come up", () => {
    const keys = new Set<string>();
    expect(keyDown(keys, ev("KeyW"))).toBe(true);
    expect(keyDown(keys, ev("KeyZ"))).toBe(false);
    expect(keys.has("KeyW")).toBe(true);
    keyUp(keys, ev("KeyW"));
    expect(keys.has("KeyW")).toBe(false);
  });

  it("⌘ pressed mid-walk drops the walk (macOS never sends the keyup under ⌘)", () => {
    const keys = new Set<string>();
    keyDown(keys, ev("KeyW"));
    keyDown(keys, meta()); // ⌘ down
    // W released while ⌘ is held: no keyup arrives. ⌘ comes up:
    keyUp(keys, meta({ metaKey: false }));
    expect(keys.size).toBe(0);
    expect(isActive(combineInput(src({ keys })))).toBe(false);
  });

  it("a ⌘ / Ctrl / Alt chord is never a step", () => {
    const keys = new Set<string>();
    keyDown(keys, ev("KeyS", { metaKey: true }));
    keyDown(keys, ev("KeyD", { ctrlKey: true }));
    keyDown(keys, ev("KeyA", { altKey: true }));
    expect(keys.size).toBe(0);
  });
});

describe("the King's keys", () => {
  it("KeyC and Space are game keys (their defaults are suppressed) and never move the body", () => {
    expect(GAME_KEYS.has("Space")).toBe(true);
    expect(GAME_KEYS.has("KeyC")).toBe(true);
    const held = new Set<string>();
    const key = (code: string): KeyLike => ({ code, key: code, metaKey: false, ctrlKey: false, altKey: false });
    expect(keyDown(held, key("KeyC"))).toBe(true);
    expect(keyDown(held, key("Space"))).toBe(true);
    const input = combineInput(src({ keys: held }));
    expect(input.move).toEqual([0, 0]);
    expect(input.turn).toBe(0);
    expect(isActive(input)).toBe(false);
  });
});
