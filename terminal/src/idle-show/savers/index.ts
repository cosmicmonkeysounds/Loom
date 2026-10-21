//! Every screensaver the idle show rotates through (wave 17). Mystify is
//! K-16's original; the rest are new, all original art, all ≤ 30 fps.

import { beziers, mystify } from "./classic.ts";
import { bounce, ducks, rain } from "./fun.ts";
import { maze, pipes } from "./grid.ts";
import { starfield, windows } from "./space.ts";
import type { SaverDef } from "./types.ts";

export const SAVERS: readonly SaverDef[] = [mystify, starfield, pipes, bounce, windows, rain, maze, beziers, ducks];

export type SaverId = "mystify" | "starfield" | "pipes" | "bounce" | "windows" | "rain" | "maze" | "beziers" | "ducks";
export const SAVER_IDS: readonly SaverId[] = ["mystify", "starfield", "pipes", "bounce", "windows", "rain", "maze", "beziers", "ducks"];

export function saverOf(id: string): SaverDef {
  return SAVERS.find((s) => s.id === id) ?? mystify;
}

export type { SaverDef, SaverEvent, SaverInstance } from "./types.ts";
