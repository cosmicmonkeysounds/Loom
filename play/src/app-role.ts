//! Which app a fresh page opens on (wave 13 fix round), moved out of
//! `director.tsx` so the role chooser (`ui.tsx`) can lazy-load the director
//! cue sheet, the booth and the host console: a guest's first load is the
//! guest app only. `director.tsx` re-exports every name (frozen signatures).

import { claimFromSearch } from "./claim.ts";
import { landingLink } from "./guest-scan.tsx";

/** Where the phone keeps its director sign-in. */
export const DIRECTOR_KEY = "loom.director";

/** `?role=director` opens this page. */
export function directorFromSearch(search: string): boolean {
  try {
    return new URLSearchParams(search).get("role") === "director";
  } catch {
    return false;
  }
}

export type AppRole = "none" | "guest" | "prime" | "director";

/** The role a fresh page opens on: `?role=director` whatever the phone
 *  holds, else the stored session (guest, performer, then director), else
 *  a guest's link: an invitation's `?claim=` (the guest join) or a wall
 *  QR's `?unlock=` / `?checkin=` (the guest app's wrong-browser landing). */
export function initialRole(search: string, stored: (key: string) => string | null): AppRole {
  if (directorFromSearch(search)) return "director";
  if (stored("loom.guest")) return "guest";
  if (stored("loom.prime")) return "prime";
  if (stored(DIRECTOR_KEY)) return "director";
  if (claimFromSearch(search) !== null || landingLink(search) !== null) return "guest";
  return "none";
}

/** A `?code=` link opens what its code is for — the mod code the cue sheet,
 *  a performer code the performer sign-in (the cast card's QR) — but only
 *  from the chooser, never over a signed-in guest or performer. A guest
 *  code stays on the chooser. */
export function roleForBrand(role: AppRole, brandRole: string | null | undefined): AppRole {
  if (role !== "none") return role;
  if (brandRole === "mod") return "director";
  if (brandRole === "prime") return "prime";
  return role;
}
