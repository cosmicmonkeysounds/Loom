//! The wave 21 workspace lints (performers play; all warnings):
//!
//! - `L1222 PlayerCallsCue` — `by:` on a `who: admin` INTERACTION names a
//!   `player: true` CHARACTER (or a GROUP whose every member is a player):
//!   a player never calls cues, the hosts and the directors do.
//! - `L1223 StatLineInvalid` — a header `stat:` line that does not parse
//!   (`stat: self.score as ⭐ Points[, for <who>][, while <cond>]`), whose
//!   `for` names nothing, or whose `while` is no expression.
//! - `L1224 PlayerNotAPart` — `player: true` on a CHARACTER no performer
//!   can sign in as (`playable: false`, `mind: external`, a guest's program).
//! - `L1225 PrivateSlotRead` — a `watch:` / `countdown:` item on a
//!   CHARACTER's `private:` slot (masked / dropped), or a `stat:` line whose
//!   `while` reads another character's private slot (the line never shows).
//!   A `badge:` on one is `L1219`'s (an error: every phone sees a badge).
//!
//! Text- and model-driven like the wave 18 lints in `w18-lints.ts`.

import type { LoomFile } from "../parser/ast.ts";
import { Code } from "../parser/diagnostics.ts";
import { foldName } from "../parser/names.ts";
import { parseExpr } from "../runtime/expr.ts";
import { parseBoardLine } from "../runtime/sim/board.ts";
import type { SimModel } from "../runtime/sim/model.ts";
import { isPrivateSlot, parseStatLine, readsOthersPrivate, statFor } from "../runtime/sim/stats.ts";
import { identityDefs, performerPickable } from "../identity-kind.ts";
import type { Range } from "./types.ts";
import { nameRangeInText, spanToRange } from "./util.ts";

type Push = (uri: string, range: Range, error: boolean, code: string, message: string) => void;
type Doc = { text: string; file: LoomFile };

export function wave21Lints(docs: ReadonlyArray<[string, Doc]>, model: SimModel | null, push: Push): void {
  statLints(docs, model, push);
  if (model === null) return;
  playerCallsLints(docs, model, push);
  playerPartLints(docs, model, push);
  boardPrivateLints(docs, model, push);
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

function statLints(docs: ReadonlyArray<[string, Doc]>, model: SimModel | null, push: Push): void {
  for (const [uri, doc] of docs) {
    for (const line of doc.file.header.lines ?? []) {
      if (line.key !== "stat") continue;
      const range = spanToRange(line.span);
      const def = parseStatLine(line.value);
      if (def === null) {
        push(uri, range, false, Code.L1223StatLineInvalid, `\`stat: ${line.value.trim()}\` does not parse — write \`stat: self.score as ⭐ Points[, for <players | Character | GROUP>][, while <condition>]\`; no booth shows it`);
        continue;
      }
      if (def.while !== null && !exprOk(def.while)) {
        push(uri, range, false, Code.L1223StatLineInvalid, `the \`while\` of \`stat: ${line.value.trim()}\` is no expression, so the line never shows`);
        continue;
      }
      if (model === null) continue;
      if (def.for !== null) {
        const known = (n: string): boolean => {
          const k = foldName(n);
          return [...model.characters.values()].some((c) => foldName(c.id) === k) || [...model.factions.keys()].some((g) => foldName(g) === k);
        };
        for (const n of def.for) if (!known(n)) push(uri, range, false, Code.L1223StatLineInvalid, `\`${n}\` in the \`for\` of \`stat: ${line.value.trim()}\` names no CHARACTER or GROUP (write \`players\`, a character or a GROUP), so it shows on no booth for it`);
      } else if (![...model.characters.values()].some((c) => c.player)) {
        push(uri, range, false, Code.L1223StatLineInvalid, `\`stat: ${line.value.trim()}\` is for \`players\` (the default) and no CHARACTER is \`player: true\`, so no booth shows it — add \`, for <Character or GROUP>\``);
      }
      if (def.while !== null && [...model.characters.values()].some((c) => statFor(def, c) && readsOthersPrivate(model, def.while, c.id))) {
        push(uri, range, false, Code.L1225PrivateSlotRead, `the \`while\` of \`stat: ${line.value.trim()}\` reads another character's \`private:\` slot (or a \`secret: true\` character), so the line never shows — read \`self.…\` or a global`);
      }
    }
  }
}

function playerCallsLints(docs: ReadonlyArray<[string, Doc]>, model: SimModel, push: Push): void {
  const chars = [...model.characters.values()];
  const isPlayer = (name: string): boolean => {
    const k = foldName(name);
    const one = chars.find((c) => foldName(c.id) === k);
    if (one !== undefined) return one.player;
    const members = chars.filter((c) => c.faction !== null && foldName(c.faction) === k);
    return members.length > 0 && members.every((c) => c.player);
  };
  for (const [uri, doc] of docs) {
    for (const item of doc.file.items) {
      if (item.kind !== "declaration" || item.value.kind !== "interaction") continue;
      const d = item.value;
      const def = model.interactions.get(d.name);
      if (def === undefined || def.who !== "admin" || def.by.length === 0) continue;
      const prop = d.interaction?.properties.get("by");
      const range = prop !== undefined ? spanToRange(prop.span) : nameRangeInText(doc.text, d.span, d.name);
      for (const name of def.by) {
        if (!isPlayer(name)) continue;
        push(uri, range, false, Code.L1222PlayerCallsCue, `\`${name}\` in the \`by:\` of admin cue ${d.name} is a player (\`player: true\`) — a player never calls cues; the hosts and the directors do (drop it from \`by:\`, and tell the player with a readout or an OBJECTIVE)`);
      }
    }
  }
}

function playerPartLints(docs: ReadonlyArray<[string, Doc]>, model: SimModel, push: Push): void {
  const parts = new Set(identityDefs(model).filter(performerPickable).map((d) => d.name));
  for (const [uri, doc] of docs) {
    for (const item of doc.file.items) {
      if (item.kind !== "declaration" || item.value.kind !== "character") continue;
      const d = item.value;
      if (model.characters.get(d.name)?.player !== true || parts.has(d.name)) continue;
      const prop = d.character?.properties.get("player");
      const range = prop !== undefined ? spanToRange(prop.span) : nameRangeInText(doc.text, d.span, d.name);
      push(uri, range, false, Code.L1224PlayerNotAPart, `\`player: true\` on ${d.name} does nothing — no performer can sign in as ${d.name} (\`playable: false\`, an agent-voiced character or a guest's program), so nobody plays it`);
    }
  }
}

function boardPrivateLints(docs: ReadonlyArray<[string, Doc]>, model: SimModel, push: Push): void {
  const chars = [...model.characters.values()];
  for (const [uri, doc] of docs) {
    for (const line of doc.file.header.lines ?? []) {
      if (line.key !== "watch" && line.key !== "countdown") continue;
      const parsed = parseBoardLine(line.value, { pathsOnly: line.key === "countdown" });
      if (parsed === null) continue;
      for (const item of parsed.items) {
        if (item.path === null) continue;
        const dot = item.path.indexOf(".");
        const k = foldName(item.path.slice(0, dot));
        const c = chars.find((x) => foldName(x.id) === k);
        if (c === undefined || !isPrivateSlot(c, item.path.slice(dot + 1))) continue;
        const what = line.key === "watch" ? "masked on the director's board" : "dropped (a countdown has no mask)";
        push(uri, spanToRange(line.span), false, Code.L1225PrivateSlotRead, `\`${item.path}\` on \`${line.key}: ${line.value.trim()}\` is one of ${c.id}'s \`private:\` slots, so it is ${what}`);
      }
    }
  }
}
