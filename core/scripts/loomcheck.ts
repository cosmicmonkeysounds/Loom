//! loomcheck — validate a Loom project folder exactly the way the event
//! server will see it (one concatenated source, main.loom first), plus the
//! per-file workspace lints, plus static checks for the silent failures the
//! TS engine does not diagnose. Optional --smoke runs the story briefly.
//!
//!   cd packages/loom && pnpm --filter @loom/core loomcheck <folder> [--smoke] [--quiet]
//!   (relative folders resolve from core/, e.g. examples/trapped-in-the-internet)
//!
//! The show's generated story files — `generated/questions.loom` and
//! `codex/9-facts.loom`, written from `facts.json` by `scripts/titi-facts.ts`
//! (`pnpm --filter @loom/core titi:facts`; `generated/print-stacks.md` and the
//! marked blocks in `trabolta.mind.md` / `DESIGN.md` are not story) — are
//! checked here like any other `.loom`; `titi:facts --check` is the gate that
//! they are up to date with `facts.json`.
//!
//! Exit code 1 when any ERROR is reported.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parse } from "../src/parser/index.ts";
import { foldName } from "../src/parser/names.ts";
import { Sim, namedEvents } from "../src/runtime/sim/index.ts";
import { isBuiltinVerb } from "../src/runtime/sim/model.ts";
import { splitRevealQuietly, statementToDirective } from "../src/parser/statements.ts";
import { Workspace } from "../src/lsp/index.ts";
import { indexOutsideQuotes, splitArgsCommas } from "../src/parser/rust.ts";
import { DESK_FILE, deskEvents, validateDesk, type DeskConfig } from "../src/house-desk.ts";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const smoke = args.includes("--smoke");
const quiet = args.includes("--quiet");
if (!dir) {
  console.error("usage: loomcheck <folder> [--smoke] [--quiet]");
  process.exit(2);
}
const root = resolve(dir);

// ---- 1. files, ordered like the server (db/queries.ts projectSource) -----
function walk(d: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(d)) {
    const f = join(d, n);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else if (n.endsWith(".loom")) out.push(f);
  }
  return out;
}
const files = walk(root)
  .map((f) => ({ path: relative(root, f).split(sep).join("/"), source: readFileSync(f, "utf8") }))
  .sort((a, b) => (a.path === "main.loom" ? 0 : 1) - (b.path === "main.loom" ? 0 : 1) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
if (files.length === 0 || files[0]!.path !== "main.loom") console.log("WARN  no main.loom at the folder root — the header (# Title / start:) must be in the first file");

// Concatenate exactly like the server, remembering where each file starts.
const ranges: Array<{ path: string; first: number }> = [];
let line = 0;
const parts: string[] = [];
for (const f of files) {
  ranges.push({ path: f.path, first: line + 1 }); // +1: the `# ── path` separator line
  const chunk = `# ── ${f.path} ${"─".repeat(Math.max(0, 60 - f.path.length))}\n${f.source}`;
  parts.push(chunk);
  line += chunk.split("\n").length + 1; // join("\n\n") adds one blank line
}
const concat = parts.join("\n\n");
/** 0-based concat line → `file:line` (1-based). */
function where(l0: number | undefined): string {
  if (l0 === undefined) return "?";
  let hit = ranges[0]!;
  for (const r of ranges) if (r.first <= l0) hit = r;
  return `${hit.path}:${l0 - hit.first + 1}`;
}

let errors = 0;
let warns = 0;
const report = (sev: "ERROR" | "WARN" | "INFO", msg: string): void => {
  if (sev === "ERROR") errors++;
  if (sev === "WARN") warns++;
  if (quiet && sev === "INFO") return;
  console.log(`${sev.padEnd(5)} ${msg}`);
};

// ---- 2. parser diagnostics on the concatenated source --------------------
const [, pdiags] = parse(concat);
for (const d of pdiags) report(d.severity === "error" ? "ERROR" : "WARN", `${where(d.span.start.line)} ${d.code} ${d.message}`);

// ---- 3. workspace (per-file) project diagnostics + name lints ------------
const ws = new Workspace();
ws.updateMany(files.map((f) => [`file:///${f.path}`, f.source] as [string, string]));
for (const f of files) {
  const pd = ws.diagnosticsFor(`file:///${f.path}`);
  for (const d of pd?.diagnostics ?? []) {
    if (/^L1[01]\d\d$/.test(String(d.code)) && pdiags.length > 0) continue; // parser codes already shown
    report(d.severity === 1 ? "ERROR" : "WARN", `${f.path}:${d.range.start.line + 1} ${d.code ?? ""} ${d.message}`);
  }
}

// ---- 4. compile the model the server will run ---------------------------
const sim = Sim.fromSources(concat);
const m = sim.model;
console.log(
  `MODEL title=${JSON.stringify(m.title)} start=${JSON.stringify(m.entry)} theme=${m.theme} directory=${m.directory} | ` +
    `beats ${m.beats.size} · characters ${m.characters.size} · roles ${m.roles.size} (default ${m.defaultRole}) · groups ${m.factions.size} · ` +
    `locations ${m.locations.size} · channels ${m.channels.size} · interactions ${m.interactions.size} · codex ${m.codex.size} · quests ${m.quests.size} · ` +
    `rules ${m.rules.length} · timers ${m.timerHooks.length} · generators ${m.gens.length}`,
);
const events: string[] = namedEvents(m);
if (!quiet) console.log(`EVENTS (director list, ${events.length}): ${events.join(" | ")}`);
if (m.entry === null) report("WARN", "no `start:` in the header — the doors open on no beat");
else if (!m.beats.has(m.entry)) report("ERROR", `start: ${m.entry} names no beat`);
if (m.title === null) report("WARN", "no `# Title` heading at the top of main.loom");

// ---- 5. static checks -----------------------------------------------------
const subjectNames = new Set(["guest", "person", "subject", ...[...m.roles.keys()].map((r: string) => r.toLowerCase().replace(/\s+/g, "_"))]);
const entity = (n: string): boolean => m.entityIndex.get(n.trim()) !== null || m.entityKind.has(n.trim());
const beatExists = (q: string | null, n: string): boolean => {
  if (m.beats.has(n) || m.beatIndex.get(n) !== null) return true;
  if (q !== null && q !== "self" && q !== "me" && (m.beats.has(`${q}.${n}`) || m.beatIndex.get(`${q}.${n}`) !== null)) return true;
  if (q === "self" || q === "me") return [...m.beats.keys()].some((k: string) => k.endsWith(`.${n}`) || foldName(k).endsWith(`.${foldName(n)}`));
  return m.beatIndex.get(q !== null ? `${q}.${n}` : n) !== null;
};
type Hook = { verb: string; param: string | null; filter: string | null; timer: unknown; condition: string | null; body: any[]; event: string; ownerId: string; ownerKind: string };
const allHooks: Hook[] = [
  ...[...m.characters.values()].flatMap((c: any) => c.hooks),
  ...[...m.roles.values()].flatMap((r: any) => r.hooks),
  ...m.rules,
];
const listened = new Set(allHooks.filter((h) => h.timer === null && h.condition === null && h.verb !== "").map((h) => foldName(h.verb)));
const fired = new Map<string, string>(); // folded event → where
// Wave 18: `sides` (the side reveal's doors) and `invite` (a recruit) are the guest lane's.
const SHOW_KINDS = new Set(["captcha", "image", "poll", "tutorial", "pass", "fact", "answer", "sides", "invite"]);
const VERB_PROSE = /^(set|fire|cue|sound|sfx|move|add|remove|reveal|unlock|broadcast|show|reply|start quest|update quest|complete quest|finish quest|fail quest|capture|release|do|wait|spawn|run|cancel)\s/;

/** `fire` / `show` argument traps: an unbalanced quote swallows the whole
 *  `with` clause (it is only looked for outside quotes), and a bare
 *  `question: P1` evaluates to null instead of the key "P1". */
function checkWithArgs(verb: string, rest: string, at: string): void {
  if ((rest.replace(/\\./g, "").match(/"/g) ?? []).length % 2 === 1) {
    report("WARN", `${at} \`${verb} ${rest.slice(0, 60)}\` — unbalanced quotes: everything after the odd \`"\` is text, so a \`with\` clause is never read`);
    return;
  }
  const w = indexOutsideQuotes(rest, " with ");
  if (verb !== "show" || w < 0) return;
  for (const chunk of splitArgsCommas(rest.slice(w + 6))) {
    const kv = /^\s*question\s*:\s*(.*)$/s.exec(chunk);
    if (kv && !kv[1]!.trim().startsWith('"'))
      report("WARN", `${at} \`show … with question: ${kv[1]!.trim()}\` — quote it (\`question: "${kv[1]!.trim()}"\`): a bare key evaluates as an expression (null), so the card is judged against nothing`);
  }
}

function checkDirective(raw: string, at: string, ctx: { param: string | null }): void {
  const i = raw.indexOf(":");
  const verb = i < 0 ? raw.trim() : raw.slice(0, i).trim();
  const rest = i < 0 ? "" : raw.slice(i + 1).trim();
  if (verb === "fire" || verb === "show") checkWithArgs(verb, rest, at);
  switch (verb) {
    case "fire": {
      let head = rest;
      const w = indexOutsideQuotes(head, " with ");
      if (w >= 0) head = head.slice(0, w);
      const f = head.lastIndexOf(" for ");
      if (f >= 0) head = head.slice(0, f);
      fired.set(foldName(head), at);
      if (!listened.has(foldName(head)) && !isBuiltinVerb(head)) report("WARN", `${at} \`fire ${head}\` — no \`when\` hook listens for "${foldName(head)}" (event names fold: lowercase, _/- = space; \`when the x:\` with ONE word after a filler is heard as just "x")`);
      break;
    }
    case "move":
    case "add": {
      const t = rest.split(/\s+to\s+/)[1];
      if (t !== undefined && !entity(t)) report("WARN", `${at} \`${verb} … to ${t}\` — "${t}" is not a declared ${verb === "move" ? "LOCATION" : "GROUP"}`);
      break;
    }
    case "remove": {
      const t = rest.split(/\s+from\s+/)[1];
      if (t !== undefined && !entity(t)) report("WARN", `${at} \`remove … from ${t}\` — not a declared GROUP`);
      break;
    }
    case "unlock": {
      const name = rest.slice(0, rest.lastIndexOf(" for "));
      if (m.codexIndex.get(name) === null && !m.codex.has(name)) report("ERROR", `${at} \`unlock ${name}\` — no CODEX entry by that name (does nothing)`);
      break;
    }
    case "quest_start":
    case "quest_update":
    case "quest_complete":
    case "quest_fail": {
      const head = rest.replace(/\s+"(?:[^"\\]|\\.)*"\s*$/, "");
      const name = head.slice(0, head.lastIndexOf(" for "));
      if (m.questIndex.get(name) === null && !m.quests.has(name)) report("ERROR", `${at} \`${verb.replace("quest_", "")} quest ${name}\` — no QUEST by that name (does nothing)`);
      break;
    }
    case "reveal": {
      // `reveal X [for who] quietly` / `reveal X quietly for who` (wave
      // 18b): the word is no name.
      const { body } = splitRevealQuietly(rest);
      const f = body.lastIndexOf(" for ");
      const t = (f >= 0 ? body.slice(0, f) : body).trim();
      if (t !== "self" && t !== ctx.param && !entity(t) && !m.channels.has(`room:${t}`)) report("WARN", `${at} \`reveal ${t}\` — not a declared GROUP / LOCATION / CHARACTER / CHANNEL (does nothing)`);
      break;
    }
    case "show": {
      const kind = rest.split(/\s+/)[0] ?? "";
      if (!SHOW_KINDS.has(kind)) report("WARN", `${at} \`show ${kind}\` — the play app has no "${kind}" card (known: ${[...SHOW_KINDS].join(", ")})`);
      const to = /\s+to\s+(\S+)/.exec(rest.replace(/"(?:[^"\\]|\\.)*"/g, '""'));
      if (to && to[1] !== undefined && !/\(/.test(to[1]) && !["everyone", "all", "story", "world", "room", "party"].includes(to[1]) && to[1] !== ctx.param && !subjectNames.has(to[1]))
        report("WARN", `${at} \`show … to ${to[1]}\` — "${to[1]}" is not bound here; the card reaches nobody`);
      break;
    }
    case "wait":
    case "spawn":
    case "cancel":
    case "run":
      report("WARN", `${at} \`${verb} ${rest}\` — recorded only; the live Sim does not wait / start / stop anything`);
      break;
  }
}

function walkBody(items: any[], at: (l: number) => string, ctx: { param: string | null; speaksPublic?: string }): void {
  for (const it of items) {
    const here = at(it.value?.span?.start?.line ?? it.value?.directive?.span?.start?.line);
    switch (it.kind) {
      case "action": {
        const t = String(it.value.value).trim();
        if (/^when\s.+:$/.test(t)) report("ERROR", `${here} \`${t}\` is inside a beat, so it is PROSE, not a story rule — put rules BEFORE the first beat of a file (the server concatenates files, so a rule at the top of the file after a beat-ending file is swallowed too)`);
        break;
      }
      case "dialogue":
        if (ctx.speaksPublic) report("INFO", `${here} \`${it.value.speaker}:\` in a hook bound as \`${ctx.speaksPublic}\` — not a subject name (${[...subjectNames].join("/")}), so this line is PUBLIC (lobby / room), not a DM`);
        walkBody(it.value.body, at, ctx);
        break;
      case "choice":
        walkBody(it.value.body, at, ctx);
        break;
      case "directive":
        checkDirective(it.value.raw, here, ctx);
        break;
      case "directiveBlock":
        checkDirective(it.value.directive.raw, here, ctx);
        walkBody(it.value.body, at, ctx);
        break;
      case "conditional":
        for (const a of it.value.arms) walkBody(a.body, at, ctx);
        break;
      case "match":
        for (const a of it.value.arms) walkBody(a.body, at, ctx);
        break;
      case "eachVisit":
        walkBody(it.value.first, at, ctx);
        walkBody(it.value.then, at, ctx);
        walkBody(it.value.finally, at, ctx);
        break;
      case "afterMorph":
        if (/^\d+(\.\d+)?(ms|s|m)?$/.test(it.value.condition.trim())) report("ERROR", `${here} \`after ${it.value.condition}:\` inside a body is a CONDITION block (after cond: / otherwise:), not a delay — it always takes the otherwise arm`);
        walkBody(it.value.after, at, ctx);
        walkBody(it.value.otherwise, at, ctx);
        break;
      case "divert": {
        const d = it.value;
        if (d.kind === "tunnel") report("WARN", `${here} tunnel \`(${d.target.name}) ->\` does nothing in the live Sim`);
        if (d.kind === "end") report("INFO", `${here} \`-> END\` is inert in the live Sim (lines after it still run)`);
        if ((d.kind === "to" || d.kind === "tunnel") && !beatExists(d.target.qualifier, d.target.name))
          report("ERROR", `${here} divert to \`${d.target.qualifier ? d.target.qualifier + "." : ""}${d.target.name}\` — no such beat`);
        break;
      }
    }
  }
}

for (const [key, beat] of m.beats as Map<string, any>) {
  walkBody(beat.body, where, { param: null });
  const setting = beat.contract.get("setting")?.value;
  if (setting !== undefined && !m.locations.has(setting) && m.entityIndex.get(setting) === null) report("WARN", `${where(beat.span.start.line)} beat \`${key}\` setting: ${setting} — not a declared LOCATION (lines fall back to the lobby)`);
  for (const c of String(beat.contract.get("cast")?.value ?? "").split(",").map((s) => s.trim()).filter(Boolean))
    if (!entity(c)) report("WARN", `${where(beat.span.start.line)} beat \`${key}\` cast: ${c} — not declared`);
}
for (const h of allHooks) {
  const owner = h.ownerKind === "story" ? "story rule" : `${h.ownerKind} ${h.ownerId}`;
  // Hook bodies are re-lowered from raw lines, so their spans are body-relative: name the hook instead.
  const at = (_l: number): string => `[${owner} · when ${h.event}]`;
  const pub = h.param !== null && !subjectNames.has(h.param) && h.ownerKind !== "role" ? h.param : undefined;
  walkBody(h.body, at, { param: h.param, speaksPublic: pub });
  if (h.ownerKind === "character" && h.timer === null && h.condition === null && h.param === "answered")
    report("WARN", `[${owner} · when ${h.event}] reads as the event "${h.verb}" with a parameter named "answered", so it never hears the card — inside a CHARACTER / TRAIT write \`when ${h.verb} answered for who:\``);
  if (h.ownerKind === "role" && h.timer !== null) report("ERROR", `[role ${h.ownerId} · ${h.event}] a timer on a ROLE never fires — put \`every …\` / \`after …\` on a CHARACTER or as a story rule (\`when every 60s:\`)`);
  if (h.filter !== null && h.timer === null && h.condition === null) {
    const f = h.filter;
    const ok = entity(f) || m.codexIndex.get(f) !== null || m.questIndex.get(f) !== null;
    if (!ok) report("WARN", `[${owner} · when ${h.event}] filter "${f}" matches no LOCATION / GROUP / CODEX / QUEST (a name with a lowercase or filler word — "of", "the", "at" — cannot be a trigger filter)`);
  }
}
// Wave 25: the project's desk.json (the house desk, `src/house-desk.ts`)
// fires its `event` steps and `done`s as story events, so a `when` rule a
// desk cue drives counts as fired. Its cue ids are what `cue <id>` plays; no
// lint flags an unknown `cue`, so nothing more is needed for those.
{
  const deskPath = join(root, DESK_FILE);
  let text: string | null = null;
  try {
    text = readFileSync(deskPath, "utf8");
  } catch {
    text = null;
  }
  if (text !== null && text.trim() !== "") {
    let raw: unknown = null;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      report("ERROR", `${DESK_FILE}: not JSON (${err instanceof Error ? err.message : String(err)})`);
    }
    if (raw !== null) {
      const v = validateDesk(raw);
      for (const p of v.problems) report("ERROR", `${DESK_FILE}: ${p}`);
      if (v.ok) for (const e of deskEvents(raw as DeskConfig)) if (!fired.has(foldName(e))) fired.set(foldName(e), DESK_FILE);
    }
  }
}

// Only once every beat, hook, rule and watcher body has been walked (a rule
// fires what an earlier-walked character hook hears): named events that
// nothing in the story fires and no button offers.
for (const h of allHooks) {
  const owner = h.ownerKind === "story" ? "story rule" : `${h.ownerKind} ${h.ownerId}`;
  if (h.timer === null && h.condition === null && h.verb !== "" && !isBuiltinVerb(h.verb) && !m.interactions.has(h.verb) && ![...m.interactions.keys()].some((k: string) => foldName(k) === foldName(h.verb))) {
    if (!/ answered$/.test(h.verb) && h.verb !== "wrong code" && !fired.has(foldName(h.verb))) report("INFO", `[${owner}] \`when ${h.event}\` → named event "${h.verb}" is only fired by the director / hardware (no INTERACTION, no \`fire\`) `);
  }
}

// Typed slots that look like defaults but are not (no `=`).
const [cfile] = parse(concat);
for (const item of cfile.items) {
  if (item.kind !== "declaration") continue;
  const d = item.value;
  const body = d.character;
  if ((d.kind === "character" || d.kind === "role") && body) {
    for (const p of body.typedProperties) {
      if (["hidden", "listed", "playable", "mind", "avatar", "wiki", "faction", "label", "stats", "joinable", "secret", "reserved", "busy", "admin", "crawl"].includes(p.name)) continue;
      if (p.default === null && p.rawType !== null && /^(true|false|-?\d+(\.\d+)?)$/.test(p.rawType.trim()))
        report("WARN", `${where(p.span.start.line)} ${d.kind.toUpperCase()} ${d.name}: \`${p.name}: ${p.rawType}\` seeds NO value — write \`${p.name}: bool = ${p.rawType}\` / \`${p.name}: 0 to 100 = ${p.rawType}\``);
    }
  }
}

// Raw-text checks the AST cannot show: contract lines at column 0, and
// lowercase `key: value` lines inside a beat (dropped, and they swallow the next line).
for (const f of files) {
  const lines = f.source.split("\n");
  let inBeat = false;
  let contractZone = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const t = raw.trim();
    if (/^==\s*\S/.test(t)) {
      inBeat = true;
      contractZone = true;
      continue;
    }
    if (/^(CHARACTER|ROLE|TRAIT|ITEM|LOCATION|FACTION|GROUP|STATS|TREE|GENERATOR|SCENE|COHORT|PERSON|ROSTER|SPACE|CHANNEL|INTERACTION|CODEX|QUEST)\b/.test(raw)) inBeat = false;
    if (t !== "" && !t.startsWith("//") && VERB_PROSE.test(t) && statementToDirective(t) === null)
      report("WARN", `${f.path}:${i + 1} "${t.slice(0, 70)}" reads as PROSE — the verb failed its shape (\`fire\` takes ONE token: fire the_golden_duck; \`cue x, k: v\` → \`do cue x, k: v\`; \`move/add … to\`, \`remove … from\`, \`unlock/… quest X for who\`)`);
    if (!inBeat || t === "" || t.startsWith("//")) continue;
    const prop = /^([a-z][a-z0-9_]*):\s+\S/.exec(t);
    if (contractZone) {
      if (prop && raw.startsWith(" ")) continue; // an indented contract line
      if (prop && (prop[1] === "setting" || prop[1] === "cast")) {
        report("ERROR", `${f.path}:${i + 1} \`${prop[1]}:\` at column 0 under a beat is NOT its contract — indent it under the \`==\` line (it is dropped and eats the next line)`);
        contractZone = false;
        continue;
      }
      contractZone = false;
    }
    if (prop && !["slot", "first", "then", "finally", "otherwise"].includes(prop[1]!) && !/^(if|else|match|each|after|set|cue|show|fire|reply|move|add|remove|reveal|unlock|broadcast|do)\b/.test(t))
      report("ERROR", `${f.path}:${i + 1} \`${t.slice(0, 50)}\` is a lowercase \`key: value\` line inside a beat — the parser DROPS it and also skips the following line`);
  }
}

// ---- 6. optional smoke run ------------------------------------------------
if (smoke) {
  const s = new Sim(m);
  const out: any[] = [];
  if (m.entry !== null) out.push(...s.fireBeat(m.entry));
  out.push(...s.createPerson("smoke-1", "Smoke One"));
  out.push(...s.createPerson("smoke-2", "Smoke Two"));
  for (let i = 0; i < 60; i++) out.push(...s.tick(5000));
  const diags = out.filter((e) => e.type === "diagnostic");
  for (const d of diags) report("WARN", `smoke: ${d.message}`);
  const types = new Map<string, number>();
  for (const e of out) types.set(e.type, (types.get(e.type) ?? 0) + 1);
  console.log(`SMOKE start beat + 2 guests + 5 min of clock → ${out.length} events: ${[...types].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`SMOKE pending choices: ${JSON.stringify(s.allPendingChoices())}`);
}

console.log(`\n${files.length} files · ${errors} error(s) · ${warns} warning(s)`);
process.exit(errors > 0 ? 1 : 0);
