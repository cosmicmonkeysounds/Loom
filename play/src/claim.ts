// Reserved programs (W11, SW-PLAY-01). The featured programs are saved for
// their invited guests: the story marks them `reserved: true`, and each
// invitation's QR carries that program's claim token —
// `…/?code=<guest code>&claim=<token>`. The join screen keeps the claim
// through the whole flow (the picker's `/api/identities` and
// `/api/guest/register` both carry it), so the invitee's program is open
// to them and 🔒 Reserved to everyone else. A register without the right
// claim answers 409 `reserved`. The token is a secret: it leaves the
// address bar once the guest is in, and is kept in this browser's storage
// (keyed by the event code, beside `loom.guest`), so a cut session — a
// restart, End → relaunch, Leave — rejoins with it. Pure helpers —
// `test/claim.test.ts`.

import { ApiError } from "./client.ts";
import type { SessionStorage } from "./host.ts";

/** Where the browser keeps its invitation's claim. */
export const CLAIM_KEY = "loom.guest.claim";

interface StoredClaim {
  code: string;
  claim: string;
}

const foldCode = (code: string): string => code.trim().toUpperCase();

/** Keep `claim` for event code `code` (the last invitation wins). */
export function rememberClaim(storage: SessionStorage, code: string, claim: string | null | undefined): void {
  if (claim === null || claim === undefined || claim === "" || foldCode(code) === "") return;
  try {
    storage.save(CLAIM_KEY, { code: foldCode(code), claim } satisfies StoredClaim);
  } catch {
    /* storage full / blocked — the address bar's claim still works once */
  }
}

/** The claim this browser keeps for event code `code`, or null. */
export function storedClaim(storage: SessionStorage, code: string): string | null {
  try {
    const s = storage.load<StoredClaim>(CLAIM_KEY);
    return s !== null && typeof s.claim === "string" && s.claim !== "" && s.code === foldCode(code) ? s.claim : null;
  } catch {
    return null;
  }
}

/** The claim a join carries: the address bar's, else the one kept for the code. */
export function joinClaim(urlClaim: string | null, storage: SessionStorage, code: string): string | null {
  return urlClaim ?? storedClaim(storage, code);
}

/** The claim token riding an invitation's link (`?claim=…`), or null. */
export function claimFromSearch(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get("claim");
    return v !== null && v.trim() !== "" ? v.trim() : null;
  } catch {
    return null;
  }
}

/** `search` without its `claim` param (dropped once the guest has joined). */
export function withoutClaim(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("claim");
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

/** The claim as a request field: `{claim}` when there is one, else nothing
 *  (an older server, or a plain join link). */
export function claimField(claim: string | null | undefined): { claim?: string } {
  return claim !== null && claim !== undefined && claim !== "" ? { claim } : {};
}

/** What the join screen says when a reserved program is refused. */
export const RESERVED_TEXT = "This program is saved for an invited guest — ask a host.";

/** Is this a register refusal for a reserved program (409 `reserved`)? */
export function isReservedRefusal(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409 && /^reserved$/i.test(e.message.trim());
}

/** What a failed register says on the join screen: the reserved message,
 *  else the server's own words. */
export function registerErrorText(e: unknown): string {
  if (isReservedRefusal(e)) return RESERVED_TEXT;
  return e instanceof Error ? e.message : "Couldn't join — try again.";
}
