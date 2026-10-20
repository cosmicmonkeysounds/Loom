//! The shadow view's pure rules (wave 14, `view=shadow`): the camera is the
//! tablet itself — its house-map spot's pose (`mountCamera`: position, yaw,
//! pitch, the spot's vertical fov or `DEFAULT_SPOT_FOV`) — so a ghost drawn
//! through it lands where that program stands in the real room. Only players
//! on this terminal's floor and roughly in front of it are drawn.

import { forward, horizontalFov, roomById, type HouseMap, type TerminalSpot, type Vec3 } from "@loom/house";
import { mountCamera, type CameraPose } from "../world/director.ts";

/** Ghosts farther than this (metres, in plan) are not drawn. */
export const SHADOW_RANGE = 12;
/** Slack past the camera's half horizontal fov (degrees) — a ghost half in frame still shows. */
export const SHADOW_SLACK_DEG = 15;
/** Nearer than this (metres) a ghost is inside the lens: not drawn. */
export const SHADOW_NEAR = 0.3;

/** The tablet as a camera. */
export function shadowCamera(spot: TerminalSpot): CameraPose {
  return mountCamera(spot);
}

/** The floor the spot hangs on (its room's), null when the room isn't on the map. */
export function spotFloor(house: HouseMap, spot: TerminalSpot): string | null {
  return roomById(house, spot.room)?.floor ?? null;
}

/** Should a player at `p` on `floor` show in this terminal's shadow? */
export function inShadow(spot: TerminalSpot, floor: string | null, player: { p: Vec3; floor: string }, aspect: number): boolean {
  if (floor !== null && player.floor !== floor) return false;
  const dx = player.p[0] - spot.pos[0];
  const dz = player.p[2] - spot.pos[2];
  const dist = Math.hypot(dx, dz);
  if (dist > SHADOW_RANGE || dist < SHADOW_NEAR) return false;
  const f = forward(spot.yaw, 0);
  const cos = (dx * f[0] + dz * f[2]) / (dist * Math.hypot(f[0], f[2]));
  const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  const half = horizontalFov(shadowCamera(spot).fov, aspect) / 2;
  return angle <= Math.min(89, half + SHADOW_SLACK_DEG);
}

/** A user-facing (selfie) camera is shown mirrored, and the ghosts with it. */
export function mirroredFor(facing: "user" | "environment"): boolean {
  return facing === "user";
}

/** The ghosts' flicker: an opacity for time `t` (ms) and a per-ghost seed. */
export function flicker(t: number, seed: number): number {
  const slow = Math.sin(t / 420 + seed) * 0.08;
  const fast = Math.sin(t / 37 + seed * 3.1) > 0.93 ? -0.25 : 0;
  return Math.max(0.15, Math.min(0.85, 0.6 + slow + fast));
}
