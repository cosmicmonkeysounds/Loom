//! Client view types. The message + channel shapes mirror the server's
//! authoritative `server/chat.ts`; the rest mirror the per-role snapshot
//! projections in `server/views.ts`.

import type { AlertLevel, MomentClass } from "../../core/src/delivery.ts";

// Wave 13: the interrupt ladder and the host view are dependency-free core
// modules, re-exported so every app reads one definition.
export type { AlertLevel, MomentClass } from "../../core/src/delivery.ts";
export type { HostView, HostNeed, HostPerson, HostJudging, NeedTarget } from "../../core/src/host-board.ts";

// --- server-authoritative chat (mirror of server/chat.ts) -------------------

export type ChannelKind = "lobby" | "faction" | "dm" | "group" | "open" | "private" | "location" | "codex" | "quests" | "wallet";
export type MessageKind = "line" | "narration" | "signal" | "system" | "widget" | "codex" | "quest" | "wallet";

/** The entry a `codex` message shows (mirror of server/chat.ts `CodexCard`);
 *  the message's `text` is the entry's text. */
export interface CodexCard {
  entry: string;
  title: string;
  about: string | null;
  via: "code" | "story" | "share";
  /** Who shared it, for `via: "share"`. */
  from: string | null;
  /** The entry's `category:` (wave 13); absent when it has none. */
  category?: string;
  /** What `about` names (wave 13); absent when `about` is null. */
  aboutKind?: "character" | "location" | "topic";
}

export type QuestAction = "start" | "update" | "complete" | "fail";
export type QuestStatus = "active" | "done" | "failed";

/** The quest a `quest` message is a step of (mirror of server/chat.ts
 *  `QuestCard`): the `start` message is the card, later steps reply to it. */
export interface QuestCard {
  quest: string;
  title: string;
  action: QuestAction;
}

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
  /** A sticky notice (`pin "…"`): the key it was pinned under (a person's
   *  id, or "" for a room-wide pin). `pins.ts` keeps the newest per
   *  (channel, key) above the stream until an `unpin` with the same key. */
  pin?: string;
  /** Takes down the pin with this key in this channel (`unpin …`). */
  unpin?: string;
  /** A takeover pin (`pin "!!…"`, an alert too): `takeover.tsx` covers the
   *  whole screen with it until the story unpins it. */
  takeover?: boolean;
  /** The card a `widget` message renders. */
  widget?: WidgetCard;
  /** The entry a `codex` message shows. */
  codex?: CodexCard;
  /** The quest a `quest` message is a step of. */
  quest?: QuestCard;
  /** The card a `wallet` message renders. */
  wallet?: WalletCard;
  /** The director who posted this *as* a participant (admins only; the
   *  server strips it for guests). */
  via?: string;
  /** A scripted line's dialogue manner (`(glitch)`), parens stripped (wave 13). */
  manner?: string;
  /** Effect text (an effect manner, or a `crawl: fx` speaker): the fx crawl. Only on `line` / `narration`. */
  fx?: true;
  /** A GENERATOR bark: the dim ticker, never a stream row, never badged. */
  ambient?: true;
  /** A per-person notice (`broadcast "~…"`): its collapse key (`noticeKey`). */
  notice?: string;
  /** A `reply` readout (the `respond` event). */
  readout?: true;
  /** A booth readout's subject guest id, when one was bound. */
  about?: string;
  /** The server's moment class; absent = not a moment. */
  moment?: MomentClass;
  /** The story's `Night.phase` when the server composed this message (null
   *  = set to nothing). Only on what can be a moment, and only once the
   *  story has a phase; absent → the moments layer uses the phase it knows
   *  now (`moments/model.ts` `phaseOf`). */
  phase?: string | null;
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
  /** Whose button this is (character ids, the INTERACTION's `by:` + owned
   *  hooks). Absent = anyone's. */
  actors?: string[];
  /** True when the INTERACTION declares `by:`: only its `actors` may press
   *  it (the server refuses another booth), so a booth doesn't offer it. */
  only?: true;
  /** False on an `only` button nothing outside its `actors` hears (only
   *  their own hooks): a host's press would do nothing and the server
   *  refuses it, so even a host or admin booth leaves it out. */
  hostHeard?: false;
  /** False while its `while:` is false — not on offer right now. */
  live?: false;
  /** `arm: true`: the button arms on the first tap and fires on the second
   *  (core's `tapCue`, as on the director's phone). */
  arm?: boolean;
}

/** A codex entry the viewer holds (mirror of server views.ts `CodexEntryView`). */
export interface CodexEntry {
  id: string;
  title: string;
  /** The subject it concerns — a character, or a topic. */
  about: string | null;
  text: string;
  /** `secret: true` — an agent-voiced character never takes it. */
  secret?: boolean;
  /** The entry's `category:` (wave 13); absent when it has none. */
  category?: string;
  /** What `about` names (wave 13); absent when `about` is null. */
  aboutKind?: "character" | "location" | "topic";
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
   *  model on a stagehand machine); `online` = someone is answering now;
   *  `hold` = the story has a `hold:` line, so they always answer. */
  agent?: { online: boolean; hold?: true };
}

export interface GuestView {
  /** The show clock (wave 13 K5): show minutes after midnight when the view
   *  was built + whether it runs (`show-clock.ts`). Absent → no clock. */
  showClock?: { minutes: number; running: boolean };
  id: string;
  name: string;
  /** The story's title + theme — every piece of chrome comes from the story. */
  title?: string;
  theme?: string;
  /** Story clock (ms) when the server built this view — "now" for `ts`. */
  clock?: number;
  role: string | null;
  faction: string | null;
  score: number;
  location: string | null;
  captured: boolean;
  /** The story restricted you (`restrict who`): the app greys out, no
   *  buttons, only the listed rooms, read-only; your DMs still work. */
  restricted?: boolean;
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
  /** The quest log, in the order quests were handed out (mirror of server
   *  views.ts `QuestView`), and how many the story declares. */
  quests?: Array<{ id: string; title: string; giver: string | null; status: QuestStatus }>;
  questTotal?: number;
  /** The story's currency, when it declares one (`currency:`). */
  wallet?: WalletView;
  /** Everyone here (guests + listed characters), and what one knows of each. */
  people?: PersonCard[];
  /** Profile pictures: folded display name → serving key (`avatars.ts`). */
  avatars?: Record<string, string>;
  /** The story's guest-facing clocks (`countdown: … for guests` header
   *  lines, never a secret head): present only while one is running.
   *  `endsAt` is in story seconds, against `clock` (ms). */
  countdowns?: CountdownSummary[];
  /** The story clock is stopped (the event is paused): the countdowns hold
   *  still. Absent = it runs (an older server never says). */
  paused?: true;
  /** Live OBJECTIVEs for this guest, model order (NOW = the first). Wave 13; absent from an older server. */
  objectives?: ObjectiveView[];
  /** Where the night is (wave 13). */
  night?: NightView;
  /** The interrupt ladder's level now (wave 13). */
  alertLevel?: AlertLevel;
  /** Characters whose `dm:` thread somebody reads (performer parts, agent-voiced); others get no composer (wave 13). */
  voiced?: string[];
}

/** One running countdown (mirror of server views.ts `CountdownSummary`). */
export interface CountdownSummary {
  label: string;
  path: string;
  /** The deadline, in story seconds (`Time.elapsed` units). */
  endsAt: number;
}

export interface PrimeGuest {
  id: string;
  name: string;
  faction: string | null;
  captured: boolean;
  /** `restrict who` is in force — the card shows a ⛔ pill. */
  restricted?: boolean;
  /** Where the story has them standing. */
  location: string | null;
  /** ROLE-scoped `watch:` items for this guest (secret slots dropped), wave 13. Absent when none. */
  flags?: GuestFlag[];
}

export interface PrimeView {
  /** The show clock (wave 13 K5): show minutes after midnight when the view
   *  was built + whether it runs (`show-clock.ts`). Absent → no clock. */
  showClock?: { minutes: number; running: boolean };
  character: string;
  title?: string;
  theme?: string;
  /** Story clock (ms) when the server built this view — "now" for `ts`. */
  clock?: number;
  faction: string | null;
  guests: PrimeGuest[];
  channels: ChannelSnapshot[];
  spaces: SpaceSnapshot[];
  /** Performer interactions to offer on a guest thread. Wave 13: `who:
   *  performer` only — never `who: admin` (the cue sheet is the host view's). */
  interactions?: Interaction[];
  /** The story uses the v3 prison mechanic — keep capture / release in the booth. */
  legacyCapture?: boolean;
  /** The entries this character holds — their backstory, shareable one guest at a time. */
  codex?: CodexEntry[];
  /** How many entries the story declares (0 → no Codex room in the booth). */
  codexTotal?: number;
  /** The character's own quest log (`start quest X for <Character>`), in
   *  hand-out order, and how many quests the story declares. */
  quests?: Array<{ id: string; title: string; giver: string | null; status: QuestStatus }>;
  questTotal?: number;
  /** Widget cards (by seq) this character has already answered. */
  answered?: number[];
  /** The approver's queue (the approver's booth only). */
  wallet?: WalletQueueView;
  /** Agent-voiced characters this performer can message (`cast:<id>` threads). */
  agents?: Array<{ id: string; online: boolean }>;
  /** Profile pictures: folded display name → serving key (`avatars.ts`). */
  avatars?: Record<string, string>;
  /** Live OBJECTIVEs for this character (its name, its GROUP, `performers`, `everyone`), model order. Wave 13. */
  objectives?: ObjectiveView[];
  /** Where the night is (wave 13). */
  night?: NightView;
  /** The interrupt ladder's level now (wave 13). */
  alertLevel?: AlertLevel;
  /** Every live countdown, secret heads dropped (booths are staff). Wave 13; absent when none. */
  countdowns?: CountdownSummary[];
  /** Staff-room channel ids as authored (`room:hosts`), wave 13. */
  staffRooms?: string[];
  /** The story clock is stopped (paused, or the doors not yet open): the
   *  booth's countdowns hold still (`booth/model.ts` `viewPaused`). */
  paused?: true;
  /** The booth holds the host capability (an `admin: true` part, or the
   *  moderator passcode): it may press another character's `by:` button,
   *  unless that button says `hostHeard: false`.
   *  The server sends `false` too, so a revoked host reaches the booth. */
  host?: boolean;
}

// --- wave 13: objectives, the night, a booth's guest card (mirror of server/views.ts)

/** One live OBJECTIVE as this viewer sees it. */
export interface ObjectiveView {
  id: string;
  title: string;
  /** "" when none. Literal text. */
  brief: string;
  checklist: ObjectiveCheck[];
  /** What this viewer may press, in written order, plus "pass" / "scan". */
  buttons: string[];
  /** `act:` as written, else null. Display only. */
  act: string | null;
  loud?: true;
}
export interface ObjectiveCheck {
  label: string;
  /** null = a to-do with no condition; else whether `done when` holds now. */
  done: boolean | null;
}

/** Where the night is, for every phone. */
export interface NightView {
  /** The cue sheet's focus act; null when none. */
  act: { code: string | null; title: string | null } | null;
  /** The world `Night.phase`, else null. */
  phase: string | null;
  /** The world `Night.step`, else null. */
  step: number | null;
}

/** A ROLE-scoped `watch:` item for one guest (the booth card's facts). */
export interface GuestFlag {
  label: string;
  path: string;
  /** The guest's value, as a display string. */
  value: string;
  /** Truthy? A boolean item is always listed (false included); a non-boolean one only when truthy. */
  on: boolean;
}

/** What one booth may do to one guest right now (`POST /api/prime/card`). */
export interface GuestCardView {
  guest: PrimeGuest;
  /** INTERACTION ids this booth may press on this guest now, model order. */
  live: string[];
  /** The subset of `live` whose `while:` reads the subject (live because of this guest). */
  guestScoped: string[];
  /** This character's readouts about this guest, oldest first, the last 5 at most. */
  readouts: Array<{ seq: number; text: string; ts: number }>;
}

/** `/api/scan` 200 body. */
export interface ScanResult {
  ok: true;
  scannedAs: string | null;
  canModerate: boolean;
  responses: string[];
  guest: { id: string; name: string; captured: boolean };
  card?: GuestCardView;
  /** The staff-room lines (`# hosts` …) this scan produced: the story's refusal / explanation (fix round C1). */
  staff?: string[];
  /** Lines the booth's character spoke to the scanned guest in this commit (C1). */
  said?: Array<{ from: string; text: string }>;
  /** The story refused it (the cue sheet's `pressRefused`): the `staff` lines say why. Absent: unknown. */
  refused?: boolean;
}
/** `/api/prime/act` 200 body. */
export interface PrimeActResult {
  ok: true;
  guest: unknown;
  replies?: string[];
  card?: GuestCardView;
  /** The staff-room lines (`# hosts` …) this press produced: the story's refusal / explanation (fix round C1). */
  staff?: string[];
  /** Lines the booth's character spoke to the guest in this commit (C1). */
  said?: Array<{ from: string; text: string }>;
  /** The story refused it (the cue sheet's `pressRefused`): the `staff` lines say why. Absent: unknown. */
  refused?: boolean;
}

// --- client-side view models (composed by the chat store) -------------------

export type Tone = "primary" | "danger" | "ghost";

/** A quick-reply button inside a decision tray / composer. */
export interface Action {
  label: string;
  onClick: () => void;
  tone?: Tone;
  /** Shown but not tappable (e.g. 💸 Send while the wallet is frozen). */
  disabled?: boolean;
  /** Armed (an `arm: true` button after its first tap): it reads black,
   *  with "Tap again to fire" under the label. */
  armed?: boolean;
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
  /** The `data-tour` anchor this row carries (the guided tour points at it). */
  tour?: string;
  /** An agent-voiced character's `dm:` row (wave 13; set by the stream lane). */
  agent?: true;
  /** A staff room (wave 13; set by the booth lane). */
  staff?: true;
}

// --- the wallet (mirror of server/wallet.ts + the `WalletCard` in the
// engine's event.ts) ----------------------------------------------------------

export type WalletTxState = "pending" | "held" | "settled" | "denied" | "cancelled";
export type WalletRequestState = "open" | "paying" | "paid" | "declined" | "expired" | "cancelled";
export type WalletOfferState = "open" | "accepted" | "declined" | "failed" | "expired" | "cancelled";
// `grant` = the minter paid one person from the reserve; `freeze` = the
// minter froze one person's coin (`settleAt` = when it thaws).
export type WalletCardKind = "transfer" | "request" | "offer" | "stimulus" | "approval" | "grant" | "freeze";
export type WalletStep =
  | "sent"
  | "pending"
  | "held"
  | "settled"
  | "received"
  | "approved"
  | "denied"
  | "cancelled"
  | "asked"
  | "paid"
  | "declined"
  | "expired"
  | "offered"
  | "accepted"
  | "failed"
  | "minted"
  /** A held transfer nobody audited in time: the book approved it itself. */
  | "timed_out"
  /** The reserve: `granted` (the minter's root) / `received` (the
   *  recipient's); a freeze: `frozen` (the target's root) / `imposed` (the
   *  minter's), then `thawed` (target) + `expired` / `cancelled` (minter). */
  | "granted"
  | "frozen"
  | "imposed"
  | "thawed";

/** One wallet card as this viewer sees it (mirror of server/wallet.ts
 *  `WalletCard`): `kind` + `step` say which side the viewer is on; `id`
 *  (`t12` / `r3` / `o7` / `s1`) is the card's thread key. */
export interface WalletCard {
  kind: WalletCardKind;
  id: string;
  step: WalletStep;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
  /** The unit — the story's currency name. */
  unit: string;
  side?: "buy" | "sell";
  entry?: string;
  entryTitle?: string;
  /** Story ms — the countdown on pending / approval cards. */
  settleAt?: number;
  /** Who approved / denied / cancelled. */
  by?: string;
  /** An open request closed by someone other than its asker (a director). */
  closedBy?: string;
  /** The approver's display name, on a card that waits on them. */
  approver?: string;
}

export interface WalletTxView {
  id: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
  state: WalletTxState;
  settleAt: number | null;
  via: "send" | "request";
  at: number;
  by?: string;
}
export interface WalletRequestView {
  id: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
  state: WalletRequestState;
  expiresAt: number;
  at: number;
  tx?: string;
}
export interface WalletOfferView {
  id: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  side: "buy" | "sell";
  entry: string;
  entryTitle: string;
  amount: number;
  state: WalletOfferState;
  expiresAt: number;
  at: number;
}
/** A guest's wallet (`GuestView.wallet`, present only when the story
 *  declares a `currency:`). */
export interface WalletView {
  name: string;
  balance: number;
  /** Coin out of the balance but not yet the other side's. */
  escrowed: number;
  maxTransfer: number;
  /** Mine (either side), open first, newest 20. */
  transfers: WalletTxView[];
  /** Open requests, in + out. */
  requests: WalletRequestView[];
  /** Open offers, in + out. */
  offers: WalletOfferView[];
  /** When the viewer's coin is frozen: story ms it thaws at. Send, pay a
   *  request, a buy offer and accepting a sell offer are refused until then
   *  (coin still comes in; declining and cancelling still work). */
  frozenUntil?: number;
  /** When the viewer is the minter's program: `uses` / `limit` = the
   *  stimulus, `grants` = the reserve's per-person grants, `freezeMs` = one
   *  freeze's length, `frozen` = the freezes in force (optional for an old
   *  server). */
  minter?: { uses: number; limit: number; grants?: { uses: number; limit: number }; freezeMs?: number; frozen?: WalletFreezeView[] };
  /** When the viewer IS the approver (declared as a guest program). */
  approver?: { queue: WalletTxView[] };
}
/** A freeze in force (`WalletView.minter.frozen`). */
export interface WalletFreezeView {
  id: string;
  target: string;
  targetName: string;
  by: string;
  until: number;
  at: number;
}
/** The approver's booth (`PrimeView.wallet`). */
export interface WalletQueueView {
  name: string;
  queue: WalletTxView[];
  every: number;
  windowMs: number;
}
