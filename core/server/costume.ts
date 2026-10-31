//! The costume's server side (wave 59, `src/costume.ts`, `docs/trapped/costume.md`):
//! its `costume.json` read live (`live-file.ts`, like the credits) and the desk
//! that judges a press and runs what comes after one: a lights item's restore,
//! a hand scene's return, the rest of an ad storm.
//!
//! Its power is narrow on purpose. `POST /api/costume/menu` and `/fire` take the
//! token and nothing else does; it is no session, so it opens no other route.
//! The kill switch lives in the state dir. The cooldowns and the timers here are
//! memory only: a restart forgets them, and a restore that was due is lost (the
//! lights module's catch-up gives the look back on a story reload).

import type { ServerResponse } from "node:http";
import { planLook, resolveLightTargets, type HouseMap, type LightState, type LightsConfig } from "@loom/house";
import {
  COSTUME_FILE,
  DEFAULT_COSTUME,
  CostumeGate,
  actionRefusal,
  costumeCue,
  costumeItem,
  costumeLeaves,
  costumeMenu,
  momentRefusal,
  parseCostume,
  type CostumeAction,
  type CostumeFacts,
  type CostumeFile,
  type CostumeItem,
} from "../src/costume.ts";
import { sendJson } from "./http-util.ts";
import { LiveFileSource, type LiveFileOptions } from "./live-file.ts";

export const COSTUME_MENU_ROUTE = "/api/costume/menu";
export const COSTUME_FIRE_ROUTE = "/api/costume/fire";
export const COSTUME_MOD_ROUTE = "/api/mod/costume";

export class CostumeSource extends LiveFileSource<CostumeFile> {
  constructor(opts: LiveFileOptions) {
    super({ label: "costume", fileName: COSTUME_FILE, parse: parseCostume }, opts);
  }

  /** The file in force, or the default menu. */
  async menu(): Promise<CostumeFile> {
    return (await this.read()).file ?? DEFAULT_COSTUME;
  }
}

/** The fixtures `to` reaches, every safety fixture left out. */
export function costumeFixtures(lights: LightsConfig, house: HouseMap | null, to: readonly string[]): string[] {
  const safety = new Set(lights.fixtures.filter((f) => f.safety === true).map((f) => f.id));
  return resolveLightTargets(lights, house, to).fixtures.filter((id) => !safety.has(id));
}

/** A look an item may fire: it exists, and reaches no safety fixture. */
export function costumeLookSafe(lights: LightsConfig, house: HouseMap | null, look: string): boolean {
  const plan = planLook(lights, house, look);
  if (plan === null || plan.commands.length === 0) return false;
  const safety = new Set(lights.fixtures.filter((f) => f.safety === true).map((f) => f.id));
  return plan.commands.every((c) => !safety.has(c.fixture));
}

/** The fixtures a lights item moved. */
export function costumeMoved(lights: LightsConfig, house: HouseMap | null, a: Extract<CostumeAction, { kind: "look" | "light" }>): string[] {
  if (a.kind === "light") return costumeFixtures(lights, house, a.to);
  return [...new Set(planLook(lights, house, a.look)?.commands.map((c) => c.fixture) ?? [])];
}

/** A restore while a room is out on Trabolta's word. The whole look would
 *  relight that room ahead of the story's own return, so only what the press
 *  moved goes back, to where `look` leaves it, and what is in the dark room
 *  stays dark. */
export function costumeRoomOutRestore(lights: LightsConfig, house: HouseMap | null, look: string, moved: readonly string[], darkRoom: string | null): Array<{ fixture: string; set: LightState }> {
  const dark = new Set(darkRoom === null ? [] : resolveLightTargets(lights, house, [darkRoom]).fixtures);
  const left = new Map<string, LightState>();
  for (const c of planLook(lights, house, look)?.commands ?? []) {
    if (moved.includes(c.fixture) && !dark.has(c.fixture)) left.set(c.fixture, { ...left.get(c.fixture), ...c.set });
  }
  return [...left].map(([fixture, set]) => ({ fixture, set }));
}

/** What a file asks of the house that the house won't do. A safety fixture
 *  named by a light item is left out at the press; here it is named. */
export function costumeHouseProblems(file: CostumeFile, lights: LightsConfig, house: HouseMap | null, sounds: readonly string[]): string[] {
  const problems: string[] = [];
  for (const item of costumeLeaves(file)) {
    const a = item.action;
    if (a?.kind === "look" && !costumeLookSafe(lights, house, a.look)) problems.push(`${item.id}: the look ${a.look} is missing or reaches a safety fixture`);
    if (a?.kind === "light") {
      const reached = resolveLightTargets(lights, house, a.to).fixtures;
      if (reached.length === 0) problems.push(`${item.id}: ${a.to.join(", ")} reaches no fixture`);
      if (reached.length !== costumeFixtures(lights, house, a.to).length) problems.push(`${item.id}: ${a.to.join(", ")} reaches a safety fixture`);
    }
    if (a?.kind === "sound" && !sounds.includes(a.sound)) problems.push(`${item.id}: audio.json has no sound ${a.sound}`);
  }
  return problems;
}

export interface CostumeTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface CostumeDeskDeps {
  now: () => number;
  timers: CostumeTimers;
  facts: () => CostumeFacts;
  /** Do it. False: it couldn't land (nothing was changed). */
  perform: (action: CostumeAction, file: CostumeFile) => boolean;
  /** The mod log's line for a fire that landed. */
  note: (item: CostumeItem) => void;
  /** The story's look again, after a press that did `action`. */
  restoreLights: (action: Extract<CostumeAction, { kind: "look" | "light" }>) => void;
  /** The story's soundtrack scene again, unless another hand has taken it.
   *  True: ask again soon, a host's held ⏸ sits on the hold. */
  musicStory: () => boolean;
}

export type CostumePress = { ok: true } | { ok: false; why: string };

/** How soon a hold's return asks again while a host's ⏸ sits on it. */
const MUSIC_RETURN_RETRY_S = 5;

export class CostumeDesk {
  private readonly gate: CostumeGate;
  private readonly pending = new Set<unknown>();
  private lightsTimer: unknown = null;
  private musicTimer: unknown = null;
  private stormTimer: unknown = null;

  constructor(private readonly deps: CostumeDeskDeps) {
    this.gate = new CostumeGate(deps.now);
  }

  /** One press, whole: the server's word on it, and what follows it. */
  press(file: CostumeFile, id: string): CostumePress {
    const item = costumeItem(file, id);
    if (item === null || item.action === null) return { ok: false, why: "no_item" };
    const facts = this.deps.facts();
    const why = momentRefusal(facts) ?? actionRefusal(item.action, facts);
    if (why !== null) return { ok: false, why };
    if (this.gate.cooling(item, file.cooldownS)) return { ok: false, why: "cooldown" };
    if (!this.deps.perform(item.action, file)) return { ok: false, why: "refused" };
    this.gate.fired(item);
    this.deps.note(item);
    this.after(item.action, file);
    return { ok: true };
  }

  /** A new run: nothing is owed and everything is ready. */
  clear(): void {
    for (const h of this.pending) this.deps.timers.clear(h);
    this.pending.clear();
    this.lightsTimer = null;
    this.musicTimer = null;
    this.stormTimer = null;
    this.gate.clear();
  }

  /** The kill switch: a storm stops here. A restore that is due still comes,
   *  or the house would stay on the costume's colour. */
  halt(): void {
    if (this.stormTimer !== null) this.cancel(this.stormTimer);
    this.stormTimer = null;
  }

  private after(action: CostumeAction, file: CostumeFile): void {
    if (action.kind === "look" || action.kind === "light") {
      if (this.lightsTimer !== null) this.cancel(this.lightsTimer);
      this.lightsTimer = this.later(() => {
        this.lightsTimer = null;
        this.deps.restoreLights(action);
      }, file.restoreS);
    } else if (action.kind === "music" && action.holdS !== undefined) {
      if (this.musicTimer !== null) this.cancel(this.musicTimer);
      const back = (): void => {
        this.musicTimer = this.deps.musicStory() ? this.later(back, MUSIC_RETURN_RETRY_S) : null;
      };
      this.musicTimer = this.later(back, action.holdS);
    } else if (action.kind === "cue" && action.times > 1) {
      this.again(action, file, action.times - 1, costumeCue(action.cue, this.deps.facts()));
    }
  }

  /** The rest of a storm, each judged afresh: a beat that starts ends it, and
   *  so does a talk scene opening or closing, which would change what it is. */
  private again(action: Extract<CostumeAction, { kind: "cue" }>, file: CostumeFile, left: number, fires: string): void {
    this.stormTimer = this.later(() => {
      this.stormTimer = null;
      const facts = this.deps.facts();
      if (momentRefusal(facts) !== null || actionRefusal(action, facts) !== null || costumeCue(action.cue, facts) !== fires) return;
      if (!this.deps.perform(action, file)) return;
      if (left > 1) this.again(action, file, left - 1, fires);
    }, action.everyS);
  }

  private later(fn: () => void, seconds: number): unknown {
    const h: unknown = this.deps.timers.set(() => {
      this.pending.delete(h);
      fn();
    }, seconds * 1000);
    this.pending.add(h);
    return h;
  }

  private cancel(h: unknown): void {
    this.deps.timers.clear(h);
    this.pending.delete(h);
  }
}

/** `POST /api/costume/menu`, token already checked. */
export async function sendCostumeMenu(res: ServerResponse, source: CostumeSource, on: boolean): Promise<void> {
  res.setHeader?.("cache-control", "no-store");
  sendJson(res, 200, costumeMenu(await source.menu(), on));
}

/** `POST /api/costume/fire`, token already checked. Every refusal is the same
 *  to the page; `why` is for a crew member with a console. */
export async function sendCostumeFire(res: ServerResponse, source: CostumeSource, desk: CostumeDesk, on: boolean, id: string): Promise<void> {
  res.setHeader?.("cache-control", "no-store");
  if (!on) return void sendJson(res, 403, { ok: false, why: "off" });
  const press = desk.press(await source.menu(), id);
  sendJson(res, press.ok ? 200 : 409, press);
}
