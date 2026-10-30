//! The descent's words (wave 49, `docs/loom-w49-contract.md` C3.2): where an
//! event's `descent.json` comes from, read live (`live-file.ts`: the project's
//! file, else `LOOM_DESCENT`, else, with no project, the scenario's own), so a
//! sign-off edit needs no new APK. `@loom/house` `descent.ts` owns the schema
//! and every decision made with it; the server only serves the file.

import { DESCENT_FILE, validateDescent, type DescentScript } from "@loom/house";

import { LIVE_FILE_CACHE_MS, LiveFileSource, type LiveFileOptions, type LiveFileRead } from "./live-file.ts";

export { DESCENT_FILE } from "@loom/house";

export const DESCENT_CACHE_MS = LIVE_FILE_CACHE_MS;

/** One read: the script (null = none usable), where from, its problems. */
export type DescentRead = LiveFileRead<DescentScript>;

/** `descent.json`'s text as a script (null when it doesn't validate). */
export function parseDescentText(text: string): { file: DescentScript | null; problems: string[]; warnings: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { file: null, problems: [`not JSON (${err instanceof Error ? err.message : String(err)})`], warnings: [] };
  }
  const v = validateDescent(raw);
  return { file: v.ok ? (raw as DescentScript) : null, problems: v.problems, warnings: v.warnings };
}

export class DescentSource extends LiveFileSource<DescentScript> {
  constructor(opts: LiveFileOptions) {
    super({ label: "descent", fileName: DESCENT_FILE, parse: parseDescentText }, opts);
  }
}
