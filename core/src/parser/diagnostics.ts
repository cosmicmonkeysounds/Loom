//! Stable diagnostic ids and severities surfaced by the parser.
//!
//! Each `Code` value IS its stable five-character id (`L` + four
//! digits), mirroring `Code::id()` in the Rust parser. Reserved ranges:
//!
//! * `L1xxx` — lexer / line-classifier
//! * `L2xxx` — parser / structural

import type { Span } from "./source.ts";

export type Severity = "error" | "warning";

/**
 * Stable diagnostic codes. The constant's value is the wire id, so
 * `diag.code === Code.L1110AxisMissingMode` is `diag.code === "L1110"`.
 */
export const Code = {
  /** Indentation used tab characters; v3 is space-only. */
  L1001TabIndent: "L1001",
  /** A `key: value` line was missing the colon. */
  L1002MalformedProperty: "L1002",
  /** A choice line (`*` or `+`) was missing body text. */
  L1003EmptyChoice: "L1003",
  /** A `==` knot marker was missing the knot name. */
  L1004UnnamedKnot: "L1004",
  /** A `< … >` directive opened but never closed on the same line. */
  L1005UnterminatedDirective: "L1005",
  /** A declaration line (`CHARACTER`, …) was missing a name. */
  L1006UnnamedDeclaration: "L1006",
  /** A `/*` block comment opened but never closed before end of file. */
  L1007UnterminatedBlockComment: "L1007",
  /** An `is`-clause wrapped past the opener line (trailing `,` / unbalanced `()`). */
  L1008UnterminatedMixinClause: "L1008",
  /** Dialogue lines appeared without a SPEAKER above them. */
  L2001OrphanedDialogue: "L2001",
  /** `<-` appeared outside any tunnel context. */
  L2002BareTunnelReturn: "L2002",
  /** A disposition line was missing the target character name. */
  L1100MissingDispositionTarget: "L1100",
  /** A disposition line's `N of M` clause was malformed. */
  L1101MalformedDispositionAmount: "L1101",
  /** A `reacts <cond> → <tag>` clause was missing its arrow / tag. */
  L1102MalformedReactClause: "L1102",
  /** A `knows:` field row was missing a type spec. */
  L1103MalformedKnowledgeField: "L1103",
  /** A `goal name` block was missing its name. */
  L1104UnnamedGoal: "L1104",
  /** An `axis name` block did not declare a `mode:`. */
  L1110AxisMissingMode: "L1110",
  /** An `attribute name = N` line was malformed. */
  L1111MalformedAttribute: "L1111",
  /** A `pool name` block was missing `max:`. */
  L1112PoolMissingMax: "L1112",
  /** A `node name` block (in a TREE) was missing its name. */
  L1113UnnamedTreeNode: "L1113",
  /** `(improv …)` parenthetical did not include a `duration:` field. */
  L1140ImprovMissingDuration: "L1140",
  /** `advance on: …` listed an unknown / malformed signal. */
  L1141ImprovBadSignal: "L1141",
  /** `COHORT` body did not declare a `capacity:`. */
  L1142CohortNoCapacity: "L1142",
  /** A SCENE labelled state opener carried no name. */
  L1130SceneStateUnnamed: "L1130",
  /** A GENERATOR declaration carried no body. */
  L1131GeneratorMissingBody: "L1131",
  /** A `wait …` line did not match `wait until <expr>` or `wait <dur>`. */
  L1132WaitExpectsUntilOrDuration: "L1132",
  /** A `Name:` cue names no declared character (workspace lint, Loom 4 §13). */
  L1201UnknownSpeaker: "L1201",
  /** Two declarations (or two beats) fold to the same name (Loom 4 §13). */
  L1202AmbiguousName: "L1202",
  /** The header `currency:` line does not parse — the story has no wallet (workspace lint). */
  L1203CurrencyUnparsed: "L1203",
  /** A CHARACTER / TRAIT `wallet:` line does not parse — the role is dropped (workspace lint). */
  L1204WalletRoleUnparsed: "L1204",
  /** A header `watch:` / `countdown:` line (or an item on it) the director's
   *  board drops or cannot resolve (workspace lint, a warning). */
  L1205BoardLineUnparsed: "L1205",
  /** The header `judge:` names no `mind: external` CHARACTER — near misses
   *  wait for a director, as with no key (workspace lint, a warning). */
  L1206JudgeUnresolved: "L1206",
  /** An OBJECTIVE's `for:` names nothing a viewer can be (wave 13): a
   *  warning per unresolved name, an error when none resolves. */
  L1207ObjectiveForUnresolved: "L1207",
  /** An OBJECTIVE's `buttons:` names no usable INTERACTION (wave 13, a warning). */
  L1208ObjectiveButtonUnresolved: "L1208",
  /** An OBJECTIVE's `while:` or a `done when` is empty or no expression (wave 13, an error). */
  L1209ObjectiveConditionInvalid: "L1209",
  /** The header `alerts:` is no dotted path, or sits outside the story header (wave 13, a warning). */
  L1210AlertsPathInvalid: "L1210",
  /** `admin: true` on a CHARACTER no performer can sign in as (wave 13, a warning). */
  L1211AdminNotAPart: "L1211",
  /** A `when …:` / `on …:` event phrase that reads as a declared INTERACTION
   *  or a fired event but parses as a shorter event plus a subject
   *  (`when glitch out:` → event `glitch`, subject `out`), so the press or
   *  the `fire` runs nothing (a warning). */
  L1212TriggerTruncated: "L1212",
  /** A `sound X in <Place>` / `with rooms: …` place of several words that
   *  names no LOCATION (wave 17, a warning): the house router reaches no
   *  speaker for it (room ids, zones and speaker ids are one word). */
  L1213SoundRoomUnresolved: "L1213",
  /** A `with go:` word (on `broadcast` / `reply` / `pin` / `show`) or an
   *  OBJECTIVE's `go:` that names no place, room, character, guest button,
   *  codex entry, quest or screen — or a `with go:` after an unquoted
   *  `reply` text, which stays part of the text (wave 18, a warning). */
  L1214GoTargetUnresolved: "L1214",
  /** `target:` / `pick:` on an OBJECTIVE no booth sees (wave 18, a warning). */
  L1215ObjectivePickNotForBooths: "L1215",
  /** A header `wanted:` / `archive:` / `reinstall:` line that does not
   *  parse or resolve, so it is dropped (wave 18, a warning); a `lock:`
   *  line that is no expression (wave 26, an error). */
  L1216HeaderLineInvalid: "L1216",
  /** `by:` on a `who: admin` INTERACTION names no performer part, so no
   *  booth can call it (wave 18, a warning). */
  L1217CallerNotAPart: "L1217",
  /** `broadcast "!!…"` to everyone outside an admin cue's hook or a story
   *  rule: a big moment for the whole house (wave 18, a warning). The
   *  contract's L1213 was taken by wave 17's sound lint. */
  L1218BigHouseBroadcast: "L1218",
  /** A header `badge:` line that does not parse (one dotted path ` as `
   *  a glyph and label), names no ROLE or CHARACTER, or sits on a ROLE
   *  `secret:` slot / a `secret: true` CHARACTER — every phone sees a badge,
   *  so a secret one is never shown (wave 18b; an error on a secret). */
  L1219BadgeOnSecret: "L1219",
  /** A header `founding:` line that is no expression, so nobody can found
   *  a faction (wave 18b, a warning). */
  L1220FoundingInvalid: "L1220",
  /** A choice's `(if <cond>)` guard that does not parse — the option is
   *  never offered (wave 20, a warning). */
  L1221ChoiceGuardInvalid: "L1221",
  /** `by:` on a `who: admin` INTERACTION names a `player: true` CHARACTER
   *  (or a GROUP of players): a player never calls cues (wave 21, a warning). */
  L1222PlayerCallsCue: "L1222",
  /** A header `stat:` line that does not parse, whose `for` names nothing,
   *  or whose `while` is no expression (wave 21, a warning). */
  L1223StatLineInvalid: "L1223",
  /** `player: true` on a CHARACTER no performer can sign in as (wave 21, a warning). */
  L1224PlayerNotAPart: "L1224",
  /** A `watch:` / `countdown:` item on a CHARACTER's `private:` slot, or a
   *  `stat:` whose `while` reads another character's (wave 21, a warning). */
  L1225PrivateSlotRead: "L1225",
  /** `with ack: none` on a moment tail with no `go:` in the same tail: the
   *  phone shows its usual OK anyway (wave 26, C1, a warning). */
  L1226AckNoneWithoutGo: "L1226",
  /** A beat's `aloud:` names no signable part and no `{…}` (wave 55). */
  L1227AloudNobody: "L1227",
} as const;

export type Code = (typeof Code)[keyof typeof Code];

export interface Diagnostic {
  code: Code;
  severity: Severity;
  message: string;
  span: Span;
}

export function errorDiagnostic(code: Code, span: Span, message: string): Diagnostic {
  return { code, severity: "error", message, span };
}
