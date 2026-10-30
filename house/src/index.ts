//! `@loom/house` — the house map shared by the reinstallation games (VR +
//! web), the event server and the wall terminals: schema + wire types,
//! validation, procedural geometry, locate, routing, space transforms, the
//! duck picker, and the voice link's codec + who-hears-whom. Pure TS, no
//! `node:` imports (it runs under node on the server and in the browser).
//! The three.js scene builder is the `@loom/house/three` subpath.
//! Normative: `docs/loom-reinstall.md`.

export type * from "./types.ts";
export * from "./clone.ts";
export * from "./validate.ts";
export * from "./geometry.ts";
export * from "./locate.ts";
export * from "./route.ts";
export * from "./frames.ts";
export * from "./duck.ts";
export * from "./king.ts";
export * from "./escape.ts";
export * from "./presence.ts";
export * from "./moment.ts";
export * from "./descent.ts";
export * from "./models.ts";
export * from "./audio.ts";
export * from "./footsteps.ts";
export * from "./lights.ts";
export * from "./lights-presence.ts";
export * from "./voice.ts";
export * from "./look-edit.ts";
export * from "./look-preview.ts";
export * from "./look-templates.ts";
