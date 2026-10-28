//! A player's booth (wave 21, CONTRACT P1–P6): the pure decisions. A
//! `player: true` part plays the night like a guest — Mission is home (the
//! NOW objective as a quest card, its score tiles, the Quest Log / Codex /
//! Wallet / 🚨 Wanted tiles, Also now), Chats is the rest (Your move,
//! Messages, Team, Rooms, the Chat log last), and every action is a pick,
//! a target, a global press or a scan — never a list of bare buttons.
//! `booth/player.tsx` draws it with the guest's own Mission window;
//! `test/w21-player-booth.test.tsx` pins it.

import type { Nav } from "../moments/exits.ts";
import { evergreenOf, splitGlyph, type MissionModel, type MissionMove, type MissionTile, type WhereRow } from "../guest/mission-model.ts";
import { evergreenFlag } from "../guest/wire.ts";
import { CHAT_SECTION_TITLES, type ChatSectionId, type Chats } from "../rooms/chats.ts";
import { CODEX_ROOM, QUEST_LOG, WALLET_ROOM } from "../rooms/spaces.ts";
import type { Channel, Interaction, ObjectiveView, PrimeView } from "../types.ts";
import { FEED_ID, guestAwaitsReply, heldCount, viewPaused } from "./model.ts";
import { MISSION_RETIRE_MS, missionHeadline, pickLayout, withoutGlyph, type Draft } from "./popouts/model.ts";
import { globalButtonsOf, statsOf, type BoothObjective } from "./wire.ts";

/** The booth's Readouts room id (= `session/prime.ts` INBOX; kept here so this module stays light). */
export const NOTES_ID = "__inbox";

/** What Readouts is called on a player's booth (P6): the story's notes to the character. */
export const NOTES_TITLE = "📋 Notes";

/** The Wanted tile's nav: a sentinel room the booth's `onGo` opens as the board. */
export const WANTED_ROOM = "__wanted";
export const WANTED_NAV: Nav = { to: "room", id: WANTED_ROOM };

export interface BoothMissionCtx {
  /** The session's room list (`buildPrimeChannels`). */
  list: readonly Channel[];
  /** May this booth claim an escort (an Antivirus)? Then the 🚨 tile shows. */
  claimer: boolean;
  /** Marked programs still loose (`looseWanted`), or null when the booth gets no board. */
  loose: number | null;
}

/** A standing condition (no to-dos, no buttons): a strip, never folded. */
function isStrip(o: ObjectiveView): boolean {
  return o.checklist.length === 0 && (o.buttons ?? []).length === 0 && evergreenFlag(o) !== true;
}

/** The Where row off `PrimeView.mission.place` (a LOCATION title): a room the booth lists opens it; else plain words. */
export function boothWhereOf(view: Pick<PrimeView, "mission">, objective: ObjectiveView | null, list: readonly Channel[]): WhereRow | null {
  const m = view.mission;
  if (objective === null || m === undefined || m === null || m.place === null || m.place.trim() === "") return null;
  if (m.objective !== objective.id && m.objective !== objective.title) return null;
  const place = m.place.trim();
  const room = list.find((c) => c.kind === "location" && (c.title === place || c.id === `loc:${place}`)) ?? null;
  return room !== null ? { kind: "go", name: room.title, nav: { to: "room", id: room.id } } : { kind: "place", name: place };
}

/** Your move on a player's Mission: a card waiting in Notes or a cast thread, a guest's line waiting on a reply. */
export function boothMovesOf(list: readonly Channel[], character: string): MissionMove[] {
  const out: MissionMove[] = [];
  for (const c of list) {
    const last = c.messages[c.messages.length - 1]?.seq ?? 0;
    if (c.id === NOTES_ID && c.needsYou === true) out.push({ key: `card:${c.id}`, text: `🃏 A card is waiting · in ${NOTES_TITLE}`, action: { kind: "nav", nav: { to: "room", id: c.id } }, order: last });
    else if (c.id.startsWith("cast:") && c.needsYou === true) out.push({ key: `card:${c.id}`, text: `🃏 ${c.title} is asking you something`, action: { kind: "nav", nav: { to: "room", id: c.id } }, order: last });
    else if (c.kind === "guest" && guestAwaitsReply(c, character)) out.push({ key: `msg:${c.id}`, text: `💬 ${c.title} wrote to you`, action: { kind: "nav", nav: { to: "room", id: c.id } }, order: last });
  }
  return out.sort((a, b) => b.order - a.order);
}

/** A player's Mission (P2), as the guest's Mission window reads it. */
export function boothMissionOf(view: PrimeView, ctx: BoothMissionCtx): MissionModel {
  const objectives = view.objectives ?? [];
  const objective = objectives[0] ?? null;
  const evergreen = evergreenOf(objectives);
  const split = splitGlyph(objective?.title ?? "");
  const tiles: MissionTile[] = [];
  if (ctx.claimer && ctx.loose !== null) {
    tiles.push({ id: "wanted", label: "Wanted", status: ctx.loose === 0 ? "none loose" : `${ctx.loose} loose`, dot: ctx.loose > 0, glyph: "🚨", nav: WANTED_NAV });
  }
  if (view.wallet !== undefined) {
    const held = heldCount(view.wallet);
    tiles.push({ id: "wallet", label: "Wallet", status: held > 0 ? `${held} to approve` : `${view.wallet.queue.length} waiting`, dot: held > 0, nav: { to: "wallet" } });
  }
  if ((view.questTotal ?? 0) > 0) {
    const active = (view.quests ?? []).filter((q) => q.status === "active").length;
    const log = ctx.list.find((c) => c.id === QUEST_LOG);
    tiles.push({ id: "quests", label: "Quest Log", status: `${active} active`, dot: (log?.unread ?? 0) > 0, nav: { to: "quests" } });
  }
  if ((view.codexTotal ?? 0) > 0) {
    const room = ctx.list.find((c) => c.id === CODEX_ROOM);
    tiles.push({ id: "codex", label: "Codex", status: `${view.codex?.length ?? 0} known`, dot: (room?.unread ?? 0) > 0, nav: { to: "codex" } });
  }
  const moves = boothMovesOf(ctx.list, view.character);
  return {
    objective,
    glyph: split.glyph ?? "▣",
    title: split.words,
    freeRoam: false,
    where: boothWhereOf(view, objective, ctx.list),
    countdown: view.countdowns?.[0] ?? null,
    cardButton: null,
    buttons: (objective?.buttons ?? []).filter((b) => b !== "pass").slice(0, 3),
    moves: moves.slice(0, 4),
    moreMoves: Math.max(0, moves.length - 4),
    decision: null,
    tiles,
    also: objectives.slice(1).filter((x) => x !== evergreen && !isStrip(x)),
    strips: objectives.slice(1).filter((x) => x !== evergreen && isStrip(x)),
    paused: viewPaused(view),
    badges: [],
    scores: statsOf(view),
  };
}

/** What one of a player's big buttons does (P2), first match wins. */
export type BoothAction =
  /** `scan`: the scanner. */
  | { kind: "scan" }
  /** The objective has a picker: PLAYER SELECT / the rows window. */
  | { kind: "pick"; objective: string }
  /** The objective names its guest: their card. */
  | { kind: "target"; guest: string }
  /** A global button (`globalButtons`): pressed with no guest. */
  | { kind: "global"; id: string }
  /** A guest's button with no pick or target: the scanner, captioned. */
  | { kind: "scanFor"; id: string; caption: string };

/** "📷 Scan a program to send them to the Internet". */
export function scanCaption(label: string): string {
  const words = withoutGlyph(label);
  const lower = words.length > 0 ? words[0]!.toLowerCase() + words.slice(1) : words;
  return `📷 Scan a program to ${lower}`;
}

/** The objective a big button belongs to: the first live one naming it. */
export function objectiveOfButton(objectives: readonly ObjectiveView[], id: string): BoothObjective | null {
  return (objectives.find((o) => o.buttons.includes(id)) as BoothObjective | undefined) ?? null;
}

/** What a big button with objective button id `id` does on a player's booth; null = no button (`pass`, or one this booth can't press). */
export function boothActionOf(id: string, view: Pick<PrimeView, "objectives" | "interactions" | "globalButtons">): BoothAction | null {
  if (id === "pass") return null;
  if (id === "scan") return { kind: "scan" };
  const interactions: readonly Interaction[] = view.interactions ?? [];
  const i = interactions.find((x) => x.id === id);
  if (i === undefined) return null;
  const o = objectiveOfButton(view.objectives ?? [], id);
  const layout = o !== null ? pickLayout(o, interactions) : null;
  if (o !== null && (layout === "steps" || layout === "rows")) return { kind: "pick", objective: o.id };
  if (o !== null && layout === "target" && o.target !== undefined) return { kind: "target", guest: o.target.id };
  if (globalButtonsOf(view as PrimeView).includes(id)) return { kind: "global", id };
  return { kind: "scanFor", id, caption: scanCaption(i.label) };
}

// --- the new-mission pop-out (P5) --------------------------------------------

/**
 * The NEW MISSION pop-out (P5): when the first live objective changes to one
 * this sign-in has not seen. `seen` = the ids already seen (null: the first
 * look, which only remembers — signing in never pops what is already on
 * Mission). Returns the draft (or null) and the ids seen now. Wave 37 (C7):
 * the headline rule is `missionHeadline` (reconcile retires one that is not
 * the headline any more), and a NEW MISSION that pops leaves after 20 s
 * (the driver blinks the title bar instead while Mission is on screen).
 */
export function newMissionSpec(objectives: readonly ObjectiveView[], seen: readonly string[] | null, at: number): { draft: Draft | null; seen: string[] } {
  const o = missionHeadline(objectives);
  const was = seen ?? [];
  if (o === null || was.includes(o.id)) return { draft: null, seen: [...was] };
  const next = [...was, o.id];
  if (seen === null) return { draft: null, seen: next };
  const split = splitGlyph(o.title);
  return {
    seen: next,
    draft: {
      key: `mission:${o.id}`,
      glyph: split.glyph ?? "▣",
      title: `NEW MISSION · ${split.words}`,
      body: o.brief.trim() !== "" ? [o.brief.trim()] : ["Your game is on. Open Mission to see what to do."],
      actions: [{ id: "go", label: "▣ Go", kind: "primary", do: { kind: "mission" } }],
      tone: "info",
      sticky: false,
      sound: true,
      priority: 35,
      autoRetireMs: MISSION_RETIRE_MS,
      at,
    },
  };
}

// --- the Start menu (P4) and the taskbar (P1) ----------------------------------

/** The player's Start menu items, in order (ids): Help, Keep my screen on, Get alerts, People, Sign out. */
export function playerStartIds(o: { wake: boolean; embedded: boolean }): string[] {
  return ["help", ...(!o.embedded && o.wake ? ["wake"] : []), ...(!o.embedded ? ["alerts"] : []), "people", "signout"];
}

// --- Chats (P6) ----------------------------------------------------------------

/** Did the guest of thread `c` ever type to this character? Then it is a conversation (Messages). */
function typedTo(c: Channel, character: string): boolean {
  const name = c.people?.[0]?.name ?? c.title;
  return c.messages.some((m) => m.channel === `dm:${character}` && m.from === name && !m.hidden);
}

/** How long a quiet room still counts as live (story ms). */
const QUIET_MS = 15 * 60_000;

/**
 * A player's Chats (P6): Your move (a card waiting, a guest's line waiting
 * on a reply), Messages (📋 Notes, the Cast, guests who wrote to you), Team
 * (the staff rooms the view lists), Rooms (where people are, what moved
 * lately), and Other rooms (n) with the 📜 Chat log last. The scanner, the
 * pinned Quest Log / Codex / Wallet (Mission's tiles) and the guests who
 * never wrote stay out.
 */
export function playerChats(list: readonly Channel[], o: { character: string; now: number; activeId?: string | null }): Chats {
  const out: Record<ChatSectionId, Channel[]> = { move: [], here: [], messages: [], team: [], rooms: [] };
  const other: Channel[] = [];
  let feed: Channel | null = null;
  const lastTs = (c: Channel) => c.messages[c.messages.length - 1]?.ts ?? -Infinity;
  for (const c of list) {
    if (c.id === "__scanner" || c.id === QUEST_LOG || c.id === CODEX_ROOM || c.id === WALLET_ROOM || c.kind === "codex" || c.kind === "quests" || c.kind === "wallet") continue;
    if (c.id === FEED_ID) {
      feed = c;
      continue;
    }
    const notes = c.id === NOTES_ID ? { ...c, title: NOTES_TITLE } : c;
    if (c.needsYou === true || (c.decision !== null && c.decision !== undefined) || (c.kind === "guest" && guestAwaitsReply(c, o.character))) out.move.push(notes);
    else if (c.id === NOTES_ID || c.id.startsWith("cast:")) out.messages.push(notes);
    else if (c.kind === "guest") {
      if (typedTo(c, o.character) || c.id === o.activeId) out.messages.push(c);
    } else if (c.staff === true) out.team.push(c);
    else if (c.kind === "location") ((c.people?.length ?? 0) > 0 || c.unread > 0 ? out.rooms : other).push(c);
    else if (c.unread > 0 || c.kind === "faction" || (c.member !== false && o.now - lastTs(c) <= QUIET_MS)) out.rooms.push(c);
    else other.push(c);
  }
  if (feed !== null) other.push({ ...feed, title: "📜 Chat log", subtitle: "Everything the house said tonight", people: [], unread: 0, decision: null, needsYou: false });
  const titles: Record<ChatSectionId, string> = { ...CHAT_SECTION_TITLES, team: "TEAM" };
  const sections = (Object.keys(out) as ChatSectionId[]).filter((id) => out[id].length > 0).map((id) => ({ id, title: titles[id], channels: out[id] }));
  return { sections, other };
}
