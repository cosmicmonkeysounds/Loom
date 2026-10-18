//! Which side a guest may pick — the one predicate behind the side chooser
//! (`GuestView.factions`) and the `/api/guest/join` + `/api/guest/defect`
//! routes (D7, T6-adversary-01).
//!
//! A guest may join or defect only to a **declared** group that is
//! `joinable` (not a story-assigned caste like Hosts / Antivirus) and either
//! not `hidden` or already revealed by the story (`reveal G`). Anything else
//! is refused before it reaches the sim: a self-made Hosts member would read
//! and post in the staff back-room (every 📝 verdict included), and an early
//! join to a hidden recruiting side would skew its majority. The story's own
//! `add` / `join` statements, a cast trait's assignment and a director's
//! `/api/mod/set` never come through here, so they still place anyone.

import type { Sim } from "../../src/runtime/sim/index.ts";
import { foldName } from "../../src/parser/names.ts";

/** May a guest pick this group as their side right now? (By exact id.) */
export function guestMayJoin(sim: Sim, id: string): boolean {
  const def = sim.model.factions.get(id);
  return def !== undefined && def.joinable && (!def.hidden || sim.factionRevealed(def.id));
}

/** Every side a guest may pick right now, in declaration order. */
export function joinableFactions(sim: Sim): string[] {
  return [...sim.model.factions.values()].filter((f) => guestMayJoin(sim, f.id)).map((f) => f.id);
}

/**
 * The declared group a guest's `faction` / `to` names (exact id first, then
 * folded — `unlimited power` is `Unlimited Power`), or null when it names
 * none or names one they may not pick. The routes commit the returned id,
 * so the journal always carries the canonical name.
 */
export function guestSide(sim: Sim, raw: string): string | null {
  const name = raw.trim();
  if (name === "") return null;
  let id: string | null = sim.model.factions.has(name) ? name : null;
  if (id === null) {
    const want = foldName(name);
    for (const f of sim.model.factions.values()) {
      if (foldName(f.id) === want) {
        id = f.id;
        break;
      }
    }
  }
  return id !== null && guestMayJoin(sim, id) ? id : null;
}
