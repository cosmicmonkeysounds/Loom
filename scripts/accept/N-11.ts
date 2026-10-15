// N-11 acceptance helper: the server's hold line when no worker is online.
//
// Against a REHEARSAL (never the live show) with the agents worker STOPPED:
// waits for a program's DM to Trabolta, then times how long until the
// server posts the story's `hold:` line into that thread (expect ~20 s;
// the server sweeps every second). See N-11.md next to this file.
//
//   node --experimental-strip-types scripts/accept/N-11.ts --base https://app.mapsandducks.com --code <MOD CODE> --guest "<program name>"
//   (or `npx tsx scripts/accept/N-11.ts …`)
//
// The expected text is read from `cast/trabolta.loom` (`hold:`). Exit 0 on
// PASS (hold line within 30 s of the guest's newest DM, exactly once).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { rehearsalGuard } from "./guard.ts";

const args = process.argv.slice(2);
const opt = (name: string, fallback?: string): string => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : fallback;
  if (v === undefined) throw new Error(`missing --${name}`);
  return v;
};
const base = opt("base").replace(/\/$/u, "");
const code = opt("code");
const guest = opt("guest");
const character = opt("character", "Trabolta");

const here = dirname(fileURLToPath(import.meta.url));
const loom = readFileSync(join(here, "../../core/examples/trapped-in-the-internet/cast/trabolta.loom"), "utf8");
const hold = /^\s+hold:\s*(.+?)\s*$/mu.exec(loom)?.[1]?.replace(/^"|"$/gu, "");
if (hold === undefined) throw new Error("no `hold:` line in cast/trabolta.loom");

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
await rehearsalGuard(base, ev, token, args);
const q = (p: string) => `${base}${ev}${p}${p.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
console.log(`event ${String(hit["eventId"])} · ${String(hit["title"])}\nexpecting: "${hold}"`);

const state = (await (await fetch(q("/api/state?role=mod"))).json()) as {
  roster: Array<{ id: string; name: string }>;
  cast?: Array<{ id: string; agent?: boolean; online?: boolean }>;
};
const row = state.roster.find((g) => g.name === guest);
if (row === undefined) throw new Error(`no guest named ${guest}`);
const online = state.cast?.find((c) => c.id === character)?.online;
if (online === true) console.log(`WARNING: ${character} shows a worker ONLINE — stop it (--only agents) or the worker answers instead.`);

type Msg = { seq: number; from: string; text: string; channel: string; at?: number };
const thread = async (): Promise<Msg[]> => {
  const h = (await (await fetch(q(`/api/history?id=${encodeURIComponent(row.id)}`))).json()) as { messages: Msg[] };
  return h.messages.filter((m) => m.channel === `dm:${character}`);
};

const start = await thread();
const seen = start.length === 0 ? 0 : Math.max(...start.map((m) => m.seq));
console.log(`Now send ${character} a DM from ${guest}'s phone or a terminal (waiting 3 min)…`);
let sentAt: number | null = null;
let heldAt: number | null = null;
let holds = 0;
const deadline = Date.now() + 180_000;
while (Date.now() < deadline) {
  const fresh = (await thread()).filter((m) => m.seq > seen);
  if (sentAt === null && fresh.some((m) => m.from !== character)) {
    sentAt = Date.now();
    console.log("  guest DM seen — timing…");
  }
  holds = fresh.filter((m) => m.from === character && m.text === hold).length;
  if (sentAt !== null && holds > 0 && heldAt === null) heldAt = Date.now();
  if (heldAt !== null && Date.now() - heldAt > 10_000) break; // watch 10 s more for a double post
  await new Promise((r) => setTimeout(r, 1000));
}
if (sentAt === null) {
  console.log("FAIL: no DM from the guest arrived.");
  process.exit(1);
}
const secs = heldAt === null ? null : Math.round((heldAt - sentAt) / 1000);
const pass = secs !== null && secs <= 30 && holds === 1;
console.log(secs === null ? "no hold line arrived" : `hold line after ~${secs} s (${holds}×)`);
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
