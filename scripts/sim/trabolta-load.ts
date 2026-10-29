// Trabolta under load (wave 42): many guests talking to him at once through
// the real agent path, timed the way a guest feels it.
//
//   node --experimental-strip-types --no-warnings scripts/sim/trabolta-load.ts \
//        --base http://127.0.0.1:7941 --code <MOD code> [flags]
//   pnpm sim:trabolta --base … --code …                 (the same, from the root)
//
// It drives a SCRATCH event server: Power On, N guests registered (`Load 01`
// …) and cleared through the arrival the way stagehand's replay harness does
// (the CAPTCHA signal, two menu picks, Norton's scan), the director's cue
// chain pressed to the phase asked for (scripts/accept/chains.ts), then a
// scenario of DMs to Trabolta. A worker voicing him must be attached by the
// operator (a stagehand `agents` worker pointed at the scratch server), or
// `--fake-worker <ms>` runs a stand-in (lib/fake-worker.ts) so the tool, the
// hub and the numbers are testable without Ollama.
//
// One mod feed (`/events?role=mod&lean=1`) carries every `message` and
// `typing` frame; lib/load.ts books each guest line and what became of it:
// his real reply, the hub's busy or hold line, the worker's canned fallback,
// a story line. Every 5 s it samples the director's `agentQueue` for him; at
// the end it pulls the worker's trace (`/api/mod/agent/trace`) for the model
// time. It writes <out>/summary.json, <out>/lines.jsonl and
// <out>/transcripts/<guest>.json, and prints a summary.
//
// Scenarios (--scenario):
//   burst   every guest sends an opener within --spread s, then converses:
//           after each answer (or --reply-timeout s) it thinks
//           --think-min..--think-max s and sends the next, until --duration s
//   steady  every guest sends a line every --interval s ± --jitter s,
//           answered or not, for --duration s
//   mixed   burst, plus every --talk-every s Clippy's next canned line
//           through `POST /api/mod/talk` when a talk scene is on (the public
//           thread, ahead of every DM), plus --filers guests filing 📝 guesses
//           (each a ruling he is asked for) when the phase has a hunt open
//   --battery <file.json>  scripted behaviour scenarios instead (see
//           scripts/sim/README.md): one fresh guest per scenario, each line
//           sent after the previous one is answered, checks judged on his
//           replies, grouped by phase in chain order
//
// SAFETY. A server off this laptop is refused unless --i-know-this-is-live,
// and port 7000 (the user's own dev server, loom_dev) the same. The live
// guard runs first (a roster with a real guest refuses; the bots of an
// earlier run count as real, so use a fresh scratch server). It writes no
// secret: the hunts' answers, the door code and the Kernel's code-like
// values are read at runtime into lib/load.ts `SecretBook` and every text a
// file or the terminal gets passes through its redaction; a battery check
// that catches one names only its label.
//
// Flags:
//   --base <url> --code <MOD code> [--event <id>] [--guest-code <event pass>]
//   --out <dir>            (default: a fresh folder under the OS temp dir)
//   --guests 50 --phase intro|hunt1|hunt2|y2k --scenario burst|steady|mixed
//   --duration 90 --spread 10 --think-min 5 --think-max 20
//   --interval 30 --jitter 5 --talk-every 30 --filers <n> --lines <file.json>
//   --battery <file.json> --wait-worker 120 --reply-timeout 120 --drain 150
//   --fake-worker <ms> [--fake-concurrency 1] [--fake-capacity <n>]
//   --seed 42 --yes --i-know-this-is-live --no-color

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SELF_PRESSED, TO_Y2K, pressChain } from "../accept/chains.ts";
import { liveGuard, type GuardRow } from "../accept/live-guard.ts";
import { FakeWorker } from "./lib/fake-worker.ts";
import { Client, Stream, failure, isLocal, sleep } from "./lib/http.ts";
import {
  LoadBook,
  PHASES,
  PHASE_ORDER,
  SecretBook,
  between,
  byPhase,
  cannedText,
  castLines,
  checkReplies,
  factsSecrets,
  isPhase,
  kernelSecrets,
  lineRow,
  loadNames,
  modelStats,
  parseBattery,
  personaCanned,
  personaOutside,
  pressesTo,
  queueSample,
  queueStats,
  rng,
  rulingEvent,
  slug,
  summarize,
  withMe,
  type CheckResult,
  type LineRec,
  type Phase,
  type QueueSample,
  type Scenario,
  type Stats,
  type TraceThought,
} from "./lib/load.ts";
import { GUEST_LINES, nextLine, readLines } from "./lib/load-lines.ts";
import { SIM_SELF_PRESSED, tolerating, transportRefusal } from "./lib/plan.ts";
import { Recorder } from "./lib/report.ts";
import { isDevServer, isScratch, resolveBase } from "./lib/safety.ts";
import { cannedLine, TALK_AGENT, TALK_AS, TALK_CHANNEL } from "./lib/talk.ts";
import { read, worldOf } from "./lib/world.ts";

// ------------------------------------------------------------------ flags

const argv = process.argv.slice(2);
function arg(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v !== undefined && !v.startsWith("--") ? v : fallback;
}
const flag = (name: string) => argv.includes(`--${name}`);
const numArg = (name: string, fallback: number): number => {
  const v = Number(arg(name, String(fallback)));
  return Number.isFinite(v) ? v : fallback;
};
const CHARACTER = "Trabolta";
const here = dirname(fileURLToPath(import.meta.url));
const SHOW = join(here, "../../core/examples/trapped-in-the-internet");

const base = resolveBase(arg("base"), process.env["LOOM_SERVER"]) ?? "";
const modCode = arg("code") ?? process.env["LOOM_MOD_CODE"] ?? "";
const scenario = arg("scenario", "burst")!;
const phaseArg = arg("phase", "intro")!;
const batteryPath = arg("battery");
const nGuests = Math.max(0, Math.floor(numArg("guests", batteryPath !== undefined ? 0 : 50)));
const durationMs = Math.max(1, numArg("duration", 90)) * 1000;
const spreadMs = Math.max(0, numArg("spread", 10)) * 1000;
const thinkMinMs = Math.max(0, numArg("think-min", 5)) * 1000;
const thinkMaxMs = Math.max(thinkMinMs / 1000, numArg("think-max", 20)) * 1000;
const intervalMs = Math.max(1, numArg("interval", 30)) * 1000;
const jitterMs = Math.max(0, numArg("jitter", 5)) * 1000;
const talkEveryMs = Math.max(5, numArg("talk-every", 30)) * 1000;
const waitWorkerMs = Math.max(0, numArg("wait-worker", 120)) * 1000;
const replyTimeoutMs = Math.max(5, numArg("reply-timeout", 120)) * 1000;
const drainMs = Math.max(0, numArg("drain", 150)) * 1000;
const fakeMs = arg("fake-worker") === undefined ? null : Math.max(0, numArg("fake-worker", 3000));
const fakeConcurrency = Math.max(1, Math.floor(numArg("fake-concurrency", 1)));
const fakeCapacity = arg("fake-capacity") === undefined ? null : Math.max(1, Math.floor(numArg("fake-capacity", 1)));
const seed = Math.floor(numArg("seed", 42));
const color = !flag("no-color") && process.stdout.isTTY !== false;
const liveOverride = flag("i-know-this-is-live");
const stamp = new Date().toISOString().replace(/[:.]/gu, "-").slice(0, 19);
const outDir = arg("out") ?? join(tmpdir(), `trabolta-load-${stamp}`);

function usage(why: string): never {
  console.error(`${why}\n\nusage: node --experimental-strip-types --no-warnings scripts/sim/trabolta-load.ts --base <url> --code <MOD code> [--scenario burst|steady|mixed | --battery <file.json>] [--phase intro|hunt1|hunt2|y2k] [--guests 50] [--duration 90] [--fake-worker <ms>]`);
  process.exit(2);
}
if (base === "" || modCode === "") usage("--base and --code are required.");
if (!["burst", "steady", "mixed"].includes(scenario)) usage(`--scenario is burst, steady or mixed (got ${scenario}).`);
if (!isPhase(phaseArg)) usage(`--phase is one of ${PHASE_ORDER.join(", ")} (got ${phaseArg}).`);
const phase: Phase = phaseArg;
if (!isLocal(base) && !liveOverride) usage(`${base} is not this laptop: the load driver runs against a scratch server only (--i-know-this-is-live to override).`);
if (isDevServer(base) && !liveOverride) usage("port 7000 on this laptop is your own dev server (loom_dev): start a scratch server on another port (scripts/sim/README.md).");

const dim = (s: string) => (color ? `\u001b[2m${s}\u001b[0m` : s);
const green = (s: string) => (color ? `\u001b[32m${s}\u001b[0m` : s);
const red = (s: string) => (color ? `\u001b[31m${s}\u001b[0m` : s);

// ------------------------------------------------------------------ the show's text, read at runtime

const cast = castLines(readFileSync(join(SHOW, "cast/trabolta.loom"), "utf8"), CHARACTER);
const personaText = readFileSync(join(SHOW, "trabolta.persona.md"), "utf8");
const canned = cannedText(cast, personaCanned(personaText));
const outside = personaOutside(personaText);
const secrets = new SecretBook();
try {
  factsSecrets(secrets, JSON.parse(readFileSync(join(SHOW, "facts.json"), "utf8")));
} catch {
  /* no facts book: the Kernel's values still go in below */
}
const redact = (s: string) => secrets.redact(s);

let pool: readonly string[] = GUEST_LINES;
if (arg("lines") !== undefined) {
  const got = readLines(JSON.parse(readFileSync(arg("lines")!, "utf8")));
  if (got === null) usage(`--lines ${arg("lines")} holds no line (a JSON list of strings, or {lines: [...]}).`);
  pool = got;
}
let battery: Scenario[] = [];
if (batteryPath !== undefined) {
  const parsed = parseBattery(JSON.parse(readFileSync(batteryPath, "utf8")));
  if (parsed.errors.length > 0) usage(`--battery ${batteryPath}:\n  ${parsed.errors.join("\n  ")}`);
  battery = parsed.scenarios;
}

// ------------------------------------------------------------------ state

const rec = new Recorder();
const http = new Client(base, rec);
let mod = "";
const r = rng(seed);
const book = new LoadBook(canned, CHARACTER);
const samples: QueueSample[] = [];
let lastTalk: TalkState | null = null;
let feed: Stream | null = null;
let fake: FakeWorker | null = null;
const notes: string[] = [];
const rulings = { asked: 0, same: 0, not: 0, stalled: 0 };
const talks: Array<{ at: number; status: number; error?: string; seq: number | null; scene: string; replyAt: number | null }> = [];
/** The run's zero: the first group's chain (battery), or the first line (a scenario). */
let t0 = 0;
/** How long the guests sent for (a scenario; the rest of the run is the drain). */
let sendingMs: number | null = null;

interface Guest {
  id: string;
  name: string;
  token: string;
  last: string | null;
}
interface TalkState {
  scene?: string;
  thinking?: boolean;
  clippy?: Array<{ text: string; direction?: string }>;
}
interface ModState {
  world?: Array<{ path: string; value: string }>;
  roster?: Array<GuardRow & { id?: string; name: string }>;
  cast?: Array<Record<string, unknown>>;
  talk?: TalkState | null;
  title?: string;
  phase?: string;
}

async function modState(): Promise<ModState> {
  const s = await http.get<ModState>("/api/state?role=mod", mod);
  if (s.status !== 200) throw new Error(`mod state → ${s.status}`);
  return s.json;
}

const say = (s: string) => console.log(s);
const secs = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`);
const statLine = (s: Stats) => (s.n === 0 ? "—" : `p50 ${secs(s.p50)} · p90 ${secs(s.p90)} · p99 ${secs(s.p99)} · max ${secs(s.max)} (n ${s.n})`);

// ------------------------------------------------------------------ setup

async function login(): Promise<ModState> {
  const ev = arg("event");
  if (ev !== undefined) http.scope = ev === "default" ? "" : `/e/${encodeURIComponent(ev)}`;
  else {
    const res = await http.call<{ eventId?: string }>("POST", "/api/resolve-code", { body: { code: modCode }, root: true });
    if (res.status === 200 && res.json.eventId !== undefined && res.json.eventId !== "default") http.scope = `/e/${encodeURIComponent(res.json.eventId)}`;
  }
  const l = await http.post<{ token?: string }>("/api/mod/login", { passcode: modCode });
  if (l.status !== 200 || l.json.token === undefined) {
    console.error(`  ✘ mod login → ${l.status}`);
    process.exit(3);
  }
  mod = l.json.token;
  return modState();
}

/** Power On on an idle event; the guest pass from --guest-code or the codes. */
async function doors(st: ModState): Promise<string> {
  if (st.phase === "idle") {
    const s = await http.post("/api/mod/start", {}, mod);
    if (s.status !== 200) throw new Error(failure("POST", "/api/mod/start", s));
    say("  Power On");
  } else if (st.phase !== "open") throw new Error(`the event is ${st.phase ?? "in an unknown phase"}: open it in Run first (or use a fresh scratch server)`);
  const given = arg("guest-code");
  if (given !== undefined) return given;
  const c = await http.post<{ eventPass?: string }>("/api/mod/codes", {}, mod);
  if (c.status !== 200 || typeof c.json.eventPass !== "string") throw new Error(failure("POST", "/api/mod/codes", c));
  return c.json.eventPass;
}

/** Register one guest and clear the arrival as stagehand's replay does
 *  (drive.py `clear`): the CAPTCHA signal, two menu picks, Norton's scan. */
async function arrive(name: string, eventPass: string): Promise<Guest | null> {
  let reg = await http.post<{ id?: string; token?: string; name?: string; error?: string }>("/api/guest/register", { passcode: eventPass, name });
  if (reg.status === 409 && reg.json.error === "reserved") {
    await http.post("/api/mod/claim/unlock", { character: name }, mod);
    reg = await http.post("/api/guest/register", { passcode: eventPass, name });
  }
  if (reg.status !== 200 || reg.json.id === undefined || reg.json.token === undefined) {
    notes.push(failure("POST", `/api/guest/register (${name})`, reg));
    return null;
  }
  const g: Guest = { id: reg.json.id, name: reg.json.name ?? name, token: reg.json.token, last: null };
  const cap = await http.post("/api/mod/signal", { name: "captcha answered", subject: g.id, args: { passed: false } }, mod);
  if (cap.status !== 200 || cap.json["refused"] === true) notes.push(`${g.name}: captcha → ${cap.status}${cap.json["refused"] === true ? " refused" : ""}`);
  for (const n of [1, 2]) {
    const ch = await http.post("/api/guest/choose", { index: 0 }, g.token);
    if (ch.status !== 200) notes.push(`${g.name}: choose ${n} → ${ch.status}`);
  }
  const scan = await http.post("/api/mod/scan", { as: "Norton Anti-Virus", target: g.id }, mod);
  if (scan.status !== 200) notes.push(`${g.name}: scan → ${scan.status}`);
  book.watch(g.id, g.name);
  return g;
}

let cursor = 0;
/** Press the chain on to `p`. A fresh night starts at the chain's top; a
 *  night already at or past the phase's step presses nothing; anything in
 *  between is refused (the chain cannot tell where it stopped). */
async function toPhase(p: Phase): Promise<void> {
  const before = worldOf((await modState()).world);
  const step = Number(read(before, "Night.step"));
  if (cursor === 0 && Number.isFinite(step) && step > 0) {
    if (step >= PHASES[p].step) {
      say(`  the night is already at step ${step} (≥ ${p}): no presses`);
      cursor = TO_Y2K.indexOf(PHASES[p].through) + 1;
      return;
    }
    throw new Error(`the night is at step ${step}, part-way along the chain: start a fresh scratch server`);
  }
  const { presses, cursor: next } = pressesTo(TO_Y2K, cursor, p);
  if (presses.length === 0) return;
  let lastTransport = "";
  const already: string[] = [];
  const res = await pressChain(
    presses,
    tolerating(
      async (name) => {
        const s = await http.post("/api/mod/signal", { name }, mod);
        if (s.status !== 200) {
          lastTransport = failure("POST", "/api/mod/signal", s);
          return transportRefusal(s.status, lastTransport);
        }
        await sleep(200);
        return s.json;
      },
      new Set([...SELF_PRESSED, ...SIM_SELF_PRESSED]),
      already,
    ),
    (line) => say(dim(line)),
  );
  if (!res.ok) throw new Error(`the chain stopped at ${res.refused.at(-1)}${lastTransport !== "" ? ` (${lastTransport})` : ""}`);
  cursor = next;
  const w = worldOf((await modState()).world);
  const now = Number(read(w, "Night.step"));
  if (!(now >= PHASES[p].step)) throw new Error(`pressed through ${PHASES[p].through} but Night.step is ${read(w, "Night.step")} (want ≥ ${PHASES[p].step})`);
  say(`  the night is at ${p} (Night.step ${now}, Night.phase ${read(w, "Night.phase")})`);
}

/** Wait for a worker voicing him (the cast row's `online`). */
async function waitWorker(): Promise<boolean> {
  const until = Date.now() + waitWorkerMs;
  for (;;) {
    const st = await modState();
    const row = (st.cast ?? []).find((c) => c["id"] === CHARACTER);
    if (row?.["online"] === true) return true;
    if (Date.now() >= until) return false;
    await sleep(2000);
  }
}

function onFrame(ev: string, data: string): void {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return;
  }
  const at = Date.now();
  if (ev === "typing") book.typing(d, at);
  else if (ev === "message") {
    book.seen(d, at);
    const text = typeof d["text"] === "string" ? d["text"] : "";
    // A ruling, from its `# hosts` notice: counted, never kept (it names the key).
    if (d["from"] !== CHARACTER) {
      const e = rulingEvent(text, CHARACTER);
      if (e?.kind === "asked") rulings.asked++;
      else if (e?.kind === "ruled") e.same ? rulings.same++ : rulings.not++;
      else if (e?.kind === "stalled") rulings.stalled++;
    }
    if (d["channel"] === TALK_CHANNEL && d["from"] === TALK_AGENT) {
      const answers = typeof d["answers"] === "number" ? d["answers"] : null;
      for (const t of talks) if (t.replyAt === null && t.seq !== null && (answers === null || answers >= t.seq)) t.replyAt = at;
    }
  }
}

/** Every 5 s: the director's agentQueue for him (and the talk view). */
function sampler(stop: { done: boolean }): Promise<void> {
  return (async () => {
    while (!stop.done) {
      try {
        const st = await modState();
        samples.push(queueSample(Date.now() - t0, st.cast));
        lastTalk = st.talk ?? null;
      } catch {
        /* a slow answer under load: the next sample */
      }
      await sleep(5000);
    }
  })();
}

// ------------------------------------------------------------------ the lines

async function send(g: Guest, text: string, tag: string): Promise<LineRec> {
  const at = Date.now();
  const s = await http.post("/api/guest/say", { channel: `dm:${CHARACTER}`, text }, g.token);
  g.last = text;
  const line = book.sent(g.id, text, at, s.status, tag);
  if (s.status !== 200) notes.push(`${g.name}: say → ${s.status} ${String(s.json["error"] ?? "").slice(0, 60)}`);
  return line;
}

/** Wait until a line is closed (a reply, a canned line, a director), the
 *  timeout, or `stopAt` (once sending has stopped, the drain waits instead,
 *  so a guest still owed an answer never holds the run past its duration). */
async function closed(l: LineRec, timeoutMs: number, stopAt = Infinity): Promise<boolean> {
  const until = Math.min(l.sentAt + timeoutMs, stopAt);
  while (l.closedAt === null && Date.now() < until) await sleep(250);
  return l.closedAt !== null;
}

async function converse(g: Guest, endAt: number, tag: string): Promise<void> {
  await sleep(between(r, 0, spreadMs));
  while (Date.now() < endAt) {
    const l = await send(g, nextLine(pool, r, g.last), tag);
    if (l.status === 200) await closed(l, replyTimeoutMs, endAt);
    if (Date.now() >= endAt) break;
    await sleep(between(r, thinkMinMs, thinkMaxMs));
  }
}

async function steady(g: Guest, endAt: number): Promise<void> {
  await sleep(between(r, 0, intervalMs));
  while (Date.now() < endAt) {
    await send(g, nextLine(pool, r, g.last), "steady");
    await sleep(Math.max(500, intervalMs + between(r, -jitterMs, jitterMs)));
  }
}

/** Clippy's canned talk lines on a timer, while a talk scene is on. */
async function talkLoop(endAt: number): Promise<void> {
  let n = 0;
  while (Date.now() < endAt) {
    await sleep(talkEveryMs);
    if (Date.now() >= endAt) break;
    const scene = lastTalk?.scene;
    if (scene === undefined || lastTalk === null) {
      notes.push(`talk at ${secs(Date.now() - t0)}: no talk scene on, skipped`);
      continue;
    }
    if (lastTalk.thinking === true) {
      notes.push(`talk at ${secs(Date.now() - t0)}: his last answer is still owed, skipped`);
      continue;
    }
    const line = cannedLine(scene, TALK_AS, n++);
    if (line === null) continue;
    const at = Date.now();
    const s = await http.post<{ seq?: number | null; error?: string }>("/api/mod/talk", { as: TALK_AS, text: line.text, ...(line.direction !== undefined ? { direction: line.direction } : {}) }, mod);
    talks.push({ at, status: s.status, ...(s.json.error !== undefined ? { error: s.json.error } : {}), seq: typeof s.json.seq === "number" ? s.json.seq : null, scene, replyAt: null });
  }
}

/** One 📝 guess for a filer, when its phase has a card open: every filing
 *  that is not an exact match is a ruling he is asked for. */
async function fileGuess(g: Guest): Promise<string> {
  const [h, v] = await Promise.all([
    http.get<{ messages?: Array<{ seq: number; kind: string; widget?: { kind: string; params?: Record<string, unknown> } }> }>("/api/history", g.token),
    http.get<{ answered?: number[] }>("/api/state?role=guest", g.token),
  ]);
  const done = new Set(v.json.answered ?? []);
  const card = (h.json.messages ?? []).filter((m) => m.kind === "widget" && m.widget?.kind === "fact" && !done.has(m.seq)).at(-1);
  if (card === undefined) return "no 📝 card open";
  const q = /^\s*([A-Z]+\d+)/u.exec(String(card.widget?.params?.["questions"] ?? "").split("|")[0] ?? "")?.[1];
  if (q === undefined) return "no question on the card";
  const s = await http.post("/api/guest/widget", { seq: card.seq, result: { question: q, answer: `load guess ${q} ${g.name}`, confidence: 40 } }, g.token);
  return s.status === 200 ? `filed ${q}` : failure("POST", "/api/guest/widget", s);
}

async function filers(guests: readonly Guest[], endAt: number): Promise<void> {
  const n = Math.min(guests.length, Math.max(0, Math.floor(numArg("filers", Math.ceil(guests.length / 5)))));
  const chosen = guests.filter((_, i) => i % Math.max(1, Math.floor(guests.length / Math.max(1, n))) === 0).slice(0, n);
  await Promise.all(
    chosen.map(async (g) => {
      await sleep(between(r, 0, Math.max(0, endAt - Date.now()) / 2));
      const what = await fileGuess(g);
      notes.push(`${g.name}: ${what}`);
    }),
  );
}

async function drain(): Promise<void> {
  const until = Date.now() + drainMs;
  while (Date.now() < until && book.lines.some((l) => l.status === 200 && l.closedAt === null)) await sleep(500);
}

// ------------------------------------------------------------------ the battery

interface ScenarioResult {
  id: string;
  phase: Phase;
  name: string;
  intent: string;
  ok: boolean;
  checks: CheckResult[];
  sent: number;
  unanswered: number;
  waitsMs: Array<number | null>;
}

async function runScenario(s: Scenario, g: Guest): Promise<ScenarioResult> {
  say(`  ▸ ${s.id} (${g.name}): ${s.intent}`);
  for (const st of s.setup) {
    const res = await http.post("/api/mod/var", { path: withMe(st.path, g.id), value: withMe(st.value, g.id) }, mod);
    if (res.status !== 200) notes.push(`${s.id}: setup ${st.path} → ${res.status}`);
  }
  const mine: LineRec[] = [];
  for (const text of s.lines) {
    const l = await send(g, text, s.id);
    mine.push(l);
    if (l.status === 200) await closed(l, replyTimeoutMs);
    const reply = book.threads.get(g.id)?.filter((m) => m.who === "him" && m.at >= l.sentAt).map((m) => `${m.kind === "reply" ? "" : `[${m.kind}] `}${m.text}`) ?? [];
    say(dim(`      › ${redact(text).slice(0, 100)}`));
    for (const x of reply) say(`      ‹ ${redact(x).slice(0, 220)}`);
    if (reply.length === 0) say(red(`      ‹ (nothing in ${secs(replyTimeoutMs)})`));
  }
  const thread = book.threads.get(g.id) ?? [];
  const his = thread.filter((m) => m.who === "him");
  const checks = checkReplies(
    s.checks,
    { replies: his.filter((m) => m.kind === "reply").map((m) => m.text), kinds: his.flatMap((m) => (m.kind === "line" ? [] : [m.kind])), unanswered: mine.filter((l) => l.status === 200 && l.closedAt === null).length, sent: mine.filter((l) => l.status === 200).length },
    outside,
    secrets,
  );
  const ok = checks.every((c) => c.ok);
  for (const c of checks) say(`      ${c.ok ? green("✔") : red("✘")} ${c.check}${c.note !== "" ? dim(` · ${c.note}`) : ""}`);
  return { id: s.id, phase: s.phase, name: g.name, intent: s.intent, ok, checks, sent: mine.length, unanswered: mine.filter((l) => l.closedAt === null).length, waitsMs: mine.map((l) => (l.replyAt === null ? null : l.replyAt - l.sentAt)) };
}

// ------------------------------------------------------------------ the night

async function main(): Promise<void> {
  const mode = battery.length > 0 ? `battery (${battery.length} scenarios)` : `${scenario} · ${nGuests} guests · ${durationMs / 1000} s at ${phase}`;
  say(`Trabolta under load → ${base} · ${mode}${fakeMs !== null ? ` · fake worker ${fakeMs} ms × ${fakeConcurrency}${fakeCapacity !== null ? ` (capacity ${fakeCapacity})` : ""}` : ""}`);
  const st = await login();
  await liveGuard({ title: st.title, where: `${base}${http.scope}`, roster: st.roster, action: "run the Trabolta load driver", argv: process.argv, local: isScratch(base) });
  kernelSecrets(secrets, st.world);

  const eventPass = await doors(st);
  const taken = new Set((st.roster ?? []).map((x) => x.name.toLowerCase()));
  // Everyone arrives at the doors (Night.step 0), as on the night; the
  // chain moves on only after.
  const guests: Guest[] = [];
  const names = battery.length > 0 ? battery.map((s) => s.as.name) : loadNames(nGuests, taken);
  const byScenario = new Map<string, Guest>();
  for (const [i, name] of names.entries()) {
    const g = await arrive(name, eventPass);
    if (g === null) continue;
    guests.push(g);
    if (battery.length > 0) byScenario.set(battery[i]!.id, g);
  }
  say(`  ${guests.length} guests registered and through the arrival${notes.length > 0 ? ` (${notes.length} notes)` : ""}`);

  feed = new Stream(`${base}${http.scope}/events?role=mod&lean=1`, mod, onFrame).start();
  if (fakeMs !== null) {
    const row = (await modState()).cast?.find((c) => c["id"] === CHARACTER);
    if (row?.["online"] === true) say("  a worker already voices him: the fake worker stays off");
    else fake = new FakeWorker({ http, mod, ms: fakeMs, concurrency: fakeConcurrency, capacity: fakeCapacity, character: CHARACTER }).start();
  }

  const stop = { done: false };
  let sampling: Promise<void> = Promise.resolve();
  const results: ScenarioResult[] = [];
  try {
    if (battery.length > 0) {
      t0 = Date.now();
      sampling = sampler(stop);
      for (const group of byPhase(battery)) {
        await toPhase(group.phase);
        await ready();
        for (const s of group.scenarios) {
          const g = byScenario.get(s.id);
          if (g === undefined) {
            results.push({ id: s.id, phase: s.phase, name: s.as.name, intent: s.intent, ok: false, checks: [{ check: "register", ok: false, note: "the guest did not register" }], sent: 0, unanswered: 0, waitsMs: [] });
            continue;
          }
          results.push(await runScenario(s, g));
        }
      }
    } else {
      await toPhase(phase);
      await ready();
      t0 = Date.now();
      sampling = sampler(stop);
      const endAt = t0 + durationMs;
      const jobs: Array<Promise<void>> =
        scenario === "steady" ? guests.map((g) => steady(g, endAt)) : guests.map((g) => converse(g, endAt, scenario));
      if (scenario === "mixed") jobs.push(talkLoop(endAt), filers(guests, endAt));
      await Promise.all(jobs);
      sendingMs = Date.now() - t0;
      say(`  ${secs(sendingMs)}: sending stopped; ${book.lines.filter((l) => l.status === 200 && l.closedAt === null).length} lines still owed, draining (≤ ${secs(drainMs)})`);
      await drain();
    }
  } finally {
    stop.done = true;
    await sampling;
  }
  const end = Date.now();
  await sleep(300);
  await report(results, end);
}

/** He is awake and a worker voices him (or say why the numbers won't mean much). */
async function ready(): Promise<void> {
  const w = worldOf((await modState()).world);
  if (read(w, `${CHARACTER}.awake`) !== "true") say(red(`  ⚠ ${CHARACTER}.awake is ${read(w, `${CHARACTER}.awake`)}: expect the persona's unavailable line or refused DMs`));
  if (await waitWorker()) say(`  a worker voicing ${CHARACTER} is online`);
  else say(red(`  ⚠ no worker voiced ${CHARACTER} within ${secs(waitWorkerMs)}: expect only hold lines (attach a stagehand agents worker, or --fake-worker <ms>)`));
}

async function pullTrace(): Promise<TraceThought[]> {
  const out: TraceThought[] = [];
  let after = 0;
  for (let page = 0; page < 20; page++) {
    const t = await http.get<{ thoughts?: Array<TraceThought & { seq?: number }> }>(`/api/mod/agent/trace?character=${CHARACTER}&after=${after}&limit=400`, mod);
    const list = t.json.thoughts ?? [];
    out.push(...list);
    const top = Math.max(after, ...list.map((x) => (typeof x.seq === "number" ? x.seq : 0)));
    if (list.length < 400 || top === after) break;
    after = top;
  }
  return out;
}

async function report(results: ScenarioResult[], end: number): Promise<void> {
  const s = summarize(book, t0, end);
  const q = queueStats(samples);
  const trace = modelStats(await pullTrace(), t0 / 1000 - 5);
  mkdirSync(join(outDir, "transcripts"), { recursive: true });
  const talkWaits = talks.filter((t) => t.replyAt !== null).map((t) => t.replyAt! - t.at);
  const summary = {
    at: new Date(t0).toISOString(),
    base,
    mode: battery.length > 0 ? "battery" : scenario,
    phase: battery.length > 0 ? [...new Set(battery.map((b) => b.phase))] : phase,
    guestCount: book.watched.size,
    durationMs: end - t0,
    sendingMs,
    worker: fakeMs !== null ? { fake: true, ms: fakeMs, concurrency: fakeConcurrency, capacity: fakeCapacity, replies: fake?.replies ?? 0, rulings: fake?.rulings ?? 0, cancelled: fake?.cancelled ?? 0, received: fake?.received ?? 0 } : { fake: false },
    ...s,
    queue: { ...q, samples: samples },
    model: trace,
    rulings,
    talks: talks.map((t) => ({ atMs: t.at - t0, status: t.status, error: t.error ?? null, scene: t.scene, waitMs: t.replyAt === null ? null : t.replyAt - t.at })),
    talkWait: talkWaits.length === 0 ? null : { n: talkWaits.length, maxMs: Math.max(...talkWaits) },
    battery: results.length > 0 ? results : undefined,
    notes: notes.map(redact),
    httpErrors: rec.errors.map(redact),
  };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(join(outDir, "lines.jsonl"), book.lines.map((l) => JSON.stringify(lineRow(l, t0, redact))).join("\n") + (book.lines.length > 0 ? "\n" : ""));
  const scenarioOf = new Map<string, string>();
  for (const res of results) for (const [id, g] of book.watched) if (g === res.name) scenarioOf.set(id, res.id);
  for (const [id, name] of book.watched) {
    const thread = (book.threads.get(id) ?? []).map((m) => ({ seq: m.seq, atMs: m.at - t0, who: m.who === "him" ? CHARACTER : name, kind: m.kind, text: redact(m.text), answers: m.answers }));
    const file = scenarioOf.get(id) ?? slug(name);
    writeFileSync(join(outDir, "transcripts", `${file}.json`), JSON.stringify({ guest: name, scenario: scenarioOf.get(id) ?? null, lines: book.lines.filter((l) => l.guest === id).map((l) => lineRow(l, t0, redact)), thread }, null, 2) + "\n");
  }

  // The human summary.
  say("");
  say(`Trabolta under load · ${summary.mode} · ${summary.guestCount} guests · ${secs(end - t0)}${fakeMs !== null ? ` · fake worker ${fakeMs} ms` : ""}`);
  say(`  lines      ${s.lines.sent} sent (${s.lines.posted} posted${s.lines.refused > 0 ? `, ${s.lines.refused} refused` : ""}) · ${s.lines.answered} answered · ${s.lines.fallback} fallback · ${s.lines.unavailable} unavailable · ${s.lines.hand} by hand · ${s.lines.unanswered > 0 ? red(`${s.lines.unanswered} unanswered`) : "0 unanswered"}`);
  say(`  wait       ${statLine(s.waitMs)}   (sent → his first real reply)`);
  say(`  typing     ${statLine(s.typingMs)}   (sent → "is typing")`);
  say(`  his lines  ${s.his.reply} replies · ${s.his.busy} busy · ${s.his.hold} hold · ${s.his.fallback} fallback · ${s.his.unavailable} unavailable · ${s.his.story} story · ${s.his.hand} by hand`);
  say(`  first      ${s.busyFirst} lines heard the busy line first · ${s.holdFirst} the hold line`);
  say(`  rate       ${s.repliesPerMin} replies/min overall · per 30 s: ${s.replyRate.map((b) => b.replies).join(" ")}`);
  const worst = [...s.guests].sort((a, b) => b.maxWaitMs - a.maxWaitMs)[0];
  say(`  guests     longest wait each: ${statLine(s.guestMaxWaitMs)}${worst !== undefined ? ` · worst ${worst.name} ${secs(worst.maxWaitMs)}` : ""}`);
  say(`  queue      ${q.samples} samples · depth max ${q.depthMax ?? "—"} · in flight max ${q.inFlightMax ?? "—"} · capacity ${q.capacity ?? "— (legacy)"} · oldest max ${secs(q.oldestMaxMs)} · stalled ${q.stalledSamples} · offline ${q.offlineSamples}`);
  say(`  model      ${trace.thoughts} thoughts (${Object.entries(trace.byKind).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}) · voice ${statLine(trace.voiceMs)}${trace.promptTokens.n > 0 ? ` · prompt tokens p50 ${trace.promptTokens.p50} max ${trace.promptTokens.max}` : ""}${trace.errors > 0 ? red(` · ${trace.errors} errors`) : ""}`);
  if (rulings.asked + rulings.same + rulings.not + rulings.stalled > 0 || trace.rulings.same + trace.rulings.not > 0) {
    say(`  rulings    ${rulings.asked} asked · ${rulings.same + rulings.not} ruled (${rulings.same} same) · ${rulings.stalled} judge-stall notices`);
  }
  if (talks.length > 0) say(`  talk       ${talks.length} Clippy lines (${talks.filter((t) => t.status === 200).length} posted) · answered ${talkWaits.length} · max wait ${secs(talkWaits.length === 0 ? null : Math.max(...talkWaits))}`);
  if (results.length > 0) say(`  battery    ${results.filter((x) => x.ok).length}/${results.length} scenarios passed${results.some((x) => !x.ok) ? ` · failed: ${results.filter((x) => !x.ok).map((x) => x.id).join(", ")}` : ""}`);
  if (notes.length > 0) say(dim(`  notes      ${notes.length} (summary.json): ${redact(notes.slice(0, 3).join(" · "))}${notes.length > 3 ? " …" : ""}`));
  say(`  wrote      ${outDir}/summary.json, lines.jsonl, transcripts/`);
  process.exitCode = results.some((x) => !x.ok) ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(red(`  ✘ ${redact((e as Error).message)}`));
    process.exitCode = 1;
  })
  .finally(() => {
    fake?.stop();
    feed?.stop();
    // Open sockets (the feed's fetch) can hold the loop: leave once written.
    setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
  });

