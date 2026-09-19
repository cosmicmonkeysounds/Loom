//! Client view types. The message + channel shapes mirror the server's
//! authoritative `server/chat.ts`; the rest mirror the per-role snapshot
//! projections in `server/views.ts`.

// --- server-authoritative chat (mirror of server/chat.ts) -------------------

export type ChannelKind = "lobby" | "faction" | "dm" | "group" | "open" | "private" | "location";
export type MessageKind = "line" | "narration" | "signal" | "system" | "widget";

/** An inline widget (`show …`, mirror of server/chat.ts `WidgetCard`): a
 *  game, a picture, a form the app renders in the conversation. */
export interface WidgetCard {
  kind: string;
  text: string;
  params: Record<string, string>;
}

/** One delivered message — the unit a conversation thread is built from. */
export interface ChatMessage {
  seq: number;
  channel: string;
  channelKind: ChannelKind;
  title: string;
  from: string;
  kind: MessageKind;
  text: string;
  ts: number;
  /** `"all"` or a list of guest ids. The client mostly ignores this. */
  audience: "all" | string[];
  /** Slack thread link: root message's `seq`, or `null` for a top-level line. */
  parentSeq: number | null;
  hidden: boolean;
  /** Beat a scripted line was spoken in, when known (mirror of server chat). */
  beat?: string | null;
  /** An alert broadcast (`!` cue) — chime, vibrate, banner. */
  alert?: boolean;
  /** The card a `widget` message renders. */
  widget?: WidgetCard;
  /** The director who posted this *as* a participant (admins only; the
   *  server strips it for guests). */
  via?: string;
}

// --- per-role snapshots (mirror of server/views.ts) -------------------------

/** An authored channel a participant can see (mirror of server views.ts). */
export interface ChannelSnapshot {
  id: string;
  kind: string; // open | private | faction | group | dm
  title: string;
  spaceId: string;
  member: boolean;
  /** May the viewer post here? Drives whether a composer shows. */
  canPost: boolean;
  /** Can messages here open threads? Drives the reply affordance. */
  threadable: boolean;
}

export interface SpaceSnapshot {
  id: string;
  title: string;
}

/** A declared `INTERACTION` the app offers as a button (mirror of server views.ts). */
export interface Interaction {
  id: string;
  label: string;
  who: "performer" | "guest" | "admin" | "agent";
  description: string | null;
}

/** A codex entry the viewer holds (mirror of server views.ts `CodexEntryView`). */
export interface CodexEntry {
  id: string;
  title: string;
  /** The subject it concerns — a character, or a topic. */
  about: string | null;
  text: string;
}

/** A row of the participants directory (mirror of server views.ts `PersonCard`). */
export interface PersonCard {
  id: string;
  name: string;
  kind: "guest" | "character";
  faction: string | null;
  /** The entries the viewer holds *about* this person — what one knows of them. */
  known: CodexEntry[];
  /** Where they stand (guests only; null before the story places them). */
  location: string | null;
  /** A character voiced by an agent (`mind: external`, e.g. a language
   *  model on a stagehand machine); `online` = someone is answering now. */
  agent?: { online: boolean };
}

export interface GuestView {
  id: string;
  name: string;
  /** The story's title + theme — every piece of chrome comes from the story. */
  title?: string;
  theme?: string;
  role: string | null;
  faction: string | null;
  score: number;
  location: string | null;
  captured: boolean;
  /** May a captive free themselves from the app? False in a `sealed` prison. */
  canEscape?: boolean;
  pendingChoice: string[] | null;
  /** Channel the pending decision docks under. */
  decisionChannel: string | null;
  /** Standing in a `cutscene: true` location: the app goes on rails — a
   *  full-screen stream of what is said to you, no rooms sidebar. */
  cutscene?: boolean;
  /** Widget cards (by seq) already answered — rendered resolved, never re-asked. */
  answered?: number[];
  /** Public (joinable) factions — the side chooser's source; may be empty. */
  factions?: string[];
  /** Every (public) group this guest belongs to. */
  groups?: string[];
  /** `who: guest` interactions the guest may fire for themselves. */
  interactions?: Interaction[];
  channels: ChannelSnapshot[];
  spaces: SpaceSnapshot[];
  /** Other participants (id + name), for the invite picker. */
  roster: Array<{ id: string; name: string }>;
  /** Knowledge as a currency: the entries this guest holds, out of how many exist. */
  codex?: CodexEntry[];
  codexTotal?: number;
  /** Everyone here (guests + listed characters), and what one knows of each. */
  people?: PersonCard[];
}

export interface PrimeGuest {
  id: string;
  name: string;
  faction: string | null;
  captured: boolean;
  /** Where the story has them standing. */
  location: string | null;
}

export interface PrimeView {
  character: string;
  title?: string;
  theme?: string;
  faction: string | null;
  guests: PrimeGuest[];
  channels: ChannelSnapshot[];
  spaces: SpaceSnapshot[];
  /** Performer (and admin) interactions to offer on a guest thread. */
  interactions?: Interaction[];
  /** The story uses the v3 prison mechanic — keep capture / release in the booth. */
  legacyCapture?: boolean;
  /** The entries this character holds — their backstory, shareable one guest at a time. */
  codex?: CodexEntry[];
  /** Agent-voiced characters this performer can message (`cast:<id>` threads). */
  agents?: Array<{ id: string; online: boolean }>;
}

// --- client-side view models (composed by the chat store) -------------------

export type Tone = "primary" | "danger" | "ghost";

/** A quick-reply button inside a decision tray / composer. */
export interface Action {
  label: string;
  onClick: () => void;
  tone?: Tone;
}

/** A decision that has been pulled to a thread, awaiting an answer. */
export interface Decision {
  title: string;
  options: Action[];
}

/** A conversation thread: the model both the list row and the open view use. */
export interface Channel {
  id: string;
  kind: ChannelKind | "guest" | "scanner";
  title: string;
  /** The Discord-style space this channel groups under in the sidebar. */
  spaceId: string;
  /** Section title for the space (from the authored SPACE, when present). */
  spaceTitle?: string;
  /** Stable sidebar sort key within a space (lobby 0, faction 1, …). */
  order?: number;
  /** True for an authored membership-gated channel the viewer belongs to. */
  member?: boolean;
  /** May the viewer post here? (authored channels; derived channels omit → open). */
  canPost?: boolean;
  /** Can messages here open threads? (authored channels; derived → threadable). */
  threadable?: boolean;
  /** Optional one-line subtitle (faction, status …). */
  subtitle?: string;
  /** A location room the viewer is standing in right now ("you are here"). */
  here?: boolean;
  /** A card in here is waiting on the viewer (an unanswered CAPTCHA, poll…). */
  needsYou?: boolean;
  /** Who is in this room — occupants of a location, members of a gated
   *  room, the other party of a private thread. Names, for the header strip. */
  people?: Array<{ id: string; name: string; kind: "guest" | "character"; group: string | null }>;
  messages: ChatMessage[];
  /** New, unseen, not-mine messages — drives the badge. */
  unread: number;
  /** A required decision docked here (also forces the thread to the top). */
  decision: Decision | null;
  /** Story-clock time of the last message (for sorting + the row timestamp). */
  lastTs: number;
  /** "<name> is typing…" — an agent-voiced character composing a reply here. */
  typing?: string | null;
}
