//! The host's Desk window, as plain decisions (wave 25, docs/loom-house-desk.md
//! §6.2): the long poll's path, the standby card and its GO, the running
//! runs, the cue list by section, and the checks walked one row at a time.
//! The desk itself — its sections, its steps in words, the checks, their
//! progress and the status chips — is core's `house-desk.ts` (frozen,
//! imported by path like `cue-sheet.ts`); this file only arranges it for a
//! phone. No React, so every rule is tested on plain values.

import {
  checkProgress,
  cueEvents,
  cueTimeline,
  deskChecks,
  deskSections,
  deskStatus,
  nextOpenCheck,
  runProgress,
  secondsText,
  stepText,
  stepTiming,
  testNeedsConfirm,
  type DeskActivity,
  type DeskCheckKind,
  type DeskCheckRow,
  type DeskCheckSection,
  type DeskChip,
  type DeskCue,
  type DeskDurations,
  type DeskMark,
  type DeskRun,
  type DeskView,
} from "../../../core/src/house-desk.ts";

export type { DeskCheckRow, DeskCheckSection, DeskChip, DeskView };
export { deskChecks, deskStatus, testNeedsConfirm };

// --- the long poll ---------------------------------------------------------------

/** How long the server may hold a desk poll (s): `wait=` on the GET. */
export const DESK_WAIT_S = 25;
/** The phone gives up on a held poll after this (the server answers by `wait`). */
export const DESK_POLL_TIMEOUT_MS = (DESK_WAIT_S + 10) * 1000;
/** The gap between one answered poll and the next (the next one is held again). */
export const DESK_REPOLL_MS = 250;

/** The desk's GET, relative to `/e/:id`: the first read is plain; after
 *  that it long-polls past the `rev` it holds. */
export function deskPollPath(after: number | null): string {
  return after === null ? "/api/mod/desk" : `/api/mod/desk?after=${Math.max(0, Math.floor(after))}&wait=${DESK_WAIT_S}`;
}

/** What one desk poll's answer means: a view, an answer with no desk in it
 *  (keep the one on screen), or a refusal in plain words. */
export type DeskPoll = { kind: "view"; view: DeskView } | { kind: "same" } | { kind: "error"; message: string };

export function deskPollOutcome(status: number, body: unknown): DeskPoll {
  const b = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (status >= 200 && status < 300) {
    const desk = b["desk"];
    const ok = typeof b["rev"] === "number" && desk !== null && typeof desk === "object" && Array.isArray((desk as { cues?: unknown }).cues) && b["house"] !== null && typeof b["house"] === "object";
    return ok ? { kind: "view", view: b as unknown as DeskView } : { kind: "same" };
  }
  const error = typeof b["error"] === "string" ? b["error"] : `HTTP ${status}`;
  if (status === 404 && /unknown event/iu.test(error)) return { kind: "error", message: "That event has ended." };
  if (status === 404) return { kind: "error", message: "This server has no house desk yet." };
  // A server from before the desk refuses every mod route it doesn't list for a booth.
  if (status === 403 && /not from a booth/iu.test(error)) return { kind: "error", message: "This server doesn't open the house desk to booths yet." };
  if (status === 403) return { kind: "error", message: "This booth isn't a host any more." };
  return { kind: "error", message: error };
}

/** The server's clock now (its `now`, plus the wall time since the answer landed). */
export function serverNow(view: Pick<DeskView, "now">, receivedAt: number, wall: number): number {
  return view.now + Math.max(0, wall - receivedAt);
}

// --- the cues ----------------------------------------------------------------------

/** "12 · The Heart wakes", or the name alone. */
export function cueLabel(cue: Pick<DeskCue, "number" | "name">): string {
  const n = cue.number?.trim() ?? "";
  return n !== "" ? `${n} · ${cue.name}` : cue.name;
}

/** What the house knows of how long things last (the looks' plans, the router's file lengths). */
export function deskDurations(view: Pick<DeskView, "house">): DeskDurations {
  const looks = new Map(view.house.looks.map((l) => [l.name, l.ms]));
  const sounds = new Map(view.house.sounds.map((s) => [s.name, s.ms]));
  return { lookMs: (l) => looks.get(l) ?? null, soundMs: (s) => sounds.get(s) ?? null };
}

/** A cue's planned length ("12 s"), or null when a step's length isn't known before it plays. */
export function cueLength(cue: Pick<DeskCue, "steps">, d: DeskDurations): string | null {
  if (cue.steps.length === 0) return null;
  const end = cueTimeline(cue, d).end;
  return end === null ? null : secondsText(end);
}

/** The story events a cue fires, as the line beside GO says them — so nobody fires them by surprise (§3). */
export function eventsLine(events: readonly string[]): string | null {
  return events.length === 0 ? null : `⚡ Tells the story: ${events.join(", ")}`;
}

/** The standby card: the cue GO fires, its steps in words, what it tells the story. */
export interface StandbyCard {
  cue: DeskCue | null;
  label: string;
  notes: string | null;
  steps: string[];
  events: string[];
  length: string | null;
  /** A run of this cue is still going (GO stops it and starts it again). */
  running: boolean;
}

/** What the end of the list says on the card. */
export const END_OF_LIST = "End of the list — tap a cue below to stand it by.";
export const NO_CUES = "The desk has no cues yet. They are built in the editor's Run → House.";

export function standbyCard(view: Pick<DeskView, "desk" | "standby" | "runs" | "house">): StandbyCard {
  const cue = view.standby === null ? null : (view.desk.cues.find((c) => c.id === view.standby) ?? null);
  if (cue === null) return { cue: null, label: view.desk.cues.length === 0 ? NO_CUES : END_OF_LIST, notes: null, steps: [], events: [], length: null, running: false };
  const notes = cue.notes?.trim() ?? "";
  return {
    cue,
    label: cueLabel(cue),
    notes: notes !== "" ? notes : null,
    steps: cue.steps.map((s, i) => `${stepTiming(s, i)} ${stepText(s)}`.trim()),
    events: cueEvents(cue),
    length: cueLength(cue, deskDurations(view)),
    running: view.runs.some((r) => r.cue === cue.id && r.state === "running"),
  };
}

/** One row of the cue list: tap to stand it by. */
export interface DeskCueRow {
  id: string;
  label: string;
  /** Its first step in words, and how many more. */
  summary: string;
  standby: boolean;
  running: boolean;
  events: string[];
  length: string | null;
}

export function cueSummary(cue: Pick<DeskCue, "steps">): string {
  if (cue.steps.length === 0) return "no steps";
  const more = cue.steps.length - 1;
  return `${stepText(cue.steps[0]!)}${more > 0 ? ` · +${more} more` : ""}`;
}

/** The cue list under its sections (`deskSections`), each row marked standby / running. */
export function deskCueList(view: Pick<DeskView, "desk" | "standby" | "runs" | "house">): Array<{ title: string | null; rows: DeskCueRow[] }> {
  const d = deskDurations(view);
  const running = new Set(view.runs.filter((r) => r.state === "running").map((r) => r.cue));
  return deskSections(view.desk).map((s) => ({
    title: s.title,
    rows: s.cues.map((c) => ({ id: c.id, label: cueLabel(c), summary: cueSummary(c), standby: c.id === view.standby, running: running.has(c.id), events: cueEvents(c), length: cueLength(c, d) })),
  }));
}

/** What GO's refusal says (§2.1): another console moved the playhead, the
 *  end of the list, a cue that has gone, anything else as the server put it. */
export function goRefusal(status: number, message: string): string {
  if (status === 409 && message === "moved") return "Standby moved — press GO again";
  if (status === 409 && message === "end") return "That was the last cue — tap a cue to stand it by";
  if (status === 404) return "That cue isn't on the desk any more";
  return `Not done — ${message}`;
}

// --- the runs ------------------------------------------------------------------------

/** Step results that mean something didn't happen. */
const TROUBLE = new Set(["no-file", "nowhere", "error", "refused", "timeout", "router away", "no terminal", "closed"]);

/** One run as the Desk shows it. */
export interface RunRow {
  run: number;
  name: string;
  by: string;
  running: boolean;
  state: DeskRun["state"];
  /** 0–1. */
  progress: number;
  /** What it is doing now, or how it ended. */
  line: string;
  /** Steps that didn't go as planned ("no-file: 🔊 server_hum"). */
  trouble: string[];
}

export function runRow(run: DeskRun, cue: DeskCue | undefined, now: number): RunRow {
  const text = (i: number) => (cue?.steps[i] !== undefined ? stepText(cue.steps[i]!) : `step ${i + 1}`);
  const trouble = run.steps.filter((s) => s.result !== undefined && TROUBLE.has(s.result)).map((s) => `${s.result}: ${text(s.i)}`);
  let line: string;
  if (run.state === "running") {
    const on = run.steps.filter((s) => s.state === "running").map((s) => text(s.i));
    const groups = run.steps.reduce((m, s) => Math.max(m, s.group), 0) + 1;
    line = `${groups > 1 ? `part ${run.group + 1} of ${groups}` : "playing"}${on.length > 0 ? ` · ${on.join(" + ")}` : " · waiting"}`;
  } else line = run.state === "stopped" ? "■ stopped" : "✓ done";
  return { run: run.run, name: run.name, by: run.by, running: run.state === "running", state: run.state, progress: runProgress(run, now), line, trouble };
}

/** The runs, running first (the server's order kept within each). */
export function runRows(view: Pick<DeskView, "runs" | "desk">, now: number): RunRow[] {
  const byId = new Map(view.desk.cues.map((c) => [c.id, c]));
  const rows = view.runs.map((r) => runRow(r, byId.get(r.cue), now));
  return [...rows.filter((r) => r.running), ...rows.filter((r) => !r.running)];
}

// --- the checks, walked ------------------------------------------------------------------

/** Where the walk stands: the row on screen, its place in the list, the progress. */
export interface Walk {
  row: DeskCheckRow | null;
  section: string | null;
  /** 1-based place of the row in the whole list. */
  at: number;
  total: number;
  progress: ReturnType<typeof checkProgress>;
  /** Every row has a mark. */
  done: boolean;
}

/** The walk at `key` (the row the host is on), else the first row with no
 *  mark, else the first row. */
export function walkAt(sections: readonly DeskCheckSection[], key: string | null): Walk {
  const rows = sections.flatMap((s) => s.rows.map((r) => ({ r, s: s.title })));
  const progress = checkProgress(sections);
  const done = progress.total > 0 && progress.open === 0;
  const hit = (key !== null ? rows.find((x) => x.r.key === key) : undefined) ?? (() => {
    const open = nextOpenCheck(sections, null);
    return open !== null ? rows.find((x) => x.r.key === open.key) : rows[0];
  })();
  if (hit === undefined) return { row: null, section: null, at: 0, total: 0, progress, done };
  return { row: hit.r, section: hit.s, at: rows.indexOf(hit) + 1, total: rows.length, progress, done };
}

/** The next row with no mark after `key`; when every row is marked, the next row in order (so *next* always moves). */
export function walkNext(sections: readonly DeskCheckSection[], key: string | null): string | null {
  const open = nextOpenCheck(sections, key);
  if (open !== null && open.key !== key) return open.key;
  const rows = sections.flatMap((s) => s.rows);
  if (rows.length === 0) return null;
  const i = key === null ? -1 : rows.findIndex((r) => r.key === key);
  return rows[(i + 1) % rows.length]!.key;
}

/** The row before `key` (wrapping). */
export function walkBack(sections: readonly DeskCheckSection[], key: string | null): string | null {
  const rows = sections.flatMap((s) => s.rows);
  if (rows.length === 0) return null;
  const i = key === null ? 0 : Math.max(0, rows.findIndex((r) => r.key === key));
  return rows[(i - 1 + rows.length) % rows.length]!.key;
}

/** The checks with one mark set here at once, before the poll brings it back. */
export function withMark(sections: readonly DeskCheckSection[], key: string, mark: DeskMark | null): DeskCheckSection[] {
  return sections.map((s) => ({ ...s, rows: s.rows.map((r) => (r.key === key ? { ...r, mark } : r)) }));
}

/** After a mark, the walk moves to the next open row (it stays when that was the last). */
export function afterMark(sections: readonly DeskCheckSection[], key: string, mark: "ok" | "bad", by: string, at: number): string {
  const marked = withMark(sections, key, { mark, by, at });
  return nextOpenCheck(marked, key)?.key ?? key;
}

/** Is this a thing you look at (a light, a look) rather than listen to? */
export function seenNotHeard(kind: DeskCheckKind): boolean {
  return kind === "fixture" || kind === "look";
}

/** The two mark buttons, in plain words. */
export function markWords(kind: DeskCheckKind): { ok: string; bad: string } {
  return seenNotHeard(kind) ? { ok: "✓ Saw it", bad: "✗ Nothing" } : { ok: "✓ Heard it", bad: "✗ Nothing" };
}

/** What Test does, on its button. */
export function testWords(kind: DeskCheckKind): string {
  switch (kind) {
    case "speaker":
    case "out":
      return "🔊 Test tone";
    case "sound":
      return "▶ Play it";
    case "fixture":
      return "💡 Flash it";
    case "look":
      return "💡 Play the look";
  }
}

/** The ask before a test once the doors are open (`testNeedsConfirm`). */
export function liveAsk(kind: DeskCheckKind): string {
  return seenNotHeard(kind) ? "The show is live — guests will see this. Test anyway?" : "The show is live — guests will hear this. Test anyway?";
}

/** A mark as its row reads it: "✓ Director · 3 min ago". */
export function markLine(mark: DeskMark | null, now: number): string | null {
  if (mark === null) return null;
  const mins = Math.max(0, Math.floor((now - mark.at) / 60_000));
  const ago = mins === 0 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)} h ago`;
  return `${mark.mark === "ok" ? "✓" : "✗"} ${mark.by} · ${ago}${mark.note !== undefined && mark.note !== "" ? ` · ${mark.note}` : ""}`;
}

/** "12 of 30 checked · 2 ✗". */
export function progressLine(p: ReturnType<typeof checkProgress>): string {
  if (p.total === 0) return "Nothing to check: the house has no speakers, sounds or lights yet.";
  const checked = p.ok + p.bad;
  return `${checked} of ${p.total} checked${p.bad > 0 ? ` · ${p.bad} ✗` : ""}`;
}

// --- what the house did lately -----------------------------------------------------------

/** The last few things the house did, one line each, newest first. */
export function recentLines(recent: readonly DeskActivity[], n = 5): string[] {
  return recent.slice(0, n).map((a) => `${a.text} · ${a.by}${a.result !== undefined && a.result !== "" ? ` · ${a.result}` : ""}`);
}

/** A status chip's class: its tone. */
export function chipClass(c: Pick<DeskChip, "tone">): string {
  return `host-desk-chip ${c.tone}`;
}
