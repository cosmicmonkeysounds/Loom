//! Server-authoritative chat model — the single source of truth for what
//! every participant sees, structured as **channels** (conversation
//! threads) the way Discord / Telegram do it.
//!
//! The participant app used to compose its story client-side from a
//! granular SSE feed (`line` / `notify` / `ambient` / `reveal`). That made
//! history impossible (a re-login started blank) and put narrative copy in
//! two places. Here we instead derive every visible message from the sim's
//! `SimEvent` stream **once, on the server**, route it to a channel, and
//! keep it in an append-only `ChatStore`. Because the `Sim` is fully
//! deterministic (see store.ts), replaying the journal re-derives the exact
//! same messages with the exact same `seq`, so chat history survives a
//! restart for free — only moderation (`hidden`) flags need persisting.
//!
//! Channels:
//!   - **lobby**   `"lobby"`          — "The Internet": ambient story, global
//!                                       broadcasts, and your personal beats.
//!   - **faction** `"faction:<Id>"`   — a faction broadcast, members only.
//!   - **dm**      `"dm:<Character>"`  — a character speaking to you.
//!   - **codex**   `"codex"`           — your Codex: every entry you hold, as a
//!                                       card, and the box you type codes into.
//!   - **quests**  `"quests"`          — your Quest Log: one card per quest, its
//!                                       steps threaded under it.
//!
//! The codex and the quest log are *pinned* rooms: one id for everyone,
//! each person's messages addressed to them alone.

import type { Sim, SimEvent, WalletCard } from "../src/runtime/sim/index.ts";
import { walletLine } from "./wallet.ts";
import { isEffectManner, noticeKey, splitNotice, type GoTarget, type MomentClass } from "../src/delivery.ts";
import { resolveGoWords } from "../src/go.ts";
import { foldName } from "../src/parser/names.ts";
import { display } from "../src/runtime/expr.ts";

// `lobby` / `faction` / `dm` / `location` are derived; `group` / `open` /
// `private` come from authored SPACE/CHANNEL declarations. `location` is the
// derived room of a `LOCATION` (`loc:<Id>`) — the stage itself is a channel.
export type ChannelKind = "lobby" | "faction" | "dm" | "group" | "open" | "private" | "location" | "codex" | "quests" | "wallet";

/** Who receives a message: `"all"` guests, or a fixed set of guest ids. */
export type Audience = "all" | string[];

export type MessageKind = "line" | "narration" | "signal" | "system" | "widget" | "codex" | "quest" | "wallet";

/** The entry a `codex` message carries (its `text` is the entry's text). */
export interface CodexCard {
  entry: string;
  title: string;
  about: string | null;
  via: "code" | "story" | "share";
  /** Who shared it (display name), for `via: "share"`. */
  from: string | null;
  /** `CodexDef.category`; absent when null. */
  category?: string;
  /** What `about` names (same rule as `CodexEntryView.aboutKind`); absent when `about` is null. */
  aboutKind?: "character" | "location" | "topic";
}

/** What a codex entry's `about:` names: a declared character, a declared
 *  location, or anything else (a topic). Null when there is no subject. */
export function codexAboutKind(model: Sim["model"], about: string | null): "character" | "location" | "topic" | null {
  if (about === null) return null;
  if (model.characters.has(about)) return "character";
  if (model.locations.has(about)) return "location";
  return "topic";
}

/** The quest a `quest` message is a step of. A quest's first message
 *  (`start`) is the root of its thread; every later step is a reply. */
export interface QuestCard {
  quest: string;
  title: string;
  action: "start" | "update" | "complete" | "fail";
}

/** An inline widget (`show …`): what to render, keyed by `kind`, plus the
 *  authored text + params the statement carried. The client owns the
 *  registry of kinds; an unknown kind renders as its text. */
export interface WidgetCard {
  kind: string;
  text: string;
  params: Record<string, string>;
}

/** One delivered message, the unit a participant's thread is built from. */
export interface ChatMessage {
  /** Monotonic, dense, and stable across a deterministic replay. */
  seq: number;
  /** Channel id (`"lobby"` | `"faction:Mods"` | `"dm:Moderator_Prime"`). */
  channel: string;
  channelKind: ChannelKind;
  /** Display title for the channel this message lands in. */
  title: string;
  /** Speaker/character for `line`, else `""` (ambient / system). */
  from: string;
  kind: MessageKind;
  text: string;
  /** Story-clock time (ms) — deterministic, unlike wall clock. */
  ts: number;
  audience: Audience;
  /**
   * Slack-style threading: the `seq` of the root message this is a reply to,
   * or `null` when this message is itself a root. Single-level — a reply
   * always points at the root, never at another reply. `seq` is stable across
   * deterministic replay, so a `parentSeq` link survives a restart unchanged.
   */
  parentSeq: number | null;
  /** Hidden by a moderator. Withheld from guests, greyed for admins. */
  hidden: boolean;
  /** The director who posted this *as* a participant (a mod `say` whose
   *  `as` names a person). Stripped for guest clients — never shown to them. */
  via?: string;
  /** The beat a scripted line was spoken in, when known — lets a client link
   *  a message back to its node on the story map. Absent for typed chat. */
  beat?: string | null;
  /** An **alert**: a broadcast whose cue text began with `!` — the client
   *  chimes, vibrates, and banners it ("!Come to the Desktop."). */
  alert?: boolean;
  /** A sticky notice (`pin "…"`): the key it was pinned under (a person's
   *  id, or "" for a room-wide pin). The client keeps the newest pin per
   *  (channel, key) above the stream until an `unpin` with the same key. */
  pin?: string;
  /** Takes down the pin with this key in this channel (`unpin …`). */
  unpin?: string;
  /** A **takeover** pin (`pin "!!…"`, always an alert too): the client covers
   *  the whole screen with it until the story unpins it. */
  takeover?: boolean;
  /** The card a `widget` message renders (a CAPTCHA, a picture, a poll…). */
  widget?: WidgetCard;
  /** The entry a `codex` message shows. */
  codex?: CodexCard;
  /** The quest a `quest` message is a step of. */
  quest?: QuestCard;
  /** The card a `wallet` message renders. */
  wallet?: WalletCard;
  /** A scripted line's dialogue manner (`(glitch)`), parens stripped — shown by the client, and the source of `fx`. */
  manner?: string;
  /** Effect text: an effect manner (`isEffectManner`) or a `crawl: fx` speaker. The client crawls it in the fx tier. Only on `line` / `narration`. */
  fx?: true;
  /** A GENERATOR bark (`ambient` event): the client shows it in the dim ticker, never as a stream row, never badged. */
  ambient?: true;
  /** A per-person notice (`broadcast "~…"`): its collapse key (`noticeKey`). Consecutive notices in a room collapse client-side. */
  notice?: string;
  /** A `reply` readout (the `respond` event). */
  readout?: true;
  /** A booth readout's subject guest id (`respond.about`), when one was bound. */
  about?: string;
  /** The server's moment class (§2.3 rules); absent = not a moment. */
  moment?: MomentClass;
  /** A booth readout's subject guest, by display name and avatar key (wave
   *  18, C3) — a pop-out renders the guest with no lookup. Only beside `about`. */
  aboutName?: string;
  aboutAvatar?: string;
  /** The moment's exits (wave 18, C2): the story's `with go: …` targets, or
   *  the default one (a card's thread, a quest step's quest, a codex
   *  unlock's entry, a wallet card's Wallet), never the lobby. A guest gets
   *  only the rooms they can see (`goForViewer`). Absent = none. */
  go?: GoTarget[];
  /** A self-closing `big` moment (`with close: 6s`, C1), in ms — only on a
   *  big moment addressed to two or more. */
  autoClose?: number;
  /** `with ack: none` (wave 26, R1): the big moment has no acknowledge
   *  button; only its exits close it. Absent = the usual OK. */
  noAck?: true;
  /** The story's `Night.phase` when this message was composed (after the
   *  batch that posted it; `null` = the path is declared but unset) — the
   *  moments layer's staleness rule ("the phase moved on since it arrived")
   *  judges a reconnect's backlog by it (`play/src/moments/model.ts`
   *  `phaseOf`). Only on what can be a moment (`phaseStamped`: alerts,
   *  takeover pins, readouts, quest steps, cards, a beat's lines), and only
   *  once the story's world holds a value there. A pure function of the replayed
   *  history, so a restart stamps the same value. */
  phase?: string | null;
}

/** A message before the store assigns it a `seq` + resolves `hidden`. A
 *  draft may open a thread (`threadRoot`) under a key, or reply to the
 *  thread a key opened earlier — how a quest's steps find its card. */
export type DraftMessage = Omit<ChatMessage, "seq" | "hidden"> & { threadKey?: string; threadRoot?: boolean };

// --- friendly in-world copy for broadcast cues ------------------------------

const CUES: Record<string, string> = {
  doomed: "📡 The Algorithm has marked you.",
  freedom: "✨ Freedom! You're back in the game.",
  welcome: "👋 Welcome.",
  peer_ping: "📲 Someone scanned your pass.",
  lockdown_siren: "🚨 Lockdown — the Algorithm tightens its grip.",
  jailed: "🔒 The door of the Internet slams shut behind you.",
  // Targeted enforcement — addressed to the one guest who earned it.
  lockdown: "🔒 The Algorithm locked you down. You're offline.",
  deep_lockdown: "🧊 Dragged into the deep Servers. Few come back.",
  // The Glitchers' underground railroad.
  agent_made: "🕶️ Your cover holds — for now.",
  roll_call: "📢 Word ripples through the cell: there's a way out.",
  // The feed reacting to a post.
  applause: "👏 The feed loves you.",
  spotlight: "🌟 You're trending.",
  subscribed: "🔔 Subscribed. The notifications will never stop.",
  // Heat management — the savvy guest covering their tracks.
  cloaked: "🥷 You're cloaked. The Algorithm lost your scent.",
  stayed_silent: "🤐 You gave them nothing. The cell respects that.",
  // Room-wide, operator-triggered (not the Algorithm): a blackout, a reveal.
  lights_out: "🔌 The lights cut out — someone hit the breaker.",
  unmasked: "🎭 The masks come off — the Algorithm stands exposed.",
};

/**
 * In-world copy for a broadcast cue. A cue written as prose (a quoted
 * string, or words with spaces — `broadcast "The lights go down." to …`) is
 * its own copy; a bare cue name looks up the legacy table, else a megaphone.
 */
/** "the Mods", but "The Way Out" as named: a group whose name already
 *  starts with an article keeps it, so a notice never reads "the The …". */
export function withThe(name: string): string {
  return /^(the|a|an)\s/iu.test(name) ? name : `the ${name}`;
}

function capitalised(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function cueText(cue: string): string {
  const t = cue.trim();
  const quoted = /^"(.*)"$/su.exec(t);
  if (quoted !== null) return quoted[1]!;
  if (/\s/u.test(t)) return t;
  return CUES[t] ?? `📣 ${t}`;
}

// --- channel descriptors ----------------------------------------------------

type ChannelHead = Pick<ChatMessage, "channel" | "channelKind" | "title">;

/** The lobby's model-free head. Its *title* is the story's (`sim.lobbyTitle()`);
 *  `lobbyHead` stamps it in when a sim is at hand. */
export const LOBBY: ChannelHead = { channel: "lobby", channelKind: "lobby", title: "Lobby" };

function lobbyHead(sim: Sim): ChannelHead {
  return { ...LOBBY, title: sim.lobbyTitle() };
}

/** The pinned rooms: everyone's own Codex + Quest Log (one id each; every
 *  message in them is addressed to one person). */
export const CODEX_ROOM: ChannelHead = { channel: "codex", channelKind: "codex", title: "Codex" };
export const QUEST_LOG: ChannelHead = { channel: "quests", channelKind: "quests", title: "Quest Log" };
/** The pinned Wallet room — present only when the story declares a `currency:`. */
export const WALLET_ROOM: ChannelHead = { channel: "wallet", channelKind: "wallet", title: "Wallet" };
export const PINNED_SPACE = "pinned";

/** Is this one of the personal pinned rooms (codex / quest log)? */
export function isPinnedRoom(channel: string): boolean {
  return channel === CODEX_ROOM.channel || channel === QUEST_LOG.channel || channel === WALLET_ROOM.channel;
}

/** How many ordinary messages a guest's or a booth's reconnect `history`
 *  frame carries (W8 T9-05). A phone waking late in the night re-downloaded
 *  every public line since the doors (≈ 6 MB by the end); the play app
 *  only ever shows the recent stream. Directors are not capped. */
export const HISTORY_LIMIT = 400;

/**
 * One viewer's history (`msgs`, seq-ordered, already filtered to what they
 * may see), cut to the last `limit` ordinary messages. Kept whatever their
 * age: every pinned-room row (the Codex, the Quest Log, the Wallet — the
 * viewer's whole record), every sticky pin / unpin (a `!!` takeover must
 * survive a reconnect), every `!` alert (a phone waking banners the newest
 * one it missed), every card (one still unanswered must stay answerable),
 * every row `personal` says is the viewer's own (their DMs — the public
 * rooms are what grows), and the root of any reply that is kept (a thread
 * never loses its head). Seq-ordered.
 */
export function capHistory(msgs: readonly ChatMessage[], limit = HISTORY_LIMIT, personal: (m: ChatMessage) => boolean = () => false): ChatMessage[] {
  const always = (m: ChatMessage) =>
    isPinnedRoom(m.channel) || m.pin !== undefined || m.unpin !== undefined || m.alert === true || m.kind === "widget" || personal(m);
  let ordinary = 0;
  for (const m of msgs) if (!always(m)) ordinary += 1;
  if (ordinary <= limit) return [...msgs];
  const keep = new Set<number>();
  const roots = new Set<number>();
  let skip = ordinary - limit;
  for (const m of msgs) {
    if (!always(m) && skip > 0) {
      skip -= 1;
      continue;
    }
    keep.add(m.seq);
    if (m.parentSeq !== null) roots.add(m.parentSeq);
  }
  return msgs.filter((m) => keep.has(m.seq) || roots.has(m.seq));
}

/** `capHistory`'s `personal` for guest `id`: their `dm:` / `pm:` threads and
 *  every row addressed to them alone. */
export function guestOwnRow(id: string): (m: ChatMessage) => boolean {
  return (m) =>
    Array.isArray(m.audience) && (m.channel.startsWith("dm:") || m.channel.startsWith("pm:") || (m.audience.length === 1 && m.audience[0] === id));
}

/** `capHistory`'s `personal` for the booth of `character`: every row
 *  addressed to it (`@<Character>` — its Inbox, its talk with an agent) and
 *  its own `dm:<Character>` threads with guests (each guest's card in the
 *  booth is built from them; a booth sees every public room, so 400 rows
 *  is only 20–30 minutes of a full house). */
export function boothOwnRow(character: string): (m: ChatMessage) => boolean {
  const me = `@${character}`;
  const dm = `dm:${character}`;
  return (m) => Array.isArray(m.audience) && (m.audience.includes(me) || m.channel === dm);
}

function factionChannel(faction: string): ChannelHead {
  return { channel: `faction:${faction}`, channelKind: "faction", title: `#${faction.toLowerCase()}` };
}
function dmChannel(speaker: string): ChannelHead {
  return { channel: `dm:${speaker}`, channelKind: "dm", title: speaker };
}

// --- spaces + channel descriptors -------------------------------------------
//
// A `Space` is the Discord-style container that groups channels in the
// sidebar. In slice 1 every derived channel lives in one default space; the
// authoring pass adds more. `spaceId` is a property of the *channel*, never of
// each message, so the wire payload per line stays lean.

export interface Space {
  id: string;
  title: string;
  /** Ordered channel ids (derived in slice 1). */
  channelIds: string[];
}

export const DEFAULT_SPACE: Space = { id: "story", title: "Story", channelIds: [] };

/** A channel's owning space. Everything derived lives in the story's space,
 *  except the pinned rooms (codex, quest log). */
export function spaceOf(channelId: string): string {
  return isPinnedRoom(channelId) ? PINNED_SPACE : DEFAULT_SPACE.id;
}

export interface ChannelDescriptor {
  channel: string;
  channelKind: ChannelKind;
  title: string;
  spaceId: string;
  /** Stable sidebar sort key: lobby 0, faction 1, dm/other 2. */
  order: number;
  members: Audience;
}

function headOf(id: string): ChannelHead {
  if (id === LOBBY.channel) return LOBBY;
  if (id === CODEX_ROOM.channel) return CODEX_ROOM;
  if (id === QUEST_LOG.channel) return QUEST_LOG;
  if (id === WALLET_ROOM.channel) return WALLET_ROOM;
  if (id.startsWith("faction:")) return factionChannel(id.slice("faction:".length));
  if (id.startsWith("dm:")) return dmChannel(id.slice("dm:".length));
  // Model-free fallback — `sim.channelHead` resolves the location's label.
  if (id.startsWith("loc:")) return { channel: id, channelKind: "location", title: id.slice("loc:".length) };
  // A private thread between two participants — `sim.channelHead` names them.
  if (id.startsWith("pm:")) return { channel: id, channelKind: "dm", title: id.slice("pm:".length).replace(":", " & ") };
  return { channel: id, channelKind: "dm", title: id };
}

function orderOf(kind: ChannelKind): number {
  if (kind === "wallet") return -3;
  if (kind === "quests") return -2;
  if (kind === "codex") return -1;
  return kind === "lobby" ? 0 : kind === "faction" ? 1 : kind === "location" ? 2 : 3;
}

/**
 * Stable descriptor for a (derived) channel id — the server twin of the
 * client's `channelHead` (`play/src/threads.ts`); they must agree on
 * kind/title so a message's channel reads the same on both ends.
 */
export function describeChannel(id: string): ChannelDescriptor {
  const head = headOf(id);
  return {
    ...head,
    spaceId: spaceOf(id),
    order: orderOf(head.channelKind),
    members: head.channelKind === "lobby" ? "all" : [],
  };
}

/**
 * Split an alert marker off a broadcast cue: a leading `!` — outside or
 * just inside the quotes of a prose cue — makes the message an alert.
 */
export function splitAlert(rawCue: string): { cue: string; alert: boolean; big?: true } {
  const t = rawCue.trim();
  // `!!` (wave 18, C1): a big moment — both marks stripped.
  if (t.startsWith("!!")) return { cue: t.slice(2).trim(), alert: true, big: true };
  if (t.startsWith('"!!')) return { cue: `"${t.slice(3).trimStart()}`, alert: true, big: true };
  if (t.startsWith("!")) return { cue: t.slice(1).trim(), alert: true };
  if (t.startsWith('"!')) return { cue: `"${t.slice(2)}`, alert: true };
  return { cue: t, alert: false };
}

/** A `reply` text as its reader sees it: a leading alert `!` stripped (the
 *  Inbox / lobby row's rule), with whether it was there. Every path that
 *  hands a readout's text on — the act / scan replies, the booth's
 *  `response` frame, the readout push — reads it through this. */
export function readoutText(text: string): { text: string; alert: boolean; big?: true } {
  const { cue, alert, big } = splitAlert(text);
  return { text: alert ? cue : text, alert, ...(big === true ? { big } : {}) };
}

/** A readout's subject guest, named (C3): `about`, `aboutName` and, when
 *  the runtime knows their picture, `aboutAvatar`. */
function aboutOf(sim: Sim, about: string, opts: ComposeOptions): Pick<ChatMessage, "about" | "aboutName" | "aboutAvatar"> {
  const name = sim.persons.get(about)?.name;
  if (name === undefined) return { about };
  const avatar = opts.avatarOf?.(name) ?? null;
  return { about, aboutName: name, ...(avatar !== null ? { aboutAvatar: avatar } : {}) };
}

/** Options for `composeGuestMessages` the runtime supplies. */
export interface ComposeOptions {
  /** A guest's avatar key by display name (`AvatarBook.keyFor`), for a
   *  readout's `aboutAvatar` (C3). */
  avatarOf?: (name: string) => string | null;
}

/** `with close:` as a draft's `autoClose`: only a big moment to two or more (C1). */
function autoCloseOf(moment: MomentClass | undefined, close: number | undefined, audience: Audience): { autoClose?: number } {
  if (moment !== "big" || close === undefined) return {};
  return audience === "all" || audience.length >= 2 ? { autoClose: close } : {};
}

/** `with ack: none` as a draft's `noAck` (wave 26, C1), copied beside `go`. */
function noAckOf(noAck: true | undefined): { noAck?: true } {
  return noAck === true ? { noAck: true } : {};
}

/**
 * Game-only beats (wave 26, C6): the lines of these beats are said only in
 * the reinstallation game, through the moment route's answer body
 * (`momentLines`). The chat composer emits no message for them, so no phone
 * thread, booth readout, Run pane or replay ever holds them (Trabolta
 * chastises an escape even before his reveal). Folded names (`foldName`).
 */
export const GAME_ONLY_BEATS: readonly string[] = ["Escape Attempt", "Heart In The Simulation"].map(foldName);

/** Is `beat` (a SimEvent's beat, maybe an owned `Owner.beat` key) game-only? */
export function isGameOnlyBeat(beat: string | null | undefined): boolean {
  if (beat == null || beat === "") return false;
  const whole = foldName(beat);
  const tail = foldName(beat.slice(beat.lastIndexOf(".") + 1));
  return GAME_ONLY_BEATS.includes(whole) || GAME_ONLY_BEATS.includes(tail);
}

/** One line the game says for a moment (C6): display text, never pronounced. */
export interface MomentLine {
  from: string;
  text: string;
}

/**
 * What one commit said to `guest`, in order (wave 26, C6): the batch's
 * `dialogue` events whose audience includes the guest, as `{from, text}`.
 * Game-only beats included (they never reach chat), and lines a phone
 * would hide (a locked phone, a hidden agent): the game is the surface.
 * Reads the SimEvents, not the composed messages. Pure.
 */
export function momentLines(events: readonly SimEvent[], guest: string): MomentLine[] {
  const out: MomentLine[] = [];
  for (const e of events) {
    if (e.type === "dialogue" && e.audience.includes(guest)) out.push({ from: e.speaker, text: e.text });
  }
  return out;
}

/** The story's `go:` words resolved (C2), else `fallback`; never the lobby. */
function goOf(sim: Sim, words: readonly string[] | undefined, fallback: GoTarget[] = []): { go?: GoTarget[] } {
  // A story `go:` that resolves to nothing (a typo: lint L1214) keeps the
  // default exit rather than leaving the card with none (m6).
  const resolved = words !== undefined && words.length > 0 ? resolveGoWords(sim.model, words) : [];
  const go = resolved.length > 0 ? resolved : fallback;
  return go.length > 0 ? { go } : {};
}

/** A card's default exit: its own thread (a DM, a place, an authored room) — never the lobby. */
function cardGo(sim: Sim, channel: string): GoTarget[] {
  if (channel.startsWith("dm:")) return [{ kind: "dm", id: channel, label: `Open ${channel.slice(3)}` }];
  if (channel.startsWith("loc:") || channel.startsWith("room:")) {
    const head = sim.channelHead(channel);
    const title = head.title.replace(/\s*\([^()]*\)$/u, "").trim() || head.title;
    return [{ kind: "room", id: channel, label: channel.startsWith("loc:") ? `Go to ${title}` : `Open ${head.title}` }];
  }
  return [];
}

/**
 * A message's exits as one viewer may take them (C2): a `room` target the
 * guest cannot see right now (a hidden place not yet open, a faction room
 * of the other side) is dropped. A booth / mod row is never trimmed.
 */
export function goForViewer(m: ChatMessage, sim: Sim | null, viewer: string): ChatMessage {
  if (m.go === undefined || sim === null) return m;
  const go = m.go.filter((t) => t.kind !== "room" || sim.canSeeChannel(viewer, t.id));
  if (go.length === m.go.length) return m;
  if (go.length > 0) return { ...m, go };
  const { go: _go, ...rest } = m;
  return rest;
}

/** Faction names referenced by a broadcast scope like `faction(Mods) | …`. */
function factionsInScope(scope: string): string[] {
  return [...scope.matchAll(/faction\(([^)]+)\)/g)].map((m) => m[1]!.trim());
}

/** Authored channels a broadcast scope names (`channel(hosts)` → `room:hosts`),
 *  matched by name folded (case, `#`/`_`/`-`, spaces); unknown names drop. */
function channelsInScope(sim: Sim, scope: string): string[] {
  const fold = (s: string) => s.replace(/^room:/u, "").toLowerCase().replace(/[#_-]/g, " ").replace(/\s+/g, " ").trim();
  const out: string[] = [];
  for (const m of scope.matchAll(/channel\(([^)]+)\)/g)) {
    const want = fold(m[1]!);
    for (const id of sim.model.channels.keys()) if (fold(id) === want && !out.includes(id)) out.push(id);
  }
  return out;
}

/** A scope addressed to the whole room (vs. a participant / faction slice). */
export function globalScope(scope: string): boolean {
  const s = scope.trim().toLowerCase();
  return s === "" || ["everyone", "all", "story", "internet", "world", "room", "party"].includes(s);
}

/**
 * The room a piece of un-addressed story lands in: the setting's location
 * room when the enclosing beat declares a known `setting:`, else the lobby.
 */
function storyChannel(sim: Sim, setting: string | null | undefined): ChannelHead {
  if (setting != null && setting.length > 0) {
    const head = sim.channelHead(`loc:${setting}`);
    if (head.channelKind === "location") {
      return { channel: head.channel, channelKind: "location", title: head.title };
    }
  }
  return lobbyHead(sim);
}

// --- composition ------------------------------------------------------------

/** The world path the moment stamp reads (`NightView.phase`'s). */
export const PHASE_PATH = "Night.phase";

/** `Night.phase` now, as `NightView.phase` reads it (quotes stripped,
 *  `""` / `null` → null); `undefined` while the world holds no value there
 *  (a story without a `Night.phase`, or before its first `set`): nothing
 *  is stamped then, and the client falls back to the phase it knows. */
export function storyPhase(sim: Sim): string | null | undefined {
  const v = sim.world.peek(PHASE_PATH);
  if (v === null) return undefined;
  if (v.kind === "null") return null;
  const t = display(v).replace(/^"(.*)"$/su, "$1").trim();
  return t === "" || t === "null" ? null : t;
}

/** Can the moments layer treat this message as a moment (or replay it after
 *  a wake)? Alerts, takeover pins, readouts, quest steps, cards, anything
 *  the server classed (`moment`), and a beat's scripted lines (the blue
 *  screen). Typed chat, notices and system rows never are. */
export function phaseStamped(d: DraftMessage): boolean {
  if (d.ambient === true) return false;
  if (d.moment !== undefined || d.alert === true || d.takeover === true || d.readout === true) return true;
  if (d.kind === "quest" || d.kind === "widget") return true;
  return (d.kind === "line" || d.kind === "narration") && typeof d.beat === "string" && d.beat !== "";
}

const sameAudience = (a: Audience, b: Audience): boolean =>
  a === "all" || b === "all" ? a === b : a.length === b.length && a.every((p, i) => p === b[i]);

/** "A", "A and B", "A, B and C". */
const listWords = (words: readonly string[]): string =>
  words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

/**
 * Route a freshly-emitted batch of sim events into guest-facing messages.
 * Pure apart from reading the sim's current clock + faction membership, both
 * of which are deterministic functions of the replayed command history.
 */
export function composeGuestMessages(sim: Sim, events: readonly SimEvent[], opts: ComposeOptions = {}): DraftMessage[] {
  const out: DraftMessage[] = [];
  const ts = sim.elapsed();
  const lobby = lobbyHead(sim);
  const sys = (text: string, audience: Audience): DraftMessage =>
    ({ ...lobby, from: "", kind: "system", text, ts, audience, parentSeq: null });

  // Who last spoke *to* each person in this batch — a widget shown right
  // after a character's line docks in that character's thread (the way a
  // choice does, see `decisionChannelFor`).
  const lastSpeaker = new Map<string, string>();
  // "📂 … is open now." notices for places, by the titles they list.
  const placeRuns = new Map<DraftMessage, string[]>();

  for (const e of events) {
    switch (e.type) {
      case "dialogue": {
        // Wave 26 (C6): a game-only beat's lines never become a message.
        if (isGameOnlyBeat(e.beat)) break;
        // The delivery: the block's manner rides the line, and a line is
        // effect text when the manner says so or the speaker always crawls.
        const fx = isEffectManner(e.manner) || sim.model.characters.get(e.speaker)?.crawl === "fx";
        const delivery = { ...(e.manner !== undefined ? { manner: e.manner } : {}), ...(fx ? { fx: true as const } : {}) };
        if (e.audience.length > 0) {
          // A character addressing you → that character's DM thread.
          for (const p of e.audience) lastSpeaker.set(p, e.speaker);
          out.push({ ...dmChannel(e.speaker), from: e.speaker, kind: "line", text: e.text, ts, audience: [...e.audience], parentSeq: null, beat: e.beat, ...delivery });
        } else {
          // Un-addressed scripted speech (no participant bound — e.g. the
          // NARRATOR of an entry beat) is stage voice: it plays in the
          // setting's room for everyone, not a nobody-can-see-it DM.
          out.push({ ...storyChannel(sim, e.setting), from: e.speaker, kind: "line", text: e.text, ts, audience: "all", parentSeq: null, beat: e.beat, ...delivery });
        }
        break;
      }
      case "action": {
        // Speakerless narration — the Narrator's word block, delivered to the
        // room the beat is set in. Previously dropped on the floor. A
        // game-only beat's narration stays out of chat too (C6).
        if (isGameOnlyBeat(e.beat)) break;
        const delivery = { ...(e.manner !== undefined ? { manner: e.manner } : {}), ...(isEffectManner(e.manner) ? { fx: true as const } : {}) };
        out.push({ ...storyChannel(sim, e.setting), from: "Narrator", kind: "narration", text: e.text, ts, audience: "all", parentSeq: null, beat: e.beat, ...delivery });
        break;
      }
      case "widget": {
        // `show kind "text" to scope` — a card the app renders inline. A
        // global one plays in the setting's room (else the lobby) for all;
        // an addressed one docks under whoever last spoke to each recipient
        // (their DM thread), else in the room, for those recipients.
        const widget = { kind: e.widget, text: e.text, params: { ...e.params } };
        // `with moment: major|minor` makes the card a moment (the param stays).
        const momentParam = (e.params["moment"] ?? "").trim().toLowerCase();
        const cardMoment = momentParam === "major" || momentParam === "minor" || momentParam === "big" ? { moment: momentParam as MomentClass } : {};
        const base = { from: "", kind: "widget" as const, text: e.text, ts, parentSeq: null, beat: e.beat, widget, ...cardMoment };
        // C2: the story's exits, else the card's own thread (never the lobby).
        const exits = (channel: string) => ({ ...goOf(sim, e.go, cardGo(sim, channel)), ...noAckOf(e.noAck) });
        if (e.audience.length === 0) {
          if (globalScope(e.scope)) {
            const head = storyChannel(sim, e.setting);
            out.push({ ...head, ...base, audience: "all", ...exits(head.channel), ...autoCloseOf(cardMoment.moment, e.close, "all") });
          }
          break; // a narrowed scope that resolved to nobody: no card
        }
        // `with thread: <Character>` pins the card to that character's DM
        // thread, whoever spoke last (a 📝 fact card always lives in
        // `dm:Trabolta`, even when it is re-dealt with no line before it).
        const thread = e.params["thread"];
        const pinned = thread !== undefined && sim.model.characters.has(thread) ? thread : undefined;
        const byChannel = new Map<string, { head: ChannelHead; to: string[] }>();
        for (const p of e.audience) {
          if (!sim.persons.has(p)) {
            // `show … to <Character>`: the card is dealt to that performer's
            // booth — its Inbox (`dm:<Character>`), or with `with thread:
            // <T>` that Cast thread — addressed `@<Character>`.
            const head = dmChannel(pinned ?? p);
            const slot = byChannel.get(head.channel) ?? { head, to: [] };
            slot.to.push(audienceOf(sim, p));
            byChannel.set(head.channel, slot);
            continue;
          }
          const speaker = pinned ?? lastSpeaker.get(p);
          const head = speaker !== undefined ? dmChannel(speaker) : storyChannel(sim, e.setting);
          const slot = byChannel.get(head.channel) ?? { head, to: [] };
          slot.to.push(p);
          byChannel.set(head.channel, slot);
        }
        for (const { head, to } of byChannel.values()) out.push({ ...head, ...base, audience: to, ...exits(head.channel), ...autoCloseOf(cardMoment.moment, e.close, to) });
        break;
      }
      case "respond": {
        // A readout (`reply …`). A `reply !…` is an alert (a major moment);
        // otherwise a personal readout is a minor one.
        const { text, alert, big } = readoutText(e.text);
        // C2: the story's exits (a readout lives in the lobby feed: no default).
        const flags = { readout: true as const, ...(alert ? { alert: true } : {}), ...goOf(sim, e.go), ...noAckOf(e.noAck) };
        // C1: `reply !!…` is a big moment; `reply !…` a major one.
        const loud: MomentClass = big === true ? "big" : "major";
        if (e.to === "") {
          // A story rule's reply with nobody acting: the lobby, for everyone.
          out.push({ ...lobby, from: "", kind: "narration", text, ts, audience: "all", parentSeq: null, ...flags, ...(alert ? { moment: loud, ...autoCloseOf(loud, e.close, "all") } : {}) });
        } else if (sim.persons.has(e.to)) {
          // The participant's own readout, in their lobby feed.
          out.push({ ...lobby, from: "", kind: "narration", text, ts, audience: [e.to], parentSeq: null, ...flags, moment: alert ? loud : "minor" });
        } else {
          // A booth readout (a scanner prop → its performer): the character's
          // own Inbox (`dm:<Character>`, addressed `@<Character>`), naming the
          // guest it is about.
          out.push({
            ...dmChannel(e.to),
            from: "",
            kind: "narration",
            text,
            ts,
            audience: [audienceOf(sim, e.to)],
            parentSeq: null,
            ...flags,
            ...(e.about != null ? aboutOf(sim, e.about, opts) : {}),
            moment: alert ? loud : "minor",
          });
        }
        break;
      }
      case "chat": {
        // A participant typed into a channel. The sim baked the audience +
        // display name; route by the channel id (a reply carries parentSeq).
        // `sim.channelHead` resolves authored channels (SPACE/CHANNEL) too.
        const head = sim.channelHead(e.channel);
        out.push({
          channel: head.channel,
          channelKind: head.channelKind as ChannelKind,
          title: head.title,
          from: e.from,
          kind: "line",
          text: e.text,
          ts,
          audience: e.audience === "all" ? "all" : [...e.audience],
          parentSeq: e.parentSeq,
        });
        break;
      }
      case "channelInvited":
      case "channelLeft": {
        const head = sim.channelHead(e.channel);
        const who = sim.persons.get(e.person)?.name ?? e.person;
        const text = e.type === "channelInvited" ? `📥 ${who} joined the room.` : `📤 ${who} left the room.`;
        out.push({
          channel: head.channel,
          channelKind: head.channelKind as ChannelKind,
          title: head.title,
          from: "",
          kind: "system",
          text,
          ts,
          audience: sim.channelAudience(e.channel),
          parentSeq: null,
        });
        break;
      }
      case "broadcast": {
        // A cue that begins with `!` (`broadcast "!Come to the Desktop." to
        // everyone`) is an alert: same message, plus the client's chime.
        // A `~` cue that is not an alert is a per-person notice: the client
        // collapses a run of them by their leading glyph.
        const split = splitAlert(e.cue);
        const alert = split.alert;
        const noticed = alert ? { cue: split.cue, notice: false } : splitNotice(split.cue);
        const cue = noticed.cue;
        const text = cueText(cue);
        // C1: `broadcast "!!…"` is a big moment (a self-closing one with
        // `with close:`); C2: the story's exits ride every copy.
        const loud: MomentClass = split.big === true ? "big" : "major";
        const base: Audience = globalScope(e.scope) ? "all" : [...e.audience];
        const flag = {
          ...(alert ? { alert: true, moment: loud, ...autoCloseOf(loud, e.close, base) } : noticed.notice ? { notice: noticeKey(text) } : {}),
          ...goOf(sim, e.go),
          ...noAckOf(e.noAck),
        };
        const factions = factionsInScope(e.scope);
        const rooms = channelsInScope(sim, e.scope);
        if (rooms.length > 0) {
          // `broadcast "…" to channel(hosts)`: a notice posted straight into
          // authored rooms (a staff back-room), to whoever may read them —
          // never the lobby, never mirrored into routed feeds.
          for (const id of rooms) {
            const head = sim.channelHead(id);
            out.push({ channel: head.channel, channelKind: head.channelKind as ChannelKind, title: head.title, from: "", kind: "signal", text, ts, audience: sim.channelAudience(id), parentSeq: null, ...flag });
          }
          break;
        }
        if (factions.length > 0) {
          // Mirror into each targeted faction channel (members only).
          for (const f of factions) {
            out.push({ ...factionChannel(f), from: "", kind: "signal", text, ts, audience: sim.factionMembers(f), parentSeq: null, ...flag });
          }
        } else {
          out.push({ ...LOBBY, from: "", kind: "signal", text, ts, audience: base, parentSeq: null, ...flag });
        }
        // Channel-type routing: any authored channel subscribed to this cue
        // (`routes: *` / `routes: <cue>`) also receives it — e.g. #announcements —
        // scoped to those who can see both the broadcast and the channel.
        for (const r of sim.routedChannelsFor(cue)) {
          out.push({
            channel: r.channel,
            channelKind: r.channelKind as ChannelKind,
            title: r.title,
            from: "",
            kind: "signal",
            text,
            ts,
            audience: intersectAudience(base, r.audience),
            parentSeq: null,
            ...flag,
          });
        }
        break;
      }
      case "pinned":
      case "unpinned": {
        // A sticky notice: in the person's own feed (the lobby, addressed to
        // them), or in an authored room / a place (to whoever reads it now —
        // a staff back-room's audience is `[]`, which performers and mods
        // still receive, exactly like `broadcast … to channel(hosts)`).
        const head = e.channel !== null ? sim.channelHead(e.channel) : lobby;
        const audience: Audience = e.channel !== null ? sim.channelAudience(e.channel) : e.person !== null ? [e.person] : "all";
        const h = { channel: head.channel, channelKind: head.channelKind as ChannelKind, title: head.title, from: "", ts, audience, parentSeq: null as number | null };
        if (e.type === "pinned") {
          // `!` = an alert; `!!` = an alert that takes over the whole screen.
          const takeover = e.text.startsWith("!!");
          const alert = e.text.startsWith("!");
          const text = takeover ? e.text.slice(2).trim() : alert ? e.text.slice(1).trim() : e.text;
          // A `!` pin is a major moment; a takeover has its own layer.
          out.push({ ...h, kind: "signal", text, pin: e.key, ...(alert ? { alert: true } : {}), ...(takeover ? { takeover: true } : alert ? { moment: "major" as const } : {}), ...goOf(sim, e.go) });
        } else {
          out.push({ ...h, kind: "system", text: e.text ?? "📌 Cleared.", unpin: e.key });
        }
        break;
      }
      case "codexUnlocked": {
        // Knowledge changed hands. The holder's Codex gains the entry as a
        // card — a guest's phone, or a character's booth (addressed
        // `@<Character>`) — and a guest who shared it sees that in their own.
        const def = sim.model.codex.get(e.entry);
        const title = def?.title ?? e.entry;
        const nameOf = (id: string) => sim.persons.get(id)?.name ?? id;
        {
          const about = def?.about ?? null;
          const kind = codexAboutKind(sim.model, about);
          const codex: CodexCard = {
            entry: e.entry,
            title,
            about,
            via: e.via,
            from: e.from !== null ? nameOf(e.from) : null,
            ...(def?.category != null ? { category: def.category } : {}),
            ...(kind !== null ? { aboutKind: kind } : {}),
          };
          // C2: the default exit is the entry itself.
          const go: GoTarget[] = [{ kind: "codex", entry: e.entry, label: `Read “${title.length <= 24 ? title : `${title.slice(0, 23).trimEnd()}…`}”` }];
          out.push({ ...CODEX_ROOM, from: "", kind: "codex", text: def?.text ?? "", ts, audience: [audienceOf(sim, e.person)], parentSeq: null, codex, go });
        }
        if (e.via === "share" && e.from !== null && sim.persons.has(e.from)) {
          out.push({ ...CODEX_ROOM, from: "", kind: "system", text: `📤 You shared “${title}” with ${nameOf(e.person)}.`, ts, audience: [e.from], parentSeq: null });
        }
        break;
      }
      case "codexMissed":
        out.push({ ...CODEX_ROOM, from: "", kind: "system", text: `⛔ “${e.code}” unlocks nothing.`, ts, audience: [e.person], parentSeq: null });
        break;
      case "quest": {
        // A quest's first step opens its card in the Quest Log; every later
        // step is a reply in that card's thread, in the giver's voice.
        const def = sim.model.quests.get(e.quest);
        const title = def?.title ?? e.quest;
        const text = e.text ?? (e.action === "start" ? (def?.text ?? "") : e.action === "complete" ? "✅ Quest complete." : e.action === "fail" ? "✖ Quest failed." : "");
        out.push({
          ...QUEST_LOG,
          from: def?.giver ?? "",
          kind: "quest",
          text,
          ts,
          audience: [audienceOf(sim, e.person)],
          parentSeq: null,
          quest: { quest: e.quest, title, action: e.action },
          // C2: the default exit is the quest itself.
          go: [{ kind: "quests", quest: e.quest, label: "See the quest" }],
          threadKey: `${e.person}\u0000${e.quest}`,
          ...(e.action === "start" ? { threadRoot: true, moment: "minor" as const } : {}),
        });
        break;
      }
      case "wallet":
        // One viewer per card: a person id, or `@<Character>` for the
        // approver's booth. A root opens the card's thread in the viewer's
        // Wallet room; a step replies to it.
        out.push({
          ...WALLET_ROOM,
          from: "",
          kind: "wallet",
          text: walletLine(e.card, ts, e.to),
          ts,
          audience: [e.to],
          parentSeq: null,
          wallet: e.card,
          // C2: the default exit is the Wallet.
          go: [{ kind: "wallet", label: "Open my Wallet" }],
          threadKey: `${e.to}\u0000${e.card.id}`,
          ...(e.root ? { threadRoot: true } : {}),
          // Wave 18b (R13): a transfer the approver's audit held — the
          // sender's `held`, the recipient's `flagged` — is a minor moment.
          ...(e.card.kind === "transfer" && (e.card.step === "held" || e.card.step === "flagged") ? { moment: "minor" as const } : {}),
        });
        break;
      case "ambient":
        // A GENERATOR bark: the client's dim ticker, never a stream row.
        out.push({ ...LOBBY, from: "", kind: "narration", text: e.text, ts, audience: "all", parentSeq: null, ambient: true });
        break;
      case "captured":
        out.push(sys(`⛓️ You've been taken to ${sim.model.locations.get(e.location)?.label ?? e.location}.`, [e.person]));
        break;
      case "escaped":
        out.push(sys("🏃 You broke free.", [e.person]));
        break;
      case "released":
        out.push(sys("🔓 The door swings open — you're released.", [e.person]));
        break;
      case "joined":
        out.push(sys(`You threw in with ${withThe(e.faction)}.`, [e.person]));
        break;
      case "defected":
        out.push(sys(`You betrayed ${withThe(e.from ?? "unaligned")} and defected to ${withThe(e.to)}.`, [e.person]));
        break;
      case "factionRevealed":
        if (e.quiet === true) break; // `reveal X quietly` (wave 18b)
        out.push(sys(`⚠️ ${capitalised(withThe(e.faction))} has been exposed!`, "all"));
        break;
      case "revealed": {
        // A hidden place / room opened up — tell whoever it opened for. A
        // character's reveal is the story's to announce (it is a person),
        // and `reveal X quietly` (wave 18b) says nothing at all.
        if (e.kind === "character" || e.quiet === true) break;
        const head = sim.channelHead(e.kind === "location" ? `loc:${e.target}` : e.target);
        const audience: Audience = e.person === null ? "all" : [e.person];
        // A run of places and rooms opening for the same people at once (a
        // house opening room by room, its chat room with it) is one notice.
        const prev = out[out.length - 1];
        const run = prev !== undefined ? placeRuns.get(prev) : undefined;
        if (run !== undefined && sameAudience(prev!.audience, audience)) {
          run.push(head.title);
          // A list reads by name: "The RAM (studio, basement)" → "The RAM".
          prev!.text = `📂 ${listWords(run.map((t) => t.replace(/\s*\([^()]*\)$/u, "")))} are open now.`;
          break;
        }
        const notice = sys(`📂 ${head.title} is open now.`, audience);
        placeRuns.set(notice, [head.title]);
        out.push(notice);
        break;
      }
      default:
        break;
    }
  }
  // The phase stamp: the world after the whole batch, so an alert and the
  // `set Night.phase = …` of the beat that sent it read the new phase.
  const phase = out.length > 0 ? storyPhase(sim) : undefined;
  if (phase !== undefined) for (const d of out) if (phaseStamped(d)) d.phase = phase;
  return out;
}

/**
 * The channel a pending decision belongs to: the DM of the character whose
 * line most recently prompted this person in `events`, else the lobby. Lets
 * a narrative `<choice>` dock under the speaker who asked it, while world
 * decisions (choose a side, escape) stay in the lobby.
 */
export function decisionChannelFor(events: readonly SimEvent[], person: string): string {
  let speaker: string | null = null;
  for (const e of events) {
    if (e.type === "dialogue" && e.audience.includes(person)) speaker = e.speaker;
    if (e.type === "choicePrompted" && e.person === person) break;
  }
  return speaker ? `dm:${speaker}` : LOBBY.channel;
}

/**
 * The per-menu twin of `decisionChannelFor` (wave 20, D18): every menu
 * prompted to a person in `events`, by its id → the DM of the character
 * whose line last reached that person before it, else the lobby. A batch
 * may prompt one person twice (a hook's menu after a beat's); each gets
 * the speaker that asked it. Menus with no id (a hand-built event) are
 * left out.
 *
 * `lastSpeaker` (person → speaker), when given, carries the speaker across
 * batches: it seeds the lookup and is updated in place, so a menu reached
 * with no line in its own batch (an option that `set`s, then `->` a menu)
 * still docks under the character who last spoke to that person.
 */
export function menuChannelsFor(events: readonly SimEvent[], lastSpeaker?: Map<string, string>): Map<number, string> {
  const speaker = lastSpeaker ?? new Map<string, string>();
  const out = new Map<number, string>();
  for (const e of events) {
    if (e.type === "dialogue") for (const p of e.audience) speaker.set(p, e.speaker);
    if (e.type === "choicePrompted" && e.person !== null && e.id !== undefined) {
      const who = speaker.get(e.person);
      out.set(e.id, who !== undefined ? `dm:${who}` : LOBBY.channel);
    }
  }
  return out;
}

/** The audience entry for a holder: a guest's id, or `@<Character>` — the
 *  booth convention `/api/prime/say` already uses for a performer's own
 *  conversation with an agent (`event-runtime.ts` visibleToPrime). A guest
 *  id never starts with `@`, so a character's rows never reach a phone. */
export function audienceOf(sim: Sim, id: string): string {
  return sim.persons.has(id) ? id : `@${id}`;
}

/** Is a message visible to a given guest (audience match)? */
export function visibleTo(m: ChatMessage, guestId: string): boolean {
  return m.audience === "all" || m.audience.includes(guestId);
}

/** Intersect two audiences — a routed mirror reaches only those entitled to
 *  both the broadcast and the channel (so a faction broadcast can't leak into
 *  a public feed). */
function intersectAudience(a: Audience, b: Audience): Audience {
  if (a === "all") return b;
  if (b === "all") return a;
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

// --- store ------------------------------------------------------------------

/**
 * Append-only log of every composed message, plus the moderator-hidden set.
 * Rebuilt verbatim on restart by replaying the journal through
 * `composeGuestMessages` (see server.ts `restore`); only `hiddenSeqs` is
 * persisted out-of-band because moderation isn't a sim event.
 */
export class ChatStore {
  private msgs: ChatMessage[] = [];
  private hidden = new Set<number>();
  /** Thread key → the seq of the message that opened it (a quest's card). */
  private roots = new Map<string, number>();

  /** Assign seqs and append. Returns the newly-stored messages. */
  append(drafts: DraftMessage[]): ChatMessage[] {
    const added: ChatMessage[] = [];
    for (const { threadKey, threadRoot, ...d } of drafts) {
      const seq = this.msgs.length;
      if (threadKey !== undefined) {
        if (threadRoot === true) this.roots.set(threadKey, seq);
        else d.parentSeq = this.roots.get(threadKey) ?? d.parentSeq;
      }
      const m: ChatMessage = { ...d, seq, hidden: this.hidden.has(seq) };
      this.msgs.push(m);
      added.push(m);
    }
    return added;
  }

  get length(): number {
    return this.msgs.length;
  }
  all(): readonly ChatMessage[] {
    return this.msgs;
  }
  get(seq: number): ChatMessage | undefined {
    return this.msgs[seq];
  }

  /** Hide / show a message. Returns the updated message, or null if absent. */
  setHidden(seq: number, hidden: boolean): ChatMessage | null {
    const m = this.msgs[seq];
    if (m === undefined) return null;
    m.hidden = hidden;
    if (hidden) this.hidden.add(seq);
    else this.hidden.delete(seq);
    return m;
  }

  hiddenSeqs(): number[] {
    return [...this.hidden].sort((a, b) => a - b);
  }

  /** Re-apply persisted moderation after a rebuild populates `msgs`. */
  loadHidden(seqs: Iterable<number>): void {
    this.hidden = new Set(seqs);
    for (const s of this.hidden) {
      const m = this.msgs[s];
      if (m !== undefined) m.hidden = true;
    }
  }

  /** Start a fresh timeline (new scenario / reset). */
  clear(): void {
    this.msgs = [];
    this.hidden = new Set();
    this.roots = new Map();
  }

  /**
   * The thread history a viewer should receive. Guests see only messages
   * addressed to them, with hidden ones withheld. An admin sees the same
   * guest's messages *including* hidden ones (flagged) so they can moderate.
   */
  historyFor(guestId: string, admin: boolean): ChatMessage[] {
    return this.msgs.filter((m) => visibleTo(m, guestId) && (admin || !m.hidden));
  }

  /** Replies hanging under a root message, seq-ordered. Derived (not stored). */
  replies(rootSeq: number): ChatMessage[] {
    return this.msgs.filter((m) => m.parentSeq === rootSeq);
  }
  /** How many replies a root message has. */
  replyCount(rootSeq: number): number {
    let n = 0;
    for (const m of this.msgs) if (m.parentSeq === rootSeq) n += 1;
    return n;
  }
}
