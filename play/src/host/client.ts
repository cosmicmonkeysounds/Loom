//! The host booth's client (wave 13; the host lane fills it): polls the
//! host view (`GET /e/<id>/api/state?role=mod&host=1`) and writes to the
//! host allowlist. Stage A: a stub that never fetches.

import type { HostView } from "../types.ts";

export function useHostView(_auth: { token: string; eventId: string } | null): { view: HostView | null; error: string | null; refresh: () => void } {
  return { view: null, error: null, refresh() {} };
}
