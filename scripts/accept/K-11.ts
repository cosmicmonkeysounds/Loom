// K-11 acceptance helper: the redeem throttle + the door-rush limits.
//
// Drives a REHEARSAL event (never the live show) with its EVENT code: it
// registers throwaway guests named "K11 Probe …" (restart the rehearsal
// afterwards to clear them). See K-11.md.
//
//   node --experimental-strip-types scripts/accept/K-11.ts <cmd> --base https://app.mapsandducks.com --code <EVENT CODE>
//   (or `npx tsx scripts/accept/K-11.ts …`)
//
//   redeem       register one probe guest, send 9 wrong codex codes:
//                expect 8 × 200 then 429 (and the 9th never journaled)
//   rush [n]     register n probe guests (default 40) from THIS machine as
//                fast as possible — one IP, like the house Wi-Fi. With the
//                night's env (LOOM_RL_REGISTER ≥ n) every one is a 200.

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name: string): string => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  if (v === undefined) throw new Error(`missing --${name}`);
  return v;
};
const base = opt("base").replace(/\/$/u, "");
const code = opt("code");

async function call(path: string, body: Record<string, unknown>, token?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-loom-token": token } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

const hit = await call("/api/resolve-code", { code });
if (hit.status !== 200) throw new Error(`resolve-code → ${hit.status} ${JSON.stringify(hit.json)}`);
if (hit.json["role"] !== "guest") throw new Error("that is not the event's guest (event) code");
const ev = `/e/${String(hit.json["eventId"])}`;
console.log(`event ${String(hit.json["eventId"])} · ${String(hit.json["title"])}`);

const stamp = Date.now().toString(36).slice(-4);
const register = (i: number) => call(`${ev}/api/guest/register`, { name: `K11 Probe ${stamp} ${i}`, passcode: code });

if (cmd === "redeem") {
  const g = await register(0);
  if (g.status !== 200) throw new Error(`register → ${g.status} ${JSON.stringify(g.json)}`);
  const token = String(g.json["token"]);
  const statuses: number[] = [];
  for (let i = 1; i <= 9; i++) statuses.push((await call(`${ev}/api/guest/codex/redeem`, { code: `NOPE-${stamp}-${i}` }, token)).status);
  console.log(`statuses ${statuses.join(" ")}`);
  const pass = statuses.slice(0, 8).every((s) => s === 200) && statuses[8] === 429;
  console.log(pass ? "PASS — the 9th miss in a minute got a 429" : "FAIL — expected 8 × 200 then 429");
  process.exit(pass ? 0 : 1);
} else if (cmd === "rush") {
  const n = Number(args[1] && !args[1].startsWith("--") ? args[1] : 40);
  const t0 = Date.now();
  const statuses = await Promise.all(Array.from({ length: n }, (_, i) => register(i + 1).then((r) => r.status)));
  const tally = new Map<number, number>();
  for (const s of statuses) tally.set(s, (tally.get(s) ?? 0) + 1);
  console.log(`${n} registrations in ${Date.now() - t0} ms: ${[...tally].map(([s, c]) => `${c} × ${s}`).join(", ")}`);
  const pass = statuses.every((s) => s === 200);
  console.log(pass ? "PASS — the door rush got through" : "FAIL — raise LOOM_RL_REGISTER / LOOM_RL_RESOLVE in the VPS .env");
  process.exit(pass ? 0 : 1);
} else {
  console.error("usage: K-11.ts redeem|rush [n] --base <url> --code <EVENT CODE>");
  process.exit(2);
}
