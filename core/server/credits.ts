//! The credits' source (wave 44, `docs/loom-w44-contract.md` C5): where an
//! event's `credits.json` comes from, read live (never journaled, never
//! snapshotted: the credits are no story fact, and an edit should show on
//! the next roll with no reload).
//!
//! 1. the event's project file `credits.json` (`ProjectLink.readFile`);
//! 2. else `LOOM_CREDITS` (a path);
//! 3. else, for an event with no project (LAN mode, the default scenario),
//!    the scenario's own `credits.json` beside its house map.
//!
//! An event with a project never falls back to (3): another story must not
//! roll the show's credits. Reads are cached `CREDITS_CACHE_MS` (a whole
//! house of phones opens the roll at once); an unusable file reads as none
//! and is logged once per text. Transport-free, clock-injected.

import { readFileSync } from "node:fs";
import { CREDITS_FILE, creditsProblems, parseCredits, type CreditsFile, type CreditsView } from "../src/credits.ts";

export const CREDITS_CACHE_MS = 5000;

export type CreditsSourceKind = NonNullable<CreditsView["source"]>;

/** One read: the parsed file (null = none usable), where from, its problems. */
export interface CreditsRead {
  file: CreditsFile | null;
  source: CreditsSourceKind | null;
  problems: string[];
}

export interface CreditsSourceOptions {
  /** The project file's text, null when the project has none. Absent for an
   *  event with no project. */
  project?: (() => Promise<string | null>) | null;
  /** `LOOM_CREDITS`. */
  envFile?: string | null;
  /** The scenario's own file (used only with no project). */
  scenarioFile?: string | null;
  now?: () => number;
  readText?: (path: string) => string | null;
  log?: (msg: string) => void;
}

const readTextFile = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

export class CreditsSource {
  private cached: { at: number; read: CreditsRead } | null = null;
  private loggedFor = new Set<string>();
  private readonly now: () => number;
  private readonly readText: (path: string) => string | null;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: CreditsSourceOptions) {
    this.now = opts.now ?? Date.now;
    this.readText = opts.readText ?? readTextFile;
    this.log = opts.log ?? ((m) => process.stderr.write(m));
  }

  /** The credits now (cached `CREDITS_CACHE_MS`). */
  async read(): Promise<CreditsRead> {
    const t = this.now();
    if (this.cached !== null && t - this.cached.at < CREDITS_CACHE_MS) return this.cached.read;
    const read = await this.fresh();
    this.cached = { at: t, read };
    return read;
  }

  /** Forget the cache (a story reload, a test). */
  invalidate(): void {
    this.cached = null;
  }

  private async fresh(): Promise<CreditsRead> {
    const tries: Array<{ source: CreditsSourceKind; text: () => Promise<string | null> | string | null }> = [];
    if (this.opts.project !== undefined && this.opts.project !== null) {
      const project = this.opts.project;
      tries.push({
        source: "project",
        text: () =>
          project().catch((err: unknown) => {
            this.log(`  ⚠️  credits: reading the project's ${CREDITS_FILE} failed: ${String(err)}\n`);
            return null;
          }),
      });
    }
    const env = this.opts.envFile;
    if (env !== undefined && env !== null && env.trim() !== "") tries.push({ source: "env", text: () => this.readText(env) });
    const own = this.opts.scenarioFile;
    if ((this.opts.project === undefined || this.opts.project === null) && own !== undefined && own !== null) tries.push({ source: "scenario", text: () => this.readText(own) });
    for (const t of tries) {
      const text = await t.text();
      if (text === null || text.trim() === "") continue;
      const { file } = parseCredits(text);
      const problems = creditsProblems(text);
      if (problems.length > 0 && !this.loggedFor.has(text)) {
        this.loggedFor.add(text);
        this.log(`  ⚠️  credits (${t.source}): ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}\n`);
      }
      // The first source that has a file is the one in force, usable or not.
      return { file, source: t.source, problems };
    }
    return { file: null, source: null, problems: [] };
  }
}
