// K-22 acceptance — the lean mod stream, measured on the VPS (~5 minutes).
//
//   node --no-warnings scripts/accept/K-22.ts --event <eventId> --passcode <MOD code> \
//        [--url https://app.mapsandducks.com] [--seconds 60] [--steps 0]
//
// Opens two mod feeds on the same event side by side — the full director
// feed (`/events?role=mod`) and the lean house-tool feed (`&lean=1`, what
// stagehand now streams) — watches them for `--seconds`, and prints bytes +
// frames per type for each, the bytes per story step, and the busiest
// second of full-feed snapshots. Best run during a rehearsal with a few
// people playing (or Run → Players); `--steps N` instead posts N lobby
// lines as the Operator ("K-22 probe i") — REHEARSAL EVENTS ONLY, guests see
// them: with `--steps` it refuses an event with real guests on the roster
// (`live-guard.ts`; `--i-know-this-is-live` overrides) and asks y/N
// (`--yes` skips). Node ≥ 22.6 (type stripping); no dependencies.
//
// Pass: the lean feed saw every `sim` frame the full feed saw, no `snapshot`
// / `history` at all, and the full feed never sent more than 2 snapshots in
// any one second after connecting. Record "bytes per step" (full vs lean) in
// the checklist. Local dry run (2026-10-15, 30 personas, 20 steps): full
// 74 KB/step with 9 snapshots (was one per step), lean 0.3 KB/step.

import { liveGuard, type GuardRow } from "./live-guard.ts";

interface Tally {
  bytes: number;
  frames: Map<string, number>;
  /** Arrival second (relative to start) of each `snapshot` frame. */
  snapshotAt: number[];
  sim: string[];
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v !== undefined) return v;
  if (fallback !== undefined) return fallback;
  console.error(`missing --${name}\n\nusage: node scripts/accept/K-22.ts --event <id> --passcode <MOD> [--url …] [--seconds 60] [--steps 0]`);
  process.exit(2);
}

const base = arg("url", "https://app.mapsandducks.com").replace(/\/$/u, "");
const event = arg("event");
const passcode = arg("passcode");
const seconds = Number(arg("seconds", "60"));
const steps = Number(arg("steps", "0"));
const scope = event === "" || event === "default" ? "" : `/e/${encodeURIComponent(event)}`;

async function login(): Promise<string> {
  const r = await fetch(`${base}${scope}/api/mod/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode }),
  });
  if (!r.ok) throw new Error(`mod login → ${r.status} ${await r.text()}`);
  return ((await r.json()) as { token: string }).token;
}

function watch(token: string, lean: boolean, t0: number, stop: AbortSignal): { tally: Tally; done: Promise<void> } {
  const tally: Tally = { bytes: 0, frames: new Map(), snapshotAt: [], sim: [] };
  const done = (async () => {
    const r = await fetch(`${base}${scope}/events?role=mod&id=k22${lean ? "&lean=1" : ""}`, {
      headers: { "x-loom-token": token, accept: "text/event-stream" },
      signal: stop,
    });
    if (!r.ok || r.body === null) throw new Error(`${lean ? "lean" : "full"} stream → ${r.status}`);
    const dec = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of r.body) {
        tally.bytes += chunk.byteLength;
        buf += dec.decode(chunk, { stream: true });
        let at: number;
        while ((at = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, at);
          buf = buf.slice(at + 2);
          const ev = /^event: (\S+)$/mu.exec(frame)?.[1];
          if (ev === undefined) continue; // `:ok` / `:ping`
          tally.frames.set(ev, (tally.frames.get(ev) ?? 0) + 1);
          if (ev === "snapshot") tally.snapshotAt.push((Date.now() - t0) / 1000);
          if (ev === "sim") tally.sim.push(frame.slice(frame.indexOf("data: ") + 6));
        }
      }
    } catch (e) {
      if (!stop.aborted) throw e;
    }
  })();
  return { tally, done };
}

function busiestSecond(at: number[], after: number): number {
  let best = 0;
  const xs = at.filter((t) => t >= after);
  for (let i = 0, j = 0; i < xs.length; i++) {
    while (xs[i]! - xs[j]! >= 1) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

function report(name: string, t: Tally, stepCount: number): void {
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  const types = [...t.frames.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join("  ");
  console.log(`  ${name.padEnd(5)} ${kb(t.bytes).padStart(10)}   ${kb(t.bytes / Math.max(1, stepCount)).padStart(9)}/step   ${types}`);
}

const token = await login();
if (steps > 0) {
  const st = await fetch(`${base}${scope}/api/state?role=mod`, { headers: { "x-loom-token": token } });
  if (!st.ok) throw new Error(`mod state → ${st.status}`);
  const view = (await st.json()) as { title?: string; roster?: GuardRow[] };
  await liveGuard({
    title: view.title,
    where: `${base}${scope}`,
    roster: view.roster,
    action: `post ${steps} probe lines into the lobby`,
    local: /^https?:\/\/(localhost|127\.|\[::1\])/u.test(base),
  });
}
console.log(`K-22 · ${base}${scope} · watching ${seconds}s${steps > 0 ? ` · posting ${steps} probe lines` : ""}`);
const stop = new AbortController();
const t0 = Date.now();
const full = watch(token, false, t0, stop.signal);
const lean = watch(token, true, t0, stop.signal);
const settle = 2; // connect-time frames (initial snapshot + presence) don't count toward the rate
await new Promise((r) => setTimeout(r, settle * 1000));
for (let i = 0; i < steps; i++) {
  await fetch(`${base}${scope}/api/mod/say`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-loom-token": token },
    body: JSON.stringify({ channel: "lobby", text: `K-22 probe ${i + 1}` }),
  });
  await new Promise((r) => setTimeout(r, 100));
}
await new Promise((r) => setTimeout(r, Math.max(0, seconds * 1000 - (Date.now() - t0))));
stop.abort();
await Promise.allSettled([full.done, lean.done]);

const f = full.tally;
const l = lean.tally;
const stepCount = Math.max(f.frames.get("sim") ?? 0, (f.frames.get("message") ?? 0), 1);
console.log(`\n  steps seen (sim or message frames): ${stepCount}`);
report("full", f, stepCount);
report("lean", l, stepCount);

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? "✔" : "✘"} ${what}`);
  if (!ok) fails++;
};
console.log();
const leanSims = new Set(l.sim);
check(f.sim.every((s) => leanSims.has(s)) && l.sim.length >= f.sim.length, `lean saw every sim frame (${l.sim.length}/${f.sim.length})`);
check((l.frames.get("snapshot") ?? 0) === 0 && (l.frames.get("history") ?? 0) === 0, "lean got no snapshot / history");
const peak = busiestSecond(f.snapshotAt, settle);
check(peak <= 2, `full feed: at most 2 snapshots in any second (peak ${peak})`);
if (stepCount <= 1) console.log("  ! no story steps happened — rerun during a rehearsal, or with --steps 20 on a rehearsal event");
process.exit(fails === 0 ? 0 : 1);
