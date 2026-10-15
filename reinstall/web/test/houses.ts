//! House maps for the suites: `@loom/house`'s own conformance fixtures
//! (small, hand-checkable) and the show's map, each validated + normalized
//! exactly as the game receives them.

import { validateHouse } from "@loom/house";
import type { HouseMap } from "@loom/house";
import twoRooms from "../../../house/test/fixtures/two-rooms.json";
import stair from "../../../house/test/fixtures/stair.json";
import lRoom from "../../../house/test/fixtures/l-room.json";
import { showHouse } from "../src/show-house.ts";
import showShed from "../../../core/examples/trapped-in-the-internet/house.shed.json";
import twoFloor from "../../../house/test/maps/two-floor.json";
import twoFloorShed from "../../../house/test/maps/two-floor.shed.json";

function load(raw: unknown): HouseMap {
  const v = validateHouse(structuredClone(raw));
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("; "));
  return v.house;
}

/** Rooms a [0..4]×[0..3] and b [4..7]×[0..3]; a door a↔b at (4, 1.5) w 1,
 *  a front door from a to the outside at (2, 0) w 0.9. */
export const TWO_ROOMS = (): HouseMap => load(twoRooms);
/** Cellar (y −3) under a hall (y 0), both [0..5]×[0..4]; the stair's rect
 *  [1, 1, 4, 2] rises east (rails on the hall's n / s / w sides). */
export const STAIR = (): HouseMap => load(stair);
/** One 7-vertex L-shaped room. */
export const L_ROOM = (): HouseMap => load(lRoom);
export const SHOW = (): HouseMap => load(showHouse);
/** The show's rain variant (the Internet in the shed). */
export const SHOW_SHED = (): HouseMap => load(showShed);
/** The show's map as it stood before the real floor plan (two floors, the
 *  tent / the shed), frozen: the suites that pin coordinates use it, so they
 *  don't move with the live map (`@loom/house` golden.ts `TWO_FLOOR_HOUSE`). */
export const TWO_FLOOR = (): HouseMap => load(twoFloor);
export const TWO_FLOOR_SHED = (): HouseMap => load(twoFloorShed);
