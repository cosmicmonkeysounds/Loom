//! The output side of `showctl`: the green / amber / red check rows every
//! command reports in, the table they print as, the exit code they add up
//! to, and the masks that keep a passcode or a token off a projector.
//!
//! Pure (no I/O): `showctl.ts` decides where the text goes. Colour is a
//! parameter, never sniffed here — the caller turns it on only for a TTY
//! (and never under `NO_COLOR` or `--no-color`), so a log file or a
//! `--json` pipe never carries escape codes.

/** How a check came out. `info` is a fact with no verdict (counts, names). */
export type Level = "ok" | "info" | "warn" | "fail";

/** One row of a report: what was checked, how it came out, and what it read. */
export interface Check {
  /** Short name, the left column ("VPS health", "Trabolta's worker"). */
  name: string;
  level: Level;
  /** The verdict in words — what is wrong and, when red / amber, what to do. */
  detail: string;
  /** Where the answer came from (`GET /api/health`, `ollama /api/ps`): every
   *  check names what it read, so a red row is never a mystery. */
  read: string;
}

/** The process exit code a set of checks adds up to: 0 all fine, 1 any
 *  amber, 2 any red (the contract every `showctl` command keeps). */
export function exitCode(checks: readonly Check[]): 0 | 1 | 2 {
  if (checks.some((c) => c.level === "fail")) return 2;
  if (checks.some((c) => c.level === "warn")) return 1;
  return 0;
}

/** The worse of two levels (`fail` > `warn` > `info` > `ok`). */
export function worst(a: Level, b: Level): Level {
  const rank: Record<Level, number> = { ok: 0, info: 1, warn: 2, fail: 3 };
  return rank[b] > rank[a] ? b : a;
}

const MARK: Record<Level, string> = { ok: "OK  ", info: "··  ", warn: "WARN", fail: "FAIL" };
const SGR: Record<Level, string> = { ok: "32", info: "2", warn: "33", fail: "31;1" };

/** Wrap `text` in an SGR colour when `on` (`32` green, `33` amber, …). */
export function paint(text: string, sgr: string, on: boolean): string {
  return on ? `\u001b[${sgr}m${text}\u001b[0m` : text;
}

/** A level's 4-wide tag, coloured when asked. */
export function mark(level: Level, color: boolean): string {
  return paint(MARK[level], SGR[level], color);
}

/** Display width of a string, near enough for a terminal table: one cell
 *  per code point, two for the emoji and wide symbols this tool prints. */
export function width(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xfe0f || cp === 0x200d) continue; // variation selector / ZWJ
    n += cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2e80 && cp <= 0xa4cf) ? 2 : 1;
  }
  return n;
}

/** Pad to a display width (never truncates). */
export function pad(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - width(s)));
}

/**
 * The check table: `TAG  name  detail  (read)`, the name column as wide as
 * the widest name, the source dimmed. `verbose` keeps the `(read)` column;
 * without it a row carries the source only when it is amber or red (where
 * you need to know what to look at next).
 */
export function renderChecks(checks: readonly Check[], opts: { color: boolean; verbose?: boolean }): string {
  const nameW = Math.min(28, Math.max(0, ...checks.map((c) => width(c.name))));
  return checks
    .map((c) => {
      const src = opts.verbose === true || c.level === "warn" || c.level === "fail" ? paint(`  (${c.read})`, "2", opts.color) : "";
      return `${mark(c.level, opts.color)}  ${pad(c.name, nameW)}  ${c.detail}${src}`;
    })
    .join("\n");
}

/** The one-line tally under a check table. */
export function summary(checks: readonly Check[], color: boolean): string {
  const n = (l: Level) => checks.filter((c) => c.level === l).length;
  const fail = n("fail");
  const warn = n("warn");
  const head = fail > 0 ? paint("RED", SGR.fail, color) : warn > 0 ? paint("AMBER", SGR.warn, color) : paint("GREEN", SGR.ok, color);
  return `${head}  ${n("ok")} ok · ${warn} warning${warn === 1 ? "" : "s"} · ${fail} failure${fail === 1 ? "" : "s"}`;
}

/** A plain table: a header row, then rows, each column as wide as its
 *  widest cell (display width). An empty table is just the header. */
export function renderTable(head: readonly string[], rows: readonly (readonly string[])[], color = false): string {
  const w = head.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i] ?? ""))));
  const line = (r: readonly string[]) => r.map((c, i) => (i === r.length - 1 ? c : pad(c, w[i]!))).join("  ").trimEnd();
  return [paint(line(head), "1", color), ...rows.map(line)].join("\n");
}

/** CSV with RFC 4180 quoting (a name with a comma stays one cell). */
export function renderCsv(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const cell = (s: string) => (/[",\n\r]/u.test(s) ? `"${s.replace(/"/gu, '""')}"` : s);
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}

/**
 * A passcode as it may be printed: its first two characters, then dots for
 * the rest (`MO•••••`). Never the whole code — a doctor screen ends up on a
 * projector, in a photo, in a chat. Two characters or fewer print as dots.
 */
export function maskCode(code: string): string {
  if (code.length <= 2) return "•".repeat(code.length);
  return code.slice(0, 2) + "•".repeat(Math.min(8, code.length - 2));
}

/** A session token is never printed at all, not even in part. */
export const TOKEN_SHOWN = "(token cached, never printed)";

/** "12 s", "4 min", "2 h 5 min" — an age in ms, for a human. */
export function ago(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** The show clock's minutes past midnight as `7:05 PM`. */
export function clockText(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
