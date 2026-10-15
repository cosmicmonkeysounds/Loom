// The pure half of K-04-burst.ts (SW-AI-23): who is still waiting for the
// agent, which feed message answers whom, and the numbers at the end. No
// I/O, so `burst.test.ts` pins it with `node --test`.

/** A chat message as the mod feed's `message` frames carry it. */
export interface FeedMessage {
  from?: unknown;
  channel?: unknown;
  text?: unknown;
  audience?: unknown;
}

export interface BurstSummary {
  sent: number;
  /** Real replies (not the hold line). */
  answered: number;
  /** Bots that only ever got the hold line (no worker was online). */
  heldOnly: number;
  /** Bots nobody answered before the deadline. */
  missing: number;
  /** Seconds from each bot's DM to the agent's first real reply. */
  p50: number;
  p95: number;
  max: number;
  pass: boolean;
}

export const pct = (xs: readonly number[], p: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
};

/** At least this share of the bots must get a real reply for a PASS. */
export const PASS_SHARE = 0.9;

/**
 * The clock for one burst: `sent` when a bot's DM went out, `seen` for every
 * feed message. A reply is a line FROM the character in its `dm:` thread
 * addressed to a bot we are timing; only the first real reply counts, and a
 * hold line (`hold:` in the cast file) is tallied apart — it means the hub
 * spoke for an absent worker, not that the agent answered.
 */
export class BurstClock {
  private readonly sentAt = new Map<string, number>();
  private readonly repliedAt = new Map<string, number>();
  private readonly held = new Set<string>();
  // Plain fields, not parameter properties: Node's type stripping runs
  // these scripts and only erases syntax that has no runtime meaning.
  private readonly character: string;
  private readonly hold: string | null;

  constructor(character: string, hold: string | null) {
    this.character = character;
    this.hold = hold;
  }

  sent(bot: string, at: number): void {
    this.sentAt.set(bot, at);
  }

  /** Feed one message; returns the bots it answered for the first time. */
  seen(m: FeedMessage, at: number): string[] {
    if (m.from !== this.character || m.channel !== `dm:${this.character}`) return [];
    const audience = Array.isArray(m.audience) ? m.audience.filter((a): a is string => typeof a === "string") : [];
    const isHold = this.hold !== null && typeof m.text === "string" && m.text.trim() === this.hold;
    const out: string[] = [];
    for (const bot of audience) {
      if (!this.sentAt.has(bot) || this.repliedAt.has(bot)) continue;
      if (isHold) {
        this.held.add(bot);
        continue;
      }
      this.repliedAt.set(bot, at);
      out.push(bot);
    }
    return out;
  }

  /** Bots still without a real reply. */
  waiting(): string[] {
    return [...this.sentAt.keys()].filter((b) => !this.repliedAt.has(b));
  }

  summary(): BurstSummary {
    const lat: number[] = [];
    for (const [bot, at] of this.repliedAt) lat.push((at - this.sentAt.get(bot)!) / 1000);
    const waiting = this.waiting();
    const heldOnly = waiting.filter((b) => this.held.has(b)).length;
    const sent = this.sentAt.size;
    return {
      sent,
      answered: lat.length,
      heldOnly,
      missing: waiting.length - heldOnly,
      p50: pct(lat, 50),
      p95: pct(lat, 95),
      max: lat.length === 0 ? NaN : Math.max(...lat),
      pass: sent > 0 && lat.length >= Math.ceil(sent * PASS_SHARE),
    };
  }
}

/** The line to paste into the checklist (SW-AI-23). */
export function recordLine(s: BurstSummary, when: string, where: string, spreadS = 0): string {
  const sec = (n: number) => (Number.isFinite(n) ? `${n.toFixed(1)} s` : "—");
  return (
    `record: ${when} · ${where} · ${s.sent} DMs ${spreadS > 0 ? `over ${spreadS} s` : "at once"} → ${s.answered} answered` +
    `${s.heldOnly > 0 ? `, ${s.heldOnly} hold line only` : ""}${s.missing > 0 ? `, ${s.missing} unanswered` : ""}` +
    ` · p50 ${sec(s.p50)} · p95 ${sec(s.p95)} · max ${sec(s.max)} · ${s.pass ? "PASS" : "FAIL"}`
  );
}
