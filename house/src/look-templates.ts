//! Ready-made looks (wave 30): the editor's Cue designer starts a lighting
//! animation from one of these and the author tunes it from there. Every
//! template writes a look `validateLights` accepts for any fixture kind:
//! steps on one fixture at least `LIGHT_STEP_MIN_MS` apart (a colour change
//! `LIGHT_COLOR_STEP_MIN_MS`), and a repeating look on Zigbee no faster than
//! `LIGHT_LOOP_MIN_PERIOD_MS` (anything quicker reads as flicker over Zigbee;
//! WLED could go faster, but one template must suit both). Colours change
//! only on a step that has room for it; the rest move brightness. Pure.

import { LIGHT_COLOR_STEP_MIN_MS, LIGHT_LOOP_MIN_PERIOD_MS, LIGHT_STEP_MIN_MS, resolveLightTargets, safetyMin, type LightLook, type LightState, type LightStep, type LightsConfig } from "./lights.ts";
import type { HouseMap } from "./types.ts";

export const LOOK_TEMPLATES = ["fade", "pulse", "heartbeat", "flash", "flicker", "cycle", "alarm", "work", "blackout"] as const;
export type LookTemplate = (typeof LOOK_TEMPLATES)[number];

export interface LookTemplateInfo {
  id: LookTemplate;
  label: string;
  /** One line for the picker. */
  blurb: string;
  /** Which knobs mean something: a second colour, a speed. */
  color2: boolean;
  speed: boolean;
}

export const LOOK_TEMPLATE_INFO: Record<LookTemplate, LookTemplateInfo> = {
  fade: { id: "fade", label: "Fade to a colour", blurb: "One smooth change, then it stays.", color2: false, speed: true },
  pulse: { id: "pulse", label: "Pulse", blurb: "Swells bright and dim, over and over.", color2: false, speed: true },
  heartbeat: { id: "heartbeat", label: "Heartbeat", blurb: "Thump-thump… thump-thump, until the next look.", color2: false, speed: true },
  flash: { id: "flash", label: "Flash, then give it back", blurb: "Three hard flashes, then the light it was showing comes back.", color2: false, speed: false },
  flicker: { id: "flicker", label: "Flicker, then give it back", blurb: "A failing bulb for a couple of seconds, then back to normal.", color2: false, speed: false },
  cycle: { id: "cycle", label: "Colour cycle", blurb: "Drifts between two colours, until the next look.", color2: true, speed: true },
  alarm: { id: "alarm", label: "Alarm", blurb: "Hard on-off, as fast as Zigbee bulbs take, until the next look.", color2: false, speed: false },
  work: { id: "work", label: "Work light", blurb: "Plain bright white, for setting up.", color2: false, speed: false },
  blackout: { id: "blackout", label: "Blackout", blurb: "Off (a safety light stays at its floor).", color2: false, speed: true },
};

export interface LookTemplateOptions {
  to: string[];
  /** `#rrggbb` (default a cold cyan). */
  color?: string;
  /** The cycle's other colour. */
  color2?: string;
  /** 0.5 (slow) … 2 (fast); 1 is the template's own pace. */
  speed?: number;
  /** The highest safety floor among the fixtures `to` reaches (`lookFloor`):
   *  no step dims below it, and a blackout holds it instead of OFF. */
  floor?: number;
}

/** The highest safety floor (`safetyMin`) among the fixtures `to` reaches; 0 when none is a safety light. */
export function lookFloor(lights: LightsConfig, house: HouseMap | null | undefined, to: readonly string[]): number {
  const hit = new Set(resolveLightTargets(lights, house, to).fixtures);
  return lights.fixtures.filter((f) => hit.has(f.id) && f.safety === true).reduce((m, f) => Math.max(m, safetyMin(f)), 0);
}

const DEFAULT_COLOR = "#00e5ff";
const DEFAULT_COLOR2 = "#ff2a00";

/** A time scaled by speed, rounded to 50 ms, never under `min`. */
function ms(base: number, speed: number, min = 0): number {
  return Math.max(min, Math.round(base / speed / 50) * 50);
}

const secs = (n: number): number => Math.round(n / 100) / 10;

/** A new look from a template. */
export function lookFromTemplate(t: LookTemplate, o: LookTemplateOptions): LightLook {
  const to = [...new Set(o.to)];
  const c = o.color ?? DEFAULT_COLOR;
  const c2 = o.color2 ?? DEFAULT_COLOR2;
  const speed = Math.max(0.5, Math.min(2, o.speed ?? 1));
  const note = LOOK_TEMPLATE_INFO[t].label;
  const floor = Math.max(0, Math.min(254, Math.round(o.floor ?? 0)));
  const look = template(t, to, c, c2, speed, note, floor);
  // Lift every dim step to the floor (a safety light never goes below it).
  const lift = (set: LightState): LightState => (set.brightness !== undefined && set.brightness < floor ? { ...set, brightness: floor } : set);
  if (look.set !== undefined) look.set = lift(look.set);
  if (look.steps !== undefined) look.steps = look.steps.map((s) => ({ ...s, set: lift(s.set) }));
  return look;
}

function template(t: LookTemplate, to: string[], c: string, c2: string, speed: number, note: string, floor: number): LightLook {
  switch (t) {
    case "fade": {
      const fade = ms(3000, speed, 0);
      return { to, set: { state: "ON", color: c, brightness: 254, transition: secs(fade) }, note };
    }
    case "pulse": {
      // Half a period each way, both brightness only after the first colour.
      const period = ms(3000, speed, LIGHT_LOOP_MIN_PERIOD_MS);
      const half = Math.round(period / 2 / 50) * 50;
      return {
        to,
        steps: [
          { at: 0, set: { state: "ON", color: c, brightness: 254, transition: secs(half) } },
          { at: half, set: { brightness: 50, transition: secs(half) } },
        ],
        loop: true,
        period,
        note,
      };
    }
    case "heartbeat": {
      const beat = ms(200, speed, LIGHT_STEP_MIN_MS);
      const period = ms(1600, speed, LIGHT_LOOP_MIN_PERIOD_MS);
      const steps: LightStep[] = [
        { at: 0, set: { state: "ON", color: c, brightness: 254, transition: 0 } },
        { at: beat, set: { brightness: 60, transition: secs(beat) } },
        { at: beat * 2, set: { brightness: 254, transition: 0 } },
        { at: beat * 3, set: { brightness: 40, transition: secs(beat * 2) } },
      ];
      // The colour step at the wrap needs its 400 ms after the last one.
      return { to, steps, loop: true, period: Math.max(period, beat * 3 + LIGHT_COLOR_STEP_MIN_MS), note };
    }
    case "flash": {
      const steps: LightStep[] = [{ at: 0, set: { state: "ON", color: c, brightness: 254, transition: 0 } }];
      for (let i = 1; i < 6; i++) steps.push({ at: i * 300, set: { brightness: i % 2 === 1 ? 10 : 254, transition: 0 } });
      return { to, steps, then: "restore", period: 5 * 300 + LIGHT_COLOR_STEP_MIN_MS, note };
    }
    case "flicker": {
      // A fixed, irregular pattern (the same every time: rehearsals match the night).
      const pattern: Array<[number, number]> = [
        [0, 254],
        [180, 40],
        [350, 220],
        [550, 15],
        [700, 254],
        [1100, 70],
        [1250, 254],
        [1700, 30],
        [1900, 200],
        [2300, 254],
      ];
      return { to, steps: pattern.map(([at, b]) => ({ at, set: { state: "ON" as const, brightness: b, transition: 0 } })), then: "restore", period: 2300 + LIGHT_COLOR_STEP_MIN_MS, note };
    }
    case "cycle": {
      const hold = ms(4000, speed, LIGHT_LOOP_MIN_PERIOD_MS / 2);
      const fade = secs(hold * 0.8);
      return {
        to,
        steps: [
          { at: 0, set: { state: "ON", color: c, brightness: 254, transition: fade } },
          { at: hold, set: { color: c2, transition: fade } },
        ],
        loop: true,
        period: hold * 2,
        note,
      };
    }
    case "alarm": {
      const half = LIGHT_LOOP_MIN_PERIOD_MS / 2;
      return {
        to,
        steps: [
          { at: 0, set: { state: "ON", color: c === DEFAULT_COLOR ? "#ff0000" : c, brightness: 254, transition: 0 } },
          { at: half, set: { brightness: 20, transition: 0 } },
        ],
        loop: true,
        period: LIGHT_LOOP_MIN_PERIOD_MS,
        note,
      };
    }
    case "work":
      return { to, set: { state: "ON", color_temp: 250, brightness: 254, transition: 1 }, note };
    case "blackout":
      // A safety light can't go OFF: it holds its floor.
      return { to, set: floor > 0 ? { state: "ON", brightness: floor, transition: secs(ms(1000, speed, 0)) } : { state: "OFF", transition: secs(ms(1000, speed, 0)) }, note };
  }
}
