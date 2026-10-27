//! Ecosystem-simulation events — the append-only record of everything
//! that happens in the world. External input (account creation, QR
//! scans, faction joins) and internal effects (captures, broadcasts,
//! dialogue) all land here in source order.

/**
 * Enum of every `SimEvent` discriminant. The values ARE the wire/journal
 * strings, so `e.type === SimEventType.BeatEntered` and `e.type ===
 * "beatEntered"` are interchangeable — but consumers should switch on the
 * enum so a renamed event breaks loudly at compile time. (A const object
 * rather than a TS `enum`: the workspace compiles with
 * `erasableSyntaxOnly`, which forbids runtime enum syntax.)
 */
export const SimEventType = {
  AccountCreated: "accountCreated",
  Joined: "joined",
  Defected: "defected",
  Betrayed: "betrayed",
  FactionRevealed: "factionRevealed",
  Revealed: "revealed",
  Scanned: "scanned",
  Captured: "captured",
  Released: "released",
  Escaped: "escaped",
  Arrived: "arrived",
  Cast: "cast",
  Promoted: "promoted",
  WorldSet: "worldSet",
  RelationshipChanged: "relationshipChanged",
  Broadcast: "broadcast",
  Dialogue: "dialogue",
  Chat: "chat",
  ChannelInvited: "channelInvited",
  ChannelLeft: "channelLeft",
  Action: "action",
  Directive: "directive",
  BeatEntered: "beatEntered",
  ChoicePrompted: "choicePrompted",
  Chose: "chose",
  ChoiceUpdated: "choiceUpdated",
  Respond: "respond",
  Widget: "widget",
  Signal: "signal",
  CodexUnlocked: "codexUnlocked",
  CodexMissed: "codexMissed",
  Quest: "quest",
  Restricted: "restricted",
  Unrestricted: "unrestricted",
  Pinned: "pinned",
  Unpinned: "unpinned",
  Wallet: "wallet",
  Ambient: "ambient",
  Tick: "tick",
  Diagnostic: "diagnostic",
} as const;

/** What happened to a quest. */
export type QuestAction = "start" | "update" | "complete" | "fail";

/** Where a quest stands in someone's log. */
export type QuestStatus = "active" | "done" | "failed";

export type SimEventType = (typeof SimEventType)[keyof typeof SimEventType];

/** One thing that happened in the world. */
export type SimEvent =
  | { type: "accountCreated"; person: string; name: string; role: string }
  | { type: "joined"; person: string; faction: string }
  | { type: "defected"; person: string; from: string | null; to: string }
  | { type: "betrayed"; person: string; displayed: string | null; secret: string }
  /** `quiet` (wave 18b): `reveal X quietly` — the chat posts no notice. */
  | { type: "factionRevealed"; faction: string; quiet?: true }
  /** A hidden place / room / character was exposed — to everyone (`person`
   *  null) or to one participant (`reveal X for who`). `quiet` (wave 18b):
   *  `reveal X quietly` — the room opens, the chat posts no "📂 … is open
   *  now." notice. */
  | { type: "revealed"; target: string; kind: "location" | "channel" | "character"; person: string | null; quiet?: true }
  | { type: "scanned"; scanner: string; person: string }
  | { type: "captured"; person: string; location: string; by: string | null }
  | { type: "released"; person: string; location: string }
  | { type: "escaped"; person: string }
  | { type: "arrived"; person: string; location: string; from: string | null }
  | { type: "cast"; person: string; role: string }
  | { type: "promoted"; person: string; role: string }
  | { type: "worldSet"; path: string; value: string }
  | { type: "relationshipChanged"; subject: string; relation: string; object: string; value: number }
  // `go` / `close` (wave 18, C2): the story's `with go: …, close: 6s` tail —
  // the moment's exit words as written (interpolated), resolved by the chat
  // composer; `close` in ms. Absent when not written. `noAck` (wave 26,
  // C1): `with ack: none` — the big moment has no acknowledge button.
  | { type: "broadcast"; cue: string; audience: string[]; scope: string; go?: string[]; close?: number; noAck?: true }
  // A scripted line. `setting` is the enclosing beat's `setting:` location
  // (inherited through diverts) and `beat` the beat it was spoken in — chat
  // routes an un-addressed line to the setting's room, and the cockpit links
  // any line back to its beat on the story map.
  | {
      type: "dialogue";
      speaker: string;
      text: string;
      audience: string[];
      setting: string | null;
      beat: string | null;
      /** The dialogue block's parenthetical, parens stripped, trimmed (`Truther Download (glitch):` → "glitch"); absent when none. */
      manner?: string;
    }
  // A participant typed a message into a channel. `from` is the display name,
  // `audience` is resolved at send time ("all" or guest ids), `parentSeq` links
  // a reply to its root message (null for a top-level message).
  | { type: "chat"; from: string; channel: string; text: string; audience: "all" | string[]; parentSeq: number | null }
  // A participant was invited into (or left) an authored channel — membership
  // changes for private/group/dm rooms drive who can see + post.
  | { type: "channelInvited"; channel: string; person: string; by: string }
  | { type: "channelLeft"; channel: string; person: string }
  // Speakerless narration — the Narrator's voice. Carries the same room
  // context as `dialogue` so it lands in the setting's channel, not a log.
  | {
      type: "action";
      text: string;
      setting: string | null;
      beat: string | null;
      /** Set when the narration runs inside a `Narrator (manner):` block. */
      manner?: string;
    }
  // `setting`: the enclosing beat's `setting:` location (as on `dialogue`);
  // absent on the structural directives (`fire`, `remove`) and null outside
  // a beat (a story rule) — stagehand's house router plays an unrouted
  // `sound X` there.
  | { type: "directive"; verb: string; args: string; setting?: string | null }
  // `subject` is the participant the beat is playing for (the `guest`
  // binding, else `self` when self is a person) — null for a global beat.
  // Powers per-person story-position tracking in every console.
  | { type: "beatEntered"; beat: string; setting: string | null; subject: string | null }
  // `id` (wave 20, D18): this event's own log index — the menu's id, equal
  // after a restore (a replay records the same log); `options` lists only
  // the options whose guard held (D9). Optional only for hand-built events.
  | { type: "choicePrompted"; person: string | null; promptId: string; options: string[]; id?: number }
  // Wave 28: a participant answered a menu — `id` the menu's (its
  // `choicePrompted` id), `beat` the menu's beat, `text` the option as
  // written. The server posts it as the picker's own `pick` line in the
  // menu's room; recorded before the option's body runs.
  | { type: "chose"; person: string; id: number; beat: string | null; text: string }
  // Wave 28: a docked menu's guarded options were read again after the
  // world changed (a codex entry unlocked mid-talk) and the shown set
  // moved. Same menu, same `id`; `options` is the new shown list. Never a
  // chat line; the views read the menu's options from the sim.
  | { type: "choiceUpdated"; person: string | null; id: number; options: string[] }
  | {
      type: "respond";
      to: string;
      text: string;
      /** The participant bound as the beat's subject when the reply ran
       *  (`subjectAudience(bindings)[0]`), or null — which guest a booth
       *  readout is about. */
      about?: string | null;
      /** `reply "…" with go: …, close: …` (wave 18, C2). */
      go?: string[];
      close?: number;
      /** `reply "…" with …, ack: none` (wave 26, C1): no acknowledge button. */
      noAck?: true;
    }
  // `show <kind> ["text"] [to scope] [with k: v]` — a widget (a game, a
  // picture, a form) the participant app renders in the conversation.
  // `audience` + `scope` mirror `broadcast` (empty audience with a global
  // scope = everyone); `setting` + `beat` mirror `dialogue` so the card
  // lands in the same room as the lines around it.
  | { type: "widget"; widget: string; text: string; params: Record<string, string>; audience: string[]; scope: string; setting: string | null; beat: string | null; go?: string[]; close?: number; noAck?: true }
  | { type: "signal"; name: string; subject: string | null }
  // A codex entry landed in a holder's hands (a person or a character):
  // redeemed from a code, handed over by the story / an operator, or shared
  // by another holder (`from`). Knowledge as a currency (Loom 4 §10.1).
  | { type: "codexUnlocked"; person: string; entry: string; via: "code" | "story" | "share"; from: string | null }
  // A participant typed a code that unlocks nothing.
  | { type: "codexMissed"; person: string; code: string }
  // A step of a participant's quest: handed out (`start`), moved on
  // (`update`), or settled (`complete` / `fail`). `text` is the authored
  // line for the quest's thread (null = the default copy / the brief).
  | { type: "quest"; person: string; quest: string; action: QuestAction; text: string | null }
  // `restrict who [to Place, …]`: the story shrank a participant's app to
  // the named places (+ DMs), read-only, no buttons. `places` is the list
  // the viewer keeps (possibly empty). `unrestrict who` lifts it.
  | { type: "restricted"; person: string; places: string[] }
  | { type: "unrestricted"; person: string }
  // `pin "…" [in room] [for who]`: a sticky notice. `channel` null = the
  // person's own feed (the lobby), else an authored room (`room:x`) or a
  // place (`loc:X`). `key` = the person's id, or "" for a room-wide pin —
  // the client keeps the newest pin per (channel, key) until an `unpin`
  // with the same key. A leading `!` in the text is an alert.
  | { type: "pinned"; text: string; channel: string | null; person: string | null; key: string; go?: string[] }
  | { type: "unpinned"; text: string | null; channel: string | null; person: string | null; key: string }
  // A wallet card for one viewer (a person id, or `@<Character>` for a booth)
  // — emitted by the server's WalletBook, never by the Sim itself; `root`
  // opens the card's thread, else it is a step.
  | { type: "wallet"; to: string; card: WalletCard; root: boolean }
  | { type: "ambient"; source: string; text: string }
  | { type: "tick"; elapsedMs: number }
  | { type: "diagnostic"; message: string };

// --- the wallet card (shared by the server's WalletBook, chat and the play mirror) ---

export type WalletTxState = "pending" | "held" | "settled" | "denied" | "cancelled";

// `grant` = the minter paid one person from the reserve; `freeze` = the
// minter froze one person's coin (`settleAt` = when it thaws).
// `casino` = one bet at the casino terminal (`src/casino.ts`): the card's id
// is the visit (one thread per sitting), its steps `won` / `lost` / `push`.
export type WalletCardKind = "transfer" | "request" | "offer" | "stimulus" | "approval" | "grant" | "freeze" | "casino";

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
  // A held transfer nobody approved, denied or cancelled in time
  // (`HOLD_MS`): it settled on its own, with no `transfer_approved`.
  | "timed_out"
  // The minter's reserve: `granted` (the minter's root) / `received` (the
  // recipient's); a freeze: `frozen` (the target's root) / `imposed` (the
  // minter's), then `thawed` (target) + `expired` (minter) on the clock, or
  // `thawed` + `cancelled` when a director lifts it early.
  | "granted"
  | "frozen"
  | "imposed"
  | "thawed"
  // A casino bet: `won` (paid more than the stake), `lost`, `push` (the stake back).
  | "won"
  | "lost"
  | "push"
  // Wave 18b: a transfer the approver's audit held, as its recipient sees
  // it (the sender's root stays `held`): "flagged for {audit}, must be
  // approved by {approver}".
  | "flagged";

/**
 * One wallet card as a viewer sees it. `kind` + `step` say which side the
 * viewer is on (a `transfer/pending` root is the sender's, a
 * `transfer/received` root the receiver's, an `approval/*` card the
 * approver's). `id` (`t12` / `r3` / `o7` / `s1`) is the thread key per viewer.
 */
export interface WalletCard {
  kind: WalletCardKind;
  id: string;
  step: WalletStep;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
  /** The unit — `CurrencyDef.name`. */
  unit: string;
  side?: "buy" | "sell";
  /** Codex entry id + title, on an offer. */
  entry?: string;
  entryTitle?: string;
  /** Story ms — the countdown on pending / approval cards. */
  settleAt?: number;
  /** Who approved / denied / cancelled (a character id or `Director`). */
  by?: string;
  /** An open 🙏 request closed by someone other than its asker — a
   *  director's cancel — as a display name. Distinct from `by`, which on a
   *  request card names who stopped the request's *payment*; with neither,
   *  the asker withdrew it. */
  closedBy?: string;
  /** The approver's display name, on a card that waits on them (wave 18b:
   *  the approver's `as <name>` when the story gives one). */
  approver?: string;
  /** Wave 18b: the approver's `audit <phrase>` ("a CRA audit"), on a
   *  `held` / `flagged` transfer card, when the story gives one. */
  audit?: string;
  /** A casino bet: the game's title, the pick's label, the roll in words
   *  (`7 ★ ★`) and everything it paid back (the stake included). */
  game?: string;
  pick?: string;
  roll?: string;
  payout?: number;
}

/** The event the book emits per card — `to` is a person id or `@<Character>`. */
export interface WalletEvent {
  type: "wallet";
  to: string;
  card: WalletCard;
  root: boolean;
}

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Compile-time guard: the `SimEventType` enum and the union's `type`
 *  discriminants match 1:1 — adding an event to one side without the
 *  other fails right here. */
export const SIM_EVENT_TYPES_MATCH: MutuallyAssignable<SimEvent["type"], SimEventType> = true;

/** Append-only event log with the queries the rule engine + app need. */
export class SimLog {
  private events: SimEvent[] = [];

  push(event: SimEvent): number {
    this.events.push(event);
    return this.events.length - 1;
  }

  all(): readonly SimEvent[] {
    return this.events;
  }

  len(): number {
    return this.events.length;
  }

  /** Envelopes appended at or after `from` (the app polls this slice). */
  since(from: number): SimEvent[] {
    return this.events.slice(from);
  }

  /** Count of events satisfying `pred`. */
  count(pred: (e: SimEvent) => boolean): number {
    let n = 0;
    for (const e of this.events) if (pred(e)) n += 1;
    return n;
  }

  /** Most recent event satisfying `pred`, or null. */
  last(pred: (e: SimEvent) => boolean): SimEvent | null {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (pred(this.events[i]!)) return this.events[i]!;
    }
    return null;
  }
}
