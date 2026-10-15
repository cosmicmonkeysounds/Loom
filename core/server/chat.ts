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

import type { Sim, SimEvent } from "../src/runtime/sim/index.ts";

// `lobby` / `faction` / `dm` / `location` are derived; `group` / `open` /
// `private` come from authored SPACE/CHANNEL declarations. `location` is the
// derived room of a `LOCATION` (`loc:<Id>`) — the stage itself is a channel.
export type ChannelKind = "lobby" | "faction" | "dm" | "group" | "open" | "private" | "location" | "codex" | "quests";

/** Who receives a message: `"all"` guests, or a fixed set of guest ids. */
export type Audience = "all" | string[];

export type MessageKind = "line" | "narration" | "signal" | "system" | "widget" | "codex" | "quest";

/** The entry a `codex` message carries (its `text` is the entry's text). */
export interface CodexCard {
  entry: string;
  title: string;
  about: string | null;
  via: "code" | "story" | "share";
  /** Who shared it (display name), for `via: "share"`. */
  from: string | null;
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
  /** The card a `widget` message renders (a CAPTCHA, a picture, a poll…). */
  widget?: WidgetCard;
  /** The entry a `codex` message shows. */
  codex?: CodexCard;
  /** The quest a `quest` message is a step of. */
  quest?: QuestCard;
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
export const PINNED_SPACE = "pinned";

/** Is this one of the personal pinned rooms (codex / quest log)? */
export function isPinnedRoom(channel: string): boolean {
  return channel === CODEX_ROOM.channel || channel === QUEST_LOG.channel;
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
  if (id.startsWith("faction:")) return factionChannel(id.slice("faction:".length));
  if (id.startsWith("dm:")) return dmChannel(id.slice("dm:".length));
  // Model-free fallback — `sim.channelHead` resolves the location's label.
  if (id.startsWith("loc:")) return { channel: id, channelKind: "location", title: id.slice("loc:".length) };
  // A private thread between two participants — `sim.channelHead` names them.
  if (id.startsWith("pm:")) return { channel: id, channelKind: "dm", title: id.slice("pm:".length).replace(":", " & ") };
  return { channel: id, channelKind: "dm", title: id };
}

function orderOf(kind: ChannelKind): number {
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
export function splitAlert(rawCue: string): { cue: string; alert: boolean } {
  const t = rawCue.trim();
  if (t.startsWith("!")) return { cue: t.slice(1).trim(), alert: true };
  if (t.startsWith('"!')) return { cue: `"${t.slice(2)}`, alert: true };
  return { cue: t, alert: false };
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
function globalScope(scope: string): boolean {
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
export function composeGuestMessages(sim: Sim, events: readonly SimEvent[]): DraftMessage[] {
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
      case "dialogue":
        if (e.audience.length > 0) {
          // A character addressing you → that character's DM thread.
          for (const p of e.audience) lastSpeaker.set(p, e.speaker);
          out.push({ ...dmChannel(e.speaker), from: e.speaker, kind: "line", text: e.text, ts, audience: [...e.audience], parentSeq: null, beat: e.beat });
        } else {
          // Un-addressed scripted speech (no participant bound — e.g. the
          // NARRATOR of an entry beat) is stage voice: it plays in the
          // setting's room for everyone, not a nobody-can-see-it DM.
          out.push({ ...storyChannel(sim, e.setting), from: e.speaker, kind: "line", text: e.text, ts, audience: "all", parentSeq: null, beat: e.beat });
        }
        break;
      case "action":
        // Speakerless narration — the Narrator's word block, delivered to the
        // room the beat is set in. Previously dropped on the floor.
        out.push({ ...storyChannel(sim, e.setting), from: "Narrator", kind: "narration", text: e.text, ts, audience: "all", parentSeq: null, beat: e.beat });
        break;
      case "widget": {
        // `show kind "text" to scope` — a card the app renders inline. A
        // global one plays in the setting's room (else the lobby) for all;
        // an addressed one docks under whoever last spoke to each recipient
        // (their DM thread), else in the room, for those recipients.
        const widget = { kind: e.widget, text: e.text, params: { ...e.params } };
        const base = { from: "", kind: "widget" as const, text: e.text, ts, parentSeq: null, beat: e.beat, widget };
        if (e.audience.length === 0) {
          if (globalScope(e.scope)) out.push({ ...storyChannel(sim, e.setting), ...base, audience: "all" });
          break; // a narrowed scope that resolved to nobody: no card
        }
        // `with thread: <Character>` pins the card to that character's DM
        // thread, whoever spoke last (a 📝 fact card always lives in
        // `dm:Trabolta`, even when it is re-dealt with no line before it).
        const thread = e.params["thread"];
        const pinned = thread !== undefined && sim.model.characters.has(thread) ? thread : undefined;
        const byChannel = new Map<string, { head: ChannelHead; to: string[] }>();
        for (const p of e.audience) {
          const speaker = pinned ?? lastSpeaker.get(p);
          const head = speaker !== undefined ? dmChannel(speaker) : storyChannel(sim, e.setting);
          const slot = byChannel.get(head.channel) ?? { head, to: [] };
          slot.to.push(p);
          byChannel.set(head.channel, slot);
        }
        for (const { head, to } of byChannel.values()) out.push({ ...head, ...base, audience: to });
        break;
      }
      case "respond":
        // A device readout (`<respond:>`): a personal narration line in the
        // lobby feed of whoever scanned (visible to the booth via SSE too).
        out.push({ ...lobby, from: "", kind: "narration", text: e.text, ts, audience: e.to === "" ? "all" : [e.to], parentSeq: null });
        break;
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
        const { cue, alert } = splitAlert(e.cue);
        const text = cueText(cue);
        const flag = alert ? { alert: true } : {};
        const factions = factionsInScope(e.scope);
        const base: Audience = globalScope(e.scope) ? "all" : [...e.audience];
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
      case "codexUnlocked": {
        // Knowledge changed hands. The holder's Codex gains the entry as a
        // card (a character holder has no phone; the booth sees it in the
        // snapshot), and a guest who shared it sees that in their own.
        const def = sim.model.codex.get(e.entry);
        const title = def?.title ?? e.entry;
        const nameOf = (id: string) => sim.persons.get(id)?.name ?? id;
        if (sim.persons.has(e.person)) {
          const codex: CodexCard = { entry: e.entry, title, about: def?.about ?? null, via: e.via, from: e.from !== null ? nameOf(e.from) : null };
          out.push({ ...CODEX_ROOM, from: "", kind: "codex", text: def?.text ?? "", ts, audience: [e.person], parentSeq: null, codex });
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
          audience: [e.person],
          parentSeq: null,
          quest: { quest: e.quest, title, action: e.action },
          threadKey: `${e.person}\u0000${e.quest}`,
          ...(e.action === "start" ? { threadRoot: true } : {}),
        });
        break;
      }
      case "ambient":
        out.push({ ...LOBBY, from: "", kind: "narration", text: e.text, ts, audience: "all", parentSeq: null });
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
        out.push(sys(`⚠️ ${capitalised(withThe(e.faction))} has been exposed!`, "all"));
        break;
      case "revealed": {
        // A hidden place / room opened up — tell whoever it opened for. A
        // character's reveal is the story's to announce (it is a person).
        if (e.kind === "character") break;
        const head = sim.channelHead(e.kind === "location" ? `loc:${e.target}` : e.target);
        const audience: Audience = e.person === null ? "all" : [e.person];
        // A run of places opening for the same people at once (a house
        // opening room by room) is one notice, not one per room.
        const prev = out[out.length - 1];
        const run = prev !== undefined ? placeRuns.get(prev) : undefined;
        if (e.kind === "location" && run !== undefined && sameAudience(prev!.audience, audience)) {
          run.push(head.title);
          // A list reads by name: "The RAM (studio, basement)" → "The RAM".
          prev!.text = `📂 ${listWords(run.map((t) => t.replace(/\s*\([^()]*\)$/u, "")))} are open now.`;
          break;
        }
        const notice = sys(`📂 ${head.title} is open now.`, audience);
        if (e.kind === "location") placeRuns.set(notice, [head.title]);
        out.push(notice);
        break;
      }
      default:
        break;
    }
  }
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
