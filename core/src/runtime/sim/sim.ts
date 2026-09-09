//! The ecosystem simulation driver.
//!
//! Holds the world state, the event log, and the live population, and
//! advances the world by ingesting external events (account creation,
//! QR scans, faction joins) and draining the reactive hook engine to a
//! fixpoint. See `DESIGN.md`.

import type { Beat, BodyItem, DivertTarget } from "../../parser/index.ts";
import {
  CallArg,
  ExprError,
  VNULL,
  World,
  asNumber,
  display,
  evaluate,
  expandPath,
  parseExpr,
  truthy,
  vBool,
  vList,
  vNumber,
  vString,
  type Bindings,
  type Value,
} from "../expr.ts";
import { SimLog, type SimEvent } from "./event.ts";
import { DEFAULT_SPACE_ID, compileModel, type ChannelDef, type Hook, type SimModel } from "./model.ts";
import { routesCue } from "./channel-types.ts";
import { parseSet, splitDirective, splitKeyword } from "./effects.ts";
import { Bundle, type LoomFileEntry } from "../bundle.ts";
import { parse } from "../../parser/index.ts";
import { foldName } from "../../parser/names.ts";
import { splitTopLevelCommas, stripPrefix } from "../../parser/rust.ts";

export interface Person {
  id: string;
  name: string;
  role: string;
}

/** A per-viewer channel snapshot. `kind` is wider than the authored
 *  `ChannelKindWord` — derived rooms add `"location"` (and the projections
 *  add `"lobby"`/`"faction"`), so views carry it as a plain string. */
export interface ChannelView {
  id: string;
  kind: string;
  title: string;
  spaceId: string;
  member: boolean;
  canPost: boolean;
  threadable: boolean;
}

/** A queued hook-firing request produced by an event. */
interface Trigger {
  verb: string;
  subject: string;
  /** The scanner for `scan` triggers (only its hooks fire). */
  scanner: string | null;
  /**
   * The character that performed a named event (a performer's declared
   * INTERACTION): only *that* character's hooks fire; role hooks and story
   * rules fire as usual.
   */
  actor?: string;
  /** Entity filter the event carries (joined faction, …). */
  filter: string | null;
  /** Named arguments (`fire alarm with level: 3`), bound in hook bodies. */
  args?: Map<string, Value>;
  /** Arguments that name an entity (`who: guest`) — bound as ids, like a param. */
  argIds?: Map<string, string>;
  /** Assigned at `fire()` — scopes the world keys the arguments live under. */
  seq?: number;
}

/** One frame of the explicit executor stack — a body + cursor + scope. */
interface Frame {
  items: BodyItem[];
  index: number;
  bindings: Bindings;
  /**
   * The speaker whose block this frame (and its control-flow children) runs
   * under, if any. When set, bare `action` text is emitted as this speaker's
   * spoken line instead of narration — that's all "dialogue" means here.
   */
  speaker?: string;
  /**
   * The current beat's first `cast:` member — the `SELF`/`ME` fallback when no
   * `self` is bound (a beat played with no router). Set on beat entry,
   * inherited by control-flow children.
   */
  cast?: string;
  /**
   * The enclosing beat's `setting:` location — where this frame's lines are
   * "happening". Inherited by control-flow children; a divert swaps to the
   * target beat's own setting (or keeps the caller's when it declares none),
   * so an un-addressed line routes to the setting's room instead of vanishing.
   */
  setting?: string;
  /** The beat this frame's items belong to (provenance on emitted lines). */
  beat?: string;
}

/**
 * A live choice awaiting a participant's decision. `continuation` is a
 * snapshot of the entire work stack at the suspension point, so picking
 * an option resumes everything that was pending — not just the option
 * body — in the right order across nested beats/hooks.
 */
interface PendingChoice {
  options: Array<{ text: string; body: BodyItem[] }>;
  bindings: Bindings;
  continuation: Frame[];
}

/** Strip surrounding double-quotes from an operator-typed value. */
function bareText(text: string): string {
  const t = text.trim();
  const m = /^"(.*)"$/su.exec(t);
  return m !== null ? m[1]! : t;
}

/** Parse an operator-typed value into a `Value`: `true`/`false` → bool,
 *  a finite numeral → number, else a (possibly quoted) string. */
function parseVarText(text: string): Value {
  const t = text.trim();
  if (t === "true") return vBool(true);
  if (t === "false") return vBool(false);
  const n = Number(t);
  if (t !== "" && Number.isFinite(n)) return vNumber(n);
  return vString(bareText(t));
}

/** A beat's first `cast:` member (the SELF fallback), or undefined. */
function firstCastMember(beat: Beat): string | undefined {
  const cast = beat.contract.get("cast")?.value;
  if (cast === undefined) return undefined;
  const first = cast.split(",")[0]?.trim();
  return first !== undefined && first.length > 0 ? first : undefined;
}

/** A beat's `setting:` location (the room its lines land in), or undefined. */
function beatSetting(beat: Beat): string | undefined {
  const s = beat.contract.get("setting")?.value.trim();
  return s !== undefined && s.length > 0 ? s : undefined;
}

export class Sim {
  readonly world = new World();
  readonly log = new SimLog();
  readonly model: SimModel;
  readonly persons = new Map<string, Person>();

  private membership = new Map<string, Set<string>>();
  private occupants = new Map<string, Set<string>>();
  /** Runtime members of authored private/group/dm channels (by channel id). */
  private channelMembers = new Map<string, Set<string>>();
  /** Story-clock time of each sender's last message per channel (slow mode). */
  private lastChatAt = new Map<string, number>();
  private pending: Trigger[] = [];
  private beatVisits = new Map<string, number>();
  /** Each participant's current story position (last beat entered for them). */
  private lastBeat = new Map<string, string>();
  private revealed = new Set<string>();
  private pendingChoices = new Map<string, PendingChoice[]>();
  private currentBindings: Bindings = new Map();
  private elapsedMs = 0;
  private genState = new Map<string, number>();
  private genCursor = new Map<string, number>();
  private timerState = new Map<Hook, number>();
  private timerFired = new Set<Hook>();
  /** Last observed truth of each watcher, per subject (edge detection). */
  private watcherState = new Map<string, boolean>();
  /** `cycle` cursors per site + subject. */
  private varietyState = new Map<string, number>();
  /** Per-fire counter scoping event-argument world keys. */
  private fireSeq = 0;

  constructor(model: SimModel) {
    this.model = model;
    // Seed every entity id as its own identity string so barewords read
    // naturally in expressions (`guest.faction == Chatters`).
    for (const id of model.entityKind.keys()) {
      this.world.set(id, vString(id));
      this.world.addAlias(id);
    }
    for (const [id, def] of model.factions) {
      this.membership.set(id, new Set());
      this.syncFaction(id);
      // Faction politics is readable state, not dead metadata.
      if (def.ethos !== null) this.world.set(`${id}.ethos`, vString(def.ethos));
      if (def.rival !== null) this.world.set(`${id}.rival`, vString(def.rival));
      this.world.set(`${id}.hidden`, vBool(def.hidden));
      this.world.set(`${id}.revealed`, vBool(false));
    }
    for (const l of model.locations.keys()) {
      this.occupants.set(l, new Set());
      this.syncLocation(l);
    }
    // A character's own faction must be in the world so `self.faction`
    // and `guest.faction == self.faction` resolve.
    for (const char of model.characters.values()) {
      if (char.faction !== null) this.world.set(`${char.id}.faction`, vString(char.faction));
      // Typed-slot defaults (`captures: 0 to 100 = 0`) so `self.captures`
      // starts defined, not implicitly-zero on first `+=`.
      for (const [k, v] of char.defaults) this.world.set(`${char.id}.${k}`, v);
    }
    this.world.setCollection("Persons", vList([]));
    // Seed declared members of membership-gated channels (private/group/dm).
    for (const ch of model.channels.values()) {
      if (ch.kind === "private" || ch.kind === "group" || ch.kind === "dm") {
        this.channelMembers.set(ch.id, new Set(ch.members));
      }
    }
  }

  /** Build a `Sim` from `.loom` sources (one entry per file). */
  static fromSources(...sources: Array<string | { path: string; source: string }>): Sim {
    const bundle = new Bundle();
    sources.forEach((s, i) => {
      const source = typeof s === "string" ? s : s.source;
      const path = typeof s === "string" ? `f${i}.loom` : s.path;
      const [file, diagnostics] = parse(source);
      const stem = path.replace(/\.loom$/u, "").split("/").pop() ?? path;
      const entry: LoomFileEntry = { path, stem, qualifier: "", source, file, diagnostics };
      bundle.files.push(entry);
    });
    return new Sim(compileModel(bundle));
  }

  // -------------------------------------------------------------------
  // Input API — what the app / props / actors call
  // -------------------------------------------------------------------

  /** A party-goer creates an account at the door. */
  createPerson(id: string, name: string, role?: string): SimEvent[] {
    const from = this.log.len();
    const roleId = role ?? this.model.defaultRole ?? "Guest";
    this.persons.set(id, { id, name, role: roleId });
    this.world.set(id, vString(id));
    this.world.addAlias(id);
    this.world.set(`${id}.name`, vString(name));
    this.world.set(`${id}.role`, vString(roleId));
    this.model.entityKind.set(id, "person");
    const def = this.model.roles.get(roleId);
    if (def !== undefined) {
      for (const [k, v] of def.defaults) this.world.set(`${id}.${k}`, v);
    }
    this.syncPersons();
    this.seedRelationships(id, roleId);
    this.record({ type: "accountCreated", person: id, name, role: roleId });
    this.fire({ verb: "account_created", subject: id, scanner: null, filter: null });
    this.drain();
    return this.log.since(from);
  }

  /** A party-goer joins (or is moved into) a faction. */
  join(person: string, faction: string): SimEvent[] {
    const from = this.log.len();
    this.setFaction(person, faction);
    this.record({ type: "joined", person, faction });
    this.fire({ verb: "join", subject: person, scanner: null, filter: faction });
    this.drain();
    return this.log.since(from);
  }

  /** A party-goer defects from their current faction to another. */
  defect(person: string, to: string): SimEvent[] {
    const from = this.log.len();
    const prior = this.factionOf(person);
    if (prior !== null) this.membership.get(prior)?.delete(person);
    if (prior !== null) this.syncFaction(prior);
    this.setFaction(person, to);
    this.record({ type: "defected", person, from: prior, to });
    this.fire({ verb: "defect", subject: person, scanner: null, filter: to });
    this.drain();
    return this.log.since(from);
  }

  /** An official character or prop scans a party-goer's QR code. */
  scan(scanner: string, person: string): SimEvent[] {
    const from = this.log.len();
    this.record({ type: "scanned", scanner, person });
    this.fire({ verb: "scan", subject: person, scanner, filter: null });
    this.drain();
    return this.log.since(from);
  }

  /** A party-goer physically moves to a location. */
  arrive(person: string, location: string): SimEvent[] {
    const from = this.log.len();
    const prior = this.locationOf(person);
    this.setLocation(person, location);
    this.record({ type: "arrived", person, location, from: prior });
    this.fire({ verb: "arrive", subject: person, scanner: null, filter: location });
    this.drain();
    return this.log.since(from);
  }

  /**
   * A generic external signal fires every `when <name>` hook. `args`
   * (JSON scalars — the journal replays them) bind by name in hook bodies,
   * exactly like `fire name with k: v` (Loom 4 §9.2).
   */
  signal(
    name: string,
    subject?: string,
    args?: Record<string, string | number | boolean> | null,
    actor?: string | null,
  ): SimEvent[] {
    const from = this.log.len();
    this.record({ type: "signal", name, subject: subject ?? null });
    let values: Map<string, Value> | undefined;
    let argIds: Map<string, string> | undefined;
    if (args && typeof args === "object") {
      values = new Map();
      argIds = new Map();
      for (const [k, v] of Object.entries(args)) {
        // A string naming a participant / entity binds as that id.
        if (typeof v === "string" && (this.persons.has(v) || this.model.entityKind.has(v))) argIds.set(k, v);
        else values.set(k, typeof v === "number" ? vNumber(v) : typeof v === "boolean" ? vBool(v) : vString(String(v)));
      }
    }
    this.fire({
      verb: name,
      subject: subject ?? "",
      scanner: null,
      filter: null,
      args: values,
      argIds,
      actor: actor ? actor : undefined,
    });
    this.drain();
    return this.log.since(from);
  }

  /** A party-goer escapes the prison (or any captured state). */
  escape(person: string): SimEvent[] {
    const from = this.log.len();
    this.doEscape(person);
    this.drain();
    return this.log.since(from);
  }

  /**
   * An operator/admin captures a guest directly (scanner-less moderation),
   * routing through the same idempotent logic as the `<capture:>` directive.
   * `by` is null since no character is attributed.
   */
  capture(person: string): SimEvent[] {
    const from = this.log.len();
    this.runCapture(person, new Map());
    this.drain();
    return this.log.since(from);
  }

  /**
   * An operator sets a person's score directly — live tuning / moderation
   * from the run panel, the scanner-less twin of a `<set: g.score = N>`
   * directive. Journalled like every other mutation, so it replays exactly.
   */
  setScore(person: string, value: number): SimEvent[] {
    const from = this.log.len();
    const n = Number.isFinite(value) ? value : 0;
    this.world.set(`${person}.score`, vNumber(n));
    this.record({ type: "worldSet", path: `${person}.score`, value: String(n) });
    this.drain();
    return this.log.since(from);
  }

  /**
   * An operator writes ANY world variable directly — the director's
   * debugger write, behind the World browser's inline editing. The
   * person-shaped standard fields route through the proper mutators
   * (arrive / join / capture / escape / setScore) so occupancy +
   * membership bookkeeping stays in sync and the right hooks fire;
   * everything else parses the display text (number / bool / string)
   * and lands as a `worldSet`, then drains. Journaled + deterministic.
   */
  setVar(path: string, value: string): SimEvent[] {
    const dot = path.indexOf(".");
    const head = dot > 0 ? path.slice(0, dot) : path;
    const tail = dot > 0 ? path.slice(dot + 1) : "";
    if (this.persons.has(head)) {
      switch (tail) {
        case "location":
          return this.arrive(head, bareText(value));
        case "faction":
          return this.join(head, bareText(value));
        case "captured":
          return bareText(value) === "true" ? this.capture(head) : this.escape(head);
        case "score":
          return this.setScore(head, Number(bareText(value)));
      }
    }
    const from = this.log.len();
    const v = parseVarText(value);
    this.world.set(path, v);
    this.record({ type: "worldSet", path, value: display(v) });
    const segs = path.split(".");
    if (segs.length === 3) {
      this.record({
        type: "relationshipChanged",
        subject: segs[0]!,
        relation: segs[1]!,
        object: segs[2]!,
        value: asNumber(v) ?? 0,
      });
    }
    this.drain();
    return this.log.since(from);
  }

  /**
   * An operator fires a scripted beat directly (spec §13.4 booth live-patch):
   * inject a named story beat mid-event without waiting for a hook to divert
   * into it. An owner-qualified key (`Owner.beat`) rebinds `self` so the beat's
   * `SELF` speaker + `self.x` reads resolve as the owner; a `subject` guest,
   * when given, is bound as `guest` so a per-guest beat targets one person.
   */
  fireBeat(name: string, subject?: string): SimEvent[] {
    const from = this.log.len();
    const bindings: Bindings = new Map();
    const dot = name.indexOf(".");
    if (dot > 0) bindings.set("self", name.slice(0, dot));
    // Truthy check (not `!== undefined`): the journal round-trips a missing
    // arg through JSON as `null`, and `null !== undefined` would then throw on
    // `.length` during replay, silently dropping the beat + desyncing chat seqs.
    if (subject) bindings.set("guest", subject);
    this.playBeat(name, bindings);
    this.drain();
    return this.log.since(from);
  }

  /**
   * An operator exposes a hidden faction (the secret-villain reveal), the
   * scanner-less twin of a `<reveal:>` directive. Idempotent — re-revealing is
   * a no-op — and journaled, so it replays deterministically.
   */
  reveal(faction: string): SimEvent[] {
    const from = this.log.len();
    this.doReveal(faction);
    this.drain();
    return this.log.since(from);
  }

  /**
   * Advance the autonomous clock by `dtMs`: update `Time.*`, fire due
   * ambient generators and time-driven hooks, then drain. Pure-reactive
   * scenarios never need to call this; a timed one (escalating threat,
   * ambient barks) wants a steady tick from the host (the server ticks
   * once a second while the doors are open).
   */
  tick(dtMs: number): SimEvent[] {
    const from = this.log.len();
    this.elapsedMs += Math.max(0, dtMs);
    this.world.set("Time.elapsed", vNumber(Math.floor(this.elapsedMs / 1000)));
    this.world.set("Time.minute", vNumber(Math.floor(this.elapsedMs / 60000)));

    // Ambient generators emit a bark per interval, cycled deterministically.
    for (const g of this.model.gens) {
      let last = this.genState.get(g.id) ?? 0;
      let guard = 0;
      while (this.elapsedMs >= last + g.intervalMs && guard++ < 1000) {
        last += g.intervalMs;
        const cursor = this.genCursor.get(g.id) ?? 0;
        this.genCursor.set(g.id, cursor + 1);
        this.record({ type: "ambient", source: g.id, text: g.barks[cursor % g.barks.length]! });
      }
      this.genState.set(g.id, last);
    }

    // Time-driven character hooks (self = the owning character).
    for (const hook of this.model.timerHooks) {
      const t = hook.timer!;
      if (t.mode === "every") {
        let last = this.timerState.get(hook) ?? 0;
        let guard = 0;
        while (this.elapsedMs >= last + t.ms && guard++ < 1000) {
          last += t.ms;
          this.exec([{ items: hook.body, index: 0, bindings: timerBindings(hook) }]);
        }
        this.timerState.set(hook, last);
      } else if (!this.timerFired.has(hook) && this.elapsedMs >= t.ms) {
        this.timerFired.add(hook);
        this.exec([{ items: hook.body, index: 0, bindings: timerBindings(hook) }]);
      }
    }

    this.drain();
    return this.log.since(from);
  }

  /** Story-clock elapsed, in milliseconds. */
  elapsed(): number {
    return this.elapsedMs;
  }

  /**
   * A party-goer secretly switches true allegiance while keeping their
   * displayed faction — a double agent (spec: defect vs. betray).
   */
  betray(person: string, secret: string): SimEvent[] {
    const from = this.log.len();
    this.doBetray(person, secret);
    this.drain();
    return this.log.since(from);
  }

  /** A live participant answers their oldest pending choice (by index). */
  choose(person: string, index: number): SimEvent[] {
    const from = this.log.len();
    const queue = this.pendingChoices.get(person);
    if (queue !== undefined && queue.length > 0) {
      const pc = queue[0]!;
      const opt = pc.options[index];
      // Validate before consuming, so a fat-fingered index can't destroy
      // the prompt — the participant can retry.
      if (opt !== undefined) {
        queue.shift();
        if (queue.length === 0) this.pendingChoices.delete(person);
        // Resume the selected option, then the full saved continuation.
        // Every frame field has to survive the round trip: dropping
        // `speaker` silently demotes a post-choice dialogue line to
        // narration, and dropping `setting` / `beat` loses the room the
        // line routes to and its story-map provenance.
        const stack: Frame[] = pc.continuation.map((f) => ({ ...f }));
        // The option body is a control-flow child of the frame the menu
        // was in — the top of the snapshot — so it inherits that scope,
        // exactly like an `<if:>` arm nested in the same place would.
        const host = stack[stack.length - 1];
        stack.push({
          items: opt.body,
          index: 0,
          bindings: pc.bindings,
          speaker: host?.speaker,
          cast: host?.cast,
          setting: host?.setting,
          beat: host?.beat,
        });
        this.exec(stack);
      }
    }
    this.drain();
    return this.log.since(from);
  }

  /**
   * A participant types a message into a channel (hybrid chat). Journaled as
   * a `chat` event so it replays deterministically alongside the story.
   * `from` is the sender's id (a guest) or character name (a performer); the
   * event stores the display name. `audience` may be given explicitly (the
   * server resolves a performer's per-guest thread); otherwise it's derived
   * from the channel at send time. No access enforcement in this slice — the
   * channel-type registry will own who-may-post later.
   */
  say(
    from: string,
    channel: string,
    text: string,
    parentSeq: number | null = null,
    audience?: "all" | string[],
  ): SimEvent[] {
    const start = this.log.len();
    const aud = audience ?? this.chatAudience(channel, from);
    this.record({ type: "chat", from: this.chatDisplayName(from), channel, text, audience: aud, parentSeq });
    this.lastChatAt.set(`${channel} ${from}`, this.elapsedMs); // slow-mode clock
    this.drain();
    return this.log.since(start);
  }

  /** A channel's slow-mode window (ms), or null. */
  slowModeMsOf(id: string): number | null {
    return this.model.channels.get(id)?.rules.slowModeMs ?? null;
  }
  /** A channel's ephemeral lifetime (ms) after which messages expire, or null. */
  ephemeralMsOf(id: string): number | null {
    return this.model.channels.get(id)?.rules.ephemeralMs ?? null;
  }
  /** Story-clock ms `from` must still wait before posting to `channel` again. */
  slowModeRemainingMs(from: string, channel: string): number {
    const slow = this.slowModeMsOf(channel);
    if (slow === null || slow <= 0) return 0;
    const last = this.lastChatAt.get(`${channel} ${from}`);
    if (last === undefined) return 0;
    return Math.max(0, slow - (this.elapsedMs - last));
  }

  /** A chat sender's display name: a guest's registered name, else the id. */
  private chatDisplayName(from: string): string {
    return this.persons.get(from)?.name ?? from;
  }

  /** Default recipients for a typed message, by channel kind, at send time. */
  private chatAudience(channel: string, sender: string): "all" | string[] {
    const def = this.model.channels.get(channel);
    if (def !== undefined) {
      if (def.kind === "open") return "all";
      if (def.kind === "faction") return def.faction ? this.factionMembers(def.faction) : "all";
      return [...(this.channelMembers.get(channel) ?? [])]; // private / group / dm
    }
    if (channel.startsWith("faction:")) return this.factionMembers(channel.slice("faction:".length));
    // A guest's DM with a character: only that guest sees it on the guest side;
    // the performer sees it via the guest thread (audience includes the id).
    if (channel.startsWith("dm:")) return this.persons.has(sender) ? [sender] : "all";
    // Typed chat in a location room is heard by whoever is present when it's
    // said (+ the sender). Story narration routed here is "all" instead — the
    // stage voice carries; see composeGuestMessages.
    if (channel.startsWith("loc:")) {
      const occ = this.occupants.get(channel.slice("loc:".length));
      if (occ === undefined) return "all";
      const aud = new Set(occ);
      if (this.persons.has(sender)) aud.add(sender);
      return [...aud];
    }
    return "all"; // lobby + open rooms
  }

  // -------------------------------------------------------------------
  // Authored channels (SPACE / CHANNEL) — membership + access
  // -------------------------------------------------------------------

  /** Channel head for routing a message — authored channels first, else derived. */
  channelHead(id: string): { channel: string; channelKind: string; title: string; spaceId: string } {
    const def = this.model.channels.get(id);
    if (def !== undefined) {
      return { channel: id, channelKind: def.kind, title: def.title, spaceId: def.spaceId };
    }
    if (id.startsWith("faction:")) {
      const f = id.slice("faction:".length);
      return { channel: id, channelKind: "faction", title: `#${f.toLowerCase()}`, spaceId: DEFAULT_SPACE_ID };
    }
    if (id.startsWith("dm:")) {
      return { channel: id, channelKind: "dm", title: id.slice("dm:".length), spaceId: DEFAULT_SPACE_ID };
    }
    if (id.startsWith("loc:")) {
      const l = id.slice("loc:".length);
      const def = this.model.locations.get(l);
      if (def !== undefined) {
        return { channel: id, channelKind: "location", title: def.label ?? l, spaceId: DEFAULT_SPACE_ID };
      }
    }
    return { channel: id, channelKind: "lobby", title: this.lobbyTitle(), spaceId: DEFAULT_SPACE_ID };
  }

  /** The derived room id for a location (`loc:<Location>`). */
  static locationChannel(location: string): string {
    return `loc:${location}`;
  }

  /** Is `person` a member of an authored membership-gated channel? */
  isChannelMember(person: string, id: string): boolean {
    return this.channelMembers.get(id)?.has(person) ?? false;
  }

  /** Can `person` see an authored channel? open → all; faction → its members;
   *  private/group/dm → explicit members. Location rooms are open — the stage
   *  feed is part of the show. Unknown channels are not visible. */
  canSeeChannel(person: string, id: string): boolean {
    if (id.startsWith("loc:")) return this.model.locations.has(id.slice("loc:".length));
    const def = this.model.channels.get(id);
    if (def === undefined) return false;
    if (def.kind === "open") return true;
    if (def.kind === "faction") return def.faction !== null && this.factionMembers(def.faction).includes(person);
    return this.isChannelMember(person, id);
  }

  /** Channel-behaviour queries driven by the resolved rules bundle. */
  threadableOf(id: string): boolean {
    const def = this.model.channels.get(id);
    return def === undefined ? true : def.rules.threadable; // derived channels thread
  }

  /** May `person` post into a channel? Derived channels stay open; authored
   *  channels honour their post policy (everyone / members / faction / none /
   *  role). Visibility is a precondition. */
  canPost(person: string, id: string): boolean {
    // A location room takes posts only from whoever is standing in it
    // (operator surfaces bypass this, as they do for authored rooms).
    if (id.startsWith("loc:")) return this.occupants.get(id.slice("loc:".length))?.has(person) ?? false;
    const def = this.model.channels.get(id);
    if (def === undefined) return true; // lobby / faction: / dm: are open to post
    if (!this.canSeeChannel(person, id)) return false;
    const p = def.rules.post;
    switch (p.kind) {
      case "everyone":
        return true;
      case "members":
        return this.isChannelMember(person, id);
      case "faction":
        return def.faction !== null && this.factionMembers(def.faction).includes(person);
      case "none":
        return false;
      case "role":
        return this.persons.get(person)?.role === p.role;
    }
  }

  /** Authored channels a broadcast `cue` mirrors into (routing rule). */
  routedChannelsFor(cue: string): Array<{ channel: string; channelKind: string; title: string; audience: "all" | string[] }> {
    const out: Array<{ channel: string; channelKind: string; title: string; audience: "all" | string[] }> = [];
    for (const def of this.model.channels.values()) {
      if (routesCue(def.rules, cue)) {
        out.push({ channel: def.id, channelKind: def.kind, title: def.title, audience: this.channelAudience(def.id) });
      }
    }
    return out;
  }

  /** A per-viewer channel snapshot (visibility + membership + can-post + threads). */
  private snapshot(person: string, def: ChannelDef, canPost: boolean): ChannelView {
    return {
      id: def.id,
      kind: def.kind,
      title: def.title,
      spaceId: def.spaceId,
      member: this.isChannelMember(person, def.id),
      canPost,
      threadable: def.rules.threadable,
    };
  }

  /** Derived location-room snapshot: `member`/`canPost` mean "is the viewer
   *  standing there" (`operator` forces canPost for booth surfaces). */
  private locationSnapshots(person: string, operator: boolean): ChannelView[] {
    return [...this.model.locations.values()].map((l) => {
      const present = this.occupants.get(l.id)?.has(person) ?? false;
      return {
        id: Sim.locationChannel(l.id),
        kind: "location",
        title: l.label ?? l.id,
        spaceId: DEFAULT_SPACE_ID,
        member: present,
        canPost: operator || present,
        threadable: true,
      };
    });
  }

  /** The channels a person can see — authored rooms they have access to, plus
   *  every location room (the stage feed) — as flat snapshots for the view. */
  visibleChannelsFor(person: string): ChannelView[] {
    const out: ChannelView[] = [];
    for (const def of this.model.channels.values()) {
      if (!this.canSeeChannel(person, def.id)) continue;
      out.push(this.snapshot(person, def, this.canPost(person, def.id)));
    }
    return [...this.locationSnapshots(person, false), ...out];
  }

  /** Every authored + location channel (operator/performer view — they run
   *  every room, so they may post everywhere regardless of post policy). */
  allChannelsFor(person: string): ChannelView[] {
    return [
      ...this.locationSnapshots(person, true),
      ...[...this.model.channels.values()].map((def) => this.snapshot(person, def, true)),
    ];
  }

  /** The authored spaces (for the client to title sidebar sections). */
  spaceList(): Array<{ id: string; title: string }> {
    return [...this.model.spaces.values()].map((s) => ({ id: s.id, title: s.title }));
  }

  /** The lobby is named after the story (Loom 4 §11) — never a baked-in brand. */
  lobbyTitle(): string {
    return this.model.title ?? "Lobby";
  }

  /**
   * The invite roster for `person`: only people they already share a
   * private-ish space with — faction-mates, plus co-members of any
   * membership-gated authored channel they belong to. This is deliberately
   * NOT the whole guest list (open rooms don't count), so a participant's
   * name isn't exposed to strangers. Tune the policy here to loosen/tighten.
   */
  rosterFor(person: string): Array<{ id: string; name: string }> {
    const ids = new Set<string>();
    const fac = this.factionOf(person);
    if (fac !== null) for (const m of this.factionMembers(fac)) ids.add(m);
    for (const def of this.model.channels.values()) {
      if (def.kind === "open") continue;
      if (def.kind === "faction") {
        if (def.faction !== null && this.factionMembers(def.faction).includes(person)) {
          for (const m of this.factionMembers(def.faction)) ids.add(m);
        }
      } else if (this.isChannelMember(person, def.id)) {
        for (const m of this.channelMembers.get(def.id) ?? []) ids.add(m);
      }
    }
    ids.delete(person);
    return [...ids].filter((id) => this.persons.has(id)).map((id) => ({ id, name: this.persons.get(id)!.name }));
  }

  /** Current recipients of a channel — for routing system notices. */
  channelAudience(id: string): "all" | string[] {
    return this.chatAudience(id, "");
  }

  /** Add a participant to a membership-gated channel (invite-based access). */
  inviteToChannel(by: string, person: string, channel: string): SimEvent[] {
    const start = this.log.len();
    const def = this.model.channels.get(channel);
    if (def !== undefined && def.kind !== "open" && def.kind !== "faction") {
      let set = this.channelMembers.get(channel);
      if (set === undefined) {
        set = new Set();
        this.channelMembers.set(channel, set);
      }
      if (!set.has(person)) {
        set.add(person);
        this.record({ type: "channelInvited", channel, person, by });
      }
    }
    this.drain();
    return this.log.since(start);
  }

  /** Remove a participant from a membership-gated channel. */
  leaveChannel(person: string, channel: string): SimEvent[] {
    const start = this.log.len();
    const set = this.channelMembers.get(channel);
    if (set !== undefined && set.delete(person)) {
      this.record({ type: "channelLeft", channel, person });
    }
    this.drain();
    return this.log.since(start);
  }

  /** The oldest outstanding choice's options for a person, if any. */
  pendingChoiceFor(person: string): string[] | null {
    const queue = this.pendingChoices.get(person);
    return queue !== undefined && queue.length > 0 ? queue[0]!.options.map((o) => o.text) : null;
  }

  /** Every outstanding choice's options, keyed by person id (`__global`
   *  for unbound menus) — the operator mirror of `pendingChoiceFor`, so
   *  the run panel can see (and answer) a stuck decision. */
  allPendingChoices(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [person, queue] of this.pendingChoices) {
      if (queue.length > 0) out[person] = queue[0]!.options.map((o) => o.text);
    }
    return out;
  }

  /**
   * The faction the app should *show* for a person — hidden factions
   * read as `null` until revealed (the secret-villain mechanic).
   */
  publicFactionOf(person: string): string | null {
    const f = this.factionOf(person);
    if (f === null) return null;
    const def = this.model.factions.get(f);
    if (def !== undefined && def.hidden && !this.revealed.has(f)) return null;
    return f;
  }

  factionRevealed(faction: string): boolean {
    return this.revealed.has(faction);
  }
  trueFactionOf(person: string): string | null {
    const v = this.world.peek(`${person}.trueFaction`);
    if (v !== null && v.kind === "string") return v.value;
    return this.factionOf(person);
  }

  // -------------------------------------------------------------------
  // Read helpers (the app's view of a person)
  // -------------------------------------------------------------------

  /** The person's true faction (engine view). The app should call
   *  `publicFactionOf`, which masks hidden factions until revealed. */
  factionOf(person: string): string | null {
    const v = this.world.peek(`${person}.faction`);
    return v !== null && v.kind === "string" ? v.value : null;
  }
  locationOf(person: string): string | null {
    const v = this.world.peek(`${person}.location`);
    return v !== null && v.kind === "string" ? v.value : null;
  }
  isCaptured(person: string): boolean {
    return truthy(this.world.get(`${person}.captured`));
  }
  scoreOf(person: string): number {
    return asNumber(this.world.get(`${person}.score`)) ?? 0;
  }
  factionMembers(faction: string): string[] {
    return [...(this.membership.get(faction) ?? [])];
  }
  /** Resolve a broadcast scope (`faction(Mods)`, …) to person ids. */
  audienceFor(scope: string): string[] {
    return this.resolveScope(scope, new Map());
  }

  // -------------------------------------------------------------------
  // Drain loop
  // -------------------------------------------------------------------

  private fire(trigger: Trigger): void {
    if (trigger.args !== undefined && trigger.args.size > 0) {
      // Event arguments (Loom 4 §9.2): each lives under a per-fire world key
      // that the hook's bindings alias, so `{level}` / `level > 2` / `set`
      // all reach it. Kept for the life of the sim (a choice inside the
      // hook may resume later); hidden from `worldEntries()`.
      trigger.seq = this.fireSeq++;
      for (const [k, v] of trigger.args) this.world.set(`event#${trigger.seq}.${k}`, v);
    }
    this.pending.push(trigger);
  }

  /** Bindings for a hook run, plus the trigger's argument aliases. */
  private withArgs(bindings: Bindings, t: Trigger): Bindings {
    if (t.args === undefined && t.argIds === undefined) return bindings;
    const b = new Map(bindings);
    if (t.argIds !== undefined) for (const [k, id] of t.argIds) if (!b.has(k)) b.set(k, id);
    if (t.args !== undefined && t.seq !== undefined) {
      for (const k of t.args.keys()) if (!b.has(k)) b.set(k, `event#${t.seq}.${k}`);
    }
    return b;
  }

  /**
   * Parse `k: expr, k2: expr` (a `fire … with …` tail). An expression that
   * is a bound name or a declared entity binds as an id (`who: guest` →
   * `who.name` works); anything else is evaluated to a value.
   */
  private parseEventArgs(
    text: string,
    bindings: Bindings,
  ): { args: Map<string, Value>; argIds: Map<string, string> } {
    const args = new Map<string, Value>();
    const argIds = new Map<string, string>();
    for (const chunk of splitTopLevelCommas(text)) {
      const kv = splitOnceColon(chunk.trim());
      if (kv === null) continue;
      const [k, expr] = kv;
      const e = expr.trim();
      const bound = bindings.get(e);
      if (bound !== undefined) argIds.set(k, bound);
      else if (this.model.entityKind.has(e)) argIds.set(k, e);
      else if (this.model.entityIndex.get(e) !== null && !/[\s()<>=!+\-*/]/u.test(e)) {
        argIds.set(k, this.model.entityIndex.get(e)!);
      } else args.set(k, this.evalValue(e, bindings));
    }
    return { args, argIds };
  }

  private drain(): void {
    let guard = 0;
    for (;;) {
      while (this.pending.length > 0) {
        if (guard++ > 10000) {
          this.record({ type: "diagnostic", message: "drain exceeded 10000 cycles (hook loop?)" });
          return; // runaway-cycle backstop
        }
        const trigger = this.pending.shift()!;
        for (const [hook, bindings] of this.matchHooks(trigger)) {
          this.exec([{ items: hook.body, index: 0, bindings: this.withArgs(bindings, trigger) }]);
        }
      }
      // Watchers (Loom 4 §9.1): once every event has settled, evaluate each
      // `when <condition>:` hook and run the ones whose condition has just
      // become true. Their bodies may raise events — loop to a fixpoint.
      if (!this.runWatchers() || guard++ > 10000) break;
    }
  }

  /**
   * Evaluate every condition hook against the world; run each one whose
   * condition is true now and was not on its previous evaluation. A
   * character watcher runs once (`self` = the character); a role watcher
   * runs per participant cast into that role (`self` = the participant).
   * Returns true when at least one body ran.
   */
  private runWatchers(): boolean {
    let fired = false;
    const check = (hook: Hook, self: string): void => {
      const key = `${hook.ownerId}::${hook.event}::${self}`;
      const bindings: Bindings =
        hook.ownerKind === "role"
          ? this.roleBindings(hook.ownerId, self)
          : hook.ownerKind === "story"
            ? new Map()
            : new Map([["self", self]]);
      const now = this.evalCond(hook.condition!, bindings);
      const before = this.watcherState.get(key) ?? false;
      this.watcherState.set(key, now);
      if (now && !before) {
        fired = true;
        this.exec([{ items: hook.body, index: 0, bindings }]);
      }
    };
    for (const char of this.model.characters.values()) {
      for (const hook of char.hooks) {
        if (hook.condition !== null) check(hook, char.id);
      }
    }
    for (const person of this.persons.values()) {
      const role = this.model.roles.get(person.role);
      if (role === undefined) continue;
      for (const hook of role.hooks) {
        if (hook.condition !== null) check(hook, person.id);
      }
    }
    for (const rule of this.model.rules) {
      if (rule.condition !== null) check(rule, "");
    }
    return fired;
  }

  private *matchHooks(t: Trigger): Generator<[Hook, Bindings]> {
    if (t.verb === "scan") {
      if (t.scanner === null) return;
      // The scanner may be a CHARACTER/prop or a Person (peer scan).
      const char = this.model.characters.get(t.scanner);
      if (char !== undefined) {
        for (const hook of char.hooks) {
          if (hook.verb === "scan") yield [hook, this.bindScan(t.scanner, hook, t.subject)];
        }
      }
      const scanner = this.persons.get(t.scanner);
      if (scanner !== undefined) {
        const role = this.model.roles.get(scanner.role);
        if (role !== undefined) {
          for (const hook of role.hooks) {
            if (hook.verb === "scan") yield [hook, this.bindScan(t.scanner, hook, t.subject)];
          }
        }
      }
      return;
    }
    // Role hooks (no param) — `self` is the affected person.
    const person = this.persons.get(t.subject);
    if (person !== undefined) {
      const role = this.model.roles.get(person.role);
      if (role !== undefined) {
        for (const hook of role.hooks) {
          if (hook.timer !== null || hook.condition !== null) continue;
          if (hook.verb !== "scan" && verbMatches(hook.verb, t.verb) && this.filterOk(hook, t)) {
            const bindings = this.roleBindings(role.id, t.subject);
            if (hook.param !== null) bindings.set(hook.param, t.subject);
            yield [hook, bindings];
          }
        }
      }
    }
    // Character reactions. A `param` binds the subject (`on captured
    // guest`); no param is a global cue (`on lockdown`), `self`-only.
    for (const char of this.model.characters.values()) {
      if (t.actor !== undefined && char.id !== t.actor) continue;
      for (const hook of char.hooks) {
        if (hook.timer !== null || hook.condition !== null) continue;
        if (!verbMatches(hook.verb, t.verb) || !this.filterOk(hook, t)) continue;
        if (hook.param !== null) {
          yield [hook, new Map([["self", char.id], [hook.param, t.subject]])];
        } else {
          yield [hook, new Map([["self", char.id]])];
        }
      }
    }
    // Story-level rules (Loom 4 §9.3): no owner, no `self`.
    for (const rule of this.model.rules) {
      if (rule.timer !== null || rule.condition !== null) continue;
      if (!verbMatches(rule.verb, t.verb) || !this.filterOk(rule, t)) continue;
      const b: Bindings = new Map();
      if (rule.param !== null && t.subject.length > 0) b.set(rule.param, t.subject);
      yield [rule, b];
    }
  }

  /**
   * The bindings a ROLE-owned hook runs with: `self` = the participant,
   * plus the role's own name in lowercase (`guest` for `ROLE Guest`), so a
   * beat reached from a role hook reads `guest.x` the same way a beat
   * reached from a scan does.
   */
  private roleBindings(roleId: string, person: string): Bindings {
    const b: Bindings = new Map([["self", person]]);
    const alias = roleId.toLowerCase().replace(/\s+/gu, "_");
    if (alias !== "self") b.set(alias, person);
    return b;
  }

  private filterOk(hook: Hook, t: Trigger): boolean {
    if (hook.filter === null || hook.filter === t.filter) return true;
    // Loose spelling (Loom 4 §3): `at the cellar` matches `LOCATION The Cellar`.
    return t.filter !== null && foldName(hook.filter) === foldName(t.filter);
  }

  private bindScan(scanner: string, hook: Hook, person: string): Bindings {
    return new Map([
      ["self", scanner],
      [hook.param ?? "guest", person],
    ]);
  }

  // -------------------------------------------------------------------
  // Executor — shared by beats and hook bodies
  // -------------------------------------------------------------------

  /**
   * Run a work stack of frames to completion (or until a choice
   * suspends it). Using an explicit stack — rather than the JS call
   * stack — lets a choice snapshot the *entire* continuation so nested
   * beats/hooks resume in order after `choose()`.
   */
  private exec(stack: Frame[]): void {
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      if (frame.index >= frame.items.length) {
        stack.pop();
        continue;
      }
      const item = frame.items[frame.index]!;
      frame.index += 1;
      const b = frame.bindings;
      // Control-flow children inherit the speaker so text nested in an
      // `<if>`/`<match>`/`<each visit>` arm inside a dialogue block stays
      // attributed to that speaker. A divert (below) deliberately does not.
      const sp = frame.speaker;
      const cs = frame.cast; // inherited SELF-fallback for control-flow children
      const st = frame.setting; // inherited room context for emitted lines
      const bt = frame.beat;
      switch (item.kind) {
        case "action":
          if (sp !== undefined) {
            // Spoken line under a speaker. Pure parentheticals "(…)" are
            // delivery notes, not spoken — skip them (prior behavior).
            const t = item.value.value;
            if (!/^\(.*\)$/u.test(t.trim())) {
              this.record({
                type: "dialogue",
                speaker: sp,
                text: this.interpolate(t, b),
                audience: this.subjectAudience(b),
                setting: st ?? null,
                beat: bt ?? null,
              });
            }
          } else {
            this.record({ type: "action", text: this.interpolate(item.value.value, b), setting: st ?? null, beat: bt ?? null });
          }
          break;
        case "sceneHeading":
          this.record({ type: "action", text: this.interpolate(item.value.value, b), setting: st ?? null, beat: bt ?? null });
          break;
        case "metadata":
        case "slotPlaceholder":
          break;
        case "dialogue": {
          // Enter the speaker's block — its body is plain BodyItems, run by
          // this same loop with the speaker in scope. `SELF`/`ME` resolve to
          // whoever `self` is bound to on this frame (the prop whose hook
          // routed here), so a beat needn't restate its owner. `Narrator:`
          // is the stage voice (Loom 4 §4): its lines are narration, so they
          // land in the room like an action line, never in a DM thread.
          const speaker = this.resolveSelfSpeaker(item.value.speaker, b, cs);
          stack.push({
            items: item.value.body,
            index: 0,
            bindings: b,
            speaker: foldName(speaker) === "narrator" ? undefined : speaker,
            cast: cs,
            setting: st,
            beat: bt,
          });
          break;
        }
        case "directive": {
          const variant = this.varietyLine(item.value.raw, b);
          if (variant !== null) {
            // `cycle a | b | c` / `shuffle a | b | c` as a whole line: emit the
            // pick as a spoken line (under a speaker) or narration.
            if (sp !== undefined) {
              this.record({ type: "dialogue", speaker: sp, text: variant, audience: this.subjectAudience(b), setting: st ?? null, beat: bt ?? null });
            } else {
              this.record({ type: "action", text: variant, setting: st ?? null, beat: bt ?? null });
            }
          } else {
            this.runDirective(item.value.raw, b);
          }
          break;
        }
        case "directiveBlock":
          this.runDirective(item.value.directive.raw, b);
          stack.push({ items: item.value.body, index: 0, bindings: b, speaker: sp, cast: cs, setting: st, beat: bt });
          break;
        case "conditional":
          for (const arm of item.value.arms) {
            if (arm.condition === null || this.evalCond(arm.condition, b)) {
              stack.push({ items: arm.body, index: 0, bindings: b, speaker: sp, cast: cs, setting: st, beat: bt });
              break;
            }
          }
          break;
        case "afterMorph":
          stack.push({
            items: this.evalCond(item.value.condition, b) ? item.value.after : item.value.otherwise,
            index: 0,
            bindings: b,
            speaker: sp,
            cast: cs,
            setting: st,
            beat: bt,
          });
          break;
        case "match": {
          const scrutinee = display(this.evalValue(item.value.scrutinee, b));
          for (const arm of item.value.arms) {
            if (arm.pattern === scrutinee) {
              stack.push({ items: arm.body, index: 0, bindings: b, speaker: sp, cast: cs, setting: st, beat: bt });
              break;
            }
          }
          break;
        }
        case "eachVisit": {
          // 1 → first, 2 → then, 3+ → finally (falling back to `then`, then
          // `first`, when a later arm is empty).
          const n = bt !== undefined ? this.beatVisits.get(this.visitKey(bt, b)) ?? 1 : 1;
          const ev = item.value;
          const arm =
            n <= 1 ? ev.first : n === 2 || ev.finally.length === 0 ? (ev.then.length > 0 ? ev.then : ev.first) : ev.finally;
          stack.push({ items: arm, index: 0, bindings: b, speaker: sp, cast: cs, setting: st, beat: bt });
          break;
        }
        case "inlineLet":
          this.world.set(item.value.name, this.evalValue(item.value.expression, b));
          break;
        case "divert": {
          const d = item.value;
          if (d.kind === "to") {
            const r = this.resolveBeat(d.target, b);
            if (r !== undefined) {
              const [name, beat, bound] = r;
              // Key the visit on the CALLER's bindings, not the (possibly
              // self-rebound) `bound` — `visits()` later queries from the
              // caller's frame, so a cross-owner divert with no participant
              // bound would otherwise record under the owner and read 0.
              const key = this.visitKey(name, b);
              this.beatVisits.set(key, (this.beatVisits.get(key) ?? 0) + 1);
              // The target's own setting wins; a setting-less sub-beat
              // continues in the caller's room.
              const setting = beatSetting(beat) ?? st;
              this.record({ type: "beatEntered", beat: name, setting: setting ?? null, subject: this.beatSubject(bound) });
              stack.push({ items: beat.body, index: 0, bindings: bound, cast: firstCastMember(beat), setting, beat: name });
            }
          }
          break; // end / return / tunnel: terminate this branch
        }
        case "choice": {
          // A choice menu suspends execution. The current work stack IS
          // the continuation — snapshot it (this frame's cursor already
          // points past the menu) and resume on `choose()`.
          let j = frame.index - 1;
          const options: Array<{ text: string; body: BodyItem[] }> = [];
          while (j < frame.items.length && frame.items[j]!.kind === "choice") {
            const c = frame.items[j]! as Extract<BodyItem, { kind: "choice" }>;
            options.push({ text: this.interpolate(c.value.text, b), body: c.value.body });
            j += 1;
          }
          frame.index = j; // advance past the whole menu
          const person = this.subjectAudience(b)[0] ?? "__global";
          const continuation = stack.map((f) => ({
            items: f.items,
            index: f.index,
            bindings: f.bindings,
            speaker: f.speaker,
            cast: f.cast,
            setting: f.setting,
            beat: f.beat,
          }));
          const queue = this.pendingChoices.get(person) ?? [];
          queue.push({ options, bindings: b, continuation });
          this.pendingChoices.set(person, queue);
          this.record({
            type: "choicePrompted",
            person: person === "__global" ? null : person,
            promptId: person,
            options: options.map((o) => o.text),
          });
          return; // suspend
        }
      }
    }
  }

  /** Play a scripted beat in the given binding scope. */
  playBeat(name: string, bindings: Bindings): void {
    let beat = this.model.beats.get(name);
    if (beat === undefined) {
      const key = this.model.beatIndex.get(name);
      if (key === null) return;
      beat = this.model.beats.get(key);
      if (beat === undefined) return;
      name = key;
    }
    const key = this.visitKey(name, bindings);
    this.beatVisits.set(key, (this.beatVisits.get(key) ?? 0) + 1);
    const setting = beatSetting(beat);
    this.record({ type: "beatEntered", beat: name, setting: setting ?? null, subject: this.beatSubject(bindings) });
    this.exec([{ items: beat.body, index: 0, bindings, cast: firstCastMember(beat), setting, beat: name }]);
  }

  /** The participant a beat is playing for — the `guest` binding, else
   *  `self` when self is a person — and the story-position bookkeeping. */
  private beatSubject(bindings: Bindings): string | null {
    const subject = this.subjectAudience(bindings)[0] ?? null;
    return subject;
  }

  /** The beat a participant is currently inside (their story position). */
  lastBeatOf(person: string): string | null {
    return this.lastBeat.get(person) ?? null;
  }

  /** Every beat a participant has entered, with visit counts — their trail
   *  through the story (unordered; the ledger holds the order). */
  visitedBeatsFor(person: string): Record<string, number> {
    const out: Record<string, number> = {};
    const suffix = `::${person}`;
    for (const [key, n] of this.beatVisits) {
      if (key.endsWith(suffix)) out[key.slice(0, key.length - suffix.length)] = n;
    }
    return out;
  }

  /**
   * The whole world state as display strings, sorted by path — the
   * director's debugger view. Includes every scalar (`g-1.score`,
   * `TheAdmin.captures`, `Time.elapsed`, ad-hoc globals) plus collections
   * (faction members, occupants) under their canonical paths.
   */
  worldEntries(): Array<{ path: string; value: string }> {
    return this.world
      .entries()
      .filter(([path]) => !path.startsWith("event#"))
      .map(([path, v]) => ({ path, value: display(v) }));
  }

  /** Per-person visit key so `visits(beat)` is scoped to the participant. */
  private visitKey(name: string, bindings: Bindings): string {
    const subj = bindings.get("guest") ?? bindings.get("self") ?? "__global";
    return `${name}::${subj}`;
  }

  /**
   * Resolve a dialogue speaker token. `SELF`/`ME` become whoever `self` is
   * bound to on the current frame — the prop whose hook routed here — so a
   * beat needn't restate its owner. The resolved id is upper-cased to match
   * how explicit speakers are written (`Crawler` → `CRAWLER`,
   * `Cookie_Banner` → `COOKIE_BANNER`), keeping the speaker column uniform.
   * With no `self` bound (a top-of-file beat with no router) the literal
   * token is kept — a later slice lints that and falls back to `cast[0]`.
   */
  private resolveSelfSpeaker(speaker: string, bindings: Bindings, cast?: string): string {
    const head = speaker.trim();
    if (head.toUpperCase() !== "SELF" && head.toUpperCase() !== "ME") {
      return this.canonicalSpeaker(speaker);
    }
    const self = bindings.get("self");
    if (self !== undefined && self.length > 0) return this.canonicalSpeaker(self);
    // No `self` bound (a beat played with no router) — fall back to the beat's
    // first `cast:` member; if there is none, keep the literal token.
    if (cast !== undefined && cast.length > 0) return this.canonicalSpeaker(cast);
    return speaker;
  }

  /**
   * A speaker as the world knows it (Loom 4 §4): a cue that folds to a
   * declared character / role / participant canonicalises to that entity's
   * id — `IVO`, `Ivo:` and `ivo marsh:` all speak as `Ivo Marsh`, so a
   * character never splits across spellings in the ledger or in chat
   * routing. Multi-speaker cues canonicalise each head. An undeclared
   * speaker (`NARRATOR`, `HOST`) is kept as written.
   */
  private canonicalSpeaker(speaker: string): string {
    return speaker
      .split("|")
      .map((s) => {
        const t = s.trim();
        if (this.model.entityKind.has(t)) return t;
        return this.model.entityIndex.get(t) ?? t;
      })
      .join(" | ");
  }

  /**
   * Resolve a divert target to `[resolvedName, beat, bindings]`, honoring the
   * owner qualifier (spec §11.2). `self.`/`me.` resolve against the current
   * `self`; an explicit `Owner.` is taken as-is; a bare name stays global —
   * so existing `-> lockdown` diverts are byte-for-byte unchanged. Reaching a
   * *foreign* owner's beat rebinds `self` to that owner, so its `SELF` speaker
   * and `self.x` reads resolve as the beat's true owner, not the caller.
   */
  private resolveBeat(t: DivertTarget, b: Bindings): [string, Beat, Bindings] | undefined {
    if (t.qualifier !== null) {
      const owner =
        t.qualifier === "self" || t.qualifier === "me" ? b.get("self") : t.qualifier;
      if (owner !== undefined && owner.length > 0) {
        const key = `${owner}.${t.name}`;
        const hit = this.model.beats.get(key);
        if (hit !== undefined) {
          const bound = owner === b.get("self") ? b : new Map(b).set("self", owner);
          return [key, hit, bound];
        }
      }
      // Qualifier present but no owned beat — fall through to the flat lookup
      // (a cross-file `/` target lands here too), then diagnose if that misses.
    }
    const flat = this.model.beats.get(t.name);
    if (flat !== undefined) return [t.name, flat, b];
    // Loose spelling (Loom 4 §3): `-> the bell tower` reaches `== The Bell
    // Tower`; a qualifier-shaped miss (`-> Mr. Marsh`) retries the whole text.
    for (const raw of t.qualifier !== null ? [t.name, `${t.qualifier}.${t.name}`] : [t.name]) {
      const key = this.model.beatIndex.get(raw);
      if (key !== null) {
        const hit = this.model.beats.get(key);
        if (hit !== undefined) {
          const dot = key.indexOf(".");
          const owner = dot > 0 ? key.slice(0, dot) : null;
          const bound = owner !== null && owner !== b.get("self") ? new Map(b).set("self", owner) : b;
          return [key, hit, bound];
        }
      }
    }
    if (t.qualifier !== null) {
      this.record({
        type: "diagnostic",
        message: `divert to \`${t.qualifier}.${t.name}\` resolves to no beat`,
      });
    }
    return undefined;
  }

  /**
   * Resolve a beat name written in a history query (`visits`/…) to its stored
   * key, owner-first — the mirror of `resolveBeat`. `visits(self.prophecy)`,
   * `visits(prophecy)` (when `self` owns one), and `visits(Oracle.prophecy)`
   * all land on the `Oracle.prophecy` counter.
   */
  private resolveBeatKey(rawName: string): string {
    const self = this.currentBindings.get("self");
    const dot = rawName.indexOf(".");
    if (dot >= 0) {
      const q = rawName.slice(0, dot);
      const n = rawName.slice(dot + 1);
      const owner = q === "self" || q === "me" ? self : q;
      if (owner !== undefined && this.model.beats.has(`${owner}.${n}`)) return `${owner}.${n}`;
      return n;
    }
    if (self !== undefined && this.model.beats.has(`${self}.${rawName}`)) {
      return `${self}.${rawName}`;
    }
    if (!this.model.beats.has(rawName)) {
      const folded = this.model.beatIndex.get(rawName);
      if (folded !== null) return folded;
    }
    return rawName;
  }

  // -------------------------------------------------------------------
  // Directive vocabulary (the effect language)
  // -------------------------------------------------------------------

  private runDirective(raw: string, bindings: Bindings): void {
    const { verb, rest } = splitDirective(raw);
    switch (verb) {
      case "set":
        this.runSet(rest, bindings);
        break;
      case "capture":
        this.runCapture(rest, bindings);
        break;
      case "release":
        this.runRelease(rest, bindings);
        break;
      case "escape":
        this.doEscape(this.resolveId(rest, bindings));
        break;
      case "join": {
        const kw = splitKeyword(rest, "to");
        if (kw !== null) {
          const p = this.resolveId(kw[0], bindings);
          const f = this.resolveId(kw[1], bindings);
          this.setFaction(p, f);
          this.record({ type: "joined", person: p, faction: f });
          this.fire({ verb: "join", subject: p, scanner: null, filter: f });
        }
        break;
      }
      case "defect": {
        const fromKw = splitKeyword(rest, "from");
        const toKw = fromKw !== null ? splitKeyword(fromKw[1], "to") : null;
        if (fromKw !== null && toKw !== null) {
          const p = this.resolveId(fromKw[0], bindings);
          const a = this.resolveId(toKw[0], bindings);
          const b = this.resolveId(toKw[1], bindings);
          this.membership.get(a)?.delete(p);
          this.syncFaction(a);
          this.setFaction(p, b);
          this.record({ type: "defected", person: p, from: a, to: b });
          this.fire({ verb: "defect", subject: p, scanner: null, filter: b });
        }
        break;
      }
      case "add": {
        // Loom 4 `add who to Group` — *additive* membership (Loom 4 §8): a
        // participant may belong to several groups; `who.group` is the
        // primary (first joined, or the one `join`/`defect` switched to) and
        // `who.groups` lists them all. v3 `join` keeps its switching meaning.
        const kw = splitKeyword(rest, "to");
        if (kw !== null) {
          const p = this.resolveId(kw[0], bindings);
          const g = this.resolveId(kw[1], bindings);
          this.addToGroup(p, g);
          this.record({ type: "joined", person: p, faction: g });
          this.fire({ verb: "join", subject: p, scanner: null, filter: g });
        }
        break;
      }
      case "remove": {
        // Loom 4 `remove who from Group`.
        const kw = splitKeyword(rest, "from");
        if (kw !== null) {
          const p = this.resolveId(kw[0], bindings);
          const g = this.resolveId(kw[1], bindings);
          this.removeFromGroup(p, g);
          this.record({ type: "directive", verb, args: `${p} from ${g}` });
          this.fire({ verb: "removed", subject: p, scanner: null, filter: g });
        }
        break;
      }
      case "move": {
        // Loom 4 `move who to Place` — plain movement; `arrives` / `leaves`
        // hooks fire, nothing about capture is implied.
        const kw = splitKeyword(rest, "to");
        if (kw !== null) {
          const p = this.resolveId(kw[0], bindings);
          const l = this.resolveId(kw[1], bindings);
          if (this.persons.has(p)) {
            const prior = this.locationOf(p);
            this.setLocation(p, l);
            this.record({ type: "arrived", person: p, location: l, from: prior });
            this.fire({ verb: "arrive", subject: p, scanner: null, filter: l });
          }
        }
        break;
      }
      case "broadcast":
        this.runBroadcast(rest, bindings);
        break;
      case "cast":
      case "promote": {
        const kw = splitKeyword(rest, verb === "cast" ? "as" : "to");
        if (kw !== null) {
          const p = this.resolveId(kw[0], bindings);
          const role = this.resolveId(kw[1], bindings);
          const person = this.persons.get(p);
          if (person !== undefined) person.role = role;
          this.world.set(`${p}.role`, vString(role));
          this.seedRelationships(p, role); // dispositions tied to the new role
          this.record({ type: verb === "cast" ? "cast" : "promoted", person: p, role });
        }
        break;
      }
      case "betray": {
        const kw = splitKeyword(rest, "to");
        if (kw !== null) this.doBetray(this.resolveId(kw[0], bindings), this.resolveId(kw[1], bindings));
        break;
      }
      case "reveal":
        this.doReveal(this.resolveId(rest, bindings));
        break;
      case "respond": {
        // To `self`'s device (a scanner prop → its performer; a role → the
        // participant); in a story rule, to the acting participant.
        const to = bindings.get("self") ?? this.subjectAudience(bindings)[0] ?? "";
        this.record({ type: "respond", to, text: this.interpolate(rest, bindings) });
        break;
      }
      case "fire": {
        // `fire name` / `fire name for subject` / `fire name with k: v`
        // (arguments are Slice 2 — accepted, not yet bound).
        let head = rest.trim();
        let subject = "";
        let args: Map<string, Value> | undefined;
        let argIds: Map<string, string> | undefined;
        const withIdx = head.indexOf(" with ");
        if (withIdx >= 0) {
          const parsed = this.parseEventArgs(head.slice(withIdx + 6), bindings);
          args = parsed.args;
          argIds = parsed.argIds;
          head = head.slice(0, withIdx).trim();
        }
        const forKw = splitKeyword(head, "for");
        if (forKw !== null) {
          head = forKw[0];
          subject = this.resolveId(forKw[1], bindings);
        }
        const name = this.resolveId(head, bindings);
        this.record({ type: "directive", verb, args: rest });
        this.fire({ verb: name, subject, scanner: null, filter: null, args, argIds });
        break;
      }
      default:
        this.record({ type: "directive", verb, args: this.interpolate(rest, bindings) });
        break;
    }
  }

  /**
   * A `cycle: a | b | c` / `shuffle: a | b | c` directive's pick, or null
   * for any other directive. Cycles advance per site + subject; shuffles
   * pick by a deterministic hash of the ledger length so replays agree.
   */
  private varietyLine(raw: string, bindings: Bindings): string | null {
    const { verb, rest } = splitDirective(raw);
    if (verb !== "cycle" && verb !== "shuffle") return null;
    const variants = rest.split("|").map((v) => v.trim()).filter((v) => v.length > 0);
    if (variants.length === 0) return null;
    const subj = bindings.get("guest") ?? bindings.get("self") ?? "__global";
    const key = `${verb}:${rest}::${subj}`;
    let idx: number;
    if (verb === "cycle") {
      const n = this.varietyState.get(key) ?? 0;
      this.varietyState.set(key, n + 1);
      idx = n % variants.length;
    } else {
      idx = (this.log.len() * 7919 + rest.length) % variants.length;
    }
    return this.interpolate(variants[idx]!, bindings);
  }

  private runSet(rest: string, bindings: Bindings): void {
    const clause = parseSet(rest);
    if (clause === null) return;
    const path = expandPath(clause.path, bindings);
    const rhs = this.evalValue(clause.rhs, bindings);
    let next: Value;
    if (clause.op === "=") {
      // A bare identifier that resolves to nothing is an enum/sum value
      // (`<set: g.allegiance = loyal>`), not a missing path.
      next =
        rhs.kind === "null" && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(clause.rhs.trim())
          ? vString(clause.rhs.trim())
          : rhs;
    } else {
      const cur = asNumber(this.world.get(path)) ?? 0;
      const r = asNumber(rhs) ?? 0;
      const n =
        clause.op === "+=" ? cur + r : clause.op === "-=" ? cur - r : clause.op === "*=" ? cur * r : cur / r;
      next = vNumber(n);
    }
    this.world.set(path, next);
    this.record({ type: "worldSet", path, value: display(next) });
    // Surface relationship writes (`Char.trusts.Person`) distinctly.
    const segs = path.split(".");
    if (segs.length === 3) {
      this.record({
        type: "relationshipChanged",
        subject: segs[0]!,
        relation: segs[1]!,
        object: segs[2]!,
        value: asNumber(next) ?? 0,
      });
    }
  }

  private runCapture(rest: string, bindings: Bindings): void {
    const kw = splitKeyword(rest, "into");
    const person = this.resolveId(kw !== null ? kw[0] : rest, bindings);
    // Idempotent: re-scanning an already-imprisoned guest is a no-op,
    // so the cascade (score dock, villain counter) doesn't double-fire.
    if (this.isCaptured(person)) return;
    if (!this.persons.has(person)) return; // unknown QR — fail quietly
    const location = kw !== null ? this.resolveId(kw[1], bindings) : this.prisonLocation();
    this.world.set(`${person}.captured_from`, vString(this.locationOf(person) ?? this.freeLocation()));
    this.setLocation(person, location);
    this.world.set(`${person}.captured`, vBool(true));
    const by = bindings.get("self") ?? null;
    this.record({ type: "captured", person, location, by });
    this.fire({ verb: "captured", subject: person, scanner: null, filter: location });
  }

  private runRelease(rest: string, bindings: Bindings): void {
    const kw = splitKeyword(rest, "from");
    const person = this.resolveId(kw !== null ? kw[0] : rest, bindings);
    const location = kw !== null ? this.resolveId(kw[1], bindings) : this.prisonLocation();
    this.world.set(`${person}.captured`, vBool(false));
    this.setLocation(person, this.freeLocation());
    this.record({ type: "released", person, location });
    this.fire({ verb: "released", subject: person, scanner: null, filter: location });
  }

  private doEscape(person: string): void {
    // Only a genuine imprisoned→free transition rewards the player, so
    // the score can't be farmed by repeated escape signals.
    if (!this.isCaptured(person)) return;
    this.world.set(`${person}.captured`, vBool(false));
    const back = this.world.peek(`${person}.captured_from`);
    this.setLocation(person, back !== null && back.kind === "string" ? back.value : this.freeLocation());
    this.record({ type: "escaped", person });
    this.fire({ verb: "escape", subject: person, scanner: null, filter: null });
  }

  private doBetray(person: string, secret: string): void {
    const displayed = this.factionOf(person);
    this.world.set(`${person}.trueFaction`, vString(secret));
    this.record({ type: "betrayed", person, displayed, secret });
    this.fire({ verb: "betray", subject: person, scanner: null, filter: secret });
  }

  private doReveal(faction: string): void {
    if (this.revealed.has(faction)) return;
    this.revealed.add(faction);
    this.world.set(`${faction}.revealed`, vBool(true));
    this.record({ type: "factionRevealed", faction });
    this.fire({ verb: "revealed", subject: faction, scanner: null, filter: null });
  }

  private runBroadcast(rest: string, bindings: Bindings): void {
    // `cue to scope`, the block form `to scope` (no cue), or the v3
    // scope-only block `<broadcast: location(X)>`.
    const kw = splitKeyword(rest, "to");
    const toOnly = stripPrefix(rest.trim(), "to ");
    const cue = toOnly !== null ? "" : kw !== null ? kw[0].trim() : rest.trim();
    const scopeText = toOnly !== null ? toOnly.trim() : kw !== null ? kw[1].trim() : "";
    const audience = this.resolveScope(scopeText, bindings);
    // A cue written as prose (`broadcast "The bell rings." to …`) is its own
    // copy — interpolate it like a line; a bare cue name stays a name.
    const text = /^".*"$/su.test(cue) || /\s/u.test(cue) ? this.interpolate(cue, bindings) : cue;
    this.record({ type: "broadcast", cue: text, audience, scope: scopeText });
  }

  /** Resolve a broadcast scope into a list of person ids. */
  private resolveScope(scopeText: string, bindings: Bindings): string[] {
    const out = new Set<string>();
    for (const term of scopeText.split("|")) {
      const t = term.trim();
      const m = /^(\w+)\((.*)\)$/u.exec(t);
      if (m === null) continue;
      const kind = m[1]!;
      // A literal entity name (incl. a multi-word one, `location(The Long
      // Table)`) is taken as-is; anything else is evaluated so
      // `faction(guest.faction)` resolves to the guest's concrete group id.
      const raw = m[2]!.trim();
      let arg: string;
      const bound = bindings.get(raw);
      if (bound !== undefined) arg = bound;
      else if (this.model.entityKind.has(raw)) arg = raw;
      else {
        const v = this.evalValue(raw, bindings);
        arg = v.kind === "null" ? (this.model.entityIndex.get(raw) ?? "") : display(v);
      }
      if (kind === "participant") {
        if (this.persons.has(arg)) out.add(arg);
      } else if (kind === "faction" || kind === "group") {
        for (const p of this.membership.get(arg) ?? []) out.add(p);
      } else if (kind === "location") {
        for (const p of this.occupants.get(arg) ?? []) out.add(p);
      }
    }
    return [...out];
  }

  // -------------------------------------------------------------------
  // State mutation primitives (keep collections + scalars in sync)
  // -------------------------------------------------------------------

  private setFaction(person: string, faction: string): void {
    const prior = this.factionOf(person);
    if (prior !== null && prior !== faction) {
      this.membership.get(prior)?.delete(person);
      this.syncFaction(prior);
    }
    this.setPrimaryGroup(person, faction);
    let set = this.membership.get(faction);
    if (set === undefined) {
      set = new Set();
      this.membership.set(faction, set);
    }
    set.add(person);
    this.syncFaction(faction);
    this.syncGroups(person);
  }

  /** The displayed group: `who.faction` (v3) and `who.group` (Loom 4). */
  private setPrimaryGroup(person: string, group: string | null): void {
    const v = group === null ? VNULL : vString(group);
    this.world.set(`${person}.faction`, v);
    this.world.set(`${person}.group`, v);
  }

  /** Additive membership — the primary group is only set when there was none. */
  private addToGroup(person: string, group: string): void {
    let set = this.membership.get(group);
    if (set === undefined) {
      set = new Set();
      this.membership.set(group, set);
    }
    set.add(person);
    if (this.factionOf(person) === null) this.setPrimaryGroup(person, group);
    this.syncFaction(group);
    this.syncGroups(person);
  }

  private removeFromGroup(person: string, group: string): void {
    this.membership.get(group)?.delete(person);
    this.syncFaction(group);
    if (this.factionOf(person) === group) {
      // The primary moves to the next remaining membership, if any.
      let next: string | null = null;
      for (const [g, members] of this.membership) {
        if (members.has(person)) {
          next = g;
          break;
        }
      }
      this.setPrimaryGroup(person, next);
    }
    this.syncGroups(person);
  }

  /** `who.groups` — every group the participant belongs to. */
  private syncGroups(person: string): void {
    const ids: string[] = [];
    for (const [g, members] of this.membership) if (members.has(person)) ids.push(g);
    this.world.set(`${person}.groups`, vList(ids.map(vString)));
  }

  /** Every group `person` belongs to (Loom 4 multi-membership). */
  groupsOf(person: string): string[] {
    const out: string[] = [];
    for (const [g, members] of this.membership) if (members.has(person)) out.push(g);
    return out;
  }

  private setLocation(person: string, location: string): void {
    const prior = this.locationOf(person);
    if (prior !== null && prior !== location) {
      this.occupants.get(prior)?.delete(person);
      this.syncLocation(prior);
      this.fire({ verb: "exits", subject: person, scanner: null, filter: prior });
    }
    this.world.set(`${person}.location`, vString(location));
    let set = this.occupants.get(location);
    if (set === undefined) {
      set = new Set();
      this.occupants.set(location, set);
    }
    set.add(person);
    this.syncLocation(location);
    // Symmetric with `exits`: every movement path (arrive, capture,
    // escape, release) fires `enters` so `on enters LOCATION` works.
    if (prior !== location) {
      this.fire({ verb: "enters", subject: person, scanner: null, filter: location });
    }
  }

  private seedRelationships(person: string, roleId: string): void {
    // Seed each character's disposition axis against the new person
    // (`trusts Guest: 50 of 100` → `Char.trusts.person = 50`).
    for (const char of this.model.characters.values()) {
      for (const axis of char.disposition) {
        if (axis.target === roleId || axis.target === "Guest" || axis.target === person) {
          this.world.set(`${char.id}.${axis.verb}.${person}`, vNumber(axis.current));
        }
      }
    }
  }

  private prisonLocation(): string {
    for (const [id, def] of this.model.locations) if (def.prison) return id;
    return "Internet";
  }
  private freeLocation(): string {
    for (const [id, def] of this.model.locations) if (!def.prison) return id;
    return "Party";
  }

  private syncFaction(faction: string): void {
    this.world.setCollection(
      `${faction}.members`,
      vList([...(this.membership.get(faction) ?? [])].map(vString)),
    );
  }
  private syncLocation(location: string): void {
    this.world.setCollection(
      `${location}.occupants`,
      vList([...(this.occupants.get(location) ?? [])].map(vString)),
    );
  }
  private syncPersons(): void {
    this.world.setCollection("Persons", vList([...this.persons.keys()].map(vString)));
  }

  private subjectAudience(bindings: Bindings): string[] {
    for (const name of ["guest", "person", "subject"]) {
      const id = bindings.get(name);
      if (id !== undefined && this.persons.has(id)) return [id];
    }
    const self = bindings.get("self");
    return self !== undefined && this.persons.has(self) ? [self] : [];
  }

  // -------------------------------------------------------------------
  // Expression bridge
  // -------------------------------------------------------------------

  private resolveId(text: string, bindings: Bindings): string {
    const t = text.trim();
    const bound = bindings.get(t);
    if (bound !== undefined) return bound;
    if (this.model.entityKind.has(t)) return t;
    return this.model.entityIndex.get(t) ?? t;
  }

  private evalValue(src: string, bindings: Bindings): Value {
    this.currentBindings = bindings;
    try {
      return evaluate(parseExpr(src), this.world, this.callFn, bindings);
    } catch (e) {
      if (e instanceof ExprError) return VNULL;
      throw e;
    }
  }

  private evalCond(src: string, bindings: Bindings): boolean {
    return truthy(this.evalValue(src, bindings));
  }

  private callFn = (name: string, args: CallArg[]): Value => {
    switch (name) {
      case "members": {
        const f = args[0]?.asName() ?? "";
        return vList(this.factionMembers(f).map(vString));
      }
      case "occupants": {
        const l = args[0]?.asName() ?? "";
        return vList([...(this.occupants.get(l) ?? [])].map(vString));
      }
      case "count": {
        const v = args[0]?.value;
        return vNumber(v !== undefined && v.kind === "list" ? v.items.length : 0);
      }
      case "visits": {
        const subj =
          this.currentBindings.get("guest") ?? this.currentBindings.get("self") ?? "__global";
        const beatKey = this.resolveBeatKey(args[0]?.asName() ?? "");
        return vNumber(this.beatVisits.get(`${beatKey}::${subj}`) ?? 0);
      }
      default:
        return VNULL;
    }
  };

  private interpolate(text: string, bindings: Bindings): string {
    return text.replace(/\{([^}]+)\}/gu, (_m, expr: string) =>
      display(this.evalValue(expr.trim(), bindings)),
    );
  }

  private record(event: SimEvent): number {
    // Story-position bookkeeping rides the event stream, so every path
    // that enters a beat (divert, fireBeat, hook) updates the position.
    if (event.type === "beatEntered" && event.subject !== null) {
      this.lastBeat.set(event.subject, event.beat);
    }
    return this.log.push(event);
  }
}

/** Event names are names (Loom 4 §3): `ring the bell` ≡ `ring_the_bell`. */
function verbMatches(hookVerb: string, triggerVerb: string): boolean {
  return hookVerb === triggerVerb || foldName(hookVerb) === foldName(triggerVerb);
}

/** A timer hook's bindings: `self` = the owner, nothing for a story rule. */
function timerBindings(hook: Hook): Bindings {
  return hook.ownerKind === "story" ? new Map() : new Map([["self", hook.ownerId]]);
}

/** `k: expr` → `[k, expr]` at the first colon, or null. */
function splitOnceColon(text: string): [string, string] | null {
  const i = text.indexOf(":");
  if (i <= 0) return null;
  return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
}

// Re-exported convenience: a fresh model from a single source.
export function compileFromSource(source: string): SimModel {
  const [file, diagnostics] = parse(source);
  const bundle = new Bundle();
  bundle.files.push({ path: "f0.loom", stem: "f0", qualifier: "", source, file, diagnostics });
  return compileModel(bundle);
}

// Used by `Sim.beat` typing.
export type { Beat };
