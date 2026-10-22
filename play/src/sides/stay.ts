//! Why a faction card or a door offers nothing (wave 18b, faction mode),
//! said once under the list: leaders and founders stay with theirs, and a
//! restricted program moves nowhere.

import type { SideAction } from "./model.ts";

export function stayNote(act: SideAction | null): string | null {
  if (act === "leader") return "Leaders stay with their side.";
  if (act === "founder") return "Founders stay with their faction. Disband it to join another.";
  if (act === "restricted") return "Not while you're restricted.";
  return null;
}
