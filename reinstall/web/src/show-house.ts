//! The show's house map, bundled as the offline fallback (§1.3: "each also
//! bundles the show's file") — what the game plays and the map page shows
//! when the event server can't hand over the event's own map.

import type { HouseMap } from "@loom/house";
import raw from "../../../core/examples/trapped-in-the-internet/house.json";

export const showHouse = raw as unknown as HouseMap;
