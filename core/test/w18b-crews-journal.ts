//! Wave 18b — a wave 18 crews night as a list of journaled steps (the
//! crews fixture, no `founding:` line), shared by the no-header equality
//! test and the script that snapshotted its views on master (30ef8aa).

import type { CrewOp } from "../src/runtime/sim/crews.ts";

export type JournalStep =
  | { m: "person"; id: string; name: string }
  | { m: "reveal"; target: string }
  | { m: "join"; person: string; faction: string }
  | { m: "defect"; person: string; to: string }
  | { m: "set"; path: string; value: string }
  | { m: "signal"; name: string; subject?: string }
  | { m: "crew"; op: CrewOp };

export const CREW_JOURNAL: JournalStep[] = [
  { m: "person", id: "g1", name: "Ada" },
  { m: "person", id: "g2", name: "Bob" },
  { m: "person", id: "g3", name: "Cy" },
  { m: "person", id: "g4", name: "Dee" },
  { m: "reveal", target: "Red" },
  { m: "reveal", target: "Blue" },
  { m: "set", path: "Red.leader", value: "g4" },
  { m: "join", person: "g4", faction: "Red" },
  { m: "crew", op: { op: "foundCrew", by: "g1", name: "The Night Shift" } },
  { m: "crew", op: { op: "crewInvite", by: "g1", to: "g2", crew: "crew-1" } },
  { m: "crew", op: { op: "crewAnswer", id: "inv-1", yes: true } },
  { m: "join", person: "g2", faction: "Blue" },
  { m: "crew", op: { op: "recruit", by: "g4", to: "g3", side: "Red" } },
  { m: "crew", op: { op: "recruitAnswer", id: "inv-2", yes: true } },
  { m: "defect", person: "g3", to: "Blue" },
  { m: "crew", op: { op: "foundCrew", by: "g3", name: "Cy's Club" } },
  { m: "crew", op: { op: "leaveCrew", person: "g1", crew: "crew-1" } },
  { m: "crew", op: { op: "renameCrew", crew: "crew-2", name: "Cy Club" } },
  { m: "set", path: "g2.gone", value: "true" },
  { m: "crew", op: { op: "leaveSide", person: "g3" } },
  { m: "crew", op: { op: "crewInvite", by: "g3", to: "g4", crew: "crew-2" } },
];

/** The sim surface the steps need (the current and the master `Sim` alike). */
export interface JournalSim {
  createPerson(id: string, name: string): unknown;
  reveal(target: string): unknown;
  join(person: string, faction: string): unknown;
  defect(person: string, to: string): unknown;
  setVar(path: string, value: string): unknown;
  signal(name: string, subject?: string): unknown;
  crew(op: CrewOp): unknown;
}

export function playJournal(sim: JournalSim, steps: readonly JournalStep[] = CREW_JOURNAL): void {
  for (const s of steps) {
    if (s.m === "person") sim.createPerson(s.id, s.name);
    else if (s.m === "reveal") sim.reveal(s.target);
    else if (s.m === "join") sim.join(s.person, s.faction);
    else if (s.m === "defect") sim.defect(s.person, s.to);
    else if (s.m === "set") sim.setVar(s.path, s.value);
    else if (s.m === "signal") sim.signal(s.name, s.subject);
    else sim.crew(s.op);
  }
}
