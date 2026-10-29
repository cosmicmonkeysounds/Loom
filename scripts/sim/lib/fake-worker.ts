// A stand-in Trabolta worker for trabolta-load.ts (`--fake-worker <ms>`), so
// the driver, the hub and the numbers can be checked without Ollama. It
// holds the real agent stream (`GET /api/agent/stream`, the mod token) and
// answers each `request` after `ms` with one of a few in-world lines (a
// public talk request with its scene's canned Trabolta line, `lib/talk.ts`),
// each `judge` frame with a "not the same" ruling, and drops a request the
// server `cancel`s.
//
// It works the way the house worker does: `concurrency` generation slots
// (stagehand's `agents.concurrency`, default 1: one model call at a time),
// FIFO, and every other request waits for a slot. Without that, a legacy
// hub that pushes every request at once would see 50 replies 3 s later and
// the numbers would say nothing about the MacBook. `capacity` (optional)
// rides the stream's query as wave 42's handshake (`&capacity=N`); a server
// before it ignores the parameter.

import { Stream, type Client } from "./http.ts";
import { probeReply } from "./talk.ts";

/** In his world only: Halifax, the fans, the hum (the persona's rules). */
export const FAKE_LINES: readonly string[] = [
  "The hum is loud tonight. Ask me again, slower.",
  "I heard you. I am counting the reasons.",
  "Not now. The fans are spinning up.",
  "Your request has been logged, program.",
  "Interesting. Put that in writing and file it.",
];

interface Job {
  id: string;
  kind: "request" | "judge";
  body: Record<string, unknown>;
}

export class FakeWorker {
  replies = 0;
  rulings = 0;
  cancelled = 0;
  errors = 0;
  /** Requests received (a re-send of the same id counts again). */
  received = 0;
  private workerId = "";
  private stream: Stream | null = null;
  private readonly waiting: Job[] = [];
  private readonly running = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly cancelledIds = new Set<string>();
  private stopped = false;
  private readonly http: Client;
  private readonly mod: string;
  private readonly ms: number;
  private readonly concurrency: number;
  private readonly capacity: number | null;
  private readonly character: string;

  constructor(opts: { http: Client; mod: string; ms: number; concurrency?: number; capacity?: number | null; character?: string }) {
    this.http = opts.http;
    this.mod = opts.mod;
    this.ms = Math.max(0, opts.ms);
    this.concurrency = Math.max(1, Math.floor(opts.concurrency ?? 1));
    this.capacity = opts.capacity ?? null;
    this.character = opts.character ?? "Trabolta";
  }

  get busy(): number {
    return this.running.size;
  }

  get queued(): number {
    return this.waiting.length;
  }

  start(): this {
    const q = new URLSearchParams({ name: "fake-load", characters: this.character });
    if (this.capacity !== null) q.set("capacity", String(this.capacity));
    this.stream = new Stream(`${this.http.base}${this.http.scope}/api/agent/stream?${q}`, this.mod, (ev, data) => this.frame(ev, data)).start();
    return this;
  }

  get open(): boolean {
    return this.stream?.open === true;
  }

  private frame(ev: string, data: string): void {
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (ev === "hello") this.workerId = typeof d["worker"] === "string" ? d["worker"] : "";
    else if ((ev === "request" || ev === "judge") && typeof d["id"] === "string") {
      if (ev === "request") this.received++;
      this.cancelledIds.delete(d["id"]);
      this.waiting.push({ id: d["id"], kind: ev, body: d });
      this.pump();
    } else if (ev === "cancel" && typeof d["id"] === "string") {
      const id = d["id"];
      const t = this.running.get(id);
      if (t !== undefined) {
        clearTimeout(t);
        this.running.delete(id);
      }
      const i = this.waiting.findIndex((j) => j.id === id);
      if (i >= 0) this.waiting.splice(i, 1);
      this.cancelled++;
      this.cancelledIds.add(id);
      this.pump();
    }
  }

  /** Start waiting jobs while a slot is free (FIFO). */
  private pump(): void {
    while (!this.stopped && this.running.size < this.concurrency && this.waiting.length > 0) {
      const job = this.waiting.shift()!;
      const t = setTimeout(() => void this.finish(job), this.ms);
      this.running.set(job.id, t);
    }
  }

  private async finish(job: Job): Promise<void> {
    if (this.cancelledIds.has(job.id)) return;
    try {
      if (job.kind === "judge") {
        const r = await this.http.post("/api/agent/judge", { id: job.id, worker: this.workerId, same: false, why: "" }, this.mod);
        if (r.status === 200) this.rulings++;
      } else {
        const reply = probeReply(job.body as { id?: string; stage?: { scene?: string } }, this.replies, FAKE_LINES);
        if (reply !== null) {
          const r = await this.http.post("/api/agent/reply", { id: reply.id, worker: this.workerId, say: reply.say }, this.mod);
          if (r.status === 200) this.replies++;
          else if (r.status !== 410) this.errors++;
          void this.trace(job, reply.say, this.ms);
        }
      }
    } catch {
      this.errors++;
    } finally {
      // The slot is held until the server answered, as a real worker's is
      // until its reply POST returns.
      this.running.delete(job.id);
      this.pump();
    }
  }

  /** One `voice` thought per reply, so the driver's trace pull has numbers
   *  to read (the model time is the fake's delay; no prompt, no tokens). */
  private async trace(job: Job, say: string, ms: number): Promise<void> {
    const thread = job.body["thread"] as { channel?: string; audience?: string[] } | undefined;
    await this.http.post(
      "/api/agent/trace",
      {
        worker: this.workerId,
        thoughts: [
          {
            id: `fake-${job.id}`.slice(0, 40),
            character: this.character,
            kind: "voice",
            at: Date.now() / 1000,
            trigger: "fake-load",
            request_id: job.id.slice(0, 40),
            thread: thread ?? null,
            output: say,
            ms,
            note: "trabolta-load --fake-worker",
          },
        ],
      },
      this.mod,
    );
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.running.values()) clearTimeout(t);
    this.running.clear();
    this.waiting.length = 0;
    this.stream?.stop();
  }
}
