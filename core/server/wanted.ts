//! The Wanted board (wave 18, C6) and the story times the server keeps for
//! it: when each guest's `wanted:` flag turned true (`markedAt`), when a
//! wanted guest was captured (the poster stays 60 s), and when the night
//! first ended (C7: a duck run after it is a party favour, never a record).
//!
//! `StoryMarks` reads the sim's own event log from a cursor: every
//! `worldSet` of `<guest>.<flag>` / `Night.ended` and every `captured` /
//! `released`, stamped with the story clock when it is read. The runtime
//! reads it around every journaled mutation and after every replayed journal
//! line, so a restart rebuilds the same times (the journal replays the same
//! events at the same story clock). Memory only.

import type { Sim } from "../src/runtime/sim/index.ts";
import { display, truthy, type Value } from "../src/runtime/expr.ts";
import { foldName } from "../src/parser/names.ts";
import type { WantedRow } from "./views.ts";

/** How long a captured program's poster stays up (story ms). */
export const CAPTURED_POSTER_MS = 60_000;

/** The path whose first true value ends the night (C7, the show's convention). */
export const NIGHT_ENDED_PATH = "Night.ended";

const isTrue = (v: string): boolean => {
  const t = v.replace(/^"(.*)"$/su, "$1").trim().toLowerCase();
  return t !== "" && t !== "false" && t !== "null" && t !== "0" && t !== "none";
};

export class StoryMarks {
  private sim: Sim | null = null;
  private at = 0;
  /** guest id → story ms the wanted flag turned true. */
  private readonly marked = new Map<string, number>();
  /** guest id → story ms they were captured while wanted. */
  private readonly captured = new Map<string, number>();
  /** Story ms `Night.ended` first read true, or null. */
  private ended: number | null = null;
  /** The captured posters already reported as lapsed (`postersLapsed`). */
  private readonly lapsed = new Set<string>();

  /** Forget everything (a new sim: a restart replays from the start). */
  private reset(sim: Sim): void {
    this.sim = sim;
    this.at = 0;
    this.marked.clear();
    this.captured.clear();
    this.lapsed.clear();
    this.ended = null;
  }

  /** Read the log since the last call; a different sim starts over. */
  observe(sim: Sim | null): void {
    if (sim === null) return;
    if (sim !== this.sim) this.reset(sim);
    const flag = sim.model.wanted?.flag ?? null;
    const len = sim.log.len();
    if (len <= this.at) return;
    const now = sim.elapsed();
    for (const e of sim.log.since(this.at)) {
      if (e.type === "worldSet") {
        if (e.path === NIGHT_ENDED_PATH) {
          if (this.ended === null && isTrue(e.value)) this.ended = now;
          continue;
        }
        if (flag === null) continue;
        const dot = e.path.indexOf(".");
        if (dot <= 0 || e.path.slice(dot + 1) !== flag) continue;
        const who = e.path.slice(0, dot);
        if (!sim.persons.has(who)) continue;
        if (isTrue(e.value)) {
          if (!this.marked.has(who)) this.marked.set(who, now);
        } else {
          this.marked.delete(who);
        }
      } else if (e.type === "captured") {
        if (this.marked.has(e.person) && !this.captured.has(e.person)) this.captured.set(e.person, now);
      } else if (e.type === "released") {
        this.captured.delete(e.person);
        this.lapsed.delete(e.person);
      }
    }
    this.at = len;
  }

  /**
   * Has a captured poster run out its `CAPTURED_POSTER_MS` since the last
   * call (story ms `now`)? The board drops it by time, so the booths need a
   * fresh view then, or an open board keeps it (recheck BN2-FC). True once
   * per poster.
   */
  postersLapsed(now: number): boolean {
    let any = false;
    for (const [who, at] of this.captured) {
      if (now - at <= CAPTURED_POSTER_MS || this.lapsed.has(who)) continue;
      this.lapsed.add(who);
      any = true;
    }
    return any;
  }

  /** Story ms the night first ended, or null (C7). */
  endedAt(): number | null {
    return this.ended;
  }

  /** The Wanted board now (C6): every guest whose flag is on and is not yet
   *  captured, plus each one captured while wanted for `CAPTURED_POSTER_MS`;
   *  newest mark first. `lastSeen` / `avatarOf` are the runtime's. */
  board(sim: Sim, lastSeen: ReadonlyMap<string, number>, avatarOf: (name: string) => string | null): WantedRow[] {
    // Never `observe` here: a view between two journal lines would stamp a
    // tick's change earlier than a replay can (`markedAt` falls back to now).
    const w = sim.model.wanted;
    if (w === null) return [];
    const now = sim.elapsed();
    const rows: WantedRow[] = [];
    for (const p of sim.persons.values()) {
      const on = truthy(sim.world.get(`${p.id}.${w.flag}`));
      const isCaptured = sim.isCaptured(p.id);
      const caughtAt = this.captured.get(p.id);
      if (isCaptured) {
        if (caughtAt === undefined || now - caughtAt > CAPTURED_POSTER_MS) continue;
      } else if (!on) continue;
      const avatar = avatarOf(p.name);
      rows.push({
        id: p.id,
        name: p.name,
        ...(avatar !== null ? { avatar } : {}),
        reason: w.reason !== null ? text(sim.world.get(`${p.id}.${w.reason}`)) : null,
        location: sim.locationOf(p.id),
        lastSeen: lastSeen.get(p.id) ?? null,
        markedAt: this.marked.get(p.id) ?? caughtAt ?? now,
        claimedBy: w.claim !== null ? text(sim.world.get(`${p.id}.${w.claim}`)) : null,
        captured: isCaptured,
      });
    }
    return rows.sort((a, b) => b.markedAt - a.markedAt || a.name.localeCompare(b.name));
  }
}

/** A world value as a display string, null when empty / unset. */
function text(v: Value | undefined): string | null {
  if (v === undefined) return null;
  const t = display(v).replace(/^"(.*)"$/su, "$1").trim();
  return t === "" || t === "null" || t === "none" ? null : t;
}

/** Does the header `wanted:` line's `for` list name this booth's character
 *  (the CHARACTER itself, or its GROUP)? */
export function huntsFor(sim: Sim, character: string): boolean {
  const w = sim.model.wanted;
  if (w === null) return false;
  const me = foldName(character);
  const group = sim.model.characters.get(character)?.faction ?? null;
  return w.for.some((n) => foldName(n) === me || (group !== null && foldName(n) === foldName(group)));
}
