//! `@loom/house` — the house map shared by the reinstallation games (VR +
//! web), the event server and the wall terminals: schema + wire types,
//! validation, procedural geometry, locate, routing, space transforms and
//! the duck picker. Pure TS, no `node:` imports (it runs under node on the
//! server and in the browser). The three.js scene builder is the
//! `@loom/house/three` subpath. Normative: `docs/loom-reinstall.md`.

export type * from "./types.ts";
export * from "./clone.ts";
export * from "./validate.ts";
export * from "./geometry.ts";
export * from "./locate.ts";
export * from "./route.ts";
export * from "./frames.ts";
export * from "./duck.ts";
export * from "./king.ts";
