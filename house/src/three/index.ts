//! `@loom/house/three` — a house map as a three.js scene, shared by the web
//! game (`reinstall/web`) and the terminals' world view so they always look
//! alike: walls / floors / ceilings / ramps / rails / props / terminal
//! screens / room labels (`buildHouseScene`), Gerald the golden duck
//! (`createDuck`), the King (`createKing`, his shared bar + kneel via
//! `HouseScene.showKing`), the indicator trail (`createTrail`), player ghosts
//! wearing their profile pictures (`createAvatar`, `loadPicture`) with pure
//! pose interpolation (`PoseBuffer`), and space
//! transforms as a parent group (`spaceGroup`). Peer dependency `three`.
//!
//! Renderer-agnostic and DOM-light: everything constructs under node (no
//! WebGL, no canvas — textures and labels fall back to plain colours /
//! nothing); creating the `WebGLRenderer` is the app's job. No React.
//! Normative: `docs/loom-reinstall.md` §1.3.

export { buildHouseScene, houseAtmosphere, planeGeometry, rampGeometry, FEED_W, FEED_H } from "./scene.ts";
export type { HouseScene, HouseSceneOptions } from "./scene.ts";
export { createDuck, DUCK_FLIGHT } from "./duck.ts";
export type { Duck } from "./duck.ts";
export { createKing, KING_KNEEL, KING_STAGGER, KING_COLOR } from "./king.ts";
export type { King } from "./king.ts";
export { createTrail, chevronGeometry, TRAIL_STEP, TRAIL_LIFT } from "./trail.ts";
export type { Trail, TrailOptions } from "./trail.ts";
export { createAvatar, avatarColor, AVATAR_HEIGHT, PICTURE_SIZE } from "./avatar.ts";
export type { Avatar, AvatarOptions } from "./avatar.ts";
export { loadPicture, PICTURE_PX } from "./picture.ts";
export { PoseBuffer, lerpYaw } from "./pose.ts";
export type { PoseBufferOptions } from "./pose.ts";
export { spaceGroup, applySpace } from "./space.ts";
export { labelPoint, trailPoints, wallBoxes, wallKindThickness } from "./layout.ts";
export type { TrailPoint, WallBox } from "./layout.ts";
export { PALETTE, BAR_CELLS_MAX, hasDom } from "./textures.ts";
