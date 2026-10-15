// K-26 acceptance helper: the recap numbers during a run-through.
//
// Reads GET /e/<event>/api/mod/recap with the mod code, prints the
// paste-ready text and sanity-checks the lists. Read-only: it changes
// nothing on the event, so it is safe on a rehearsal or the live show.
//
//   node --experimental-strip-types scripts/accept/K-26.ts --base https://app.mapsandducks.com --code <MOD CODE> [--json]

const args = process.argv.slice(2);
const opt = (name: string): string => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  if (v === undefined) throw new Error(`missing --${name}`);
  return v;
};
const base = opt("base").replace(/\/$/u, "");
const code = opt("code");

async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}

const hit = await post("/api/resolve-code", { code });
if (hit["role"] !== "mod") throw new Error("that is not the event's mod code");
const ev = `/e/${String(hit["eventId"])}`;
const { token } = (await post(`${ev}/api/mod/login`, { passcode: code })) as { token: string };

interface Row { name: string; value: number; rank: number; persona: boolean }
interface Recap { programs: number; lists: Record<string, Row[]>; factions: Array<{ id: string; members: unknown[] }>; text: string }
const t0 = Date.now();
const r = await fetch(`${base}${ev}/api/mod/recap?token=${encodeURIComponent(token)}`);
if (!r.ok) throw new Error(`recap → ${r.status} ${await r.text()}`);
const recap = (await r.json()) as Recap;
const ms = Date.now() - t0;

if (args.includes("--json")) console.log(JSON.stringify(recap, null, 2));
else console.log(recap.text);

const problems: string[] = [];
const lists = ["trust", "truths", "lies", "internetVisits", "codex", "quests", "truthcoin"];
for (const k of lists) {
  const rows = recap.lists[k];
  if (!Array.isArray(rows)) problems.push(`missing list ${k}`);
  else if (rows.length !== recap.programs) problems.push(`${k}: ${rows.length} rows for ${recap.programs} programs`);
  else if (rows.some((x, i) => i > 0 && x.value > rows[i - 1]!.value)) problems.push(`${k} is not sorted high → low`);
}
if (!Array.isArray(recap.factions)) problems.push("missing factions");
const personas = (recap.lists["trust"] ?? []).filter((x) => x.persona).length;
console.log(`\n── ${recap.programs} programs (${personas} personas) · ${ms} ms · ${problems.length === 0 ? "✔ lists well-formed" : "✖ " + problems.join("; ")}`);
console.log("Now eyeball: do the top names match what you saw tonight (accepted answers, Internet trips, codex)?");
if (problems.length > 0) process.exit(1);
