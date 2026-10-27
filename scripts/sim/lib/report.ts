// The simulator's scoreboard: one green/red line per beat, the route
// latencies, the quests, and the final summary table. Pure (no I/O but the
// `log` it is handed), so `node --test` covers it.

export interface BeatResult {
  name: string;
  ok: boolean;
  /** What went wrong (or a note on a green beat), never a secret. */
  notes: string[];
  ms: number;
}

/** Nearest-rank percentile (`p` in 0–100); NaN for no samples. */
export function pct(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

export const fmtMs = (n: number): string => (Number.isFinite(n) ? `${Math.round(n)} ms` : "—");

const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

/** A beat line: `✔ name (1.2 s)` in green, `✘ name — why` in red. */
export function beatLine(b: BeatResult, color = true): string {
  const c = (code: string, s: string) => (color ? `${code}${s}${RESET}` : s);
  const secs = `${(b.ms / 1000).toFixed(1)} s`;
  if (b.ok) {
    const note = b.notes.length > 0 ? c(DIM, ` · ${b.notes.join(" · ")}`) : "";
    return `${c(GREEN, "✔")} ${b.name} ${c(DIM, `(${secs})`)}${note}`;
  }
  return `${c(RED, "✘")} ${c(RED, b.name)} ${c(DIM, `(${secs})`)}\n${b.notes.map((n) => `    ${c(RED, "·")} ${n}`).join("\n")}`;
}

/** A route key for the latency table: `/api/guest/choose`, ids folded out. */
export function routeKey(method: string, path: string): string {
  const bare = path.split("?")[0]!.replace(/^\/e\/[^/]+/u, "");
  return `${method} ${bare}`;
}

export class Recorder {
  readonly beats: BeatResult[] = [];
  /** Route → latencies (ms). */
  readonly latency = new Map<string, number[]>();
  /** Every HTTP answer that was not what the bot expected. */
  readonly errors: string[] = [];

  time(route: string, ms: number): void {
    const xs = this.latency.get(route) ?? [];
    xs.push(ms);
    this.latency.set(route, xs);
  }

  allLatencies(): number[] {
    return [...this.latency.values()].flat();
  }

  add(b: BeatResult): BeatResult {
    this.beats.push(b);
    return b;
  }

  get failed(): BeatResult[] {
    return this.beats.filter((b) => !b.ok);
  }

  /** 0 when every beat was green, 1 otherwise. */
  exitCode(): number {
    return this.failed.length === 0 && this.beats.length > 0 ? 0 : 1;
  }
}

export interface QuestTally {
  /** Quest id → how many people hold it done / active / failed. */
  rows: Array<{ id: string; done: number; active: number; failed: number }>;
  doneTotal: number;
  /** Quests at least one person completed. */
  questsDone: number;
}

/** Tally the mod view's `quests` (id + per-person status). */
export function tallyQuests(quests: ReadonlyArray<{ id: string; status: Record<string, string> }> | undefined): QuestTally {
  const rows = (quests ?? []).map((q) => {
    const st = Object.values(q.status);
    return { id: q.id, done: st.filter((s) => s === "done" || s === "completed").length, active: st.filter((s) => s === "active").length, failed: st.filter((s) => s === "failed").length };
  });
  return { rows, doneTotal: rows.reduce((a, r) => a + r.done, 0), questsDone: rows.filter((r) => r.done > 0).length };
}

/** The final summary table (plain text, aligned). */
export function summaryTable(rec: Recorder, quests: QuestTally, extra: Array<[string, string]> = []): string {
  const all = rec.allLatencies();
  const passed = rec.beats.filter((b) => b.ok).length;
  const lines: Array<[string, string]> = [
    ["beats passed", `${passed} / ${rec.beats.length}`],
    ["quests completed", `${quests.questsDone} / ${quests.rows.length} quests (${quests.doneTotal} completions)`],
    ["errors", String(rec.errors.length)],
    ["requests", String(all.length)],
    ["latency p50", fmtMs(pct(all, 50))],
    ["latency p95", fmtMs(pct(all, 95))],
    ...extra,
  ];
  const w = Math.max(...lines.map(([k]) => k.length));
  const out = ["┌" + "─".repeat(w + 2) + "┬" + "─".repeat(52) + "┐"];
  for (const [k, v] of lines) out.push(`│ ${k.padEnd(w)} │ ${v.slice(0, 50).padEnd(50)} │`);
  out.push("└" + "─".repeat(w + 2) + "┴" + "─".repeat(52) + "┘");
  return out.join("\n");
}

/** The slowest routes, for the tail of the summary. */
export function slowRoutes(rec: Recorder, n = 6): string[] {
  return [...rec.latency.entries()]
    .map(([route, xs]) => ({ route, p95: pct(xs, 95), p50: pct(xs, 50), count: xs.length }))
    .sort((a, b) => b.p95 - a.p95)
    .slice(0, n)
    .map((r) => `  ${r.route.padEnd(36)} ×${String(r.count).padStart(4)}  p50 ${fmtMs(r.p50).padStart(7)}  p95 ${fmtMs(r.p95).padStart(7)}`);
}
