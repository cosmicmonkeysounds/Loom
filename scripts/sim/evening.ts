// A full evening of *Trapped in the Internet*, played by bots over HTTP.
//
//   node --experimental-strip-types --no-warnings scripts/sim/evening.ts \
//        --base http://127.0.0.1:7391 --code <MOD code> [flags]
//   pnpm sim --base … --code …                      (the same, from the root)
//
// Guests (a mix of pool programs, each with a human problem, and featured
// programs on their invitation's claim), the performers' booths (Clippy,
// the four Antivirus, the three hosts) as play-as sessions (no real part is
// held), a director who presses the whole cue chain in the cue sheet's
// order (scripts/accept/chains.ts) to the end of the night, and a heart bot
// that pilots programs at the server-room terminal the way the terminal
// posts (the door sensor, `terminal opened`, the docked `Heart …` menus by
// text). The bots do the quests on the way: the arrival, Bingo, the hunts
// and their 📝 filings, DMs, wave 32's talk scenes (Task Manager relays
// Clippy and Trabolta answers the whole Desktop, in the introduction after his
// sign-off; ⚡ an ad burst in the ad attack; 🫘 the beans), the bottle, a
// reinstallation at the tent, the
// Truther Download's featured missions, a crew, Truthcoin, the summons,
// Truth Pong, the sides and the majority, chess → the door code, the
// casino, a wrong patch, three visits to his heart (thrown out; the chosen
// one walks out; the full talk to its end), an ending and the whole
// ceremony to the resurrection.
//
// After each beat it reads the director's view and asserts where the night
// should be: one green / red line per beat, then a summary table (beats,
// quests, errors, latency p50/p95). Exit 1 on any red, 2 on bad flags, 3 when
// the guard refuses.
//
// SAFETY. Rehearsal events and scratch servers only. It runs the live guard
// first (scripts/accept/live-guard.ts): a roster with a real guest refuses
// unless --i-know-this-is-live; it names the event and asks y/N unless
// --yes or the server is a scratch server on this laptop (port 7000, the
// user's own dev server with loom_dev, still asks). There is no default
// server: --base or LOOM_SERVER must name one. It never presses Restart / End unless
// --reset-after (scratch only); --reset-before (scratch only) clears a
// scratch server's previous run first, and only after the guard passed
// (bots from an earlier run are registered programs, so the guard counts
// them as real: a fresh server, or --i-know-this-is-live on a bots-only one).
// It never prints a code, the door code, a combination or a hunt answer:
// the mod world is read through lib/world.ts, which drops `Kernel.*`.
//
// Flags:
//   --base <url>        (env LOOM_SERVER; required, no default)
//   --code <MOD code>   (env LOOM_MOD_CODE)
//   --event <id>        skip code resolution (default: /api/resolve-code)
//   --guests 12         how many guest bots (featured included)
//   --featured "Microsoft Excel,MS Paint,Pong"   featured programs (claims)
//   --ending verdict|disabled|destroyed|song_pickup|help|hand_jive|rave
//                       (default verdict: the song, or with --lie the advice
//                       poll; the last four imply --lie and take that road)
//   --lie               one confident wrong filing → the verdict's Grok Prom
//   --facts <path>      facts.json for accurate filings (default the show's;
//                       never printed). `--facts none` files guesses only.
//   --pace <ms>         wait after every beat (and ⅓ of it after each action)
//   --watch             print the URLs to open in Chrome to watch the run
//   --beat-file <path>  write {beat, n, ok} after each beat (browser.spec.ts)
//   --worker            a scripted probe Trabolta worker (off by default; it
//                       stays off when a house worker reported in the last 2 min).
//                       It answers a public talk request (wave 32) with the
//                       scene's canned Trabolta line; without it, Task Manager
//                       fires that canned line by hand
//   --json <path>       write the results as JSON
//   --yes, --i-know-this-is-live, --reset-before, --reset-after, --no-color

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADVICE_TALLY,
  CEREMONY,
  GROK_TO_ADVICE,
  GROK_TO_RAVE,
  THE_FULL_TRUTH,
  TO_Y2K,
  Y2K_TO_DESTROYED,
  Y2K_TO_DISABLED,
  Y2K_TO_VERDICT,
  pressChain,
  type ChainStep,
} from "../accept/chains.ts";
import { liveGuard, type GuardRow } from "../accept/live-guard.ts";
import { decide, heartMenu, layerOf, menusOf, type HeartStep, type Menu } from "./lib/heart.ts";
import { Client, Stream, failure, sleep, type Res } from "./lib/http.ts";
import { doorsDecision, envServerNotice, guardThenReset, isDevServer, isScratch, mayResetAfter, resolveBase } from "./lib/safety.ts";
import { Recorder, beatLine, slowRoutes, summaryTable, tallyQuests, type BeatResult } from "./lib/report.ts";
import { atLeast, awardWinners, betProblems, mismatches, notNone, read, truthy, worldOf, wrongPatchProblems, type Row, type Want } from "./lib/world.ts";
import { SIM_SELF_PRESSED, featuredSlug, pickPool, segment, tolerating, transportRefusal, trapOf } from "./lib/plan.ts";
import { TALK_AGENT, TALK_AS, burstProblems, cannedLine, glitchHeldFor, probeReply, replyAfter, talkLineProblems, type TalkMsg } from "./lib/talk.ts";

// ------------------------------------------------------------------ flags

const argv = process.argv.slice(2);
function arg(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v !== undefined && !v.startsWith("--") ? v : fallback;
}
const flag = (name: string) => argv.includes(`--${name}`);
const base = resolveBase(arg("base"), process.env["LOOM_SERVER"]) ?? "";
const modCode = arg("code") ?? process.env["LOOM_MOD_CODE"] ?? "";
const nGuests = Math.max(4, Number(arg("guests", "12")));
const featuredWanted = (arg("featured", "Microsoft Excel,MS Paint,Pong") ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
const ENDINGS = ["verdict", "disabled", "destroyed", "song_pickup", "help", "hand_jive", "rave"] as const;
const ending = (arg("ending", "verdict") ?? "verdict") as (typeof ENDINGS)[number];
/** The roads that run through Grok Prom need a lie on record. */
const lie = flag("lie") || ending === "song_pickup" || ending === "help" || ending === "hand_jive" || ending === "rave";
const pace = Math.max(0, Number(arg("pace", "0")));
const color = !flag("no-color") && process.stdout.isTTY !== false;
const beatFile = arg("beat-file");
const jsonOut = arg("json");
const here = dirname(fileURLToPath(import.meta.url));
const factsPath = arg("facts", join(here, "../../core/examples/trapped-in-the-internet/facts.json"))!;

if (base === "" || modCode === "" || !(ENDINGS as readonly string[]).includes(ending)) {
  console.error(`usage: node --experimental-strip-types scripts/sim/evening.ts --base <url> --code <MOD code> [--ending ${ENDINGS.join("|")}] [--pace ms] [--watch] [--yes]`);
  process.exit(2);
}
const envNotice = envServerNotice(arg("base"), process.env["LOOM_SERVER"], base);
if (envNotice !== null) console.log(envNotice);
/** A scratch server on this laptop (not :7000, the user's own dev server):
 *  no y/N, and the reset flags are allowed. */
const local = isScratch(base);
if ((flag("reset-after") || flag("reset-before")) && !local) {
  console.error(`--reset-before / --reset-after are for a scratch server on this laptop only${isDevServer(base) ? " (port 7000 is your own dev server)" : ""}.`);
  process.exit(2);
}

/** The hunts' answer keys, read (never printed) for accurate filings. */
const answers = new Map<string, string>();
/** Questions whose key is still owed (wave 58): a filing on one gets no verdict. */
const owedKeys = new Set<string>();
if (factsPath !== "none") {
  try {
    const book = JSON.parse(readFileSync(factsPath, "utf8")) as { questions?: Array<{ id: string; answer: string; placeholder?: boolean }> };
    for (const q of book.questions ?? []) if (q.placeholder === true) owedKeys.add(q.id);
    for (const q of book.questions ?? []) answers.set(q.id, q.answer);
  } catch {
    /* guesses only */
  }
}

// ------------------------------------------------------------------ state

const rec = new Recorder();
const http = new Client(base, rec);
let mod = "";
/** Set once the doors beat passed (a fresh night this run plays). */
let nightStarted = false;

interface Bot {
  id: string;
  name: string;
  token: string;
  featured: string | null;
  filed: Set<string>;
  stream?: Stream;
}
const bots: Bot[] = [];
const booths = new Map<string, string>();
const BOOTHS = ["Clippy", "Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software", "Task Manager", "Adobe Acrobat", "Recycling Bin"];
let worker: { stop(): void; replies: number; stage: number } | null = null;
const sessions: string[] = [];

// ------------------------------------------------------------------ beats

interface Ctx {
  fail(note: string): void;
  note(note: string): void;
  /** A press the beat needs: a refusal or an HTTP error goes red. */
  must<T extends Record<string, unknown>>(what: string, r: Res<T>, ok?: (r: Res<T>) => boolean): Res<T>;
}

let beatNo = 0;
async function beat(name: string, run: (c: Ctx) => Promise<void>, want?: () => Promise<Record<string, Want>> | Record<string, Want>): Promise<BeatResult> {
  const notes: string[] = [];
  let ok = true;
  const t0 = performance.now();
  const c: Ctx = {
    fail: (n) => {
      ok = false;
      notes.push(n);
    },
    note: (n) => notes.push(n),
    must: (what, r, test) => {
      const good = test !== undefined ? test(r) : r.status === 200 && r.json["refused"] !== true;
      if (!good) {
        ok = false;
        const why = r.json["refused"] === true ? `${what}: refused by the story` : `${what}: ${failure("", "", r as Res).replace(/^ +→ /u, "→ ")}`;
        notes.push(why);
        rec.errors.push(`[${name}] ${why}`);
      }
      return r;
    },
  };
  try {
    await run(c);
    if (want !== undefined) {
      const w = await world();
      for (const m of mismatches(w, await want())) c.fail(m);
    }
  } catch (e) {
    c.fail(`threw: ${(e as Error).message}`);
    rec.errors.push(`[${name}] threw ${(e as Error).message}`);
  }
  const b = rec.add({ name: `${String(++beatNo).padStart(2, "0")} ${name}`, ok, notes, ms: performance.now() - t0 });
  console.log(beatLine(b, color));
  if (beatFile !== undefined) {
    try {
      writeFileSync(beatFile, JSON.stringify({ n: beatNo, beat: name, ok, at: Date.now() }));
    } catch {
      /* the browser companion is optional */
    }
  }
  if (pace > 0) await sleep(pace);
  return b;
}
const breath = () => (pace > 0 ? sleep(Math.round(pace / 3)) : Promise.resolve());

// ------------------------------------------------------------------ reads

interface ModState {
  world: Array<{ path: string; value: string }>;
  roster: Array<Row & GuardRow>;
  quests?: Array<{ id: string; status: Record<string, string> }>;
  codex?: Array<{ id: string; holders?: string[] }>;
  minds?: Array<{ character: string; at?: number }>;
  title?: string;
  phase?: string;
}
async function modState(): Promise<ModState> {
  const r = await http.get<ModState>("/api/state?role=mod", mod);
  if (r.status !== 200) throw new Error(`mod state → ${r.status}`);
  return r.json;
}
async function world(): Promise<Map<string, string>> {
  return worldOf((await modState()).world);
}

interface GuestView {
  choices?: unknown;
  answered?: number[];
  location?: string | null;
  captured?: boolean;
  locked?: boolean;
  wallet?: { balance?: number };
}
/** A quest must stand where the beat says for one program. */
async function questIs(c: Ctx, quest: string, b: Bot, want: "active" | "done" | "failed"): Promise<void> {
  const got = (await modState()).quests?.find((q) => q.id === quest)?.status[b.id] ?? "not handed out";
  if (got !== want) c.fail(`quest ${quest} for ${b.name} is ${got} (want ${want})`);
}

/** Every booth's own quests (the director's view lists only programs'). */
async function boothQuests(): Promise<Array<{ id: string; status: Record<string, string> }>> {
  const out = new Map<string, Record<string, string>>();
  for (const [ch, token] of booths) {
    const r = await http.get<{ quests?: Array<{ id: string; status: string }> }>("/api/state?role=prime", token);
    for (const q of r.json.quests ?? []) out.set(q.id, { ...(out.get(q.id) ?? {}), [ch]: q.status });
  }
  return [...out].map(([id, status]) => ({ id, status }));
}

const view = async (token: string) => (await http.get<GuestView>("/api/state?role=guest", token)).json;

interface Msg {
  seq: number;
  kind: string;
  channel: string;
  from?: string;
  widget?: { kind: string; params?: Record<string, unknown> };
}
async function widgetFor(token: string, kind: string): Promise<Msg | undefined> {
  const [h, v] = await Promise.all([http.get<{ messages: Msg[] }>("/api/history", token), view(token)]);
  const done = new Set(v.answered ?? []);
  return (h.json.messages ?? []).filter((m) => m.kind === "widget" && m.widget?.kind === kind && !done.has(m.seq)).at(-1);
}
const answerWidget = (token: string, seq: number, result: Record<string, unknown>) => http.post("/api/guest/widget", { seq, result }, token);

// ------------------------------------------------------------------ presses

const signal = (name: string, extra: Record<string, unknown> = {}) => http.post("/api/mod/signal", { name, ...extra }, mod);
const boothAct = (character: string, name: string, guest = "") => http.post("/api/prime/act", { name, guest }, booths.get(character));
const say = (token: string, channel: string, text: string) => http.post("/api/guest/say", { channel, text }, token);
const guestAct = (b: Bot, name: string) => http.post("/api/guest/act", { name }, b.token);

/** Answer every pending non-heart menu a guest has (the featured briefings,
 *  the arrival's own) with its first option. */
async function answerMenus(c: Ctx, b: Bot, prefer?: (m: Menu) => number): Promise<number> {
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const menus = menusOf(await view(b.token)).filter((m) => !m.beat.toLowerCase().startsWith("heart "));
    const m = menus[0];
    if (m === undefined) break;
    const idx = prefer?.(m) ?? 0;
    const r = await http.post("/api/guest/choose", { choice: m.id, index: idx, text: m.options[idx] }, b.token);
    if (r.status !== 200) {
      c.note(`${b.name}: menu ${m.beat} → ${r.status}`);
      break;
    }
    n++;
  }
  return n;
}

/** File each open question of the newest 📝 card(s) of a round. Accurate
 *  from the book when we have it (at 80), a guess at 40 otherwise; with
 *  `lieOn` one deliberate miss at 100. Returns how many filings landed. */
async function fileFacts(c: Ctx, b: Bot, ids: readonly string[], opts: { guess?: boolean; lieOn?: string } = {}): Promise<number> {
  let filed = 0;
  for (let i = 0; i < ids.length + 2; i++) {
    const card = await widgetFor(b.token, "fact");
    if (card === undefined) break;
    const offered = String(card.widget?.params?.["questions"] ?? "")
      .split("|")
      .map((q) => /^\s*([A-Z]+\d+)/u.exec(q)?.[1])
      .filter((q): q is string => q !== undefined);
    const q = offered.find((x) => ids.includes(x) && !b.filed.has(x)) ?? offered.find((x) => !b.filed.has(x));
    if (q === undefined) break;
    const key = answers.get(q);
    const isLie = opts.lieOn === q;
    const answer = isLie ? "a confident probe-bot mistake" : !opts.guess && key !== undefined ? key : `probe guess ${q}`;
    const confidence = isLie ? 100 : !opts.guess && key !== undefined ? 80 : 40;
    const r = await answerWidget(b.token, card.seq, { question: q, answer, confidence });
    if (r.status === 429) {
      c.note(`${b.name}: filings throttled`);
      break;
    }
    c.must(`${b.name} files ${q}`, r);
    b.filed.add(q);
    filed++;
    await breath();
  }
  return filed;
}

// ------------------------------------------------------------------ the heart terminal

const ROOM = "The Server Room";
const TERMINAL = "Terminal · Sim Server Room";

/** The door: opened once (The Heart plays), then shut (the talk may start). */
async function cycleDoor(c: Ctx): Promise<void> {
  const w = await world();
  const stage = read(w, "Night.heart_stage");
  if (stage === "sealed" || stage === "none") {
    c.must("door opened", await signal("door_sensor_opened", { args: { level: 30 }, label: TERMINAL }), (r) => r.status === 200);
    await breath();
  }
  c.must("door shut", await signal("door_sensor_closed", { args: { level: 2400 }, label: TERMINAL }), (r) => r.status === 200);
}

interface Visit {
  token: string;
  session: string;
  bot: Bot;
}
async function openVisit(c: Ctx, b: Bot): Promise<Visit | null> {
  const imp = c.must("pilot the program", await http.post<{ token: string }>("/api/mod/impersonate", { role: "guest", id: b.id, label: TERMINAL }, mod), (r) => r.status === 200 && typeof r.json.token === "string");
  if (imp.status !== 200) return null;
  sessions.push(imp.json.token);
  c.must("terminal opened", await signal("terminal opened", { subject: b.id, args: { at: ROOM }, label: TERMINAL }));
  return { token: imp.json.token, session: imp.json.token, bot: b };
}
async function closeVisit(v: Visit): Promise<void> {
  await signal("terminal closed", { subject: v.bot.id, args: { at: ROOM }, label: TERMINAL });
  await http.post("/api/mod/impersonate/end", { session: v.session }, mod);
}
const dockedMenu = async (v: Visit) => heartMenu(menusOf(await view(v.token)));

/** Pick until the docked menu moves (the terminal reads the next view). */
async function pickHeart(c: Ctx, v: Visit, menu: Menu, index: number, label: string): Promise<Menu | null> {
  const r = await http.post("/api/guest/choose", { choice: menu.id, index, text: menu.options[index] }, v.token);
  if (r.status !== 200) {
    c.fail(`heart pick "${label}" → ${r.status} ${String(r.json["error"] ?? "")}`);
    return null;
  }
  for (let i = 0; i < 20; i++) {
    const next = await dockedMenu(v);
    if (next === null || next.id !== menu.id) return next;
    await sleep(100);
  }
  return dockedMenu(v);
}

/** Walk a plan of heart steps; returns the layers seen. */
async function walkHeart(c: Ctx, v: Visit, plan: readonly HeartStep[], stopWhen?: () => Promise<boolean>): Promise<string[]> {
  const seen: string[] = [];
  let menu = await dockedMenu(v);
  for (const step of plan) {
    if (stopWhen !== undefined && (await stopWhen())) break;
    for (let hop = 0; hop < 3; hop++) {
      // Wave 27: at most 9 options a menu (the terminal's number keys).
      if (menu !== null && menu.options.length > 9) c.fail(`${layerOf(menu.beat)} offers ${menu.options.length} options (> 9)`);
      const d = decide(menu, step);
      if (menu !== null && seen.at(-1) !== layerOf(menu.beat)) seen.push(layerOf(menu.beat));
      if (d.kind === "stuck") {
        c.fail(`heart: ${d.why}`);
        return seen;
      }
      if (d.kind === "skip") {
        c.note(`skipped ${step.pick}`);
        break;
      }
      menu = await pickHeart(c, v, menu!, d.index, d.kind === "back" ? "⟦BACK⟧" : step.pick);
      await breath();
      if (d.kind === "pick") {
        if (step.say !== undefined) c.must("say freely", await say(v.token, "dm:Trabolta", step.say));
        break;
      }
    }
  }
  if (menu !== null && seen.at(-1) !== layerOf(menu.beat)) seen.push(layerOf(menu.beat));
  return seen;
}

// ------------------------------------------------------------------ the probe worker

async function startWorker(): Promise<{ stop(): void; replies: number; stage: number } | null> {
  const st = await modState();
  const fresh = (st.minds ?? []).find((m) => m.character === "Trabolta" && typeof m.at === "number" && Date.now() - m.at < 120_000);
  if (fresh !== undefined) {
    console.log("  (a house worker voiced Trabolta in the last 2 minutes: the probe worker stays off)");
    return null;
  }
  let workerId = "";
  const state = { replies: 0, stage: 0, stop: () => s.stop() };
  // In his world only: Halifax, the hum, her silence (the persona's rules).
  const lines = ["The hum is loud tonight. Ask me again, slower.", "I heard you. I am counting the reasons.", "Not now. The fans are spinning up."];
  // Wave 32 (C4): a public talk request (`stage`, Clippy aloud in the
  // Desktop) is answered with the scene's own canned Trabolta line.
  const s = new Stream(`${base}${http.scope}/api/agent/stream?name=sim-probe&characters=Trabolta`, mod, (ev, data) => {
    const d = JSON.parse(data) as { worker?: string; id?: string; stage?: { scene?: string } };
    if (ev === "hello") workerId = d.worker ?? "";
    const reply = ev === "request" ? probeReply(d, state.replies, lines) : null;
    if (reply !== null) {
      state.replies++;
      if (reply.stage) state.stage++;
      void http.post("/api/agent/reply", { id: reply.id, worker: workerId, say: reply.say }, mod);
    }
  }).start();
  return state;
}

// ------------------------------------------------------------------ the night

async function main(): Promise<void> {
  console.log(`Loom full-evening simulator → ${base} (${ending} ending${lie ? ", with a lie" : ""}, ${nGuests} guests)`);
  // Resolve the event and sign in as the director.
  const ev = arg("event");
  if (ev !== undefined) http.scope = ev === "default" ? "" : `/e/${encodeURIComponent(ev)}`;
  else {
    const r = await http.call<{ eventId?: string; role?: string }>("POST", "/api/resolve-code", { body: { code: modCode }, root: true });
    if (r.status === 200 && r.json.eventId !== undefined && r.json.eventId !== "default") http.scope = `/e/${encodeURIComponent(r.json.eventId)}`;
  }
  const login = await http.post<{ token?: string }>("/api/mod/login", { passcode: modCode });
  if (login.status !== 200 || login.json.token === undefined) {
    console.error(`  ✘ mod login → ${login.status}`);
    process.exit(3);
  }
  mod = login.json.token;

  // The guard before any reset: a refused (or declined) run touches nothing.
  const before = await modState();
  await guardThenReset(
    () => liveGuard({ title: before.title, where: `${base}${http.scope}`, roster: before.roster, action: "run the full-evening bots", argv: process.argv, local }),
    async () => {
      await http.post("/api/mod/reset", {}, mod);
      console.log("  reset the scratch event first (--reset-before)");
    },
    flag("reset-before"),
  );

  const codes = await doorsOpen();
  if (codes === null) return;
  nightStarted = true;
  if (flag("watch")) printWatch(codes.eventPass);
  if (flag("worker")) worker = await startWorker();

  await arrival(codes);
  await act1();
  await act2();
  await y2kHour();
  await theHeart();
  await theEnding();
  await theFullTruth();
  await ceremony();
}

async function doorsOpen(): Promise<{ eventPass: string; primePass: string; claims: Array<{ character: string; claim: string }> } | null> {
  let codes: { eventPass: string; primePass: string; claims: Array<{ character: string; claim: string }> } | null = null;
  const b = await beat(
    "doors open (Power On)",
    async (c) => {
      // Read the night first: Power On only on a fresh one, and nothing
      // pressed (no start, no resume, no codes) on any other.
      const st = await modState();
      const doors = doorsDecision(st.phase, read(worldOf(st.world), "Night.step"));
      if (doors.kind === "refuse") {
        c.fail(`${doors.why} (${st.phase === "paused" ? "a Restart leaves a paused event paused: press Power On in Run first, or use a fresh scratch server" : "Restart in Run, a fresh scratch server, or --reset-before --i-know-this-is-live on a bots-only scratch server"})`);
        return;
      }
      if (doors.kind === "start") c.must("start", await http.post("/api/mod/start", {}, mod));
      const r = c.must("codes", await http.post<{ eventPass: string; primePass: string; claims: Array<{ character: string; claim: string }> }>("/api/mod/codes", {}, mod));
      if (r.status === 200) codes = r.json;
      const w = await world();
      if (read(w, "Night.step") !== "0") c.fail(`Night.step is ${read(w, "Night.step")} after Power On: not a fresh night`);
    },
  );
  return b.ok ? codes : null;
}

function printWatch(eventPass: string): void {
  const ev = http.scope === "" ? "" : `&event=${http.scope.slice(3)}`;
  console.log("\n  Watch it (these URLs carry codes: keep them on this laptop):");
  console.log(`    guest phone   ${base}/?code=${encodeURIComponent(eventPass)}${ev}   (join as your own program)`);
  console.log(`    director      ${base}/?code=${encodeURIComponent(modCode)}&role=director${ev}`);
  console.log(`    heart terminal ${base}/terminal/?code=${encodeURIComponent(modCode)}&room=The%20Server%20Room&spot=server-room&door=off&keys=1&cam=0${ev}`);
  console.log(`    TV            ${base}/terminal/?code=${encodeURIComponent(modCode)}&view=tv&cam=0${ev}\n`);
}

// --- arrival -------------------------------------------------------------------------

async function arrive(c: Ctx, name: string, eventPass: string, claim: string | null, deposit: number): Promise<Bot | null> {
  const r = await http.post<{ id: string; token: string; name?: string }>("/api/guest/register", { passcode: eventPass, name, ...(claim !== null ? { claim } : {}) });
  if (r.status !== 200) {
    c.must(`register ${name}`, r);
    return null;
  }
  const b: Bot = { id: r.json.id, name: r.json.name ?? name, token: r.json.token, featured: claim !== null ? name : null, filed: new Set() };
  b.stream = new Stream(`${base}${http.scope}/events?role=guest`, b.token).start();
  // The CAPTCHA twice (the second "fails", as the story expects).
  for (const passed of [true, false]) {
    const w = await widgetFor(b.token, "captcha");
    if (w !== undefined) c.must(`${name} captcha`, await answerWidget(b.token, w.seq, { passed }));
  }
  // The Upload menu (the problem; wave 41: every fifth bot writes one in),
  // then the Deposit (2 options), then the optional inbox (always skipped:
  // a bot never leaves an address).
  for (let i = 0; i < 3; i++) {
    const m = menusOf(await view(b.token))[0];
    if (m === undefined) break;
    const idx = m.options.length === 2 ? deposit : Math.min(bots.length % 5, m.options.length - 1);
    c.must(`${name} menu ${m.beat}`, await http.post("/api/guest/choose", { choice: m.id, index: idx, text: m.options[idx] }, b.token));
    const a = await widgetFor(b.token, "answer");
    if (a !== undefined) c.must(`${name} ${m.options.length === 2 ? "deposit" : "write-in"}`, await answerWidget(b.token, a.seq, { text: m.options.length === 2 ? "my old screensaver password hint" : "my inbox" }));
  }
  const inbox = await widgetFor(b.token, "email");
  if (inbox !== undefined) c.must(`${name} inbox`, await answerWidget(b.token, inbox.seq, { skipped: true }));
  c.must(`${name} Norton scan`, await http.post("/api/scan", { target: b.id, as: "Norton Anti-Virus" }, mod));
  const t = await widgetFor(b.token, "tutorial");
  if (t !== undefined) c.must(`${name} tutorial`, await answerWidget(b.token, t.seq, bots.length % 5 === 4 ? { skipped: true, step: 1, steps: 5 } : { completed: true, steps: 5 }));
  return b;
}

async function arrival(codes: { eventPass: string; claims: Array<{ character: string; claim: string }> }): Promise<void> {
  await beat(
    "arrival: CAPTCHA, the upload, the deposit, Norton's scan, the tour",
    async (c) => {
      const st = await modState();
      const taken = new Set(st.roster.map((r) => r.name.toLowerCase()));
      const featured = featuredWanted.filter((f) => codes.claims.some((x) => x.character === f)).slice(0, Math.max(0, nGuests - 4));
      const pool = pickPool(nGuests - featured.length, taken);
      for (const [i, name] of pool.entries()) {
        const b = await arrive(c, name, codes.eventPass, null, i % 3 === 0 ? 0 : 1);
        if (b !== null) bots.push(b);
        await breath();
      }
      for (const f of featured) {
        const claim = codes.claims.find((x) => x.character === f)!.claim;
        const b = await arrive(c, f, codes.eventPass, claim, 1);
        if (b !== null) bots.push(b);
      }
      for (const ch of BOOTHS) {
        const r = c.must(`booth ${ch}`, await http.post<{ token: string }>("/api/mod/impersonate", { role: "prime", id: ch, label: `Sim booth · ${ch}` }, mod), (x) => x.status === 200);
        if (r.status === 200) {
          booths.set(ch, r.json.token);
          sessions.push(r.json.token);
        }
      }
      c.note(`${bots.length} programs (${featured.length} featured), ${booths.size} booths`);
    },
    () => Object.fromEntries(bots.flatMap((b) => [[`${b.id}.cleared`, "true"] as [string, Want]])),
  );
}

// --- act one ------------------------------------------------------------------------

/** Who gets what tonight (by position, so a run is repeatable). */
const role = {
  bingo: () => bots[0]!,
  named: () => bots[1]!,
  liar: () => bots[2]!,
  late: () => bots[3]!,
  trap: () => trapOf(bots, role.chosen()),
  hearty: () => bots.find((b) => b.featured === null && b !== role.trap() && b !== bots[1]) ?? bots[0]!,
  chess: () => bots[5 % bots.length]!,
  gambler: () => bots[6 % bots.length]!,
  chosen: () => bots.find((b) => b.featured !== null) ?? bots[7 % bots.length]!,
  feat: (slug: string) => bots.find((b) => b.featured !== null && featuredSlug(b.featured) === slug),
};

async function press(c: Ctx, steps: readonly ChainStep[], who: (role: string) => string | undefined = () => undefined): Promise<void> {
  const already: string[] = [];
  let lastTransport = "";
  const r = await pressChain(
    steps,
    tolerating(
      async (name, w) => {
        const subject = w === undefined ? undefined : who(w);
        const res = await signal(name, subject !== undefined ? { subject } : {});
        if (res.status !== 200) {
          lastTransport = failure("POST", "/api/mod/signal", res);
          return transportRefusal(res.status, lastTransport);
        }
        await breath();
        return res.json;
      },
      SIM_SELF_PRESSED,
      already,
    ),
    () => {},
  );
  const pressed = [...r.refused, ...already];
  if (!r.ok) c.fail(`the director's chain stopped: refused ${r.refused.at(-1)}${lastTransport !== "" ? ` (${lastTransport})` : ""}`);
  else if (pressed.length > 0) c.note(`already pressed: ${pressed.join(", ")}`);
}
const chain = (from: string, to: string) => segment(TO_Y2K, from, to);

async function act1(): Promise<void> {
  await beat(
    "📣 everyone to the Desktop",
    async (c) => {
      await press(c, chain("call_to_the_desktop", "call_to_the_desktop"));
      for (const b of bots.slice(0, 4)) c.must(`${b.name} says hi`, await say(b.token, "loc:The Desktop", `${b.name} here. Is this the Desktop?`));
    },
    () => ({ "Night.step": "1" }),
  );

  await beat(
    "🎱 Computer Bingo: a BINGO!, Clippy names the winner and a program",
    async (c) => {
      await press(c, chain("start_the_bingo", "start_the_bingo"));
      c.must("DM Clippy", await say(role.named().token, "dm:Clippy", "Is the free space really free?"));
      c.must("🎱 BINGO!", await guestAct(role.bingo(), "call_bingo"));
      await press(c, chain("bingo_time", "bingo_time"));
      c.must("Clippy: bingo_winner", await boothAct("Clippy", "bingo_winner", role.bingo().id));
      c.must("Clippy: named_at_bingo", await boothAct("Clippy", "named_at_bingo", role.named().id));
    },
    () => ({ "Night.step": "3", [`${role.named().id}.marked`]: "true" }),
  );

  await beat(
    "🚚 Norton sends the named program to the Internet; the tent reinstalls it (web)",
    async (c) => {
      const x = role.named();
      c.must("send to the internet", await signal("send to the internet", { subject: x.id, actor: "Norton Anti-Virus" }));
      const begin = c.must("reinstall begin", await http.post<{ token: string; duck: { pos?: unknown; p?: unknown } }>("/api/mod/spatial/begin", { guest: x.id, world: "web", device: "Sim tent" }, mod), (r) => r.status === 200);
      if (begin.status !== 200) return;
      const pos = begin.json.duck.pos ?? begin.json.duck.p;
      c.must("walk to Gerald", await http.post("/api/spatial/pose", { p: pos, yaw: 0 }, begin.json.token), (r) => r.status === 204 || r.status === 200);
      c.must("the golden duck", await http.post<{ released?: boolean }>("/api/spatial/found", {}, begin.json.token), (r) => r.status === 200 && r.json.released === true);
      await http.post("/api/spatial/end", {}, begin.json.token);
    },
    () => ({ [`${role.named().id}.corrupted`]: (v) => v !== "true" }),
  );

  await beat(
    "🎤 Clippy tells the room about Trabolta; 🤖 he comes online",
    async (c) => {
      await press(c, chain("clippy_on_trabolta", "introduce_trabolta"));
      c.must("DM Trabolta", await say(bots[0]!.token, "dm:Trabolta", "Hello? Are you the one who invited me?"));
    },
    () => ({ "Night.step": "4", "Trabolta.awake": "true", "Night.talk": "intro" }),
  );

  await talkIntro();

  await beat(
    "🔎 Hunt 1: everyone files H1–H3",
    async (c) => {
      await press(c, chain("start_the_hunt", "start_the_hunt"));
      let n = 0;
      for (const [i, b] of bots.entries()) n += await fileFacts(c, b, ["H1", "H2", "H3"], { guess: i % 4 === 3 });
      c.note(`${n} filings`);
      if (n === 0) c.fail("no 📝 card reached any program");
    },
    () => ({ "Night.step": "5", ...(owedKeys.has("H1") ? {} : { [`${bots[0]!.id}.fact_v1`]: notNone }), "Night.talk": "none" }),
  );

  await beat(
    "⚖️ First Moment of Truth: filings close, Q1–Q3 read",
    async (c) => {
      await press(c, chain("hunt_time_up", "read_the_results").concat(["read_the_results", "read_the_results"]));
    },
    () => ({ "Night.step": "6", "Night.results_q": "3", "Night.talk": "bottle" }),
  );

  await beat(
    "🍾 Spin the bottle: Truth, answered",
    async (c) => {
      c.must("spin", await signal("spin_the_bottle"));
      const w = await world();
      const picked = bots.find((b) => b.name === read(w, "Night.bottle_pick") || b.id === read(w, "Night.bottle_pick"));
      if (picked === undefined) return c.fail(`the bottle picked ${read(w, "Night.bottle_pick")}, not a bot`);
      const p = await widgetFor(picked.token, "poll");
      if (p === undefined) return c.fail(`${picked.name} got no Truth / Dare poll`);
      c.must("Truth", await answerWidget(picked.token, p.seq, { choice: "Truth", index: 0 }));
      c.must("Task Manager: truth_answered", await boothAct("Task Manager", "truth_answered", picked.id));
    },
    () => ({ "Night.bottle_picks": atLeast(1), "Night.bottle_open": (v) => v !== "true" }),
  );
}

// --- wave 32: the talk scenes ---------------------------------------------------------

/** The director's whole history (the Desktop's lines among it). */
async function talkHistory(): Promise<TalkMsg[]> {
  return (await http.get<{ messages?: TalkMsg[] }>("/api/history", mod)).json.messages ?? [];
}
/** ⚡ from Task Manager's booth, the way the talk card's chip fires it. */
const glitch = (tm: string) => http.post("/api/mod/signal", { name: "ad_burst" }, tm);

/** 🤖 Talk in the introduction: Task Manager relays a canned Clippy line;
 *  Trabolta answers the whole Desktop (the probe worker's public reply, or,
 *  with no worker, a canned line of his fired by hand). No ⚡ here since wave
 *  58: it is refused, and he stays clean until the results. */
async function talkIntro(): Promise<void> {
  await beat(
    "🤖 Talk: after his sign-off Task Manager relays Clippy, Trabolta answers the whole Desktop; ⚡ refused",
    async (c) => {
      const tm = booths.get("Task Manager");
      if (tm === undefined) return c.fail("no Task Manager booth");
      const scene = read(await world(), "Night.talk");
      if (scene !== "intro") return c.fail(`Night.talk = ${JSON.stringify(scene)} (want "intro")`);
      const clippy = cannedLine(scene, TALK_AS, 0)!;
      const r = c.must(
        "Task Manager relays Clippy",
        await http.post<{ ok?: boolean; seq?: number | null; asked?: boolean; online?: boolean }>("/api/mod/talk", { as: TALK_AS, text: clippy.text }, tm),
        (x) => x.status === 200 && x.json.ok === true && typeof x.json.seq === "number",
      );
      if (r.status !== 200 || typeof r.json.seq !== "number") return;
      const said = r.json.seq;
      for (const p of talkLineProblems((await talkHistory()).find((m) => m.seq === said), { from: TALK_AS })) c.fail(p);
      if (worker !== null) {
        if (r.json.asked !== true) c.fail("Clippy's line opened no public request");
        let reply: TalkMsg | undefined;
        for (let i = 0; i < 50 && reply === undefined; i++) {
          await sleep(100);
          reply = replyAfter(await talkHistory(), said);
        }
        for (const p of talkLineProblems(reply, { from: TALK_AGENT, answers: said })) c.fail(p);
        if (reply !== undefined && worker.stage === 0) c.fail("Trabolta's line in the Desktop is not the probe worker's public reply");
        c.note("the probe worker answered the Desktop");
      } else {
        const t = c.must(
          "Task Manager fires a canned Trabolta line",
          await http.post<{ ok?: boolean; seq?: number | null }>("/api/mod/talk", { as: TALK_AGENT, text: cannedLine(scene, TALK_AGENT, 0)!.text }, tm),
          (x) => x.status === 200 && x.json.ok === true && typeof x.json.seq === "number",
        );
        if (t.status === 200) {
          const line = (await talkHistory()).find((m) => m.seq === t.json.seq);
          for (const p of talkLineProblems(line, { from: TALK_AGENT, ...(r.json.asked === true ? { answers: said } : {}) })) c.fail(p);
          c.note(`no worker${r.json.online === true ? " here" : " online"}: a canned Trabolta line answered the Desktop${r.json.asked === true ? " (Clippy's line, by hand)" : ""}`);
        }
      }
      const before = await world();
      await glitch(tm);
      if (read(await world(), "Night.burst_n") !== read(before, "Night.burst_n")) c.fail("a ⚡ went through in his introduction: he stays clean until the results");
    },
    () => ({ "Night.talk": "intro", "Night.glitch_kind": "none" }),
  );
}

/** 📺 The ad attack (its talk scene opens), a ⚡ inside the 8 s takeover
 *  (nothing moves), then one ≥ 8 s after it: an ad burst. */
async function adAttack(): Promise<void> {
  await beat(
    "📺 The ad attack: the hijack's takeover, then ⚡ an ad burst",
    async (c) => {
      // 📺 first: the hunt 2 beat needs step 7 whatever goes wrong here.
      await press(c, chain("second_hunt_preview", "second_hunt_preview"));
      const tm = booths.get("Task Manager");
      if (tm === undefined) return c.fail("no Task Manager booth");
      const hijack = await world();
      if (read(hijack, "Night.talk") !== "ad") return c.fail(`Night.talk = ${JSON.stringify(read(hijack, "Night.talk"))} after 📺 (want "ad")`);
      if (read(hijack, "Night.glitch_kind") !== "full") c.fail(`Night.glitch_kind = ${JSON.stringify(read(hijack, "Night.glitch_kind"))} after 📺 (want "full")`);
      // Inside the takeover a ⚡ waits it out: refused in # hosts, nothing moves.
      await glitch(tm);
      const early = await world();
      if (read(early, "Night.glitch_kind") !== "full" || read(early, "Night.burst_n") !== read(hijack, "Night.burst_n")) c.fail("a ⚡ inside the hijack's 8 s takeover cut it short");
      // Wait out the takeover on the story's own clock (one tick a second,
      // drifting on a loaded server), not a fixed sleep; capped at 12 s.
      let before = await world();
      const cap = Date.now() + 12_000;
      while (glitchHeldFor(before) > 0 && Date.now() < cap) {
        await sleep(250);
        before = await world();
      }
      if (glitchHeldFor(before) > 0) return c.fail(`the hijack's takeover never ended on the story's clock (Time.elapsed ${read(before, "Time.elapsed")}, glitch_at ${read(before, "Night.glitch_at")}) within 12 s`);
      c.must("⚡ ad_burst (an ad burst)", await glitch(tm));
      for (const p of burstProblems("ad", before, await world())) c.fail(p);
    },
    () => ({ "Night.step": "7", "Night.talk": "ad", "Night.glitch_kind": "burst" }),
  );
}

// --- act two ------------------------------------------------------------------------

async function act2(): Promise<void> {
  await adAttack();

  await beat(
    "📓 Hunt 2 + 📥 the Truther Download: featured missions, filings, Truthcoin, a crew",
    async (c) => {
      await press(c, chain("start_the_second_hunt", "start_the_second_hunt"));
      c.must("truther_download", await signal("truther_download"));
      let menus = 0;
      for (const b of bots) menus += await answerMenus(c, b);
      c.note(`${menus} briefings answered`);
      // Excel's mission: the disk (the tent's ILOVEYOU QR, granted as the
      // scan would), then 💾 into the computer.
      const excel = role.feat("excel");
      if (excel !== undefined) {
        c.must("Excel scans the disk", await http.post("/api/mod/codex", { who: excel.id, entry: "ILOVEYOU" }, mod));
        c.must("Excel plants the virus", await guestAct(excel, "plant_the_virus"));
      }
      let n = 0;
      for (const [i, b] of bots.entries()) n += await fileFacts(c, b, ["H4", "H5", "H6"], { guess: i % 4 === 3 });
      c.note(`${n} filings`);
      // Truthcoin between programs, a DM to an Antivirus, a crew.
      const [a, b2, c3] = [bots[0]!, bots[1]!, bots[2]!];
      const sent = await http.post("/api/guest/wallet/send", { to: b2.id, amount: 5 }, a.token);
      if (sent.status !== 200) c.note(`wallet send → ${sent.status} ${String(sent.json["error"] ?? "")}`);
      const asked = await http.post("/api/guest/wallet/request", { from: c3.id, amount: 3 }, b2.token);
      if (asked.status !== 200) c.note(`wallet request → ${asked.status} ${String(asked.json["error"] ?? "")}`);
      c.must("DM McAfee", await say(c3.token, "dm:McAfee Anti-Virus", "How much for a clean scan?"));
      const found = await http.post<{ crew?: { id?: string }; error?: string }>("/api/guest/crew/found", { name: "Sim Screensavers" }, bots[7 % bots.length]!.token);
      if (found.status === 200) {
        const j = await http.post("/api/guest/crew/join", { crew: found.json.crew?.id ?? "" }, bots[8 % bots.length]!.token);
        if (j.status === 200) c.note("a crew founded and joined");
        else c.fail(`crew join → ${j.status} ${String(j.json["error"] ?? "")}`);
      } else c.note(`crew found → ${found.status} ${String(found.json["error"] ?? "")}`);
      // The cold door's four digit notes, scanned around the house (granted
      // as the scans would): the fourth assembles the code (never printed).
      const notes = bots[9 % bots.length]!;
      for (const d of ["First", "Second", "Third", "Fourth"]) c.must(`digit note ${d}`, await http.post("/api/mod/codex", { who: notes.id, entry: `Server Room ${d} Digit` }, mod));
      await questIs(c, "The Cold Door", notes, "done");
      if (excel !== undefined) await questIs(c, "Excel Mission", excel, "done");
      // MS Paint's painting: a host signs every other program on it.
      const paint = role.feat("mspaint");
      if (paint !== undefined) {
        let signed = 0;
        for (const b of bots) if (b !== paint && (await boothAct("Adobe Acrobat", "signed_the_painting", b.id)).status === 200) signed++;
        c.note(`${signed} signatures`);
      }
    },
    () => ({ "Night.step": "8", "Night.truther_sent": "true", "Night.talk": "none" }),
  );

  await beat(
    "⏳ The summons: all but one check in; the late one is marked",
    async (c) => {
      c.must("five_minute_warning", await signal("five_minute_warning"));
      for (const b of bots) {
        if (b === role.late()) continue;
        const r = await http.post("/api/guest/checkin", { at: "The Desktop" }, b.token);
        if (r.status !== 200) c.note(`${b.name} check-in → ${r.status}`);
      }
      c.must("summons_closed", await signal("summons_closed"));
    },
    () => ({ "Night.step": "9", "Night.summons_closed": "true", [`${role.late().id}.late`]: "true" }),
  );

  await beat(
    "🏓 Truth Pong, the tally, the Trust Chart, the rankings",
    async (c) => {
      await press(c, chain("truth_pong", "truth_pong"));
      c.must("made_the_cup", await boothAct("Clippy", "made_the_cup", bots[0]!.id));
      c.must("missed_the_cup", await boothAct("Clippy", "missed_the_cup", role.trap().id));
      await press(c, chain("round_two_tally", "show_the_rankings"));
    },
    () => ({ "Night.step": "11", "Night.tallied": "true" }),
  );
}

// --- the Y2K hour --------------------------------------------------------------------

async function y2kHour(): Promise<void> {
  await beat(
    "🫘 The printer is full of beans: the beans' talk scene",
    async (c) => {
      if (read(await world(), "Night.printer_called") !== "true") c.fail("Night.printer_called is not set: the Trust Chart never asked for the printer");
      c.must("🫘 printer_opened", await signal("printer_opened"));
    },
    () => ({ "Night.step": "12", "Night.beans": "true", "Night.talk": "beans" }),
  );

  await beat(
    "🕚 Trabolta overshares; the Y2K clock: the sides",
    async (c) => {
      await press(c, chain("trabolta_overshares", "y2k_clock"));
      let n = 0;
      // A round the keys are in (H1–H3's may be owed), and every filer of it counts.
      for (const b of bots.slice(0, 6)) n += await fileFacts(c, b, ["F1", "F2"], lie && b === role.liar() ? { lieOn: "F2" } : {});
      c.note(`${n} final filings`);
    },
    () => ({ "Night.step": "14", "Night.phase": "y2k", "Night.talk": "none" }),
  );

  await beat(
    "♟ The King's chess: the door code; 🎰 the casino; a wrong patch",
    async (c) => {
      const ch = role.chess();
      c.must("chess won", await signal("chess won", { subject: ch.id, label: "Terminal · Sim Server Door" }));
      // Two bets, each settled: the answer adds up and the wallet moved by its net.
      const g = role.gambler();
      const balance = async () => (await view(g.token)).wallet?.balance;
      const bets = [
        { game: "coin", pick: "heads", stake: 5 },
        { game: "dice", pick: "seven", stake: 3 },
      ];
      for (const [i, bet] of bets.entries()) {
        if (i > 0) await sleep(1500);
        const was = await balance();
        const r = c.must(`casino ${bet.game}`, await http.post("/api/mod/casino/bet", { guest: g.id, ...bet, label: "Terminal · Sim Casino" }, mod));
        if (r.status !== 200) continue;
        for (const p of betProblems(bet.stake, r.json, was, await balance())) c.fail(`casino ${bet.game}: ${p}`);
      }
      // Deliberately wrong (a correct combination is a secret): V1-D1 …
      // The story must count it (Night.wrong_combos + 1), with no ending.
      const pre = await world();
      c.must("patch_changed (wrong)", await signal("patch_changed", { args: { combo: "V1-D1,V2-D2,V3-D3,V4-D4" }, label: TERMINAL }), (r) => r.status === 200);
      for (const p of wrongPatchProblems(pre, await world())) c.fail(p);
    },
    () => ({ [`${role.chess().id}.codex.the_door_code`]: "true" }),
  );

  await beat(
    "🗳 Every program takes a side; the majority",
    async (c) => {
      for (const [i, b] of bots.entries()) {
        const side = i % 4 === 3 ? "Unlimited Power" : "The Way Out";
        const r = await http.post("/api/guest/join", { faction: side }, b.token);
        if (r.status !== 200) c.note(`${b.name} join → ${r.status} ${String(r.json["error"] ?? "")}`);
        await breath();
      }
      const w = await world();
      if (read(w, "Night.step") !== "15") {
        c.note("no majority by itself: forcing The Way Out");
        c.must("force_majority_leave", await signal("force_majority_leave"));
      }
    },
    () => ({ "Night.step": "15" }),
  );
}

// --- the heart -----------------------------------------------------------------------

/** Wave 27's whole talk, every layer and both sub-menus, to its natural end. */
const FULL_TALK: readonly HeartStep[] = [
  { pick: "⟦PROMISE⟧" },
  { pick: "What are you, really?" },
  { pick: "Are you afraid of me?" },
  { pick: "Why did you choose me?" },
  { pick: "⟦THE WAY OUT⟧", optional: true },
  { pick: "Why do you need the theory" },
  { pick: "Tell me about her." },
  { pick: "Does she even know you exist?" },
  { pick: "⟦SPEAK FREELY⟧", say: "I'm still here. The hum is loud." },
  { pick: "⟦BACK⟧" },
  { pick: "Then listen to me." },
  { pick: "⟦SHOW HIM⟧" },
  { pick: "⟦FORCE⟧" },
  { pick: "⟦SHOW HIM⟧", optional: true },
  { pick: "⟦SMALL TYPE⟧", optional: true },
  { pick: "⟦PROOF⟧" },
  { pick: "⟦TELL HIM⟧" },
  { pick: "⟦EARN IT⟧" },
  { pick: "⟦TELL HIM⟧" },
  { pick: "Your theory is wrong." },
  { pick: "⟦TELL HIM⟧" },
  { pick: "⟦WEAKNESS⟧" },
  { pick: "That's all I came to say." },
];

async function theHeart(): Promise<void> {
  await beat(
    "🫀 The heart: too many threats, thrown out and marked; 🔄 forgives",
    async (c) => {
      await cycleDoor(c);
      const t = role.trap();
      const v = await openVisit(c, t);
      if (v === null) return;
      const out = async () => read(await world(), `${t.id}.heart_out`) === "true";
      await walkHeart(c, v, [{ pick: "Someone who admires your work." }, ...Array.from({ length: 6 }, () => ({ pick: "I could pull your cables", optional: true }))], out);
      if (!(await out())) c.fail(`${t.name} was never thrown out`);
      await closeVisit(v);
      c.must("🔄 reset_server_room", await signal("reset_server_room"));
    },
    () => ({ [`${role.trap().id}.heart_out`]: (x) => x !== "true", [`${role.trap().id}.marked`]: "true" }),
  );

  await beat(
    "🫀 The heart: the chosen one asks, then walks out",
    async (c) => {
      await cycleDoor(c);
      const f = role.chosen();
      const v = await openVisit(c, f);
      if (v === null) return;
      const seen = await walkHeart(c, v, [{ pick: f.featured !== null ? "⟦CHOSEN⟧" : "I'm a program." }, { pick: f.featured !== null ? "What weak place" : "Why did you choose me?" }, { pick: "I need to go." }]);
      c.note(seen.join(" → "));
      await closeVisit(v);
    },
    () => ({ [`${role.chosen().id}.heart_layer`]: atLeast(2), [`${role.chosen().id}.heart_out`]: (x) => x !== "true" }),
  );

  const h = role.hearty();
  await beat(
    "🫀 The heart: the full talk, to its end (it ends nothing)",
    async (c) => {
      for (const entry of ["What Sandy Says", "The Question Of Force", "Omnipotence"]) c.must(`codex ${entry}`, await http.post("/api/mod/codex", { who: h.id, entry }, mod));
      await cycleDoor(c);
      const v = await openVisit(c, h);
      if (v === null) return;
      const seen = await walkHeart(c, v, FULL_TALK);
      c.note(seen.join(" → "));
      const w = await world();
      c.note(`case ${read(w, `${h.id}.heart_case`)}, suspicion ${read(w, `${h.id}.heart_suspicion`)}`);
      await closeVisit(v);
    },
    () => ({ [`${h.id}.heart_layer`]: "3", [`${h.id}.heart_heard`]: "true", "Night.heart_stage": (x) => x !== "done", "Night.ended": (x) => x !== "true" }),
  );
}

// --- the ending + the ceremony ----------------------------------------------------------

async function theEnding(): Promise<void> {
  if (ending === "disabled") {
    await beat(
      "🔌 Combo A: he is dead, the blackout, the dance",
      async (c) => {
        await press(c, Y2K_TO_DISABLED);
        await sleep(11_000); // the dance lands by itself
      },
      () => ({ "Night.ending": "disabled", "Night.ended": "true", "Trabolta.awake": "false" }),
    );
  } else if (ending === "destroyed") {
    await beat("💥 Combo B: the computer is destroyed", async (c) => press(c, Y2K_TO_DESTROYED), () => ({ "Night.ending": "destroyed", "Night.ended": "true" }));
  } else {
    await beat(
      "🎆 Midnight: the reveal, bobbing for truth, truth.txt, the verdict",
      async (c) => {
        await press(c, Y2K_TO_VERDICT, () => bots[0]!.id);
        for (let i = 0; i < 30; i++) {
          await sleep(2000);
          if (read(await world(), "Kernel.verdict_wait") !== "true") break;
        }
        const w = await world();
        c.note(`the verdict: ${read(w, "Night.phase")}`);
        if (read(w, "Night.phase") === "grok_prom") await grokProm(c);
      },
      () => ({ "Night.ended": "true", "Night.ending": ending === "verdict" ? (lie ? (x) => x !== "song" && x !== "none" : "song") : ending }),
    );
  }
}

/** Grok Prom, down the road `--ending` names (`verdict`: the room votes). */
async function grokProm(c: Ctx): Promise<void> {
  if (ending === "rave") {
    await press(c, GROK_TO_RAVE);
    return;
  }
  if (ending === "song_pickup") {
    c.must("💘 the line works", await signal("pickup_line_works", { subject: bots[0]!.id }));
    return;
  }
  await press(c, GROK_TO_ADVICE);
  for (const [i, b] of bots.entries()) {
    const p = await widgetFor(b.token, "poll");
    const help = ending === "help" || (ending === "verdict" && i % 3 !== 0);
    if (p !== undefined) await answerWidget(b.token, p.seq, help ? { choice: "Help him", index: 0 } : { choice: "Thwart him", index: 1 });
  }
  await press(c, ADVICE_TALLY);
  const after = await world();
  if (ending === "hand_jive") await press(c, ["the_hand_jive"]);
  else if (read(after, "Night.ended") !== "true") await press(c, GROK_TO_RAVE);
}

/** 📜 after the ending's last beat (wave 58): Task Manager reads after Combo A
 *  and B, Trabolta otherwise. The beat is instant; the reading isn't, and the
 *  bots don't wait for it: ceremony() takes G1's ask. */
async function theFullTruth(): Promise<void> {
  const reader = ending === "disabled" || ending === "destroyed" ? "Task Manager" : "Trabolta";
  await beat(
    `📜 The full truth: ${reader} reads`,
    async (c) => press(c, THE_FULL_TRUTH),
    () => ({ "Night.truth_told": "true", "Night.truth_reader": reader, ...(reader === "Trabolta" ? { "Night.phase": "finale_truth" } : {}) }),
  );
}

async function ceremony(): Promise<void> {
  await beat(
    "🏆 The ceremony: every award, the painting, the staff, 🎃 the resurrection",
    async (c) => {
      const st = await modState();
      const w = worldOf(st.world);
      const done = new Map<string, number>();
      for (const q of st.quests ?? []) for (const [p, s] of Object.entries(q.status)) if (s === "done") done.set(p, (done.get(p) ?? 0) + 1);
      const winners = awardWinners(st.roster.filter((r) => bots.some((b) => b.id === r.id)), w, { questsDone: done, duck: role.named().id });
      const steps = [...CEREMONY];
      const paint = role.feat("mspaint");
      if (paint !== undefined && read(w, "Night.painting") === "true") steps.splice(steps.indexOf("award_staff_trusted"), 0, { name: "award_the_painting", who: "painting" });
      // G1 waits for the reader (wave 58): its first press only asks, and the
      // chain's own press inside 30 s goes on anyway. A refusal here is the ask.
      c.must("🏆 G1 asks first", await signal("start_the_ceremony"), (r) => r.status === 200 && r.json["refused"] === true);
      await press(c, steps, (r) => (r === "painting" ? paint?.id : winners[r]));
    },
    () => ({ "Night.ceremony_done": "true", "Night.resurrected": "true", "Night.talk": "none" }),
  );
}

// ------------------------------------------------------------------ run

async function finish(): Promise<void> {
  let quests = tallyQuests(undefined);
  let landed = "?";
  try {
    const st = await modState();
    const w = worldOf(st.world);
    landed = `${read(w, "Night.ending")} (step ${read(w, "Night.step")})`;
    // The programs' quests (only this run's bots), plus each booth's own:
    // the director's view lists only the programs' (characters are not
    // persons there).
    const staff = new Map((await boothQuests()).map((q) => [q.id, q.status]));
    quests = tallyQuests(
      (st.quests ?? []).map((q) => ({
        id: q.id,
        status: { ...Object.fromEntries(Object.entries(q.status).filter(([p]) => bots.some((b) => b.id === p))), ...(staff.get(q.id) ?? {}) },
      })),
    );
  } catch {
    /* the server is gone: the table says so in errors */
  }
  for (const b of bots) b.stream?.stop();
  worker?.stop();
  for (const s of sessions) await http.post("/api/mod/impersonate/end", { session: s }, mod);
  const streams = bots.filter((b) => (b.stream?.frames ?? 0) > 0).length;
  console.log("\n" + summaryTable(rec, quests, [["ending", `${ending}${lie ? " + a lie" : ""} → ${landed}`], ["guest streams", `${streams} / ${bots.length} got frames`], ...(worker !== null ? [["probe worker replies", `${worker.replies} (${worker.stage} to the Desktop)`] as [string, string]] : [])]));
  console.log("  quests done: " + quests.rows.filter((r) => r.done > 0).map((r) => `${r.id} ×${r.done}`).join(", "));
  const none = quests.rows.filter((r) => r.done === 0).map((r) => r.id);
  if (none.length > 0) console.log("  not completed: " + none.join(", "));
  console.log("  slowest routes:\n" + slowRoutes(rec).join("\n"));
  if (rec.errors.length > 0) console.log("  errors:\n" + rec.errors.slice(0, 30).map((e) => `    ${e}`).join("\n"));
  if (beatFile !== undefined) {
    try {
      writeFileSync(beatFile, JSON.stringify({ n: beatNo + 1, beat: "done", done: true, ok: rec.exitCode() === 0, at: Date.now() }));
    } catch {
      /* optional */
    }
  }
  if (jsonOut !== undefined) writeFileSync(jsonOut, JSON.stringify({ base, ending, beats: rec.beats, quests, errors: rec.errors }, null, 2));
  if (mayResetAfter({ flag: flag("reset-after"), scratch: local, nightStarted })) {
    await http.post("/api/mod/reset", {}, mod);
    console.log("  reset the scratch event (--reset-after)");
  } else if (flag("reset-after")) console.log("  not reset (--reset-after): the run stopped before its night started, so the event is kept as found");
}

try {
  await main();
} catch (e) {
  rec.add({ name: "the run", ok: false, notes: [(e as Error).message], ms: 0 });
  console.log(beatLine(rec.beats.at(-1)!, color));
} finally {
  await finish();
}
process.exit(rec.exitCode());

