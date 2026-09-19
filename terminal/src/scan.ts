//! What a scanned QR means to a terminal. A guest's **pass** (the play app's
//! "Your pass" sheet) is a QR of their guest id — `g-3f9a1c` (a persona
//! spawned from the editor is `p-…`). The walls also carry the codex QRs
//! (`…/?code=<event>&unlock=<code>`) and the join QR (`…/?code=<event>`);
//! a terminal recognises those so it can say "that's a wall code — show me
//! your pass" instead of staring blankly.

export type ScanHit =
  | { kind: "guest"; id: string }
  | { kind: "wall"; unlock: string | null }
  | { kind: "unknown"; text: string };

/** A guest / persona id as the server mints them. */
const GUEST_ID = /^[gp]-[0-9a-f]{6}$/i;

export function parseScan(raw: string): ScanHit {
  const text = raw.trim();
  if (text === "") return { kind: "unknown", text };
  if (GUEST_ID.test(text)) return { kind: "guest", id: text.toLowerCase() };
  // A join / codex link — a URL with `?code=` (and maybe `&unlock=`).
  try {
    const url = new URL(text);
    if (url.searchParams.has("code")) return { kind: "wall", unlock: url.searchParams.get("unlock") };
    // A pass link some future app might print: the id as a path or query.
    const id = url.searchParams.get("pass") ?? url.searchParams.get("guest");
    if (id !== null && GUEST_ID.test(id)) return { kind: "guest", id: id.toLowerCase() };
  } catch {
    /* not a URL */
  }
  return { kind: "unknown", text };
}

/**
 * The typed fallback for a tablet with no camera (or one the browser will
 * not open on plain http): a program types the name they registered with.
 * Case, spaces, dashes and underscores fold; a unique match pilots.
 */
export function matchName(typed: string, roster: ReadonlyArray<{ id: string; name: string }>): { kind: "one"; id: string; name: string } | { kind: "many"; names: string[] } | { kind: "none" } {
  const fold = (s: string) => s.toLowerCase().replace(/[\s_\-.]+/g, "");
  const q = fold(typed);
  if (q === "") return { kind: "none" };
  // A typed id wins outright.
  const byId = roster.find((r) => r.id.toLowerCase() === typed.trim().toLowerCase());
  if (byId !== undefined) return { kind: "one", id: byId.id, name: byId.name };
  const exact = roster.filter((r) => fold(r.name) === q);
  if (exact.length === 1) return { kind: "one", id: exact[0]!.id, name: exact[0]!.name };
  if (exact.length > 1) return { kind: "many", names: exact.map((r) => r.name) };
  const loose = roster.filter((r) => fold(r.name).includes(q));
  if (loose.length === 1) return { kind: "one", id: loose[0]!.id, name: loose[0]!.name };
  if (loose.length > 1) return { kind: "many", names: loose.map((r) => r.name) };
  return { kind: "none" };
}
