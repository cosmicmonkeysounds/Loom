//! Can this tablet draw the world view? three r186 needs **WebGL2** (WebGL1
//! was dropped in r163), and the show's oldest tablets (GLES2-only GPUs, a
//! locked-down WebView) have none. Without it the world view would fail,
//! fall back, retry 15 s later and fail again forever — "SIMULATION
//! UNAVAILABLE" on a loop. Probed once at boot instead: no WebGL2 → the
//! terminal behaves as `view=face` (the face, the scanner, the line) and
//! never loads three.js; a mirror shows a still notice.

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

/**
 * The view this tablet can actually show: `auto` / `world` drop to `face`
 * without WebGL2 (a mirror stays a mirror — it has no face to fall back to,
 * so it shows a notice instead of the world, and so does a shadow; the TV keeps its face and just
 * never raises the world pane).
 */
export function effectiveView(view: TerminalView, webgl2: boolean): TerminalView {
  if (webgl2 || view === "face" || view === "mirror" || view === "tv" || view === "shadow") return view;
  return "face";
}
