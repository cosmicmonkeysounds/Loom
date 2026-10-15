//! K-13 — room check-in by QR (`POST /e/:id/api/guest/checkin {at}`).
//!
//! Each room's sign carries a QR (`…/?code=<event>&checkin=<slug>`); the
//! play app turns it into this call. The route only decides *whether* a
//! guest may check in and *which* LOCATION the slug names; the move itself
//! is the story's: a journaled `signal("checked_in", guest, {at: <exact
//! LOCATION id>})`, which the show's `when checked_in for program:` if-chain
//! answers (`main.loom` — move, `checked_in` vars, the 📍 reply). A story
//! with no such rule simply moves nobody.
//!
//! Refused (nothing journaled) when the guest is captured, stands in a
//! prison / sealed room, is on rails (a `cutscene: true` room, or the ROLE
//! convention `uploaded && !cleared`), or the target is hidden from them,
//! a prison, a cutscene, or `checkin: false`; and at most once per `CHECKIN_COOLDOWN_MS`.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Sim, SimEvent } from "../../src/runtime/sim/index.ts";
import { truthy } from "../../src/runtime/expr.ts";
import { foldName } from "../../src/parser/names.ts";
import { sendJson, str } from "../http-util.ts";

export const CHECKIN_ROUTE = "/api/guest/checkin";
/** One check-in per guest per this long (a sign scanned twice, a loop). */
export const CHECKIN_COOLDOWN_MS = 20_000;

/** The declared LOCATION a sign's slug names (`the-cache`, `The Cache`,
 *  `the_cache` all fold to `The Cache`), or null. */
export function checkinTarget(sim: Sim, raw: string): string | null {
  const want = foldName(raw.trim());
  if (want === "") return null;
  for (const id of sim.model.locations.keys()) if (foldName(id) === want) return id;
  return null;
}

/** Why `guest` may not check in at `at` right now — null when they may. */
export function checkinRefusal(sim: Sim, guest: string, at: string): { status: number; error: string } | null {
  const target = sim.model.locations.get(at);
  if (target === undefined) return { status: 404, error: "That check-in point is not in this computer." };
  if (sim.isCaptured(guest)) return { status: 409, error: "You're captured — the story has to let you out first." };
  const here = sim.model.locations.get(sim.locationOf(guest) ?? "");
  if (here !== undefined && (here.prison || here.sealed)) return { status: 409, error: "You can't check in from here." };
  if (sim.cutsceneFor(guest) || onRails(sim, guest)) return { status: 409, error: "Not yet — finish getting in first." };
  // `checkin: false` — no sign is printed for it (K-12), and a scanned or
  // hand-typed slug is refused too (the locked Server Room).
  if (target.prison || target.cutscene || !target.checkin) return { status: 403, error: "That room isn't a check-in point." };
  if (!sim.canSeeChannel(guest, `loc:${at}`)) return { status: 403, error: "That room isn't open yet." };
  return null;
}

/** The ROLE convention for "still on rails": uploaded but not yet cleared
 *  (*Trapped in the Internet* — a program waiting for the Antivirus). */
function onRails(sim: Sim, guest: string): boolean {
  return truthy(sim.world.get(`${guest}.uploaded`)) && !truthy(sim.world.get(`${guest}.cleared`));
}

/** What the route needs from its `EventRuntime` (kept narrow so the route
 *  merges cleanly and tests can see exactly what it touches). */
export interface CheckinHost {
  sim(): Sim | null;
  open(): boolean;
  /** The acting guest from the caller's token (sends 401 itself), or null. */
  guest(req: IncomingMessage, body: Record<string, unknown>, res: ServerResponse): string | null;
  /** Journal + apply + fan out `signal("checked_in", guest, {at})`. */
  signal(guest: string, at: string): SimEvent[];
  now(): number;
}

export class GuestCheckin {
  private readonly last = new Map<string, number>();

  constructor(private readonly host: CheckinHost, private readonly cooldownMs = CHECKIN_COOLDOWN_MS) {}

  handle(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): true {
    const id = this.host.guest(req, body, res);
    if (id === null) return true;
    const sim = this.host.sim();
    if (!this.host.open() || sim === null) {
      sendJson(res, 409, { error: "doors are closed" });
      return true;
    }
    const at = checkinTarget(sim, str(body, "at"));
    if (at === null) {
      sendJson(res, 404, { error: "That check-in point is not in this computer." });
      return true;
    }
    const why = checkinRefusal(sim, id, at);
    if (why !== null) {
      sendJson(res, why.status, { error: why.error });
      return true;
    }
    const now = this.host.now();
    const prev = this.last.get(id);
    if (prev !== undefined && now - prev < this.cooldownMs) {
      const wait = Math.ceil((this.cooldownMs - (now - prev)) / 1000);
      sendJson(res, 429, { error: `You just checked in — try again in ${wait}s.`, retryAfter: wait });
      return true;
    }
    this.last.set(id, now);
    this.host.signal(id, at);
    sendJson(res, 200, { ok: true, at, channel: `loc:${at}`, moved: sim.locationOf(id) === at });
    return true;
  }
}
