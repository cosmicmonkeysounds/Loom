//! Mission, the guest's home (wave 18, GUEST-SPEC §2): the pure model of
//! the screen — the NOW objective as a quest card (its place, its
//! countdown, its to-dos, its big buttons), Your move (what is waiting on
//! you), the three desktop tiles (Wallet, Quest Log, Codex) and Also now.
//! `guest/mission.tsx` renders it; `test/mission-model.test.ts` pins it.

import type { LiveCard } from "../moments/model.ts";
import { CODEX_ROOM, QUEST_LOG, WALLET_ROOM } from "../rooms/spaces.ts";
import { guestDot } from "../rooms/chats.ts";
import type { Channel, CountdownSummary, Decision, GuestView, NameBadge, ObjectiveView } from "../types.ts";
import { factionModeOf, factionTileOf } from "../sides/model.ts";
import { widgetLabel } from "../widgets.tsx";
import type { Nav } from "../moments/exits.ts";
/** Where a decision docks when it would have docked in the lobby (= `session/guest.ts` MISSION_DOCK). */
export const MISSION_DOCK_ID = "mission";
import { badgesOf, evergreenFlag, extOf, type InviteView } from "./wire.ts";

/** The place words an objective's `go:` may name (C2 / C11). */
export const PLACE_WORDS = ["pass", "scan", "sides", "wallet", "codex", "quests", "chats", "notifications", "me", "mission"] as const;
export type PlaceWord = (typeof PLACE_WORDS)[number];

/** The Where row's words for a place word (§2.1, §6.2). */
export const WORD_ROW: Record<PlaceWord, string> = {
  pass: "🎟 Show my pass",
  scan: "📷 Check in",
  sides: "🚪 Choose a side",
  wallet: "🪙 Open my Wallet",
  codex: "📓 Open the Codex",
  quests: "📜 Open the Quest Log",
  chats: "💬 Chats",
  notifications: "🔔 Notifications",
  me: "👤 Me",
  mission: "▣ What do I do?",
};

export type WhereRow =
  /** You stand in the place: `📍 {name}  ✓ YOU'RE HERE`, not a button. */
  | { kind: "here"; name: string }
  /** The place is elsewhere: the whole row is a button (`dm`: a character's thread, "Open …"). */
  | { kind: "go"; name: string; nav: Nav; dm?: true }
  /** A word target: the row is that exit's button. */
  | { kind: "word"; word: PlaceWord; label: string; nav: Nav };

export type MoveAction = { kind: "nav"; nav: Nav } | { kind: "invite"; invite: InviteView };

export interface MissionMove {
  key: string;
  text: string;
  action: MoveAction;
  /** Newest first. */
  order: number;
}

export interface MissionTile {
  /** `faction` (wave 18b): your faction's count, in faction mode. */
  id: "wallet" | "quests" | "codex" | "faction";
  label: string;
  status: string;
  /** A yellow dot, never a number. */
  dot: boolean;
  frozen?: boolean;
  nav: Nav;
}

export interface MissionCardButton {
  card: LiveCard;
  label: string;
  nav: Nav;
}

export interface MissionModel {
  objective: ObjectiveView | null;
  /** The title's glyph (its own pictograph, else 🧭 on free roam, else ▣). */
  glyph: string;
  title: string;
  freeRoam: boolean;
  where: WhereRow | null;
  countdown: CountdownSummary | null;
  /** The newest live card, promoted to the first big button. */
  cardButton: MissionCardButton | null;
  /** The objective's own buttons (≤ 3), minus the one the Where row shows. */
  buttons: string[];
  moves: MissionMove[];
  /** Rows past the fourth: "+ {n} more in Chats ›". */
  moreMoves: number;
  /** A decision docked on Mission (it would have docked in the lobby), or the captive's escape. */
  decision: Decision | null;
  tiles: MissionTile[];
  also: ObjectiveView[];
  /** Standing conditions about you (no to-dos, no buttons: *You are
   *  marked*): shown as a strip, never folded under Also now (NM-F1). */
  strips: ObjectiveView[];
  paused: boolean;
  /** Wave 18b: your own badges (`badge:` lines: 🚻 Bathroom Mode), for the header. */
  badges: NameBadge[];
}

/** A card label cut to a button's length (≤ 32 characters, an ellipsis past it). */
function clipLabel(s: string): string {
  const t = s.trim();
  return t.length <= 32 ? t : `${t.slice(0, 31).trimEnd()}…`;
}

/** A label split into its leading pictograph and its words. */
export function splitGlyph(text: string): { glyph: string | null; words: string } {
  const m = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*(.*)$/su.exec(text.trim());
  return m === null ? { glyph: null, words: text.trim() } : { glyph: m[1]!, words: m[2]! };
}

/**
 * The evergreen objective (G7, A7): the one a phone never counts as "+1".
 * The server's flag wins; else the last objective when there are two or
 * more and it has no to-dos (the show's *Explore the computer*).
 */
export function evergreenOf(objectives: readonly ObjectiveView[]): ObjectiveView | null {
  const flagged = objectives.find((o) => evergreenFlag(o) === true);
  if (flagged !== undefined) return flagged;
  if (objectives.length < 2) return null;
  const last = objectives[objectives.length - 1]!;
  return last.checklist.length === 0 ? last : null;
}

/** Is the guest on free roam — only the evergreen is live? */
export function freeRoamOf(objectives: readonly ObjectiveView[]): boolean {
  if (objectives.length !== 1) return false;
  const o = objectives[0]!;
  const flag = evergreenFlag(o);
  if (flag !== undefined) return flag;
  return o.checklist.length === 0;
}

/** A place id as a room id: a bare LOCATION name becomes `loc:<name>`. */
function roomIdOf(id: string): string {
  if (id.includes(":") || id === "lobby" || id === CODEX_ROOM || id === QUEST_LOG || id === WALLET_ROOM) return id;
  return `loc:${id}`;
}

function wordNav(word: PlaceWord): Nav {
  return { to: word } as Nav;
}

/**
 * The Where row (§2.1) from `GuestView.mission` (C11). The server's
 * `place.id` is a room / DM id (`loc:X`, `room:x`, `dm:C`, `pm:…`), a guest
 * INTERACTION id, `codex[:entry]`, `quests[:quest]`, or a screen word; its
 * `name` is the words to show.
 */
export function whereRowOf(
  view: Pick<GuestView, "location"> & { mission?: ReturnType<typeof extOf>["mission"]; interactions?: GuestView["interactions"]; captured?: boolean; sides?: GuestView["sides"]; canFound?: GuestView["canFound"] },
  listed: ReadonlySet<string>,
  titles: ReadonlyMap<string, string>,
): WhereRow | null {
  const place = view.mission?.place ?? null;
  if (place === null) return null;
  const entry = /^codex:(.+)$/u.exec(place.id);
  if (entry !== null) return { kind: "word", word: "codex", label: `📓 ${place.name.trim() !== "" && place.name !== place.id ? place.name : "Open the Codex"}`, nav: { to: "codex", entry: entry[1]! } };
  const quest = /^quests?:(.+)$/u.exec(place.id);
  if (quest !== null) return { kind: "word", word: "quests", label: `📜 ${place.name.trim() !== "" && place.name !== place.id ? place.name : "See the quest"}`, nav: { to: "quests", quest: quest[1]! } };
  const button = (view.interactions ?? []).find((i) => i.id === place.id);
  if (button !== undefined) return { kind: "word", word: "mission", label: button.label, nav: { to: "act", id: button.id } };
  const word = (PLACE_WORDS as readonly string[]).includes(place.id) ? (place.id as PlaceWord) : null;
  // On a side already: the row opens Sides, never asks them to choose (N4).
  // Wave 18b, faction mode (`canFound`, or a row's `kind`): the words say
  // "faction" — before anyone has founded one too.
  const factions = factionModeOf(view);
  if (word === "sides" && (view.sides ?? []).some((x) => x.mine)) return { kind: "word", word, label: factions ? "🚪 Factions" : "🚪 Sides", nav: wordNav(word) };
  if (word !== null) {
    const custom = place.name.trim() !== "" && place.name.trim().toLowerCase() !== word ? place.name.trim() : null;
    const glyph = splitGlyph(WORD_ROW[word]).glyph;
    const words = word === "sides" && factions ? "🚪 Choose a faction" : WORD_ROW[word];
    return { kind: "word", word, label: custom !== null ? (splitGlyph(custom).glyph !== null ? custom : `${glyph} ${custom}`) : words, nav: wordNav(word) };
  }
  const id = roomIdOf(place.id);
  const name = titles.get(id) ?? place.name;
  // A captured program stands "in" the Internet from the moment of the
  // capture, still in the living room: until they are released the tent is
  // somewhere to go, never "✓ YOU'RE HERE" (GN-F3).
  if (view.location !== null && id === `loc:${view.location}` && view.captured !== true) return { kind: "here", name };
  if (id === "lobby" || !listed.has(id)) return null;
  return { kind: "go", name, nav: { to: "room", id }, ...(id.startsWith("dm:") ? { dm: true as const } : {}) };
}

export interface MissionInput {
  view: GuestView;
  /** The session's sorted room list. */
  list: readonly Channel[];
  /** The live cards waiting on the guest (`liveCardsOf`). */
  cards: readonly LiveCard[];
  /** The session's decision (`requiredDecision`). */
  decision: { channel: string; decision: Decision } | null;
  /** The Codex holds an entry the guest hasn't seen (§11 rule 6). */
  codexUnseen?: boolean;
}

/** The Mission screen's model (pure). */
export function missionOf(o: MissionInput): MissionModel {
  const v = o.view;
  const ext = extOf(v);
  const objectives = v.objectives ?? [];
  const evergreen = evergreenOf(objectives);
  const objective = objectives[0] ?? null;
  const free = freeRoamOf(objectives);
  const split = splitGlyph(objective?.title ?? "");
  const listed = new Set(o.list.map((c) => c.id));
  const titles = new Map(o.list.map((c) => [c.id, c.title]));
  const where0 = objective !== null ? whereRowOf({ location: v.location, mission: ext.mission, interactions: v.interactions, captured: v.captured, ...(ext.sides !== undefined ? { sides: ext.sides } : {}), ...(typeof v.canFound === "boolean" ? { canFound: v.canFound } : {}) }, listed, titles) : null;
  // A screen word (📷 Check in, 🎟 Show my pass) is done once every to-do
  // is ticked: the row would ask again for what was just done (GN-F11).
  const allDone = objective !== null && objective.checklist.length > 0 && objective.checklist.every((c) => c.done === true);
  const where = where0 !== null && where0.kind === "word" && (where0.word === "scan" || where0.word === "pass") && allDone ? null : where0;
  const roomTitle = (id: string) => (titles.get(id) ?? id).replace(/\s*\([^)]*\)\s*$/u, "");

  // the live cards, newest first; the newest is the first big button
  const byRoom = new Map(o.list.map((c) => [c.id, c]));
  const cardLabel = (c: LiveCard) => {
    const m = byRoom.get(c.channel)?.messages.find((x) => x.seq === c.seq);
    // The kind's own short label, never the card's whole text (GN-F18: the
    // doors' button read the Y2K headline twice over).
    const label = m?.widget !== undefined ? clipLabel(splitGlyph(widgetLabel(m.widget)).words.split(" — ")[0]!) : "a card";
    return { label, room: roomTitle(c.channel) };
  };
  const cards = [...o.cards].sort((a, b) => b.seq - a.seq);
  const promoted = cards[0] ?? null;
  const cardButton: MissionCardButton | null =
    promoted === null ? null : (() => {
      const l = cardLabel(promoted);
      return { card: promoted, label: `${promoted.glyph} ${l.label.toUpperCase()} · in ${l.room}`, nav: { to: "room", id: promoted.channel, focusSeq: promoted.seq } };
    })();

  // Your move
  const moves: MissionMove[] = [];
  for (const c of cards.slice(1)) {
    const l = cardLabel(c);
    moves.push({ key: `card:${c.seq}`, text: `${c.glyph} ${l.label} · in ${l.room}`, action: { kind: "nav", nav: { to: "room", id: c.channel, focusSeq: c.seq } }, order: c.seq });
  }
  const dock = o.decision;
  if (dock !== null && dock.channel !== MISSION_DOCK_ID && dock.channel !== "lobby" && listed.has(dock.channel)) {
    moves.push({ key: `ask:${dock.channel}`, text: `▶ ${roomTitle(dock.channel)} is asking you something`, action: { kind: "nav", nav: { to: "room", id: dock.channel } }, order: Infinity });
  }
  for (const inv of ext.invites ?? []) {
    moves.push({ key: `invite:${inv.id}`, text: `🚪 ${inv.fromName} wants you in ${inv.targetName}`, action: { kind: "invite", invite: inv }, order: Infinity });
  }
  if (v.wallet !== undefined) {
    for (const r of v.wallet.requests) {
      if (r.to !== v.id || r.state !== "open") continue;
      moves.push({ key: `ask-coin:${r.id}`, text: `🪙 ${r.fromName} asks for ${r.amount} ${v.wallet.name}`, action: { kind: "nav", nav: { to: "wallet" } }, order: r.at });
    }
  }
  const already = new Set(moves.flatMap((m) => (m.action.kind === "nav" && m.action.nav.to === "room" ? [m.action.nav.id] : [])));
  if (promoted !== null) already.add(promoted.channel);
  // The Where row already goes there (N9: "Trabolta replied to you" under "Open Trabolta").
  if (where !== null && where.kind === "go" && where.nav.to === "room") already.add(where.nav.id);
  for (const c of o.list) {
    if (c.kind === "codex" || c.kind === "quests" || c.kind === "wallet" || c.spaceId === "pinned") continue;
    if (!guestDot(c) || already.has(c.id) || c.decision) continue;
    const last = c.messages[c.messages.length - 1]?.seq ?? 0;
    moves.push({ key: `dot:${c.id}`, text: `💬 New in ${roomTitle(c.id)}`, action: { kind: "nav", nav: { to: "room", id: c.id } }, order: last });
  }
  moves.sort((a, b) => b.order - a.order);

  // the tiles the story has
  const tiles: MissionTile[] = [];
  if (v.wallet !== undefined) {
    const waiting = v.wallet.requests.filter((r) => r.to === v.id && r.state === "open").length;
    tiles.push({
      id: "wallet",
      label: "Wallet",
      status: `${v.wallet.balance}${waiting > 0 ? ` · ${waiting} waiting` : ""}`,
      dot: false,
      ...(v.wallet.frozenUntil !== undefined ? { frozen: true } : {}),
      nav: { to: "wallet" },
    });
  }
  if ((v.questTotal ?? 0) > 0) {
    const active = (v.quests ?? []).filter((q) => q.status === "active").length;
    const log = byRoom.get(QUEST_LOG);
    tiles.push({ id: "quests", label: "Quest Log", status: `${active} active`, dot: (log?.unread ?? 0) > 0, nav: { to: "quests" } });
  }
  if ((v.codexTotal ?? 0) > 0) {
    tiles.push({ id: "codex", label: "Codex", status: `${v.codex?.length ?? 0} found`, dot: o.codexUnseen === true, nav: { to: "codex" } });
  }
  // Wave 18b, faction mode: your faction and how many more it needs (only
  // ever your own count — the server sends no rival's).
  const faction = factionTileOf(v);
  if (faction !== null) tiles.push({ id: "faction", label: `◆ ${faction.name}`, status: faction.status, dot: false, nav: wordNav("sides") });

  // the objective's own buttons, minus what the Where row already is
  const buttons = (objective?.buttons ?? []).filter((b) => !(where?.kind === "word" && where.word === b)).slice(0, 3);
  return {
    objective,
    glyph: split.glyph ?? (free ? "🧭" : "▣"),
    title: split.words,
    freeRoam: free,
    where,
    countdown: v.countdowns?.[0] ?? null,
    cardButton,
    buttons,
    moves: moves.slice(0, 4),
    moreMoves: Math.max(0, moves.length - 4),
    decision: dock !== null && dock.channel === MISSION_DOCK_ID ? dock.decision : null,
    tiles,
    also: objectives.slice(1).filter((x) => x !== evergreen && !isStrip(x)),
    strips: objectives.slice(1).filter((x) => x !== evergreen && isStrip(x)),
    paused: v.paused === true,
    badges: badgesOf(v),
  };
}

/** A standing condition about you: no to-dos and no buttons. */
function isStrip(o: ObjectiveView): boolean {
  return o.checklist.length === 0 && (o.buttons ?? []).length === 0 && evergreenFlag(o) !== true;
}

/** `⏳ 18:42 left`, `⏳ 1h 05m left`, `⏸ stopped`. */
export function countdownText(left: number, paused: boolean): string {
  if (paused) return "⏸ stopped";
  const s = Math.max(0, Math.ceil(left));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `⏳ ${h}h ${String(m).padStart(2, "0")}m left`;
  }
  return `⏳ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} left`;
}
