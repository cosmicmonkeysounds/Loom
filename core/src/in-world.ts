//! A LOCATION's `label:` as a player reads it, for the server and the phones.

/**
 * Wave 59: what sits in brackets, or after a ` — `, is the crew's note (the
 * real room, what happens there): `The Start Bar (kitchen)` reads `The Start
 * Bar`, `The Optical Drive (mud room) — Login` reads `The Optical Drive`. Only
 * crew tools show the whole label.
 */
export function inWorldLabel(label: string): string {
  const name = label.replace(/\s*\([^()]*\)/gu, "").replace(/\s+[—–]\s.*$/u, "").trim();
  return name === "" ? label : name;
}
