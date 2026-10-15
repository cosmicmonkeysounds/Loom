//! The lean screen state (OCT31 K-16): what every wall terminal polls instead
//! of the mod feed. `GET /e/:id/api/screen/state` answers in ~1 KB:
//!
//! - `night`     — the story's own screen mirrors, `Night.screen` / `Night.terminals`;
//! - `cues`      — the last `cue screens_*` / `terminals_*` / `tv_*` / `tablet_*`
//!                 value per family, folded from the sim log (a `seq` per family
//!                 so a re-fired cue — `screens_flicker` twice — is visible);
//! - `character` — the terminal's character: hidden (not yet `reveal`ed to
//!                 everyone), `awake` (its `<id>.awake` var, absent = awake) and
//!                 whether an agent worker is voicing it;
//! - `attract`   — hidden or asleep: the terminal shows the screensaver / ads,
//!                 never "ONLINE", and never pilots a pass into the thread;
//! - `remaining` — seconds left on the story countdown that is running, if any;
//! - `terminals` — each terminal's last poll (name, spot, view, how long ago),
//!                 so a director can tell a silent tablet from a live one.
//!
//! Why not the mod feed (`docs/trapped/screens-audit.md` §3.3): it pushes a
//! full ModView per story step, carries every DM onto a wall a guest can
//! touch, has no "current state" for a rebooted tablet, and counts every
//! screen as a director. A poll of this route has none of those problems —
//! and because the fold reads the sim's own log, a restarted server (which
//! replays the journal) answers the same thing it answered before.
//!
//! Transport-free apart from `handleScreenGet`; `ScreenWatch` takes an
//! injected clock for tests.

import type { IncomingMessage, ServerResponse } from "node:http";

import type { Sim } from "../../src/runtime/sim/index.ts";
import { foldName } from "../../src/parser/names.ts";
import { queryTokenOf, sendJson } from "../http-util.ts";

/** The cue families a screen cares about (`cue <family>_<value>`). */
export const SCREEN_CUE_FAMILIES = ["screens", "terminals", "tv", "tablet"] as const;
export type ScreenCueFamily = (typeof SCREEN_CUE_FAMILIES)[number];

/**
 * The story's countdowns, most specific first: while `on` is true the
 * countdown runs to `end` (story seconds, against `Time.elapsed`). The vars
 * are *Trapped in the Internet*'s (`main.loom`); a story without them simply
 * never has a countdown.
 */
export const SCREEN_COUNTDOWNS: ReadonlyArray<{ name: string; on: string; end: string }> = [
  { name: "y2k", on: "Night.final_round", end: "Night.y2k_end" },
  { name: "summons", on: "Night.summons_open", end: "Night.summons_end" },
  { name: "hunt", on: "Night.hunt_on", end: "Night.hunt_end" },
  { name: "hunt_2", on: "Night.hunt2_on", end: "Night.hunt2_end" },
  { name: "bingo", on: "Night.bingo_on", end: "Night.bingo_end" },
];

/** At most this many terminals are remembered (oldest poll evicted). */
export const MAX_SCREENS = 32;

export interface ScreenCue {
  value: string;
  /** Bumps on every cue of this family, repeats included. */
  seq: number;
}

export interface ScreenPoll {
  name: string;
  spot: string;
  view: string;
  character: string;
  /** Epoch ms of the last poll. */
  at: number;
}

export interface ScreenCharacter {
  id: string;
  hidden: boolean;
  awake: boolean;
  online: boolean;
}

export interface ScreenState {
  /** Server epoch ms. */
  now: number;
  night: { screen: string | null; terminals: string | null };
  cues: Record<ScreenCueFamily, ScreenCue | null>;
  /** Null when the terminal's character isn't in the story (or no story is loaded). */
  character: ScreenCharacter | null;
  attract: boolean;
  countdown: string | null;
  remaining: number | null;
  terminals: Array<ScreenPoll & { ago: number }>;
}

export interface ScreenWho {
  name: string;
  spot: string;
  view: string;
  character: string;
}

/** `screens_call_desktop` → `{family: "screens", value: "call_desktop"}`; anything else → null. */
export function screenCueOf(args: string): { family: ScreenCueFamily; value: string } | null {
  const head = args.trim().split(/[\s,]+/u)[0] ?? "";
  for (const family of SCREEN_CUE_FAMILIES) {
    if (head.startsWith(`${family}_`) && head.length > family.length + 1) return { family, value: head.slice(family.length + 1) };
  }
  return null;
}

const clip = (s: string | null, n = 48): string => (s ?? "").slice(0, n);

export class ScreenWatch {
  private sim: Sim | null = null;
  private cursor = 0;
  private readonly cues = new Map<ScreenCueFamily, ScreenCue>();
  private readonly polls = new Map<string, ScreenPoll>();
  private readonly now: () => number;

  constructor(o: { now?: () => number } = {}) {
    this.now = o.now ?? Date.now;
  }

  /** Fold every screen cue the sim logged since the last look. A new Sim
   *  (a restart replays the journal into a fresh one) starts the fold over. */
  private sync(sim: Sim | null): void {
    if (sim !== this.sim) {
      this.sim = sim;
      this.cursor = 0;
      this.cues.clear();
    }
    if (sim === null) return;
    const events = sim.log.all();
    for (; this.cursor < events.length; this.cursor++) {
      const e = events[this.cursor]!;
      if (e.type !== "directive" || e.verb !== "cue") continue;
      const hit = screenCueOf(e.args);
      if (hit === null) continue;
      const prev = this.cues.get(hit.family);
      this.cues.set(hit.family, { value: hit.value, seq: (prev?.seq ?? 0) + 1 });
    }
  }

  /** Remember a terminal's poll (unnamed polls aren't recorded). */
  private note(who: ScreenWho): void {
    const name = clip(who.name);
    if (name === "") return;
    this.polls.delete(name); // re-insert: Map order = poll order
    this.polls.set(name, { name, spot: clip(who.spot), view: clip(who.view, 16), character: clip(who.character), at: this.now() });
    while (this.polls.size > MAX_SCREENS) this.polls.delete(this.polls.keys().next().value!);
  }

  /** Each terminal's last poll, most recent first. */
  seen(): Array<ScreenPoll & { ago: number }> {
    const now = this.now();
    return [...this.polls.values()].reverse().map((p) => ({ ...p, ago: Math.max(0, now - p.at) }));
  }

  /** One terminal polls: record it, and answer the current screen state. */
  poll(sim: Sim | null, who: ScreenWho, online: (character: string) => boolean): ScreenState {
    this.sync(sim);
    this.note(who);
    const peek = (path: string): string | null => {
      const v = sim?.world.peek(path) ?? null;
      if (v === null || v.kind === "null") return null;
      if (v.kind === "string") return v.value;
      if (v.kind === "number") return String(v.value);
      if (v.kind === "bool") return v.value ? "true" : "false";
      return null;
    };

    let character: ScreenCharacter | null = null;
    if (sim !== null && who.character !== "") {
      const want = foldName(who.character);
      const def = sim.model.characters.get(who.character) ?? [...sim.model.characters.values()].find((c) => foldName(c.id) === want);
      if (def !== undefined) {
        const hidden = def.hidden && !sim.isRevealed(def.id);
        const awake = peek(`${def.id}.awake`) !== "false";
        character = { id: def.id, hidden, awake, online: online(def.id) };
      }
    }

    let countdown: string | null = null;
    let remaining: number | null = null;
    const elapsed = Number(peek("Time.elapsed") ?? 0);
    for (const c of SCREEN_COUNTDOWNS) {
      if (peek(c.on) !== "true") continue;
      const end = Number(peek(c.end));
      if (!Number.isFinite(end) || end <= 0) continue;
      countdown = c.name;
      remaining = Math.max(0, Math.round(end - elapsed));
      break;
    }

    const cues = {} as Record<ScreenCueFamily, ScreenCue | null>;
    for (const f of SCREEN_CUE_FAMILIES) cues[f] = this.cues.get(f) ?? null;

    return {
      now: this.now(),
      night: { screen: peek("Night.screen"), terminals: peek("Night.terminals") },
      cues,
      character,
      // Fail closed: a character that is hidden or asleep keeps every
      // terminal on attract. An unknown character (a typo in setup) does
      // not — the terminal then behaves as it always did.
      attract: character !== null && (character.hidden || !character.awake),
      countdown,
      remaining,
      terminals: this.seen(),
    };
  }
}

/**
 * `GET /api/screen/state?name=&spot=&view=&character=` — moderator-gated
 * (a terminal holds a mod token; the author's session works too). Returns
 * true when it answered.
 */
export function handleScreenGet(
  watch: ScreenWatch,
  sim: Sim | null,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  authorized: (token: string | undefined) => boolean,
  online: (character: string) => boolean,
): boolean {
  if (!authorized(queryTokenOf(req, url))) {
    sendJson(res, 403, { error: "moderators only" });
    return true;
  }
  const q = (k: string): string => url.searchParams.get(k) ?? "";
  res.setHeader?.("cache-control", "no-store");
  sendJson(res, 200, watch.poll(sim, { name: q("name"), spot: q("spot"), view: q("view"), character: q("character") }, online));
  return true;
}
