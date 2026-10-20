//! Can this tablet draw the world view? three r186 needs **WebGL2** (WebGL1
//! was dropped in r163), and the show's oldest tablets (GLES2-only GPUs, a
//! locked-down WebView) have none. Without it the world view would fail,
//! fall back, retry 15 s later and fail again forever — "SIMULATION
//! UNAVAILABLE" on a loop. Probed once at boot instead: no WebGL2 → the
//! terminal never loads three.js and draws the simulation as the 2D live
//! plan (`plan/`, Canvas 2D) wherever it would have drawn the world.

import type { TerminalView } from "./config.ts";

/** Something that makes canvases (a `Document`, or a test fake). */
export interface CanvasMaker {
  createElement(tag: "canvas"): { getContext(kind: "webgl2"): unknown };
}

let cached: boolean | null = null;

/** Probe for a WebGL2 context (the context is released straight away). Never throws. */
export function probeWebGL2(doc: CanvasMaker | undefined = typeof document === "undefined" ? undefined : document): boolean {
  if (doc === undefined) return false;
  try {
    const gl = doc.createElement("canvas").getContext("webgl2") as
      | { getExtension?(name: string): { loseContext?(): void } | null }
      | null
      | undefined;
    if (gl === null || gl === undefined) return false;
    gl.getExtension?.("WEBGL_lose_context")?.loseContext?.();
    return true;
  } catch {
    return false;
  }
}

/** `probeWebGL2()` for this page, asked once. */
export function hasWebGL2(): boolean {
  cached ??= probeWebGL2();
  return cached;
}

/** What draws the simulation: the three.js world, or the 2D live plan
 *  (`plan/`, Canvas 2D) — on a tablet with no WebGL2, or a terminal set to
 *  `plan`. */
export type SimRenderer = "world" | "plan";

export function simRenderer(view: TerminalView, webgl2: boolean): SimRenderer {
  return view === "plan" || !webgl2 ? "plan" : "world";
}

/** What a scanner terminal's face pane shows over the face on the attract
 *  screen: nothing, the world, its shadow (the camera with the ghosts in
 *  it), or the live plan. */
export type PaneSim = "none" | SimRenderer | "shadow";

/**
 * The pane, for a scanner terminal's `view` (piloting always shows the face
 * — the voice — so the caller asks only on the attract screen): `world` /
 * `plan` always draw the simulation, `auto` only while someone `playing`;
 * `auto` with a live camera on a placed terminal (`shadowReady`) shows the
 * shadow — which needs WebGL2, so without it the plan. Every other view
 * (face; the TV, chess, casino and the full-screen views route elsewhere)
 * shows nothing over the face.
 */
export function paneSimulation(view: TerminalView, webgl2: boolean, playing: boolean, shadowReady: boolean): PaneSim {
  if (view !== "auto" && view !== "world" && view !== "plan") return "none";
  if (view === "auto" && !playing) return "none";
  const r = simRenderer(view, webgl2);
  return r === "world" && view === "auto" && shadowReady ? "shadow" : r;
}

/** A full-screen `mirror` / `shadow`: the world (or the shadow), else — no WebGL2 — the live plan. */
export function fullScreenSim(view: "mirror" | "shadow", webgl2: boolean): PaneSim {
  if (!webgl2) return "plan";
  return view === "shadow" ? "shadow" : "world";
}
