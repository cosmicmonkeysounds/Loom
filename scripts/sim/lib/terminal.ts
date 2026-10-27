// The heart terminal spec's pure helpers (heart.spec.ts): how a pick reads
// in the thread, the number key of an option, whether a box sits inside the
// viewport, and the guard's decision without a terminal to ask y/N on.
// Pure, for `node --test`.

import { judge } from "../../accept/live-guard.ts";
import { isScratch } from "./safety.ts";

export { echoOf } from "../../../core/src/pick-echo.ts";

/** The key that picks option `index` at the terminal (terminal/src/heart/heart.ts `optionKey`). */
export function optionKey(index: number): string | null {
  if (index < 0) return null;
  if (index < 9) return String(index + 1);
  if (index === 9) return "0";
  const letter = index - 10;
  return letter < 26 ? String.fromCharCode(97 + letter) : null;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Is a box wholly inside the viewport (and inside `clip`, the list it scrolls in, when given)? */
export function boxInside(b: Box | null, view: { width: number; height: number }, clip?: Box | null): boolean {
  if (b === null || b.width <= 0 || b.height <= 0) return false;
  const inView = b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= view.width + 0.5 && b.y + b.height <= view.height + 0.5;
  if (!inView) return false;
  if (clip === undefined || clip === null) return true;
  return b.y >= clip.y - 0.5 && b.y + b.height <= clip.y + clip.height + 0.5;
}

/** How many times `text` stands as a whole line in `lines`. */
export function occurrences(lines: readonly string[], text: string): number {
  return lines.filter((l) => l.trim() === text.trim()).length;
}

/**
 * The spec's guard (no TTY in a Playwright worker, so the y/N is an env):
 * a real guest on the roster refuses unless `live`; a server that is not a
 * scratch server on this laptop refuses unless `yes` (`SIM_YES=1`, which
 * `scripts/sim/heart.ts` sets after its own y/N).
 */
export function heartGuard(o: { base: string; roster: ReadonlyArray<{ id: string; name: string }> | undefined; yes: boolean; live: boolean }): { ok: true } | { ok: false; reason: string } {
  const v = judge(o.roster, o.live, "drive the heart terminal");
  if (!v.ok) return v;
  if (!o.yes && !isScratch(o.base)) {
    return { ok: false, reason: `${o.base} is not a scratch server on this laptop: run it through scripts/sim/heart.ts (it asks y/N), or set SIM_YES=1 once you have checked the event is a rehearsal` };
  }
  return { ok: true };
}
