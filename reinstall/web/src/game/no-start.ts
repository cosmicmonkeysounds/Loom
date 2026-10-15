//! Why a game didn't start — pure. Only a renderer that won't come up is
//! "no WebGL2"; anything else the `Game` constructor trips on (the dealt
//! map, the spawn) is shown as itself, so the tent operator isn't sent off
//! to find another browser for a problem a headset would have too.

/** Said wherever this browser would otherwise start a game it can't draw
 *  (three r186 needs WebGL2: the wizard probes for it before "Play here"). */
export const NO_WEBGL2 =
  "This browser can't draw the simulation: it has no WebGL2 (3D graphics are switched off or unsupported). Send the program to a headset, or open this page in a current Chrome, Safari or Firefox with hardware acceleration on.";

/** Thrown by the `Game` when its `WebGLRenderer` won't construct (the probe missed: a context that exists but won't start). */
export class NoRenderer extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "NoRenderer";
  }
}

/** What the player is told when `new Game(…)` throws `e`. */
export function whyNoStart(e: unknown): string {
  if (e instanceof NoRenderer) return NO_WEBGL2;
  const message = e instanceof Error ? e.message : String(e);
  return `This device couldn't start the simulation (${message}).`;
}
