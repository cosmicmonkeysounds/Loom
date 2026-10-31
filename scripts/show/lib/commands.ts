//! `showctl`'s commands. Each takes a `Ctx` (the session, the parsed argv,
//! where output goes, the machine) and answers an exit code: 0 all fine,
//! 1 warnings, 2 failures (3: the live guard refused a write).
//!
//! Every read here is one a director's Run page makes, minus anything that
//! registers the caller: the screen state is read with no `name` (a named
//! read is a terminal heartbeat — it would show up as a fake terminal on
//! Run → Terminals), `/api/mod/audio` without `router=1`, `/api/mod/lights`
//! without `module=1`, the spatial `stations` list (never `station?id=`).
//! The log is polled (`/api/mod/log?after=`), never streamed, so `showctl`
//! never counts as a director console. The one write is `fire`, behind
//! `--yes` and the live guard every acceptance script uses.

import { hostname } from "node:os";
import { judge, LIVE_OVERRIDE, realGuests } from "../../../core/scripts/live-guard.ts";
import { cueRows } from "../../../core/src/cue-sheet.ts";
import type { Args } from "./args.ts";
import { flagOn, flagStr, listFlag, watchSeconds } from "./args.ts";
import { ADS_PROBE, adsMediaCheck, agentChecks, agentsBeforeDoorsCheck, audioCheck, beforeDoors, KEY_SPOTS, DREAM_PROBE, dreamMediaCheck, healthCheck, joinBaseCheck, judgeCheck, lightsCheck, metricsCheck, peopleChecks, runCheck, screenChecks, stationsCheck, terminalChecks, terminalVerdict } from "./checks.ts";
import type { ShowClient } from "./client.ts";
import { ShowError } from "./client.ts";
import { desktopChecks, macbookChecks, MACHINES, type Machine, type Probe, ROUTER_HOSTS, type RouterHost, serverroomChecks, spotFocus, tentChecks } from "./local.ts";
import { entryMatches, formatEntry, maskEntry } from "./logfmt.ts";
import type { Check, Level } from "./ui.ts";
import { ago, clockText, exitCode, mark, maskCode, paint, renderChecks, renderCsv, renderTable, summary, worst } from "./ui.ts";

type Json = Record<string, unknown>;

export interface Ctx {
  client: ShowClient;
  args: Args;
  color: boolean;
  json: boolean;
  out: (s: string) => void;
  err: (s: string) => void;
  probe: Probe;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** The show map's terminal spots (`house.json`), for missing-spot rows. */
  mapSpots: Array<{ id: string; name: string }>;
  /** Clear the screen between `--watch` frames (a TTY only). */
  clear: () => void;
  /** Ask y/N on the terminal (false when not interactive). */
  confirm: (q: string) => Promise<boolean>;
}

const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const fail = (name: string, e: unknown, read: string): Check => ({
  name,
  level: "fail",
  detail: e instanceof Error ? e.message : String(e),
  read: e instanceof ShowError ? e.read : read,
});

/** GET an event route as JSON, or throw a `ShowError` naming the route. */
async function getJson(ctx: Ctx, path: string): Promise<Json> {
  const r = await ctx.client.get(path);
  if (r.status !== 200 || r.body === null) throw new ShowError(`${path} answered ${r.status}${r.body?.["error"] ? `: ${String(r.body["error"])}` : ""}`, `GET ${path}`);
  return r.body;
}

/** Repeat `frame` every `seconds` until Ctrl+C (clearing a TTY between).
 *  A frame that throws (the VPS unreachable for a moment) is shown as a red
 *  line and the watch carries on: a monitor left running on show night must
 *  never quietly exit on one blip. `frames` caps the loop for tests. */
export async function watchLoop(ctx: Ctx, seconds: number, frame: () => Promise<number>, frames = Infinity): Promise<number> {
  let code = 0;
  for (let n = 0; n < frames; n++) {
    const lines: string[] = [];
    const out = ctx.out;
    ctx.out = (s) => lines.push(s);
    try {
      code = await frame();
    } catch (e) {
      code = 2;
      lines.push(`${mark("fail", ctx.color)}  ${e instanceof Error ? e.message : String(e)} — retrying in ${seconds} s`);
    } finally {
      ctx.out = out;
    }
    ctx.clear();
    ctx.out(`${new Date(ctx.now()).toLocaleTimeString()} · every ${seconds} s · Ctrl+C to stop`);
    for (const l of lines) ctx.out(l);
    await ctx.sleep(seconds * 1000);
  }
  return code; // only with `frames`: otherwise the loop ends on Ctrl+C
}

// ---------------------------------------------------------------- doctor

/** The previous metrics sample, so a `--watch` frame needs no extra wait. */
let lastMetrics: Json | null = null;

/** Every server-side check, in reading order. Never throws. */
export async function serverChecks(ctx: Ctx): Promise<Check[]> {
  const out: Check[] = [];
  const c = ctx.client;
  try {
    const h = await c.raw("GET", "/api/health");
    out.push(healthCheck(h.status, h.body));
  } catch (e) {
    out.push(healthCheck(null, null, e instanceof Error ? e.message : String(e)));
    return out;
  }
  try {
    out.push(dreamMediaCheck((await c.raw("GET", DREAM_PROBE)).status));
  } catch {
    out.push(dreamMediaCheck(null));
  }
  try {
    out.push(adsMediaCheck((await c.raw("GET", ADS_PROBE)).status));
  } catch {
    out.push(adsMediaCheck(null));
  }
  if (c.code === "") {
    out.push({ name: "Moderator code", level: "warn", detail: "LOOM_MOD_CODE is not set: only the health check ran", read: "env LOOM_MOD_CODE" });
    return out;
  }
  try {
    await c.connect();
    out.push({ name: "Moderator session", level: "ok", detail: `code ${maskCode(c.code)} → event ${c.eventId}${c.title ? ` "${c.title}"` : ""}`, read: "POST /api/resolve-code + /api/mod/login (cached)" });
  } catch (e) {
    out.push(fail("Moderator session", e, "POST /api/resolve-code"));
    return out;
  }
  let view: Json | null = null;
  try {
    view = await getJson(ctx, "/api/state?role=mod");
    let landing: string | null = null;
    try {
      const l = await c.raw("GET", "/api/landing");
      landing = typeof l.body?.["title"] === "string" ? (l.body["title"] as string) : null;
    } catch {
      /* the landing is only a hint */
    }
    out.push(...runCheck(view, typeof view["title"] === "string" ? view["title"] : c.title, landing));
    out.push(...peopleChecks(view));
    const agents = agentChecks(view, ctx.now());
    if (agents.length > 0) out.push(...agents);
    else if (beforeDoors(view)) {
      let trace: Json | null = null;
      try {
        const r = await c.get("/api/mod/agent/trace?limit=1");
        if (r.status === 200) trace = r.body;
      } catch {
        /* only a hint */
      }
      out.push(agentsBeforeDoorsCheck(trace, ctx.now()));
    } else out.push({ name: "Agent workers", level: "info", detail: "no agent-voiced character in this story", read: "GET /api/state?role=mod (cast)" });
    out.push(judgeCheck(view));
  } catch (e) {
    out.push(fail("Run", e, "GET /api/state?role=mod"));
  }
  const step = async (name: string, path: string, f: (j: Json) => Check | Check[], post = false) => {
    try {
      const r = post ? await c.post(path, {}) : await c.get(path);
      if (r.status !== 200 || r.body === null) throw new ShowError(`answered ${r.status}${r.body?.["error"] ? `: ${String(r.body["error"])}` : ""}`, `${post ? "POST" : "GET"} ${path}`);
      const got = f(r.body);
      out.push(...(Array.isArray(got) ? got : [got]));
    } catch (e) {
      out.push(fail(name, e, `${post ? "POST" : "GET"} ${path}`));
    }
  };
  await step("Join links", "/api/mod/codes", (j) => joinBaseCheck(j, c.server), true);
  await step("Terminals", "/api/mod/screen/terminals", (j) => terminalChecks(j, ctx.mapSpots));
  await step("Screen state", "/api/screen/state", (j) => screenChecks(j));
  await step("Sound router", "/api/mod/audio", (j) => audioCheck(j));
  await step("Lights module", "/api/mod/lights", (j) => lightsCheck(j));
  await step("VR stations", "/api/mod/spatial/stations", (j) => stationsCheck(j));
  try {
    let a = lastMetrics;
    if (a === null) {
      a = await getJson(ctx, "/api/mod/metrics?window=showctl");
      await ctx.sleep(1500);
    }
    const b = await getJson(ctx, "/api/mod/metrics?window=showctl");
    lastMetrics = b;
    out.push(metricsCheck(a, b));
  } catch (e) {
    out.push(fail("Server load", e, "GET /api/mod/metrics"));
  }
  return out;
}

function report(ctx: Ctx, title: string, checks: Check[]): number {
  if (ctx.json) ctx.out(JSON.stringify({ checks, exit: exitCode(checks) }, null, 2));
  else {
    ctx.out(paint(title, "1", ctx.color));
    ctx.out(renderChecks(checks, { color: ctx.color, verbose: flagOn(ctx.args, "verbose") }));
    ctx.out("");
    ctx.out(summary(checks, ctx.color));
  }
  return exitCode(checks);
}

export async function doctor(ctx: Ctx): Promise<number> {
  const frame = async () => report(ctx, `showctl doctor · ${ctx.client.server}`, await serverChecks(ctx));
  const w = watchSeconds(ctx.args, "watch", 15);
  return w === null ? frame() : watchLoop(ctx, w, frame);
}

// ---------------------------------------------------------------- status

/** The one-screen summary a tech op leaves running all night. */
export async function status(ctx: Ctx): Promise<number> {
  const frame = async (): Promise<number> => {
    let level: Level = "ok";
    const lines: string[] = [];
    try {
      const [view, cues] = [await getJson(ctx, "/api/state?role=mod"), await getJson(ctx, "/api/state?role=mod&cues=1")];
      const runRows = runCheck(view, ctx.client.title, null).filter((r) => r.name === "Run");
      const run = runRows[0]!;
      level = worst(level, run.level);
      const sc = cues["showClock"] as Json | undefined;
      const phaseLine = arr(cues["world"]).find((w) => w["path"] === "Night.phase");
      lines.push(`${mark(run.level, ctx.color)}  ${paint(String(view["title"] ?? ctx.client.title ?? "?"), "1", ctx.color)} · ${run.detail}${sc ? ` · show clock ${clockText(Number(sc["minutes"]))}${sc["running"] === false ? " (stopped)" : ""}` : ""}${phaseLine ? ` · phase ${String(phaseLine["value"])}` : ""}`);
      const rows = cueRows(arr(cues["interactions"]) as never, (cues["cues"] ?? { last: null, fired: [] }) as never);
      const lastRow = rows.find((r) => r.last);
      const nextRow = rows.find((r) => r.next);
      const marks = (cues["cues"] ?? {}) as Json;
      lines.push(`      LAST ${lastRow ? `${lastRow.code ?? lastRow.n} · ${lastRow.title}${marks["lastName"] ? ` (${String(marks["lastName"])})` : ""}` : "—"}   NEXT ${nextRow ? `${nextRow.code ?? nextRow.n} · ${nextRow.title}` : "— (nothing to press)"}   ${rows.filter((r) => r.fired).length}/${rows.length} cues fired`);
      for (const cd of arr(cues["countdowns"])) {
        const left = Number(cd["endsAt"]) - Number(cues["clock"] ?? 0);
        lines.push(`      ⏱ ${String(cd["label"])}: ${left > 0 ? ago(left) : "due"}`);
      }
      const watch = arr(cues["watch"]);
      if (watch.length > 0) lines.push(`      ${watch.map((w) => `${String(w["label"])} ${String(w["value"])}`).join(" · ")}`);
      for (const r of [...peopleChecks(view), ...agentChecks(view, ctx.now()), judgeCheck(view)]) {
        level = worst(level, r.level);
        lines.push(`${mark(r.level, ctx.color)}  ${r.name}: ${r.detail}`);
      }
    } catch (e) {
      level = "fail";
      lines.push(`${mark("fail", ctx.color)}  ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const t = await getJson(ctx, "/api/mod/screen/terminals");
      const silentMs = Number(t["silentMs"] ?? 20_000);
      const terms = arr(t["terminals"]);
      const cells = terms.map((x) => {
        const v = terminalVerdict(x, silentMs);
        level = worst(level, v.level);
        return `${paint(v.level === "ok" ? "✓" : v.level === "fail" ? "✗" : "!", v.level === "ok" ? "32" : v.level === "fail" ? "31;1" : "33", ctx.color)} ${String(x["name"])} ${ago(Number(x["ago"]))}${x["door"] && x["door"] !== "none" ? ` 🚪${x["door"] === "closed" ? "shut" : String(x["door"])}` : ""}${x["patch"] !== undefined ? ` 🔌${String(x["patch"])}` : ""}`;
      });
      // A key spot (the TV, the server room, the tent, …) that never polled
      // is as red here as in `doctor`: polls live in the server's memory, so
      // a VPS restart empties the list until each screen polls again.
      const seen = new Set(terms.map((x) => String(x["spot"] ?? "")));
      const missing = ctx.mapSpots.filter((s) => KEY_SPOTS[s.id] !== undefined && !seen.has(s.id));
      for (const s of missing) cells.push(`${paint("✗", "31;1", ctx.color)} ${s.name} never polled`);
      const live = terms.filter((x) => Number(x["ago"]) < silentMs).length;
      const tl = terms.reduce<Level>((l, x) => worst(l, terminalVerdict(x, silentMs).level), missing.length > 0 ? "fail" : "ok");
      level = worst(level, tl);
      lines.push(`${mark(tl, ctx.color)}  Terminals ${live}/${terms.length + missing.length} live: ${cells.join(" · ") || "none"}${t["voiceMuted"] === true ? " · TV voice MUTED" : ""}`);
    } catch (e) {
      level = "fail";
      lines.push(`${mark("fail", ctx.color)}  Terminals: ${e instanceof Error ? e.message : String(e)}`);
    }
    const house: string[] = [];
    for (const [label, path, ok] of [
      ["router", "/api/mod/audio", (j: Json) => (j["router"] as Json | undefined)?.["online"] === true],
      ["lights", "/api/mod/lights", (j: Json) => (j["module"] as Json | null | undefined)?.["online"] === true],
    ] as const) {
      try {
        const on = ok(await getJson(ctx, path));
        level = worst(level, on ? "ok" : "fail");
        house.push(`${label} ${on ? paint("online", "32", ctx.color) : paint("OFFLINE", "31;1", ctx.color)}`);
      } catch {
        level = "fail";
        house.push(`${label} ?`);
      }
    }
    lines.push(`${mark(house.some((h) => !/online/u.test(h) || /OFFLINE/u.test(h)) ? "fail" : "ok", ctx.color)}  House: ${house.join(" · ")}`);
    for (const l of lines) ctx.out(l);
    return level === "fail" ? 2 : level === "warn" ? 1 : 0;
  };
  const w = watchSeconds(ctx.args, "watch", 5);
  return w === null ? frame() : watchLoop(ctx, w, frame);
}

// ---------------------------------------------------------------- log

export async function log(ctx: Ctx): Promise<number> {
  const types = listFlag(ctx.args, "type");
  const who = flagStr(ctx.args, "who");
  const last = Math.max(1, Number(flagStr(ctx.args, "last") ?? 40) || 40);
  const json = ctx.json;
  const view = await getJson(ctx, "/api/state?role=mod");
  const secret = new Set(arr(view["cast"]).filter((c) => c["secret"] === true).map((c) => String(c["id"]).toLowerCase()));
  const names = new Map(arr(view["roster"]).map((r) => [String(r["id"]), String(r["name"])] as [string, string]));
  const head = await getJson(ctx, "/api/mod/log?after=-1&limit=1");
  const total = Number(head["total"] ?? 0);
  // With a filter, page back far enough to find `last` matches (≤ 5000).
  let after = Math.max(-1, total - (types.length > 0 || who !== null ? 5000 : last) - 1);
  const show = (entries: Json[], from: number) => {
    const lines: Array<[number, Json]> = [];
    entries.forEach((e, i) => {
      if (e["type"] === "tick" && !types.includes("tick")) return;
      // Masked before anything prints it, so `--json` is as safe as the text.
      if (entryMatches(e, types, who, names)) lines.push([from + i, maskEntry(e, secret)]);
    });
    return lines;
  };
  const page = async () => {
    let r = await getJson(ctx, `/api/mod/log?after=${after}&limit=5000`);
    // A restart (Push draft, a sync-show reload, Go live, a reset) starts a
    // new ledger: the old cursor would read empty pages forever. Say so and
    // follow the new run from its start.
    if (Number(r["total"] ?? 0) < after + 1) {
      ctx.out(json ? JSON.stringify({ restarted: true, total: Number(r["total"] ?? 0) }) : "— the run restarted (a new ledger) —");
      after = -1;
      r = await getJson(ctx, `/api/mod/log?after=${after}&limit=5000`);
    }
    const entries = arr(r["entries"]);
    const got = show(entries, after + 1);
    after += entries.length;
    return got;
  };
  const first = await page();
  const printed = first.slice(-last);
  if (ctx.json) printed.forEach(([seq, e]) => ctx.out(JSON.stringify({ seq, ...e })));
  else printed.forEach(([seq, e]) => ctx.out(formatEntry(seq, e, secret, names)));
  if (!flagOn(ctx.args, "follow")) return 0;
  const every = (watchSeconds(ctx.args, "follow", 2) ?? 2) * 1000;
  for (;;) {
    await ctx.sleep(every);
    try {
      for (const [seq, e] of await page()) ctx.out(ctx.json ? JSON.stringify({ seq, ...e }) : formatEntry(seq, e, secret, names));
    } catch (e) {
      ctx.err(`log: ${e instanceof Error ? e.message : String(e)} (retrying)`);
    }
  }
}

// ---------------------------------------------------------------- roster

/** A roster row → its state flags, in words. */
export function rosterFlags(r: Json): string {
  return [r["online"] === true ? "online" : r["online"] === false ? "offline" : null, r["captured"] === true ? "CAPTURED" : null, r["restricted"] === true ? "restricted" : null, r["gone"] === true ? "gone home" : null, r["persona"] === true ? "persona" : null]
    .filter((x) => x !== null)
    .join(", ");
}

/** `--where captured|restricted|offline|online|gone|personas`. */
export function rosterWhere(r: Json, where: string | null): boolean {
  switch (where) {
    case null:
      return true;
    case "captured":
      return r["captured"] === true;
    case "restricted":
      return r["restricted"] === true;
    case "offline":
      return r["online"] !== true;
    case "online":
      return r["online"] === true;
    case "gone":
      return r["gone"] === true;
    case "personas":
      return String(r["id"]).startsWith("p-");
    default:
      return String(r["location"] ?? "").toLowerCase() === where.toLowerCase() || String(r["faction"] ?? "").toLowerCase() === where.toLowerCase();
  }
}

export async function roster(ctx: Ctx): Promise<number> {
  const view = await getJson(ctx, "/api/state?role=mod");
  const where = flagStr(ctx.args, "where");
  const all = flagOn(ctx.args, "all") || where === "personas";
  const rows = arr(view["roster"]).filter((r) => (all || realGuests([{ id: String(r["id"]), name: String(r["name"]) }]).length > 0) && rosterWhere(r, where));
  const now = ctx.now();
  const table = rows
    .sort((a, b) => String(a["name"]).localeCompare(String(b["name"])))
    .map((r) => [
      String(r["name"]),
      String(r["role"] ?? ""),
      String(r["faction"] ?? ""),
      String(r["location"] ?? ""),
      String(r["score"] ?? ""),
      rosterFlags(r),
      typeof r["lastSeen"] === "number" ? `${ago(now - (r["lastSeen"] as number))} ago` : "",
    ]);
  const head = ["NAME", "ROLE", "FACTION", "WHERE", "SCORE", "STATE", "SEEN"];
  if (ctx.json) ctx.out(JSON.stringify(rows, null, 2));
  else if (flagOn(ctx.args, "csv")) ctx.out(renderCsv(head, table));
  else {
    ctx.out(renderTable(head, table, ctx.color));
    ctx.out(`\n${rows.length} ${all ? "on the roster" : "real guest(s)"}${where ? ` where ${where}` : ""}`);
  }
  return 0;
}

// ---------------------------------------------------------------- terminals

export async function terminals(ctx: Ctx): Promise<number> {
  const frame = async () => {
    const t = await getJson(ctx, "/api/mod/screen/terminals");
    const checks = terminalChecks(t, ctx.mapSpots);
    if (ctx.json) ctx.out(JSON.stringify({ terminals: t["terminals"], checks }, null, 2));
    else {
      ctx.out(paint(`terminals · silent after ${Math.round(Number(t["silentMs"] ?? 20000) / 1000)} s · TV voice ${t["voiceMuted"] === true ? "MUTED" : "on"}`, "1", ctx.color));
      ctx.out(renderChecks(checks, { color: ctx.color, verbose: false }));
    }
    return exitCode(checks);
  };
  const w = watchSeconds(ctx.args, "watch", 4);
  return w === null ? frame() : watchLoop(ctx, w, frame);
}

// ---------------------------------------------------------------- recap

export async function recap(ctx: Ctx): Promise<number> {
  const r = await ctx.client.get("/api/mod/recap");
  if (r.status === 409) {
    ctx.err("no recap yet: the doors haven't opened on this run");
    return 1;
  }
  if (r.status !== 200 || r.body === null) throw new ShowError(`recap answered ${r.status}`, "GET /api/mod/recap");
  const b = r.body;
  if (ctx.json) ctx.out(JSON.stringify(b, null, 2));
  else if (flagOn(ctx.args, "text")) ctx.out(String(b["text"] ?? ""));
  else {
    const totals = (b["totals"] ?? {}) as Json;
    ctx.out(paint(`${String(b["title"])} · ending ${String(b["ending"] ?? "(none yet)")} · ${String(b["programs"])} programs`, "1", ctx.color));
    ctx.out(renderTable(["TOTAL", "N"], Object.entries(totals).map(([k, v]) => [k, String(v)])));
    const duck = arr(b["duck"]).slice(0, 3);
    if (duck.length > 0) ctx.out(`\nDuck speedrun: ${duck.map((d) => `${String(d["rank"])}. ${String(d["name"])} ${String(d["time"])}`).join(" · ")}`);
    ctx.out("\n(--text for the paste-ready ceremony lists)");
  }
  return 0;
}

// ---------------------------------------------------------------- preflight

/** The spot each machine's own screen sits on, and what it should report. */
const MACHINE_SPOT: Partial<Record<Machine, { spot: string; view?: string; door?: boolean; mic?: string }>> = {
  desktop: { spot: "desktop-tv", view: "tv" },
  serverroom: { spot: "server-room", door: true },
  tent: { spot: "tent", mic: "off" },
};

export async function preflight(ctx: Ctx): Promise<number> {
  const machine = ctx.args.positionals[0] as Machine | undefined;
  if (machine === undefined || !(MACHINES as readonly string[]).includes(machine)) {
    ctx.err(`preflight needs a machine: ${MACHINES.join(" | ")}`);
    return 2;
  }
  // Where the sound router runs tonight: the Desktop (default) or the
  // MacBook fallback. Only `macbook` and `desktop` read it.
  const router = (flagStr(ctx.args, "router") ?? "desktop") as RouterHost;
  if (!(ROUTER_HOSTS as readonly string[]).includes(router)) {
    ctx.err(`--router must be ${ROUTER_HOSTS.join(" | ")} (where the sound router runs tonight; default desktop)`);
    return 2;
  }
  const server = await serverChecks(ctx);
  const focus = MACHINE_SPOT[machine];
  const own: Check[] = [];
  if (focus !== undefined && ctx.client.code !== "") {
    try {
      own.push(...spotFocus(await getJson(ctx, "/api/mod/screen/terminals"), focus.spot, focus));
    } catch (e) {
      own.push(fail("This terminal", e, "GET /api/mod/screen/terminals"));
    }
  }
  const local =
    machine === "macbook"
      ? await macbookChecks(ctx.probe, router)
      : machine === "desktop"
        ? await desktopChecks(ctx.probe, router)
        : machine === "serverroom"
          ? await serverroomChecks(ctx.probe, ctx.client.server)
          : await tentChecks(ctx.probe, ctx.client.server);
  const all = [...server, ...own, ...local];
  if (ctx.json) {
    ctx.out(JSON.stringify({ machine, router, server, own, local, exit: exitCode(all) }, null, 2));
    return exitCode(all);
  }
  ctx.out(paint(`showctl preflight ${machine} · ${ctx.client.server}${machine === "macbook" || machine === "desktop" ? ` · router on the ${router === "desktop" ? "Desktop" : "MacBook"}` : ""}`, "1", ctx.color));
  ctx.out(paint("── the server", "2", ctx.color));
  ctx.out(renderChecks(server, { color: ctx.color, verbose: flagOn(ctx.args, "verbose") }));
  if (own.length > 0) {
    ctx.out(paint("── this machine's screen", "2", ctx.color));
    ctx.out(renderChecks(own, { color: ctx.color, verbose: flagOn(ctx.args, "verbose") }));
  }
  ctx.out(paint(`── this machine (${machine})`, "2", ctx.color));
  ctx.out(renderChecks(local, { color: ctx.color, verbose: flagOn(ctx.args, "verbose") }));
  ctx.out("");
  ctx.out(summary(all, ctx.color));
  return exitCode(all);
}

// ---------------------------------------------------------------- fire

/** The label a fire journals as (`by` on Run → Log): this computer's name. */
export function fireLabel(host: string = hostname()): string {
  return `showctl · ${host}`.slice(0, 60);
}

/**
 * Fire a named signal / INTERACTION (`POST /api/mod/signal`), the hardware
 * fallback when a device fails (`door_sensor_closed`, `patch_combo_a`, …).
 * Refused when the roster holds a real guest, unless
 * `--i-know-this-is-live`; asks y/N unless `--yes`.
 */
export async function fire(ctx: Ctx): Promise<number> {
  const name = ctx.args.positionals[0];
  if (name === undefined || name.trim() === "") {
    ctx.err("fire needs a signal name: showctl fire <signal> [--subject <guest>] [--arg k=v] --yes");
    return 2;
  }
  const view = await getJson(ctx, "/api/state?role=mod");
  const rosterRows = arr(view["roster"]).map((r) => ({ id: String(r["id"]), name: String(r["name"]) }));
  const override = flagOn(ctx.args, LIVE_OVERRIDE);
  const title = String(view["title"] ?? ctx.client.title ?? "?");
  ctx.out(`event "${title}" (${ctx.client.eventId}) — ${rosterRows.length} on the roster, ${realGuests(rosterRows).length} real guest(s)`);
  const verdict = judge(rosterRows, override, `fire "${name}"`);
  if (!verdict.ok) {
    ctx.err(`✘ ${verdict.reason}`);
    return 3;
  }
  if (!flagOn(ctx.args, "yes") && !(await ctx.confirm(`fire "${name}" on "${title}"?`))) {
    ctx.err("not fired (pass --yes to skip the question in a script)");
    return 3;
  }
  const body: Json = { name, label: flagStr(ctx.args, "label") ?? fireLabel() };
  const subjectArg = flagStr(ctx.args, "subject");
  if (subjectArg !== null) {
    const hit = rosterRows.find((r) => r.id === subjectArg || r.name.toLowerCase() === subjectArg.toLowerCase());
    if (hit === undefined) {
      ctx.err(`no one on the roster is "${subjectArg}"`);
      return 2;
    }
    body["subject"] = hit.id;
  }
  if (ctx.args.argPairs.length > 0) body["args"] = Object.fromEntries(ctx.args.argPairs.map(([k, v]) => [k, /^-?\d+(\.\d+)?$/u.test(v) ? Number(v) : v]));
  // A declared INTERACTION is a cue the story judges; anything else is a
  // named event only story rules listening for it hear (a device's signal:
  // `door_sensor_closed`, `patch_changed`) — a typo there does nothing, so say so.
  const fold = (s: string) => s.trim().toLowerCase().replace(/[_\-\s]+/gu, " ");
  const declared = arr(view["interactions"]).some((i) => fold(String(i["id"])) === fold(name));
  const r = await ctx.client.post("/api/mod/signal", body);
  if (ctx.json) ctx.out(JSON.stringify({ status: r.status, ...(r.body ?? {}) }, null, 2));
  if (r.status !== 200) {
    ctx.err(`✘ ${r.status}: ${String(r.body?.["error"] ?? r.text.slice(0, 200))}`);
    return 2;
  }
  if (!ctx.json) {
    ctx.out(r.body?.["refused"] === true ? `fired "${name}" — the story REFUSED it (see # hosts)` : `fired "${name}" ✓`);
    if (!declared) ctx.out(`  note: "${name}" is not a declared INTERACTION — only a story rule listening for that name hears it (check the spelling)`);
    for (const k of ["said", "staff"]) for (const line of Array.isArray(r.body?.[k]) ? (r.body![k] as unknown[]) : []) ctx.out(`  ${k}: ${String(line)}`);
  }
  return r.body?.["refused"] === true || !declared ? 1 : 0;
}
