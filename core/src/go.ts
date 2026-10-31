//! Moment exits (wave 18, C2): the `with go: …, close: 6s` tail a story
//! writes on `broadcast` / `reply` / `pin` / `show` and an OBJECTIVE's `go:`
//! key, split off the statement and resolved against the story's names.
//!
//! Pure: the sim splits the tail (`splitMomentArgs`) and journals nothing
//! new; the chat composer resolves each word (`resolveGoWord`) to the
//! `GoTarget` the phone renders as a button. The workspace lint (L1214)
//! asks the same resolver, so a word the lint accepts is a word the phone
//! gets. Structural over the model (no `Sim` import), so the LSP and the
//! server share it.

import { GO_LABELS, GO_WORDS, type GoTarget } from "./delivery.ts";
import { inWorldLabel } from "./in-world.ts";
import { foldName } from "./parser/names.ts";

/** What `splitMomentArgs` pulls out of a `with …` tail. */
export interface MomentArgs {
  /** Each `go:` value as written (`The Internet`, `codex: The Sandy File`,
   *  `pass as "Show your pass"`), in written order. */
  go: string[];
  /** `close: 6s` in ms (a self-closing big moment), else null. */
  close: number | null;
  /** `ack: none` (wave 26, C1): the big moment has no acknowledge button;
   *  only its exits close it. `none` is the only value; anything else is
   *  ignored (null). Never passed through `rest`. */
  ack: "none" | null;
  /** The other `k: v` pairs, comma-joined as written (`moment: big, question: "P1"`). */
  rest: string;
}

/** Split `s` at top-level commas (outside double quotes and parentheses). */
export function splitArgCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && quoted && i + 1 < s.length) {
      cur += c + s[i + 1]!;
      i += 1;
      continue;
    }
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "(") depth += 1;
    else if (!quoted && c === ")") depth = Math.max(0, depth - 1);
    if (c === "," && !quoted && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x !== "");
}

/** `6s` / `6 s` / `1.5s` / `800ms` / `2m` / a bare number of seconds → ms; null otherwise. */
export function parseCloseMs(raw: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?|m|min|mins|minutes?)?$/iu.exec(raw.trim());
  if (m === null) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "s").toLowerCase();
  const ms = unit === "ms" ? n : unit.startsWith("m") ? n * 60_000 : n * 1000;
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : null;
}

/** Pull `go:`, `close:` and `ack:` out of a `with …` tail (the text after ` with `). */
export function splitMomentArgs(tail: string): MomentArgs {
  const go: string[] = [];
  let close: number | null = null;
  let ack: "none" | null = null;
  const rest: string[] = [];
  for (const seg of splitArgCommas(tail)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/su.exec(seg);
    const key = kv?.[1]?.toLowerCase();
    if (key === "go") {
      const v = kv![2]!.trim();
      if (v !== "") go.push(v);
    } else if (key === "close") {
      close = parseCloseMs(kv![2]!) ?? close;
    } else if (key === "ack") {
      // Wave 26 (C1): `ack: none` (any case); another value is ignored.
      if (kv![2]!.trim().toLowerCase() === "none") ack = "none";
    } else rest.push(seg);
  }
  return { go, close, ack, rest: rest.join(", ") };
}

/** The index of ` with ` in `s` outside double quotes, or -1. */
export function withIndex(s: string): number {
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && quoted) {
      i += 1;
      continue;
    }
    if (c === '"') quoted = !quoted;
    else if (!quoted && s.startsWith(" with ", i)) return i;
  }
  return -1;
}

/** What the resolver needs from the story (a `SimModel` fits). */
export interface GoModel {
  locations: ReadonlyMap<string, { id: string; label: string | null }>;
  channels: ReadonlyMap<string, { title: string }>;
  characters: ReadonlyMap<string, unknown>;
  interactions: ReadonlyMap<string, { id: string; label: string; who: string }>;
  codex: ReadonlyMap<string, { id: string; title: string }>;
  quests: ReadonlyMap<string, { id: string; title: string }>;
}

/** The exact key of `map` that `name` names: exact first, then folded. */
function keyOf(map: ReadonlyMap<string, unknown>, name: string): string | null {
  if (map.has(name)) return name;
  const want = foldName(name);
  for (const k of map.keys()) if (foldName(k) === want) return k;
  return null;
}

/** A title cut to `max` characters with an ellipsis. */
function clip(title: string, max: number): string {
  return title.length <= max ? title : `${title.slice(0, max - 1).trimEnd()}…`;
}

/**
 * One `go:` word → its target, or null (an unknown word: lint L1214, and
 * the phone never gets it). The words, first rule that matches: a reserved
 * word (`pass`, `scan`, `chats`, `mission`, `notifications`, `sides`,
 * `wallet`, `me`, `codex`, `quests`); `codex: <Entry>` / `quest: <Quest>`;
 * a LOCATION (its room); a CHANNEL (`# hosts` / `hosts`); a CHARACTER (its
 * DM); a `who: guest` INTERACTION (its button). `… as "Label"` overrides
 * the label. The lobby is never a target.
 */
export function resolveGoWord(model: GoModel, raw: string): GoTarget | null {
  let word = raw.trim();
  let label: string | null = null;
  const as = /^(.*?)\s+as\s+"((?:[^"\\]|\\.)*)"\s*$/su.exec(word);
  if (as !== null) {
    word = as[1]!.trim();
    label = as[2]!.replace(/\\"/gu, '"').trim() || null;
  }
  word = word.replace(/^"(.*)"$/su, "$1").trim();
  if (word === "") return null;
  const f = foldName(word);
  const sub = /^(codex|quest|quests)\s*:\s*(.+)$/iu.exec(word);
  if (sub !== null) {
    const which = sub[1]!.toLowerCase();
    if (which === "codex") {
      const id = keyOf(model.codex, sub[2]!.trim());
      if (id === null) return null;
      const title = model.codex.get(id)!.title;
      return { kind: "codex", entry: id, label: label ?? `Read “${clip(title, 24)}”` };
    }
    const id = keyOf(model.quests, sub[2]!.trim());
    if (id === null) return null;
    return { kind: "quests", quest: id, label: label ?? "See the quest" };
  }
  if ((GO_WORDS as readonly string[]).includes(f)) {
    const k = f as (typeof GO_WORDS)[number];
    if (k === "codex") return { kind: "codex", label: label ?? GO_LABELS.codex };
    if (k === "quests") return { kind: "quests", label: label ?? GO_LABELS.quests };
    return { kind: k, label: label ?? GO_LABELS[k] };
  }
  if (f === "lobby") return null;
  // A LOCATION by its id or its label.
  let loc = keyOf(model.locations, word);
  if (loc === null) for (const l of model.locations.values()) if (l.label !== null && foldName(l.label) === f) loc = l.id;
  if (loc !== null) {
    const def = model.locations.get(loc)!;
    return { kind: "room", id: `loc:${loc}`, label: label ?? `Go to ${inWorldLabel(def.label ?? loc)}` };
  }
  const roomName = word.replace(/^#\s*/u, "");
  const room = keyOf(model.channels, roomName.startsWith("room:") ? roomName : `room:${roomName}`);
  if (room !== null) return { kind: "room", id: room, label: label ?? `Open ${model.channels.get(room)!.title}` };
  const ch = keyOf(model.characters, word);
  if (ch !== null) return { kind: "dm", id: `dm:${ch}`, label: label ?? `Open ${ch}` };
  const act = keyOf(model.interactions, word);
  if (act !== null) {
    const def = model.interactions.get(act)!;
    if (def.who === "guest") return { kind: "act", id: def.id, label: label ?? def.label };
  }
  return null;
}

/** Every resolvable word of `words`, in order, each target once. */
export function resolveGoWords(model: GoModel, words: readonly string[]): GoTarget[] {
  const out: GoTarget[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const t = resolveGoWord(model, w);
    if (t === null) continue;
    const key = goKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** A target's identity (kind + what it opens), for de-duplication. */
export function goKey(t: GoTarget): string {
  switch (t.kind) {
    case "room":
    case "dm":
    case "act":
      return `${t.kind}:${t.id}`;
    case "codex":
      return `codex:${t.entry ?? ""}`;
    case "quests":
      return `quests:${t.quest ?? ""}`;
    default:
      return t.kind;
  }
}
