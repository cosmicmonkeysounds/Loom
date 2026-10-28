//! Editing `lights.json` looks (wave 30, moved from the map editor's
//! `reinstall/web/src/map/lights.ts` so the editor's Cue designer shares it):
//! pure ops that take a config and return a changed copy (the same object
//! when nothing changed). Names, targets, steps with Zigbee-safe spacing
//! (`LIGHT_STEP_MIN_MS`, `LIGHT_COLOR_STEP_MIN_MS`), how a look ends (once /
//! a few times / loop / give the light back) with a period that always wraps
//! safely, the boot look, the validation lines about one look, and which
//! looks the story cues. Pure, no `node:` imports.

import { cloneData } from "./clone.ts";
import {
  LIGHT_COLOR_STEP_MIN_MS,
  LIGHT_LOOP_MIN_PERIOD_MS,
  LIGHT_MAX_REPEAT,
  LIGHT_MAX_STEPS,
  LIGHT_RESTORE_MS,
  LIGHT_STEP_MIN_MS,
  isLightLookName,
  resolveLightTargets,
  type LightLook,
  type LightState,
  type LightStep,
  type LightsConfig,
} from "./lights.ts";

const clone = (l: LightsConfig): LightsConfig => cloneData(l);

/** Every name a look and its steps target. */
export function lookTargets(look: LightLook): string[] {
  return [...new Set([...(Array.isArray(look.to) ? look.to : []), ...stepsOfLook(look).flatMap((s) => (Array.isArray(s.to) ? s.to : []))])];
}

/** A look's steps (`set` is one step at 0). */
export function stepsOfLook(look: LightLook): LightStep[] {
  if (Array.isArray(look.steps)) return look.steps;
  if (look.set !== undefined) return [{ at: 0, set: look.set }];
  return [];
}

/** A look written the short way when it can be: one step at 0 for the
 *  look's own targets is `set`; anything else is `steps` (sorted by `at`). */
function canonical(look: LightLook, steps: LightStep[]): LightLook {
  const out: LightLook = { ...look };
  delete out.set;
  delete out.steps;
  const sorted = [...steps].sort((a, b) => a.at - b.at);
  if (sorted.length === 1 && sorted[0]!.at === 0 && sorted[0]!.to === undefined) out.set = sorted[0]!.set;
  else out.steps = sorted;
  return out;
}

/** Why `name` can't be a new look (null: it can). */
export function lookNameError(lights: LightsConfig, name: string, self?: string): string | null {
  if (name === "") return "a look needs a name (the story's cue name)";
  if (!isLightLookName(name)) return /^[a-z][a-z0-9_]*$/.test(name) ? (name.startsWith("music_") ? `“${name}”: music_ cues are the soundtrack's` : `“${name}”: screens_ / terminals_ / tv_ / tablet_ / room_ cues are the screens'`) : `“${name}”: lower-case letters, digits and "_", starting with a letter`;
  if (name !== self && Object.prototype.hasOwnProperty.call(lights.looks, name)) return `“${name}” is already a look`;
  return null;
}

/** A typed name as a look name: "Heart Wake!" → `heart_wake`. */
export function lookNameOf(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+|_+$/g, "");
}

/** A new look: one `ON` step at full brightness for `to`. */
export function addLook(lights: LightsConfig, name: string, to: readonly string[]): { lights: LightsConfig; name: string } | { error: string } {
  const err = lookNameError(lights, name);
  if (err !== null) return { error: err };
  const next = clone(lights);
  next.looks[name] = { to: [...new Set(to)], set: { state: "ON", brightness: 254, transition: 1 } };
  return { lights: next, name };
}

function withLook(lights: LightsConfig, name: string, f: (look: LightLook) => LightLook): LightsConfig {
  const look = lights.looks[name];
  if (look === undefined) return lights;
  const out = f(cloneData(look));
  if (JSON.stringify(out) === JSON.stringify(look)) return lights;
  const next = clone(lights);
  next.looks[name] = out;
  return next;
}

/** Rename a look (the boot look follows). The story's `cue X` must follow too. */
export function renameLook(lights: LightsConfig, from: string, to: string): LightsConfig {
  if (from === to || lights.looks[from] === undefined || lookNameError(lights, to, from) !== null) return lights;
  const next = clone(lights);
  const looks: Record<string, LightLook> = {};
  for (const [k, v] of Object.entries(next.looks)) looks[k === from ? to : k] = v;
  next.looks = looks;
  if (next.boot === from) next.boot = to;
  return next;
}

export function removeLook(lights: LightsConfig, name: string): LightsConfig {
  if (lights.looks[name] === undefined) return lights;
  const next = clone(lights);
  delete next.looks[name];
  if (next.boot === name) delete next.boot;
  return next;
}

/** Copy a look under a new name. */
export function duplicateLook(lights: LightsConfig, from: string): { lights: LightsConfig; name: string } | null {
  const look = lights.looks[from];
  if (look === undefined) return null;
  let i = 2;
  while (Object.prototype.hasOwnProperty.call(lights.looks, `${from}_${i}`)) i++;
  const name = `${from}_${i}`;
  const next = clone(lights);
  next.looks[name] = cloneData(look);
  return { lights: next, name };
}

export function setLookTargets(lights: LightsConfig, name: string, to: readonly string[]): LightsConfig {
  return withLook(lights, name, (look) => ({ ...look, to: [...new Set(to.map((t) => t.trim()).filter((t) => t !== ""))] }));
}

export function setLookNote(lights: LightsConfig, name: string, note: string): LightsConfig {
  return withLook(lights, name, (look) => {
    const out = { ...look };
    if (note.trim() === "") delete out.note;
    else out.note = note;
    return out;
  });
}

/** One state field set, or (null) dropped. `color` and `color_temp` replace each other. */
export type StatePatch = { [K in keyof LightState]?: LightState[K] | null };

export function patchState(s: LightState, patch: StatePatch): LightState {
  const out: LightState = { ...s };
  for (const [k, v] of Object.entries(patch) as [keyof LightState, unknown][]) {
    if (v === null || v === undefined) delete out[k];
    else (out as Record<string, unknown>)[k] = v;
  }
  if (patch.color !== undefined && patch.color !== null) delete out.color_temp;
  if (patch.color_temp !== undefined && patch.color_temp !== null) delete out.color;
  return out;
}

/** Does a step's set change the colour (the 400 ms rule)? */
export const setsColour = (s: LightState): boolean => s.color !== undefined || s.color_temp !== undefined;

/** The earliest `at` step `i` may have after the step before it (Zigbee's spacing). */
export function minStepAt(steps: readonly LightStep[], i: number): number {
  if (i <= 0) return 0;
  const prev = steps[i - 1]!;
  return prev.at + (setsColour(steps[i]!.set) ? LIGHT_COLOR_STEP_MIN_MS : LIGHT_STEP_MIN_MS);
}

/** Change step `i`: its `at` (the steps re-sorted), its state, its own targets (null: the look's). */
export function patchLookStep(lights: LightsConfig, name: string, i: number, patch: { at?: number; set?: StatePatch; to?: string[] | null }): LightsConfig {
  return withLook(lights, name, (look) => {
    const steps = stepsOfLook(look).map((s) => cloneData(s));
    const s = steps[i];
    if (s === undefined) return look;
    if (patch.at !== undefined && Number.isFinite(patch.at)) s.at = Math.max(0, Math.round(patch.at));
    if (patch.set !== undefined) s.set = patchState(s.set, patch.set);
    if (patch.to !== undefined) {
      if (patch.to === null || patch.to.length === 0) delete s.to;
      else s.to = [...new Set(patch.to)];
    }
    return keepPeriod(canonical(look, steps), lights);
  });
}

/** A new step after the last one, far enough for a colour change: a swell
 *  back the other way (bright after dim, dim after bright). */
export function addLookStep(lights: LightsConfig, name: string): LightsConfig {
  return withLook(lights, name, (look) => {
    const steps = stepsOfLook(look).map((s) => cloneData(s));
    if (steps.length >= LIGHT_MAX_STEPS) return look;
    const last = steps[steps.length - 1];
    const at = last === undefined ? 0 : Math.ceil((last.at + LIGHT_COLOR_STEP_MIN_MS) / 100) * 100;
    const was = last === undefined ? undefined : [...steps].reverse().find((s) => s.set.brightness !== undefined)?.set.brightness;
    steps.push({ at, set: { brightness: was !== undefined && was >= 128 ? 60 : 254, transition: 0.5 } });
    // A repeating look's period must stay past the new last step.
    const out = canonical(look, steps);
    if (out.period !== undefined && out.period <= at) out.period = minPeriod(out, lights) ?? at + LIGHT_COLOR_STEP_MIN_MS;
    return keepPeriod(out, lights);
  });
}

/** Drop step `i` (a look keeps at least one). */
export function removeLookStep(lights: LightsConfig, name: string, i: number): LightsConfig {
  return withLook(lights, name, (look) => {
    const steps = stepsOfLook(look);
    if (steps.length <= 1 || i < 0 || i >= steps.length) return look;
    return keepPeriod(canonical(look, steps.filter((_, j) => j !== i).map((s) => cloneData(s))), lights);
  });
}

/** How a look ends: once, a few times, until the next look, or once and then the light is given back. */
export type LookMode = "once" | "repeat" | "loop" | "restore";

export function lookMode(look: LightLook): LookMode {
  if (look.loop === true) return "loop";
  if (look.then === "restore") return "restore";
  if (look.repeat !== undefined && look.repeat > 1) return "repeat";
  return "once";
}

/**
 * The shortest `period` that keeps the Zigbee spacing across the wrap (the
 * repeat's next first step, or the restore), with a loop / repeat that can
 * reach a Zigbee light also held to `LIGHT_LOOP_MIN_PERIOD_MS` (anything
 * faster reads as flicker: `validateLights` warns); a WLED-only look may
 * repeat faster. Without `lights` every look is taken to reach Zigbee.
 * Null for a once-only look (no period needed). Look-wide: the last step
 * and the first, as `validateLights` checks each fixture.
 */
export function minPeriod(look: LightLook, lights?: LightsConfig): number | null {
  const mode = lookMode(look);
  if (mode === "once") return null;
  const steps = stepsOfLook(look);
  if (steps.length === 0) return null;
  const last = Math.max(...steps.map((s) => s.at));
  if (mode === "restore") return last + LIGHT_COLOR_STEP_MIN_MS;
  const first = [...steps].sort((a, b) => a.at - b.at)[0]!;
  // Any fixture's first step may be the colour one (`validateLights` checks each fixture's own).
  const gap = steps.some((s) => s.at === first.at && setsColour(s.set)) ? LIGHT_COLOR_STEP_MIN_MS : LIGHT_STEP_MIN_MS;
  return Math.max(last - first.at + gap, last + 1, lights === undefined || lookMayReachZigbee(lights, look) ? LIGHT_LOOP_MIN_PERIOD_MS : 0);
}

/**
 * Can a look reach a Zigbee bulb or group? Its targets resolved without the
 * map (fixtures, zones, a fixture's room); a name only the map resolves (a
 * LOCATION, a room label) counts as reaching any Zigbee light there is.
 */
export function lookMayReachZigbee(lights: LightsConfig, look: LightLook): boolean {
  const zig = (id: string): boolean => {
    const k = lights.fixtures.find((f) => f.id === id)?.kind;
    return k === "zigbee" || k === "zigbee-group";
  };
  for (const n of lookTargets(look)) {
    const hit = resolveLightTargets(lights, null, [n]).fixtures;
    if (hit.length === 0 ? lights.fixtures.some((f) => zig(f.id)) : hit.some(zig)) return true;
  }
  return false;
}

/** The period the look plays with (its own, else the schema's default). */
export function effectivePeriod(look: LightLook): number {
  const steps = stepsOfLook(look);
  const last = steps.length === 0 ? 0 : Math.max(...steps.map((s) => s.at));
  return look.period ?? last + (look.then === "restore" ? LIGHT_RESTORE_MS : LIGHT_STEP_MIN_MS);
}

/**
 * Set how a look ends. A mode that needs a period gets one when the look
 * has none or one too short to wrap safely (`minPeriod`), so the builder
 * never writes a look the server refuses for its wrap gap.
 */
export function setLookMode(lights: LightsConfig, name: string, mode: LookMode, repeat = 2): LightsConfig {
  return withLook(lights, name, (look) => {
    const out: LightLook = { ...look };
    delete out.loop;
    delete out.repeat;
    delete out.then;
    if (mode === "loop") out.loop = true;
    else if (mode === "repeat") out.repeat = Math.max(2, Math.min(LIGHT_MAX_REPEAT, Math.round(repeat)));
    else if (mode === "restore") out.then = "restore";
    else delete out.period;
    return keepPeriod(out, lights);
  });
}

/**
 * Lengthen a repeating / give-back look's period when it no longer wraps
 * safely (`minPeriod`): after a mode change, and after a step moves, is
 * added or is dropped, so no edit in the builder leaves a period the
 * server refuses.
 */
function keepPeriod(look: LightLook, lights: LightsConfig): LightLook {
  const min = minPeriod(look, lights);
  if (min !== null && (look.period === undefined ? effectivePeriod(look) < min : look.period < min)) return { ...look, period: Math.ceil(min / 100) * 100 };
  return look;
}

/** A look's period (null: the default, last step + 150 ms / + 1 s for a restore). */
export function setLookPeriod(lights: LightsConfig, name: string, period: number | null): LightsConfig {
  return withLook(lights, name, (look) => {
    const out = { ...look };
    if (period === null || !Number.isFinite(period) || period <= 0) delete out.period;
    else out.period = Math.round(period);
    return out;
  });
}

/** The look the module plays on boot and after a story reset (null: none). */
export function setBoot(lights: LightsConfig, name: string | null): LightsConfig {
  if ((lights.boot ?? null) === name || (name !== null && lights.looks[name] === undefined)) return lights;
  const next = clone(lights);
  if (name === null) delete next.boot;
  else next.boot = name;
  return next;
}

/** The validation lines about one look (its builder shows them inline). */
export function lookProblems(lines: readonly string[], name: string): string[] {
  const head = `looks["${name}"]`;
  return lines.filter((l) => l.startsWith(head)).map((l) => l.slice(head.length).replace(/^[.:\s]+/, "").replace(/^steps\[(\d+)\]/, (_, n: string) => `step ${Number(n) + 1}`) || l);
}

/** The story cues that name no look yet, and the looks the story never cues. */
export function lookCoverage(lights: LightsConfig, storyLooks: readonly string[]): { unwritten: string[]; uncued: string[] } {
  const story = new Set(storyLooks);
  const have = new Set(Object.keys(lights.looks));
  return { unwritten: [...story].filter((n) => !have.has(n)).sort(), uncued: [...have].filter((n) => !story.has(n) && n !== lights.boot).sort() };
}
