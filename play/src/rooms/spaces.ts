//! Room ids, names and the Discord-style sidebar sections (moved out of
//! `threads.ts` in wave 13): deriving a channel's header from its id, the
//! pinned rooms' ids, and folding a sorted channel list into spaces.

import type { Channel, ChannelKind } from "../types.ts";

/** `MODERATOR_PRIME` / `recruiter` → a friendly contact name. A name the
 *  story already wrote in mixed case (`WebMD`, `MS Paint`, `MS_Paint`,
 *  `Norton Anti-Virus`) keeps its casing (each word's first letter is
 *  raised: `cast_Member` → "Cast Member"); only all-caps and all-lower raw
 *  ids are recased. */
export function prettyName(raw: string): string {
  const words = raw.split(/[_\s]+/).filter(Boolean);
  const mixed = /\p{Ll}/u.test(raw) && /\p{Lu}/u.test(raw);
  if (mixed) return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/** "the Mods", but "The Way Out" as named: a group whose name already
 *  starts with an article keeps it, so a button never reads "the The …"
 *  (the server's notices use the same rule, `withThe` in core's chat.ts). */
export function withThe(name: string): string {
  return /^(the|a|an)\s/iu.test(name) ? name : `the ${name}`;
}

/** Title + kind for a channel id, used for threads with no messages yet. */
export function channelHead(id: string): { kind: ChannelKind; title: string } {
  if (id === "lobby") return { kind: "lobby", title: "Lobby" };
  if (id === CODEX_ROOM) return { kind: "codex", title: "Codex" };
  if (id === QUEST_LOG) return { kind: "quests", title: "Quest Log" };
  if (id === WALLET_ROOM) return { kind: "wallet", title: "Wallet" };
  if (id.startsWith("faction:")) return { kind: "faction", title: `#${id.slice(8).toLowerCase()}` };
  if (id.startsWith("dm:")) return { kind: "dm", title: prettyName(id.slice(3)) };
  if (id.startsWith("loc:")) return { kind: "location", title: prettyName(id.slice(4)) };
  // A private thread between two participants — the session names it after
  // the other party once it knows who that is.
  if (id.startsWith("pm:")) return { kind: "dm", title: "Private" };
  return { kind: "dm", title: id };
}

// --- spaces (the Discord-style sidebar sections) ----------------------------

/** Sidebar space metadata. `story` holds the story's own rooms (titled after
 *  the story — nothing is baked in); the booth groups the performer's tools +
 *  per-guest threads. Authored spaces (any other id) sort between them,
 *  titled from the channel's `spaceTitle`. */
export const STORY_SPACE = "story";
/** The pinned rooms: your Codex + your Quest Log, above everything else. */
export const PINNED_SPACE = "pinned";
export const CODEX_ROOM = "codex";
export const QUEST_LOG = "quests";
/** The pinned Wallet room — only when the story declares a `currency:`. */
export const WALLET_ROOM = "wallet";
export const SPACES: Record<string, { title: string; order: number }> = {
  [PINNED_SPACE]: { title: "Pinned", order: -2 },
  booth: { title: "Booth", order: -1 }, // the performer's tools, pinned on top
  [STORY_SPACE]: { title: "Story", order: 0 },
  cast: { title: "Cast", order: 0.5 }, // agent-voiced characters a performer can message
  guests: { title: "Guests", order: 1 }, // a performer's guests, right under the rooms
};
export function spaceTitle(id: string): string {
  return SPACES[id]?.title ?? id;
}
function spaceOrder(id: string): number {
  return SPACES[id]?.order ?? 5; // authored spaces: after the story, guests, and cast
}

export interface SpaceGroup {
  id: string;
  title: string;
  channels: Channel[];
}

/**
 * Fold an already-sorted channel list into ordered space sections, preserving
 * the within-list order (decisions-first / most-recent) inside each space.
 * An authored section's title rides on its channels' `spaceTitle`.
 */
export function groupBySpace(list: Channel[]): SpaceGroup[] {
  const byId = new Map<string, Channel[]>();
  for (const c of list) {
    const arr = byId.get(c.spaceId) ?? [];
    arr.push(c);
    byId.set(c.spaceId, arr);
  }
  return [...byId.entries()]
    .map(([id, channels]) => ({ id, title: channels[0]?.spaceTitle ?? spaceTitle(id), channels }))
    .sort((a, b) => spaceOrder(a.id) - spaceOrder(b.id));
}
