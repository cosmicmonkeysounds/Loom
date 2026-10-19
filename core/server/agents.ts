//! Agent-voiced characters — the server half of the stagehand **agents**
//! protocol.
//!
//! A `CHARACTER` marked `mind: external` has no performer. When someone
//! messages it (a guest in its `dm:` thread, a performer in their `cast:`
//! thread with it, a director's persona), the event runtime asks this hub
//! for a reply. The hub turns the thread into an **agent request** and
//! pushes it to a connected worker (a stagehand process with the agents
//! module — "Trabolta on the laptop"), which answers with
//! `POST /api/agent/reply`. The runtime commits the reply as an ordinary
//! journaled `say` (+ clamped variable writes), so a replay reproduces
//! the night exactly and the worker is never trusted with anything a mod
//! token couldn't already do.
//!
//!   participant says ──▶ AgentHub.line(thread)
//!                          │ open request on the thread? → mark follow-up
//!                          │ else build request → dispatch to a worker
//!                          ▼                         (queued if none online)
//!   worker SSE  ◀── request {id, character, speaker, text, history, state}
//!   worker      ──▶ POST /api/agent/reply {id, say, adjust}
//!                          │ commit say + vars; typing off
//!                          └ follow-up pending? → a fresh request
//!
//! With no worker online the request waits in the queue; after
//! `holdAfterMs` (20 s) the hub asks the runtime to post the character's
//! authored hold line (`CHARACTER … hold: …`) once, so a guest is never left
//! in silence when the laptop is down. The request stays queued, so a worker
//! that comes back still answers it.
//!
//! **Behind, and stalled** (wave 11, single-worker first — the show runs one
//! laptop). A worker answers its line one request at a time, so a burst
//! waits: a request that has waited `busyAfterMs` (40 s) on a worker still
//! answering posts the character's authored busy line (`CHARACTER … busy:
//! …`) **once per thread**. A worker whose head request goes unanswered
//! `stallAfterMs` (60 s) is **stalled** — connected, but not answering: one
//! `# hosts` line (`stalled`), the hold line once in every thread waiting on
//! it, and no new work while it stays stalled. New requests stay queued in
//! the hub, except that a stalled worker with nothing in hand gets the
//! oldest one (a *probe*: a lone laptop has to have something to answer to
//! show it is back); what it already holds keeps the reply timeout's
//! retries as before. The stall clears on its next answer or a reconnect
//! (a new stream is a new worker); the queue then goes to it at once. No
//! request is ever moved between workers on a stall.
//!
//! A thread hears the hold line once until the character really speaks in
//! it (an answer, or a director's answer by hand), however many requests
//! the guest's lines open meanwhile — the live twin of the restore rule.
//!
//! One open request per thread keeps a burst of three messages from
//! producing three replies: the model answers once, then once more with
//! everything said meanwhile. The hub is transport-agnostic — workers are
//! `send` callbacks, the request body comes from the runtime's `build` —
//! so it tests without sockets or a sim.

/** Who is talking to the character. */
export interface AgentSpeaker {
  kind: "guest" | "performer";
  /** Guest id, or the performer's character name. */
  id: string;
  name: string;
  faction: string | null;
}

/** Where a conversation lives: the character's `dm:` channel, narrowed to
 *  one counterpart by `audience` (`[guestId]` or `["@Character"]`). */
export interface AgentThread {
  character: string;
  channel: string;
  audience: string[];
}

/** One line of the thread as the worker sees it, oldest first. */
export interface AgentLine {
  seq: number;
  /** True when the agent character said it. */
  mine: boolean;
  from: string;
  text: string;
}

/** What a worker receives: everything needed to answer, no follow-up reads. */
export interface AgentRequest {
  id: string;
  character: string;
  thread: AgentThread;
  speaker: AgentSpeaker;
  /** The line that prompted the request (the newest from the speaker). */
  text: string;
  history: AgentLine[];
  /** The character's own state: `<Character>.*` world values + its codex. */
  self: { vars: Record<string, string>; ranges: Record<string, [number, number]>; codex: AgentCodexEntry[] };
  /** The speaker's state: `<id>.*` world values + their codex (guests). */
  them: { vars: Record<string, string>; codex: AgentCodexEntry[]; location: string | null };
  /** Global world facts (paths whose head is neither a guest nor a character). */
  world: Record<string, string>;
  /** The powers this character may exercise from a reply: every
   *  `INTERACTION … who: agent`, with how many uses are left this run. */
  powers: AgentPower[];
  /** Server wall clock when the request was built. */
  at: number;
}

/** An `INTERACTION … who: agent` — something the story lets the agent
 *  *do*, not just say. Using one fires the named event as the character
 *  (only its own hooks hear it), with the thread's guest as subject. */
export interface AgentPower {
  id: string;
  label: string;
  description: string | null;
  /** Uses per run (`limit:`), or null for unlimited. */
  limit: number | null;
  /** Uses so far this run. */
  used: number;
}

/**
 * Something a worker asks the server to do alongside a reply — the
 * bargains. Every act is validated against the story (an entry the
 * character actually holds; a power actually declared for agents and not
 * over its limit) and committed as an ordinary journaled mutation, so the
 * worker can do nothing a director couldn't, and a replay reproduces it.
 */
export type AgentAct =
  /** Share a codex entry the character holds (default: with the thread's counterpart). */
  | { kind: "share"; entry: string; to?: string }
  /** Use a declared power: fire the named event as the character. */
  | { kind: "fire"; name: string; subject?: string; args?: Record<string, string | number | boolean> };

/** The outcome of one requested act, in order. */
export interface AgentActResult {
  kind: AgentAct["kind"];
  ok: boolean;
  /** `entry` / `name` as resolved by the story. */
  what: string;
  error?: string;
  /** A fire the story answered with words only (a refusal): not counted
   *  against the power's limit. */
  refused?: boolean;
}

/**
 * Everything knowable about the live session, in one document, for a
 * worker that wants to *look things up* (`GET /api/agent/facts`): who is
 * here, where they stand, what they hold, and what the world says. This
 * is the "all facts present in the current Loom session" surface — it is
 * mod-gated, and the worker decides what its character may know.
 */
export interface AgentFacts {
  at: number;
  /** Global world paths (`Night.phase`), as display strings. */
  world: Record<string, string>;
  programs: AgentFactsPerson[];
  characters: AgentFactsCharacter[];
  locations: Array<{ id: string; label: string; occupants: string[] }>;
  codex: Array<{ id: string; title: string; about: string | null; text: string; holders: string[]; hasCode: boolean }>;
  powers: AgentPower[];
}

export interface AgentFactsPerson {
  id: string;
  name: string;
  /** Public faction (a hidden one reads as null until revealed). */
  faction: string | null;
  groups: string[];
  location: string | null;
  captured: boolean;
  vars: Record<string, string>;
  /** Titles of the entries they hold. */
  codex: string[];
}

export interface AgentFactsCharacter {
  id: string;
  faction: string | null;
  listed: boolean;
  /** `mind: external` etc. */
  mind: string | null;
  online: boolean;
  vars: Record<string, string>;
  codex: string[];
}

/**
 * What a worker mirrors back about a character's evolving mind
 * (`POST /api/agent/mind`) — the whole thing, so the director's Mind page
 * can draw it: the brief and mood the voice is handed, where the character
 * stands on its declared arc (with the history of every move), its drives
 * (the mind's own 0–100 dials), its policy on bargains, the questions it is
 * collecting answers to, notes, dossiers, thread summaries, what it learned
 * and what it made of it, director whispers still pending, and the numbered
 * revision log (the scrubber). `status` is the worker's own state: models,
 * whether reasoning is visible, whether the orchestrator is paused, what is
 * queued.
 */
export interface AgentMindReport {
  character: string;
  worker: string;
  brief: string;
  mood: string;
  stage: string;
  stageSince: number;
  stages: string[];
  stageHistory: Array<{ stage: string; at: number; why: string; by: string; rev: number }>;
  drives: Record<string, number>;
  policy: { favours: string; credit: string[]; wary: string[]; note: string };
  questions: Array<{ q: string; answers: string[] }>;
  notes: string[];
  learned: Array<{ claim: string; from: string; verdict: string }>;
  world: string[];
  director: string[];
  people: AgentMindPerson[];
  threads: Array<{ key: string; summary: string; upto: number; lines: number }>;
  revisions: AgentMindRevision[];
  rev: number;
  exchanges: number;
  reflections: number;
  surveys: number;
  updatedAt: number;
  status: Record<string, unknown>;
}

export interface AgentMindPerson {
  id: string;
  name: string;
  kind: string;
  summary: string;
  trust: number;
  promises: string[];
  asks: string[];
  claims: string[];
  turns: number;
  lastSeen: number;
}

/** One numbered change to the mind: who made it, what it touched, the
 *  thought that produced it, and the small fields as they then stood. */
export interface AgentMindRevision {
  rev: number;
  at: number;
  by: string;
  touched: string[];
  thought: string | null;
  brief: string;
  mood: string;
  stage: string;
  drives: Record<string, number>;
  policy_favours: string;
  notes: number;
  people: number;
  learned: number;
}

const s_ = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const n_ = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const strs = (v: unknown, count: number, max: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-count).map((x) => x.slice(0, max)) : []);
const objs = (v: unknown, count: number): Array<Record<string, unknown>> =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x)).slice(-count) : [];
const numMap = (v: unknown, count: number): Record<string, number> => {
  const out: Record<string, number> = {};
  if (v === null || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, count)) if (typeof x === "number" && Number.isFinite(x)) out[k.slice(0, 40)] = Math.round(x);
  return out;
};

/** Sanitise a worker's mind report: strings only, bounded, no surprises. */
export function agentMindReport(raw: unknown): AgentMindReport | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const character = s_(r["character"], 80).trim();
  if (character === "") return null;
  const policyRaw = r["policy"] !== null && typeof r["policy"] === "object" ? (r["policy"] as Record<string, unknown>) : {};
  const status = r["status"] !== null && typeof r["status"] === "object" && !Array.isArray(r["status"]) ? (r["status"] as Record<string, unknown>) : {};
  return {
    character,
    worker: s_(r["worker"], 80),
    brief: s_(r["brief"], 2000),
    mood: s_(r["mood"], 200),
    stage: s_(r["stage"], 80),
    stageSince: n_(r["stageSince"]),
    stages: strs(r["stages"], 20, 80),
    stageHistory: objs(r["stageHistory"], 40).map((h) => ({ stage: s_(h["stage"], 80), at: n_(h["at"]), why: s_(h["why"], 300), by: s_(h["by"], 80), rev: n_(h["rev"]) })),
    drives: numMap(r["drives"], 12),
    policy: {
      favours: s_(policyRaw["favours"], 20) || "none",
      credit: strs(policyRaw["credit"], 12, 80),
      wary: strs(policyRaw["wary"], 12, 80),
      note: s_(policyRaw["note"], 300),
    },
    questions: objs(r["questions"], 8)
      .map((q) => ({ q: s_(q["q"], 200), answers: strs(q["answers"], 6, 260) }))
      .filter((q) => q.q !== ""),
    notes: strs(r["notes"], 60, 400),
    learned: objs(r["learned"], 60).map((e) => ({ claim: s_(e["claim"], 300), from: s_(e["from"], 80), verdict: s_(e["verdict"], 20) })).filter((e) => e.claim !== ""),
    world: strs(r["world"], 20, 300),
    director: strs(r["director"], 6, 400),
    people: objs(r["people"], 200)
      .map((p) => ({
        id: s_(p["id"], 80),
        name: s_(p["name"], 80),
        kind: s_(p["kind"], 20) || "guest",
        summary: s_(p["summary"], 600),
        trust: Math.round(n_(p["trust"])),
        promises: strs(p["promises"], 12, 300),
        asks: strs(p["asks"], 12, 300),
        claims: strs(p["claims"], 12, 300),
        turns: Math.round(n_(p["turns"])),
        lastSeen: n_(p["lastSeen"]),
      }))
      .filter((p) => p.id !== ""),
    threads: objs(r["threads"], 60).map((t) => ({ key: s_(t["key"], 200), summary: s_(t["summary"], 1200), upto: n_(t["upto"]), lines: n_(t["lines"]) })),
    revisions: objs(r["revisions"], 120).map((v) => ({
      rev: n_(v["rev"]),
      at: n_(v["at"]),
      by: s_(v["by"], 80),
      touched: strs(v["touched"], 20, 40),
      thought: typeof v["thought"] === "string" ? v["thought"].slice(0, 40) : null,
      brief: s_(v["brief"], 2000),
      mood: s_(v["mood"], 200),
      stage: s_(v["stage"], 80),
      drives: numMap(v["drives"], 12),
      policy_favours: s_(v["policy_favours"], 20) || "none",
      notes: n_(v["notes"]),
      people: n_(v["people"]),
      learned: n_(v["learned"]),
    })),
    rev: n_(r["rev"]),
    exchanges: n_(r["exchanges"]),
    reflections: n_(r["reflections"]),
    surveys: n_(r["surveys"]),
    updatedAt: n_(r["updatedAt"]),
    status,
  };
}

/**
 * One recorded model call (or marker) from a worker's trace
 * (`POST /api/agent/trace`): what went in, what the model thought, what
 * came out, what the worker made of it, and the mind diff it caused. The
 * editor's Mind page is a viewer over these.
 */
export interface AgentThought {
  /** Server-side sequence, for `?after=` paging. */
  seq: number;
  id: string;
  character: string;
  worker: string;
  at: number;
  kind: "voice" | "lookup" | "reflect" | "survey" | "rerun" | "reset" | "control" | "error";
  trigger: string;
  model: { name: string; api: string; endpoint: string; temperature: number | null; max_tokens: number | null; reasoning_effort: string | null; think: boolean | string | null } | null;
  request_id: string | null;
  thread: { channel: string; audience: string[] } | null;
  speaker: { id: string; name: string; kind: string } | null;
  messages: Array<{ role: string; content: string }>;
  thinking: string;
  output: string;
  finish: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  ms: number;
  result: Record<string, unknown> | null;
  touched: string[];
  diff: Record<string, unknown>;
  revision: number | null;
  error: string | null;
  note: string;
}

const THOUGHT_KINDS = new Set<AgentThought["kind"]>(["voice", "lookup", "reflect", "survey", "rerun", "reset", "control", "error"]);
/** Characters kept per message / per output field on the server. */
const THOUGHT_TEXT_MAX = 32_000;

/** Sanitise one thought from a worker; null when it isn't one. */
export function agentThought(raw: unknown, worker: string): Omit<AgentThought, "seq"> | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = s_(r["id"], 40).trim();
  const character = s_(r["character"], 80).trim();
  const kind = s_(r["kind"], 20) as AgentThought["kind"];
  if (id === "" || character === "" || !THOUGHT_KINDS.has(kind)) return null;
  const model = r["model"] !== null && typeof r["model"] === "object" && !Array.isArray(r["model"]) ? (r["model"] as Record<string, unknown>) : null;
  const thread = r["thread"] !== null && typeof r["thread"] === "object" && !Array.isArray(r["thread"]) ? (r["thread"] as Record<string, unknown>) : null;
  const speaker = r["speaker"] !== null && typeof r["speaker"] === "object" && !Array.isArray(r["speaker"]) ? (r["speaker"] as Record<string, unknown>) : null;
  const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const think = model?.["think"];
  return {
    id,
    character,
    worker,
    at: n_(r["at"], Date.now() / 1000),
    kind,
    trigger: s_(r["trigger"], 80),
    model:
      model === null
        ? null
        : {
            name: s_(model["name"], 120),
            api: s_(model["api"], 20),
            endpoint: s_(model["endpoint"], 200),
            temperature: typeof model["temperature"] === "number" ? model["temperature"] : null,
            max_tokens: typeof model["max_tokens"] === "number" ? model["max_tokens"] : null,
            reasoning_effort: typeof model["reasoning_effort"] === "string" ? model["reasoning_effort"].slice(0, 20) : null,
            think: typeof think === "boolean" ? think : typeof think === "string" ? think.slice(0, 20) : null,
          },
    request_id: typeof r["request_id"] === "string" ? r["request_id"].slice(0, 40) : null,
    thread: thread === null ? null : { channel: s_(thread["channel"], 120), audience: strs(thread["audience"], 8, 80) },
    speaker: speaker === null ? null : { id: s_(speaker["id"], 80), name: s_(speaker["name"], 80), kind: s_(speaker["kind"], 20) || "guest" },
    messages: objs(r["messages"], 80).map((m) => ({ role: s_(m["role"], 20), content: s_(m["content"], THOUGHT_TEXT_MAX) })),
    thinking: s_(r["thinking"], THOUGHT_TEXT_MAX),
    output: s_(r["output"], THOUGHT_TEXT_MAX),
    finish: s_(r["finish"], 20),
    prompt_tokens: typeof r["prompt_tokens"] === "number" ? r["prompt_tokens"] : null,
    completion_tokens: typeof r["completion_tokens"] === "number" ? r["completion_tokens"] : null,
    ms: Math.round(n_(r["ms"])),
    result: obj(r["result"]),
    touched: strs(r["touched"], 20, 40),
    diff: obj(r["diff"]) ?? {},
    revision: typeof r["revision"] === "number" ? r["revision"] : null,
    error: typeof r["error"] === "string" ? r["error"].slice(0, 1000) : null,
    note: s_(r["note"], 400),
  };
}

/**
 * The server's copy of every worker's trace: a bounded ring per character
 * (a night of Trabolta is a few hundred thoughts; each carries its whole
 * prompt, so the cap is by count and by bytes). Survives a story restart —
 * a director debugging across resets wants the before as well as the
 * after; the worker adds a `reset` marker so the boundary is visible. Does
 * not survive a server restart; the worker replays its recent ring on
 * reconnect.
 */
export class AgentTraceLog {
  private readonly rings = new Map<string, AgentThought[]>();
  private readonly ids = new Set<string>();
  private seq = 0;
  private readonly perCharacter: number;
  private readonly maxBytes: number;

  constructor(perCharacter = 400, maxBytes = 24 * 1024 * 1024) {
    this.perCharacter = perCharacter;
    this.maxBytes = maxBytes;
  }

  /** Add a thought (ignored if that id is already held — replays are idempotent). */
  add(t: Omit<AgentThought, "seq">): AgentThought | null {
    if (this.ids.has(t.id)) return null;
    const full: AgentThought = { ...t, seq: ++this.seq };
    let ring = this.rings.get(t.character);
    if (ring === undefined) {
      ring = [];
      this.rings.set(t.character, ring);
    }
    ring.push(full);
    this.ids.add(t.id);
    while (ring.length > this.perCharacter) this.ids.delete(ring.shift()!.id);
    this.trimBytes();
    return full;
  }

  private trimBytes(): void {
    let total = 0;
    for (const ring of this.rings.values()) for (const t of ring) total += sizeOf(t);
    while (total > this.maxBytes) {
      // Drop the oldest thought across every character.
      let oldest: [string, AgentThought[]] | null = null;
      for (const entry of this.rings) if (entry[1].length > 0 && (oldest === null || entry[1][0]!.seq < oldest[1][0]!.seq)) oldest = entry;
      if (oldest === null) return;
      const gone = oldest[1].shift()!;
      this.ids.delete(gone.id);
      total -= sizeOf(gone);
    }
  }

  characters(): string[] {
    return [...this.rings.keys()].sort();
  }

  /** Thoughts for one character (or every character), newest last, after `after` (seq), at most `limit`. */
  list(character: string | null, after = 0, limit = 200): AgentThought[] {
    const out: AgentThought[] = [];
    for (const [c, ring] of this.rings) {
      if (character !== null && c !== character) continue;
      for (const t of ring) if (t.seq > after) out.push(t);
    }
    out.sort((a, b) => a.seq - b.seq);
    return out.slice(-limit);
  }

  get(id: string): AgentThought | null {
    for (const ring of this.rings.values()) for (const t of ring) if (t.id === id) return t;
    return null;
  }

  get latestSeq(): number {
    return this.seq;
  }

  clear(): void {
    this.rings.clear();
    this.ids.clear();
  }
}

function sizeOf(t: AgentThought): number {
  let n = t.thinking.length + t.output.length + 512;
  for (const m of t.messages) n += m.content.length;
  return n;
}

/** What a director asks a worker to do (`POST /api/mod/agent/control`),
 *  and what the server itself sends on a restart (`action: "reset"`). */
export type AgentControlAction = "reset" | "survey" | "nudge" | "set" | "forget" | "thinking" | "effort" | "pause" | "rerun";
export const AGENT_CONTROL_ACTIONS: readonly AgentControlAction[] = ["reset", "survey", "nudge", "set", "forget", "thinking", "effort", "pause", "rerun"];
export const AGENT_SET_FIELDS = ["brief", "mood", "stage", "drive", "policy", "trust", "note", "question"] as const;

export interface AgentControl {
  action: AgentControlAction;
  /** Null → every character the worker voices. */
  character: string | null;
  /** Who asked (a director's name, or "server"). */
  by: string;
  [extra: string]: unknown;
}

/** Validate a control request: a known action, bounded payload, nothing else. Returns an error string when refused. */
export function agentControl(raw: unknown, by: string): AgentControl | string {
  if (raw === null || typeof raw !== "object") return "a control is an object";
  const r = raw as Record<string, unknown>;
  const action = s_(r["action"], 20) as AgentControlAction;
  if (!AGENT_CONTROL_ACTIONS.includes(action)) return `unknown action ${JSON.stringify(r["action"])}`;
  const character = s_(r["character"], 80).trim();
  const out: AgentControl = { action, character: character === "" ? null : character, by: by.slice(0, 80) || "server" };
  switch (action) {
    case "reset":
      out["reason"] = s_(r["reason"], 80) || "reset";
      break;
    case "nudge": {
      const text = s_(r["text"], 400).trim();
      if (text === "") return "nudge needs text";
      out["text"] = text;
      break;
    }
    case "set": {
      const field = s_(r["field"], 20);
      if (!(AGENT_SET_FIELDS as readonly string[]).includes(field)) return `set: unknown field ${JSON.stringify(r["field"])}`;
      out["field"] = field;
      const v = r["value"];
      if (typeof v === "string") out["value"] = v.slice(0, 2000);
      else if (typeof v === "number" && Number.isFinite(v)) out["value"] = v;
      else if (v !== null && typeof v === "object" && !Array.isArray(v) && field === "policy") {
        const pr = v as Record<string, unknown>;
        out["value"] = { ...(typeof pr["favours"] === "string" ? { favours: pr["favours"].slice(0, 20) } : {}), ...(Array.isArray(pr["credit"]) ? { credit: strs(pr["credit"], 12, 80) } : {}), ...(Array.isArray(pr["wary"]) ? { wary: strs(pr["wary"], 12, 80) } : {}), ...(typeof pr["note"] === "string" ? { note: pr["note"].slice(0, 300) } : {}) };
      }
      for (const key of ["name", "person", "why", "add", "drop"] as const) {
        const x = s_(r[key], 400).trim();
        if (x !== "") out[key] = x;
      }
      if (field === "drive" && typeof out["name"] !== "string") return "set drive needs a name";
      if (field === "trust" && typeof out["person"] !== "string") return "set trust needs a person";
      if ((field === "note" || field === "question") && out["add"] === undefined && out["drop"] === undefined) return `set ${field} needs add or drop`;
      if (["brief", "mood", "stage", "drive", "policy", "trust"].includes(field) && out["value"] === undefined) return `set ${field} needs a value`;
      break;
    }
    case "forget": {
      const person = s_(r["person"], 80).trim();
      if (person === "") return "forget needs a person";
      out["person"] = person;
      break;
    }
    case "thinking":
    case "pause":
      out["on"] = r["on"] === true;
      break;
    case "effort": {
      const level = s_(r["level"], 10).toLowerCase();
      if (!["none", "low", "medium", "high"].includes(level)) return "effort must be none, low, medium, or high";
      out["level"] = level;
      break;
    }
    case "rerun": {
      const thought = s_(r["thought"], 40).trim();
      if (thought === "") return "rerun needs a thought id";
      out["thought"] = thought;
      break;
    }
    case "survey":
      break;
  }
  return out;
}

/** Parse a worker's requested acts: unknown shapes are dropped, never guessed. */
export function agentActs(raw: unknown): AgentAct[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentAct[] = [];
  for (const item of raw.slice(0, 6)) {
    if (item === null || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const kind = a["kind"];
    if (kind === "share" && typeof a["entry"] === "string" && a["entry"].trim() !== "") {
      const act: AgentAct = { kind: "share", entry: a["entry"].trim() };
      if (typeof a["to"] === "string" && a["to"].trim() !== "") act.to = a["to"].trim();
      out.push(act);
    } else if (kind === "fire" && typeof a["name"] === "string" && a["name"].trim() !== "") {
      const act: AgentAct = { kind: "fire", name: a["name"].trim() };
      if (typeof a["subject"] === "string" && a["subject"].trim() !== "") act.subject = a["subject"].trim();
      const rawArgs = a["args"];
      if (rawArgs !== null && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
        const args: Record<string, string | number | boolean> = {};
        for (const [k, v] of Object.entries(rawArgs as Record<string, unknown>).slice(0, 8)) {
          if (typeof v === "string") args[k] = v.slice(0, 200);
          else if (typeof v === "number" && Number.isFinite(v)) args[k] = v;
          else if (typeof v === "boolean") args[k] = v;
        }
        act.args = args;
      }
      out.push(act);
    }
  }
  return out;
}

export interface AgentCodexEntry {
  id: string;
  title: string;
  about: string | null;
  text: string;
}

/** A connected worker (one agents SSE stream). */
export interface AgentWorker {
  id: string;
  /** Display label (`laptop`), for presence. */
  name: string;
  /** The characters this worker voices. */
  characters: Set<string>;
  send: (event: string, data: unknown) => void;
}

interface OpenRequest {
  req: AgentRequest;
  key: string;
  /** The worker it's with, or null while queued. */
  worker: string | null;
  dispatchedAt: number | null;
  /** Dispatch order on its worker (the line stagehand answers in). */
  dispatchSeq: number;
  /** When it reached the head of its worker's line — the moment the worker
   *  could start on it (null while queued or still waiting in line). */
  startedAt: number | null;
  attempts: number;
  /** A newer line arrived while this one was open. */
  followUp: boolean;
  /** Hub clock when the request was opened (a refresh never moves it). */
  createdAt: number;
  /** The hold line was already offered for this request. */
  held: boolean;
}

/** One agent character's line of requests, for the director (`CastSummary.agentQueue`). */
export interface AgentQueue {
  /** Open requests: in a worker's line, or queued in the hub. */
  depth: number;
  /** How long the oldest has waited (ms, hub clock); null when none. */
  oldestMs: number | null;
  /** Every connected worker voicing it has stalled (connected, not answering). */
  stalled: boolean;
}

export interface AgentHubOptions {
  /** Build the request body for a thread right now (null → nothing to answer). */
  build: (thread: AgentThread, id: string) => AgentRequest | null;
  /** May this thread reach a worker at all? False → the line is ignored, no
   *  request is made (e.g. a guest's DM with a character still hidden from
   *  them — the runtime's belt against a premature hold line). Default: yes. */
  admits?: (thread: AgentThread) => boolean;
  /** Show / hide the "… is typing" indicator in the thread. */
  typing?: (thread: AgentThread, on: boolean) => void;
  /** Presence changed (a worker came or went). */
  presence?: () => void;
  /** A worker's oldest dispatched request with no answer this long after it
   *  reached the head of the worker's line is re-dispatched. */
  replyTimeoutMs?: number;
  /** A queued request no worker picked up within this long is dropped. */
  queueMaxAgeMs?: number;
  /**
   * The request has waited `holdAfterMs` since it opened and no worker voicing
   * the character is online: post the character's hold line into the thread.
   * Called at most once per request; returns whether a line was posted.
   */
  hold?: (req: AgentRequest) => boolean;
  /** How long a queued request waits with nobody online before `hold` (20 s). */
  holdAfterMs?: number;
  /**
   * The request has waited `busyAfterMs` on a worker that is online and not
   * stalled (a burst): post the character's busy line into the thread.
   * Called at most once per thread (until a restart); returns whether a line
   * was posted.
   */
  busy?: (req: AgentRequest) => boolean;
  /** How long a request waits on a healthy worker before `busy` (40 s). */
  busyAfterMs?: number;
  /** A worker's head unanswered this long marks it stalled (60 s). */
  stallAfterMs?: number;
  /** A worker just stalled: the one `# hosts` line. `waiting` = the open
   *  requests for its characters. */
  stalled?: (worker: { name: string; characters: string[] }, waiting: number) => void;
  /** Dispatch attempts before a request is given up. */
  maxAttempts?: number;
  now?: () => number;
}

/** A queued request no worker picked up within this long is dropped (the
 *  default `queueMaxAgeMs`; a restore re-asks only lines this recent). */
export const AGENT_QUEUE_MAX_AGE_MS = 10 * 60_000;

export const threadKey = (t: AgentThread): string => `${t.channel}|${t.audience.join(",")}`;

export class AgentHub {
  private readonly workers = new Map<string, AgentWorker>();
  private readonly open = new Map<string, OpenRequest>(); // request id →
  private readonly byThread = new Map<string, string>(); // thread key → request id
  /** Stalled workers → the hub clock the stall was found at. */
  private readonly stalls = new Map<string, number>();
  /** Threads that heard the busy line (once per thread, until a restart). */
  private readonly busyThreads = new Set<string>();
  /** Threads holding a hold line the character hasn't spoken past yet: a
   *  new request there starts held, so the line is never said twice. */
  private readonly heldThreads = new Set<string>();
  private dispatches = 0;

  private readonly o: AgentHubOptions;

  constructor(o: AgentHubOptions) {
    this.o = o;
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** Characters with at least one worker connected. */
  onlineCharacters(): string[] {
    const out = new Set<string>();
    for (const w of this.workers.values()) for (const c of w.characters) out.add(c);
    return [...out].sort();
  }

  /** Connected workers, for presence (`{name, characters}`). */
  workerList(): Array<{ name: string; characters: string[] }> {
    return [...this.workers.values()].map((w) => ({ name: w.name, characters: [...w.characters].sort() }));
  }

  isOnline(character: string): boolean {
    for (const w of this.workers.values()) if (w.characters.has(character)) return true;
    return false;
  }

  /** Is a worker voicing `character` connected *and* answering (not stalled)? */
  private canAnswer(character: string): boolean {
    for (const w of this.workers.values()) if (w.characters.has(character) && !this.stalls.has(w.id)) return true;
    return false;
  }

  /** `character`'s line right now (the director's queue readout). */
  queue(character: string): AgentQueue {
    let depth = 0;
    let oldest: number | null = null;
    for (const r of this.open.values()) {
      if (r.req.character !== character) continue;
      depth += 1;
      if (oldest === null || r.createdAt < oldest) oldest = r.createdAt;
    }
    return { depth, oldestMs: oldest === null ? null : Math.max(0, this.now() - oldest), stalled: this.isOnline(character) && !this.canAnswer(character) };
  }

  /** Open requests (queued or in flight). */
  get pending(): AgentRequest[] {
    return [...this.open.values()].map((r) => r.req);
  }

  // -- workers --------------------------------------------------------------

  /** A worker connected: register it and hand it every queued request it can answer. */
  attach(worker: AgentWorker): void {
    this.workers.set(worker.id, worker);
    this.o.presence?.();
    for (const r of this.open.values()) if (r.worker === null) this.dispatch(r);
  }

  /** A worker went away: its in-flight requests go back in the queue. */
  detach(workerId: string): void {
    if (!this.workers.delete(workerId)) return;
    this.stalls.delete(workerId);
    for (const r of this.open.values()) {
      if (r.worker !== workerId) continue;
      r.worker = null;
      r.dispatchedAt = null;
      r.startedAt = null;
      this.o.typing?.(r.req.thread, false);
      this.dispatch(r);
    }
    this.o.presence?.();
  }

  // -- conversation ---------------------------------------------------------

  /** Someone said something in an agent thread. `held`: the thread already
   *  carries the hold line for it (a request re-opened after a restart),
   *  so it is never said twice. */
  line(thread: AgentThread, opts: { held?: boolean } = {}): void {
    if (this.o.admits !== undefined && !this.o.admits(thread)) return;
    const key = threadKey(thread);
    const openId = this.byThread.get(key);
    if (openId !== undefined) {
      const r = this.open.get(openId);
      if (r !== undefined) {
        if (r.worker === null) {
          // Still queued: refresh the body so the eventual answer sees the
          // whole burst (one request, not one per line).
          const fresh = this.o.build(thread, r.req.id);
          if (fresh !== null) r.req = fresh;
        } else {
          r.followUp = true;
        }
        return;
      }
    }
    this.create(thread, opts.held === true);
  }

  private create(thread: AgentThread, held: boolean): void {
    const id = `ar-${globalThis.crypto.randomUUID().slice(0, 8)}`;
    const req = this.o.build(thread, id);
    if (req === null) return;
    const key = threadKey(thread);
    if (held) this.heldThreads.add(key);
    const r: OpenRequest = { req, key, worker: null, dispatchedAt: null, dispatchSeq: 0, startedAt: null, attempts: 0, followUp: false, createdAt: this.now(), held: held || this.heldThreads.has(key) };
    this.open.set(id, r);
    this.byThread.set(r.key, id);
    this.dispatch(r);
  }

  /** How many requests are in `workerId`'s line. */
  private loadOf(workerId: string): number {
    let load = 0;
    for (const o of this.open.values()) if (o.worker === workerId) load += 1;
    return load;
  }

  /**
   * Send `r` to the least-busy worker voicing its character that is
   * answering. A stalled worker takes no new work: only a re-send of a
   * request already given out (the reply timeout's retry, exactly as for a
   * healthy worker — so a sent request never sits queued while an old copy
   * may still be answered), or one new request when it holds nothing (the
   * probe). Else `r` stays queued.
   */
  private dispatch(r: OpenRequest): void {
    let best: AgentWorker | null = null;
    let bestLoad = Infinity;
    let fallback: AgentWorker | null = null;
    let fallbackLoad = Infinity;
    for (const w of this.workers.values()) {
      if (!w.characters.has(r.req.character)) continue;
      const load = this.loadOf(w.id);
      if (this.stalls.has(w.id)) {
        if ((r.attempts > 0 || load === 0) && load < fallbackLoad) {
          fallback = w;
          fallbackLoad = load;
        }
        continue;
      }
      if (load < bestLoad) {
        best = w;
        bestLoad = load;
      }
    }
    best ??= fallback;
    if (best === null) return;
    r.worker = best.id;
    r.dispatchedAt = this.now();
    r.dispatchSeq = ++this.dispatches;
    r.startedAt = null;
    r.attempts += 1;
    best.send("request", r.req);
    this.o.typing?.(r.req.thread, true);
    this.startHead(best.id);
  }

  /** The oldest request in flight on `workerId` — the one it is working on
   *  (stagehand's voice answers one at a time, in dispatch order). */
  private headOf(workerId: string): OpenRequest | null {
    let head: OpenRequest | null = null;
    for (const r of this.open.values()) {
      if (r.worker !== workerId) continue;
      if (head === null || r.dispatchSeq < head.dispatchSeq) head = r;
    }
    return head;
  }

  /** The worker's line moved (a dispatch, an answer, a cancel): its head's
   *  reply clock starts now if it wasn't running yet. */
  private startHead(workerId: string): void {
    const head = this.headOf(workerId);
    if (head !== null && head.startedAt === null) head.startedAt = this.now();
  }

  /**
   * A worker answered. Returns the request (so the runtime commits the reply
   * into its thread) and whether more was said meanwhile — if so the runtime
   * calls `line` again after committing, so the model answers the rest. Null
   * when the request is unknown / already settled (a late answer after a
   * timeout re-dispatch, or after a restart) or held by another worker.
   */
  settle(requestId: string, workerId?: string): { req: AgentRequest; followUp: boolean } | null {
    const r = this.open.get(requestId);
    // Any answer shows its worker is answering — a late one the hub refuses too.
    if (r === undefined || (workerId !== undefined && r.worker !== null && r.worker !== workerId)) {
      if (workerId !== undefined) this.answering(workerId);
      return null;
    }
    this.open.delete(requestId);
    if (this.byThread.get(r.key) === requestId) this.byThread.delete(r.key);
    this.heldThreads.delete(r.key); // the character speaks past its hold line
    this.o.typing?.(r.req.thread, false);
    if (r.worker !== null) this.startHead(r.worker);
    const by = workerId ?? r.worker;
    if (by !== null) this.answering(by);
    return { req: r.req, followUp: r.followUp };
  }

  /** `workerId` answered something: a stall ends, and the queue goes to it. */
  private answering(workerId: string): void {
    if (!this.workers.has(workerId) || !this.stalls.delete(workerId)) return;
    this.o.presence?.();
    for (const r of this.open.values()) if (r.worker === null) this.dispatch(r);
  }

  /** `workerId`'s head went unanswered `stallAfterMs`: mark it stalled, tell
   *  the hosts once, and give every thread waiting on it the hold line. */
  private stall(worker: AgentWorker): void {
    this.stalls.set(worker.id, this.now());
    this.o.presence?.();
    const waiting = [...this.open.values()].filter((r) => r.worker === worker.id || (r.worker === null && worker.characters.has(r.req.character) && !this.canAnswer(r.req.character)));
    this.o.stalled?.({ name: worker.name, characters: [...worker.characters].sort() }, waiting.length);
    for (const r of waiting) this.holdOnce(r);
  }

  /** Say the hold line in `r`'s thread unless it was offered already;
   *  a queued body is rebuilt so its eventual worker knows it was said. */
  private holdOnce(r: OpenRequest): void {
    if (r.held) return;
    r.held = true;
    if (this.o.hold?.(r.req) !== true) return;
    this.heldThreads.add(r.key);
    if (r.worker !== null) return; // the worker answers the copy it holds
    const fresh = this.o.build(r.req.thread, r.req.id);
    if (fresh !== null) r.req = fresh;
  }

  /**
   * Expire stuck work. Call periodically (the runtime's 1 s ticker).
   *
   * A worker answers its requests one at a time (stagehand's voice runs
   * at concurrency 1), and every request is dispatched to it at once, so
   * only its **head** — the oldest it holds — can be stuck: the rest are
   * waiting in its line. The reply timeout therefore applies to the head
   * alone, from the moment it reached the head (the request before it was
   * answered, cancelled or answered by hand), so a 60-DM burst on a healthy
   * worker cancels nothing (T9-timers-02) and a head stuck in one slot of a
   * multi-slot worker still times out while the other slots answer. A
   * request given up — its attempts spent, or
   * queued past `queueMaxAgeMs` — posts the hold line once if it never did,
   * so the guest hears something and Run shows the thread in need.
   */
  sweep(): void {
    const now = this.now();
    const timeout = this.o.replyTimeoutMs ?? 120_000;
    const maxAge = this.o.queueMaxAgeMs ?? AGENT_QUEUE_MAX_AGE_MS;
    const maxAttempts = this.o.maxAttempts ?? 2;
    const holdAfter = this.o.holdAfterMs ?? 20_000;
    const busyAfter = this.o.busyAfterMs ?? 40_000;
    const stallAfter = this.o.stallAfterMs ?? 60_000;
    const heads = new Set<OpenRequest>(); // each worker's oldest in flight
    for (const w of this.workers.values()) {
      const h = this.headOf(w.id);
      if (h === null) continue;
      heads.add(h);
      if (!this.stalls.has(w.id) && h.startedAt !== null && now - h.startedAt > stallAfter) this.stall(w);
    }
    for (const [id, r] of [...this.open]) {
      if (r.worker !== null && r.dispatchedAt !== null) {
        if (!heads.has(r)) continue;
        r.startedAt ??= now;
        if (now - r.startedAt <= timeout) continue;
        const worker = r.worker;
        this.workers.get(worker)?.send("cancel", { id });
        this.o.typing?.(r.req.thread, false);
        r.worker = null;
        r.dispatchedAt = null;
        r.startedAt = null;
        // The cancel frees the worker for the next in its line: that one's
        // clock starts now, not at its own (long past) dispatch.
        this.startHead(worker);
        if (r.attempts >= maxAttempts) {
          this.giveUp(id, r);
          continue;
        }
        this.dispatch(r);
      } else if (r.worker === null && now - r.req.at > maxAge) {
        this.giveUp(id, r);
      } else if (r.worker === null && !r.held && now - r.createdAt >= holdAfter && !this.canAnswer(r.req.character)) {
        // Nobody can answer (none online, or only a stalled worker): say the
        // hold line once, keep the request queued so a worker that comes
        // back (or answers again) still answers it.
        this.holdOnce(r);
      }
    }
    // Behind but answering: the busy line, once per thread.
    for (const r of this.open.values()) {
      if (r.held || r.worker === null || this.stalls.has(r.worker) || this.busyThreads.has(r.key) || now - r.createdAt <= busyAfter) continue;
      this.busyThreads.add(r.key);
      this.o.busy?.(r.req);
    }
    // A stalled worker with nothing in hand gets the oldest queued request
    // it voices (the probe), so a lone laptop can show it is back.
    for (const w of this.workers.values()) {
      if (!this.stalls.has(w.id) || this.loadOf(w.id) > 0) continue;
      let oldest: OpenRequest | null = null;
      for (const r of this.open.values()) if (r.worker === null && w.characters.has(r.req.character) && (oldest === null || r.createdAt < oldest.createdAt)) oldest = r;
      if (oldest !== null) this.dispatch(oldest);
    }
  }

  /** Drop a request nobody will answer, saying the hold line first if the
   *  thread never got it. */
  private giveUp(id: string, r: OpenRequest): void {
    this.drop(id, r);
    if (r.held) return;
    r.held = true;
    if (this.o.hold?.(r.req) === true) this.heldThreads.add(r.key);
  }

  /**
   * The event was paused from `pausedAt` to `resumedAt` (hub ms): the sweep
   * didn't run, so no time in between counts toward a reply timeout, the
   * queue's max age or the hold line (T9-timers-03). Every stamp from
   * before the pause moves on by the pause's length; one taken during it
   * reads as the resume.
   */
  shift(pausedAt: number, resumedAt: number): void {
    const by = resumedAt - pausedAt;
    if (!(by > 0)) return;
    const moved = (t: number): number => (t <= pausedAt ? t + by : Math.max(t, resumedAt));
    for (const r of this.open.values()) {
      r.createdAt = moved(r.createdAt);
      if (r.dispatchedAt !== null) r.dispatchedAt = moved(r.dispatchedAt);
      if (r.startedAt !== null) r.startedAt = moved(r.startedAt);
      r.req = { ...r.req, at: moved(r.req.at) };
    }
    for (const [w, at] of this.stalls) this.stalls.set(w, moved(at));
  }

  /**
   * A director answered in the thread by hand (Run → speak as the
   * character; decision #35 — the directors answer DMs when the worker is
   * down). The open request on that thread is settled: dropped if queued,
   * cancelled on its worker if in flight — so a worker that comes back
   * doesn't answer the same question a second time. The next line in the
   * thread opens a fresh request whose history includes the director's
   * answer. Returns whether a request was closed.
   */
  answeredByHand(thread: AgentThread): boolean {
    const key = threadKey(thread);
    const id = this.byThread.get(key);
    const r = id === undefined ? undefined : this.open.get(id);
    if (id === undefined || r === undefined) return false;
    this.drop(id, r);
    this.heldThreads.delete(key); // the character (a director) spoke
    if (r.worker !== null) {
      this.workers.get(r.worker)?.send("cancel", { id });
      this.o.typing?.(r.req.thread, false);
      // The cancel frees the worker for the next in its line: its clock
      // starts now, not at the worker's last answer.
      this.startHead(r.worker);
    }
    return true;
  }

  private drop(id: string, r: OpenRequest): void {
    this.open.delete(id);
    if (this.byThread.get(r.key) === id) this.byThread.delete(r.key);
  }

  /**
   * The story restarted: every open request is moot, and every worker is
   * told to put its minds back at the doors — through the same `control`
   * frame the director's panel uses (`action: "reset"`), so a restart and a
   * hand-reset are one code path on the worker. Workers stay attached.
   */
  reset(by = "server", reason = "restart"): void {
    for (const [id, r] of this.open) {
      if (r.worker !== null) {
        this.workers.get(r.worker)?.send("cancel", { id });
        this.o.typing?.(r.req.thread, false);
      }
    }
    this.open.clear();
    this.byThread.clear();
    // A new story: no stall carried over (a still-wedged worker stalls
    // again on its first head), every thread may hear busy / hold anew.
    const wasStalled = this.stalls.size > 0;
    this.stalls.clear();
    this.busyThreads.clear();
    this.heldThreads.clear();
    if (wasStalled) this.o.presence?.();
    this.control({ action: "reset", character: null, by, reason });
  }

  /**
   * Send a control to every worker voicing `control.character` (or to every
   * worker when null). Returns how many workers received it — zero means
   * nobody is voicing that character right now.
   */
  control(control: AgentControl): number {
    let delivered = 0;
    for (const w of this.workers.values()) {
      if (control.character !== null && !w.characters.has(control.character)) continue;
      w.send("control", control);
      delivered += 1;
    }
    return delivered;
  }
}
