// K-32 acceptance — the VPS load test (≈ 6 minutes, one laptop, no devices).
//
//   node --no-warnings scripts/accept/k32-load.ts --code <MOD code> \
//        [--url https://app.mapsandducks.com] [--seconds 180] [--yes]
//
// Drives the show's worst evening against ONE event: 45 guest SSE streams,
// 9 performer booths, 6 wall terminals polling the lean screen state
// (`/api/screen/state` every 2 s — K-16; today's 20 s `/api/state?role=mod`
// poll if the server predates it), 2 full director consoles, and guest
// say / redeem / widget traffic with a burst every 20 s (a third of the room
// acting inside 2 s, as when a poll or a CAPTCHA lands on everyone). Every
// `--probe-every` seconds the Operator posts a lobby line; the **step
// latency** is, per connected client, the time from that POST to the client
// holding the line *and* the snapshot that follows it (its view is current).
// CPU comes from the server's own `GET /api/mod/metrics` (the Node process,
// % of ONE core — the server is one thread, so that is the real ceiling).
//
// RUN IT ON A REHEARSAL EVENT, NEVER THE LIVE ONE. It adds 45 "K32 Bot NN"
// personas (or registered guests with `--join register`), posts lobby lines
// guests can see, unlocks codex entries and answers widget cards for the
// bots. Booths are play-as sessions (`/api/mod/impersonate`), so no real
// performer's part is held, and they end when the script exits. Afterwards
// press Restart in Run (or pass `--reset-after`) to clear the bots.
// It REFUSES an event with any real guest on the roster (anyone who isn't a
// persona or a K32 bot — `live-guard.ts`), names the event and asks y/N
// before writing anything; `--reset-after` re-checks before restarting.
// `--i-know-this-is-live` overrides the refusal.
//
// Flags: --event <id> (skip code resolution) · --guests 45 --booths 9
// --terminals 6 --mods 2 · --rate 2 (actions / guest / minute between
// bursts) · --burst-every 20 · --probe-every 2 · --join persona|register ·
// --open-doors (start a closed rehearsal) · --reset-after · --out <file.json>
// (the recorded numbers) · --yes (skip the y/N question) ·
// --i-know-this-is-live (skip the real-guest refusal). Node ≥ 22.6
// (type stripping); no dependencies.
//
// Pass: ≥ 90 % of the guests joined, step-latency p95 < 1000 ms for the
// participants (guests + booths; director consoles get coalesced snapshots
// by design — K-22 — and are shown on their own line), mean server CPU
// < 70 % of one core over the load window, and ≥ 95 % of probe lines
// delivered (OCT31 §5 K-32). Paste the printed `record:` line into the
// checklist (`--out` keeps the JSON). If it fails: coalesce guest + booth
// snapshots to ≤ 2/s (extends K-22) in the 10-24 buffer.
//
// Local dry run (2026-10-15, M-series laptop, the show story, 90 s): 45
// guests / 9 booths / 6 terminals / 2 directors, participants p95 50 ms,
// CPU 8 % mean / 17 % peak of one core, 0 errors — but ≈ 18 Mbit/s of SSE
// (each guest ≈ 24 KB/s of full snapshots), which matters more on the
// house downlink / guests' cellular than on the VPS.

import { judge, liveGuard, LIVE_OVERRIDE, type GuardRow } from "./live-guard.ts";

// ---------------------------------------------------------------- args

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v !== undefined && !v.startsWith("--")) return v;
  if (fallback !== undefined) return fallback;
  console.error(`missing --${name}\n\nusage: node --no-warnings scripts/accept/k32-load.ts --code <MOD code> [--url https://app.mapsandducks.com] [--seconds 180]`);
  process.exit(2);
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const num = (name: string, fallback: number) => {
  const n = Number(arg(name, String(fallback)));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const base = arg("url", "https://app.mapsandducks.com").replace(/\/$/u, "");
const modCode = arg("code");
const seconds = num("seconds", 180);
const nGuests = num("guests", 45);
const nBooths = num("booths", 9);
const nTerminals = num("terminals", 6);
const nMods = num("mods", 2);
const ratePerMin = num("rate", 2);
const burstEvery = num("burst-every", 20);
const probeEvery = num("probe-every", 2);
const joinMode = arg("join", "persona") === "register" ? "register" : "persona";
const outFile = arg("out", "");
const LABEL = "K-32 load test";
// Names are exclusive per event: tag each run so a rerun never collides.
const RUN = Math.floor(Math.random() * 46656).toString(36).padStart(3, "0");

// ---------------------------------------------------------------- stats

const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
};
const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
const fmt = (n: number, unit = "ms") => (Number.isFinite(n) ? `${Math.round(n)} ${unit}` : "—");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- http

let scope = "";
const httpLat = new Map<string, number[]>();
const httpErr = new Map<string, number>();

async function call<T = Record<string, unknown>>(
  kind: string | null,
  method: "GET" | "POST",
  path: string,
  opts: { token?: string; body?: unknown; root?: boolean } = {},
): Promise<{ status: number; json: T }> {
  const t0 = performance.now();
  let status = 0;
  let json = {} as T;
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
    status = r.status;
    const text = await r.text();
    try {
      json = JSON.parse(text) as T;
    } catch {
      /* not JSON */
    }
  } catch {
    status = 0; // network error / timeout
  }
  if (kind !== null) {
    const list = httpLat.get(kind) ?? [];
    list.push(performance.now() - t0);
    httpLat.set(kind, list);
    if (status < 200 || status >= 300) {
      const k = `${kind} ${status === 0 ? "timeout/network" : status}`;
      httpErr.set(k, (httpErr.get(k) ?? 0) + 1);
    }
  }
  return { status, json };
}

// ---------------------------------------------------------------- streams

type Role = "guest" | "prime" | "mod";
interface Probe {
  nonce: string;
  sentAt: number;
}
interface Client {
  role: Role;
  label: string;
  token: string;
  bytes: number;
  frames: number;
  connected: boolean;
  dropped: number;
  /** nonce → when the line arrived; cleared once its snapshot lands. */
  awaiting: Map<string, number>;
  view: Record<string, unknown> | null;
  widgets: Map<number, string>; // open widget cards: seq → kind
}

const probes = new Map<string, Probe>();
const stepLat: number[] = [];
const msgLat: number[] = [];
const stepLatByRole: Record<Role, number[]> = { guest: [], prime: [], mod: [] };
const delivered = new Map<string, number>(); // nonce → clients that got the line
const streamStop = new AbortController();

function onFrame(c: Client, ev: string, data: string, at: number): void {
  c.frames++;
  if (ev === "message" || ev === "history") {
    let msgs: Array<Record<string, unknown>>;
    try {
      const parsed = JSON.parse(data) as unknown;
      msgs = (Array.isArray(parsed) ? parsed : [parsed]) as Array<Record<string, unknown>>;
    } catch {
      return;
    }
    for (const m of msgs) {
      const text = typeof m.text === "string" ? m.text : "";
      const hit = /K32·([a-z0-9]+)/u.exec(text);
      if (ev === "message" && hit !== null) {
        const p = probes.get(hit[1]!);
        if (p !== undefined && !c.awaiting.has(p.nonce)) {
          c.awaiting.set(p.nonce, at);
          msgLat.push(at - p.sentAt);
          delivered.set(p.nonce, (delivered.get(p.nonce) ?? 0) + 1);
        }
      }
      const w = m.widget as { kind?: string } | undefined;
      if (m.kind === "widget" && typeof m.seq === "number" && w?.kind !== undefined) c.widgets.set(m.seq, w.kind);
    }
  } else if (ev === "snapshot") {
    for (const [nonce, gotAt] of c.awaiting) {
      const p = probes.get(nonce);
      c.awaiting.delete(nonce);
      if (p === undefined) continue;
      void gotAt;
      stepLat.push(at - p.sentAt);
      stepLatByRole[c.role].push(at - p.sentAt);
    }
    if (c.role === "guest") {
      try {
        c.view = JSON.parse(data) as Record<string, unknown>;
        for (const seq of (c.view.answered as number[] | undefined) ?? []) c.widgets.delete(seq);
      } catch {
        /* torn */
      }
    }
  }
}

async function stream(c: Client): Promise<void> {
  const q = c.role === "mod" ? "role=mod&id=k32" : `role=${c.role}&token=${encodeURIComponent(c.token)}`;
  while (!streamStop.signal.aborted) {
    try {
      const r = await fetch(`${base}${scope}/events?${q}`, {
        headers: { "x-loom-token": c.token, accept: "text/event-stream" },
        signal: streamStop.signal,
      });
      if (!r.ok || r.body === null) throw new Error(`stream ${c.label} → ${r.status}`);
      c.connected = true;
      const dec = new TextDecoder();
      let buf = "";
      for await (const chunk of r.body) {
        const at = performance.now();
        c.bytes += chunk.byteLength;
        buf += dec.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (\S+)$/mu.exec(frame)?.[1];
          if (ev === undefined) continue;
          const d = frame.indexOf("data: ");
          onFrame(c, ev, d >= 0 ? frame.slice(d + 6) : "", at);
        }
      }
    } catch {
      /* fall through to reconnect */
    }
    c.connected = false;
    if (streamStop.signal.aborted) return;
    c.dropped++;
    await sleep(1000);
  }
}

// ---------------------------------------------------------------- setup

async function resolveScope(): Promise<void> {
  const explicit = arg("event", "");
  if (explicit !== "") {
    scope = explicit === "default" ? "" : `/e/${encodeURIComponent(explicit)}`;
    return;
  }
  const r = await call<{ eventId?: string; role?: string; error?: string }>(null, "POST", "/api/resolve-code", { body: { code: modCode }, root: true });
  if (r.status !== 200) throw new Error(`resolve-code → ${r.status} ${r.json.error ?? ""} (is --code the event's MOD code?)`);
  if (r.json.role !== "mod") throw new Error(`that is the event's ${r.json.role} code — pass the MOD code`);
  scope = r.json.eventId === "default" || r.json.eventId === undefined ? "" : `/e/${encodeURIComponent(r.json.eventId)}`;
}

interface Codes {
  token: string;
  eventPass: string;
  primePass: string;
}

async function modLogin(): Promise<Codes> {
  const r = await call<Codes & { error?: string }>(null, "POST", "/api/mod/login", { body: { passcode: modCode } });
  if (r.status !== 200) throw new Error(`mod login → ${r.status} ${r.json.error ?? ""}`);
  return r.json;
}

async function makeGuest(i: number, codes: Codes): Promise<Client | null> {
  const name = `K32 Bot ${RUN} ${String(i + 1).padStart(2, "0")}`;
  let token: string;
  if (joinMode === "register") {
    for (;;) {
      const r = await call<{ token?: string; error?: string }>("register", "POST", "/api/guest/register", { body: { passcode: codes.eventPass, name } });
      if (r.status === 200 && r.json.token !== undefined) {
        token = r.json.token;
        break;
      }
      if (r.status === 429) {
        process.stdout.write(`\n  … registration rate limit (per IP) — waiting 30 s`);
        await sleep(30_000);
        continue;
      }
      console.error(`\n  register ${name} → ${r.status} ${r.json.error ?? ""}`);
      return null;
    }
  } else {
    const p = await call<{ guest?: { id: string }; error?: string }>("persona", "POST", "/api/mod/persona", { token: codes.token, body: { name } });
    if (p.status !== 200 || p.json.guest === undefined) {
      console.error(`\n  persona ${name} → ${p.status} ${p.json.error ?? ""}`);
      return null;
    }
    const s = await call<{ token?: string; error?: string }>("impersonate", "POST", "/api/mod/impersonate", { token: codes.token, body: { role: "guest", id: p.json.guest.id, label: LABEL } });
    if (s.status !== 200 || s.json.token === undefined) {
      console.error(`\n  play-as ${name} → ${s.status} ${s.json.error ?? ""}`);
      return null;
    }
    token = s.json.token;
  }
  return blank("guest", name, token);
}

function blank(role: Role, label: string, token: string): Client {
  return { role, label, token, bytes: 0, frames: 0, connected: false, dropped: 0, awaiting: new Map(), view: null, widgets: new Map() };
}

async function boothCharacters(codes: Codes): Promise<string[]> {
  const r = await call<{ identities?: Array<{ name: string }> }>(null, "POST", "/api/identities", { body: { passcode: codes.primePass } });
  return (r.json.identities ?? []).map((x) => x.name);
}

// ---------------------------------------------------------------- traffic

let codexCodes: string[] = [];

function postableRooms(c: Client): string[] {
  const v = c.view;
  if (v === null) return [];
  const rooms = ((v.channels as Array<{ id: string; canPost: boolean }> | undefined) ?? []).filter((ch) => ch.canPost).map((ch) => ch.id);
  if (typeof v.location === "string" && v.cutscene !== true) rooms.push(`loc:${v.location}`);
  return rooms;
}

// What the play app posts for each answerable card (play/src/widgets.tsx,
// tutorial.tsx); other kinds (image, pass) never ask.
const ANSWERS: Record<string, () => Record<string, string | number | boolean>> = {
  captcha: () => ({ passed: Math.random() < 0.5, picked: 3 }),
  poll: () => ({ index: 0 }),
  tutorial: () => ({ completed: true, steps: 6 }),
};

let actionSeq = 0;
async function act(c: Client): Promise<void> {
  const widget = [...c.widgets.entries()].find(([, kind]) => ANSWERS[kind] !== undefined);
  const rooms = postableRooms(c);
  const roll = Math.random();
  if (widget !== undefined && roll < 0.4) {
    const [seq, kind] = widget;
    c.widgets.delete(seq);
    const result = ANSWERS[kind]!();
    await call("widget", "POST", "/api/guest/widget", { token: c.token, body: { seq, result } });
  } else if (codexCodes.length > 0 && roll < 0.6) {
    const code = codexCodes[Math.floor(Math.random() * codexCodes.length)]!;
    await call("redeem", "POST", "/api/guest/codex/redeem", { token: c.token, body: { code } });
  } else if (rooms.length > 0) {
    const channel = rooms[Math.floor(Math.random() * rooms.length)]!;
    await call("say", "POST", "/api/guest/say", { token: c.token, body: { channel, text: `load test line ${++actionSeq}` } });
  } else if (codexCodes.length > 0) {
    const code = codexCodes[Math.floor(Math.random() * codexCodes.length)]!;
    await call("redeem", "POST", "/api/guest/codex/redeem", { token: c.token, body: { code } });
  }
}

let probeN = 0;
async function probe(token: string): Promise<void> {
  const nonce = `${Date.now().toString(36)}${(probeN++).toString(36)}`;
  probes.set(nonce, { nonce, sentAt: performance.now() });
  await call("probe (mod say)", "POST", "/api/mod/say", { token, body: { channel: "lobby", text: `K32·${nonce} load-test probe — ignore` } });
}

interface Sample {
  at: number;
  cpuUs: number;
  load1: number;
  cpus: number;
  loopP99: number;
  loopMax: number;
  rssMb: number;
  clients: number;
}
const samples: Sample[] = [];
let metricsMissing = false;
async function sampleMetrics(token: string): Promise<void> {
  const r = await call<{ at: number; cpu: { userUs: number; systemUs: number }; loadavg: number[]; cpus: number; eventLoop: { p99Ms: number; maxMs: number }; memory: { rssMb: number }; clients: number }>(null, "GET", `/api/mod/metrics?window=k32-${RUN}`, { token });
  if (r.status === 404) {
    metricsMissing = true;
    return;
  }
  if (r.status !== 200) return;
  const m = r.json;
  samples.push({ at: m.at, cpuUs: m.cpu.userUs + m.cpu.systemUs, load1: m.loadavg[0] ?? 0, cpus: m.cpus, loopP99: m.eventLoop.p99Ms, loopMax: m.eventLoop.maxMs, rssMb: m.memory.rssMb, clients: m.clients });
}

// ---------------------------------------------------------------- main

const local = /^https?:\/\/(localhost|127\.|\[::1\])/u.test(base);
await resolveScope();
const codes = await modLogin();
const state = await call<{ phase?: string; title?: string; roster?: GuardRow[] }>(null, "GET", "/api/state?role=mod", { token: codes.token });
await liveGuard({ title: state.json.title, where: `${base}${scope || " (default event)"}`, roster: state.json.roster, action: "load-test this event", local });
if (state.json.phase !== "open") {
  if (flag("open-doors")) {
    await call(null, "POST", "/api/mod/start", { token: codes.token, body: {} });
  } else {
    console.error(`the event's doors are ${state.json.phase ?? "unknown"} — press Start/Resume in Run, or pass --open-doors`);
    process.exit(2);
  }
}
const codexList = await call<{ codex?: Array<{ code: string }> }>(null, "POST", "/api/mod/codes", { token: codes.token, body: {} });
codexCodes = (codexList.json.codex ?? []).map((e) => e.code).filter(Boolean);

console.log(`K-32 · ${base}${scope || " (default event)"} · ${nGuests} guests (${joinMode}) · ${nBooths} booths · ${nTerminals} terminals · ${nMods} directors · ${seconds}s`);

// 1. Directors + metrics baseline.
const clients: Client[] = [];
const streams: Promise<void>[] = [];
const connect = (c: Client) => {
  clients.push(c);
  streams.push(stream(c));
};
for (let i = 0; i < nMods; i++) connect(blank("mod", `director ${i + 1}`, codes.token));
await sampleMetrics(codes.token);
const metricsTimer = setInterval(() => void sampleMetrics(codes.token), 2000);

// 2. Booths (play-as sessions — never hold a real performer's part).
const chars = await boothCharacters(codes);
const impersonations: string[] = [];
for (let i = 0; i < nBooths && chars.length > 0; i++) {
  const character = chars[i % chars.length]!;
  const s = await call<{ token?: string }>("impersonate", "POST", "/api/mod/impersonate", { token: codes.token, body: { role: "prime", id: character, label: LABEL } });
  if (s.json.token !== undefined) {
    impersonations.push(s.json.token);
    connect(blank("prime", `booth ${character}`, s.json.token));
  }
}
if (chars.length === 0 && nBooths > 0) console.log("  ! the story lists no performer parts — booths skipped");

// 3. Guests, a few at a time (each join is itself a story step).
process.stdout.write("  joining guests ");
for (let i = 0; i < nGuests; i += 5) {
  const batch = await Promise.all(Array.from({ length: Math.min(5, nGuests - i) }, (_, k) => makeGuest(i + k, codes)));
  for (const g of batch) {
    if (g === null) continue;
    if (joinMode === "persona") impersonations.push(g.token);
    connect(g);
  }
  process.stdout.write(".");
}
console.log(` ${clients.filter((c) => c.role === "guest").length} joined`);

// 4. Terminals: the lean screen state every 2 s (K-16), else today's poll.
let terminalPath = "/api/screen/state";
let terminalEvery = 2000;
const probeTerm = await call(null, "GET", terminalPath, { token: codes.token });
if (probeTerm.status === 404) {
  terminalPath = "/api/state?role=mod";
  terminalEvery = 20_000;
  console.log("  ! no /api/screen/state on this server (K-16 not deployed) — terminals poll /api/state?role=mod every 20 s like today");
}
const terminalTimers = Array.from({ length: nTerminals }, (_, i) =>
  setTimeout(() => {
    const t = setInterval(() => void call("terminal poll", "GET", terminalPath, { token: codes.token }), terminalEvery);
    terminalTimers.push(t as unknown as ReturnType<typeof setTimeout>);
  }, (i * terminalEvery) / Math.max(1, nTerminals)),
);

// Let connect-time snapshots settle before measuring.
await sleep(3000);
const cpuStartIdx = samples.length - 1;
const loadStart = Date.now();
const guests = clients.filter((c) => c.role === "guest");
console.log(`  load running — probe every ${probeEvery}s, burst every ${burstEvery}s`);

const timers: ReturnType<typeof setInterval>[] = [];
timers.push(setInterval(() => void probe(codes.token), probeEvery * 1000));
// Background chatter: each guest acts ~`rate` times a minute.
if (ratePerMin > 0 && guests.length > 0) {
  const everyMs = 60_000 / (ratePerMin * guests.length);
  timers.push(setInterval(() => void act(guests[Math.floor(Math.random() * guests.length)]!), everyMs));
}
// Bursts: a third of the room inside 2 s.
if (burstEvery > 0) {
  timers.push(
    setInterval(() => {
      const n = Math.max(1, Math.round(guests.length / 3));
      for (let k = 0; k < n; k++) setTimeout(() => void act(guests[Math.floor(Math.random() * guests.length)]!), Math.random() * 2000);
    }, burstEvery * 1000),
  );
}
const tty = process.stdout.isTTY === true;
const progress = setInterval(() => {
  const s = Math.round((Date.now() - loadStart) / 1000);
  if (!tty && s % 15 !== 0) return;
  const line = `  ${s}s · steps measured ${stepLat.length} · p95 ${fmt(pct(stepLat, 95))} · streams up ${clients.filter((c) => c.connected).length}/${clients.length}`;
  process.stdout.write(tty ? `\r${line}   ` : `${line}\n`);
}, 1000);

await sleep(seconds * 1000);
for (const t of timers) clearInterval(t);
clearInterval(progress);
await sleep(3000); // let the last probes land
clearInterval(metricsTimer);
for (const t of terminalTimers) clearInterval(t);
await sampleMetrics(codes.token);
const cpuEndIdx = samples.length - 1;
console.log();

// ---------------------------------------------------------------- teardown

streamStop.abort();
await Promise.all(impersonations.map((session) => call(null, "POST", "/api/mod/impersonate/end", { token: codes.token, body: { session } })));
if (flag("reset-after")) {
  // A restart is a real cut (every guest token cleared): re-check, since a
  // real phone may have joined while the test ran.
  const now = await call<{ roster?: GuardRow[] }>(null, "GET", "/api/state?role=mod", { token: codes.token });
  const verdict = judge(now.json.roster, flag(LIVE_OVERRIDE), "restart this event");
  if (verdict.ok) {
    const r = await call(null, "POST", "/api/mod/reset", { token: codes.token, body: {} });
    console.log(`  rehearsal restarted (bots cleared) → ${r.status}`);
  } else {
    console.error(`  ✘ --reset-after skipped — ${verdict.reason}`);
  }
}
await Promise.race([Promise.allSettled(streams), sleep(2000)]);

// ---------------------------------------------------------------- report

const cpuWindows: number[] = [];
for (let i = Math.max(1, cpuStartIdx + 1); i <= cpuEndIdx; i++) {
  const a = samples[i - 1]!;
  const b = samples[i]!;
  if (b.at > a.at) cpuWindows.push(((b.cpuUs - a.cpuUs) / 1000 / (b.at - a.at)) * 100);
}
const loadSamples = samples.slice(Math.max(0, cpuStartIdx), cpuEndIdx + 1);
const cpuMean = mean(cpuWindows);
const cpuPeak = cpuWindows.length ? Math.max(...cpuWindows) : NaN;
const boxPeak = loadSamples.length ? Math.max(...loadSamples.map((s) => s.load1 / Math.max(1, s.cpus))) * 100 : NaN;
const loopP99 = loadSamples.length ? Math.max(...loadSamples.map((s) => s.loopP99)) : NaN;
const loopMax = loadSamples.length ? Math.max(...loadSamples.map((s) => s.loopMax)) : NaN;
const rssPeak = loadSamples.length ? Math.max(...loadSamples.map((s) => s.rssMb)) : NaN;
const sentProbes = probes.size;
const expectPerProbe = clients.length;
const deliveryRatio = sentProbes === 0 ? NaN : [...probes.keys()].reduce((a, n) => a + (delivered.get(n) ?? 0), 0) / (sentProbes * Math.max(1, expectPerProbe));
const kb = (role: Role) => clients.filter((c) => c.role === role).reduce((a, c) => a + c.bytes, 0) / 1024;
const elapsed = (Date.now() - loadStart) / 1000;

console.log(`\n  step latency (POST → line + fresh snapshot on each client), ${stepLat.length} samples over ${sentProbes} probes`);
// The pass figure is the participants' (guests + booths): director consoles
// get coalesced snapshots by design (K-22, ≤ 2/s), shown on their own line.
const people = [...stepLatByRole.guest, ...stepLatByRole.prime];
console.log(`    people  p50 ${fmt(pct(people, 50))}  p95 ${fmt(pct(people, 95))}  max ${fmt(people.length ? Math.max(...people) : NaN)}   (guests + booths — the pass figure)`);
console.log(`    all     p50 ${fmt(pct(stepLat, 50))}  p95 ${fmt(pct(stepLat, 95))}`);
for (const role of ["guest", "prime", "mod"] as const) {
  const xs = stepLatByRole[role];
  if (xs.length) console.log(`    ${role.padEnd(7)} p50 ${fmt(pct(xs, 50))}  p95 ${fmt(pct(xs, 95))}${role === "mod" ? "   (coalesced ≤ 2/s by K-22 — ≈ 500 ms is expected)" : ""}`);
}
console.log(`    line only p95 ${fmt(pct(msgLat, 95))} · delivery ${(deliveryRatio * 100).toFixed(1)} % of clients × probes`);
console.log(`\n  http (p50 / p95)`);
for (const [k, xs] of [...httpLat.entries()].sort()) console.log(`    ${k.padEnd(18)} ${String(xs.length).padStart(5)}×  ${fmt(pct(xs, 50)).padStart(7)} / ${fmt(pct(xs, 95)).padStart(7)}`);
if (httpErr.size) console.log(`  errors: ${[...httpErr.entries()].map(([k, v]) => `${k}×${v}`).join("  ")}`);
console.log(`\n  server: ${metricsMissing ? "no /api/mod/metrics on this server — run `docker stats` on the VPS during the test and note the peak" : `CPU mean ${cpuMean.toFixed(0)} % · peak ${cpuPeak.toFixed(0)} % of one core · box load peak ${boxPeak.toFixed(0)} % · event-loop p99 ${fmt(loopP99)} (max ${fmt(loopMax)}) · rss ${fmt(rssPeak, "MB")}`}`);
const totalKb = kb("guest") + kb("prime") + kb("mod");
console.log(`  streams: ${clients.length} (drops ${clients.reduce((a, c) => a + c.dropped, 0)}) · received guest ${kb("guest").toFixed(0)} KB · booth ${kb("prime").toFixed(0)} KB · director ${kb("mod").toFixed(0)} KB in ${elapsed.toFixed(0)} s`);
console.log(`  outbound from the server ≈ ${((totalKb * 8) / 1024 / Math.max(1, elapsed)).toFixed(1)} Mbit/s (SSE only) — with guests on house Wi-Fi, the house internet downlink carries this`);

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? "✔" : "✘"} ${what}`);
  if (!ok) fails++;
};
console.log();
const p95 = pct(people, 95);
check(guests.length >= Math.ceil(nGuests * 0.9), `≥ 90 % of the guests joined (${guests.length}/${nGuests})`);
check(people.length > 0 && p95 < 1000, `step latency p95 < 1 s (${fmt(p95)})`);
if (metricsMissing) console.log("  ? CPU not measured by the script (see above)");
if (joinMode === "persona") console.log("  ? the per-IP register / login rate limits were NOT exercised (personas skip them) — the door rush shares the house's one public IP (K-11)");
else check(Number.isFinite(cpuMean) && cpuMean < 70, `server CPU mean < 70 % of one core (${cpuMean.toFixed(0)} %, peak ${cpuPeak.toFixed(0)} %)`);
check(deliveryRatio >= 0.95, `probe lines reached ≥ 95 % of client × probe pairs (${(deliveryRatio * 100).toFixed(1)} %)`);

const record = {
  item: "K-32",
  at: new Date().toISOString(),
  url: `${base}${scope}`,
  clients: { guests: guests.length, booths: clients.filter((c) => c.role === "prime").length, directors: nMods, terminals: nTerminals, terminalPath },
  seconds: Math.round(elapsed),
  stepLatencyMs: { p50: Math.round(pct(people, 50)), p95: Math.round(p95), samples: people.length, directorsP95: Math.round(pct(stepLatByRole.mod, 95)) },
  cpuPctOneCore: metricsMissing ? null : { mean: Math.round(cpuMean), peak: Math.round(cpuPeak) },
  eventLoopP99Ms: metricsMissing ? null : loopP99,
  http: Object.fromEntries([...httpLat.entries()].map(([k, xs]) => [k, { n: xs.length, p95: Math.round(pct(xs, 95)) }])),
  errors: Object.fromEntries(httpErr),
  sseMbitPerS: Math.round(((totalKb * 8) / 1024 / Math.max(1, elapsed)) * 10) / 10,
  pass: fails === 0,
};
console.log(`\n  record: K-32 ${record.at.slice(0, 10)} ${record.url} — ${guests.length}g/${record.clients.booths}b/${nTerminals}t/${nMods}d, step p95 ${record.stepLatencyMs.p95} ms, CPU ${metricsMissing ? "n/a" : `${record.cpuPctOneCore!.mean}% mean / ${record.cpuPctOneCore!.peak}% peak`} → ${fails === 0 ? "PASS" : "FAIL"}`);
if (outFile !== "") {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`  wrote ${outFile}`);
}
if (!flag("reset-after")) console.log("  → press Restart in Run to clear the K32 bots from this rehearsal.");
process.exit(fails === 0 ? 0 : 1);
