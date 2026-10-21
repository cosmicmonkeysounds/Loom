//! Keyword statements (Loom 4 §6) — instructions without brackets.
//!
//! A line that starts with a known lowercase verb is an instruction to
//! the runtime. The lexer lowers every such line onto the *existing*
//! directive AST (`if coins > 5:` → the directive text `if: coins > 5`),
//! so the parser, the sim, the bank compiler, and the story graph see
//! exactly what a `<if: coins > 5>` line produced in v3. This module is
//! the single table the lexer and every editor surface dispatch on.

/** How a verb's arguments map onto the directive text. */
type Shape =
  /** `verb:` opens a block; `verb X:` → `verb: X`. Trailing colon required. */
  | { kind: "block" }
  /** `verb` alone (no arguments). */
  | { kind: "bare" }
  /** `verb X` → `verb: X`; `test` must accept X or the line is prose.
   *  `lower` rewrites the accepted arguments (`sound X in The Desktop`). */
  | { kind: "args"; test?: RegExp; rename?: string; lower?: (args: string) => string }
  /** `do verb args` → `verb: args`. */
  | { kind: "do" };

const TO = /^\S+\s+to\s+\S+/u;
const FROM = /^\S+\s+from\s+\S+/u;
const FROM_TO = /^\S+\s+from\s+\S+\s+to\s+\S+/u;
const AS = /^\S+\s+as\s+\S+/u;
/** `broadcast cue to scope` or the block form `broadcast to scope:`. */
const SCOPED = /^(to\s+\S|\S.*\s+to\s+\S)/u;
const CALL = /^[A-Za-z_][A-Za-z0-9_.]*(\(.*\))?$/u;
const WAIT = /^(until\s+\S|\d)/u;
const FLASH = /^[A-Za-z_]+(\s*,\s*\d+[a-z]*)?$/u;
const GOAL = /^[A-Za-z_][A-Za-z0-9_./]*\s+[a-z]+$/u;
/** `capture guest into The Internet` — the place may be several words. */
const INTO = /^[A-Za-z_][A-Za-z0-9_.]*(\s+(into|from)\s+\S.*)?$/u;
/** `restrict guest` / `restrict guest to The Tube, The Internet` — the app
 *  shrinks to the named places + DMs, read-only, no buttons. */
const RESTRICT = /^[A-Za-z_][A-Za-z0-9_.]*(\s+to\s+\S.*)?$/u;
/** `pin "text"` / `pin "text" for guest` / `pin "text" in quarantine for guest`
 *  — a sticky notice above a stream. A leading `!` in the text is an alert.
 *  A trailing `with go: …` (wave 18) names its exits. */
const PIN = /^"(?:[^"\\]|\\.)*"(\s+in\s+[^"]+?)?(\s+for\s+\S+)?(\s+with\s+\S.*)?$/u;
/** `unpin for guest` / `unpin in quarantine for guest ["text"]` — takes a
 *  pin down. Needs at least a room or a person (a bare `unpin` is prose). */
const UNPIN = /^(?:in\s+[^"]+?)?(?:\s*\bfor\s+\S+)?(?:\s*"(?:[^"\\]|\\.)*")?$/u;
const ENROLL = /^\S+\s+(to|→|->|into)\s+\S+/u;
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_.]*\s*([+\-*/]?=)(?!=)/u;
const SINGLE_NAME = /^[A-Za-z_][A-Za-z0-9_.\-]*(\s+with\s+.+)?$/u;
/** `sound X` / `sound X in The Desktop` / `sound X with rooms: desktop start-bar`
 *  — a sound name, an optional place and optional `with k: v` arguments. */
const SOUND = /^[A-Za-z_][A-Za-z0-9_.\-]*(\s+in\s+(?!with\s)\S.*?)?(\s+with\s+\S.*)?$/u;

/** A place name as one `rooms:` word: `The Desktop` → `The_Desktop` (names
 *  fold case / `_` / spaces, so the house resolves it either way). */
const roomWord = (name: string): string => name.trim().replace(/\s+/gu, "_");

/** A comma-free `rooms:` value's targets: each lowercase word is one (a room
 *  id, a zone, a speaker id); a run of Capitalised words is one place name
 *  (`desktop The Start Bar` → `desktop`, `The_Start_Bar`), so the natural
 *  `with rooms: The Start Bar` reaches the place, not `The`, `Start`, `Bar`. */
export function roomsWords(value: string): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length > 0) out.push(run.join("_"));
    run = [];
  };
  for (const w of value.trim().split(/\s+/u)) {
    if (w === "") continue;
    if (/^\p{Lu}/u.test(w)) run.push(w);
    else {
      flush();
      out.push(w);
    }
  }
  flush();
  return out;
}

/**
 * `sound X in The Desktop` → `X, rooms: The_Desktop`; `sound X with rooms:
 * desktop, The Start Bar, gain: -6` → `X, rooms: desktop The_Start_Bar, gain: -6`.
 * The arguments come out comma-separated (the directive long form
 * `<sfx: X, rooms: …>`), so the bank and stagehand's `parse_directive` read
 * `rooms` as a kwarg; `rooms` is a space-separated list of targets (room
 * ids, zones, speakers, LOCATION names with `_` for their spaces). Inside a
 * `rooms:` value a comma separates whole names, so `The Start Bar` stays
 * one; without commas each lowercase word is a target and a run of
 * Capitalised words one place (`roomsWords`; L1213 warns when such a run
 * names no LOCATION — two Capitalised zones want a comma between them).
 */
export function lowerSoundArgs(args: string): string {
  const m = /^(\S+)(?:\s+in\s+(?!with\s)(\S.*?))?(?:\s+with\s+(\S.*))?$/u.exec(args.trim());
  if (m === null) return args;
  const kwargs: Array<[string, string]> = [];
  const listed: string[] = []; // the `rooms:` value, split at its commas
  let last: "rooms" | "other" | null = null;
  for (const seg of (m[3] ?? "").split(",")) {
    const kv = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/u.exec(seg);
    if (kv !== null) {
      last = kv[1] === "rooms" ? "rooms" : "other";
      if (last === "rooms") listed.push(kv[2]!.trim());
      else kwargs.push([kv[1]!, kv[2]!.trim()]);
    } else if (seg.trim() !== "" && last === "rooms") listed.push(seg.trim());
    else if (seg.trim() !== "" && last === "other") kwargs[kwargs.length - 1]![1] += `, ${seg.trim()}`;
  }
  const rooms: string[] = m[2] !== undefined ? [roomWord(m[2])] : [];
  // With commas in `rooms:` every item is one name; without, every word is.
  if (listed.length > 1) rooms.push(...listed.filter((r) => r !== "").map(roomWord));
  else if (listed.length === 1 && listed[0] !== "") rooms.push(...roomsWords(listed[0]!));
  const out = [m[1]!];
  if (rooms.length > 0) out.push(`rooms: ${rooms.join(" ")}`);
  for (const [k, v] of kwargs) out.push(`${k}: ${v}`);
  return out.join(", ");
}
/** `fire name` / `fire name for subject` / `fire name with k: v`. */
const EVENT = /^[A-Za-z_][A-Za-z0-9_.\-]*(\s+(for|with)\s+.+)?$/u;
/** A name of one word, or several words each Capitalised (`The Society`). */
const NAME_WORDS = /^[A-Za-z_][A-Za-z0-9_.'\-]*(\s+[A-Z][A-Za-z0-9_.'\-]*)*$/u;
const HAS_BAR = /\|/u;
/** `reveal The Society` / `reveal task manager` / `reveal The Start Bar for guest`
 *  — a name of up to four words (a room's name may be lowercase), optionally
 *  scoped to one participant. Longer prose starting with "reveal" stays prose. */
const REVEAL = /^[A-Za-z_][A-Za-z0-9_.'\-]*(?:\s+[A-Za-z][A-Za-z0-9_.'\-]*){0,3}(?:\s+for\s+\S+)?$/u;
/** `unlock The Sandy File for guest` — a codex entry for a holder. */
const UNLOCK = /^.+\s+for\s+\S+$/u;
/** `start quest The Three Keys for everyone` / `update quest The Hunt for
 *  program "Two down."` — a quest, ` for ` a holder or scope, and an
 *  optional quoted line for its thread. */
const QUEST = /^.+\s+for\s+\S.*$/u;
/** `show captcha`, `show image "…" to everyone`, `show poll "…" to program with a: 1` —
 *  a lowercase widget kind, an optional quoted text, `to scope`, `with args`. */
const SHOW = /^[a-z][a-z0-9_-]*(\s+"(?:[^"\\]|\\.)*")?(\s+to\s+\S.*?)?(\s+with\s+\S.*)?$/u;

/**
 * Every statement verb with the shape that tells it from prose. Multi-word
 * verbs (`else if`, `each visit`) are matched longest-first.
 */
export const STATEMENTS: ReadonlyArray<[verb: string, shape: Shape]> = [
  // Flow (syntactic forms — parsed structurally by the parser).
  ["else if", { kind: "block" }],
  ["each visit", { kind: "block" }],
  ["if", { kind: "block" }],
  ["else", { kind: "block" }],
  ["match", { kind: "block" }],
  ["after", { kind: "block" }],
  ["otherwise", { kind: "block" }],
  // Memory.
  ["set", { kind: "args", test: ASSIGN }],
  // Variety.
  ["cycle", { kind: "args", test: HAS_BAR }],
  ["shuffle", { kind: "args", test: HAS_BAR }],
  // Stagecraft.
  ["cue", { kind: "args", test: SINGLE_NAME }],
  ["sfx", { kind: "args", test: SOUND, lower: lowerSoundArgs }],
  ["sound", { kind: "args", test: SOUND, rename: "sfx", lower: lowerSoundArgs }],
  ["pause", { kind: "bare" }],
  ["flash", { kind: "args", test: FLASH }],
  ["anchor", { kind: "args", test: SINGLE_NAME }],
  // Events.
  ["fire", { kind: "args", test: EVENT }],
  ["broadcast", { kind: "args", test: SCOPED }],
  ["reply", { kind: "args", rename: "respond" }],
  ["respond", { kind: "args" }],
  ["show", { kind: "args", test: SHOW }],
  // World.
  ["move", { kind: "args", test: TO }],
  ["add", { kind: "args", test: TO }],
  ["remove", { kind: "args", test: FROM }],
  ["reveal", { kind: "args", test: REVEAL }],
  ["unlock", { kind: "args", test: UNLOCK }],
  // Quests (the quest log): two-word verbs, lowered to one directive each.
  ["start quest", { kind: "args", test: QUEST, rename: "quest_start" }],
  ["update quest", { kind: "args", test: QUEST, rename: "quest_update" }],
  ["complete quest", { kind: "args", test: QUEST, rename: "quest_complete" }],
  ["finish quest", { kind: "args", test: QUEST, rename: "quest_complete" }],
  ["fail quest", { kind: "args", test: QUEST, rename: "quest_fail" }],
  ["cast", { kind: "args", test: AS }],
  ["promote", { kind: "args", test: TO }],
  ["demote", { kind: "args", test: NAME_WORDS }],
  ["goal", { kind: "args", test: GOAL }],
  // Coroutines.
  ["spawn", { kind: "args", test: NAME_WORDS }],
  ["run", { kind: "args", test: CALL }],
  ["cancel", { kind: "args", test: NAME_WORDS }],
  ["wait", { kind: "args", test: WAIT }],
  // Legacy live verbs (kept as conveniences — Loom 4 §12).
  ["capture", { kind: "args", test: INTO }],
  ["release", { kind: "args", test: INTO }],
  ["escape", { kind: "args", test: NAME_WORDS }],
  // Restriction + sticky notices (Wave 4): generic siblings of capture/release.
  ["restrict", { kind: "args", test: RESTRICT }],
  ["unrestrict", { kind: "args", test: NAME_WORDS }],
  ["pin", { kind: "args", test: PIN }],
  ["unpin", { kind: "args", test: UNPIN }],
  ["join", { kind: "args", test: TO }],
  ["defect", { kind: "args", test: FROM_TO }],
  ["betray", { kind: "args", test: TO }],
  ["enroll", { kind: "args", test: ENROLL }],
  // Escape hatch for custom verbs.
  ["do", { kind: "do" }],
];

/** The verbs, longest first (for prefix matching). */
export const STATEMENT_VERBS: readonly string[] = STATEMENTS.map(([v]) => v).sort(
  (a, b) => b.length - a.length,
);

/** Verbs that open an indented block (end with a colon). */
export const BLOCK_STATEMENTS: readonly string[] = STATEMENTS.filter(
  ([, s]) => s.kind === "block",
).map(([v]) => v);

/**
 * Lower a keyword statement to directive text, or return null when the
 * line is not a statement (and is therefore prose). Never diagnoses:
 * a verb that fails its shape is simply prose, by design (§6.2).
 */
export function statementToDirective(line: string): string | null {
  for (const [verb, shape] of STATEMENTS) {
    if (!line.startsWith(verb)) continue;
    const after = line.slice(verb.length);
    // The verb must end at a word boundary: a space, a colon, or the end.
    if (after.length > 0 && after[0] !== " " && after[0] !== ":") continue;
    const rest = after.trim();
    switch (shape.kind) {
      case "block": {
        // `else` / `otherwise` / `each visit` may stand bare; every block
        // opener must end with its colon (`if x:`), which is stripped.
        if (rest === "" || rest === ":") return verb;
        if (!rest.endsWith(":")) return null;
        const args = rest.slice(0, rest.length - 1).trim();
        return args.length === 0 ? verb : `${verb}: ${args}`;
      }
      case "bare":
        return rest.length === 0 ? verb : null;
      case "args": {
        if (rest.length === 0) return null;
        if (rest.startsWith(":")) return null; // `set: x` is v3 inner text, not a statement
        // `broadcast to scope:` opens a block — the trailing colon is syntax.
        const args = verb === "broadcast" && rest.endsWith(":") ? rest.slice(0, -1).trim() : rest;
        if (shape.test !== undefined && !shape.test.test(args)) return null;
        return `${shape.rename ?? verb}: ${shape.lower !== undefined ? shape.lower(args) : args}`;
      }
      case "do": {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/u.exec(rest);
        if (m === null) return null;
        const args = m[2]!.trim();
        return args.length > 0 ? `${m[1]}: ${args}` : m[1]!;
      }
    }
  }
  return null;
}
