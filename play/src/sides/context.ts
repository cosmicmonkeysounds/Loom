//! What the doors and the invite card need from the guest app (wave 18):
//! the live view (the sides' head counts, the invitations) and the C10
//! calls. The guest app provides it; a booth or the editor's read-only
//! render has none, and the cards then render read-only.

import { createContext, useContext } from "react";
import type { SidesCalls } from "../session/guest.ts";
import type { GuestView } from "../types.ts";

export interface SidesCtx {
  view: GuestView | null;
  calls: SidesCalls | null;
}

export const SidesContext = createContext<SidesCtx>({ view: null, calls: null });

export function useSides(): SidesCtx {
  return useContext(SidesContext);
}
