//! The world view's counts line — pure, so it is tested without three.js.
//! A placed terminal's camera is fixed on its own room, so the room would be
//! silently empty while everyone plays elsewhere: the line says how many are
//! reinstalling and how many of them are here, in this terminal's room.

import type { TerminalSpot } from "@loom/house";

export interface WindowCounts {
  /** Everyone in the simulation. */
  total: number;
  /** In this terminal's room (always 0 for an unplaced terminal). */
  here: number;
}

export function windowCounts(players: readonly { room: string | null }[], spot: Pick<TerminalSpot, "room"> | null): WindowCounts {
  const here = spot === null ? 0 : players.filter((p) => p.room === spot.room).length;
  return { total: players.length, here };
}

/** "2 REINSTALLING · 1 HERE"; unplaced: "2 REINSTALLING"; nobody: "". */
export function countsLine(c: WindowCounts, placed: boolean): string {
  if (c.total === 0) return "";
  return placed ? `${c.total} REINSTALLING · ${c.here} HERE` : `${c.total} REINSTALLING`;
}
