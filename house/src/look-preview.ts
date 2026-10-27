//! What a look looks like, without the bulbs (wave 30): the editor's Cue
//! designer draws each fixture a look reaches as a lamp and plays the look
//! on screen before anyone sends it to the house. `previewAt` replays the
//! look's plan (`planLook`: safety-clamped, the fixture's caps applied, the
//! repeats and the loop) up to a moment, fading each value over the
//! command's `transition` the way a bulb does, and gives the light back at a
//! `then: "restore"` look's period.
//!
//! It is an approximation and says so: a Zigbee bulb's own fade curve, the
//! firmware effects (`blink`, `breathe`, `okay`, `channel_change`) and how
//! fast a bulb really answers are drawn roughly. Timing, colours,
//! brightness, the safety floor and the repeats are exact. Pure, no `node:`
//! imports.

import type { LightCommand, LightEffect, LightPlan, LightState } from "./lights.ts";

/** One fixture as the preview draws it. */
export interface LampShown {
  /** 0–254 as it would read now (0 is dark, whatever `state` says). */
  brightness: number;
  /** The colour it shows at full brightness, `#rrggbb`. */
  color: string;
  /** A firmware effect running now (drawn roughly). */
  effect: LightEffect | null;
}

/** Where every fixture starts (and a `restore` look returns to): a dim warm white. */
export const LAMP_SETTLED: LampShown = { brightness: 90, color: "#ffd9a8", effect: null };

/** How long the preview draws each firmware effect (ms). */
export const LAMP_EFFECT_MS: Record<LightEffect, number> = { blink: 1000, breathe: 15_000, okay: 1500, channel_change: 1500, finish_effect: 0, stop_effect: 0 };

/** How far the preview replays a loop: the last two passes are enough (each pass ends where the steps leave it). */
const LOOP_PASSES = 2;
/** The fade a restore uses (ms). */
const RESTORE_FADE_MS = 1000;

const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
const hex2 = (n: number): string => clampByte(n).toString(16).padStart(2, "0");

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/iu.exec(hex.trim());
  if (m === null) return [255, 255, 255];
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** A white at a colour temperature (mireds 150–500) as RGB, after Tanner Helland's fit. */
export function miredsToHex(mireds: number): string {
  const k = Math.max(1000, Math.min(40000, 1_000_000 / Math.max(1, mireds))) / 100;
  const r = k <= 66 ? 255 : 329.698727446 * Math.pow(k - 60, -0.1332047592);
  const g = k <= 66 ? 99.4708025861 * Math.log(k) - 161.1195681661 : 288.1221695283 * Math.pow(k - 60, -0.0755148492);
  const b = k >= 66 ? 255 : k <= 19 ? 0 : 138.5177312231 * Math.log(k - 10) - 305.0447927307;
  return rgbToHex([r, g, b]);
}

function mix(a: string, b: string, f: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * f, x[1] + (y[1] - x[1]) * f, x[2] + (y[2] - x[2]) * f]);
}

/** One value fading from `from` (at `start`) to `to` over `ms`. */
interface Fade<T> {
  from: T;
  to: T;
  start: number;
  ms: number;
}

interface Lamp {
  bri: Fade<number>;
  color: Fade<string>;
  /** The brightness asked for while ON (an OFF fades to 0 and an ON comes back to it). */
  level: number;
  on: boolean;
  effect: { kind: LightEffect; start: number } | null;
}

function progress(f: Fade<unknown>, t: number): number {
  if (f.ms <= 0 || t >= f.start + f.ms) return 1;
  if (t <= f.start) return 0;
  return (t - f.start) / f.ms;
}

const briAt = (f: Fade<number>, t: number): number => f.from + (f.to - f.from) * progress(f, t);
const colorAt = (f: Fade<string>, t: number): string => mix(f.from, f.to, progress(f, t));

function lampOf(s: LampShown): Lamp {
  return { bri: { from: s.brightness, to: s.brightness, start: 0, ms: 0 }, color: { from: s.color, to: s.color, start: 0, ms: 0 }, level: s.brightness > 0 ? s.brightness : 254, on: s.brightness > 0, effect: s.effect !== null ? { kind: s.effect, start: 0 } : null };
}

/** Apply one command at `at` (its fade starts from wherever the lamp is then). */
function apply(l: Lamp, set: LightState, at: number): void {
  const ms = Math.max(0, (set.transition ?? 0) * 1000);
  if (set.color !== undefined || set.color_temp !== undefined) {
    const to = set.color !== undefined ? set.color : miredsToHex(set.color_temp!);
    l.color = { from: colorAt(l.color, at), to, start: at, ms };
  }
  if (set.brightness !== undefined) l.level = set.brightness;
  if (set.state === "OFF") l.on = false;
  else if (set.state === "ON" || set.brightness !== undefined) l.on = true;
  const target = l.on ? l.level : 0;
  if (set.state !== undefined || set.brightness !== undefined) l.bri = { from: briAt(l.bri, at), to: target, start: at, ms };
  if (set.effect === "stop_effect" || set.effect === "finish_effect") l.effect = null;
  else if (set.effect !== undefined) l.effect = { kind: set.effect, start: at };
}

/** The firmware effect drawn over the lamp's own value. */
function withEffect(shown: LampShown, e: Lamp["effect"], t: number): LampShown {
  if (e === null) return shown;
  const age = t - e.start;
  if (age < 0 || age >= LAMP_EFFECT_MS[e.kind]) return { ...shown, effect: null };
  switch (e.kind) {
    case "blink":
      return { ...shown, brightness: age < 500 ? 0 : shown.brightness, effect: "blink" };
    case "breathe":
      return { ...shown, brightness: Math.round(shown.brightness * (0.55 + 0.45 * Math.cos((age / 2000) * Math.PI * 2))), effect: "breathe" };
    case "okay":
      return { brightness: Math.floor(age / 375) % 2 === 0 ? 254 : 0, color: "#00ff00", effect: "okay" };
    case "channel_change":
      return { brightness: age < 750 ? 254 : 0, color: "#ff8c00", effect: "channel_change" };
    default:
      return shown;
  }
}

/** The commands of every pass that has started by `t` (only the last few of a loop). */
function passes(plan: LightPlan, t: number): Array<{ at: number; c: LightCommand }> {
  const period = Math.max(1, plan.period ?? 1);
  const times = plan.loop ? Infinity : Math.max(1, plan.repeat);
  const repeating = plan.loop || plan.repeat > 1;
  const last = repeating ? Math.min(times - 1, Math.floor(Math.max(0, t) / period)) : 0;
  const first = plan.loop ? Math.max(0, last - (LOOP_PASSES - 1)) : 0;
  const out: Array<{ at: number; c: LightCommand }> = [];
  for (let k = first; k <= last; k++) for (const c of plan.commands) out.push({ at: k * (repeating ? period : 0) + c.at, c });
  return out;
}

/**
 * Every fixture of `fixtures` at `t` ms after the look started. A fixture
 * the look never commands keeps its `start` (default `LAMP_SETTLED`). A
 * `restore` plan fades each fixture back to its start at `period`.
 */
export function previewAt(plan: LightPlan, fixtures: readonly string[], t: number, start: Readonly<Record<string, LampShown>> = {}): Record<string, LampShown> {
  const lamps = new Map(fixtures.map((id) => [id, lampOf(start[id] ?? LAMP_SETTLED)]));
  for (const { at, c } of passes(plan, t)) {
    if (at > t) break;
    const l = lamps.get(c.fixture);
    if (l !== undefined) apply(l, c.set, at);
  }
  if (plan.restore && plan.period !== null && t >= plan.period) {
    for (const [id, l] of lamps) {
      const back = start[id] ?? LAMP_SETTLED;
      const at = plan.period;
      l.color = { from: colorAt(l.color, at), to: back.color, start: at, ms: RESTORE_FADE_MS };
      l.bri = { from: briAt(l.bri, at), to: back.brightness, start: at, ms: RESTORE_FADE_MS };
      l.effect = null;
    }
  }
  const out: Record<string, LampShown> = {};
  for (const [id, l] of lamps) out[id] = withEffect({ brightness: Math.round(briAt(l.bri, t)), color: colorAt(l.color, t), effect: null }, l.effect, t);
  return out;
}

/**
 * How long the preview should run before it stops (ms): the last command's
 * fade (and a restore's) finished, every repeat played. A loop runs until
 * stopped: `null`.
 */
export function previewLength(plan: LightPlan): number | null {
  if (plan.loop) return null;
  const fadeEnd = plan.commands.reduce((m, c) => Math.max(m, c.at + (c.set.transition ?? 0) * 1000 + (c.set.effect !== undefined ? LAMP_EFFECT_MS[c.set.effect] : 0)), 0);
  const passesMs = plan.repeat > 1 ? (plan.repeat - 1) * (plan.period ?? 0) : 0;
  const restoreEnd = plan.restore && plan.period !== null ? plan.period + RESTORE_FADE_MS : 0;
  return Math.max(passesMs + fadeEnd, restoreEnd);
}

/** A lamp as CSS: its colour dimmed by its brightness (never quite black: a lamp you can still see on screen). */
export function lampCss(l: LampShown): string {
  const f = 0.08 + 0.92 * Math.max(0, Math.min(254, l.brightness)) / 254;
  const [r, g, b] = hexToRgb(l.color);
  return rgbToHex([r * f, g * f, b * f]);
}
