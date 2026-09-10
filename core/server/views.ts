//! Pure per-role projections of the live `Sim` into the snapshots each
//! client renders. Kept dependency-free and side-effect-free so they're
//! unit-testable without standing up the HTTP/SSE server.

import { DEFAULT_SPACE_ID } from "../src/runtime/sim/model.ts";
import type { Sim } from "../src/runtime/sim/index.ts";

export type RuntimePhase = "idle" | "open" | "paused";

/**
 * Best display title authored in a `.loom` source: the first `# Title`
 * heading — skipping the `# ── path ──` file-separator comments that
 * multi-file concatenation inserts (`projectSource` / `examples/load.ts`) —
 * else the first `title:` header property. Null when the source names
 * nothing; callers fall back to the project/scenario name.
 */
/** The header `theme:` property of a `.loom` source, if any (Loom 4 §11). */
export function themeOf(source: string): string | null {
  const m = /^theme:\s*(\S.*)$/mu.exec(source);
  return m !== null ? m[1]!.trim() : null;
}

/** A declared INTERACTION as the client sees it. */
export interface InteractionSummary {
  id: string;
  label: string;
  who: "performer" | "guest" | "admin";
  description: string | null;
}

function interactionsFor(sim: Sim, who: Array<InteractionSummary["who"]> | null): InteractionSummary[] {
  return [...sim.model.interactions.values()]
    .filter((i) => who === null || who.includes(i.who))
    .map((i) => ({ id: i.id, label: i.label, who: i.who, description: i.description }));
}

export function titleOf(source: string): string | null {
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("#")) {
      const rest = line.slice(1).trim();
      if (rest === "" || rest.startsWith("#") || rest.startsWith("─")) continue;
      return rest;
    }
    const m = /^([A-Za-z][A-Za-z0-9_ -]*):\s*(.*)$/.exec(line);
    if (m !== null) {
      if (m[1]!.trim().toLowerCase() === "title" && m[2]!.trim() !== "") return m[2]!.trim();
      continue; // another header property (entry:, …) — keep scanning
    }
    break; // first real content line — the header is over
  }
  return null;
}

/** An authored channel a participant can see, for the sidebar. */
export interface ChannelSnapshot {
  id: string;
  kind: string; // open | private | faction | group | dm
  title: string;
  spaceId: string;
  /** True when the viewer is an explicit member (drives leave/invite). */
  member: boolean;
  /** May the viewer post here (post policy)? Drives the composer. */
  canPost: boolean;
  /** Can messages here open threads? Drives the reply affordance. */
  threadable: boolean;
}

/** A Discord-style sidebar section title. */
export interface SpaceSnapshot {
  id: string;
  title: string;
}

/** What a single party-goer sees about themselves. */
export interface GuestView {
  id: string;
  name: string;
  /** The story's title + theme — the client's chrome comes from the story. */
  title: string;
  theme: string;
  role: string | null;
  /** App-facing faction — hidden factions read `null` until revealed. */
  faction: string | null;
  score: number;
  location: string | null;
  captured: boolean;
  /** Outstanding choice options awaiting this guest, if any. */
  pendingChoice: string[] | null;
  /** Channel the pending decision docks under (`"lobby"`, a DM, …). */
  decisionChannel: string | null;
  /** Authored channels this guest can see (open + faction + member rooms). */
  channels: ChannelSnapshot[];
  /** Titles for the authored sidebar sections. */
  spaces: SpaceSnapshot[];
  /** Other participants (id + name) — the invite picker's source. */
  roster: Array<{ id: string; name: string }>;
  /** The public (non-hidden) factions a guest may join — the side chooser's
   *  source. Empty when the story declares none (no chooser shown). */
  factions: string[];
  /** Every group this guest belongs to (public ones only — hidden until revealed). */
  groups: string[];
  /** `INTERACTION`s a guest may fire for themselves (`who: guest`). */
  interactions: InteractionSummary[];
}

export function guestView(sim: Sim, id: string, decisionChannel: string | null = null): GuestView {
  const p = sim.persons.get(id);
  const pendingChoice = sim.pendingChoiceFor(id);
  return {
    id,
    name: p?.name ?? id,
    title: sim.lobbyTitle(),
    theme: sim.model.theme ?? "plain",
    role: p?.role ?? null,
    faction: sim.publicFactionOf(id),
    score: sim.scoreOf(id),
    location: sim.locationOf(id),
    captured: sim.isCaptured(id),
    pendingChoice,
    decisionChannel: pendingChoice ? (decisionChannel ?? "lobby") : null,
    channels: sim.visibleChannelsFor(id),
    spaces: sim.spaceList(),
    roster: sim.rosterFor(id),
    factions: [...sim.model.factions.values()].filter((f) => !f.hidden).map((f) => f.id),
    groups: sim.groupsOf(id).filter((g) => {
      const def = sim.model.factions.get(g);
      return def === undefined || !def.hidden || sim.factionRevealed(g);
    }),
    interactions: interactionsFor(sim, ["guest"]),
  };
}

export interface RosterRow {
  id: string;
  name: string;
  role: string;
  /** True faction (operator view — includes hidden allegiances). */
  faction: string | null;
  trueFaction: string | null;
  location: string | null;
  captured: boolean;
  score: number;
  /** Story position — the beat this guest is currently inside, if any. */
  beat: string | null;
  /** Their trail: every beat entered for them, with visit counts. */
  visited: Record<string, number>;
  /** Live presence: this guest has an SSE stream open right now. Absent
   *  where no connection tracking exists (local sim, journal replay). */
  online?: boolean;
  /** The director who spawned this persona (`/api/mod/persona`), by display
   *  name; null for a real guest. Set only by `modView` from presence. */
  owner?: string | null;
}

/** The operator's god-view of one guest. Null if the QR is unknown. */
export function rosterRow(sim: Sim, id: string): RosterRow | null {
  const p = sim.persons.get(id);
  if (p === undefined) return null;
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    faction: sim.factionOf(p.id),
    trueFaction: sim.trueFactionOf(p.id),
    location: sim.locationOf(p.id),
    captured: sim.isCaptured(p.id),
    score: sim.scoreOf(p.id),
    beat: sim.lastBeatOf(p.id),
    visited: sim.visitedBeatsFor(p.id),
  };
}

export interface FactionSummary {
  id: string;
  hidden: boolean;
  revealed: boolean;
  ethos: string | null;
  rival: string | null;
  members: string[];
}

export interface LocationSummary {
  id: string;
  label: string | null;
  prison: boolean;
  occupants: string[];
}

/** An operator-visible room: every authored + derived channel, unscoped. */
export interface ChannelSummary {
  id: string;
  kind: string;
  title: string;
  spaceId: string;
}

/** A member of the cast (an authored CHARACTER an operator can speak/fire as). */
export interface CastSummary {
  id: string;
  faction: string | null;
  /** A performer is signed in and streaming as this character right now.
   *  Absent where no connection tracking exists (local sim). */
  online?: boolean;
}

/** Who is connected to the event right now, by capability. */
export interface ModPresence {
  /** Guest ids with an open SSE stream. */
  guests: Set<string>;
  /** Character ids a signed-in performer is streaming as. */
  primes: Set<string>;
  /** Connected mod/director consoles (the editor's Run mode, each co-writer). */
  mods: number;
  /** Their display names (one entry per open console; "Director" when anonymous). */
  directors: string[];
  /** persona id → puppeteer display name (mod-spawned personas only). */
  owners?: Map<string, string>;
}

/** The operator's full god-view of the world. */
export interface ModView {
  /** The story's title + theme (what participants see). */
  title?: string;
  theme?: string;
  /** Every declared INTERACTION (the director may fire any of them). */
  interactions?: InteractionSummary[];
  phase: RuntimePhase;
  scenario: string | null;
  roster: RosterRow[];
  factions: FactionSummary[];
  locations: LocationSummary[];
  /** Character ids (thin list; the run panel uses `cast` for factions too). */
  characters: string[];
  /** The cast with their factions — the run panel's "speak/fire as" picker. */
  cast: CastSummary[];
  /** Every room the operator can peer into / post to (lobby + factions + authored). */
  channels: ChannelSummary[];
  /** Authored sidebar sections, for grouping the rooms list. */
  spaces: SpaceSnapshot[];
  /** Every named beat, for the "fire beat" picker. */
  beats: string[];
  /** Outstanding choices per person id (`__global` for unbound menus) —
   *  lets the run panel surface + answer a stuck decision. */
  choices: Record<string, string[]>;
  ledgerLen: number;
  /** The whole world state as display strings (the director's debugger). */
  world: Array<{ path: string; value: string }>;
  /** Connected director consoles (co-writers moderating this event). */
  modsOnline?: number;
  /** Who those directors are (display names, one per console). */
  directors?: string[];
}

/**
 * Every channel an operator can moderate, unscoped by visibility: the lobby,
 * one derived broadcast channel per faction, and every authored SPACE/CHANNEL.
 * Derived per-character DM threads aren't enumerated (they appear in the feed
 * as messages land); the operator addresses a guest DM via a `guest:<id>` say.
 */
function operatorChannels(sim: Sim): ChannelSummary[] {
  const space = DEFAULT_SPACE_ID;
  const out: ChannelSummary[] = [{ id: "lobby", kind: "lobby", title: sim.lobbyTitle(), spaceId: space }];
  for (const f of sim.model.factions.values()) {
    out.push({ id: `faction:${f.id}`, kind: "faction", title: `#${f.id.toLowerCase()}`, spaceId: space });
  }
  // Every location's derived room — where a beat's setting routes its story.
  for (const l of sim.model.locations.values()) {
    out.push({ id: `loc:${l.id}`, kind: "location", title: l.label ?? l.id, spaceId: space });
  }
  for (const id of sim.model.channels.keys()) {
    const h = sim.channelHead(id);
    out.push({ id: h.channel, kind: h.channelKind, title: h.title, spaceId: h.spaceId });
  }
  return out;
}

export function modView(sim: Sim | null, phase: RuntimePhase, scenario: string | null, presence?: ModPresence): ModView {
  if (sim === null) {
    return {
      phase,
      scenario,
      roster: [],
      factions: [],
      locations: [],
      characters: [],
      cast: [],
      channels: [],
      spaces: [],
      beats: [],
      choices: {},
      ledgerLen: 0,
      world: [],
      modsOnline: presence?.mods,
    };
  }
  const roster: RosterRow[] = [...sim.persons.keys()].map((id) =>
    presence !== undefined
      ? { ...rosterRow(sim, id)!, online: presence.guests.has(id), owner: presence.owners?.get(id) ?? null }
      : rosterRow(sim, id)!,
  );
  const factions: FactionSummary[] = [...sim.model.factions.values()].map((f) => ({
    id: f.id,
    hidden: f.hidden,
    revealed: sim.factionRevealed(f.id),
    ethos: f.ethos,
    rival: f.rival,
    members: sim.factionMembers(f.id),
  }));
  const locations: LocationSummary[] = [...sim.model.locations.values()].map((l) => ({
    id: l.id,
    label: l.label,
    prison: l.prison,
    occupants: roster.filter((r) => r.location === l.id).map((r) => r.id),
  }));
  return {
    phase,
    scenario,
    roster,
    title: sim.lobbyTitle(),
    theme: sim.model.theme ?? "plain",
    interactions: interactionsFor(sim, null),
    factions,
    locations,
    characters: [...sim.model.characters.keys()],
    cast: [...sim.model.characters.values()].map((c) => ({
      id: c.id,
      faction: c.faction ?? null,
      ...(presence !== undefined ? { online: presence.primes.has(c.id) } : {}),
    })),
    channels: operatorChannels(sim),
    spaces: sim.spaceList(),
    beats: [...sim.model.beats.keys()],
    choices: sim.allPendingChoices(),
    ledgerLen: sim.log.len(),
    world: sim.worldEntries(),
    modsOnline: presence?.mods,
    directors: presence?.directors,
  };
}

export interface PrimeGuest {
  id: string;
  name: string;
  faction: string | null;
  captured: boolean;
}

/** What an actor playing a character sees: their part + scannable guests. */
export interface PrimeView {
  character: string;
  title: string;
  theme: string;
  faction: string | null;
  guests: PrimeGuest[];
  /** Every authored channel — performers run every room. */
  channels: ChannelSnapshot[];
  spaces: SpaceSnapshot[];
  /** `INTERACTION`s a performer (and, with `who: admin`, a moderator) may fire on a guest. */
  interactions: InteractionSummary[];
  /** True when the story uses the v3 prison mechanic (a `prison: true` location),
   *  so the booth still offers capture / release. */
  legacyCapture: boolean;
}

export function primeView(sim: Sim | null, character: string): PrimeView {
  if (sim === null) {
    return { character, title: "Loom", theme: "plain", faction: null, guests: [], channels: [], spaces: [], interactions: [], legacyCapture: false };
  }
  const c = sim.model.characters.get(character);
  const guests: PrimeGuest[] = [...sim.persons.values()].map((p) => ({
    id: p.id,
    name: p.name,
    faction: sim.publicFactionOf(p.id),
    captured: sim.isCaptured(p.id),
  }));
  return {
    character,
    title: sim.lobbyTitle(),
    theme: sim.model.theme ?? "plain",
    faction: c?.faction ?? null,
    guests,
    channels: sim.allChannelsFor(character),
    spaces: sim.spaceList(),
    interactions: interactionsFor(sim, ["performer", "admin"]),
    legacyCapture: [...sim.model.locations.values()].some((l) => l.prison),
  };
}
