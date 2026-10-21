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
//! waits: a request that has waited `busyAfterMs` (40 s), part of it in a
//! worker's line behind another request, on a worker still answering posts
//! the character's authored busy line (`CHARACTER … busy: …`) **once per
//! thread** — never for a lone request the worker went straight to (its
//! silence is the stall's to call). A worker whose head request goes
//! unanswered `stallAfterMs` (60 s) is **stalled** — connected, but not
//! answering: one `# hosts` line (`stalled`), the hold line once in every
//! thread waiting on it, and no new dispatch while it stays stalled: new
//! requests stay queued in the hub, and only what it already holds keeps
//! the reply timeout's re-sends to it as before. The stall clears on its
//! next answer (a late one to a cancelled copy too) or a reconnect (a new
//! stream is a new worker); the queue then goes to it at once. No request is
//! ever moved between workers on a stall.
//!
//! Within one stall a thread hears the hold line once, however many
//! requests the guest's lines open meanwhile (a given-up request's thread
//! starts its next request held); once the stall ends — or the worker goes
//! offline, where the offline rule takes over — that is forgotten.
//!
//! **Rulings** (wave 11b, contract J; wave 18b, O4). The story header's
//! `judge: <Character>` names an agent character that rules on every 📝
//! filing that is not an exact match. A ruling is no request: it is never
//! thread-bound and never in the DM queue's `depth`. It joins the hub's own
//! **judge queue** (FIFO by filing time), asked only while a worker voicing
//! the judge is connected and answering; at most `AGENT_JUDGE_INFLIGHT` (1)
//! `judge` frame is out per worker, and **voice first**: no frame goes to a
//! worker while it holds an open voice request (one already out runs to its
//! end). The worker answers `POST /api/agent/judge`; a frame unanswered
//! `AGENT_JUDGE_TIMEOUT_MS` (60 s, a pause excluded) after it was **sent**
//! expires — a queued one never does; a worker leaving puts its frame back
//! in the queue, in its place. Two expiries in a row on one worker
//! (it answered nothing between) are a **judge stall**: no more frames to
//! it until it answers anything (a ruling or a request) or reconnects, one
//! `judgeStalled` call (the runtime's `# hosts` line), and the queue waits.
//! A ruling not given by its round's settle is dropped by the runtime and
//! wave 11's fallback stands. Judge frames never count toward a worker's
//! voice stall.
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
  /** The story posted this line (a receipt, a scripted line, the hold or
   *  busy line), not the character's own free reply (wave 12, C1.1).
   *  Absent = a free line. Never sent while `LOOM_AGENT_RECENT=off`. */
  story?: true;
}

/**
 * Something the house holds about the character and this speaker, built at
 * request time from what the server already holds (wave 12, C1.2): a gift
 * (an entry the speaker shared with him), his own house-wide line, the
 * speaker's filing (a question id, nothing else), the speaker being marked,
 * the speaker's place on the Trust Chart. Never an answer, a verdict, a
 * secret entry or anything from the Kernel. `at` is story time (ms).
 */
export type AgentRecent =
  | { kind: "gift"; title: string; new: boolean; at: number }
  | { kind: "house"; text: string; at: number }
  | { kind: "filing"; question: string }
  | { kind: "marked" }
  | { kind: "chart"; rank: number; of: number; called: "top" | "bottom" | null };

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
  /** Wave 12 (C1.2): at most 6 things the house holds about him and this
   *  speaker, newest first within a kind. Absent while
   *  `LOOM_AGENT_RECENT=off`, or from an older server. */
  recent?: AgentRecent[];
  /** The story clock (`sim.elapsed()`, ms) when this body was built. */
  storyAt?: number;
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
  /** The event is paused (wave 12): the worker skips its timed surveys. */
  paused?: boolean;
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
  /** Wave 12: which mind the worker runs (absent from an older worker). */
  mode?: "new" | "classic";
  /** Wave 12: the phase card in force. */
  phase?: string;
  /** Wave 12: who wrote the brief in force — the phase card, or a director. */
  briefBy?: "story" | "director";
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
  /** Wave 12: the voice's own notes on this person (newest last). */
  memos?: Array<{ at: number; text: string; by: string; heart: boolean }>;
  /** Wave 12: the first-met line. */
  firstMet?: string;
  /** Wave 12: the titles they gave him. */
  gifts?: string[];
  /** Wave 12: the question ids they filed. */
  filings?: string[];
  marked?: boolean;
  /** Wave 12: their place on the Trust Chart, in words. */
  chart?: string | null;
  /** Wave 12: the house's own trust number for them, as a string. */
  storyTrust?: string | null;
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
        ...personExtras(p),
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
    ...(r["mode"] === "new" || r["mode"] === "classic" ? { mode: r["mode"] } : {}),
    ...(typeof r["phase"] === "string" ? { phase: r["phase"].slice(0, 80) } : {}),
    ...(r["briefBy"] === "story" || r["briefBy"] === "director" ? { briefBy: r["briefBy"] } : {}),
  };
}

/** Wave 12's optional person fields (C1.5): each passed only when present
 *  and well-typed, bounded, never defaulted. */
function personExtras(p: Record<string, unknown>): Partial<AgentMindPerson> {
  const out: Partial<AgentMindPerson> = {};
  if (Array.isArray(p["memos"])) {
    out.memos = objs(p["memos"], 200)
      .filter((m) => typeof m["text"] === "string")
      .slice(-6)
      .map((m) => ({ at: n_(m["at"]), text: s_(m["text"], 140), by: s_(m["by"], 20), heart: m["heart"] === true }));
  }
  if (typeof p["firstMet"] === "string") out.firstMet = p["firstMet"].slice(0, 200);
  if (Array.isArray(p["gifts"])) out.gifts = strs(p["gifts"], 12, 120);
  if (Array.isArray(p["filings"])) out.filings = strs(p["filings"], 12, 12);
  if (typeof p["marked"] === "boolean") out.marked = p["marked"];
  if (p["chart"] === null || typeof p["chart"] === "string") out.chart = p["chart"] === null ? null : (p["chart"] as string).slice(0, 80);
  if (p["storyTrust"] === null || typeof p["storyTrust"] === "string") out.storyTrust = p["storyTrust"] === null ? null : (p["storyTrust"] as string).slice(0, 20);
  return out;
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
  kind: "voice" | "lookup" | "reflect" | "survey" | "rerun" | "judge" | "reset" | "control" | "error" | "brief" | "summary";
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
  /** Wave 12: the model's prompt-evaluation time (Ollama), else null. The
   *  sanitiser always sets it; optional so a thought built by an older
   *  client still type-checks. */
  prompt_ms?: number | null;
  result: Record<string, unknown> | null;
  touched: string[];
  diff: Record<string, unknown>;
  revision: number | null;
  error: string | null;
  note: string;
}

const THOUGHT_KINDS = new Set<AgentThought["kind"]>(["voice", "lookup", "reflect", "survey", "rerun", "judge", "reset", "control", "error", "brief", "summary"]);
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
    prompt_ms: typeof r["prompt_ms"] === "number" && Number.isFinite(r["prompt_ms"]) ? r["prompt_ms"] : null,
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
export type AgentControlAction = "reset" | "survey" | "nudge" | "set" | "forget" | "thinking" | "effort" | "pause" | "rerun" | "rewrite";
/** `rewrite` (wave 12): rewrite the brief from the phase and the house now
 *  (one voice call on a new-mode worker; a classic one runs a survey). */
export const AGENT_CONTROL_ACTIONS: readonly AgentControlAction[] = ["reset", "survey", "nudge", "set", "forget", "thinking", "effort", "pause", "rerun", "rewrite"];
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
    case "rewrite":
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
  /** Hub clock since when the guest has been waiting: `createdAt`, or — for
   *  a thread re-asked after a restart — its owed line's time (what the host
   *  view's `waiting[].since` and the queue's `oldestMs` read; the timers
   *  keep `createdAt`, so a restart never fires a hold line early). */
  since: number;
  /** The hold line was already offered for this request. */
  held: boolean;
  /** It waited in a worker's line behind another request (a burst) — the
   *  busy line's case; a request its worker went straight to never was. */
  behind: boolean;
}

/**
 * A **ruling** the facts judge asks of the story's `judge:` character (wave
 * 11b, contract J): is this near-miss filing the same thing as the key?
 * Sent as a `judge` frame on the worker's stream — never a `request`, never
 * bound to a thread, never in the DM queue (`AgentQueue`) — and answered by
 * `POST /api/agent/judge {id, worker, same, why}`. Carries the key, so it
 * goes to the judge's worker only (mod-gated, like every frame); the worker
 * keeps it out of the character's mind.
 */
export interface AgentJudgeRequest {
  id: string;
  character: string;
  /** The filing, as the facts ledger keys it (one per person + question). */
  filing: { id: string; person: string; name: string; question: string };
  question: { id: string; text: string };
  key: { answer: string; aliases: string[] };
  answer: string;
  confidence: number;
  /** (wave 18b) The key form the filing is spelled close to; null = a plain
   *  miss (a different answer is not the same — only a slip, a paraphrase
   *  or another way of writing the key is). An older worker ignores it. */
  near: string | null;
  /** Server wall clock when the ruling was asked. */
  at: number;
}

interface OpenJudge {
  req: AgentJudgeRequest;
  /** The worker it was sent to; null = still in the judge queue. */
  worker: string | null;
  /** Hub clock when it was sent (null while queued): the expiry's start. */
  sentAt: number | null;
  /** Hub clock when it joined the queue (the director's oldest wait). */
  queuedAt: number;
}

/** A ruling sent and not given within this long is dropped (wave 11's
 *  fallback then stands: the proposal is credited at the round's settle). */
export const AGENT_JUDGE_TIMEOUT_MS = 60_000;
/** At most this many `judge` frames out per worker at once (wave 18b). */
export const AGENT_JUDGE_INFLIGHT = 1;
/** Expiries in a row on one worker that make a judge stall (wave 18b). */
export const AGENT_JUDGE_STALL_EXPIRIES = 2;

/** The judge queue for one character (`AgentQueue.judging`, wave 18b). */
export interface AgentJudging {
  /** Rulings waiting in the hub's queue, not yet sent. */
  queued: number;
  /** Rulings sent to a worker, not yet answered. */
  out: number;
  /** How long the oldest (queued or out) has waited since it was asked (ms). */
  oldestMs: number | null;
  /** Every connected worker voicing it is judge-stalled (answering nothing). */
  stalled: boolean;
}

/** One agent character's line of requests, for the director (`CastSummary.agentQueue`). */
export interface AgentQueue {
  /** Open requests: in a worker's line, or queued in the hub. */
  depth: number;
  /** How long the oldest has waited (ms, hub clock); null when none. */
  oldestMs: number | null;
  /** Every connected worker voicing it has stalled (connected, not answering). */
  stalled: boolean;
  /** (wave 18b) Its judge queue, when it has rulings waiting or out, or a
   *  judge stall; absent otherwise. */
  judging?: AgentJudging;
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
  /** A ruling unanswered this long is dropped (`AGENT_JUDGE_TIMEOUT_MS`). */
  judgeTimeoutMs?: number;
  /** A ruling went unanswered: it expired or was cancelled (the runtime
   *  refreshes the Judging card's "asking…"). A worker leaving puts its
   *  rulings back in the queue instead (wave 18b). */
  judgeGone?: (req: AgentJudgeRequest, why: "expired" | "cancelled") => void;
  /** (wave 18b) A ruling left the queue for a worker (the Judging card's
   *  "queued" becomes "asking"). */
  judgeSent?: (req: AgentJudgeRequest) => void;
  /** (wave 18b) A worker's rulings expired `AGENT_JUDGE_STALL_EXPIRIES`
   *  times in a row: the judge stall's one `# hosts` line. */
  judgeStalled?: (worker: { name: string; characters: string[] }) => void;
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
  /** Threads that heard the hold line during the current stall of their
   *  character's worker (thread key → character): a new request there
   *  starts held, so one stall never says it twice. Forgotten when the
   *  stall ends, the worker goes, or the character speaks. */
  private readonly heldThreads = new Map<string, string>();
  private dispatches = 0;
  /** Rulings queued or out with a worker (id →, FIFO), apart from the DM
   *  requests. */
  private readonly judges = new Map<string, OpenJudge>();
  /** Per worker: rulings expired in a row since it last answered anything. */
  private readonly judgeExpiries = new Map<string, number>();
  /** Workers in a judge stall (no frames until they answer or reconnect). */
  private readonly judgeStalls = new Set<string>();

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
      if (oldest === null || r.since < oldest) oldest = r.since;
    }
    const out: AgentQueue = { depth, oldestMs: oldest === null ? null : Math.max(0, this.now() - oldest), stalled: this.isOnline(character) && !this.canAnswer(character) };
    const judging = this.judgingOf(character);
    if (judging.queued > 0 || judging.out > 0 || judging.stalled) out.judging = judging;
    return out;
  }

  /** `character`'s judge queue right now (`AgentQueue.judging`). */
  judgingOf(character: string): AgentJudging {
    let queued = 0;
    let out = 0;
    let oldest: number | null = null;
    for (const j of this.judges.values()) {
      if (j.req.character !== character) continue;
      if (j.worker === null) queued += 1;
      else out += 1;
      if (oldest === null || j.queuedAt < oldest) oldest = j.queuedAt;
    }
    let voicing = 0;
    let stalled = 0;
    for (const w of this.workers.values()) {
      if (!w.characters.has(character)) continue;
      voicing += 1;
      if (this.judgeStalls.has(w.id)) stalled += 1;
    }
    return { queued, out, oldestMs: oldest === null ? null : Math.max(0, this.now() - oldest), stalled: voicing > 0 && stalled === voicing };
  }

  /** Open requests (queued or in flight). */
  get pending(): AgentRequest[] {
    return [...this.open.values()].map((r) => r.req);
  }

  /** Since when request `id`'s guest has been waiting (hub ms; the queue's
   *  `oldestMs` clock), or null for no such open request. */
  sinceOf(id: string): number | null {
    return this.open.get(id)?.since ?? null;
  }

  // -- workers --------------------------------------------------------------

  /** A worker connected: register it and hand it every queued request it can answer. */
  attach(worker: AgentWorker): void {
    this.workers.set(worker.id, worker);
    this.pruneHeld();
    this.o.presence?.();
    for (const r of this.open.values()) if (r.worker === null) this.dispatch(r);
    this.pumpJudges();
  }

  /** A worker went away: its in-flight requests go back in the queue, and
   *  (wave 18b) so do its rulings, in their place (a Wi-Fi blip never loses
   *  one; a late answer from the old connection gets a 410). */
  detach(workerId: string): void {
    if (!this.workers.delete(workerId)) return;
    for (const j of this.judges.values()) {
      if (j.worker !== workerId) continue;
      j.worker = null;
      j.sentAt = null;
    }
    this.judgeExpiries.delete(workerId);
    this.judgeStalls.delete(workerId);
    this.stalls.delete(workerId);
    this.pruneHeld();
    for (const r of this.open.values()) {
      if (r.worker !== workerId) continue;
      r.worker = null;
      r.dispatchedAt = null;
      r.startedAt = null;
      this.o.typing?.(r.req.thread, false);
      this.dispatch(r);
    }
    this.o.presence?.();
    this.pumpJudges(); // another worker may take the queue now
  }

  // -- conversation ---------------------------------------------------------

  /** Someone said something in an agent thread. `held`: the thread already
   *  carries the hold line for it (a request re-opened after a restart),
   *  so it is never said twice. */
  line(thread: AgentThread, opts: { held?: boolean; since?: number } = {}): void {
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
    this.create(thread, opts.held === true, opts.since);
  }

  private create(thread: AgentThread, held: boolean, since?: number): void {
    const id = `ar-${globalThis.crypto.randomUUID().slice(0, 8)}`;
    const req = this.o.build(thread, id);
    if (req === null) return;
    const key = threadKey(thread);
    const r: OpenRequest = { req, key, worker: null, dispatchedAt: null, dispatchSeq: 0, startedAt: null, attempts: 0, followUp: false, createdAt: this.now(), since: 0, held: held || this.heldThreads.has(key), behind: false };
    r.since = since !== undefined && Number.isFinite(since) ? Math.min(since, r.createdAt) : r.createdAt;
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
   * answering. A stalled worker takes no new dispatch: only `retryOn`, the
   * worker the reply timeout just took `r` back from, gets its re-send
   * (exactly as for a healthy worker — so a sent request never sits queued
   * while an old copy may still be answered). Else `r` stays queued.
   */
  private dispatch(r: OpenRequest, retryOn: string | null = null): void {
    let best: AgentWorker | null = null;
    let bestLoad = Infinity;
    for (const w of this.workers.values()) {
      if (!w.characters.has(r.req.character)) continue;
      if (this.stalls.has(w.id) && w.id !== retryOn) continue;
      const load = this.loadOf(w.id);
      if (load < bestLoad) {
        best = w;
        bestLoad = load;
      }
    }
    if (best === null) return;
    r.worker = best.id;
    r.dispatchedAt = this.now();
    r.dispatchSeq = ++this.dispatches;
    r.startedAt = null;
    r.attempts += 1;
    best.send("request", r.req);
    this.o.typing?.(r.req.thread, true);
    this.startHead(best.id);
    if (r.startedAt === null) r.behind = true; // in line behind another
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
    this.heldThreads.delete(r.key); // the character speaks
    this.o.typing?.(r.req.thread, false);
    if (r.worker !== null) this.startHead(r.worker);
    const by = workerId ?? r.worker;
    if (by !== null) this.answering(by);
    this.pumpJudges(); // voice first: a worker free of voice requests rules next
    return { req: r.req, followUp: r.followUp };
  }

  /** `workerId` answered something: a stall ends (a voice stall, and — wave
   *  18b — a judge stall), and the queue goes to it. */
  private answering(workerId: string): void {
    this.judgeAnswered(workerId);
    if (!this.workers.has(workerId) || !this.stalls.delete(workerId)) return;
    this.pruneHeld();
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

  /** Is `character` online with only stalled workers (a stall episode)? */
  private stalledOnly(character: string): boolean {
    return this.isOnline(character) && !this.canAnswer(character);
  }

  /** The hold line landed in `r`'s thread: within a stall, remember it. */
  private heard(r: OpenRequest): void {
    if (this.stalledOnly(r.req.character)) this.heldThreads.set(r.key, r.req.character);
  }

  /** Forget the threads held during a stall that is over (an answer, a
   *  reconnect, or nobody online — the offline rule's turn). */
  private pruneHeld(): void {
    for (const [key, character] of [...this.heldThreads]) if (!this.stalledOnly(character)) this.heldThreads.delete(key);
  }

  /** Say the hold line in `r`'s thread unless it was offered already;
   *  a queued body is rebuilt so its eventual worker knows it was said. */
  private holdOnce(r: OpenRequest): void {
    if (r.held) return;
    r.held = true;
    if (this.o.hold?.(r.req) !== true) return;
    this.heard(r);
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
    const judgeTimeout = this.o.judgeTimeoutMs ?? AGENT_JUDGE_TIMEOUT_MS;
    let judgeMoved = false;
    for (const [id, j] of [...this.judges]) {
      // Only a frame that was sent expires (from `sentAt`): a queued
      // ruling waits for its turn, however long the queue is.
      if (j.worker === null || j.sentAt === null || now - j.sentAt <= judgeTimeout) continue;
      const worker = j.worker;
      this.judges.delete(id);
      this.workers.get(worker)?.send("cancel", { id });
      this.o.judgeGone?.(j.req, "expired");
      judgeMoved = true;
      const n = (this.judgeExpiries.get(worker) ?? 0) + 1;
      this.judgeExpiries.set(worker, n);
      const w = this.workers.get(worker);
      if (n >= AGENT_JUDGE_STALL_EXPIRIES && w !== undefined && !this.judgeStalls.has(worker)) {
        this.judgeStalls.add(worker);
        this.o.judgeStalled?.({ name: w.name, characters: [...w.characters].sort() });
      }
    }
    if (judgeMoved) this.pumpJudges();
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
        this.dispatch(r, worker);
      } else if (r.worker === null && now - r.req.at > maxAge) {
        this.giveUp(id, r);
      } else if (r.worker === null && !r.held && now - r.createdAt >= holdAfter && !this.canAnswer(r.req.character)) {
        // Nobody can answer (none online, or only a stalled worker): say the
        // hold line once, keep the request queued so a worker that comes
        // back (or answers again) still answers it.
        this.holdOnce(r);
      }
    }
    this.pumpJudges(); // a voice request given back may have freed a worker
    // Behind a burst on a worker still answering: the busy line, once per
    // thread. A lone request's own wait is the stall's to call.
    for (const r of this.open.values()) {
      if (!r.behind || r.held || r.worker === null || this.stalls.has(r.worker) || this.busyThreads.has(r.key) || now - r.createdAt <= busyAfter) continue;
      this.busyThreads.add(r.key);
      this.o.busy?.(r.req);
    }
  }

  /** Drop a request nobody will answer, saying the hold line first if the
   *  thread never got it. */
  private giveUp(id: string, r: OpenRequest): void {
    this.drop(id, r);
    if (r.held) return;
    r.held = true;
    if (this.o.hold?.(r.req) === true) this.heard(r);
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
      r.since = moved(r.since);
      if (r.dispatchedAt !== null) r.dispatchedAt = moved(r.dispatchedAt);
      if (r.startedAt !== null) r.startedAt = moved(r.startedAt);
      r.req = { ...r.req, at: moved(r.req.at) };
    }
    for (const [w, at] of this.stalls) this.stalls.set(w, moved(at));
    for (const j of this.judges.values()) {
      if (j.sentAt !== null) j.sentAt = moved(j.sentAt);
      j.queuedAt = moved(j.queuedAt);
    }
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
      this.pumpJudges();
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
    for (const [id, j] of this.judges) if (j.worker !== null) this.workers.get(j.worker)?.send("cancel", { id });
    this.judges.clear();
    this.judgeExpiries.clear();
    this.judgeStalls.clear();
    // A new story: no stall carried over (a still-wedged worker stalls
    // again on its first head), every thread may hear busy / hold anew.
    const wasStalled = this.stalls.size > 0;
    this.stalls.clear();
    this.busyThreads.clear();
    this.heldThreads.clear();
    if (wasStalled) this.o.presence?.();
    this.control({ action: "reset", character: null, by, reason });
  }

  // -- rulings (wave 11b, contract J) ---------------------------------------

  /** Could a ruling by `character` be asked right now — a worker voicing it
   *  connected, not stalled and (wave 18b) not judge-stalled? (It may still
   *  wait in the judge queue for its turn.) */
  canJudge(character: string): boolean {
    for (const w of this.workers.values()) if (w.characters.has(character) && !this.stalls.has(w.id) && !this.judgeStalls.has(w.id)) return true;
    return false;
  }

  /**
   * Ask `body.character` for a ruling (wave 18b: through the judge queue).
   * Returns the ruling's id, or null when nobody can rule now (`canJudge`) —
   * the caller falls back to wave 11's rule. A ruling asked joins the
   * queue's end and goes out as soon as a worker voicing the judge is free
   * (`pumpJudges`).
   */
  judge(body: Omit<AgentJudgeRequest, "id" | "at">): string | null {
    if (!this.canJudge(body.character)) return null;
    const id = `jr-${globalThis.crypto.randomUUID().slice(0, 8)}`;
    const req: AgentJudgeRequest = { ...body, id, at: Date.now() };
    this.judges.set(id, { req, worker: null, sentAt: null, queuedAt: this.now() });
    this.pumpJudges();
    return id;
  }

  /**
   * Send the queue's rulings to the workers free to take one, oldest
   * first: a worker voicing the ruling's character, connected, not
   * stalled or judge-stalled, with fewer than `AGENT_JUDGE_INFLIGHT` out
   * and — voice first — no open voice request.
   */
  private pumpJudges(): void {
    for (const j of this.judges.values()) {
      if (j.worker !== null) continue;
      let best: AgentWorker | null = null;
      for (const w of this.workers.values()) {
        if (!w.characters.has(j.req.character) || this.stalls.has(w.id) || this.judgeStalls.has(w.id)) continue;
        if (this.loadOf(w.id) > 0) continue; // voice first
        let out = 0;
        for (const o of this.judges.values()) if (o.worker === w.id) out += 1;
        if (out >= AGENT_JUDGE_INFLIGHT) continue;
        best = w;
        break;
      }
      if (best === null) continue;
      j.worker = best.id;
      j.sentAt = this.now();
      best.send("judge", j.req);
      this.o.judgeSent?.(j.req);
    }
  }

  /** `workerId` answered something: its expiry count and judge stall end. */
  private judgeAnswered(workerId: string): void {
    this.judgeExpiries.delete(workerId);
    if (this.judgeStalls.delete(workerId)) this.o.presence?.();
  }

  /** The rulings queued or out (the Judging card's "asking…"), FIFO. */
  get judging(): AgentJudgeRequest[] {
    return [...this.judges.values()].map((j) => j.req);
  }

  /** Is ruling `id` still in the queue, not yet sent (wave 18b)? */
  judgeQueued(id: string): boolean {
    return this.judges.get(id)?.worker === null;
  }

  /** A worker answered ruling `id`: it is closed and returned, or null when
   *  it is gone (answered, cancelled, expired, a restart), still queued, or
   *  another worker holds it. Any answer shows the worker is answering. */
  judgeSettle(id: string, workerId?: string): AgentJudgeRequest | null {
    if (workerId !== undefined && this.workers.has(workerId)) this.judgeAnswered(workerId);
    const j = this.judges.get(id);
    if (j === undefined || j.worker === null || (workerId !== undefined && j.worker !== workerId)) return null;
    this.judges.delete(id);
    this.pumpJudges();
    return j.req;
  }

  /** The ruling is moot (a director judged the filing first, it was filed
   *  again, its round settled): drop it — queued or out — and tell its
   *  worker, so a late answer gets a 410. */
  cancelJudge(id: string): boolean {
    const j = this.judges.get(id);
    if (j === undefined) return false;
    this.judges.delete(id);
    if (j.worker !== null) this.workers.get(j.worker)?.send("cancel", { id });
    this.o.judgeGone?.(j.req, "cancelled");
    this.pumpJudges();
    return true;
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
