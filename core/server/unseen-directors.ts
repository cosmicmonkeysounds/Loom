//! Directors stay out of sight (2026-10-24): no phone but a director's own
//! reads a director's name. A guest sees the hosts and the programs; a
//! booth, hosts included, sees parts by name and everyone at Run, on the
//! director phone or on a headless mod token as plain "Director".
//!
//! The server names whoever acted by the journal's `by` (an author's
//! display name, `Booth · Task Manager`, `agent:Trabolta`, `Phone · Ada`,
//! `Director`). These helpers turn that into what a non-director may read:
//! the part's name when it is one of the story's characters, else
//! `DIRECTOR`. Pure; the event runtime applies them to every booth and host
//! view, booth chat lines and a guest's rejoin answer. The director phone
//! and Run keep the real names (they are directors).
//!
//! Wave 59 (the user's note, 2026-10-31): nobody's People list shows a
//! director. In the data a director among the people is a **Run persona**:
//! Run's Start seats one named after you, and Players seats more (`<id>.persona`,
//! an owner, a `p-…` id). They leave every list on its way out of the server
//! (`seenPeople`, `seenRows`, `hostSeen`), so the name never reaches a phone.
//! Only a director's own pane (`via`) still reads them, so a rehearsal from
//! Run plays as it did. The same lists show who is online: `PeopleRound` says,
//! and each row carries `online` for the phone to filter on, because a phone
//! also reads these rows for a DM's name, a wallet's pick and a scanned card.

import type { HostView } from "../src/host-board.ts";
import { foldName } from "../src/parser/names.ts";
import type { SimModel } from "../src/runtime/sim/model.ts";
import type { Sim } from "../src/runtime/sim/index.ts";
import type { ChatMessage } from "./chat.ts";
import type { GuestView } from "./views.ts";

/** What a non-director reads for any director. */
export const DIRECTOR = "Director";

/** The part a journal `by` names (its `Booth · ` / `agent:` prefix off),
 *  when it is one of the story's characters; null for anyone else. */
export function partName(by: string | null | undefined, model: SimModel | null): string | null {
  if (typeof by !== "string" || model === null) return null;
  const t = by.trim().replace(/^Booth · /u, "").replace(/^agent:/u, "").trim();
  if (t === "") return null;
  const k = foldName(t);
  for (const id of model.characters.keys()) if (foldName(id) === k) return id;
  return null;
}

/** `by` as a booth or a guest may read it: the part, else "Director". */
export function seenName(by: string, model: SimModel | null): string {
  return partName(by, model) ?? DIRECTOR;
}

/** A caller claim (`cues.caller`) as a booth reads it. */
export function seenCaller<T extends { name: string } | null | undefined>(caller: T, model: SimModel | null): T {
  if (caller === null || caller === undefined) return caller;
  return { ...caller, name: seenName(caller.name, model) };
}

/** A chat line as a booth reads it: never the director who said it as a
 *  participant (`via`), the same as a guest's copy. */
export function forBooth(m: ChatMessage): ChatMessage {
  if (m.via === undefined) return m;
  const { via: _via, ...rest } = m;
  return rest;
}

/** A cue state (`cues` / `calls`) as a booth reads it: the caller and the
 *  last presser by part, a director as "Director". */
export function seenCues<T extends { caller?: { name: string; at: number } | null; lastName?: string | null }>(cues: T, model: SimModel | null): T {
  const out = { ...cues };
  if (out.caller !== undefined) out.caller = seenCaller(out.caller, model);
  if (typeof out.lastName === "string") out.lastName = seenName(out.lastName, model);
  return out;
}

/** Who a people list may show this round (the runtime's `peopleRound`). */
export interface PeopleRound {
  /** Guests online now, grace included (`ONLINE_GRACE_MS`). */
  guests: ReadonlySet<string>;
  /** Parts with a booth online now, grace included. */
  booths: ReadonlySet<string>;
  /** Every Run persona in the sim. */
  directors: ReadonlySet<string>;
}

/** Nobody to hide: what a director's own pane passes. */
export const NO_ONE: ReadonlySet<string> = new Set<string>();

/** The Run personas among the sim's people: an owner, a `p-…` id (the same
 *  test as the runtime's other `isPersona`), or the journaled `<id>.persona`. */
export function directorIds(sim: Sim | null, owners: ReadonlyMap<string, string>): ReadonlySet<string> {
  const out = new Set<string>();
  if (sim === null) return out;
  for (const id of sim.persons.keys()) {
    if (owners.has(id) || id.startsWith("p-")) {
      out.add(id);
      continue;
    }
    const flag = sim.world.get(`${id}.persona`);
    if (flag.kind === "bool" && flag.value) out.add(id);
  }
  return out;
}

/** `rows` without anyone in `hide` (the same array when nobody goes). */
export function seenRows<T extends { id: string }>(rows: T[], hide: ReadonlySet<string>): T[] {
  return hide.size === 0 ? rows : rows.filter((r) => !hide.has(r.id));
}

/** A guest's `people` and `roster` as that phone reads them: no director
 *  (`hide`), each card saying whether they are online. A character is online
 *  while a booth plays it, an agent while a worker answers it or its `hold:`
 *  line would. */
export function seenPeople(view: Pick<GuestView, "people" | "roster">, round: PeopleRound, hide: ReadonlySet<string>): Pick<GuestView, "people" | "roster"> {
  return {
    people: seenRows(view.people, hide).map((p) => ({
      ...p,
      online: p.kind === "guest" ? round.guests.has(p.id) : p.agent !== undefined ? p.agent.online || p.agent.hold === true : round.booths.has(p.id),
    })),
    roster: seenRows(view.roster, hide),
  };
}

/** A host booth's panel (built on the directors' view) with every
 *  director's name read as "Director": the caller, LAST's presser, a Run
 *  persona's owner, who ruled a filing. Wave 59: anyone in `hide` leaves
 *  its people, roster and Wanted board. */
export function hostSeen(view: HostView, model: SimModel | null, hide: ReadonlySet<string> = NO_ONE): HostView {
  const out: HostView = { ...view, cues: seenCues(view.cues, model) };
  out.people = seenRows(view.people, hide);
  out.roster = seenRows(view.roster, hide).map((p) => (typeof p.owner === "string" ? { ...p, owner: DIRECTOR } : p));
  if (view.wanted !== undefined) out.wanted = seenRows(view.wanted, hide);
  if (view.judging !== null) {
    const row = <R extends { by?: string | null; ruling?: { by: string } | null }>(r: R): R => ({
      ...r,
      ...(typeof r.by === "string" ? { by: seenName(r.by, model) } : {}),
      ...(r.ruling != null ? { ruling: { ...r.ruling, by: seenName(r.ruling.by, model) } } : {}),
    });
    out.judging = { ...view.judging, pending: view.judging.pending.map(row), recent: view.judging.recent.map(row) };
  }
  return out;
}
