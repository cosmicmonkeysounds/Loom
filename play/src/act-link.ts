// A printed sign that presses one of the guest's own buttons (wave 54; the
// show: 🚻 Bathroom Mode). The link is `…/?code=<event>&act=<interaction>`:
// a phone's camera opens it in the browser the guest joined in and the
// session posts `/api/guest/act` once, the same press as the Start menu's.
// Pure helpers, `test/w54-badges.test.tsx`.

/** The interaction riding a scanned sign's link (`?act=…`), or null. */
export function actFromSearch(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get("act");
    return v !== null && v.trim() !== "" ? v.trim() : null;
  } catch {
    return null;
  }
}

/** `search` without its `act` param (so a reload never presses it twice). */
export function withoutAct(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("act");
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}
