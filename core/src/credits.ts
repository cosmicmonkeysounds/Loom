//! The credits (wave 44): who made the night, rolled at the very end.
//!
//! A project's `credits.json` names the people and their parts; the server
//! reads it live from the project (`server/credits.ts`: the project file,
//! else `LOOM_CREDITS`, else the default scenario's own file), adds the
//! night's programs where the file asks for them, and answers `GET
//! /api/credits` with a `CreditsView`. The TV and the wall terminals roll it
//! on the story's `credits` slide; every phone rolls it once when the story
//! starts the roll (`NightView.credits`) and keeps it under ⊞ Start.
//!
//! ```json
//! {
//!   "title": "Trapped in the Internet",
//!   "subtitle": "Halloween 2026",
//!   "sections": [
//!     { "heading": "Cast", "people": [{ "role": "Clippy", "name": "Brooke" }] },
//!     { "heading": "Starring the programs", "programs": true },
//!     { "heading": "Thanks", "lines": ["Everyone who came."] }
//!   ],
//!   "end": ["Thank you for playing."]
//! }
//! ```
//!
//! A row with a blank `name` is left out of the roll (fill it in later), and
//! a section left with nothing is dropped. Browser-safe, no imports: play
//! and the terminal import it by relative path.

/** The project file the credits live in. */
export const CREDITS_FILE = "credits.json";

/** Caps, so a pasted file can't flood a phone. */
export const CREDITS_MAX = {
  title: 120,
  heading: 80,
  role: 80,
  name: 120,
  line: 200,
  sections: 40,
  rows: 200,
  /** The night's programs in one `programs` section. */
  programs: 400,
} as const;

/** One credit: the part, then who played or did it. */
export interface CreditsPerson {
  role: string;
  name: string;
}

/** A section as the file writes it. */
export interface CreditsSectionFile {
  heading: string;
  /** Role → name rows (`{role, name}`; a blank name is left out). */
  people?: CreditsPerson[];
  /** Plain lines: a thanks, a dedication. */
  lines?: string[];
  /** True: the server fills the section with the night's programs (every
   *  guest who joined, by program name). */
  programs?: boolean;
}

/** `credits.json`. */
export interface CreditsFile {
  title: string;
  subtitle?: string;
  sections: CreditsSectionFile[];
  /** The last card, held after the roll. */
  end?: string[];
}

/** A section as the clients draw it: rows, then lines. */
export interface CreditsSection {
  heading: string;
  people: CreditsPerson[];
  lines: string[];
  /** True for the night's programs (the server filled `lines`). */
  programs?: true;
}

/** What `GET /api/credits` answers. */
export interface CreditsView {
  title: string;
  subtitle: string | null;
  sections: CreditsSection[];
  end: string[];
  /** The story's `Night.credits_roll` (0 before the first roll). */
  roll: number;
  /** Mod answers only: where the file came from and what is wrong with it. */
  source?: "project" | "env" | "scenario";
  problems?: string[];
}

/** Where the story keeps the roll (`NightView.credits`, the route's gate). */
export const CREDITS_ROLL_PATH = "Night.credits_roll";
/** Story seconds the latest roll started at. */
export const CREDITS_AT_PATH = "Night.credits_at";
/** The slide value (`cue screens_credits` → `Night.screen = "credits"`). */
export const CREDITS_SLIDE = "credits";

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

/**
 * Parse a `credits.json` text. `file` is null when it can't be used at all
 * (not JSON, no title, no sections list); `problems` lists everything wrong,
 * with where (an unusable row is skipped, not fatal).
 */
export function parseCredits(text: string): { file: CreditsFile | null; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { file: null, problems: [`credits.json is not JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const problems: string[] = [];
  if (!isObj(raw)) return { file: null, problems: ["credits.json must be an object"] };
  if (typeof raw["title"] !== "string" || raw["title"].trim() === "") problems.push("title: a non-empty string is required");
  if (raw["subtitle"] !== undefined && typeof raw["subtitle"] !== "string") problems.push("subtitle: must be a string");
  if (!Array.isArray(raw["sections"])) problems.push("sections: a list is required");
  if (raw["end"] !== undefined && !(Array.isArray(raw["end"]) && raw["end"].every((l) => typeof l === "string"))) problems.push("end: must be a list of strings");
  if (problems.some((p) => p.startsWith("title") || p.startsWith("sections"))) return { file: null, problems };
  const sections: CreditsSectionFile[] = [];
  const list = raw["sections"] as unknown[];
  if (list.length > CREDITS_MAX.sections) problems.push(`sections: at most ${CREDITS_MAX.sections} (the rest are left out)`);
  list.slice(0, CREDITS_MAX.sections).forEach((s, i) => {
    const at = `sections[${i}]`;
    if (!isObj(s) || typeof s["heading"] !== "string") {
      problems.push(`${at}: needs a "heading" string`);
      return;
    }
    const out: CreditsSectionFile = { heading: s["heading"] };
    if (s["people"] !== undefined) {
      if (!Array.isArray(s["people"])) problems.push(`${at}.people: must be a list`);
      else {
        out.people = [];
        s["people"].forEach((p, j) => {
          if (isObj(p) && typeof p["role"] === "string" && typeof p["name"] === "string") out.people!.push({ role: p["role"], name: p["name"] });
          else problems.push(`${at}.people[${j}]: needs "role" and "name" strings`);
        });
      }
    }
    if (s["lines"] !== undefined) {
      if (!Array.isArray(s["lines"])) problems.push(`${at}.lines: must be a list of strings`);
      else {
        out.lines = [];
        s["lines"].forEach((l, j) => {
          if (typeof l === "string") out.lines!.push(l);
          else problems.push(`${at}.lines[${j}]: must be a string`);
        });
      }
    }
    if (s["programs"] !== undefined) {
      if (typeof s["programs"] !== "boolean") problems.push(`${at}.programs: must be true or false`);
      else if (s["programs"]) out.programs = true;
    }
    sections.push(out);
  });
  const file: CreditsFile = { title: raw["title"] as string, sections };
  if (typeof raw["subtitle"] === "string") file.subtitle = raw["subtitle"];
  if (Array.isArray(raw["end"])) file.end = (raw["end"] as unknown[]).filter((l): l is string => typeof l === "string");
  return { file, problems };
}

/** The problems a `credits.json` would be refused or trimmed for ([] = fine). */
export function creditsProblems(text: string): string[] {
  return parseCredits(text).problems;
}

/** Fold for de-duplicating program names (case and spacing). */
const fold = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The roll the clients draw: blank names dropped, the night's programs put
 * where a section asks for them (sorted, de-duplicated), empty sections
 * dropped, every string trimmed and capped. Pure.
 */
export function creditsView(file: CreditsFile, programs: readonly string[], roll = 0): CreditsView {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const p of programs) {
    const t = p.trim();
    if (t === "" || seen.has(fold(t))) continue;
    seen.add(fold(t));
    names.push(clip(t, CREDITS_MAX.name));
  }
  names.sort((a, b) => a.localeCompare(b));
  const sections: CreditsSection[] = [];
  for (const s of file.sections) {
    const people = (s.people ?? [])
      .map((p) => ({ role: clip(p.role.trim(), CREDITS_MAX.role), name: clip(p.name.trim(), CREDITS_MAX.name) }))
      .filter((p) => p.name !== "")
      .slice(0, CREDITS_MAX.rows);
    const lines = (s.lines ?? []).map((l) => clip(l.trim(), CREDITS_MAX.line)).filter((l) => l !== "").slice(0, CREDITS_MAX.rows);
    if (s.programs === true) lines.push(...names.slice(0, CREDITS_MAX.programs));
    if (people.length === 0 && lines.length === 0) continue;
    sections.push({ heading: clip(s.heading.trim(), CREDITS_MAX.heading), people, lines, ...(s.programs === true ? { programs: true as const } : {}) });
  }
  const subtitle = file.subtitle?.trim() ?? "";
  return {
    title: clip(file.title.trim(), CREDITS_MAX.title),
    subtitle: subtitle === "" ? null : clip(subtitle, CREDITS_MAX.title),
    sections,
    end: (file.end ?? []).map((l) => clip(l.trim(), CREDITS_MAX.line)).filter((l) => l !== ""),
    roll,
  };
}

/** Rows a client lays the roll out in, top to bottom (pure; both clients
 *  share it so the TV and a phone show the same order). */
export type CreditsRow =
  | { kind: "title"; text: string }
  | { kind: "subtitle"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "person"; role: string; name: string }
  | { kind: "line"; text: string }
  | { kind: "gap" };

export function creditsRows(view: CreditsView): CreditsRow[] {
  const rows: CreditsRow[] = [{ kind: "title", text: view.title }];
  if (view.subtitle !== null) rows.push({ kind: "subtitle", text: view.subtitle });
  for (const s of view.sections) {
    rows.push({ kind: "gap" });
    if (s.heading !== "") rows.push({ kind: "heading", text: s.heading });
    for (const p of s.people) rows.push({ kind: "person", role: p.role, name: p.name });
    for (const l of s.lines) rows.push({ kind: "line", text: l });
  }
  return rows;
}

/** How long a roll of `rows` takes at the house pace (ms): ~1.1 s a row,
 *  at least 20 s, at most 6 min (a 300-guest night). The end card holds
 *  after it. */
export function creditsRollMs(rows: number): number {
  return Math.min(6 * 60_000, Math.max(20_000, Math.round(rows * 1100)));
}
