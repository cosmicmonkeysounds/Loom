//! A house → space transform as a parent group — `docs/loom-reinstall.md`
//! §1 "Spaces": `world = Ry(yaw) · (scale · house) + offset`, which is
//! exactly three's `T · R · S`. Parent the house scene, the duck, the trail
//! and the ghosts under it and keep every child in house coordinates.

import { Group } from "three";
import { IDENTITY_SPACE } from "../frames.ts";
import type { SpaceTransform } from "../types.ts";
import { DEG } from "./dispose.ts";

/** A group placing house coordinates into a space (identity when omitted). */
export function spaceGroup(transform: SpaceTransform | undefined = IDENTITY_SPACE): Group {
  const g = new Group();
  g.name = "space";
  applySpace(g, transform);
  return g;
}

/** Re-apply a transform to an existing space group (the map was edited). */
export function applySpace(group: Group, transform: SpaceTransform | undefined = IDENTITY_SPACE): void {
  const t = transform ?? IDENTITY_SPACE;
  group.position.set(t.offset[0], t.offset[1], t.offset[2]);
  group.rotation.set(0, t.yaw * DEG, 0);
  group.scale.setScalar(t.scale);
  group.updateMatrix();
}
