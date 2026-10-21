//! Building the guest's rooms (moved out of `session.ts` in wave 13): which
//! rooms are listed, the pinned rooms, the cutscene's personal stream, a
//! card still waiting, the agent DM rows.

import { pmOtherParty } from "../codex.ts";
import { locationOfRoom, occupantsByLocation, type Presence } from "../presence.ts";
import { CODEX_ROOM, PINNED_SPACE, QUEST_LOG, STORY_SPACE, WALLET_ROOM, channelHead, prettyName } from "../rooms/spaces.ts";
import { CHAT_LOG_SUB, CHAT_LOG_TITLE } from "../rooms/chats.ts";
import { groupByChannel, questSummary } from "../stream/runs.ts";
import type { Channel, ChatMessage, Decision, GuestView } from "../types.ts";
import { walletNeedsYou, walletSummary } from "../wallet.tsx";
import { cardAsks, supersededCards } from "../widgets.tsx";

/** A room whose *listing* the server snapshot decides: a location's room or
 *  an authored channel (derived DM / private / lobby threads are always shown). */
export function isListedRoom(id: string): boolean {
  return id.startsWith("loc:") || id.startsWith("room:");
}

/** The guest's own pinned rooms — the Codex and the Quest Log. */
export function isPinnedRoom(id: string): boolean {
  return id === CODEX_ROOM || id === QUEST_LOG || id === WALLET_ROOM;
}

/** Everything said *to* this guest, in order — the on-rails stream a
 *  cutscene shows: lines addressed to them, their cards, their replies.
 *  Room-wide story (`audience: "all"`) is not theirs and stays out. */
export function personalStream(messages: ReadonlyMap<number, ChatMessage>, meId: string): ChatMessage[] {
  return [...messages.values()]
    .filter((m) => Array.isArray(m.audience) && m.audience.includes(meId) && m.parentSeq == null && !isPinnedRoom(m.channel))
    .sort((a, b) => a.seq - b.seq);
}

/** The newest card of `kind` shown to this guest that nobody has answered. */
export function pendingWidget(messages: ReadonlyMap<number, ChatMessage>, kind: string, answered: ReadonlySet<number>): ChatMessage | null {
  let best: ChatMessage | null = null;
  for (const m of messages.values()) {
    if (m.kind !== "widget" || m.widget?.kind !== kind || answered.has(m.seq)) continue;
    if (best === null || m.seq > best.seq) best = m;
  }
  return best;
}

/** Is a card still waiting on this participant — an answerable widget with
 *  no answer in this session? A re-dealt card (a 📝 fact card) only counts
 *  while it is the newest. Shared by the guest's rooms and the booth's. */
export function hasPendingCard(msgs: readonly ChatMessage[], answered: ReadonlySet<number>): boolean {
  const old = supersededCards(msgs);
  return msgs.some((m) => m.kind === "widget" && m.widget !== undefined && cardAsks(m.widget) && !answered.has(m.seq) && !old.has(m.seq));
}

/** Group the guest's messages into threads, docking the pending decision, and
 *  merge in authored channels (SPACE/CHANNEL) the guest can see — including
 *  empty rooms — from the server snapshot. */
export function buildGuestChannels(
  messages: Map<number, ChatMessage>,
  dock: { channel: string; decision: Decision } | null,
  view: GuestView | null,
  opened: ReadonlySet<string> = new Set(),
  answered: ReadonlySet<number> = new Set(),
): Channel[] {
  const groups = groupByChannel(messages);
  // Who stands where — the sidebar's "3 here" and the room header's strip.
  const occupants = occupantsByLocation(
    view?.people ?? [],
    view ? { id: view.id, name: view.name, group: view.faction, location: view.location } : null,
  );
  const everyone: Presence[] = view
    ? [
        { id: view.id, name: view.name, kind: "guest", group: view.faction },
        ...(view.people ?? []).filter((p) => p.kind === "guest").map((p) => ({ id: p.id, name: p.name, kind: "guest" as const, group: p.faction })),
      ]
    : [];
  const presenceOf = (id: string): { here?: boolean; people?: Presence[] } => {
    const loc = locationOfRoom(id);
    if (loc !== null) return { here: view?.location === loc, people: occupants.get(loc) ?? [] };
    if (id.startsWith("dm:")) return { people: [{ id: id.slice(3), name: id.slice(3), kind: "character", group: null }] };
    if (id === "lobby") return { people: everyone };
    return {};
  };
  // A card still waiting on this guest pulls its room to the top, like a
  // decision does.
  const needsYou = (msgs: ChatMessage[]): boolean => hasPendingCard(msgs, answered);
  if (!groups.has("lobby")) groups.set("lobby", []); // the lobby is always present
  // The pinned rooms are there from the start whenever the story has a
  // codex / declares quests — the Codex is where codes get typed.
  if ((view?.codexTotal ?? 0) > 0 && !groups.has(CODEX_ROOM)) groups.set(CODEX_ROOM, []);
  if ((view?.questTotal ?? 0) > 0 && !groups.has(QUEST_LOG)) groups.set(QUEST_LOG, []);
  // The Wallet is there whenever the story declares a currency.
  if (view?.wallet !== undefined && !groups.has(WALLET_ROOM)) groups.set(WALLET_ROOM, []);
  // A decision docked on Mission (wave 18: never the lobby) makes no room.
  if (dock && dock.channel !== "mission" && !groups.has(dock.channel)) groups.set(dock.channel, []);
  // Threads the guest opened from the People list (a private message to a
  // guest, a DM to a character) exist before anyone has said anything.
  for (const id of opened) if (!groups.has(id)) groups.set(id, []);
  const spaceTitles = new Map((view?.spaces ?? []).map((s) => [s.id, s.title]));
  const snap = new Map((view?.channels ?? []).map((c) => [c.id, c]));
  for (const id of snap.keys()) if (!groups.has(id)) groups.set(id, []); // empty authored rooms
  // The snapshot is the authority on which rooms + places are *listed*: a
  // `hidden: true` room the story hasn't opened for this guest stays off
  // the sidebar even though its public lines were delivered — they are
  // kept, and appear with their history the moment the room is revealed.
  if (view !== null) {
    for (const id of [...groups.keys()]) if (isListedRoom(id) && !snap.has(id)) groups.delete(id);
  }
  // An agent-voiced character in the directory is always reachable: their
  // DM is on the sidebar before either side has said a word (a performer's
  // thread only appears once the character speaks to you).
  for (const p of view?.people ?? []) {
    if (p.kind === "character" && p.agent !== undefined && !groups.has(`dm:${p.id}`)) groups.set(`dm:${p.id}`, []);
  }
  // The story's own section is named after the story, whichever channel
  // (derived or authored) happens to lead it.
  const storyTitle = view?.title ?? spaceTitles.get(STORY_SPACE);
  const titleOfSpace = (spaceId: string) => (spaceId === STORY_SPACE ? storyTitle : spaceTitles.get(spaceId));
  return [...groups.entries()].map(([id, msgs]) => {
    const lastTs = msgs.length ? msgs[msgs.length - 1]!.ts : 0;
    const decision = dock && dock.channel === id ? dock.decision : null;
    const s = snap.get(id);
    if (s !== undefined) {
      // An authored channel — title/kind/space are server-authoritative.
      return {
        id,
        kind: s.kind as Channel["kind"],
        title: s.title,
        spaceId: s.spaceId,
        spaceTitle: titleOfSpace(s.spaceId),
        needsYou: needsYou(msgs),
        member: s.member,
        canPost: s.canPost,
        threadable: s.threadable,
        ...presenceOf(id),
        messages: msgs,
        unread: 0,
        decision,
        lastTs,
      };
    }
    if (id === WALLET_ROOM) {
      // The Wallet: a read-only log of coin cards, each with its own thread;
      // its footer (the guest app) holds Send / Request / Trade. A card
      // waiting on this guest (a request, an offer, a held approval) pulls
      // it up like a decision does.
      return {
        id,
        kind: "wallet" as const,
        title: "Wallet",
        subtitle: view?.wallet ? walletSummary(view.wallet, view.id) : "",
        spaceId: PINNED_SPACE,
        order: -1,
        canPost: false,
        threadable: true,
        tour: "wallet",
        needsYou: view?.wallet && view.id ? walletNeedsYou(view.wallet, view.id) : false,
        messages: msgs,
        unread: 0,
        decision,
        lastTs,
      };
    }
    if (isPinnedRoom(id)) {
      // The Codex takes codes (its composer redeems); the Quest Log is a
      // read-only log whose cards each open their own thread.
      const codex = id === CODEX_ROOM;
      return {
        id,
        kind: codex ? ("codex" as const) : ("quests" as const),
        title: codex ? "Codex" : "Quest Log",
        subtitle: codex ? `${view?.codex?.length ?? 0} of ${view?.codexTotal ?? 0} found` : questSummary(view?.quests ?? []),
        spaceId: PINNED_SPACE,
        order: codex ? 1 : 0,
        canPost: codex,
        threadable: !codex,
        tour: codex ? "codex" : "quests",
        messages: msgs,
        unread: 0,
        decision,
        lastTs,
      };
    }
    // A derived channel — read title/kind from the id (`dm:Recruiter` → "Recruiter").
    // The lobby is named after the story; derived rooms live in the story's space.
    // A private thread is named after the other party.
    const head = channelHead(id);
    const other = view ? pmOtherParty(id, view.id) : null;
    const otherName =
      other !== null
        ? (view?.people?.find((p) => p.id === other)?.name ?? view?.roster.find((p) => p.id === other)?.name ?? prettyName(other))
        : null;
    // A character's DM is titled with their declared name (`WebMD`), not a
    // re-cased channel key.
    const castName = id.startsWith("dm:") ? (view?.people?.find((p) => p.kind === "character" && p.id === id.slice(3))?.name ?? null) : null;
    // A DM with a character nobody reads (no performer, no agent) takes no
    // composer (wave 13: `voiced`; an older server sends none → keep it).
    const nobodyReads = id.startsWith("dm:") && !isVoiced(view, id.slice(3));
    // The lobby is the guest's far-away 📜 Chat log (wave 18, G2): never
    // named after the story, never a default room, never an exit.
    const lobby = head.kind === "lobby";
    return {
      id,
      kind: head.kind,
      title: lobby ? CHAT_LOG_TITLE : (otherName ?? castName ?? head.title),
      subtitle: lobby ? CHAT_LOG_SUB : otherName !== null ? "private" : undefined,
      spaceId: STORY_SPACE,
      spaceTitle: storyTitle,
      needsYou: needsYou(msgs),
      ...(nobodyReads ? { canPost: false } : {}),
      order: head.kind === "lobby" ? 0 : head.kind === "faction" ? 1 : 2,
      ...(otherName !== null && other !== null ? { people: [{ id: other, name: otherName, kind: "guest" as const, group: null }] } : presenceOf(id)),
      messages: msgs,
      unread: 0,
      decision,
      lastTs,
    };
  });
}

/** Does somebody read this character's DM (a performer part, an agent)?
 *  Unknown (an older server, no view yet) → yes. Folded, like the server's names. */
export function isVoiced(view: Pick<GuestView, "voiced"> | null, character: string): boolean {
  const voiced = view?.voiced;
  if (voiced === undefined) return true;
  const f = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
  return voiced.some((v) => f(v) === f(character));
}

/**
 * Guest-side agent chrome: a DM with an agent-voiced character says whether
 * anyone is answering, and shows "… is typing" while a reply is composed.
 * A character with a `hold:` line always answers (the story covers for a
 * missing worker), so its row never says "away": it previews the last
 * message like any other thread.
 */
export function withAgents(channels: Channel[], view: GuestView | null, typing: ReadonlyMap<string, string>): Channel[] {
  const agents = new Map((view?.people ?? []).filter((p) => p.agent !== undefined).map((p) => [`dm:${p.id}`, p.agent!]));
  return channels.map((c) => {
    const agent = agents.get(c.id);
    const who = typing.get(c.id);
    if (agent === undefined && who === undefined) return c;
    const presence = agent !== undefined && agent.hold !== true && c.subtitle === undefined;
    return {
      ...c,
      ...(agent !== undefined ? { agent: true as const } : {}),
      ...(presence ? { subtitle: agent.online ? "online" : "away — they'll answer when they're back" } : {}),
      ...(who !== undefined ? { typing: who } : {}),
    };
  });
}
