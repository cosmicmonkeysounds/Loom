// K-24 + N-05 acceptance helper: DM lies via "📝 File a fact".
//
// Drives a REHEARSAL event (never the live show) to hunt 2 with the mod
// code, then reads back what the filing + the 📝 button did. The phone
// part stays on a real iPhone — see K-24.md next to this file.
//
//   node --experimental-strip-types scripts/accept/K-24.ts setup --base https://app.mapsandducks.com --code <MOD CODE>
//   node --experimental-strip-types scripts/accept/K-24.ts check --base … --code … --guest "<program name>"
//   (or `npx tsx scripts/accept/K-24.ts …`)
//
// `setup` fires the cue chain to hunt 2 (each cue is phase-guarded, so a
// rerun is harmless). `check` prints Kernel.q5, Kernel.lies_accepted and
// the guest's score / truths_accepted / last_fact_q, and the # hosts lines.

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

async function post(path: string, body: Record<string, unknown>, token?: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-loom-token": token } : {}) },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}

const hit = await post("/api/resolve-code", { code });
if (hit["role"] !== "mod") throw new Error("that is not the event's mod code");
const ev = `/e/${String(hit["eventId"])}`;
const { token } = (await post(`${ev}/api/mod/login`, { passcode: code })) as { token: string };
console.log(`event ${String(hit["eventId"])} · ${String(hit["title"])}`);

const CHAIN = [
  "call_to_the_desktop",
  "start_the_bingo",
  "bingo_time",
  "introduce_trabolta",
  "start_the_hunt",
  "hunt_time_up",
  "first_moment_of_truth",
  "second_hunt_preview",
  "start_the_second_hunt",
];

if (cmd === "setup") {
  for (const name of CHAIN) {
    await post(`${ev}/api/mod/signal`, { name }, token);
    console.log(`  fired ${name}`);
  }
  console.log("Hunt 2 is open. On the iPhone: Trabolta's thread → 📝 File a fact → Round 2 Q2 → \"Clippy\" → I'm certain → File it.");
} else if (cmd === "check") {
  const guest = opt("guest");
  const r = await fetch(`${base}${ev}/api/state?role=mod&token=${encodeURIComponent(token)}`);
  const s = (await r.json()) as { roster: Array<{ id: string; name: string }>; world: Array<{ path: string; value: string }> };
  const row = s.roster.find((g) => g.name === guest);
  if (row === undefined) throw new Error(`no guest named ${guest}`);
  const w = new Map(s.world.map((e) => [e.path, e.value]));
  for (const p of ["Kernel.q5", "Kernel.lies_accepted", `${row.id}.score`, `${row.id}.truths_accepted`, `${row.id}.last_fact_q`, `${row.id}.fact_pending`]) {
    console.log(`  ${p.replace(row.id, guest)} = ${w.get(p) ?? "(unset)"}`);
  }
  // # hosts: the mod SSE stream opens with the full history frame.
  const ctl = new AbortController();
  const sse = await fetch(`${base}${ev}/events?role=mod&token=${encodeURIComponent(token)}`, { signal: ctl.signal });
  const reader = sse.body!.getReader();
  let buf = "";
  const dec = new TextDecoder();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const m = /event: history\ndata: (.*)\n/u.exec(buf);
    if (m !== null) {
      const msgs = JSON.parse(m[1]!) as Array<{ channel: string; text: string }>;
      for (const x of msgs.filter((x) => x.channel === "room:hosts").slice(-4)) console.log(`  # hosts: ${x.text}`);
      break;
    }
  }
  ctl.abort();
  console.log('Pass = Kernel.q5 "lie", lies_accepted +1, score +50, truths_accepted +1, and the phone got the same "accepted" line a true fact gets.');
} else {
  console.log("usage: K-24.ts setup|check --base <url> --code <mod code> [--guest <name>]");
}
