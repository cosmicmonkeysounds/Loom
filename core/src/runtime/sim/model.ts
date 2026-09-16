//! Compile a parsed `Bundle` into a `SimModel` — the static shape of
//! the world the runtime drives: factions, locations, roles,
//! characters, their reactive hooks, and the scripted beats.

import type {
  Beat,
  BodyItem,
  ChannelBody,
  ChannelKindWord,
  CharacterBody,
  CodexBody,
  FactionBody,
  LocationBody,
  Property,
  RawLine,
  SpaceBody,
} from "../../parser/index.ts";
import { stripPrefix } from "../../parser/rust.ts";
import { FoldedIndex, foldName } from "../../parser/names.ts";
import type { Bundle } from "../bundle.ts";
import { vBool, vNumber, vString, type Value } from "../expr.ts";
import { lowerRawBody } from "./effects.ts";
import { resolveRules, type ChannelRules } from "./channel-types.ts";

export type EntityKind = "person" | "character" | "faction" | "location" | "role";

/** A time-driven trigger — `on every 30s` / `on after 2m`. */
export interface TimerSpec {
  mode: "every" | "after";
  ms: number;
}

/** A reactive rule attached to a character or role. */
export interface Hook {
  /** Owning entity id; `""` for a story-level rule. */
  ownerId: string;
  ownerKind: "character" | "role" | "story";
  /** Trigger verb — `scan`, `captured`, `join`, a signal name, … */
  verb: string;
  /** Subject bound from the event, e.g. `guest` in `on scan guest`. */
  param: string | null;
  /** Entity filter, e.g. `Mods` in `on join Mods`. */
  filter: string | null;
  /** A time trigger when this is `on every …` / `on after …`, else null. */
  timer: TimerSpec | null;
  /**
   * A **watcher** (Loom 4 §9.1): `when <condition>:` — the expression that
   * must *become* true for the body to run. `verb` is `""` for a watcher.
   */
  condition: string | null;
  /** Structured effect body (shared executor with beats). */
  body: BodyItem[];
  /** Raw `on …` clause, kept for diagnostics. */
  event: string;
}

/** A compiled ambient generator — emits a bark on a fixed interval. */
export interface GenSpec {
  id: string;
  intervalMs: number;
  barks: string[];
}

export interface FactionDef {
  id: string;
  ethos: string | null;
  hidden: boolean;
  rival: string | null;
  /** May a guest pick this group from the app's side chooser? A public
   *  group that is *assigned* by the story (an enforcer caste) says
   *  `joinable: false` and is never offered. */
  joinable: boolean;
}

export interface LocationDef {
  id: string;
  label: string | null;
  prison: boolean;
  /** A `prison: true` place a captive cannot leave on their own — the app
   *  hides its "make a break for it" button; only the story releases. */
  sealed: boolean;
  capacity: number | null;
  contains: string[];
}

export interface RoleDef {
  id: string;
  /** Per-person state defaults from the typed slots. */
  defaults: Map<string, Value>;
  hooks: Hook[];
}

export interface CharDef {
  id: string;
  faction: string | null;
  hooks: Hook[];
  /** `trusts X: N of M` axes (relationship seeds against the role). */
  disposition: CharacterBody["disposition"];
  /** Typed-slot defaults (`captures: 0 to 100 = 0`) seeded as `id.slot`. */
  defaults: Map<string, Value>;
  /** `listed: true` — a character that is a *person at the party*: shown in
   *  the participants directory and messageable. Scanner props are not. */
  listed: boolean;
  /** `mind: external` — the character is voiced by an outside agent (a
   *  stagehand agents worker driving a language model). A message to its
   *  `dm:` thread becomes an agent request instead of waiting for a
   *  performer. Null when a human (or nobody) voices it. */
  mind: string | null;
  /** Declared numeric ranges (`truth: 0 to 100 = 35`) — the bounds an
   *  agent's variable adjustments are clamped to. */
  ranges: Map<string, [number, number]>;
}

/** A compiled `CODEX` entry — a unit of shareable lore (Loom 4 §10.1). */
export interface CodexDef {
  id: string;
  title: string;
  /** The subject it concerns (a character id when it folds to one). */
  about: string | null;
  /** Folded unlock code, or null for story-only entries. */
  code: string | null;
  /** Characters that hold the entry from the start (plus its subject). */
  knownTo: string[];
  text: string;
}

/** The default space authored channels fall into when none is named. */
export const DEFAULT_SPACE_ID = "story";

export interface SpaceDef {
  id: string;
  title: string;
  /** Channel ids in source order. */
  channelIds: string[];
}

/** An authored chatroom (spec: SPACE/CHANNEL). `id` is `room:<name>`. */
export interface ChannelDef {
  id: string;
  spaceId: string;
  kind: ChannelKindWord;
  title: string;
  /** For `kind: faction`, the faction whose members this channel serves. */
  faction: string | null;
  /** Declared seed members (character/role names or guest ids). */
  members: string[];
  /** Who may invite into a private channel (`members` | `anyone` | role). */
  invite: string | null;
  /** Behaviour bundle resolved from the channel-type registry (post policy,
   *  threadability, broadcast routing, …). */
  rules: ChannelRules;
}

/** The channel-id namespace for an authored channel name. */
export function channelId(name: string): string {
  return `room:${name.trim()}`;
}

/** An `INTERACTION` the participant client offers as a button. */
export interface InteractionDef {
  id: string;
  label: string;
  who: "performer" | "guest" | "admin";
  description: string | null;
}

export interface SimModel {
  /** The story's `# Title` (first file that has one), for the app's chrome. */
  title: string | null;
  /** The header `theme:` for the participant client (`plain` when unset). */
  theme: string | null;
  /** Story-level `when …:` rules (Loom 4 §9.3) — hooks with no owner. */
  rules: Hook[];
  /** Declared `INTERACTION`s, in source order. */
  interactions: Map<string, InteractionDef>;
  /** Declared `CODEX` entries, in source order. */
  codex: Map<string, CodexDef>;
  /** Folded-name lookup for codex entries. */
  codexIndex: FoldedIndex;
  /** Folded unlock code → entry id. */
  codexCodes: Map<string, string>;
  /** Header `directory:` — `everyone` lists every participant to every
   *  guest; unset keeps the acquaintance-only roster. */
  directory: string | null;
  factions: Map<string, FactionDef>;
  locations: Map<string, LocationDef>;
  roles: Map<string, RoleDef>;
  characters: Map<string, CharDef>;
  /** Authored spaces (Discord-style sidebar containers). */
  spaces: Map<string, SpaceDef>;
  /** Authored channels, keyed by `room:<name>`. */
  channels: Map<string, ChannelDef>;
  beats: Map<string, Beat>;
  /** id → kind, for seeding self-identity values + dispatch. */
  entityKind: Map<string, EntityKind>;
  /** The role a fresh Person is cast into (first `ROLE` declared). */
  defaultRole: string | null;
  /** `start:` / `entry:` beat from a file header, if any. */
  entry: string | null;
  /**
   * Folded-name lookups (Loom 4 §3) — the exact key a loosely-spelled
   * beat / entity name resolves to when the exact lookup misses.
   */
  beatIndex: FoldedIndex;
  entityIndex: FoldedIndex;
  /** Character-owned time-driven hooks, fired by `Sim.tick`. */
  timerHooks: Hook[];
  /** Ambient generators (top-level + character-bound), fired by `tick`. */
  gens: GenSpec[];
}

/** Compile every loaded file in `bundle` into one `SimModel`. */
export function compileModel(bundle: Bundle): SimModel {
  const model: SimModel = {
    title: null,
    theme: null,
    rules: [],
    interactions: new Map(),
    codex: new Map(),
    codexIndex: new FoldedIndex(),
    codexCodes: new Map(),
    directory: null,
    factions: new Map(),
    locations: new Map(),
    roles: new Map(),
    characters: new Map(),
    spaces: new Map(),
    channels: new Map(),
    beats: new Map(),
    entityKind: new Map(),
    defaultRole: null,
    entry: null,
    beatIndex: new FoldedIndex(),
    entityIndex: new FoldedIndex(),
    timerHooks: [],
    gens: [],
  };

  // Resolve `is X, Y` inheritance so `mergedCharacters` is populated before
  // we read it below. Without this the merge is dead code (its only other
  // caller is a unit test) and every `is` clause is silently inert.
  bundle.rebuildSimulacra();

  for (const entry of bundle.files) {
    const entryProp =
      entry.file.header.properties.get("start") ?? entry.file.header.properties.get("entry");
    if (model.entry === null && entryProp !== undefined) model.entry = entryProp.value;
    if (model.title === null && entry.file.header.title !== null) model.title = entry.file.header.title;
    const themeProp = entry.file.header.properties.get("theme");
    if (model.theme === null && themeProp !== undefined) model.theme = themeProp.value.trim();
    const dirProp = entry.file.header.properties.get("directory");
    if (model.directory === null && dirProp !== undefined) model.directory = dirProp.value.trim().toLowerCase();

    for (const item of entry.file.items) {
      if (item.kind === "beat") {
        model.beats.set(item.value.name, item.value);
        continue;
      }
      if (item.kind === "rule") {
        model.rules.push(ruleHook(item.value.event, item.value.body));
        continue;
      }
      if (item.kind !== "declaration") continue;
      const decl = item.value;
      switch (decl.kind) {
        case "faction":
          if (decl.faction) {
            model.factions.set(decl.name, factionDef(decl.name, decl.faction));
            model.entityKind.set(decl.name, "faction");
          }
          break;
        case "location":
          if (decl.location) {
            model.locations.set(decl.name, locationDef(decl.name, decl.location));
            model.entityKind.set(decl.name, "location");
          }
          break;
        case "role":
          if (decl.character) {
            // Read the merged body so `ROLE X is Trait` picks up inherited
            // slots + hooks; fall back to the raw body if the merge dropped it.
            const body = bundle.mergedCharacters.get(decl.name) ?? decl.character;
            model.roles.set(decl.name, roleDef(decl.name, body));
            model.entityKind.set(decl.name, "role");
            if (model.defaultRole === null) model.defaultRole = decl.name;
          }
          break;
        case "character":
          if (decl.character) {
            // Read the merged body so `is X, Y` inheritance (faction badge,
            // shared hooks, …) is live at sim time. An abstract character the
            // merge dropped falls back to its raw declaration.
            const body = bundle.mergedCharacters.get(decl.name) ?? decl.character;
            model.characters.set(decl.name, charDef(decl.name, body));
            model.entityKind.set(decl.name, "character");
            // Character-bound generators (spec §10.5) become ambient emitters.
            for (const gen of body.generators) {
              const spec = genSpec(`${decl.name}.${gen.name}`, gen.body);
              if (spec !== null) model.gens.push(spec);
            }
            // Class-owned beats (spec §11.1) register under `Owner.name` so two
            // props may each own a `main`/`greet`, reached by `-> self.name`.
            // A derived beat's `slot:` holes are filled from the deriver's
            // `fill` blocks here, on the lowered tree (spec §11.3).
            for (const ob of body.beats) {
              const key = `${decl.name}.${ob.name}`;
              const missing = new Set<string>();
              const filled = fillSlots(lowerRawBody(ob.body), body.fills, missing);
              for (const slot of missing) {
                bundle.projectDiagnostics.push({
                  kind: "unfilledDerivedSlot",
                  character: decl.name,
                  beat: ob.name,
                  slot,
                });
              }
              model.beats.set(key, {
                name: key,
                params: ob.params,
                contract: new Map(),
                body: filled,
                span: ob.span,
              });
            }
          }
          break;
        case "generator":
          if (decl.generator) {
            const spec = genSpec(decl.name, decl.generator.body);
            if (spec !== null) model.gens.push(spec);
          }
          break;
        case "space":
          if (decl.space) registerSpace(model, decl.name, decl.space);
          break;
        case "channel":
          if (decl.channel) registerChannel(model, decl.channel, decl.channel.space);
          break;
        case "interaction":
          if (decl.interaction) {
            model.interactions.set(decl.name, {
              id: decl.name,
              label: decl.interaction.label ?? decl.name,
              who: decl.interaction.who,
              description: decl.interaction.description,
            });
          }
          break;
        case "codex":
          if (decl.codex) model.codex.set(decl.name, codexDef(decl.name, decl.codex));
          break;
        default:
          break;
      }
    }
  }

  // Character-owned time hooks drive the autonomous clock.
  for (const char of model.characters.values()) {
    for (const hook of char.hooks) if (hook.timer !== null) model.timerHooks.push(hook);
  }
  for (const rule of model.rules) if (rule.timer !== null) model.timerHooks.push(rule);
  // Folded-name indexes: every beat key and every declared entity id, so a
  // divert / speaker / verb argument spelled loosely still resolves.
  for (const key of model.beats.keys()) model.beatIndex.add(key);
  for (const id of model.entityKind.keys()) model.entityIndex.add(id);
  // Codex entries: a loosely-spelled `about:` / `known to:` resolves to the
  // declared character; the subject holds its own entries from the start;
  // unlock codes index by their folded form (so `sandy-1997` ≡ `SANDY 1997`).
  for (const entry of model.codex.values()) {
    if (entry.about !== null) entry.about = model.entityIndex.get(entry.about) ?? entry.about;
    entry.knownTo = entry.knownTo.map((k) => model.entityIndex.get(k) ?? k);
    if (entry.about !== null && model.characters.has(entry.about) && !entry.knownTo.includes(entry.about)) {
      entry.knownTo.unshift(entry.about);
    }
    model.codexIndex.add(entry.id);
    if (entry.code !== null) model.codexCodes.set(entry.code, entry.id);
  }
  if (model.entry !== null && !model.beats.has(model.entry)) {
    model.entry = model.beatIndex.get(model.entry) ?? model.entry;
  }
  // Every channel's space must exist; synthesise one for `space:`-referenced
  // or default-space channels, and keep `channelIds` consistent + ordered.
  for (const ch of model.channels.values()) {
    const space = ensureSpace(model, ch.spaceId);
    if (!space.channelIds.includes(ch.id)) space.channelIds.push(ch.id);
  }
  return model;
}

function channelDef(body: ChannelBody, spaceId: string): ChannelDef {
  return {
    id: channelId(body.name),
    spaceId,
    kind: body.kind,
    title: body.label ?? `#${body.name}`,
    faction: body.faction,
    members: [...body.members],
    invite: body.invite,
    rules: resolveRules(body.kind, body.type, {
      post: body.post,
      threads: body.threads,
      routes: body.routes,
      slow: body.slow,
      ephemeral: body.ephemeral,
    }),
  };
}

function registerChannel(model: SimModel, body: ChannelBody, spaceId: string | null): void {
  const def = channelDef(body, spaceId ?? DEFAULT_SPACE_ID);
  model.channels.set(def.id, def);
}

function registerSpace(model: SimModel, name: string, body: SpaceBody): void {
  const space: SpaceDef = ensureSpace(model, name, body.label ?? name);
  for (const ch of body.channels) {
    const def = channelDef(ch, name);
    model.channels.set(def.id, def);
    if (!space.channelIds.includes(def.id)) space.channelIds.push(def.id);
  }
}

/** Get-or-create a space (a `space:`-referenced or default space is implicit). */
function ensureSpace(model: SimModel, id: string, title?: string): SpaceDef {
  let space = model.spaces.get(id);
  if (space === undefined) {
    space = { id, title: title ?? id, channelIds: [] };
    model.spaces.set(id, space);
  } else if (title !== undefined) {
    space.title = title; // a later explicit SPACE wins over an implicit one
  }
  return space;
}

function factionDef(id: string, body: FactionBody): FactionDef {
  return {
    id,
    ethos: scalarProp(body.properties, "ethos"),
    hidden: scalarProp(body.properties, "hidden") === "true",
    rival: scalarProp(body.properties, "rival"),
    joinable: scalarProp(body.properties, "joinable") !== "false",
  };
}

/** Fold an unlock code: case, dashes, underscores and spaces are noise. */
export function foldCode(code: string): string {
  return code.trim().toLowerCase().replace(/[\s_\-]+/gu, "");
}

function codexDef(id: string, body: CodexBody): CodexDef {
  return {
    id,
    title: body.title ?? id,
    about: body.about,
    code: body.code !== null && foldCode(body.code).length > 0 ? foldCode(body.code) : null,
    knownTo: [...body.knownTo],
    text: body.text,
  };
}

function locationDef(id: string, body: LocationBody): LocationDef {
  return {
    id,
    label: body.label,
    prison: body.properties.get("prison")?.value === "true",
    sealed: body.properties.get("sealed")?.value === "true",
    capacity: body.capacity,
    contains: body.contains,
  };
}

/**
 * Splice `fill` content into a lowered beat body in place of each `slot:`
 * placeholder (spec §11.3), recursing into every nested control-flow body so a
 * hole under a `SELF` block or inside `<if:>` is reached. A slot with no
 * matching fill is dropped and its name collected in `missing`.
 */
function fillSlots(
  items: BodyItem[],
  fills: Map<string, RawLine[]>,
  missing: Set<string>,
): BodyItem[] {
  const recur = (b: BodyItem[]): BodyItem[] => fillSlots(b, fills, missing);
  const out: BodyItem[] = [];
  for (const item of items) {
    switch (item.kind) {
      case "slotPlaceholder": {
        const fill = fills.get(item.value.name);
        if (fill !== undefined) out.push(...lowerRawBody(fill));
        else missing.add(item.value.name);
        break;
      }
      case "dialogue":
        out.push({ kind: "dialogue", value: { ...item.value, body: recur(item.value.body) } });
        break;
      case "choice":
        out.push({ kind: "choice", value: { ...item.value, body: recur(item.value.body) } });
        break;
      case "directiveBlock":
        out.push({ kind: "directiveBlock", value: { ...item.value, body: recur(item.value.body) } });
        break;
      case "conditional":
        out.push({
          kind: "conditional",
          value: { ...item.value, arms: item.value.arms.map((a) => ({ ...a, body: recur(a.body) })) },
        });
        break;
      case "match":
        out.push({
          kind: "match",
          value: { ...item.value, arms: item.value.arms.map((a) => ({ ...a, body: recur(a.body) })) },
        });
        break;
      case "eachVisit":
        out.push({
          kind: "eachVisit",
          value: {
            ...item.value,
            first: recur(item.value.first),
            then: recur(item.value.then),
            finally: recur(item.value.finally),
          },
        });
        break;
      case "afterMorph":
        out.push({
          kind: "afterMorph",
          value: {
            ...item.value,
            after: recur(item.value.after),
            otherwise: recur(item.value.otherwise),
          },
        });
        break;
      default:
        out.push(item);
    }
  }
  return out;
}

function roleDef(id: string, body: CharacterBody): RoleDef {
  const defaults = new Map<string, Value>();
  for (const prop of body.typedProperties) {
    const v = defaultValueOf(prop);
    if (v !== null) defaults.set(prop.name, v);
  }
  return { id, defaults, hooks: hooksOf(id, "role", body) };
}

function charDef(id: string, body: CharacterBody): CharDef {
  const defaults = new Map<string, Value>();
  const ranges = new Map<string, [number, number]>();
  for (const prop of body.typedProperties) {
    const v = defaultValueOf(prop);
    if (v !== null) defaults.set(prop.name, v);
    if (prop.slotType?.kind === "range") ranges.set(prop.name, [prop.slotType.lo, prop.slotType.hi]);
  }
  const mind = body.properties.get("mind")?.value.trim() ?? "";
  return {
    id,
    faction: body.properties.get("faction")?.value ?? null,
    hooks: hooksOf(id, "character", body),
    disposition: body.disposition,
    defaults,
    listed: body.properties.get("listed")?.value.trim() === "true",
    mind: mind === "" ? null : mind,
    ranges,
  };
}

function hooksOf(ownerId: string, ownerKind: "character" | "role", body: CharacterBody): Hook[] {
  return body.hooks.filter((h) => !h.suppressed).map((h) => hookOf(ownerId, ownerKind, h.event, h.body));
}

/** A story-level rule is a hook with no owner. */
function ruleHook(event: string, body: RawLine[]): Hook {
  return hookOf("", "story", event, body);
}

function hookOf(ownerId: string, ownerKind: Hook["ownerKind"], event: string, body: RawLine[]): Hook {
  const timer = parseTimer(event);
  const condition = timer === null && isConditionTrigger(event) ? event.trim() : null;
  const { verb, param, filter } =
    condition === null ? parseTrigger(event) : { verb: "", param: null, filter: null };
  return {
    ownerId,
    ownerKind,
    verb,
    param,
    filter,
    timer,
    condition,
    body: lowerRawBody(body),
    event,
  };
}

/** Parse `every 30s` / `after 2m` into a timer spec, else null. */
export function parseTimer(event: string): TimerSpec | null {
  const words = event.trim().split(/\s+/u).filter((w) => w.length > 0);
  const head = words[0];
  if (head !== "every" && head !== "after" && head !== "at") return null;
  const ms = parseDuration(words.slice(1).join(""));
  if (ms === null) return null;
  return { mode: head === "every" ? "every" : "after", ms };
}

/** Parse a duration token (`30s`, `200ms`, `2m`, bare = seconds) to ms. */
export function parseDuration(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/u.exec(s.trim());
  if (m === null) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? "s";
  return unit === "ms" ? n : unit === "m" ? n * 60000 : n * 1000;
}

/** Lower a generator body into an interval + bark list, or null. */
function genSpec(id: string, body: RawLine[]): GenSpec | null {
  let intervalMs: number | null = null;
  const barks: string[] = [];
  for (const line of body) {
    const text = line.text.trim();
    const every = stripPrefix(text, "every ");
    if (every !== null) {
      // `every 20s` or `wait random(20s, 60s)` → take the first duration.
      const tok = every.trim().split(/[\s,()]+/u).find((t) => /^\d/u.test(t));
      if (tok !== undefined) intervalMs = parseDuration(tok);
      continue;
    }
    const barkFrom = stripPrefix(text, "yield bark from ");
    if (barkFrom !== null) {
      barks.push(...barkFrom.split("|").map((s) => s.trim()).filter((s) => s.length > 0));
      continue;
    }
    const yieldText = stripPrefix(text, "yield ");
    if (yieldText !== null) barks.push(yieldText.trim());
  }
  if (intervalMs === null || barks.length === 0) return null;
  return { id, intervalMs, barks };
}

/**
 * Enum of the trigger verbs the engine itself fires (lifecycle +
 * movement + faction motion + the scan pipeline). Everything else a
 * hook listens for is an authored **named event**, fired by
 * `<fire: name>` or `Sim.signal(name)`. Const-object enum
 * (`erasableSyntaxOnly`-safe), values = the verb strings.
 */
export const BuiltinVerb = {
  AccountCreated: "account_created",
  Join: "join",
  Defect: "defect",
  Betray: "betray",
  Scan: "scan",
  Arrive: "arrive",
  Enters: "enters",
  Exits: "exits",
  Captured: "captured",
  Released: "released",
  Escape: "escape",
  Revealed: "revealed",
  /** A codex entry landed in someone's hands (Loom 4 §10.1):
   *  `when guest learns The Sandy File:`. */
  Learn: "learn",
  /** A holder passed a codex entry to someone. */
  Share: "share",
} as const;

export type BuiltinVerb = (typeof BuiltinVerb)[keyof typeof BuiltinVerb];

const BUILTIN_VERBS = new Set<string>(Object.values(BuiltinVerb));

/** Is this trigger verb one the engine fires on its own? */
export function isBuiltinVerb(verb: string): verb is BuiltinVerb {
  return BUILTIN_VERBS.has(verb);
}

/**
 * Every authored **named event** in the model — hook verbs that are not
 * builtin lifecycle verbs and not timers (`on lockdown`, `on rally`, …),
 * sorted. This is the enumeration a director UI's "fire signal" picker
 * offers, so firing named events is a closed choice, not a free string.
 */
export function namedEvents(model: SimModel): string[] {
  // Keyed by folded name so `ring the bell` / `ring_the_bell` list once,
  // under the first spelling seen (a declared INTERACTION's wins).
  const out = new Map<string, string>();
  const add = (name: string): void => {
    const k = foldName(name);
    if (!out.has(k)) out.set(k, name);
  };
  for (const i of model.interactions.keys()) add(i);
  const collect = (hooks: Hook[]): void => {
    for (const h of hooks) {
      if (h.timer !== null || h.condition !== null) continue;
      if (h.verb.length === 0 || isBuiltinVerb(h.verb)) continue;
      add(h.verb);
    }
  };
  for (const c of model.characters.values()) collect(c.hooks);
  for (const r of model.roles.values()) collect(r.hooks);
  collect(model.rules);
  return [...out.values()].sort();
}

/**
 * Filler words an event phrase may carry and the trigger ignores (Loom 4
 * §9.1): `when scanned by a guest` ≡ `when scanned guest` ≡ `on scan guest`.
 */
const TRIGGER_FILLERS = new Set([
  "a", "an", "the", "is", "are", "has", "have", "been", "gets", "get",
  "by", "at", "in", "on", "to", "for", "from", "with", "into", "of", "onto",
]);

/**
 * Human spellings of the built-in verbs → the engine's trigger verb. The
 * v3 verb itself always maps to itself.
 */
const VERB_SYNONYMS: ReadonlyMap<string, string> = new Map([
  ["scan", "scan"], ["scans", "scan"], ["scanned", "scan"],
  ["enters", "enters"], ["enter", "enters"], ["entered", "enters"],
  ["arrives", "enters"], ["arrive", "enters"], ["arrived", "enters"],
  ["exits", "exits"], ["exit", "exits"], ["leaves", "exits"], ["leave", "exits"], ["left", "exits"],
  ["join", "join"], ["joins", "join"], ["joined", "join"],
  ["defect", "defect"], ["defects", "defect"], ["defected", "defect"],
  ["betray", "betray"], ["betrays", "betray"], ["betrayed", "betray"],
  ["captured", "captured"], ["capture", "captured"],
  ["released", "released"], ["release", "released"],
  ["escape", "escape"], ["escapes", "escape"], ["escaped", "escape"],
  ["revealed", "revealed"], ["reveal", "revealed"],
  ["removed", "removed"], ["remove", "removed"],
  ["arrive_anywhere", "arrive"],
  ["learn", "learn"], ["learns", "learn"], ["learned", "learn"], ["learnt", "learn"],
  ["share", "share"], ["shares", "share"], ["shared", "share"],
]);

/**
 * Parse an `on …` / `when …` event phrase into a structured trigger. The
 * first word that names a built-in verb is the **verb** (`scanned` → `scan`,
 * `arrives` → `enters`); with none, the first non-filler lowercase word is a
 * **named event**. Remaining lowercase words bind the subject (`guest`);
 * a Capitalised word is a **filter** (`Cellar`, `Mods`). `someone joins` /
 * `participant joins` is the account-creation event.
 */
export function parseTrigger(event: string): {
  verb: string;
  param: string | null;
  filter: string | null;
} {
  const raw = event.trim().split(/\s+/u).filter((w) => w.length > 0);
  if (raw.length >= 2 && (raw[0] === "someone" || raw[0] === "participant" || raw[0] === "anyone")) {
    const w = raw[1]!.toLowerCase();
    if (w === "joins" || w === "arrives" || w === "signs" || w === "logs") {
      return { verb: BuiltinVerb.AccountCreated, param: null, filter: null };
    }
  }
  // v3 spelling: the verb is the first word, verbatim (`on rally guest`).
  const words = raw.filter((w) => !TRIGGER_FILLERS.has(w)); // case-sensitive: `The` is a name
  let verb: string | null = null;
  let verbIdx = -1;
  for (let i = 0; i < words.length; i++) {
    const syn = VERB_SYNONYMS.get(words[i]!.toLowerCase());
    if (syn !== undefined) {
      verb = syn;
      verbIdx = i;
      break;
    }
  }
  if (verb === null) {
    // A **named event**. Loom 4 names are words, so the event may be several
    // of them: everything before a `for` binding keyword (`when ring the
    // bell for guest:`), or — with no binding — the whole phrase when it
    // reads as one (it carries a filler word, `ring the bell`). Otherwise
    // the v3 shape holds: first word = event, next lowercase word = binding
    // (`on rally guest`). Matching folds, so `fire ring_the_bell` reaches it.
    const forAt = raw.indexOf("for");
    if (forAt > 0) {
      const event = raw.slice(0, forAt).join(" ");
      const tail = raw.slice(forAt + 1).filter((w) => !TRIGGER_FILLERS.has(w));
      let p: string | null = null;
      let f: string | null = null;
      const frun: string[] = [];
      for (const w of tail) {
        if (/^[A-Z]/u.test(w)) frun.push(w);
        else if (p === null && /^[a-z_][A-Za-z0-9_]*$/u.test(w)) p = w;
      }
      if (frun.length > 0) f = frun.join(" ");
      return { verb: event, param: p, filter: f };
    }
    const hasFiller = raw.some((w) => TRIGGER_FILLERS.has(w));
    const lower = words.filter((w) => /^[a-z_]/u.test(w));
    if (hasFiller && lower.length >= 2 && lower.length === words.length) {
      return { verb: raw.join(" "), param: null, filter: null };
    }
    verbIdx = words.findIndex((w) => /^[a-z_]/u.test(w));
    if (verbIdx < 0) verbIdx = 0;
    verb = words[verbIdx] ?? "";
  }
  let param: string | null = null;
  let filter: string | null = null;
  // A run of Capitalised words is one filter (`at The Cellar` → `The Cellar`).
  let run: string[] = [];
  const flush = (): void => {
    if (run.length > 0) filter = run.join(" ");
    run = [];
  };
  for (let i = 0; i < words.length; i++) {
    if (i === verbIdx) {
      flush();
      continue;
    }
    const w = words[i]!;
    if (/^[A-Z]/u.test(w)) {
      run.push(w);
    } else {
      flush();
      if (/^[a-z_][A-Za-z0-9_]*$/u.test(w) && param === null) param = w;
    }
  }
  flush();
  return { verb, param, filter };
}

/**
 * Is this `when …` phrase a **condition** (a watcher) rather than an event?
 * A comparison / boolean operator, a call, or a leading dotted path
 * (`self.heat`) makes it an expression over the world.
 */
export function isConditionTrigger(event: string): boolean {
  const t = event.trim();
  if (/(==|!=|>=|<=|[<>])/u.test(t)) return true;
  if (/\b(and|or|not)\b/u.test(t)) return true;
  if (/\w\(/u.test(t)) return true;
  const head = t.split(/\s+/u)[0] ?? "";
  return head.includes(".") && !/^[A-Z]/u.test(head) ? true : /^[A-Za-z_][\w]*\.[\w.]+$/u.test(t);
}

/** The default first/last typed-slot value (`default ?? rawType`). */
function scalarProp(props: Property[], name: string): string | null {
  const p = props.find((x) => x.name === name);
  if (p === undefined) return null;
  return p.default ?? p.rawType;
}

function defaultValueOf(prop: Property): Value | null {
  if (prop.slotType !== null && prop.slotType.kind === "range" && prop.slotType.default !== null) {
    return vNumber(prop.slotType.default);
  }
  if (prop.default !== null) {
    const d = prop.default.trim();
    if (d === "true") return vBool(true);
    if (d === "false") return vBool(false);
    const n = Number(d);
    if (d.length > 0 && !Number.isNaN(n)) return vNumber(n);
    return vString(d);
  }
  return null;
}
