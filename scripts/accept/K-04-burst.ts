// K-04 acceptance helper (SW-AI-23): Trabolta under a DM burst.
//
//   node --no-warnings scripts/accept/K-04-burst.ts --code <MOD code> \
//        [--url https://app.mapsandducks.com] [--dms 30] [--spread 0] \
//        [--timeout 300] [--character Trabolta] [--yes] [--reset-after] [--out k04.json]
//
// About 30 guests answer Trabolta's private hello inside a minute, and the
// worker voices one reply at a time (2–6 s each, plus orchestrator calls).
// This sends `--dms` DMs at once (or spread over `--spread` seconds), each
// from its own director persona ("K04 Bot …", `POST /api/mod/persona` →
// `POST /api/mod/say {channel: "dm:Trabolta", as}` — the same agent request
// a guest's DM makes), then times every bot's first REAL reply on the mod
// feed (`/events?role=mod&lean=1`). The hold line (`hold:` in
// cast/trabolta.loom, posted by the server after 20 s with no worker) is
// counted apart: it means nobody was voicing him. So are the worker's own
// canned lines from trabolta.persona.md — `fallback:` (the model failed,
// timed out or said nothing usable: the overload this test is for) and
// `unavailable:` (his `when: self.awake == true` gate is closed — before
// introduce_trabolta, or after an ending put him to sleep).
//
// RUN IT ON A REHEARSAL, with the agents worker on the house Mac connected
// and Trabolta introduced (`introduce_trabolta`; before that he's hidden and
// the DMs are refused). It refuses a roster with real guests
// (`live-guard.ts`, `--i-know-this-is-live` overrides) and asks y/N
// (`--yes` skips; localhost doesn't ask). The bots' DMs reach his mind:
// press Reset on Run → Mind afterwards, and Restart in Run (or pass
// `--reset-after`) to clear the bots.
//
// Pass: ≥ 90 % of the bots got a real reply before `--timeout` (default
// 300 s — the hub times a request out at 2 min and retries once). Paste the
// printed `record:` line into SW-AI-23 (CHECKLIST.md). Node ≥ 22.6 (type
// stripping); no dependencies. The pure half is `burst.ts`
// (`node --no-warnings --test scripts/accept/burst.test.ts`).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BurstClock, personaLines, recordLine, type CannedLines, type FeedMessage } from "./burst.ts";
import { judge, liveGuard, LIVE_OVERRIDE, type GuardRow } from "./live-guard.ts";

// ---------------------------------------------------------------- args

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v !== undefined && !v.startsWith("--")) return v;
  if (fallback !== undefined) return fallback;
  console.error(`missing --${name}\n\nusage: node --no-warnings scripts/accept/K-04-burst.ts --code <MOD code> [--url https://app.mapsandducks.com] [--dms 30]`);
  process.exit(2);
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const num = (name: string, fallback: number) => {
  const n = Number(arg(name, String(fallback)));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const base = arg("url", process.env.BASE ?? process.env.LOOM_SERVER ?? "https://app.mapsandducks.com").replace(/\/$/u, "");
const modCode = arg("code", process.env.MOD_CODE ?? process.env.LOOM_MOD_CODE);
const dms = Math.max(1, Math.round(num("dms", 30)));
const spread = num("spread", 0);
const timeoutS = num("timeout", 300);
const character = arg("character", "Trabolta");
const outFile = arg("out", "");
const local = /^https?:\/\/(localhost|127\.|\[::1\])/u.test(base);
// Names are exclusive per event: tag each run so a rerun never collides.
const RUN = Math.floor(Math.random() * 46656).toString(36).padStart(3, "0");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The hold line, so it isn't mistaken for an answer.
const here = dirname(fileURLToPath(import.meta.url));
let hold: string | null = null;
try {
  const cast = readFileSync(join(here, "../../core/examples/trapped-in-the-internet/cast/trabolta.loom"), "utf8");
  hold = /^\s+hold:\s*(.+?)\s*$/mu.exec(cast)?.[1]?.replace(/^"|"$/gu, "") ?? null;
} catch {
  /* another show: every reply counts */
}
// The worker's canned lines, so a fast fallback isn't mistaken for one either.
let canned: CannedLines = {};
try {
  canned = personaLines(readFileSync(join(here, "../../core/examples/trapped-in-the-internet/trabolta.persona.md"), "utf8"));
} catch {
  /* no persona file: only the hold line is set apart */
}

// What programs say back to his private hello (varied, so the voice has to work).
const LINES = [
  "hi trabolta",
  "Who are you?",
  "What happens if I stay in the computer?",
  "I think Clippy is lying to us.",
  "Are you the one who uploaded me?",
  "Can you get me out of here?",
  "What is the truth?",
  "I'm Winamp. I really whip the llama's ass.",
  "Why did you bring us here?",
  "Do you trust me?",
];

// ---------------------------------------------------------------- http

let scope = "";
async function call<T = Record<string, unknown>>(method: "GET" | "POST", path: string, opts: { token?: string; body?: unknown; root?: boolean } = {}): Promise<{ status: number; json: T }> {
  try {
    const r = await fetch(`${base}${opts.root === true ? "" : scope}${path}`, {
      method,
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.token !== undefined ? { "x-loom-token": opts.token } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await r.text();
    let json = {} as T;
    try {
      json = JSON.parse(text) as T;
    } catch {
      /* not JSON */
    }
    return { status: r.status, json };
  } catch {
    return { status: 0, json: {} as T };
  }
}

// ---------------------------------------------------------------- connect

const resolved = await call<{ eventId?: string; role?: string; error?: string }>("POST", "/api/resolve-code", { body: { code: modCode }, root: true });
if (resolved.status !== 200) throw new Error(`resolve-code → ${resolved.status} ${resolved.json.error ?? ""} (is --code the event's MOD code?)`);
if (resolved.json.role !== "mod") throw new Error(`that is the event's ${resolved.json.role} code — pass the MOD code`);
scope = resolved.json.eventId === "default" || resolved.json.eventId === undefined ? "" : `/e/${encodeURIComponent(resolved.json.eventId)}`;
const login = await call<{ token?: string; error?: string }>("POST", "/api/mod/login", { body: { passcode: modCode } });
if (login.json.token === undefined) throw new Error(`mod login → ${login.status} ${login.json.error ?? ""}`);
const token = login.json.token;

type ModState = { phase?: string; title?: string; roster?: GuardRow[]; cast?: Array<{ id: string; agent?: boolean; online?: boolean }> };
const state = await call<ModState>("GET", "/api/state?role=mod", { token });
await liveGuard({ title: state.json.title, where: `${base}${scope || " (default event)"}`, roster: state.json.roster, action: `send ${dms} DMs to ${character}`, local });
const member = state.json.cast?.find((c) => c.id === character);
if (member === undefined) throw new Error(`no character ${character} in this story`);
if (member.agent !== true) console.warn(`  ⚠ ${character} is not agent-voiced (mind: external) — nothing will answer.`);
else if (member.online !== true) console.warn(`  ⚠ no worker is voicing ${character} right now — expect only hold lines (start the agents module first).`);
if (state.json.phase !== "open") console.warn(`  ⚠ the event is ${state.json.phase ?? "not open"} — open the doors first or the DMs are refused.`);

// ---------------------------------------------------------------- the feed

const clock = new BurstClock(character, hold, canned);
const stop = new AbortController();
let feedUp = false;
async function feed(): Promise<void> {
  while (!stop.signal.aborted) {
    try {
      const r = await fetch(`${base}${scope}/events?role=mod&id=k04&lean=1`, {
        headers: { "x-loom-token": token, accept: "text/event-stream" },
        signal: stop.signal,
      });
      if (!r.ok || r.body === null) throw new Error(`feed → ${r.status}`);
      feedUp = true;
      const dec = new TextDecoder();
      let buf = "";
      for await (const chunk of r.body) {
        const at = performance.now();
        buf += dec.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (!/^event: message$/mu.test(frame)) continue;
          const d = frame.indexOf("data: ");
          try {
            const m = JSON.parse(frame.slice(d + 6)) as FeedMessage;
            clock.seen(m, at);
          } catch {
            /* torn frame */
          }
        }
      }
    } catch {
      if (stop.signal.aborted) return;
      feedUp = false;
      await sleep(1000);
    }
  }
}
const feeding = feed();
for (let i = 0; i < 50 && !feedUp; i++) await sleep(100);
if (!feedUp) throw new Error("the mod feed did not connect");

// ---------------------------------------------------------------- bots

console.log(`  making ${dms} bots…`);
const bots: string[] = [];
for (let i = 0; i < dms; i++) {
  const r = await call<{ guest?: { id: string } | null; error?: string }>("POST", "/api/mod/persona", { token, body: { name: `K04 Bot ${RUN} ${String(i + 1).padStart(2, "0")}` } });
  if (r.json.guest == null) throw new Error(`persona → ${r.status} ${r.json.error ?? ""}`);
  bots.push(r.json.guest.id);
}
await sleep(1000); // let the joins settle (the story moves each one on)

console.log(`  sending ${dms} DMs to ${character}${spread > 0 ? ` over ${spread} s` : " at once"}…`);
const refused = new Map<string, number>();
const t0 = performance.now();
await Promise.all(
  bots.map(async (bot, i) => {
    if (spread > 0) await sleep((spread * 1000 * i) / Math.max(1, bots.length - 1));
    clock.sent(bot, performance.now());
    const r = await call<{ error?: string }>("POST", "/api/mod/say", { token, body: { channel: `dm:${character}`, text: LINES[i % LINES.length], as: bot } });
    if (r.status !== 200) {
      const why = `${r.status} ${r.json.error ?? ""}`.trim();
      refused.set(why, (refused.get(why) ?? 0) + 1);
    }
  }),
);
for (const [why, n] of refused) console.error(`  ✘ ${n} DM(s) refused: ${why}`);

const deadline = t0 + spread * 1000 + timeoutS * 1000;
let lastPrint = 0;
while (clock.outstanding().length > 0 && performance.now() < deadline) {
  await sleep(500);
  const now = performance.now();
  if (now - lastPrint >= 10_000) {
    lastPrint = now;
    const s = clock.summary();
    console.log(
      `  ${Math.round((now - t0) / 1000)} s · ${s.answered}/${s.sent} answered${s.heldOnly > 0 ? ` · ${s.heldOnly} hold line only` : ""}` +
        `${s.fallbackOnly > 0 ? ` · ${s.fallbackOnly} fallback` : ""}${s.gatedOnly > 0 ? ` · ${s.gatedOnly} gate closed` : ""}`,
    );
  }
}

// ---------------------------------------------------------------- teardown + report

stop.abort();
await Promise.race([feeding, sleep(1000)]);
if (flag("reset-after")) {
  // A restart is a real cut: re-check, since a real phone may have joined.
  const now = await call<{ roster?: GuardRow[] }>("GET", "/api/state?role=mod", { token });
  const verdict = judge(now.json.roster, flag(LIVE_OVERRIDE), "restart this event");
  if (verdict.ok) console.log(`  rehearsal restarted (bots cleared) → ${(await call("POST", "/api/mod/reset", { token, body: {} })).status}`);
  else console.error(`  ✘ --reset-after skipped — ${verdict.reason}`);
}

const s = clock.summary();
const sec = (n: number) => (Number.isFinite(n) ? `${n.toFixed(1)} s` : "—");
console.log();
console.log(`  ${s.answered}/${s.sent} answered · p50 ${sec(s.p50)} · p95 ${sec(s.p95)} · max ${sec(s.max)}`);
if (s.heldOnly > 0) console.log(`  ${s.heldOnly} got only the hold line (no worker online for them)`);
if (s.fallbackOnly > 0) console.log(`  ${s.fallbackOnly} got only the worker's fallback line (the model failed or timed out — see Run → Mind)`);
if (s.gatedOnly > 0) console.log(`  ${s.gatedOnly} got only the gate line (${character}.awake is off — run after introduce_trabolta, before an ending)`);
if (s.missing > 0) console.log(`  ${s.missing} unanswered after ${timeoutS} s`);
const line = recordLine(s, new Date().toLocaleString("sv-SE").slice(0, 16), new URL(base).host, spread);
console.log(`\n  ${line}\n`);
console.log(s.pass ? "PASS" : "FAIL");
if (outFile !== "") writeFileSync(outFile, JSON.stringify({ base, scope, character, dms, spread, timeoutS, refused: Object.fromEntries(refused), ...s, record: line }, null, 2));
process.exit(s.pass ? 0 : 1);
