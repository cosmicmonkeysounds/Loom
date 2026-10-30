//! A project file read live (the credits, wave 44; the descent's words, wave
//! 49): never journaled, never snapshotted, so an edit shows on the next read
//! with no reload.
//!
//! 1. the event's project file (`ProjectLink.readFile`);
//! 2. else the env's fallback (a path);
//! 3. else, for an event with no project (LAN mode, the default scenario),
//!    the scenario's own file beside its house map.
//!
//! An event with a project never falls back to (3): another story must not
//! play the show's file. Reads are cached `LIVE_FILE_CACHE_MS` (a whole house
//! of phones may ask at once); the first source that has a file is the one in
//! force, usable or not, and an unusable file reads as none and is logged
//! once per text. Transport-free, clock-injected.

import { readFileSync } from "node:fs";

export const LIVE_FILE_CACHE_MS = 5000;

export type LiveFileKind = "project" | "env" | "scenario";

/** One read: the parsed file (null = none usable), where from, its problems. */
export interface LiveFileRead<T> {
  file: T | null;
  source: LiveFileKind | null;
  problems: string[];
}

export interface LiveFileOptions {
  /** The project file's text, null when the project has none. Absent for an
   *  event with no project. */
  project?: (() => Promise<string | null>) | null;
  /** The env's fallback path. */
  envFile?: string | null;
  /** The scenario's own file (used only with no project). */
  scenarioFile?: string | null;
  now?: () => number;
  readText?: (path: string) => string | null;
  log?: (msg: string) => void;
}

/** What one kind of file is. */
export interface LiveFileKindSpec<T> {
  /** Its name in the log. */
  label: string;
  /** The project file's name. */
  fileName: string;
  /** The text as a file (null = unusable) and what is wrong with it. */
  parse: (text: string) => { file: T | null; problems: string[] };
}

const readTextFile = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

export class LiveFileSource<T> {
  private cached: { at: number; read: LiveFileRead<T> } | null = null;
  private loggedFor = new Set<string>();
  private readonly now: () => number;
  private readonly readText: (path: string) => string | null;
  private readonly log: (msg: string) => void;

  constructor(
    private readonly spec: LiveFileKindSpec<T>,
    private readonly opts: LiveFileOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.readText = opts.readText ?? readTextFile;
    this.log = opts.log ?? ((m) => process.stderr.write(m));
  }

  /** The file now (cached `LIVE_FILE_CACHE_MS`). */
  async read(): Promise<LiveFileRead<T>> {
    const t = this.now();
    if (this.cached !== null && t - this.cached.at < LIVE_FILE_CACHE_MS) return this.cached.read;
    const read = await this.fresh();
    this.cached = { at: t, read };
    return read;
  }

  /** Forget the cache (a story reload, a test). */
  invalidate(): void {
    this.cached = null;
  }

  private async fresh(): Promise<LiveFileRead<T>> {
    const { label, fileName, parse } = this.spec;
    const tries: Array<{ source: LiveFileKind; text: () => Promise<string | null> | string | null }> = [];
    if (this.opts.project !== undefined && this.opts.project !== null) {
      const project = this.opts.project;
      tries.push({
        source: "project",
        text: () =>
          project().catch((err: unknown) => {
            this.log(`  ⚠️  ${label}: reading the project's ${fileName} failed: ${String(err)}\n`);
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
      const { file, problems } = parse(text);
      if (problems.length > 0 && !this.loggedFor.has(text)) {
        this.loggedFor.add(text);
        this.log(`  ⚠️  ${label} (${t.source}): ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}\n`);
      }
      // The first source that has a file is the one in force, usable or not.
      return { file, source: t.source, problems };
    }
    return { file: null, source: null, problems: [] };
  }
}
