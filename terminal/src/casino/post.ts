//! The casino terminal's two calls, both with the terminal's moderator token:
//!
//!   `fetchPlayer` — who a scanned pass is: the guest's own view through the
//!     moderator lens (`GET /api/state?role=guest&as=<id>`, like the chess
//!     board's `fetchChallenger`): name, restricted, and the wallet's balance.
//!   `placeBet` — `POST /api/mod/casino/bet {guest, game, pick, stake,
//!     label}`: the server rolls, settles into the guest's wallet and answers
//!     the roll + payout + new balance. Never retried: a bet is not
//!     idempotent, so a lost answer says "check your wallet" and the
//!     terminal re-reads the balance instead.

import { baseOf, type TerminalConfig } from "../config.ts";
import { ChallengerError } from "../chess/post.ts";
import type { CasinoGame } from "../../../core/src/casino.ts";
import type { BetResult, Player } from "./session.ts";

export { ChallengerError };

type Caller = Pick<TerminalConfig, "eventId" | "token" | "name">;

/** How long one call may take (ms). */
export const CALL_MS = 6_000;

/** The label every bet is journaled `by` (the server keeps ≤ 60 chars). */
export function casinoLabel(c: Pick<TerminalConfig, "name">): string {
  return `Terminal · ${c.name}`.slice(0, 60);
}

async function call(url: string, init: RequestInit, fetcher: typeof fetch, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetcher(url, { ...init, signal: ctl.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

/** A scanned guest: who, whether marked, and what their wallet holds (`wallet: false` — the story has no currency). */
export async function fetchPlayer(config: Caller, id: string, o: { fetcher?: typeof fetch; timeoutMs?: number } = {}): Promise<Player & { restricted: boolean; wallet: boolean }> {
  let res: Response;
  try {
    res = await call(`${baseOf(config)}/api/state?role=guest&as=${encodeURIComponent(id)}`, { headers: { "x-loom-token": config.token } }, o.fetcher ?? fetch, o.timeoutMs ?? CALL_MS);
  } catch {
    throw new ChallengerError("the house didn't answer", "other");
  }
  if (res.status === 404) throw new ChallengerError("unknown guest", "unknown");
  if (res.status === 401 || res.status === 403) throw new ChallengerError("moderators only", "access");
  if (res.status === 409) throw new ChallengerError("the doors are closed", "closed");
  if (!res.ok) throw new ChallengerError(`HTTP ${res.status}`, "other");
  const v = (await res.json().catch(() => null)) as { id?: unknown; name?: unknown; restricted?: unknown; wallet?: { balance?: unknown; name?: unknown } } | null;
  if (v === null || typeof v.name !== "string") throw new ChallengerError("a view this terminal can't read", "other");
  const w = v.wallet;
  const wallet = w !== undefined && w !== null && typeof w.balance === "number";
  return {
    id: typeof v.id === "string" && v.id !== "" ? v.id : id,
    name: v.name,
    restricted: v.restricted === true,
    wallet,
    balance: wallet ? (w!.balance as number) : 0,
    unit: wallet && typeof w!.name === "string" ? w!.name : "Truthcoin",
  };
}

export type BetAnswer = { ok: true; result: BetResult; balance: number } | { ok: false; status: number | null; error: string };

/** One bet. `status: null` = no answer (the network, or the timeout): the bet may or may not have landed. */
export async function placeBet(config: Caller, guest: string, game: CasinoGame, pick: string, stake: number, o: { fetcher?: typeof fetch; timeoutMs?: number } = {}): Promise<BetAnswer> {
  let res: Response;
  try {
    res = await call(
      `${baseOf(config)}/api/mod/casino/bet`,
      { method: "POST", headers: { "content-type": "application/json", "x-loom-token": config.token }, body: JSON.stringify({ guest, game, pick, stake, label: casinoLabel(config) }) },
      o.fetcher ?? fetch,
      o.timeoutMs ?? CALL_MS,
    );
  } catch {
    return { ok: false, status: null, error: "" };
  }
  const body = (await res.json().catch(() => null)) as { error?: unknown; roll?: unknown; payout?: unknown; net?: unknown; balance?: unknown } | null;
  if (!res.ok || body === null) return { ok: false, status: res.status, error: typeof body?.error === "string" ? body.error : "" };
  const roll = Array.isArray(body.roll) ? body.roll.filter((n): n is number => typeof n === "number") : [];
  const payout = typeof body.payout === "number" ? body.payout : 0;
  return {
    ok: true,
    result: { game, pick, stake, roll, payout, net: typeof body.net === "number" ? body.net : payout - stake },
    balance: typeof body.balance === "number" ? body.balance : 0,
  };
}
