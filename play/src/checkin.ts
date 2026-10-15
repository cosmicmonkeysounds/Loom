//! Room check-in by QR (K-13). Each room's sign carries the join link plus
//! `&checkin=<slug>` (`…/?code=EVT&checkin=the-cache`); a phone's own
//! camera opens it in the browser the guest joined in, and the guest
//! session posts `/api/guest/checkin {at: slug}` once signed in. The server
//! folds the slug onto the exact LOCATION and the story moves the guest.
//! Pure helpers — unit-tested in `test/checkin.test.ts`.

/** The room slug riding a scanned sign's link (`?checkin=…`), or null. */
export function checkinFromSearch(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get("checkin");
    return v !== null && v.trim() !== "" ? v.trim() : null;
  } catch {
    return null;
  }
}

/** `search` without its `checkin` param (so a reload doesn't check in twice). */
export function withoutCheckin(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("checkin");
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

