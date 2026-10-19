//! The heart terminal's file panel (wave 11): at a room terminal (the
//! server-room one) a piloted program can hand the character codex entries —
//! "📎 GIVE HIM A FILE". The entries are the guest's own (`GuestView.codex`,
//! off the pilot's stream); a Give is the guest's own share (`POST
//! /api/guest/codex/share {entry, to}` with the pilot token, so the story
//! hears it exactly as from the phone); a code typed in or a codex QR held
//! to the camera (`?unlock=`) is the guest's own redeem (`POST
//! /api/guest/codex/redeem {code}`), and the entry it unlocks is then
//! offered to give. The server's refusals are shown as it words them (an
//! agent won't take an entry about someone else: 403).

import { api, ApiError } from "@loom/play/client.ts";
import type { CodexEntry } from "@loom/play/types.ts";
import { baseOf, type TerminalConfig } from "./config.ts";
import type { Pilot } from "./pilot.ts";
import { parseScan } from "./scan.ts";

export type FileOutcome = { ok: true } | { ok: false; error: string };

function why(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return `the house didn't answer (${(e as Error).message})`;
}

/** Give `entry` to `to` (the character's id), as the piloted guest. */
export async function giveEntry(config: Pick<TerminalConfig, "eventId">, pilot: Pick<Pilot, "token">, entry: string, to: string, call: typeof api = api): Promise<FileOutcome> {
  try {
    await call(`${baseOf(config)}/api/guest/codex/share`, { entry, to }, pilot.token);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: why(e) };
  }
}

export type RedeemOutcome = { ok: true; unlocked: string | null; codex: CodexEntry[] | null } | { ok: false; error: string };

/** Redeem a typed / scanned unlock code for the piloted guest. `unlocked`
 *  is the entry id it opened (null: a wrong code — the story heard the miss). */
export async function redeemCode(config: Pick<TerminalConfig, "eventId">, pilot: Pick<Pilot, "token">, code: string, call: typeof api = api): Promise<RedeemOutcome> {
  const c = code.trim();
  if (c === "") return { ok: false, error: "type a code" };
  try {
    const r = await call<{ unlocked?: unknown; codex?: unknown }>(`${baseOf(config)}/api/guest/codex/redeem`, { code: c }, pilot.token);
    return { ok: true, unlocked: typeof r.unlocked === "string" ? r.unlocked : null, codex: Array.isArray(r.codex) ? (r.codex as CodexEntry[]) : null };
  } catch (e) {
    return { ok: false, error: why(e) };
  }
}

/** The unlock code in a scanned codex QR (`…/?code=<event>&unlock=<code>`),
 *  a bare code, or null (a pass, a join QR with no code, junk). */
export function unlockOfScan(text: string): string | null {
  const hit = parseScan(text);
  if (hit.kind === "wall") return hit.unlock !== null && hit.unlock.trim() !== "" ? hit.unlock.trim() : null;
  if (hit.kind === "unknown") {
    const t = hit.text.trim();
    // A bare code printed under a QR: one short token, no spaces.
    return /^[A-Za-z0-9_-]{2,32}$/u.test(t) ? t : null;
  }
  return null; // a pass
}

/** The entries to list: the stream's snapshot (it keeps moving — a story
 *  grant, a share from another program, a code redeemed on the phone) plus
 *  anything a redeem here answered that the snapshot hasn't caught up with
 *  yet. A union by id (the stream's copy wins); sorted by title. Entries
 *  are only ever gained, so the union is never stale. */
export function filesOf(view: { codex?: CodexEntry[] } | null, fresher: CodexEntry[] | null): CodexEntry[] {
  const byId = new Map<string, CodexEntry>();
  for (const e of fresher ?? []) byId.set(e.id, e);
  for (const e of view?.codex ?? []) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** An unlock code as the story matches it (case, dashes, underscores and
 *  spaces are noise — core's `foldCode`). */
export function foldCode(code: string): string {
  return code.trim().toLowerCase().replace(/[\s_\-]+/gu, "");
}

/** What one camera read in the file panel does. */
export type ScanStep =
  /** A redeem is in flight: the read is dropped. */
  | { kind: "ignore" }
  /** Not a file's QR (a pass, a join QR, junk). */
  | { kind: "bad" }
  /** A code this panel already unlocked: show that entry again, no server call. */
  | { kind: "again"; entry: string }
  /** A new code: redeem it (once — the panel stops the camera). */
  | { kind: "redeem"; code: string };

/**
 * Decide a camera read. The camera keeps reporting a QR held in front of it
 * (every few seconds), and every redeem is a journaled command — a wrong
 * one fires the story's `wrong code` and counts toward the guest's redeem
 * lockout — so a read is redeemed at most once: never while one is in
 * flight, never a code this panel already unlocked (`redeemed`: folded
 * code → entry id). The panel also stops the camera after a read it redeems.
 */
export function scanStep(text: string, o: { busy: boolean; redeemed: ReadonlyMap<string, string> }): ScanStep {
  if (o.busy) return { kind: "ignore" };
  const code = unlockOfScan(text);
  if (code === null) return { kind: "bad" };
  const entry = o.redeemed.get(foldCode(code));
  return entry !== undefined ? { kind: "again", entry } : { kind: "redeem", code };
}
