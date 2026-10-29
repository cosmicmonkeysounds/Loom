//! Wave 44 (`docs/loom-w44-contract.md` C5): `GET /api/credits`.
//!
//! Any token: a moderator (a terminal, Run, a host booth holding the mod
//! passcode) always, with `source` and `problems`; a booth or a guest only
//! once the story has started a roll (`Night.credits_roll` ≥ 1), else 403
//! `not_yet`. 404 `no_credits` when the event has no usable file. The
//! programs are every guest who joined, but a director's persona or one
//! marked gone.

import type { ServerResponse } from "node:http";
import { CREDITS_ROLL_PATH, creditsView } from "../../src/credits.ts";
import { asNumber } from "../../src/runtime/expr.ts";
import type { Sim } from "../../src/runtime/sim/index.ts";
import type { CreditsRead } from "../credits.ts";

export const CREDITS_ROUTE = "/api/credits";

export type CreditsCaller = "mod" | "player" | "none";

/** The story's roll count (0 when unset). */
export function creditsRollOf(sim: Sim | null): number {
  const v = sim?.world.get(CREDITS_ROLL_PATH);
  const n = v === undefined ? null : asNumber(v);
  return n !== null && Number.isFinite(n) && n > 0 ? n : 0;
}

/** The night's programs, by name (not personas, not gone). */
export function creditsPrograms(sim: Sim | null, isPersona: (id: string) => boolean): string[] {
  if (sim === null) return [];
  const out: string[] = [];
  for (const p of sim.persons.values()) {
    if (isPersona(p.id)) continue;
    const gone = sim.world.get(`${p.id}.gone`);
    if (gone !== undefined && gone.kind === "bool" && gone.value === true) continue;
    out.push(p.name);
  }
  return out;
}

/** What the route answers, pure: status + body. */
export function creditsAnswer(caller: CreditsCaller, read: CreditsRead, sim: Sim | null, isPersona: (id: string) => boolean): { status: number; body: unknown } {
  if (caller === "none") return { status: 401, body: { error: "sign in first" } };
  const roll = creditsRollOf(sim);
  if (caller !== "mod" && roll < 1) return { status: 403, body: { error: "not_yet" } };
  if (read.file === null) return { status: 404, body: { error: "no_credits", ...(caller === "mod" && read.problems.length > 0 ? { problems: read.problems } : {}) } };
  const view = creditsView(read.file, creditsPrograms(sim, isPersona), roll);
  return { status: 200, body: caller === "mod" ? { ...view, source: read.source, problems: read.problems } : view };
}

export function sendCredits(res: ServerResponse, answer: { status: number; body: unknown }): void {
  res.writeHead(answer.status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(answer.body));
}
