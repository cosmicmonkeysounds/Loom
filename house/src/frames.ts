//! House ⇄ space transforms — `docs/loom-reinstall.md` §1 "Spaces".
//! `world = Ry(yaw) · (scale · house) + offset`; every pose on the wire is in
//! house coordinates, so a game converts with its own space before sending
//! and after receiving. A missing transform is the identity.

import type { HouseMap, SpaceTransform, Vec3 } from "./types.ts";

export const IDENTITY_SPACE: SpaceTransform = Object.freeze({
  offset: Object.freeze([0, 0, 0]) as unknown as Vec3,
  yaw: 0,
  scale: 1,
}) as SpaceTransform;

/** The named space of a house (`"vr"`, `"web"`), identity when missing. */
export function spaceOf(house: HouseMap, name: string): SpaceTransform {
  return house.spaces[name] ?? IDENTITY_SPACE;
}

/** Wrap degrees into [−180, 180). */
export function wrapYaw(yaw: number): number {
  const w = (((yaw + 180) % 360) + 360) % 360 - 180;
  return w + 0;
}

/** Rotate a point about +y by `deg` (counter-clockwise seen from above). */
function rotateY(p: Vec3, deg: number): Vec3 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

/** House → space. */
export function toSpace(t: SpaceTransform | undefined, p: Vec3): Vec3 {
  const { offset, yaw, scale } = t ?? IDENTITY_SPACE;
  const r = rotateY([p[0] * scale, p[1] * scale, p[2] * scale], yaw);
  return [r[0] + offset[0], r[1] + offset[1], r[2] + offset[2]];
}

/** Space → house. */
export function fromSpace(t: SpaceTransform | undefined, p: Vec3): Vec3 {
  const { offset, yaw, scale } = t ?? IDENTITY_SPACE;
  const r = rotateY([p[0] - offset[0], p[1] - offset[1], p[2] - offset[2]], -yaw);
  return [r[0] / scale, r[1] / scale, r[2] / scale];
}

/** A house yaw in the space. */
export function yawToSpace(t: SpaceTransform | undefined, yaw: number): number {
  return wrapYaw(yaw + (t ?? IDENTITY_SPACE).yaw);
}

/** A space yaw in the house. */
export function yawFromSpace(t: SpaceTransform | undefined, yaw: number): number {
  return wrapYaw(yaw - (t ?? IDENTITY_SPACE).yaw);
}

/** The unit forward vector (house frame) of a yaw/pitch, degrees; pitch > 0 looks up. */
export function forward(yaw: number, pitch = 0): Vec3 {
  const y = (yaw * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  return [-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
}

// ── Terminal cameras (§1.1 `TerminalSpot.fov`) ───────────────────────

/**
 * A terminal spot's field of view when `fov` is unset: the **vertical** fov
 * in degrees, as three.js's `PerspectiveCamera.fov` (and Godot's
 * `Camera3D.fov` under its default `keep_aspect = KEEP_HEIGHT`).
 */
export const DEFAULT_SPOT_FOV = 70;

/** The wall tablets are landscape, about 16:10 (width / height). */
export const TABLET_ASPECT = 16 / 10;

/**
 * The horizontal field of view (degrees) that a vertical one (degrees)
 * gives at an aspect (width / height): `2·atan(tan(vfov/2)·aspect)`. The
 * default spot (70° vertical) on a 16:10 tablet sees ≈ 96.5° across.
 */
export function horizontalFov(vfovDeg: number, aspect = TABLET_ASPECT): number {
  return (2 * Math.atan(Math.tan((vfovDeg * Math.PI) / 360) * aspect) * 180) / Math.PI;
}
