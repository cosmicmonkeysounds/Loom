//! One live event = one `EventRuntime`.
//!
//! Everything that used to be a module-level global in `server.ts` (the
//! `Sim`, its phase, the chat store, sessions, decision docks, the SSE
//! client set, the autonomous ticker, the on-disk journal) now lives on an
//! instance so a single process can host **many** events at once — one per
//! project that has opened its doors. The multi-tenant server keeps a
//! registry of these and routes each request to the right one.
//!
//! The request handlers, fan-out, persistence and restart-recovery are ported
//! verbatim from the original single-event server; only the state they touch
//! moved from `state.*` / free variables onto `this`.

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";
import { guestView, modView, primeView, rosterRow, themeOf, titleOf, type ModPresence, type RuntimePhase } from "./views.ts";
import { passOk, type Passcodes } from "./auth.ts";
import { SessionStore } from "./session.ts";
import { Store, type Mutation } from "./store.ts";
import { ChatStore, composeGuestMessages, decisionChannelFor, visibleTo, type ChatMessage } from "./chat.ts";
import { ipOf, queryTokenOf, readBody, sendJson, sseSend, str, tokenOf } from "./http-util.ts";
import { RateLimiter } from "./rate-limit.ts";

/** A guest view is never rendered against a null sim — this stands in. */
const EMPTY_SIM = Sim.fromSources("");

/** One SSE subscriber attached to a specific event. */
interface Client {
  role: "guest" | "prime" | "mod";
  id: string;
  /** Display name of a session-authorized director (for co-moderator presence). */
  name?: string; // person id (guest), character (prime), or "" (mod)
  /** A performer who also holds the mod capability sees the whole feed. */
  admin?: boolean;
  res: ServerResponse;
}

/**
 * What a performer's console may see. Public story + every room is theirs
 * to run — but a **private thread** (a guest's DM with a character, or two
 * guests' `pm:`) is private to its parties: only the character's own
 * performer (or an admin) sees a `dm:<character>` thread, and nobody but a
 * mod sees a `pm:`. Knowledge is a currency; the booth can't skim it.
 */
function visibleToPrime(m: ChatMessage, c: Client): boolean {
  if (c.admin === true) return true;
  if (m.channel.startsWith("pm:")) return false;
  if (m.channel.startsWith("dm:")) return m.channel === `dm:${c.id}` || m.audience === "all";
  return true;
}

/** The run transitions announced on the `lifecycle` SSE event. */
export type LifecycleKind = "reset" | "reload" | "golive" | "ended";

/** A message as a guest client may see it: never the director attribution
 *  a mod `say`-as-a-participant carries. */
function forGuest(m: ChatMessage): ChatMessage {
  if (m.via === undefined) return m;
  const { via: _via, ...rest } = m;
  return rest;
}

/** What a restart-recovery brought back for one event, for the boot banner. */
export interface Restored {
  guests: number;
  events: number;
  sessions: number;
}

/** Construction context for an event runtime. */
export interface EventRuntimeInit {
  /** Stable event id (also the on-disk state sub-directory name). */
  eventId: string;
  /** Durable per-event state (journal / sessions / hidden). */
  store: Store;
  /** The three passcodes gating this event's roles. */
  codes: Passcodes;
  /** Human label for the loaded scenario. */
  scenarioName: string;
  /** The `.loom` source snapshot this event plays. */
  scenarioSource: string;
  /** Best LAN/base URL for guest-join QRs (for `/api/mod/codes`). */
  joinBase: () => string;
}

export class EventRuntime {
  readonly eventId: string;
  readonly codes: Passcodes;
  private readonly store: Store;
  private readonly joinBase: () => string;

  private sim: Sim | null = null;
  private phase: RuntimePhase = "idle";
  private scenarioName: string;
  private scenarioSource: string;

  // Token → capabilities (performer / admin), scoped to this event.
  private readonly sessions = new SessionStore();
  // Guest capability tokens (token → guest id). A guest's public id is
  // broadcast in rosters, so it is NOT a credential — this opaque token,
  // minted at registration, is what authorizes acting as that guest.
  private readonly guestTokens = new Map<string, string>();
  // Failed passcode attempts per client IP (guest register + prime/mod
  // login). The codes are short and speakable, so throttling online
  // guessing is what actually protects them.
  private readonly loginFailures = new RateLimiter(10, 5 * 60_000);
  // Successful registrations per client IP — a cap on drive-by guest spam.
  private readonly registrations = new RateLimiter(20, 60_000);
  // Server-authoritative chat, rebuilt deterministically from the journal.
  private readonly chat = new ChatStore();
  // Where each guest's pending decision docks (channel id). Ephemeral.
  private readonly decisionChannels = new Map<string, string>();
  // persona id → the director (display name) who spawned it via
  // `/api/mod/persona`. Persisted in meta, cleared by every restart (the
  // personas die with the journal), surfaced as `RosterRow.owner`.
  private readonly personaOwners = new Map<string, string>();
  // The director currently inside `handleMod` (display name) — stamped onto
  // every journal line that mutation writes (`by`) for attribution.
  private actingBy: string | undefined;
  // This event's SSE subscribers.
  private readonly clients = new Set<Client>();
  // Ephemeral messages already announced as expired (so we notify once).
  private readonly notifiedExpired = new Set<number>();
  // Elapsed sim time not yet written to the journal (coalesced ticks).
  private pendingTickMs = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(init: EventRuntimeInit) {
    this.eventId = init.eventId;
    this.store = init.store;
    this.codes = init.codes;
    this.scenarioName = init.scenarioName;
    this.scenarioSource = init.scenarioSource;
    this.joinBase = init.joinBase;
  }

  /** Current lifecycle phase (idle | open | paused). */
  get currentPhase(): RuntimePhase {
    return this.phase;
  }

  /** Human label of the loaded scenario. */
  get scenario(): string {
    return this.scenarioName;
  }

  /** Display title participants see: the authored `# Title` heading in the
   *  source, else the scenario name (the project's name for DB events). */
  get title(): string {
    return titleOf(this.scenarioSource) ?? this.scenarioName;
  }

  /** The participant client's skin: the header `theme:` (default `plain`). */
  get theme(): string {
    return themeOf(this.scenarioSource) ?? "plain";
  }

  /** How many participants exist in this event's world right now. */
  get guestCount(): number {
    return this.sim?.persons.size ?? 0;
  }

  /** True once the doors are open and a sim exists. */
  private get open(): boolean {
    return this.phase === "open" && this.sim !== null;
  }

  /** The live sim, or null before the doors open / after the event ends. */
  get liveSim(): Sim | null {
    return this.sim;
  }

  /** A sim that's never null for guest views (returns an empty live sim). */
  private reqSim(): Sim {
    return this.sim ?? EMPTY_SIM;
  }

  // -- SSE fan-out ---------------------------------------------------------

  /** Who holds an open SSE stream right now, by capability — live presence
   *  for the director consoles (guests, performers, co-moderators). */
  private presence(): ModPresence {
    const guests = new Set<string>();
    const primes = new Set<string>();
    let mods = 0;
    const directors: string[] = [];
    for (const c of this.clients) {
      if (c.role === "guest") guests.add(c.id);
      else if (c.role === "prime") primes.add(c.id);
      else {
        mods += 1;
        directors.push(c.name ?? "Director");
      }
    }
    return { guests, primes, mods, directors, owners: this.personaOwners };
  }

  private snapshotFor(client: Client): unknown {
    if (client.role === "guest") return guestView(this.reqSim(), client.id, this.decisionChannels.get(client.id) ?? null);
    if (client.role === "prime") return primeView(this.sim, client.id);
    return modView(this.sim, this.phase, this.scenarioName, this.presence());
  }

  /** Push fresh snapshots to every connected client. */
  private pushSnapshots(): void {
    for (const c of this.clients) sseSend(c.res, "snapshot", this.snapshotFor(c));
  }

  /** Someone came or went — refresh every mod console's presence view. */
  private pushPresence(): void {
    for (const c of this.clients) if (c.role === "mod") sseSend(c.res, "snapshot", this.snapshotFor(c));
  }

  /** Re-send every client its full thread history — after a reset / reload
   *  the chat timeline restarts (seqs from 0 again), so a client that kept
   *  the old feed would interleave stale rows with new ones. */
  private pushHistory(): void {
    for (const c of this.clients) sseSend(c.res, "history", this.historyFor(c));
  }

  private historyFor(c: Client): ChatMessage[] {
    return c.role === "guest"
      ? this.chat.historyFor(c.id, false).map(forGuest)
      : c.role === "mod"
        ? [...this.chat.all()]
        : this.chat.all().filter((m) => !m.hidden && visibleToPrime(m, c));
  }

  /** A lifecycle transition every connected client should react to
   *  (`reset` / `reload` → drop local state; `ended` → the event is gone). */
  private pushLifecycle(kind: LifecycleKind, extra: Record<string, unknown> = {}): void {
    for (const c of this.clients) sseSend(c.res, "lifecycle", { kind, at: Date.now(), ...extra });
  }

  /** Close every stream of one role (after a cut they announce) and forget
   *  the clients, so presence stops counting them. */
  private endClients(role: Client["role"]): void {
    for (const c of [...this.clients]) {
      if (c.role !== role) continue;
      this.clients.delete(c);
      try {
        c.res.end();
      } catch {
        /* client already gone */
      }
    }
  }

  private toPrime(character: string, event: string, data: unknown): void {
    for (const c of this.clients) if (c.role === "prime" && c.id === character) sseSend(c.res, event, data);
  }

  /**
   * Deliver one composed message to the clients that should see it: guests
   * whose id is in the audience (hidden messages withheld), and every
   * performer/mod console (the full feed, so admins can moderate live).
   */
  private deliverMessage(m: ChatMessage): void {
    for (const c of this.clients) {
      if (c.role === "guest") {
        if (!m.hidden && visibleTo(m, c.id)) sseSend(c.res, "message", forGuest(m));
      } else if (c.role === "prime") {
        if (visibleToPrime(m, c)) sseSend(c.res, "message", m);
      } else {
        sseSend(c.res, "message", m);
      }
    }
  }

  // -- ephemeral messages --------------------------------------------------

  /** Has a message aged past its channel's ephemeral lifetime? */
  private isExpired(m: ChatMessage): boolean {
    if (this.sim === null) return false;
    const eph = this.sim.ephemeralMsOf(m.channel);
    return eph !== null && this.sim.elapsed() - m.ts >= eph;
  }

  /** Notify clients of ephemeral messages that just expired (drives removal). */
  private sweepEphemeral(): void {
    for (const m of this.chat.all()) {
      if (this.notifiedExpired.has(m.seq) || !this.isExpired(m)) continue;
      this.notifiedExpired.add(m.seq);
      for (const c of this.clients) {
        if (c.role !== "guest" || visibleTo(m, c.id)) sseSend(c.res, "messageExpired", { seq: m.seq });
      }
    }
  }

  /**
   * Route a freshly-emitted batch of sim events. Performer scan readouts go
   * straight to the booth; everything guest-facing is composed into channel
   * messages, appended to the chat store, and delivered.
   */
  private fanout(events: SimEvent[], via?: string): void {
    for (const e of events) {
      if (e.type === "respond") this.toPrime(e.to, "response", { text: e.text });
      if (e.type === "choicePrompted" && e.person !== null) {
        this.decisionChannels.set(e.person, decisionChannelFor(events, e.person));
      }
      // Mods (the editor's Run mode) also get the raw sim feed, so the
      // story-graph overlay lights beats up as they fire and a future
      // in-editor simulator can mirror the whole run.
      for (const c of this.clients) if (c.role === "mod") sseSend(c.res, "sim", e);
    }
    const drafts = composeGuestMessages(this.sim ?? EMPTY_SIM, events);
    // A director speaking *as* a participant: the room sees the participant's
    // name, the mod feed additionally sees who really typed it.
    if (via !== undefined) for (const d of drafts) if (d.kind === "line") d.via = via;
    for (const m of this.chat.append(drafts)) this.deliverMessage(m);
    for (const id of [...this.decisionChannels.keys()]) {
      if (this.sim?.pendingChoiceFor(id) == null) this.decisionChannels.delete(id);
    }
    this.pushSnapshots();
  }

  // -- persistence (event-sourced journal) ---------------------------------

  private flushTick(): void {
    if (this.pendingTickMs > 0) {
      this.store.appendCommand("tick", [this.pendingTickMs]);
      this.pendingTickMs = 0;
    }
  }

  /** Apply a sim mutation *and* journal it, so it survives a restart. Inside
   *  a mod route the journal line also carries who did it (`by`). */
  private commit(m: Mutation, ...args: unknown[]): SimEvent[] {
    this.flushTick();
    this.store.appendCommand(m, args, this.actingBy);
    return (this.sim![m] as (...a: unknown[]) => SimEvent[])(...args);
  }

  private persistSessions(): void {
    this.store.saveSessions(this.sessions.entries());
  }

  private persistGuests(): void {
    this.store.saveGuests([...this.guestTokens.entries()]);
  }

  /** The guest id a token authorizes, or null. */
  private guestOf(token: string | undefined): string | null {
    return (token && this.guestTokens.get(token)) || null;
  }

  /**
   * Resolve + authorize the acting guest for a guest POST route. The id is
   * derived from the caller's token — never from the request body — so no
   * guest can act as another. Sends the error response itself on failure.
   */
  private requireGuest(req: IncomingMessage, body: Record<string, unknown>, res: ServerResponse): string | null {
    const id = this.guestOf(tokenOf(req, body));
    if (id === null) {
      sendJson(res, 401, { error: "not signed in — register first" });
      return null;
    }
    return id;
  }

  /** Count a failed passcode attempt; true when this IP is over the limit. */
  private throttled(req: IncomingMessage, res: ServerResponse): boolean {
    if (this.loginFailures.allowed(ipOf(req))) return false;
    sendJson(res, 429, { error: "too many attempts — wait a few minutes" });
    return true;
  }

  private resetChat(): void {
    this.chat.clear();
    this.store.clearHidden();
    this.decisionChannels.clear();
  }

  private persistMeta(): void {
    this.store.saveMeta({
      version: 1,
      scenarioName: this.scenarioName,
      scenarioSource: this.scenarioSource,
      phase: this.phase,
      owners: [...this.personaOwners.entries()],
    });
  }

  private loadScenario(source: string, name: string): void {
    this.sim = Sim.fromSources(source);
    this.scenarioSource = source;
    this.scenarioName = name;
    this.phase = "paused";
  }

  // -- autonomous clock ----------------------------------------------------

  private startTicker(): void {
    if (this.ticker !== null) return;
    this.ticker = setInterval(() => {
      if (this.sim !== null && this.phase === "open") {
        const evs = this.sim.tick(1000);
        this.pendingTickMs += 1000;
        if (evs.length > 0) {
          this.flushTick();
          this.fanout(evs);
        } else if (this.pendingTickMs >= 15000) {
          this.flushTick();
        }
        this.sweepEphemeral();
      }
    }, 1000);
  }

  private stopTicker(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  /**
   * Open the doors: load the scenario on first open, start the clock, and
   * let guests register. The control-plane equivalent of `/api/mod/start`.
   */
  openDoors(): void {
    const fresh = this.sim === null;
    if (fresh) {
      this.loadScenario(this.scenarioSource, this.scenarioName);
      this.store.clearJournal();
      this.resetChat();
      this.pendingTickMs = 0;
    }
    this.phase = "open";
    this.persistMeta();
    this.startTicker();
    // A live event opens exactly like a rehearsal: the `entry:` beat plays
    // on first open. Journaled as a fireBeat so a replay reproduces it.
    const entry = fresh ? this.sim?.model.entry : null;
    if (entry != null && entry !== "") {
      this.fanout(this.commit("fireBeat", entry));
    }
    this.pushSnapshots();
  }

  /** Pause the event: stop the clock, keep all state. `/api/mod/stop`. */
  pause(): void {
    this.flushTick();
    this.phase = "paused";
    this.stopTicker();
    this.persistMeta();
    this.pushSnapshots();
  }

  /**
   * Start the story over — optionally on new source (the editor's "push
   * current draft into the running event"). Clears the journal + chat,
   * replays nothing, and re-opens the doors if they were open (so the
   * `entry:` beat fires again). Every connected client gets a fresh
   * `history` + a `lifecycle` notice so no console keeps a dead feed.
   */
  restart(
    source: string = this.scenarioSource,
    name: string = this.scenarioName,
    opts: { kind?: LifecycleKind; by?: string } = {},
  ): void {
    const kind: LifecycleKind = opts.kind ?? (source === this.scenarioSource ? "reset" : "reload");
    const wasOpen = this.phase === "open";
    // Announce first, so a console drops its old ledger/overlay *before*
    // the replayed entry beat streams in.
    this.pushLifecycle(kind, { phase: wasOpen ? "open" : "paused", ...(opts.by !== undefined ? { by: opts.by } : {}) });
    // Every restart is a real cut for participants: the persons they were
    // die with the journal, so their capability tokens die too (a guest
    // re-registers into the fresh story instead of streaming as a ghost).
    // Going live additionally signs every performer out of their character
    // — rehearsal booths must not carry into the show.
    this.guestTokens.clear();
    this.persistGuests();
    this.personaOwners.clear();
    this.endClients("guest");
    if (kind === "golive") {
      for (const [token, session] of this.sessions.entries()) {
        if (session.character === null) continue;
        if (session.admin) this.sessions.set(token, { character: null, admin: true });
        else this.sessions.delete(token);
      }
      this.persistSessions();
      this.endClients("prime");
    }
    this.stopTicker();
    this.sim = null;
    this.scenarioSource = source;
    this.scenarioName = name;
    if (wasOpen) {
      this.openDoors(); // fresh → loads, clears journal + chat, fires entry
    } else {
      this.loadScenario(source, name);
      this.store.clearJournal();
      this.resetChat();
      this.pendingTickMs = 0;
      this.persistMeta();
      this.pushSnapshots();
    }
    this.pushHistory();
  }

  /** The source the running event was built from (the launch/reload snapshot). */
  get source(): string {
    return this.scenarioSource;
  }

  /** Tear the runtime down (stop the clock, drop SSE clients). */
  dispose(by?: string): void {
    this.stopTicker();
    this.pushLifecycle("ended", by !== undefined ? { by } : {});
    for (const c of this.clients) {
      try {
        c.res.end();
      } catch {
        /* client already gone */
      }
    }
    this.clients.clear();
  }

  // -- restart recovery ----------------------------------------------------

  /**
   * Rebuild live state from disk by replaying the journal into a fresh sim.
   * Returns `null` when this event has no persisted state yet.
   */
  restore(): Restored | null {
    const meta = this.store.loadMeta();
    if (meta === null) return null;
    this.loadScenario(meta.scenarioSource, meta.scenarioName); // sets phase → paused
    let events = 0;
    for (const e of this.store.readJournal()) {
      const fn = (this.sim as unknown as Record<string, unknown>)[e.m];
      if (typeof fn === "function") {
        try {
          const out = (fn as (...a: unknown[]) => unknown).apply(this.sim, e.a);
          events++;
          if (Array.isArray(out)) {
            const batch = out as SimEvent[];
            for (const ev of batch) {
              if (ev.type === "choicePrompted" && ev.person !== null) {
                this.decisionChannels.set(ev.person, decisionChannelFor(batch, ev.person));
              }
            }
            const drafts = composeGuestMessages(this.sim!, batch);
            // A director's speech *as* a participant keeps its attribution
            // across a restart — the same rule `fanout` applies live.
            if (e.m === "say" && e.by !== undefined && this.sim!.persons.has(String(e.a[0]))) {
              for (const d of drafts) if (d.kind === "line") d.via = e.by;
            }
            this.chat.append(drafts);
          }
        } catch {
          /* tolerate a single bad/torn entry rather than abort recovery */
        }
      }
    }
    this.chat.loadHidden(this.store.loadHidden());
    for (const m of this.chat.all()) if (this.isExpired(m)) this.notifiedExpired.add(m.seq);
    for (const id of [...this.decisionChannels.keys()]) {
      if (this.sim?.pendingChoiceFor(id) == null) this.decisionChannels.delete(id);
    }
    this.phase = meta.phase;
    for (const [id, owner] of meta.owners ?? []) this.personaOwners.set(id, owner);
    const entries = this.store.loadSessions();
    this.sessions.load(entries);
    for (const [token, id] of this.store.loadGuests()) this.guestTokens.set(token, id);
    if (this.phase === "open") this.startTicker();
    return { guests: this.sim?.persons.size ?? 0, events, sessions: entries.length };
  }

  // -- request handling ----------------------------------------------------

  /**
   * Handle one event-scoped request. `path` is already relative to this
   * event (the `/e/:eventId` prefix, if any, has been stripped by the
   * router). `opts.moderator` is set by the router when the caller is the
   * owning author (a BetterAuth session), granting mod access without a code.
   * Returns true when the request matched an event route.
   */
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    path: string,
    url: URL,
    opts: { moderator?: boolean; moderatorName?: string } = {},
  ): Promise<boolean> {
    // --- SSE stream ---
    // Every projection is capability-gated: the mod feed (full god view,
    // every DM, hidden factions) needs the mod capability or the owning
    // author's session; the prime feed needs a performer token (the id it
    // streams for is the token's character, never a query param); a guest
    // streams only their own view, resolved from their registration token
    // (EventSource can't set headers, so the token rides `?token=`).
    if (method === "GET" && path === "/events") {
      const role = (url.searchParams.get("role") as Client["role"] | null) ?? "mod";
      const token = queryTokenOf(req, url);
      let id = "";
      if (role === "mod") {
        if (opts.moderator !== true && !this.sessions.canModerate(token)) {
          sendJson(res, 403, { error: "moderators only" });
          return true;
        }
      } else if (role === "prime") {
        const character = this.sessions.characterOf(token);
        if (character === null) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        id = character;
      } else {
        const gid = this.guestOf(token);
        if (gid === null) {
          sendJson(res, 401, { error: "not signed in — register first" });
          return true;
        }
        id = gid;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(":ok\n\n");
      const client: Client = { role, id, res };
      if (role === "mod") client.name = opts.moderatorName ?? "Director";
      if (role === "prime") client.admin = this.sessions.canModerate(token);
      this.clients.add(client);
      sseSend(res, "snapshot", this.snapshotFor(client));
      // A moderator sees the full feed *including* hidden messages (greyed in
      // the UI) so they can un-hide; performers see the public feed only.
      sseSend(res, "history", this.historyFor(client));
      this.pushPresence();
      const ping = setInterval(() => res.write(":ping\n\n"), 25000);
      req.on("close", () => {
        clearInterval(ping);
        this.clients.delete(client);
        this.pushPresence();
      });
      return true;
    }

    // --- read-only state snapshot (same capability gates as the stream) ---
    if (method === "GET" && path === "/api/state") {
      const role = url.searchParams.get("role") ?? "mod";
      const token = queryTokenOf(req, url);
      // A moderator may read any participant's projection verbatim
      // (`?as=<guest id>` / `?as=<character>`) — the editor's identity lens:
      // what the runner sees while "being" someone is exactly the play app's
      // own `GuestView` / `PrimeView`, not a filtered god view.
      const as = url.searchParams.get("as");
      if (as !== null && role !== "mod") {
        if (opts.moderator !== true && !this.sessions.canModerate(token)) {
          sendJson(res, 403, { error: "moderators only" });
          return true;
        }
        if (role === "guest") {
          if (!this.reqSim().persons.has(as)) {
            sendJson(res, 404, { error: "unknown guest" });
            return true;
          }
          sendJson(res, 200, guestView(this.reqSim(), as, this.decisionChannels.get(as) ?? null));
          return true;
        }
        if (role === "prime") {
          if (!this.reqSim().model.characters.has(as)) {
            sendJson(res, 404, { error: "unknown character" });
            return true;
          }
          sendJson(res, 200, primeView(this.sim, as));
          return true;
        }
      }
      if (role === "guest") {
        const gid = this.guestOf(token);
        if (gid === null) {
          sendJson(res, 401, { error: "not signed in — register first" });
          return true;
        }
        sendJson(res, 200, guestView(this.reqSim(), gid, this.decisionChannels.get(gid) ?? null));
        return true;
      }
      if (role === "prime") {
        const character = this.sessions.characterOf(token);
        if (character === null) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        sendJson(res, 200, primeView(this.sim, character));
        return true;
      }
      if (opts.moderator !== true && !this.sessions.canModerate(token)) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      sendJson(res, 200, modView(this.sim, this.phase, this.scenarioName, this.presence()));
      return true;
    }

    // --- a participant's full thread history ---
    // A moderator may read any participant's threads (`?id=`, hidden
    // included); a guest reads their own — the id comes from their token,
    // so no `?id=` probing can reach another guest's DMs.
    if (method === "GET" && path === "/api/history") {
      const token = queryTokenOf(req, url);
      const admin = opts.moderator === true || this.sessions.canModerate(token);
      let id: string;
      if (admin) {
        id = url.searchParams.get("id") ?? "";
      } else {
        const gid = this.guestOf(token);
        if (gid === null) {
          sendJson(res, 401, { error: "not signed in — register first" });
          return true;
        }
        id = gid;
      }
      const messages = this.chat.historyFor(id, admin).filter((m) => !this.isExpired(m));
      sendJson(res, 200, { messages: admin ? messages : messages.map(forGuest) });
      return true;
    }

    if (method !== "POST") return false;

    const body = await readBody(req);

    // --- guest / performer / login actions ---
    if (this.handlePost(req, res, path, body)) return true;

    // --- admin-only actions ---
    // Authorized by a per-event mod token OR by the owning author's session
    // (opts.moderator) — the same capability, two front doors.
    if (path.startsWith("/api/mod/")) {
      if (!opts.moderator && !this.sessions.canModerate(tokenOf(req, body))) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      return this.handleMod(res, path, body, opts.moderatorName ?? "Director");
    }

    return false;
  }

  /**
   * Non-admin POST routes (guest actions, performer chat, prime/mod login).
   * Returns true when `path` matched one of them.
   */
  private handlePost(req: IncomingMessage, res: ServerResponse, path: string, body: Record<string, unknown>): boolean {
    const open = this.open;
    switch (path) {
      // --- guest actions ---
      // Every route below `register` derives the acting guest from the
      // caller's capability token (`requireGuest`) — the `id` a client may
      // still send in the body is ignored, so no guest can act as another.
      case "/api/guest/register": {
        if (this.throttled(req, res)) return true;
        if (!passOk(str(body, "passcode"), this.codes.event)) {
          this.loginFailures.record(ipOf(req));
          sendJson(res, 403, { error: "wrong event code" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (!this.registrations.take(ipOf(req))) {
          sendJson(res, 429, { error: "too many registrations — wait a minute" });
          return true;
        }
        const name = str(body, "name") || "Guest";
        const id = `g-${randomUUID().slice(0, 6)}`;
        const token = randomUUID();
        this.guestTokens.set(token, id);
        this.persistGuests();
        this.fanout(this.commit("createPerson", id, name));
        sendJson(res, 200, { id, name, token });
        return true;
      }
      case "/api/guest/join": {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        this.fanout(this.commit("join", id, str(body, "faction")));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/guest/defect": {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        this.fanout(this.commit("defect", id, str(body, "to")));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/guest/choose": {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const idx = Number(body["index"] ?? -1);
        this.fanout(this.commit("choose", id, idx));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/guest/escape": {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        this.fanout(this.commit("escape", id));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/guest/act": {
        // A guest fires one of the story's `who: guest` INTERACTIONs for
        // themselves — a named event with the guest as subject (Loom 4 §10).
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const name = str(body, "name");
        const def = this.sim!.model.interactions.get(name);
        if (def === undefined || def.who !== "guest") {
          sendJson(res, 404, { error: "no such interaction for guests" });
          return true;
        }
        this.fanout(this.commit("signal", name, id));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/guest/say": {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (!this.sim!.persons.has(id)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        const channel = str(body, "channel") || "lobby";
        const text = str(body, "text").trim();
        if (text === "") {
          sendJson(res, 400, { error: "empty message" });
          return true;
        }
        if (!this.sim!.canPost(id, channel)) {
          sendJson(res, 403, { error: "you can't post here" });
          return true;
        }
        const wait = this.sim!.slowModeRemainingMs(id, channel);
        if (wait > 0) {
          sendJson(res, 429, { error: `slow mode — wait ${Math.ceil(wait / 1000)}s`, retryMs: wait });
          return true;
        }
        const parentSeq = this.sim!.threadableOf(channel) && body["parentSeq"] != null ? Number(body["parentSeq"]) : null;
        this.fanout(this.commit("say", id, channel, text, parentSeq));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/guest/channel/invite": {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (!this.sim!.persons.has(id)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        this.fanout(this.commit("inviteToChannel", id, str(body, "person"), str(body, "channel")));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/guest/channel/leave": {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (!this.sim!.persons.has(id)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        this.fanout(this.commit("leaveChannel", id, str(body, "channel")));
        sendJson(res, 200, { ok: true });
        return true;
      }

      case "/api/guest/codex/redeem": {
        // A guest types (or scans) an unlock code — a QR on the wall, a
        // puzzle's answer. Journaled; a miss is a story event too.
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const code = str(body, "code").trim();
        if (code === "") {
          sendJson(res, 400, { error: "empty code" });
          return true;
        }
        const events = this.commit("redeem", id, code);
        this.fanout(events);
        const hit = events.find((e): e is Extract<SimEvent, { type: "codexUnlocked" }> => e.type === "codexUnlocked" && e.person === id);
        sendJson(res, 200, { ok: true, unlocked: hit !== undefined ? hit.entry : null, codex: guestView(this.sim!, id).codex });
        return true;
      }
      case "/api/guest/codex/share": {
        // Knowledge changes hands: a guest shares an entry they hold with
        // another participant or a listed character.
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const entry = str(body, "entry");
        const to = str(body, "to");
        if (!this.sim!.holdsCodex(id, entry)) {
          sendJson(res, 404, { error: "you don't hold that entry" });
          return true;
        }
        if (!this.sim!.persons.has(to) && !this.sim!.model.characters.has(to)) {
          sendJson(res, 404, { error: "unknown recipient" });
          return true;
        }
        this.fanout(this.commit("share", id, to, entry));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/prime/codex/share": {
        // A performer shares one of their character's entries with a guest.
        const token = tokenOf(req, body);
        const character = this.sessions.characterOf(token);
        if (!character) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const entry = str(body, "entry");
        const to = str(body, "to");
        if (!this.sim!.holdsCodex(character, entry)) {
          sendJson(res, 404, { error: "your character doesn't hold that entry" });
          return true;
        }
        if (!this.sim!.persons.has(to) && !this.sim!.model.characters.has(to)) {
          sendJson(res, 404, { error: "unknown recipient" });
          return true;
        }
        this.fanout(this.commit("share", character, to, entry));
        sendJson(res, 200, { ok: true });
        return true;
      }

      // --- performer (prime) login: grants the `character` capability ---
      case "/api/prime/login": {
        if (this.throttled(req, res)) return true;
        const character = str(body, "character");
        if (!passOk(str(body, "passcode"), this.codes.prime)) {
          this.loginFailures.record(ipOf(req));
          sendJson(res, 403, { error: "bad passcode" });
          return true;
        }
        if (this.sim !== null && !this.sim.model.characters.has(character)) {
          sendJson(res, 404, { error: "unknown character" });
          return true;
        }
        let token = tokenOf(req, body);
        if (token && this.sessions.grant(token, { character })) {
          /* upgraded in place */
        } else {
          token = randomUUID();
          this.sessions.set(token, { character, admin: false });
        }
        this.persistSessions();
        sendJson(res, 200, { token, character, admin: this.sessions.canModerate(token) });
        return true;
      }

      // --- unified scan: capability decides what it does ---
      case "/api/scan": {
        const token = tokenOf(req, body);
        if (!this.sessions.canScan(token)) {
          sendJson(res, 403, { error: "no scan capability — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const target = str(body, "target");
        if (!this.sim!.persons.has(target)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        const admin = this.sessions.canModerate(token);
        const chosen = str(body, "as");
        let scanAs = this.sessions.characterOf(token);
        if (chosen && admin) {
          if (!this.sim!.model.characters.has(chosen)) {
            sendJson(res, 404, { error: "unknown character" });
            return true;
          }
          scanAs = chosen;
        }
        let responses: string[] = [];
        if (scanAs !== null) {
          const events = this.commit("scan", scanAs, target);
          responses = events
            .filter((e): e is Extract<SimEvent, { type: "respond" }> => e.type === "respond" && e.to === scanAs)
            .map((e) => e.text);
          this.fanout(events);
        }
        sendJson(res, 200, {
          ok: true,
          scannedAs: scanAs,
          canModerate: admin,
          responses,
          guest: admin
            ? rosterRow(this.sim!, target)
            : { id: target, name: this.sim!.persons.get(target)?.name ?? target, captured: this.sim!.isCaptured(target) },
        });
        return true;
      }

      // --- performer types into a channel (hybrid chat) ---
      case "/api/prime/act": {
        // A performer fires a `who: performer` INTERACTION on a guest, as
        // their character: only that character's hooks hear it (plus role
        // hooks and story rules). `who: admin` needs moderator powers.
        const token = tokenOf(req, body);
        if (!this.sessions.canScan(token)) {
          sendJson(res, 403, { error: "no performer capability — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const name = str(body, "name");
        const guest = str(body, "guest");
        const def = this.sim!.model.interactions.get(name);
        const admin = this.sessions.canModerate(token);
        if (def === undefined || def.who === "guest" || (def.who === "admin" && !admin)) {
          sendJson(res, 404, { error: "no such interaction for performers" });
          return true;
        }
        if (!this.sim!.persons.has(guest)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        const character = this.sessions.characterOf(token);
        this.fanout(this.commit("signal", name, guest, null, character));
        sendJson(res, 200, { ok: true, guest: rosterRow(this.sim!, guest) });
        return true;
      }
      case "/api/prime/say": {
        const token = tokenOf(req, body);
        const character = this.sessions.characterOf(token);
        if (!character) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const text = str(body, "text").trim();
        if (text === "") {
          sendJson(res, 400, { error: "empty message" });
          return true;
        }
        let channel = str(body, "channel") || "lobby";
        let audience: "all" | string[] | undefined;
        if (channel.startsWith("guest:")) {
          const gid = channel.slice("guest:".length);
          if (!this.sim!.persons.has(gid)) {
            sendJson(res, 404, { error: "unknown guest" });
            return true;
          }
          channel = `dm:${character}`;
          audience = [gid];
        }
        const parentSeq = this.sim!.threadableOf(channel) && body["parentSeq"] != null ? Number(body["parentSeq"]) : null;
        this.fanout(this.commit("say", character, channel, text, parentSeq, audience));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/prime/channel/invite": {
        const character = this.sessions.characterOf(tokenOf(req, body));
        if (!character) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        this.fanout(this.commit("inviteToChannel", character, str(body, "person"), str(body, "channel")));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/prime/channel/leave": {
        const character = this.sessions.characterOf(tokenOf(req, body));
        if (!character) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        this.fanout(this.commit("leaveChannel", character, str(body, "channel")));
        sendJson(res, 200, { ok: true });
        return true;
      }

      // --- moderator login: grants the `admin` capability ---
      case "/api/mod/login": {
        if (this.throttled(req, res)) return true;
        if (!passOk(str(body, "passcode"), this.codes.mod)) {
          this.loginFailures.record(ipOf(req));
          sendJson(res, 403, { error: "bad passcode" });
          return true;
        }
        let token = tokenOf(req, body);
        if (token && this.sessions.grant(token, { admin: true })) {
          /* upgraded in place */
        } else {
          token = randomUUID();
          this.sessions.set(token, { character: null, admin: true });
        }
        this.persistSessions();
        sendJson(res, 200, {
          token,
          character: this.sessions.characterOf(token),
          eventPass: this.codes.event,
          primePass: this.codes.prime,
          modPass: this.codes.mod,
        });
        return true;
      }
      default:
        return false;
    }
  }

  /** Admin-only routes (caller already proven to hold the mod capability).
   *  `by` is the director's display name — every mutation below journals it. */
  private handleMod(res: ServerResponse, path: string, body: Record<string, unknown>, by: string): boolean {
    this.actingBy = by;
    try {
      return this.handleModInner(res, path, body, by);
    } finally {
      this.actingBy = undefined;
    }
  }

  private handleModInner(res: ServerResponse, path: string, body: Record<string, unknown>, by: string): boolean {
    switch (path) {
      case "/api/mod/load": {
        const source = str(body, "source") || this.scenarioSource;
        const name = str(body, "name") || this.scenarioName;
        this.restart(source, name, { by });
        sendJson(res, 200, { ok: true, phase: this.phase });
        return true;
      }
      case "/api/mod/start": {
        this.openDoors();
        sendJson(res, 200, { ok: true, phase: this.phase });
        return true;
      }
      case "/api/mod/stop": {
        this.pause();
        sendJson(res, 200, { ok: true, phase: this.phase });
        return true;
      }
      case "/api/mod/reset": {
        this.restart(undefined, undefined, { by });
        sendJson(res, 200, { ok: true, phase: this.phase });
        return true;
      }
      case "/api/mod/codes": {
        // Every codex entry with a code also gets its printable join link —
        // the QR a guest scans on the wall: `?code=<event>&unlock=<code>`.
        const base = this.joinBase();
        const codex = [...(this.sim?.model.codex.values() ?? [])]
          .filter((e) => e.code !== null)
          .map((e) => ({
            id: e.id,
            title: e.title,
            about: e.about,
            code: e.code,
            url: `${base}/?code=${encodeURIComponent(this.codes.event)}&unlock=${encodeURIComponent(e.code!)}`,
          }));
        sendJson(res, 200, {
          eventPass: this.codes.event,
          primePass: this.codes.prime,
          modPass: this.codes.mod,
          joinUrl: base,
          codex,
        });
        return true;
      }
      case "/api/mod/codex": {
        // A director (or show hardware through the mod API — an Arduino
        // puzzle solved, a VR goose caught) hands an entry to a holder.
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const who = str(body, "who");
        const entry = str(body, "entry");
        if (!this.sim.persons.has(who) && !this.sim.model.characters.has(who)) {
          sendJson(res, 404, { error: "unknown holder" });
          return true;
        }
        if (!this.sim.model.codex.has(entry) && this.sim.model.codexIndex.get(entry) === null) {
          sendJson(res, 404, { error: "unknown codex entry" });
          return true;
        }
        this.fanout(this.commit("unlock", who, entry));
        sendJson(res, 200, { ok: true, holders: this.sim.codexHolders(entry) });
        return true;
      }
      case "/api/mod/act": {
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const id = str(body, "id");
        if (!this.sim.persons.has(id)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        switch (str(body, "action")) {
          case "capture":
            this.fanout(this.commit("capture", id));
            break;
          case "release":
            this.fanout(this.commit("escape", id));
            break;
          default:
            sendJson(res, 400, { error: "unknown action" });
            return true;
        }
        sendJson(res, 200, { ok: true, guest: rosterRow(this.sim, id) });
        return true;
      }
      case "/api/mod/signal": {
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const subject = str(body, "subject");
        // Optional JSON arguments (`{ level: 3 }`) bind by name in listening
        // bodies, like `fire name with level: 3` (Loom 4 §9.2).
        const rawArgs = body["args"];
        const args = rawArgs !== null && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : null;
        // Fired *as* a character (the performer-lens interaction path, like
        // `/api/prime/act`): only that character's hooks hear it.
        const actor = str(body, "actor");
        if (actor !== "" && !this.sim.model.characters.has(actor)) {
          sendJson(res, 404, { error: "unknown character" });
          return true;
        }
        this.fanout(this.commit("signal", str(body, "name"), subject === "" ? undefined : subject, args, actor === "" ? null : actor));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/mod/broadcast": {
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const scope = str(body, "scope");
        const cue = str(body, "cue") || "cue";
        const synthetic: SimEvent = { type: "broadcast", cue, audience: this.sim.audienceFor(scope), scope };
        const stored = this.chat.append(composeGuestMessages(this.sim, [synthetic]));
        for (const m of stored) this.deliverMessage(m);
        this.pushSnapshots();
        sendJson(res, 200, { ok: true, reached: stored.reduce((n, m) => n + (m.audience === "all" ? -1 : m.audience.length), 0) });
        return true;
      }
      case "/api/mod/message": {
        const seq = Number(body["seq"] ?? -1);
        const hide = body["hidden"] === true;
        const m = this.chat.setHidden(seq, hide);
        if (m === null) {
          sendJson(res, 404, { error: "unknown message" });
          return true;
        }
        this.store.saveHidden(this.chat.hiddenSeqs());
        for (const c of this.clients) {
          if (c.role === "guest") {
            if (!visibleTo(m, c.id)) continue;
            if (m.hidden) sseSend(c.res, "messageModerated", { seq: m.seq, hidden: true });
            else sseSend(c.res, "message", forGuest(m));
          } else if (c.role === "mod" || visibleToPrime(m, c)) {
            sseSend(c.res, "messageModerated", m);
          }
        }
        sendJson(res, 200, { ok: true, seq, hidden: m.hidden });
        return true;
      }
      case "/api/mod/say": {
        // The operator types into *any* room — as themselves ("Operator") or
        // in a character's voice (`as`). Unlike a guest `say`, this bypasses
        // the post policy (an operator can post into a read-only feed).
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const text = str(body, "text").trim();
        if (text === "") {
          sendJson(res, 400, { error: "empty message" });
          return true;
        }
        const as = str(body, "as");
        const speaker = as !== "" ? as : "Operator";
        // Who may speak: the stage voices, any character, or a participant.
        // Anything else is a typo, not a new voice.
        const isPerson = this.sim.persons.has(speaker);
        const isCharacter = this.sim.model.characters.has(speaker);
        if (!isPerson && !isCharacter && speaker !== "Operator" && speaker !== "Narrator") {
          sendJson(res, 404, { error: "unknown speaker" });
          return true;
        }
        let channel = str(body, "channel") || "lobby";
        let audience: "all" | string[] | undefined;
        // Address one guest's DM thread: `channel: "guest:<id>"`.
        if (channel.startsWith("guest:")) {
          const gid = channel.slice("guest:".length);
          if (!this.sim.persons.has(gid)) {
            sendJson(res, 404, { error: "unknown guest" });
            return true;
          }
          if (isPerson) {
            // Participants speak in rooms; characters and the Operator DM.
            sendJson(res, 403, { error: `${this.sim.persons.get(speaker)!.name} can't DM a guest — speak in a room` });
            return true;
          }
          channel = `dm:${speaker}`;
          audience = [gid];
        }
        // Speaking *as* a participant obeys their post policy exactly like
        // their own `/api/guest/say` would (presence in a location room,
        // read-only feeds, membership) — a director can't route around it by
        // borrowing a real guest's name. (Slow mode is not applied: a puppet
        // is the director's own voice.)
        if (isPerson && !this.sim.canPost(speaker, channel)) {
          sendJson(res, 403, { error: `you can't post here as ${this.sim.persons.get(speaker)!.name}` });
          return true;
        }
        const parentSeq = this.sim.threadableOf(channel) && body["parentSeq"] != null ? Number(body["parentSeq"]) : null;
        this.fanout(this.commit("say", speaker, channel, text, parentSeq, audience), isPerson ? by : undefined);
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/mod/set": {
        // Live-edit a guest's stats from the run panel's inspector.
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const id = str(body, "id");
        if (!this.sim.persons.has(id)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        const field = str(body, "field");
        const value = body["value"];
        switch (field) {
          case "score":
            this.fanout(this.commit("setScore", id, Number(value ?? 0)));
            break;
          case "faction": {
            const to = str(body, "value");
            if (to === "") {
              sendJson(res, 400, { error: "faction required" });
              return true;
            }
            this.fanout(this.commit("defect", id, to));
            break;
          }
          case "location": {
            const to = str(body, "value");
            if (to === "") {
              sendJson(res, 400, { error: "location required" });
              return true;
            }
            this.fanout(this.commit("arrive", id, to));
            break;
          }
          case "captured": {
            const on = value === true || value === "true";
            // `capture` is idempotent; `escape` only fires on a real transition.
            this.fanout(this.commit(on ? "capture" : "escape", id));
            break;
          }
          default:
            sendJson(res, 400, { error: "unknown field" });
            return true;
        }
        sendJson(res, 200, { ok: true, guest: rosterRow(this.sim, id) });
        return true;
      }
      case "/api/mod/beat": {
        // Fire a named story beat directly (booth live-patch).
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const name = str(body, "name");
        if (name === "" || !this.sim.model.beats.has(name)) {
          sendJson(res, 404, { error: "unknown beat" });
          return true;
        }
        const subject = str(body, "subject");
        this.fanout(this.commit("fireBeat", name, subject === "" ? undefined : subject));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/mod/scan": {
        // Scan a guest *as* a character — fires that character's scan hooks
        // against them (the beat-firing the operator console does via /api/scan,
        // reachable here through the owning author's session).
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const as = str(body, "as");
        const target = str(body, "target");
        if (!this.sim.model.characters.has(as)) {
          sendJson(res, 404, { error: "unknown character" });
          return true;
        }
        if (!this.sim.persons.has(target)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        const scanEvents = this.commit("scan", as, target);
        const responses = scanEvents
          .filter((e): e is Extract<SimEvent, { type: "respond" }> => e.type === "respond" && e.to === as)
          .map((e) => e.text);
        this.fanout(scanEvents);
        sendJson(res, 200, { ok: true, guest: rosterRow(this.sim, target), responses });
        return true;
      }
      case "/api/mod/reveal": {
        // Expose a hidden faction (the secret-villain reveal).
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const faction = str(body, "faction");
        if (!this.sim.model.factions.has(faction)) {
          sendJson(res, 404, { error: "unknown faction" });
          return true;
        }
        this.fanout(this.commit("reveal", faction));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/mod/var": {
        // Write any world variable — the World browser's inline editing.
        // Person-standard fields (`<id>.location` / `.faction` / …) route
        // through the proper mutators inside `Sim.setVar`, so hooks fire.
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const path = str(body, "path").trim();
        if (path === "") {
          sendJson(res, 400, { error: "missing path" });
          return true;
        }
        this.fanout(this.commit("setVar", path, str(body, "value")));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/mod/persona": {
        // Spawn a test persona — a guest the director puppets, no passcode
        // and no play-app registration. This is what makes a server-hosted
        // preview a *shared rehearsal*: every co-writer moderating the same
        // event adds their own persona and plays it from their cockpit
        // (speak via `say` with `as`, answer choices via `choose`).
        // Journaled through the same `createPerson` as a real guest.
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const name = str(body, "name") || "Persona";
        const id = `p-${randomUUID().slice(0, 6)}`;
        // Ownership is runtime state, not a sim fact: it names which director
        // puppets this persona (the rail's "you" / "Ana's persona" chips) and
        // survives a reload of their editor.
        this.personaOwners.set(id, by);
        this.persistMeta();
        this.fanout(this.commit("createPerson", id, name));
        sendJson(res, 200, { ok: true, guest: { ...rosterRow(this.sim, id)!, owner: by } });
        return true;
      }
      case "/api/mod/choose": {
        // Answer a pending choice on a participant's behalf (or a `__global`
        // unbound story menu) — the moderator twin of `/api/guest/choose`,
        // journaled through the same `choose` mutation.
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const person = str(body, "person");
        if (person === "") {
          sendJson(res, 400, { error: "missing person" });
          return true;
        }
        const idx = Number(body["index"] ?? -1);
        this.fanout(this.commit("choose", person, idx));
        sendJson(res, 200, { ok: true });
        return true;
      }
      default:
        sendJson(res, 404, { error: "unknown mod action" });
        return true;
    }
  }
}
