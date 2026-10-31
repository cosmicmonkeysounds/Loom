//! Through their eyes (wave 54, `docs/loom-w54-contract.md`). A placed
//! terminal linked to its room shows the room through the eyes of the
//! program in it, and only when that program is close to it, or in its view,
//! does it go back to what it always showed (the mirror: the camera with the
//! ghosts in it, or the window into the virtual room).
//!
//! The picture is drawn here from the pose stream, so the web game and the
//! VR game need nothing: both send the same poses. The rule is pure so the
//! world view, the shadow's slot and the raycaster all agree:
//!
//! - **Seen** (`seenBy`): on the terminal's floor with nothing in between,
//!   and within `CLOSE_M`, or within `IN_VIEW_M` inside its horizontal fov.
//!   Anyone seen brings the mirror, in that player's room or not.
//! - **The mirror goes on at once and comes off late** (`MIRROR_HOLD_MS`, and
//!   the ranges stretch by `SEEN_SLACK` while it holds), so a walker on the
//!   edge never flickers the pane, which swaps a GL context on a shadow wall.
//! - **The wearer** is kept while they are in the room, and for the room's
//!   own linger after (`PRESENCE_LINGER_MS`) so a walker leaving goes out of
//!   the door on screen; else the freshest program in the room.

import { useEffect, useState } from "react";
import { forward, horizontalFov, PRESENCE_LINGER_MS, roomById, type HouseMap, type TerminalSpot, type Vec3, type WallSegment } from "@loom/house";
import { firstHit, windowPose } from "./director.ts";
import { byActivity } from "./state.ts";
import type { WorldStore } from "./stream.ts";

/** Within this far of the terminal (metres, in plan) a program is close, whichever way the terminal looks. */
export const CLOSE_M = 1.5;
/** Within this far and inside the terminal's view it is in view; past it a program is only across the room. */
export const IN_VIEW_M = 2.5;
/** The screen shape the view is judged for (the tablets are 16:10). */
export const VIEW_ASPECT = 1.6;
/** Where on a body the terminal's line of sight lands (metres above the feet). */
export const SIGHT_HEIGHT = 1.2;
/** How long the mirror holds after the last program seen (ms). */
export const MIRROR_HOLD_MS = 2000;
/** The ranges stretch this much while the mirror holds. */
export const SEEN_SLACK = 1.25;
/** How often a terminal judges (ms): poses arrive at 10 Hz, and a cut needs no more. */
export const EYES_TICK_MS = 200;

/** What the rule needs of a player. */
export interface EyesPlayer {
  session: string;
  /** Feet, house frame. */
  p: Vec3;
  room: string | null;
  floor: string;
}

/** The camera's tag while it is wearing a program. */
export function eyesTag(name: string): string {
  return `THROUGH ${name.toUpperCase()}'S EYES`; // DRAFT w54
}

/** Is this player close to the terminal, or in its view (`slack` stretches both ranges)? */
export function seenBy(house: HouseMap, walls: readonly WallSegment[], spot: TerminalSpot, player: Pick<EyesPlayer, "p" | "floor">, slack = 1): boolean {
  const floor = roomById(house, spot.room)?.floor;
  if (floor !== undefined && player.floor !== floor) return false;
  const cam = windowPose(house, spot);
  const dx = player.p[0] - cam.pos[0];
  const dz = player.p[2] - cam.pos[2];
  const dist = Math.hypot(dx, dz);
  if (dist > IN_VIEW_M * slack) return false;
  if (dist > CLOSE_M * slack) {
    const f = forward(spot.yaw, 0);
    const cos = (dx * f[0] + dz * f[2]) / (dist * Math.hypot(f[0], f[2]));
    const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    if (angle > horizontalFov(cam.fov, VIEW_ASPECT) / 2) return false;
  }
  return firstHit(walls, cam.pos, [player.p[0], player.p[1] + SIGHT_HEIGHT, player.p[2]]) >= 1;
}

/** Decides whose eyes a terminal looks through. Fed the clock. */
export class EyesJudge {
  private wearer: string | null = null;
  private wearerHereAt = 0;
  private seenAt: number | null = null;

  /** The session to look through at `now` (ms), null for the mirror. `players` freshest first. */
  update(house: HouseMap, walls: readonly WallSegment[], spot: TerminalSpot, players: readonly EyesPlayer[], now: number): string | null {
    const holding = this.seenAt !== null && now - this.seenAt < MIRROR_HOLD_MS;
    if (players.some((p) => seenBy(house, walls, spot, p, holding ? SEEN_SLACK : 1))) {
      this.seenAt = now;
      this.wearer = null;
      return null;
    }
    if (holding) return null;
    const worn = players.find((p) => p.session === this.wearer);
    if (worn?.room === spot.room) this.wearerHereAt = now;
    if (worn !== undefined && now - this.wearerHereAt < PRESENCE_LINGER_MS) return worn.session;
    this.wearer = players.find((p) => p.room === spot.room)?.session ?? null;
    this.wearerHereAt = now;
    return this.wearer;
  }
}

/** `EyesJudge` on a terminal's stream: the session to look through, null for the mirror (or no spot). */
export function useEyes(store: WorldStore, spotId: string): string | null {
  const [eyes, setEyes] = useState<string | null>(null);
  useEffect(() => {
    if (spotId.trim() === "") return;
    const judge = new EyesJudge();
    const tick = () => {
      const { house, world } = store.snapshot;
      const spot = house?.house.terminals.find((t) => t.id === spotId);
      if (!house || !spot) return setEyes(null);
      setEyes(judge.update(house.house, house.walls, spot, byActivity(world).map((p) => ({ session: p.session, p: p.pose.p, room: p.room, floor: p.floor })), Date.now()));
    };
    tick();
    const timer = window.setInterval(tick, EYES_TICK_MS);
    return () => window.clearInterval(timer);
  }, [store, spotId]);
  return eyes;
}
