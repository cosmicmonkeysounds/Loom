//! The wave 18 workspace lints (all warnings):
//!
//! - `L1214 GoTargetUnresolved` — a `with go:` word on `broadcast` /
//!   `reply` / `pin` / `show`, or an OBJECTIVE's `go:`, that names nothing a
//!   phone can open (it is dropped); a `with go:` after an unquoted `reply`
//!   text (it stays part of the text: quote the text).
//! - `L1215 ObjectivePickNotForBooths` — `target:` / `pick:` on an OBJECTIVE
//!   no booth sees (they are booth-only).
//! - `L1216 HeaderLineInvalid` — a header `wanted:` / `archive:` /
//!   `reinstall:` line that does not parse or resolve.
//! - `L1217 CallerNotAPart` — `by:` on a `who: admin` INTERACTION names no
//!   performer part, so no booth can call it.
//! - `L1218 BigHouseBroadcast` — `broadcast "!!…"` to everyone outside an
//!   admin cue's hook or a story rule: a big moment for the whole house.
//!
//! Text- and model-driven like the wave 13 lints in `workspace.ts`.

import type { LoomFile } from "../parser/ast.ts";
import { Code } from "../parser/diagnostics.ts";
import { foldName } from "../parser/names.ts";
import { parseExpr } from "../runtime/expr.ts";
import { parseArchive, parseTrigger, parseWanted, resolveObjectiveAudience, type SimModel } from "../runtime/sim/model.ts";
import { resolveGoWord, splitMomentArgs, withIndex } from "../go.ts";
import { identityDefs, performerPickable } from "../identity-kind.ts";
import type { Range } from "./types.ts";
import { lines, nameRangeInText, spanToRange } from "./util.ts";

type Push = (uri: string, range: Range, error: boolean, code: string, message: string) => void;
type Doc = { text: string; file: LoomFile };

/** A whole-line range (from its indent to its end). */
function lineRange(line: string, n: number): Range {
  const start = line.length - line.trimStart().length;
  return { start: { line: n, character: start }, end: { line: n, character: line.trimEnd().length } };
}

/** A line without its trailing `// comment` (outside quotes). */
function stripComment(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i]!;
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "/" && line[i + 1] === "/" && (i === 0 || /\s/u.test(line[i - 1]!))) return line.slice(0, i);
  }
  return line;
}

/** The `with …` tail of a moment statement's arguments, or null. */
function momentTail(verb: string, rest: string): string | null {
  const t = rest.trim();
  if (verb === "reply" || verb === "respond") {
    const m = /^"(?:[^"\\]|\\.)*"\s+with\s+(\S.*)$/su.exec(t);
    return m !== null ? m[1]! : null;
  }
  const close = t.startsWith('"') ? t.indexOf('"', 1) : -1;
  const after = close > 0 ? close + 1 : 0;
  const w = withIndex(t.slice(after));
  return w >= 0 ? t.slice(after + w + 6) : null;
}

export function wave18Lints(docs: ReadonlyArray<[string, Doc]>, model: SimModel | null, push: Push): void {
  goLints(docs, model, push);
  if (model === null) return;
  objectiveLints(docs, model, push);
  headerLints(docs, model, push);
  callerLints(docs, model, push);
  bigBroadcastLints(docs, model, push);
}

function goLints(docs: ReadonlyArray<[string, Doc]>, model: SimModel | null, push: Push): void {
  for (const [uri, doc] of docs) {
    lines(doc.text).forEach((raw, n) => {
      const line = stripComment(raw);
      const m = /^[ \t]*(broadcast|reply|respond|pin|show)[ \t]+(\S.*)$/u.exec(line);
      if (m === null) return;
      const verb = m[1]!;
      const rest = m[2]!;
      if ((verb === "reply" || verb === "respond") && !rest.trim().startsWith('"') && /\swith\s+go\s*:/iu.test(` ${rest}`)) {
        push(uri, lineRange(raw, n), false, Code.L1214GoTargetUnresolved, `\`with go:\` after an unquoted \`${verb}\` text is part of the text, not an exit — quote the text: \`${verb} "…" with go: …\``);
        return;
      }
      // A broadcast needs its `to` scope before a `with` tail: without one
      // the line is not a broadcast at all and the phones show it as prose,
      // "with go:" and all (m5).
      if (verb === "broadcast" && /\swith\s+(?:go|close)\s*:/iu.test(` ${rest}`)) {
        const t = rest.trim();
        const close = t.startsWith('"') ? t.indexOf('"', 1) : -1;
        const before = t.slice(close > 0 ? close + 1 : 0, close > 0 ? close + 1 + Math.max(0, withIndex(t.slice(close + 1))) : withIndex(t));
        if (!/\sto\s/u.test(` ${before} `)) {
          push(uri, lineRange(raw, n), false, Code.L1214GoTargetUnresolved, "a `broadcast` with `with go:` / `close:` needs its scope first — `broadcast \"…\" to everyone with go: …` — else the line is prose and the phones show the tail as words");
          return;
        }
      }
      if (model === null) return;
      const tail = momentTail(verb, rest);
      if (tail === null) return;
      for (const word of splitMomentArgs(tail).go) {
        if (word.includes("{")) continue; // interpolated: resolved at run time
        if (resolveGoWord(model, word) !== null) continue;
        const lobby = foldName(word) === "lobby";
        push(
          uri,
          lineRange(raw, n),
          false,
          Code.L1214GoTargetUnresolved,
          lobby
            ? "`go: lobby` is never an exit (the lobby is the far-away chat log) — name the place, room or screen it should open"
            : `\`go: ${word}\` names no LOCATION, CHANNEL, CHARACTER, guest INTERACTION, \`codex: <Entry>\`, \`quest: <Quest>\` or screen (\`pass\`, \`scan\`, \`chats\`, \`mission\`, \`notifications\`, \`sides\`, \`wallet\`, \`me\`, \`codex\`, \`quests\`), so the button is dropped`,
        );
      }
    });
  }
}

/** Does the objective's audience reach a booth (performers, a CHARACTER, or a GROUP with a character in it)? */
function reachesBooth(model: SimModel, names: readonly string[]): boolean {
  const { audience } = resolveObjectiveAudience(model, names);
  if (audience.performers || audience.characters.length > 0) return true;
  return audience.groups.some((g) => [...model.characters.values()].some((c) => c.faction !== null && foldName(c.faction) === foldName(g)));
}

function objectiveLints(docs: ReadonlyArray<[string, Doc]>, model: SimModel, push: Push): void {
  for (const [uri, doc] of docs) {
    for (const item of doc.file.items) {
      if (item.kind !== "declaration" || item.value.kind !== "objective" || item.value.objective === null) continue;
      const decl = item.value;
      const o = decl.objective!;
      const at = (key: string): Range => {
        const prop = [...o.properties.entries()].find(([k]) => k.toLowerCase().replace(/[-_\s]+/gu, "") === key)?.[1];
        return prop !== undefined ? spanToRange(prop.span) : nameRangeInText(doc.text, decl.span, decl.name);
      };
      if (o.go !== null && o.go.trim() !== "" && !o.go.includes("{") && resolveGoWord(model, o.go) === null)
        push(uri, at("go"), false, Code.L1214GoTargetUnresolved, `\`go: ${o.go.trim()}\` on OBJECTIVE ${decl.name} names no place, room, character, guest button, entry or screen, so the mission shows no place to go`);
      if ((o.target !== null || o.pick !== null) && o.for.length > 0 && !reachesBooth(model, o.for)) {
        for (const key of ["target", "pick"] as const) {
          if (o[key] === null) continue;
          push(uri, at(key), false, Code.L1215ObjectivePickNotForBooths, `\`${key}:\` on OBJECTIVE ${decl.name} does nothing — it is for no booth (\`for:\` names no performers, CHARACTER or GROUP of characters); pickers and targets are booth-only`);
        }
      }
      for (const key of ["target", "pick"] as const) {
        const v = o[key];
        if (v === null) continue;
        try {
          parseExpr(v);
        } catch {
          push(uri, at(key), false, Code.L1215ObjectivePickNotForBooths, `\`${key}:\` on OBJECTIVE ${decl.name} is no expression, so it is never filled`);
        }
      }
    }
  }
}

function headerLints(docs: ReadonlyArray<[string, Doc]>, model: SimModel, push: Push): void {
  const names = new Set<string>();
  for (const c of model.characters.keys()) names.add(foldName(c));
  for (const f of model.factions.keys()) names.add(foldName(f));
  for (const [uri, doc] of docs) {
    for (const line of doc.file.header.lines ?? []) {
      const range = spanToRange(line.span);
      if (line.key === "wanted") {
        const w = parseWanted(model, line.value);
        if (w === null) {
          push(uri, range, false, Code.L1216HeaderLineInvalid, `\`wanted: ${line.value.trim()}\` does not parse — write \`wanted: program.marked [as program.why] [by program.claimed_by], for <GROUP or CHARACTER>\` (paths on the ROLE's alias); no booth gets a Wanted board`);
          continue;
        }
        for (const who of w.for) if (!names.has(foldName(who))) push(uri, range, false, Code.L1216HeaderLineInvalid, `\`${who}\` in the \`for\` of \`wanted:\` names no CHARACTER or GROUP, so no booth of it hunts`);
      } else if (line.key === "archive") {
        if (parseArchive(model, line.value) === null) push(uri, range, false, Code.L1216HeaderLineInvalid, `\`archive: ${line.value.trim()}\` names no LOCATION, CHANNEL or CHARACTER, or has no \`when <condition>\` — the line is dropped`);
        else {
          const cond = /\swhen\s+(.+)$/su.exec(line.value)?.[1] ?? "";
          if (!exprOk(cond)) push(uri, range, false, Code.L1216HeaderLineInvalid, `the condition of \`archive: ${line.value.trim()}\` is no expression, so the room is never archived`);
        }
      } else if (line.key === "reinstall") {
        if (!exprOk(line.value)) push(uri, range, false, Code.L1216HeaderLineInvalid, `\`reinstall: ${line.value.trim()}\` is no expression — nobody the story marks may enter the reinstallation (a captured or restricted program still may)`);
      }
    }
  }
}

function exprOk(src: string): boolean {
  if (src.trim() === "") return false;
  try {
    parseExpr(src);
    return true;
  } catch {
    return false;
  }
}

function callerLints(docs: ReadonlyArray<[string, Doc]>, model: SimModel, push: Push): void {
  const parts = identityDefs(model).filter(performerPickable).map((d) => d.name);
  const partSet = new Set(parts.map(foldName));
  const groupHasPart = (g: string): boolean => [...model.characters.values()].some((c) => partSet.has(foldName(c.id)) && c.faction !== null && foldName(c.faction) === foldName(g));
  for (const [uri, doc] of docs) {
    for (const item of doc.file.items) {
      if (item.kind !== "declaration" || item.value.kind !== "interaction") continue;
      const d = item.value;
      const def = model.interactions.get(d.name);
      if (def === undefined || def.who !== "admin" || def.by.length === 0) continue;
      const prop = d.interaction?.properties.get("by");
      const range = prop !== undefined ? spanToRange(prop.span) : nameRangeInText(doc.text, d.span, d.name);
      for (const name of def.by) {
        if (partSet.has(foldName(name)) || groupHasPart(name)) continue;
        push(uri, range, false, Code.L1217CallerNotAPart, `\`${name}\` in the \`by:\` of admin cue ${d.name} is no performer part (nor a GROUP with one), so no booth can call it — the directors still can`);
      }
    }
  }
}

/** Scopes a broadcast reaches the whole house with. */
const HOUSE_SCOPES = new Set(["everyone", "all", "story", "internet", "world", "room", "party"]);

function bigBroadcastLints(docs: ReadonlyArray<[string, Doc]>, model: SimModel, push: Push): void {
  const admin = new Set<string>();
  for (const i of model.interactions.values()) if (i.who === "admin") admin.add(foldName(i.id));
  for (const [uri, doc] of docs) {
    // The enclosing opener at each indent: a top-level `when` / `on` rule,
    // a beat, a declaration, and inside a declaration its `when` hooks.
    let topRule = false;
    let hookIndent = -1;
    let hookAdmin = false;
    lines(doc.text).forEach((raw, n) => {
      const line = stripComment(raw);
      if (line.trim() === "") return;
      const indent = line.length - line.trimStart().length;
      const t = line.trim();
      if (indent === 0 && !t.startsWith("broadcast ")) {
        topRule = /^(when|on)\s.+:$/u.test(t);
        hookIndent = -1;
        hookAdmin = false;
        return;
      }
      if (indent === 0) {
        // A beat's own line (beat bodies sit at the margin): never in a rule.
        topRule = false;
        hookIndent = -1;
        hookAdmin = false;
      }
      if (hookIndent >= 0 && indent <= hookIndent) {
        hookIndent = -1;
        hookAdmin = false;
      }
      const hook = /^(when|on)\s+(.+?)\s*:$/u.exec(t);
      if (hook !== null && hookIndent < 0) {
        hookIndent = indent;
        const phrase = hook[2]!;
        const { verb } = parseTrigger(phrase);
        hookAdmin = admin.has(foldName(phrase)) || (verb !== "" && admin.has(foldName(verb)));
        return;
      }
      const b = /^broadcast\s+"!!/u.exec(t);
      if (b === null || topRule || hookAdmin) return;
      const scope = /"\s+to\s+(.+?)(?:\s+with\s+.*)?$/su.exec(t)?.[1]?.trim().toLowerCase() ?? "";
      if (!HOUSE_SCOPES.has(scope)) return;
      push(uri, lineRange(raw, n), false, Code.L1218BigHouseBroadcast, `\`broadcast "!!…" to ${scope}\` is a big moment for the whole house — every phone stops for it. Is that meant here (outside an admin cue or a story rule)? A personal one is \`reply !!…\``);
    });
  }
}
