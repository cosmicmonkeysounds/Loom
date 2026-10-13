//! `@loom/house/three` — a house map as a three.js scene, shared by the web
//! game (`reinstall/web`) and the terminals' world view so they always look
//! alike: walls / floors / ceilings / ramps / rails / props / terminal
//! screens / room labels (`buildHouseScene`), Gerald the golden duck
//! (`createDuck`), the indicator trail (`createTrail`), player ghosts
//! (`createAvatar`) with pure pose interpolation (`PoseBuffer`), and space
//! transforms as a parent group (`spaceGroup`). Peer dependency `three`.
//!
//! Renderer-agnostic and DOM-light: everything constructs under node (no
//! WebGL, no canvas — textures and labels fall back to plain colours /
//! nothing); creating the `WebGLRenderer` is the app's job. No React.
//! Normative: `docs/loom-reinstall.md` §1.3.

export { buildHouseScene, houseAtmosphere, planeGeometry, rampGeometry } from "./scene.ts";
export type { HouseScene, HouseSceneOptions } from "./scene.ts";
export { createDuck, DUCK_FLIGHT } from "./duck.ts";
export type { Duck } from "./duck.ts";
export { createTrail, chevronGeometry, TRAIL_STEP, TRAIL_LIFT } from "./trail.ts";
export type { Trail, TrailOptions } from "./trail.ts";
export { createAvatar, avatarColor, AVATAR_HEIGHT } from "./avatar.ts";
export type { Avatar } from "./avatar.ts";
export { PoseBuffer, lerpYaw } from "./pose.ts";
export type { PoseBufferOptions } from "./pose.ts";
export { spaceGroup, applySpace } from "./space.ts";
export { labelPoint, trailPoints, wallBoxes, wallKindThickness } from "./layout.ts";
export type { TrailPoint, WallBox } from "./layout.ts";
export { PALETTE, hasDom } from "./textures.ts";
