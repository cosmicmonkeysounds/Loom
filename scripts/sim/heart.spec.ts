// The REAL heart terminal, driven as a program would (wave 28). The
// evening's heart bot pilots over HTTP, so nothing in `evening.ts` touches
// the terminal's own panel; this spec opens the server-room terminal in
// Chromium, scans a pass through its typed fallback (`keys=1`, `door=off`:
// no camera, no M4), and walks the heart by keys and clicks.
//
//   # a FRESH scratch server (build play + terminal first: it serves them)
//   node --experimental-strip-types --no-warnings scripts/sim/heart.ts --base http://127.0.0.1:7391 --code <mod>
//   # or straight through Playwright (the guard's y/N is SIM_YES=1 off a scratch server)
//   SIM_BASE=http://127.0.0.1:7391 SIM_MOD_CODE=<mod> SIM_SHOTS=/tmp/heart-shots \
//     pnpm --filter loom-app exec playwright test -c ../scripts/sim/playwright.config.ts heart
//
// Setup over HTTP (the sim's lib): Power On, two programs registered (the
// arrival's CAPTCHA, menus, Norton's scan, the tour), the cue chain to the
// Y2K clock (scripts/accept/chains.ts; no side taken: the majority's
// bundle would hand out the proofs), the door opened and shut (the heart
// open for a pass), two codex entries granted.
// Then eight checks, each a step with a screenshot at 1280x720 and 1024x600
// (SIM_SHOTS, default test-results/heart). `results.json` beside them holds
// each step's pass / fail and the option count of every menu walked.
//
// His voice is muted: `speechSynthesis` is a stub that "speaks" each chunk
// for SIM_SPEECH_MS_PER_CHAR ms a character (default 12) at volume 0, so the
// panel's LISTENING state is real and short. It lists no voices (as a
// browser still loading them does), so the terminal's own voice path runs.
//
// Before the scan the program DMs him from its phone; on a scratch server
// with no worker his hold line answers it 20 s later, mid-visit. The heart
// must never show (or say) a line answering a message from before the visit
// (`answers` at or below the last seq before the scan) nor the hold / busy
// text: steps 1 and 6 check the drawn thread's seqs against /api/history.
//
// Never on the night: it registers two programs and plays the heart. The
// codes stay in the environment, never in a screenshot's name, a step's
// note or results.json (redacted).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../../editor/node_modules/@playwright/test/index.mjs";
import type { Page, Request } from "../../editor/node_modules/@playwright/test/index.mjs";

import { TO_Y2K, pressChain } from "../accept/chains.ts";
import { Client, sleep } from "./lib/http.ts";
import { Recorder } from "./lib/report.ts";
import { doorsDecision } from "./lib/safety.ts";
import { pickPool, tolerating, SIM_SELF_PRESSED } from "./lib/plan.ts";
import { read, worldOf } from "./lib/world.ts";
import { boxInside, echoOf, heartGuard, occurrences, optionKey } from "./lib/terminal.ts";

const BASE = (process.env["SIM_BASE"] ?? "").replace(/\/$/u, "");
const MOD = process.env["SIM_MOD_CODE"] ?? "";
const SHOTS = process.env["SIM_SHOTS"] ?? "test-results/heart";
const MS_PER_CHAR = Number(process.env["SIM_SPEECH_MS_PER_CHAR"] ?? "12");
const ROOM = "The Server Room";
const DOOR_LABEL = "Terminal · Sim Heart Door";
const SIZES = [
  { width: 1280, height: 720 },
  { width: 1024, height: 600 },
] as const;
/** The phone (step 8's play app). */
const PHONE = { width: 390, height: 844 } as const;
/** The same menus before wave 27 (beats/server-room.loom at a3ed075a, the
 *  last story before `3332e01e feat(story): branch the first meeting`), for
 *  this program's state: marked, an upload problem on record, no side, no
 *  proof yet, His Question Of Force + Omnipotence held (w26 had no use for
 *  them), Night.her not Sandy. */
const PRE_W27: Record<string, number> = { "Layer One": 6, "Layer Two": 5, "Layer Two (asked two)": 4, "Layer Three": 5 };

interface Program {
  id: string;
  name: string;
  token: string;
}
interface StepResult {
  step: string;
  ok: boolean;
  notes: string[];
}

const results: StepResult[] = [];
const counts: Array<{ menu: string; options: number }> = [];

/** Codes and tokens this run holds: never in a note or results.json. */
const secrets = new Set<string>();
function keepSecret(s: string | undefined): void {
  if (s === undefined || s.length < 3) return;
  secrets.add(s);
  secrets.add(encodeURIComponent(s));
}
keepSecret(MOD);
function redact(text: string): string {
  let out = text;
  for (const x of [...secrets].sort((a, b) => b.length - a.length)) out = out.split(x).join("<redacted>");
  return out;
}

/** Trabolta's canned lines (`cast/trabolta.loom` hold: / busy:), said by the server for him: never on the heart's thread. */
const HOLD_TEXT = "Jean Trabolta is not responding";
const BUSY_TEXT = "Jean Trabolta is answering other programs";

// --------------------------------------------------------------------- HTTP

const http = new Client(BASE, new Recorder());
let mod = "";
const modState = async () => (await http.get<{ world: Array<{ path: string; value: string }>; roster: Array<{ id: string; name: string }>; phase?: string; title?: string }>("/api/state?role=mod", mod)).json;
const world = async () => worldOf((await modState()).world);
const signal = (name: string, extra: Record<string, unknown> = {}) => http.post<Record<string, unknown>>("/api/mod/signal", { name, ...extra }, mod);

async function must<T>(what: string, p: Promise<{ status: number; json: T }>): Promise<T> {
  const r = await p;
  if (r.status !== 200) throw new Error(`${what} → ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
  return r.json;
}

interface View {
  choices?: Array<{ id: number; beat: string; channel: string; options: string[] }>;
  answered?: number[];
}
const guestView = async (token: string) => (await http.get<View>("/api/state?role=guest", token)).json;
interface Msg {
  seq: number;
  kind: string;
  channel: string;
  from?: string;
  text?: string;
  pick?: boolean;
  act?: boolean;
  /** The seq of the line an agent reply / hold / busy line answers (wave 28). */
  answers?: number;
  widget?: { kind: string };
}
const history = async (token: string) => (await http.get<{ messages: Msg[] }>("/api/history", token)).json.messages ?? [];

async function widgetFor(token: string, kind: string): Promise<Msg | undefined> {
  const [h, v] = await Promise.all([history(token), guestView(token)]);
  const done = new Set(v.answered ?? []);
  return h.filter((m) => m.kind === "widget" && m.widget?.kind === kind && !done.has(m.seq)).at(-1);
}

/** Register a program and walk the arrival the way the evening's bots do. */
async function arrive(name: string, eventPass: string, deposit: number): Promise<Program> {
  const r = await must("register", http.post<{ id: string; token: string; name?: string }>("/api/guest/register", { passcode: eventPass, name }));
  const p: Program = { id: r.id, name: r.name ?? name, token: r.token };
  for (const passed of [true, false]) {
    const w = await widgetFor(p.token, "captcha");
    if (w !== undefined) await must("captcha", http.post("/api/guest/widget", { seq: w.seq, result: { passed } }, p.token));
  }
  for (let i = 0; i < 3; i++) {
    const m = (await guestView(p.token)).choices?.[0];
    if (m === undefined) break;
    const idx = m.options.length === 2 ? deposit : 0;
    await must(`menu ${m.beat}`, http.post("/api/guest/choose", { choice: m.id, index: idx, text: m.options[idx] }, p.token));
    const a = await widgetFor(p.token, "answer");
    if (a !== undefined) await must("deposit", http.post("/api/guest/widget", { seq: a.seq, result: { text: "my old screensaver password hint" } }, p.token));
  }
  await must("Norton scan", http.post("/api/scan", { target: p.id, as: "Norton Anti-Virus" }, mod));
  const t = await widgetFor(p.token, "tutorial");
  if (t !== undefined) await must("tutorial", http.post("/api/guest/widget", { seq: t.seq, result: { completed: true, steps: 5 } }, p.token));
  return p;
}

/** The door: opened once (The Heart), then shut: the heart waits for a pass. */
async function doorShut(): Promise<void> {
  const stage = read(await world(), "Night.heart_stage");
  if (stage === "sealed" || stage === "none") {
    await must("door opened", signal("door_sensor_opened", { args: { level: 30 }, label: DOOR_LABEL }));
    await sleep(500);
  }
  await must("door shut", signal("door_sensor_closed", { args: { level: 2400 }, label: DOOR_LABEL }));
}

// --------------------------------------------------------------------- the page

/** A muted `speechSynthesis`: the browser's own voices (real
 *  `SpeechSynthesisVoice`s, which a real utterance takes: the terminal's
 *  normal browser-voice path runs; none listed, it reads silently), each
 *  utterance "said" for a time that scales with its length, at volume 0. */
function speechStub(msPerChar: number): void {
  const real = (window as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  const realVoices = (): SpeechSynthesisVoice[] => {
    try {
      return real?.getVoices() ?? [];
    } catch {
      return [];
    }
  };
  const queue: SpeechSynthesisUtterance[] = [];
  let current: SpeechSynthesisUtterance | null = null;
  let timer = 0;
  const log: Array<[number, string, string]> = [];
  (window as unknown as { __simSpeech: typeof log }).__simSpeech = log;
  const fire = (u: SpeechSynthesisUtterance, kind: "onstart" | "onend") => {
    log.push([Math.round(performance.now()), kind, (u.text ?? "").slice(0, 40)]);
    const f = u[kind] as ((e: unknown) => void) | null;
    if (typeof f === "function") f.call(u, { utterance: u, charIndex: 0 });
  };
  const pump = () => {
    if (current !== null || queue.length === 0) return;
    const u = queue.shift()!;
    current = u;
    window.setTimeout(() => {
      if (current !== u) return;
      fire(u, "onstart");
      timer = window.setTimeout(() => {
        if (current !== u) return;
        current = null;
        fire(u, "onend");
        pump();
      }, Math.max(120, (u.text ?? "").length * msPerChar));
    }, 10);
  };
  const synth = {
    get speaking() {
      return current !== null;
    },
    get pending() {
      return queue.length > 0;
    },
    paused: false,
    onvoiceschanged: null,
    getVoices: realVoices,
    speak(u: SpeechSynthesisUtterance) {
      try {
        u.volume = 0;
      } catch {
        /* a read-only stub */
      }
      log.push([Math.round(performance.now()), "speak", (u.text ?? "").slice(0, 40)]);
      queue.push(u);
      pump();
    },
    cancel() {
      log.push([Math.round(performance.now()), "cancel", ""]);
      queue.length = 0;
      const c = current;
      current = null;
      window.clearTimeout(timer);
      if (c !== null) fire(c, "onend");
    },
    pause() {},
    resume() {},
    // The voice list loads late: its `voiceschanged` is the browser's own.
    addEventListener(type: string, fn: EventListener) {
      if (type === "voiceschanged") real?.addEventListener(type, fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      if (type === "voiceschanged") real?.removeEventListener(type, fn);
    },
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
}

const terminalUrl = () => `${BASE}/terminal/?code=${encodeURIComponent(MOD)}&room=${encodeURIComponent(ROOM)}&spot=server-room&door=off&keys=1&cam=0`;
const slug = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "").toLowerCase().slice(0, 40);

/** Screenshots of this moment at both sizes (back at 1280x720 after). */
async function shots(page: Page, n: number, what: string, atEach?: (size: { width: number; height: number }) => Promise<void>): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(350);
    if (atEach !== undefined) await atEach(size);
    await page.screenshot({ path: join(SHOTS, `${String(n).padStart(2, "0")}-${slug(what)}-${size.width}x${size.height}.png`) });
  }
  await page.setViewportSize(SIZES[0]);
}

async function wake(page: Page): Promise<void> {
  const w = page.locator("button.wake");
  if (await w.isVisible().catch(() => false)) await w.click();
}

/** Scan a pass the keyboard way: the typed fallback, the program's id, CONNECT. */
async function scan(page: Page, p: Program): Promise<void> {
  await wake(page);
  // The room may still be speaking (The Heart, Heart Sealed): the box says so; the typed field still works.
  const field = page.getByPlaceholder("your program name");
  if (!(await field.isVisible().catch(() => false))) await page.locator(".scan-box-typed").click();
  await field.fill(p.id);
  await page.getByRole("button", { name: "CONNECT" }).click();
  await expect(page.locator(".bar-right .pilot")).toContainText(p.name.toUpperCase(), { timeout: 15_000 });
}

const panel = (page: Page) => page.locator(".heart-panel");
const threadTexts = (page: Page) => page.locator(".thread .line .text").allInnerTexts();
const mineTexts = (page: Page) => page.locator(".thread .line.mine .text").allInnerTexts();
/** The thread's drawn lines with their seqs (`data-seq`). */
const threadRows = (page: Page) =>
  page.locator(".thread .line[data-seq]").evaluateAll((els) => els.map((e) => ({ seq: Number(e.getAttribute("data-seq")), text: e.querySelector(".text")?.textContent ?? "" })));

/**
 * The heart shows nothing that answers a message from before the visit (his
 * reply, hold or busy line to a phone DM, `answers` <= `before`) and never
 * the hold / busy text. Returns how many such answers the phone's
 * dm:Trabolta holds (they belong there).
 */
async function noPreVisitAnswers(page: Page, p: Program, before: number, what: string): Promise<number> {
  const rows = await threadRows(page);
  const answers = (await history(p.token)).filter((m) => m.channel === "dm:Trabolta" && m.answers !== undefined && m.answers <= before);
  const bad = new Set(answers.map((m) => m.seq));
  expect(rows.filter((r) => bad.has(r.seq)).map((r) => r.text.slice(0, 60)), `${what}: his answers to messages from before the visit`).toEqual([]);
  expect(rows.filter((r) => r.text.includes(HOLD_TEXT) || r.text.includes(BUSY_TEXT)).map((r) => r.text.slice(0, 60)), `${what}: the hold / busy line on the heart`).toEqual([]);
  return answers.length;
}

/** The answer (the hold line, on a server with no worker) to a phone DM, landed on the phone: up to `ms`. */
async function preVisitAnswerLanded(p: Program, before: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    if ((await history(p.token)).some((m) => m.channel === "dm:Trabolta" && m.answers !== undefined && m.answers <= before)) return true;
    if (Date.now() > until) return false;
    await sleep(1000);
  }
}

/** The docked panel, open (taking picks): its menu id and options (raw). */
async function openPanel(page: Page, timeout = 45_000): Promise<{ id: string; options: string[] }> {
  await expect(panel(page)).toHaveAttribute("data-open", "true", { timeout });
  const id = (await panel(page).getAttribute("data-menu")) ?? "";
  const options = await panel(page).locator(".heart-option").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  return { id, options };
}

const fold = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
function indexOf(options: readonly string[], fragment: string): number {
  const tag = /^⟦(.+)⟧$/u.exec(fragment);
  if (tag !== null) return options.findIndex((o) => fold(o).startsWith(fold(`⟦${tag[1]}⟧`)));
  return options.findIndex((o) => fold(o).includes(fold(fragment)));
}

/** Pick an option by text (key or click); waits for the next menu to dock (a new id), unless `wait` is false. */
async function pick(page: Page, fragment: string, how: "key" | "click", wait = true): Promise<{ text: string; from: string }> {
  const { id, options } = await openPanel(page);
  const i = indexOf(options, fragment);
  if (i < 0) throw new Error(`"${fragment}" is not on the menu (${options.map((o) => o.slice(0, 24)).join(" | ")})`);
  if (how === "key") await page.keyboard.press(optionKey(i)!);
  else await panel(page).locator(".heart-option").nth(i).click();
  if (wait) await expect(panel(page)).not.toHaveAttribute("data-menu", id, { timeout: 30_000 });
  return { text: options[i]!, from: id };
}

async function record(page: Page, menu: string): Promise<string[]> {
  const { options } = await openPanel(page);
  counts.push({ menu, options: options.length });
  return options;
}

async function step(n: number | string, name: string, body: (notes: string[]) => Promise<void>): Promise<void> {
  const notes: string[] = [];
  await test.step(`${n}. ${name}`, async () => {
    try {
      await body(notes);
      results.push({ step: `${n}. ${name}`, ok: true, notes });
    } catch (e) {
      notes.push(redact(String((e as Error).message ?? e).split("\n")[0]!).slice(0, 300));
      results.push({ step: `${n}. ${name}`, ok: false, notes });
      throw e;
    }
  });
}

function writeResults(): void {
  writeFileSync(join(SHOTS, "results.json"), redact(`${JSON.stringify({ results, counts, preW27: PRE_W27 }, null, 2)}\n`));
}

// --------------------------------------------------------------------- the visit

test("the heart terminal: one visit, as a program", async ({ browser }) => {
  test.skip(BASE === "" || MOD === "", "set SIM_BASE and SIM_MOD_CODE");
  test.skip((process.env["SIM_BEAT_FILE"] ?? "") !== "", "the evening's browser companion run (SIM_BEAT_FILE) is browser.spec.ts's");
  test.setTimeout(Number(process.env["SIM_MINUTES"] ?? "12") * 60_000);
  mkdirSync(SHOTS, { recursive: true });

  // --- sign in, guard, a fresh night -------------------------------------------------
  const r = await http.call<{ eventId?: string }>("POST", "/api/resolve-code", { body: { code: MOD }, root: true });
  if (r.status === 200 && r.json.eventId !== undefined && r.json.eventId !== "default") http.scope = `/e/${encodeURIComponent(r.json.eventId)}`;
  mod = (await must("mod login", http.post<{ token: string }>("/api/mod/login", { passcode: MOD }))).token;
  keepSecret(mod);
  const before = await modState();
  const g = heartGuard({ base: BASE, roster: before.roster, yes: process.env["SIM_YES"] === "1", live: process.env["SIM_LIVE"] === "1" });
  if (!g.ok) throw new Error(`guard: ${g.reason}`);
  const doors = doorsDecision(before.phase, read(worldOf(before.world), "Night.step"));
  if (doors.kind === "refuse") throw new Error(`${doors.why}: the heart spec needs a fresh night (a fresh scratch server)`);
  if (doors.kind === "start") await must("Power On", http.post("/api/mod/start", {}, mod));
  const codes = await must("codes", http.post<{ eventPass: string }>("/api/mod/codes", {}, mod));
  keepSecret(codes.eventPass);

  const taken = new Set(before.roster.map((x) => x.name.toLowerCase()));
  const [nameA, nameB] = pickPool(2, taken);
  const A = await arrive(nameA!, codes.eventPass, 1);
  const B = await arrive(nameB!, codes.eventPass, 0);
  keepSecret(A.token);
  keepSecret(B.token);

  const chain = await pressChain(TO_Y2K, tolerating(async (name) => (await signal(name)).json, SIM_SELF_PRESSED, []), () => {});
  if (!chain.ok) throw new Error(`the chain to the Y2K clock stopped at ${chain.refused.at(-1)}`);
  // No side is taken: the majority's bundle (The Whole Truth) hands out
  // every codex entry, the proofs too, and the proof must come mid-talk.
  // His files for the Evidence sub-menu (the proof itself comes mid-talk, step 5).
  for (const entry of ["The Question Of Force", "Omnipotence"]) await must(`codex ${entry}`, http.post("/api/mod/codex", { who: A.id, entry }, mod));
  await doorShut();

  // Before the visit: the program DMs him from its phone (lines the heart must not show).
  const nonce = Date.now().toString(36).slice(-5);
  const phoneDms = [`phone dm one ${nonce}: are you there?`, `phone dm two ${nonce}: the hum is loud`, `phone dm three ${nonce}: I am coming down`];
  for (const t of phoneDms) {
    await must("phone DM", http.post("/api/guest/say", { channel: "dm:Trabolta", text: t }, A.token));
    await sleep(400);
  }
  const phone = await history(A.token);
  expect(phone.filter((m) => m.channel === "dm:Trabolta" && phoneDms.includes(m.text ?? "")).length, "the phone DMs landed").toBe(3);
  // Every line before the scan: an answer to any of them is not this visit's.
  const beforeVisit = phone.reduce((m, x) => Math.max(m, x.seq), -1);

  // --- the terminal ---------------------------------------------------------------
  const ctx = await browser.newContext({ viewport: SIZES[0] });
  await ctx.addInitScript(speechStub, MS_PER_CHAR);
  const page = await ctx.newPage();
  const chooses: Request[] = [];
  page.on("request", (q) => {
    if (q.method() === "POST" && q.url().includes("/api/guest/choose")) chooses.push(q);
  });
  await page.goto(terminalUrl());
  await wake(page);
  await expect(page.locator(".scan-box")).toBeVisible({ timeout: 30_000 });

  try {
    // 1 ---------------------------------------------------------------------------
    // What step 2 judges is seen here, while his opening is said (the panel LISTENING).
    const listening = { seen: false, wait: "", probed: false, keySent: false, clickable: false };
    await step(1, "on scan the thread shows only this visit", async (notes) => {
      await scan(page, A);
      const p = panel(page);
      await expect(p).toBeVisible({ timeout: 30_000 });
      if ((await p.getAttribute("data-open")) === "false") {
        listening.seen = true;
        listening.wait = (await p.getAttribute("data-wait")) ?? "?";
        await expect(p.locator(".heart-head-wait")).toContainText("LISTENING");
        await shots(page, 2, "listening");
        // While his opening is said the panel waits: no pick goes out, by key or click.
        const sent = chooses.length;
        if ((await p.getAttribute("data-open")) === "false") {
          await page.keyboard.press("1");
          await page.waitForTimeout(400);
          listening.probed = true;
          listening.keySent = chooses.length !== sent;
          listening.clickable = !(await p.locator(".heart-option").first().isDisabled());
        }
      }
      // Settled: his opening said and the panel open, then the thread is read.
      await openPanel(page);
      await expect(page.locator(".thread .line.theirs").first()).toBeVisible({ timeout: 30_000 });
      const lines = await threadTexts(page);
      const leaked = phoneDms.filter((d) => lines.some((l) => l.includes(nonce) && l.includes(d.slice(0, 12))));
      expect(leaked, "earlier phone DMs on the heart terminal").toEqual([]);
      const answered = await noPreVisitAnswers(page, A, beforeVisit, "on scan");
      await expect(page.locator(".thread .line.earlier")).toHaveCount(1);
      notes.push(`${lines.length} lines this visit, the earlier-messages rule shown; ${answered} answer(s) to the phone DMs on the phone, none here`);
      await shots(page, 1, "scan-this-visit-only");
    });

    // 2 ---------------------------------------------------------------------------
    let layerOne: string[] = [];
    await step(2, "LISTENING while he speaks; then every option visible, keyed 1-9", async (notes) => {
      const p = panel(page);
      const voices = await page.evaluate(() => window.speechSynthesis.getVoices().length);
      const textOnly = await page.getByText("no voice on this device").isVisible().catch(() => false);
      notes.push(`${voices} browser voices, ${textOnly ? "text only (silent engine)" : "the browser voice path"}`);
      if (voices > 0) expect(textOnly, "voices listed, yet the terminal reads text only").toBe(false);
      if (listening.seen) notes.push(`waiting on ${listening.wait}`);
      else notes.push("the panel was already open when first seen (his opening was short)");
      expect(listening.seen, "the panel was seen LISTENING before it opened").toBe(true);
      if (listening.probed) {
        expect(listening.keySent, "a key while he speaks sent a pick").toBe(false);
        expect(listening.clickable, "an option takes a click while he speaks").toBe(false);
      }
      layerOne = await record(page, "Layer One");
      expect(layerOne.length).toBeLessThanOrEqual(9);
      const keys = await p.locator(".heart-num").allInnerTexts();
      expect(keys).toEqual(layerOne.map((_, i) => optionKey(i)));
      await shots(page, 2, "menu-open", async (size) => {
        await expect(p).toHaveAttribute("data-open", "true");
        const list = await p.locator(".heart-list").boundingBox();
        const boxes = await p.locator(".heart-option").evaluateAll((els) => els.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }));
        const out = boxes.filter((b) => !boxInside(b, size, list));
        expect(out.length, `options clipped at ${size.width}x${size.height}`).toBe(0);
        await expect(p.locator(".heart-more")).toHaveCount(0);
        notes.push(`${boxes.length} options inside ${size.width}x${size.height}`);
      });
      const speech = await page.evaluate(() => (window as unknown as { __simSpeech?: unknown }).__simSpeech ?? []);
      writeFileSync(join(SHOTS, "speech-log-step2.json"), `${JSON.stringify(speech)}\n`);
    });

    // 3 ---------------------------------------------------------------------------
    const pickOne = "I'm a program.";
    await step(3, "a pick shows at once (pending), then exactly once", async (notes) => {
      await openPanel(page);
      const echo = echoOf(layerOne[indexOf(layerOne, pickOne)]!).text;
      // Hold the pick's POST a moment so the pending line is visible on any wifi.
      let release: () => void = () => {};
      const held = new Promise<void>((res) => (release = res));
      await page.route("**/api/guest/choose", async (route) => {
        await held;
        await route.continue();
      });
      const done = pick(page, pickOne, "key");
      const pending = page.locator(".thread .line.mine.echo.pending");
      await expect(pending).toHaveCount(1, { timeout: 3000 });
      await expect(pending.locator(".text")).toHaveText(echo);
      await expect(pending.locator(".who")).toHaveText("YOU");
      await shots(page, 3, "pick-pending");
      release();
      await done;
      await page.unroute("**/api/guest/choose");
      await expect(pending).toHaveCount(0, { timeout: 15_000 });
      await page.waitForTimeout(1500);
      expect(occurrences(await mineTexts(page), echo), "the pick's line, after the server's").toBe(1);
      notes.push(`"${echo}" pending, then once`);
      await shots(page, 3, "pick-once");
    });

    // 4 ---------------------------------------------------------------------------
    await step(4, "walk Layer One, Two, Three, Evidence, BACK, Reasons, BACK", async (notes) => {
      await record(page, "Layer Two");
      await pick(page, "What are you, really?", "key");
      await pick(page, "Why do you need the theory", "click");
      await record(page, "Layer Two (asked two)");
      await pick(page, "Then listen to me.", "key");
      await record(page, "Layer Three");
      await shots(page, 4, "layer-three");
      await pick(page, "⟦SHOW HIM⟧", "key");
      const ev = await record(page, "Evidence");
      expect(indexOf(ev, "⟦FORCE⟧")).toBeGreaterThanOrEqual(0);
      expect(indexOf(ev, "⟦SMALL TYPE⟧")).toBeGreaterThanOrEqual(0);
      await shots(page, 4, "evidence");
      await pick(page, "⟦BACK⟧", "click");
      await record(page, "Layer Three (back)");
      await pick(page, "⟦TELL HIM⟧", "key");
      const rs = await record(page, "Reasons");
      expect(indexOf(rs, "Your theory is wrong")).toBeGreaterThanOrEqual(0);
      await shots(page, 4, "reasons");
      await pick(page, "⟦BACK⟧", "key");
      const three = await record(page, "Layer Three (back again)");
      for (const c of counts) expect(c.options, `${c.menu} has more than 9 options`).toBeLessThanOrEqual(9);
      notes.push(counts.map((c) => `${c.menu} ${c.options}`).join(", "));
      expect(indexOf(three, "⟦PROOF⟧"), "no proof yet").toBe(-1);
    });

    // 5 ---------------------------------------------------------------------------
    await step(5, "a proof granted mid-talk appears in the docked menu", async (notes) => {
      const { id } = await openPanel(page);
      await must("codex The Sandy File", http.post("/api/mod/codex", { who: A.id, entry: "The Sandy File" }, mod));
      await expect(panel(page).locator(".heart-option", { hasText: "Show him the Sandy File" })).toHaveCount(1, { timeout: 10_000 });
      await expect(panel(page)).toHaveAttribute("data-menu", id);
      notes.push(`⟦PROOF⟧ joined menu ${id} in place`);
      await shots(page, 5, "proof-docked");
      // The deed reads in brackets (step 3's deed check) and its scene holds the panel.
      const deed = echoOf("⟦PROOF⟧ Show him the Sandy File.").text;
      await pick(page, "⟦PROOF⟧", "click", false);
      await expect(page.locator(".thread .line.mine .text", { hasText: deed })).toHaveCount(1, { timeout: 15_000 });
      expect(deed).toMatch(/^\[shows /u);
      await expect(panel(page)).toHaveAttribute("data-wait", "scene", { timeout: 15_000 });
      notes.push(`deed "${deed}"; the proof scene held the panel (LISTENING)`);
      await shots(page, 5, "proof-scene");
      await expect(page.locator(".thread .line.mine.act .text", { hasText: deed })).toHaveCount(1);
      // One more point opens the talk's natural end (wave 58).
      await pick(page, "⟦SHOW HIM⟧", "key");
      await pick(page, "⟦FORCE⟧", "key");
      await expect(panel(page).locator(".heart-option", { hasText: "That's all I came to say." })).toHaveCount(1, { timeout: 10_000 });
      await shots(page, 5, "the-end-offered");
    });

    // 4b: every layer menu offers more than the pre-w27 heart did (counts in results.json).
    await step("4b", "the menus against the pre-w27 heart", async (notes) => {
      for (const [menu, before] of Object.entries(PRE_W27)) {
        const now = counts.find((c) => c.menu === menu)?.options;
        expect(now, `${menu} was walked`).toBeDefined();
        expect(now!, `${menu}: ${now} options now, ${before} before wave 27`).toBeGreaterThan(before);
        notes.push(`${menu} ${before} → ${now}`);
      }
      notes.push(`new sub-menus: Evidence ${counts.find((c) => c.menu === "Evidence")?.options}, Reasons ${counts.find((c) => c.menu === "Reasons")?.options}`);
    });

    // 6 ---------------------------------------------------------------------------
    await step(6, "a reload mid-visit keeps this visit (his lines, the picks)", async (notes) => {
      const beforeLines = await threadTexts(page);
      const his = (await page.locator(".thread .line.theirs .text").allInnerTexts()).filter((t) => t.length > 20);
      const picks = await page.locator(".thread .line.mine.echo .text").allInnerTexts();
      await page.reload();
      await expect(page.locator(".scan-box")).toBeVisible({ timeout: 30_000 });
      await scan(page, A);
      await expect(page.locator(".thread .line.theirs").first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(2500);
      const after = await threadTexts(page);
      const lostHis = his.filter((t) => !after.some((a) => a.includes(t.slice(0, 40))));
      const lostPicks = picks.filter((t) => !after.includes(t));
      expect(lostHis, "his lines from before the reload").toEqual([]);
      expect(lostPicks, "this visit's picks from before the reload").toEqual([]);
      expect(after.filter((l) => l.includes(nonce)), "phone DMs after the reload").toEqual([]);
      // By now (minutes past the DMs) his hold line answered them on the phone: never here.
      const landed = await preVisitAnswerLanded(A, beforeVisit, 25_000);
      expect(landed, "an answer to the phone DMs (the hold line, or his reply) reached the phone").toBe(true);
      const answered = await noPreVisitAnswers(page, A, beforeVisit, "after the reload");
      notes.push(`${beforeLines.length} lines before, ${after.length} after; ${picks.length} picks kept; ${answered} answer(s) to the phone DMs on the phone, none here`);
      await shots(page, 6, "after-reload");
    });

    // 8 (before 7: the program's own visit ends first) --------------------------------
    await step(8, "the phone's dm:Trabolta shows the heart picks as the program's own", async (notes) => {
      const msgs = (await history(A.token)).filter((m) => m.channel === "dm:Trabolta");
      const mine = msgs.filter((m) => m.pick === true && m.from === A.name).map((m) => m.text ?? "");
      for (const want of [echoOf(layerOne[indexOf(layerOne, pickOne)]!).text, "What are you, really?", echoOf("⟦PROOF⟧ Show him the Sandy File.").text]) {
        expect(mine, `the phone thread holds "${want}"`).toContain(want);
      }
      expect(msgs.filter((m) => m.pick === true && m.from === A.name && m.act === true).length).toBeGreaterThanOrEqual(1);
      // The phone itself: the play app, signed in as the program, open on dm:Trabolta.
      const eventId = http.scope.startsWith("/e/") ? decodeURIComponent(http.scope.slice(3)) : "default";
      const phoneCtx = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true });
      try {
        await phoneCtx.addInitScript((g) => {
          try {
            if (localStorage.getItem("loom.guest") === null) localStorage.setItem("loom.guest", JSON.stringify(g));
          } catch {
            /* a blocked store: the page shows the join screen and the count fails */
          }
        }, { id: A.id, name: A.name, token: A.token, eventId });
        const phonePage = await phoneCtx.newPage();
        await phonePage.goto(`${BASE}/?room=${encodeURIComponent("dm:Trabolta")}`);
        const bubbles = phonePage.locator(".msg.line .bubble");
        await expect(bubbles.filter({ hasText: echoOf(layerOne[indexOf(layerOne, pickOne)]!).text }).first()).toBeAttached({ timeout: 30_000 });
        await phonePage.waitForTimeout(1500);
        const drawn = (await bubbles.evaluateAll((els) => els.map((e) => (e.querySelector(".stream-sr") ?? e).textContent ?? ""))).map((t) => fold(t));
        // Each pick line as often on the screen as in the thread (a BACK picked twice is two lines).
        const want = new Map<string, number>();
        for (const t of mine) want.set(fold(t), (want.get(fold(t)) ?? 0) + 1);
        const off: string[] = [];
        let onScreen = 0;
        for (const [t, n] of want) {
          const got = drawn.filter((d) => d === t).length;
          onScreen += Math.min(got, n);
          if (got !== n) off.push(`"${t.slice(0, 30)}" ${got}/${n}`);
        }
        await phonePage.screenshot({ path: join(SHOTS, `08-phone-dm-trabolta-${PHONE.width}x${PHONE.height}.png`) });
        expect(off, "pick lines on the phone's screen vs its thread").toEqual([]);
        notes.push(`${mine.length} pick lines from ${A.name} in the phone's thread (/api/history), ${onScreen} drawn in the play app's dm:Trabolta`);
      } finally {
        await phoneCtx.close();
      }
    });

    // 7 ---------------------------------------------------------------------------
    await step(7, "thrown out, then re-scanned at once: a fresh thread", async (notes) => {
      // A normal DISCONNECT, then A again at once: nothing of A's visit carries over.
      const aRows = await threadRows(page);
      expect(aRows.length, "A's visit had lines").toBeGreaterThan(0);
      const aSeqs = new Set(aRows.map((r) => r.seq));
      await page.getByRole("button", { name: "DISCONNECT" }).click();
      await expect(page.locator(".scan-box")).toBeVisible({ timeout: 15_000 });
      await scan(page, A);
      await expect(page.locator(".thread")).toBeVisible({ timeout: 10_000 });
      await page.locator(".thread .line.theirs").first().waitFor({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const again = await threadRows(page);
      expect(await page.locator(".thread .line").count(), "A's re-scan draws its thread").toBeGreaterThan(0);
      expect(again.filter((r) => aSeqs.has(r.seq)).map((r) => r.text.slice(0, 40)), "A's earlier visit on its re-scan").toEqual([]);
      notes.push(`A re-scanned: ${again.length} line(s), none of its last visit's ${aSeqs.size}`);
      await shots(page, 7, "a-rescan-fresh");
      if (await page.getByRole("button", { name: "DISCONNECT" }).isVisible().catch(() => false)) await page.getByRole("button", { name: "DISCONNECT" }).click();
      await expect(page.locator(".scan-box")).toBeVisible({ timeout: 15_000 });
      await doorShut();
      await scan(page, B);
      const first = await pick(page, "Someone who admires your work.", "key");
      const bLines: string[] = [echoOf(first.text).text];
      // Every line of this visit, as it stands before each threat (the thread goes when the line ends).
      const visitLines = new Set<string>(bLines);
      const bSeqs = new Set<number>();
      const keep = async () => {
        for (const t of await threadTexts(page).catch(() => [] as string[])) if (t.trim().length > 12 && !t.includes("earlier messages")) visitLines.add(t.trim());
        for (const r of await threadRows(page).catch(() => [] as Array<{ seq: number }>)) bSeqs.add(r.seq);
      };
      for (let i = 0; i < 8; i++) {
        await keep();
        const flash = page.locator(".flash", { hasText: "ACCESS TO THE HEART TERMINATED" });
        if (await flash.isVisible().catch(() => false)) break;
        const { options } = await openPanel(page, 30_000).catch(() => ({ id: "", options: [] as string[] }));
        if (indexOf(options, "I could pull your cables") < 0) break;
        const t = await pick(page, "I could pull your cables", "key", false);
        bLines.push(echoOf(t.text).text);
        await page.waitForTimeout(1200);
        await expect(panel(page).or(page.locator(".flash"))).toBeVisible({ timeout: 30_000 }).catch(() => {});
      }
      await expect(page.locator(".flash", { hasText: "ACCESS TO THE HEART TERMINATED" })).toBeVisible({ timeout: 60_000 });
      notes.push(`thrown out after ${bLines.length - 1} threats`);
      await shots(page, 7, "thrown-out");
      // At once: the barred program's re-scan (Heart Barred, his eject again).
      await scan(page, B);
      await expect(page.locator(".thread")).toBeVisible({ timeout: 10_000 });
      await page.locator(".thread .line.theirs").first().waitFor({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(800);
      const fresh = await threadTexts(page);
      const freshRows = await threadRows(page);
      await shots(page, 7, "rescan-fresh");
      expect(await page.locator(".thread .line").count(), "the re-scan draws its thread").toBeGreaterThan(0);
      const carried = fresh.filter((l) => visitLines.has(l.trim()));
      expect(carried, "the previous visit's lines on a re-scan").toEqual([]);
      expect(freshRows.filter((r) => bSeqs.has(r.seq)).length, "the previous visit's seqs on a re-scan").toBe(0);
      notes.push(`re-scan thread: ${fresh.length} line(s), ${freshRows.filter((r) => r.text.length > 0).length} drawn, none of the last visit's ${visitLines.size}`);
    });
  } finally {
    writeResults();
    const speech = await page.evaluate(() => (window as unknown as { __simSpeech?: unknown }).__simSpeech ?? []).catch(() => []);
    writeFileSync(join(SHOTS, "speech-log.json"), `${JSON.stringify(speech)}\n`);
    await ctx.close();
  }
});
