// K-23 acceptance helper: hunt-answer secrecy in Trabolta's worker.
//
// Reads Trabolta's mind + recent thoughts from a REHEARSAL (or the live
// event, read-only) with the mod code, and checks that no hunt answer ever
// landed in `learned` — the list his voice reads — and that the worker's
// suppressions show up in the trace. The DM half stays on a phone: see
// K-23.md next to this file.
//
//   node --experimental-strip-types scripts/accept/K-23.ts --base https://app.mapsandducks.com --code <MOD CODE>
//   (or `npx tsx scripts/accept/K-23.ts …`)
//
// The hunt words come from the mind file's `secrets:` frontmatter
// (`core/examples/trapped-in-the-internet/trabolta.mind.md`), the same
// list the worker enforces. Exit 1 when a hunt claim is in `learned`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name: string, fallback?: string): string => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : fallback;
  if (v === undefined) throw new Error(`missing --${name}`);
  return v;
};
const base = opt("base").replace(/\/$/u, "");
const code = opt("code");
const character = opt("character", "Trabolta");

/** `secrets.topics` + `secrets.match` from the mind file's frontmatter. */
function huntWords(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const text = readFileSync(join(here, "../../core/examples/trapped-in-the-internet/trabolta.mind.md"), "utf8");
  const front = text.split(/^---$/mu)[1] ?? "";
  const words: string[] = [];
  let inSecrets = false;
  let list = "";
  for (const line of front.split("\n")) {
    if (/^\S/u.test(line)) inSecrets = line.startsWith("secrets:");
    if (!inSecrets) continue;
    const head = /^ {2}(\w+):/u.exec(line);
    if (head !== null) list = head[1]!;
    const item = /^ {4}- (.+?)\s*(?:#.*)?$/u.exec(line);
    if (item !== null && (list === "topics" || list === "match")) words.push(item[1]!.replace(/^["']|["']$/gu, "").toLowerCase());
  }
  return words;
}

const fold = (s: string): string => ` ${s.toLowerCase().replace(/’/gu, "'").replace(/[^a-z0-9:.']+/gu, " ")} `;
const words = huntWords();
const hunt = (claim: string): string | undefined => words.find((w) => fold(claim).includes(fold(w)));

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
const r = await fetch(`${base}${ev}/api/mod/agent/trace?character=${encodeURIComponent(character)}&limit=400&token=${encodeURIComponent(token)}`);
if (!r.ok) throw new Error(`trace → ${r.status}`);
type Learned = { claim: string; from: string; verdict: string };
const doc = (await r.json()) as {
  thoughts: Array<{ id: string; kind: string; at?: number; result: Record<string, unknown> | null }>;
  minds: Array<{ character: string; learned?: Learned[]; status?: Record<string, unknown> }>;
};
const mind = doc.minds.find((m) => m.character === character);
console.log(`event ${String(hit["eventId"])} · ${String(hit["title"])} · ${words.length} hunt words`);
if (mind === undefined) {
  console.log(`no mind reported for ${character} — is the agents worker connected?`);
  process.exit(1);
}
const learned = mind.learned ?? [];
console.log(`\n${character}'s learned (${learned.length}) — what his voice reads:`);
let leaks = 0;
for (const e of learned) {
  const w = hunt(e.claim);
  if (w !== undefined) leaks += 1;
  console.log(`  ${w !== undefined ? "LEAK" : "ok  "} [${e.verdict}] ${e.claim} — ${e.from}${w !== undefined ? `   (hunt word: ${w})` : ""}`);
}
const suppressed = doc.thoughts.flatMap((t) => (Array.isArray(t.result?.["suppressed"]) ? (t.result["suppressed"] as string[]).map((s) => `${t.kind} ${t.id}: ${s}`) : []));
console.log(`\nSuppressed by the worker (${suppressed.length}):`);
for (const s of suppressed) console.log(`  ${s}`);
console.log(leaks === 0 ? "\nPASS: no hunt answer in learned." : `\nFAIL: ${leaks} hunt claim(s) in learned.`);
process.exit(leaks === 0 ? 0 : 1);
