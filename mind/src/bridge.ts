//! The mind: one loop that turns a character's incoming DMs into replies.
//!
//!   mod SSE feed ──message──▶ isForCharacter? ──▶ per-guest queue
//!        ▲                                            │
//!        │                                  gather state (mod + guest view)
//!        │                                  build prompt · call the model
//!        │                                  parse reply · clamp adjustments
//!        └── /api/mod/say ◀── /api/mod/var ◀──────────┘
//!
//! Everything the bridge sends is an ordinary journaled mutation, so the
//! model can move the story's numbers but the story's own `when` rules
//! decide what the numbers mean. The bridge is stateless across restarts:
//! the feed's `history` frame is read for thread context but never
//! answered, so a restart doesn't replay a night of replies.

import type { ModClient } from "./mod-api.ts";
import type { Persona } from "./persona.ts";
import { buildMessages, type Entry, type GuestContext, type MindState, type ThreadLine } from "./prompt.ts";
import { applyDelta, parseReply, type Reply } from "./reply.ts";
import { complete } from "./llm.ts";
import { streamSse } from "./sse.ts";

/** The slice of a chat message the bridge reads (mirror of `server/chat.ts`). */
export interface FeedMessage {
  seq: number;
  channel: string;
  from: string;
  kind: string;
  text: string;
  audience: "all" | string[];
  hidden?: boolean;
}

/** Is this a guest's typed line into the character's DM thread? Returns the guest id. */
export function guestOfDm(m: FeedMessage, character: string): string | null {
  if (m.channel !== `dm:${character}`) return null;
  if (m.kind !== "line" || m.hidden === true) return null;
  if (m.from === character) return null;
  if (m.audience === "all" || m.audience.length !== 1) return null;
  return m.audience[0]!;
}

/** The `<character>.<var>` numbers out of a ModView's world table. */
export function variablesFrom(world: Array<{ path: string; value: string }>, character: string, names: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of names) {
    const row = world.find((w) => w.path === `${character}.${name}`);
    const n = row === undefined ? NaN : Number(row.value);
    if (Number.isFinite(n)) out[name] = n;
  }
  return out;
}

/** Selected world facts to tell the model about (phase, endings, …). */
export function factsFrom(world: Array<{ path: string; value: string }>, prefixes: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const w of world) if (prefixes.some((p) => w.path.startsWith(p))) out[w.path] = w.value;
  return out;
}

interface ModViewLite {
  world: Array<{ path: string; value: string }>;
  roster: Array<{ id: string; name: string; faction: string | null }>;
}
interface GuestViewLite {
  id: string;
  name: string;
  faction: string | null;
  codex: Entry[];
}
interface PrimeViewLite {
  codex: Entry[];
}

export interface BridgeOptions {
  client: ModClient;
  persona: Persona;
  /** Overrides for the persona's model settings (CLI flags). */
  model?: string;
  endpoint?: string;
  apiKey?: string;
  /** Print what would be sent instead of sending it. */
  dryRun?: boolean;
  /** World paths (prefixes) beyond the character's own to show the model. */
  factPrefixes?: string[];
  /** Guest-side world facts to show (`humanity`, `truth`, …). */
  guestFacts?: string[];
  log?: (line: string) => void;
  /** Injected for tests. */
  completeImpl?: typeof complete;
  /** Max thread lines kept per guest. */
  threadLimit?: number;
}

export class Mind {
  private readonly threads = new Map<string, ThreadLine[]>();
  private readonly seen = new Set<number>();
  private readonly busy = new Map<string, Promise<void>>();
  private latestWorld: Array<{ path: string; value: string }> = [];
  private live = false;

  constructor(private readonly o: BridgeOptions) {}

  private log(line: string): void {
    (this.o.log ?? ((l: string) => process.stderr.write(l + "\n")))(line);
  }

  get character(): string {
    return this.o.persona.character;
  }

  /** Feed one SSE frame. Exposed so a test can drive the mind without a socket. */
  async onFrame(event: string, data: string): Promise<void> {
    if (event === "snapshot") {
      const snap = JSON.parse(data) as Partial<ModViewLite>;
      if (Array.isArray(snap.world)) this.latestWorld = snap.world;
      return;
    }
    if (event === "history") {
      // Context only — never answer the past.
      for (const m of JSON.parse(data) as FeedMessage[]) this.remember(m);
      this.live = true;
      return;
    }
    if (event !== "message") return;
    const m = JSON.parse(data) as FeedMessage;
    if (this.seen.has(m.seq)) return;
    this.remember(m);
    if (!this.live) return;
    const guest = guestOfDm(m, this.character);
    if (guest === null) return;
    // One reply at a time per guest, in order; other guests proceed in parallel.
    const prior = this.busy.get(guest) ?? Promise.resolve();
    const next = prior
      .then(async () => {
        await this.answer(guest);
      })
      .catch((e: unknown) => this.log(`✗ ${guest}: ${(e as Error).message}`));
    this.busy.set(guest, next);
    await next;
  }

  private remember(m: FeedMessage): void {
    if (this.seen.has(m.seq)) return;
    this.seen.add(m.seq);
    if (m.channel !== `dm:${this.character}` || m.kind !== "line") return;
    const mine = m.from === this.character;
    const guest = mine ? (m.audience !== "all" ? m.audience[0] : undefined) : guestOfDm(m, this.character) ?? undefined;
    if (guest === undefined) return;
    const t = this.threads.get(guest) ?? [];
    t.push({ mine, text: m.text });
    const limit = this.o.threadLimit ?? 40;
    if (t.length > limit) t.splice(0, t.length - limit);
    this.threads.set(guest, t);
  }

  /** Compose + send one reply to `guest`, based on everything said so far. */
  async answer(guest: string): Promise<Reply> {
    const c = this.o.client;
    const persona = this.o.persona;
    const [mod, gv, pv] = await Promise.all([
      c.modState<ModViewLite>(),
      c.guestState<GuestViewLite>(guest),
      c.primeState<PrimeViewLite>(this.character),
    ]);
    this.latestWorld = mod.world;
    const state: MindState = {
      variables: variablesFrom(mod.world, this.character, persona.variables),
      codex: pv.codex ?? [],
      facts: factsFrom(mod.world, this.o.factPrefixes ?? ["Night."]),
    };
    const guestFacts: Record<string, string> = {};
    for (const f of this.o.guestFacts ?? ["humanity", "truth", "doubt", "left_behind"]) {
      const row = mod.world.find((w) => w.path === `${guest}.${f}`);
      if (row !== undefined) guestFacts[f] = row.value;
    }
    const ctx: GuestContext = { id: guest, name: gv.name, faction: gv.faction, codex: gv.codex ?? [], facts: guestFacts };
    const messages = buildMessages(persona, state, ctx, this.threads.get(guest) ?? []);
    const raw = await (this.o.completeImpl ?? complete)(messages, {
      endpoint: this.o.endpoint ?? persona.endpoint,
      model: this.o.model ?? persona.model,
      temperature: persona.temperature,
      maxTokens: persona.maxTokens,
      apiKey: this.o.apiKey,
    });
    const reply = parseReply(raw, persona.variables, persona.maxStep);
    await this.deliver(guest, reply, state.variables);
    return reply;
  }

  private async deliver(guest: string, reply: Reply, current: Record<string, number>): Promise<void> {
    const c = this.o.client;
    if (reply.say.length > 0) {
      this.log(`${this.character} → ${guest}: ${reply.say}`);
      if (!this.o.dryRun) await c.say(this.character, guest, reply.say);
      // The feed will echo it back; remember it now so a fast follow-up
      // question already sees the answer in context.
      const t = this.threads.get(guest) ?? [];
      t.push({ mine: true, text: reply.say });
      this.threads.set(guest, t);
    }
    for (const [name, delta] of Object.entries(reply.adjust)) {
      const value = applyDelta(current[name] ?? 0, delta);
      this.log(`  ${this.character}.${name} ${delta >= 0 ? "+" : ""}${delta} → ${value}`);
      if (!this.o.dryRun) await c.setVar(`${this.character}.${name}`, value);
    }
  }

  /** Run forever: stream the mod feed, reconnecting with backoff. */
  async run(signal?: AbortSignal): Promise<void> {
    const c = this.o.client;
    let backoff = 1000;
    while (!signal?.aborted) {
      try {
        await c.ensureToken();
        this.live = false;
        this.log(`⇄ ${c.feedUrl} as ${this.character}`);
        await streamSse(c.feedUrl, c.headers(), (f) => this.onFrame(f.event, f.data), signal);
        this.log("feed closed");
        backoff = 1000;
      } catch (e) {
        if (signal?.aborted) break;
        this.log(`feed error: ${(e as Error).message} — retrying in ${backoff / 1000}s`);
        // A 403 means the token died (the run restarted) — log in again.
        if (/403/u.test((e as Error).message)) c.token = null;
      }
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
}
