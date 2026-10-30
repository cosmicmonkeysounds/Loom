//! The credits' source (wave 44, `docs/loom-w44-contract.md` C5): where an
//! event's `credits.json` comes from, read live (`live-file.ts`: the project's
//! file, else `LOOM_CREDITS`, else, with no project, the scenario's own). The
//! credits are no story fact, and an edit should show on the next roll with
//! no reload.

import { CREDITS_FILE, creditsProblems, parseCredits, type CreditsFile, type CreditsView } from "../src/credits.ts";
import { LIVE_FILE_CACHE_MS, LiveFileSource, type LiveFileOptions, type LiveFileRead } from "./live-file.ts";

export const CREDITS_CACHE_MS = LIVE_FILE_CACHE_MS;

export type CreditsSourceKind = NonNullable<CreditsView["source"]>;

/** One read: the parsed file (null = none usable), where from, its problems. */
export type CreditsRead = LiveFileRead<CreditsFile>;

export type CreditsSourceOptions = LiveFileOptions;

export class CreditsSource extends LiveFileSource<CreditsFile> {
  constructor(opts: CreditsSourceOptions) {
    super({ label: "credits", fileName: CREDITS_FILE, parse: (text) => ({ file: parseCredits(text).file, problems: creditsProblems(text) }) }, opts);
  }
}
