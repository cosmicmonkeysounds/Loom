//! show-page — the crew's show book for *Trapped in the Internet*, one
//! standalone HTML file (wave 22).
//!
//! The prose lives in a hand-written template
//! (`<example>/show-page/template.html`: the synopsis, the acts, the
//! endings, the tech, the checklists, the open questions). Everything that
//! drifts when the story changes is generated here from the source the
//! event server plays, so the page never disagrees with the show:
//!
//!   <!-- @counts -->     how big the story is (beats, cues, codex, …)
//!   <!-- @cues -->       the admin cue sheet in running order, by act
//!                        (`cueRows` / `cueActs`, the Director page's own
//!                        grouping: carried-forward and rejoined acts)
//!   <!-- @beats -->      every `==` beat, by the file (and act) it lives in
//!   <!-- @cast -->       performers (host / player), actors from
//!                        `cast-packs/README.md`, featured + pool programs,
//!                        voices and props, the agent
//!   <!-- @rooms -->      every LOCATION ↔ the house's real rooms and floors
//!   <!-- @terminals -->  every terminal spot on `house.json`
//!
//! and every `<li data-ck>` in the template becomes a tick box with a
//! stable id (the page remembers ticks per browser).
//!
//! **Secrets never reach the page.** `showSecrets` collects the keypad code,
//! the hunt answers and their aliases, the pickup line, every codex unlock
//! code (the digit notes included) and the patch-bay combinations (each
//! pair too) from the source; `redact` blanks any of them inside generated
//! text (a cue label naming an answer reads `▒▒▒`). The hand-written
//! template is not redacted: `core/test/show-page.test.ts` fails if it ever
//! names one.
//!
//!   pnpm --filter @loom/core show:page [<example dir>] [--check] [--quiet]
//!
//! Writes `<example>/SHOW.html`. `--check` writes nothing and exits 1 when
//! the file on disk differs from a fresh build (like `titi:facts --check`).
//! No timestamps or commit ids go in, so the output is a pure function of
//! the source.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FACTS_FILE, parseFactsText } from "../src/facts.ts";
import { foldName } from "../src/parser/names.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { foldCode } from "../src/runtime/sim/model.ts";
import type { SimModel } from "../src/runtime/sim/model.ts";
import { cueActs, cueRows } from "../src/cue-sheet.ts";
import type { CueInteraction } from "../src/cue-sheet.ts";
import { guestPickable, identityDefs, isSpecial } from "../src/identity-kind.ts";

// ───────────────────────── where things are ─────────────────────────

export const DEFAULT_DIR = fileURLToPath(new URL("../examples/trapped-in-the-internet/", import.meta.url));
export const TEMPLATE = "show-page/template.html";
export const OUTPUT = "SHOW.html";
const RERUN = "pnpm --filter @loom/core show:page";

/** What a blanked secret reads as in the generated text. */
export const REDACTED = "▒▒▒";

/** How a blanked secret renders on the page: a labelled chip (the legend
 *  under the cue sheet and the beats says what it means). */
export const REDACTED_CHIP = `<span class="redacted" role="img" aria-label="hidden: a hunt answer or code" title="Hidden on purpose: a hunt answer or a code">hidden</span>`;

/** Crew names for story names that hold a secret: after `redact`, the
 *  blanked name on the left reads as the name the crew says on the radio,
 *  the one the template's Endings table uses. */
export const CREW_NAMES: ReadonlyArray<readonly [string, string]> = [[`${REDACTED} Prom`, "Rival's Prom"]];

/** The beat files in the order of the night, with the part of the night
 *  each one plays. A file not listed lands under "Other files" at the end,
 *  so a new beat file still shows (its name says where it came from). */
export const BEAT_FILES: ReadonlyArray<{ path: string; part: string }> = [
  { path: "main.loom", part: "Opening (the doors)" },
  { path: "beats/login.loom", part: "A · Arrival" },
  { path: "cast/kit.loom", part: "A · Arrival (the Antivirus' clearance, owned by the performers)" },
  { path: "cast/hosts.loom", part: "A · Arrival (the hosts' and Clippy's greetings)" },
  { path: "codex/85-ties.loom", part: "A · Arrival (each program's briefing)" },
  { path: "beats/desktop.loom", part: "B · Act I: the Desktop and Bingo" },
  { path: "beats/hunt.loom", part: "B · Act I: hunt 1, the results, the bottle" },
  { path: "beats/internet.loom", part: "Any time · the reinstallation (the tent)" },
  { path: "beats/malware.loom", part: "C · The malware, the hour, the Truther Download" },
  { path: "beats/pong.loom", part: "D · Act II: summons, Truth Pong, Trust Chart, printer" },
  { path: "beats/overshare.loom", part: "D–E · The overshare and the Y2K clock" },
  { path: "beats/server-room.loom", part: "E · Act III: the majority, The Heart, the patch bay" },
  { path: "beats/staff.loom", part: "Any time · staff defection" },
  { path: "beats/finale.loom", part: "F · The final reveal and the endings" },
  { path: "beats/review.loom", part: "G · The Night In Review" },
  { path: "beats/ceremony.loom", part: "G · The awards ceremony" },
  { path: "generated/questions.loom", part: "Generated from facts.json (hunt readings, seeds)" },
  { path: "codex/9-facts.loom", part: "Generated from facts.json (the majority's bundle)" },
];

// ───────────────────────── loading the show ─────────────────────────

export interface ShowFile {
  path: string;
  source: string;
}

interface HouseRoom {
  id: string;
  label?: string;
  floor: string;
  location?: string;
}
interface HouseTerminal {
  id: string;
  name?: string;
  room?: string;
  view?: string;
  speaks?: boolean;
  voice?: boolean;
}
interface House {
  floors: Array<{ id: string; label?: string }>;
  rooms: HouseRoom[];
  terminals?: HouseTerminal[];
}

export interface Show {
  dir: string;
  files: ShowFile[];
  model: SimModel;
  house: House;
  /** cast-packs/README.md, for the actors' names (empty when missing). */
  castReadme: string;
  /** facts.json as text (null when missing). */
  factsText: string | null;
}

/** Every `.loom` file, `main.loom` first then by path — the order the
 *  server concatenates them in (`examples/load.ts`, `loomcheck`). */
function loomFiles(dir: string): ShowFile[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSyncSorted(d)) {
      const f = join(d, n);
      if (isDir(f)) walk(f);
      else if (n.endsWith(".loom")) out.push(f);
    }
  };
  walk(dir);
  return out
    .map((f) => ({ path: relative(dir, f).split("\\").join("/"), source: readFileSync(f, "utf8") }))
    .sort((a, b) => (a.path === "main.loom" ? 0 : 1) - (b.path === "main.loom" ? 0 : 1) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function readdirSyncSorted(d: string): string[] {
  return readdirSync(d).sort();
}
function isDir(f: string): boolean {
  return statSync(f).isDirectory();
}

/** The concatenated source, exactly as the server builds it. */
export function concatSource(files: readonly ShowFile[]): string {
  return files.map((f) => `# ── ${f.path} ${"─".repeat(Math.max(0, 60 - f.path.length))}\n${f.source}`).join("\n\n");
}

export function loadShow(dir: string = DEFAULT_DIR): Show {
  const files = loomFiles(dir);
  const model = Sim.fromSources(concatSource(files)).model;
  const house = JSON.parse(readFileSync(join(dir, "house.json"), "utf8")) as House;
  const readme = join(dir, "cast-packs/README.md");
  const facts = join(dir, FACTS_FILE);
  return {
    dir,
    files,
    model,
    house,
    castReadme: existsSync(readme) ? readFileSync(readme, "utf8") : "",
    factsText: existsSync(facts) ? readFileSync(facts, "utf8") : null,
  };
}

// ───────────────────────── secrets ─────────────────────────

/** A numeric alias this short ("11") is not an answer by itself and would
 *  blank every clock time on the page; the answer it stands for ("11
 *  years", the key's own words) is still checked. */
const SHORT_NUMBER = /^\d{1,2}$/u;

/**
 * Everything that must never be printed on the page, from the source (so
 * a changed combo, code or answer key is picked up on the next build):
 * the keypad code; every hunt answer, its aliases and its codex code; the
 * pickup line; every scannable fact's code; every codex `code:` in the
 * story (raw and folded — the digit notes are among them); and every
 * `set Kernel.combo_* = "…"` string plus each of its pairs.
 */
export function showSecrets(show: Show): string[] {
  const out = new Set<string>();
  const named = titleNamedCodes(show.model);
  const add = (s: string | null | undefined): void => {
    const t = (s ?? "").trim();
    if (t.length < 2 || SHORT_NUMBER.test(t)) return;
    if (named.has(foldCode(t))) return;
    out.add(t);
  };
  if (show.factsText !== null) {
    const f = parseFactsText(show.factsText).facts;
    if (f !== null) {
      add(f.door?.code);
      for (const c of f.door?.clues ?? []) add(c.code);
      for (const q of f.questions) {
        add(q.answer);
        for (const a of q.accept) add(a);
        add(q.codex?.code);
      }
      for (const a of f.answers) {
        add(a.answer);
        for (const x of a.accept) add(x);
      }
      for (const x of f.facts) {
        add(x.code);
        add(x.codex?.code);
      }
    }
  }
  const comboSeed = /^\s*set\s+Kernel\.combo_[a-z0-9_]+\s*=\s*"([^"]*)"/gmu;
  const codeLine = /^\s*code:\s*(\S.*?)\s*$/gmu;
  for (const file of show.files) {
    for (const m of file.source.matchAll(comboSeed)) {
      add(m[1]);
      for (const pair of m[1]!.split(",")) add(pair);
    }
    for (const m of file.source.matchAll(codeLine)) add(m[1]);
  }
  return [...out].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
}

/**
 * The folded unlock codes the page may still spell: a public (not `secret:
 * true`) codex entry whose code is its own title's words (*The Trust Chart*
 * → `TRUST-CHART`, *Target Selection* → `TARGET-SELECTION`). Its title
 * is the show's name for the thing, so no page could avoid it; the code
 * unlocks only what the title already says. A secret entry, or a code that
 * is not in its title (*The Prom Ticket* → `COMPUTER-PROM`), stays blanked.
 */
export function titleNamedCodes(model: SimModel): Set<string> {
  const out = new Set<string>();
  for (const c of model.codex.values()) {
    if (c.code === null || c.secret) continue;
    if (foldCode(c.title).includes(c.code)) out.add(c.code);
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** One secret as a pattern, as loose as the Codex box's `foldCode`: case
 *  never counts, and any run of spaces, dashes and underscores (or none) may
 *  sit between any two characters, so `COMPUTER-PROM` also catches
 *  "computer prom" and "computerprom", every form a guest could type. An
 *  apostrophe matches either apostrophe or none. Never inside a longer word
 *  or number (so the year 1999 never trips on a code ending in 99). */
export function secretPattern(secret: string): RegExp {
  const chars = [...secret.replace(/[\s_-]+/gu, "")];
  const body = chars.map((c) => (c === "'" || c === "’" ? "['’]?" : escapeRe(c))).join("[\\s_\\-]*");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}

/** Blank every secret in `text`. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) out = out.replace(secretPattern(s), REDACTED);
  return out;
}

/** `redact`, then the crew's name for a blanked story name (`CREW_NAMES`). */
export function crewText(text: string, secrets: readonly string[]): string {
  let out = redact(text, secrets);
  for (const [from, to] of CREW_NAMES) out = out.replaceAll(from, to);
  return out;
}

/** `crewText` as page HTML: escaped, every remaining blank a chip. */
export function crewHtml(text: string, secrets: readonly string[]): string {
  return esc(crewText(text, secrets)).replaceAll(REDACTED, REDACTED_CHIP);
}

/** The secrets `text` still names (the test's check). */
export function secretsIn(text: string, secrets: readonly string[]): string[] {
  return secrets.filter((s) => secretPattern(s).test(text));
}

// ───────────────────────── html helpers ─────────────────────────

export function esc(s: string): string {
  return s.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

function slug(s: string): string {
  return foldName(s)
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
}

/** A cue's display form: the label with any secret blanked, escaped. The
 *  test looks for exactly this string, once per admin cue. */
export function cueLabelHtml(label: string, secrets: readonly string[]): string {
  return crewHtml(label, secrets);
}

// ───────────────────────── generated blocks ─────────────────────────

function adminInteractions(model: SimModel): CueInteraction[] {
  return [...model.interactions.values()].map((d) => ({
    id: d.id,
    label: d.label,
    who: d.who,
    ...(d.sequence ? {} : { sequence: false as const }),
    ...(d.repeat ? { repeat: true as const } : {}),
    ...(d.urgent === true ? { urgent: true as const } : {}),
    ...(d.act !== null ? { act: d.act } : {}),
    description: d.description,
  }));
}

function countsBlock(show: Show): string {
  const m = show.model;
  const written = beatsByFile(show.files).reduce((n, f) => n + f.beats.length, 0);
  const admin = [...m.interactions.values()].filter((i) => i.who === "admin");
  const timerish = admin.filter((i) => !i.sequence).length;
  const coded = [...m.codex.values()].filter((c) => c.code !== null).length;
  const row = (k: string, v: number | string): string => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`;
  return [
    `<dl class="counts">`,
    row("Story files", show.files.length),
    row("Beats", written === m.beats.size ? written : `${m.beats.size} (${written} written; a trait's beat counts once per character that has it)`),
    row("Admin cues", `${admin.length} (${admin.length - timerish} in sequence)`),
    row("Story rules", m.rules.length),
    row("Rooms (LOCATIONs)", m.locations.size),
    row("Characters", m.characters.size),
    row("Codex entries", `${m.codex.size} (${coded} with a QR code)`),
    row("Quests", m.quests.size),
    row("Objectives", m.objectives.size),
    `</dl>`,
  ].join("\n");
}

function cuesBlock(show: Show, secrets: readonly string[]): string {
  const rows = cueRows(adminInteractions(show.model), { last: null, fired: [] });
  const defs = show.model.interactions;
  const acts = cueActs(rows);
  const out: string[] = [];
  for (const [k, act] of acts.entries()) {
    const title = act.title === null ? "Before any act" : act.code !== null ? `${act.code} · ${act.title}` : act.title;
    out.push(`<h3 class="act" id="cues-act-${k + 1}">${crewHtml(title, secrets)}</h3>`);
    out.push(
      `<p class="act-note">${act.spine.length} in sequence${act.asides.length > 0 ? `, ${act.asides.length} off the running order (timers, fallbacks, toggles)` : ""}.</p>`,
    );
    out.push(`<div class="scroll"><table class="cues"><thead><tr><th scope="col">#</th><th scope="col">Cue</th><th scope="col">Id</th><th scope="col">What it does</th></tr></thead><tbody>`);
    for (const r of act.rows) {
      const d = defs.get(r.id)!;
      const tags: string[] = [];
      if (!r.sequence) tags.push(`<span class="tag aside">off sequence</span>`);
      if (d.repeat) tags.push(`<span class="tag">repeat</span>`);
      if (d.urgent === true) tags.push(`<span class="tag urgent">urgent</span>`);
      if (d.while !== null) tags.push(`<span class="tag">has while:</span>`);
      const desc = d.description === null ? "" : crewHtml(d.description, secrets);
      out.push(
        `<tr${r.sequence ? "" : ` class="aside"`}><td class="n">${r.n}</td><td class="label">${cueLabelHtml(d.label, secrets)}${tags.length > 0 ? `<span class="tags">${tags.join("")}</span>` : ""}</td><td><code>${esc(r.id)}</code></td><td class="desc">${desc}</td></tr>`,
      );
    }
    out.push(`</tbody></table></div>`);
  }
  return out.join("\n");
}

export interface BeatRow {
  name: string;
  setting: string | null;
  /** A class-owned beat's CHARACTER or TRAIT (null for a `==` beat). */
  owner: { kind: "CHARACTER" | "TRAIT"; name: string } | null;
}

/** `== Name(params)` beats per file, with each one's `setting:`, then the
 *  class-owned ones (`beat Greet(program)` inside a CHARACTER or TRAIT),
 *  each with its owner. */
export function beatsByFile(files: readonly ShowFile[]): Array<{ path: string; beats: BeatRow[] }> {
  const out: Array<{ path: string; beats: BeatRow[] }> = [];
  for (const f of files) {
    const beats: BeatRow[] = [];
    const owned: BeatRow[] = [];
    let cur: BeatRow | null = null;
    let owner: BeatRow["owner"] = null;
    for (const line of f.source.split("\n")) {
      const head = /^==\s+(.+?)\s*$/u.exec(line);
      if (head !== null) {
        cur = { name: head[1]!.replace(/\(.*\)\s*$/u, "").trim(), setting: null, owner: null };
        beats.push(cur);
        owner = null;
        continue;
      }
      const decl = /^(CHARACTER|TRAIT)\s+(.+?)(?:\s+is\s+.*|\(.*)?\s*$/u.exec(line);
      if (decl !== null) {
        owner = { kind: decl[1] as "CHARACTER" | "TRAIT", name: decl[2]!.trim() };
        cur = null;
        continue;
      }
      if (/^[A-Z]/u.test(line)) owner = null;
      const ownedBeat = /^\s+beat\s+([A-Z][^(\n:]*?)\s*(?:\(|:|$)/u.exec(line);
      if (ownedBeat !== null && owner !== null) {
        owned.push({ name: ownedBeat[1]!.trim(), setting: null, owner });
        continue;
      }
      const set = /^\s*setting:\s*(.+?)\s*$/u.exec(line);
      if (cur !== null && cur.setting === null && set !== null) cur.setting = set[1]!;
    }
    beats.push(...owned);
    if (beats.length > 0) out.push({ path: f.path, beats });
  }
  return out;
}

/** The characters that carry a TRAIT's beat (`<Character>.<beat>` keys). */
function traitCarriers(model: SimModel, beat: string): string[] {
  return [...model.beats.keys()].filter((k) => k.endsWith(`.${beat}`)).map((k) => k.slice(0, -beat.length - 1));
}

function beatRowHtml(b: BeatRow, model: SimModel, secrets: readonly string[]): string {
  const name = `<span class="beat">${crewHtml(b.name, secrets)}</span>`;
  if (b.owner === null) return `${name}${b.setting !== null ? ` <span class="setting">${crewHtml(b.setting, secrets)}</span>` : ""}`;
  if (b.owner.kind === "CHARACTER") return `${name} <span class="owner">owned by ${crewHtml(b.owner.name, secrets)}</span>`;
  const who = traitCarriers(model, b.name);
  return `${name} <span class="owner">TRAIT ${crewHtml(b.owner.name, secrets)}: one copy each for ${who.map((w) => crewHtml(w, secrets)).join(", ")} (×${who.length})</span>`;
}

function beatsBlock(show: Show, secrets: readonly string[]): string {
  const byFile = beatsByFile(show.files);
  const known = new Map(BEAT_FILES.map((b, i) => [b.path, i]));
  byFile.sort((a, b) => (known.get(a.path) ?? 999) - (known.get(b.path) ?? 999) || (a.path < b.path ? -1 : 1));
  const out: string[] = [];
  for (const f of byFile) {
    const part = BEAT_FILES.find((b) => b.path === f.path)?.part ?? "Other files";
    out.push(`<details class="beats"><summary><span class="part">${esc(part)}</span> <code>${esc(f.path)}</code> <span class="count">${f.beats.length} beat${f.beats.length === 1 ? "" : "s"}</span></summary>`);
    out.push(`<ol>`);
    for (const b of f.beats) out.push(`<li>${beatRowHtml(b, show.model, secrets)}</li>`);
    out.push(`</ol></details>`);
  }
  return out.join("\n");
}

/** Actor names off `cast-packs/README.md`'s performer rows:
 *  `| [performers/clippy.md](…) | Clippy (Brooke), incl. … |` → Clippy → Brooke.
 *  An `[[EDIT…]]` cell is null (not cast yet). */
export function actorsOf(readme: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const row = /^\|\s*\[`performers\/[^`]+`\]\([^)]*\)\s*\|\s*(?:the\s+)?([^(|]+?)\s*\(([^)|]*)\)?/gmu;
  for (const m of readme.matchAll(row)) {
    const name = m[1]!.trim();
    const inner = m[2]!.trim();
    const actor = inner.startsWith("[[") ? null : inner.split(/\s+—|,/u)[0]!.trim();
    out.set(foldName(name), actor === "" ? null : actor);
  }
  return out;
}

function castBlock(show: Show, secrets: readonly string[]): string {
  const m = show.model;
  const actors = actorsOf(show.castReadme);
  const actor = (id: string): string => {
    const a = actors.get(foldName(id));
    return a === undefined ? "—" : a === null ? `<span class="todo">not cast yet</span>` : esc(a);
  };
  const defs = identityDefs(m);
  const chars = [...m.characters.values()];
  const performers = chars.filter((c) => c.playable && c.mind === null && !c.secret && isSpecial(m, c.id) && (c.admin || c.player));
  const out: string[] = [];
  out.push(`<h3>Performers</h3>`);
  out.push(`<div class="scroll"><table><thead><tr><th scope="col">Part</th><th scope="col">Actor</th><th scope="col">Kind</th><th scope="col">Group</th></tr></thead><tbody>`);
  for (const c of performers) {
    const kind = c.admin ? "Host (calls cues, host dock)" : c.player ? "Player (Mission, score, trust)" : "Performer";
    out.push(`<tr><td>${esc(c.id)}</td><td>${actor(c.id)}</td><td>${esc(kind)}</td><td>${esc(c.faction ?? "—")}</td></tr>`);
  }
  out.push(`</tbody></table></div>`);

  const agents = chars.filter((c) => c.mind !== null);
  out.push(`<h3>Voiced by the model</h3><ul>`);
  for (const c of agents) out.push(`<li><strong>${esc(c.id)}</strong> (<code>mind: ${esc(c.mind!)}</code>${c.hidden ? ", offline until introduced" : ""}).</li>`);
  out.push(`</ul>`);

  const featured = defs.filter((d) => guestPickable(d) && d.reserved).map((d) => d.name);
  const pool = defs.filter((d) => guestPickable(d) && !d.reserved).map((d) => d.name);
  out.push(`<h3>Featured programs (${featured.length})</h3>`);
  out.push(`<p>Guests, never performers. Each is held for one invitee and joins from the claim QR on the invitation.</p>`);
  out.push(`<ul class="names">${featured.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`);
  out.push(`<h3>Pool programs (${pool.length})</h3>`);
  out.push(`<p>Any guest may pick one, or search the web for any other software (antivirus software is refused).</p>`);
  out.push(`<ul class="names">${pool.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`);

  const voices = chars.filter((c) => !c.playable && !c.secret && c.mind === null);
  const nameOf = (id: string): string => {
    const a = actors.get(foldName(id));
    return a ? `${esc(id)} (${esc(a)})` : esc(id);
  };
  out.push(`<h3>Voices and props (nobody signs in as these)</h3>`);
  out.push(`<ul class="names">${voices.map((c) => `<li>${nameOf(c.id)}</li>`).join("")}</ul>`);
  const hiddenCount = chars.filter((c) => c.secret).length;
  if (hiddenCount > 0) out.push(`<p class="small">Plus ${hiddenCount} hidden bookkeeping character${hiddenCount === 1 ? "" : "s"} that ${hiddenCount === 1 ? "holds" : "hold"} the night's secrets. No app and no agent ever shows ${hiddenCount === 1 ? "it" : "them"}.</p>`);
  return redact(out.join("\n"), secrets).replaceAll(REDACTED, REDACTED_CHIP);
}

/** A house.json room label with any secret dropped: the map's labels are
 *  free text (*Server Room (cold storage)* spells a codex code), and a
 *  blanked aside in brackets is dropped whole rather than left as `(▒▒▒)`. */
export function roomLabel(label: string, secrets: readonly string[]): string {
  return redact(label, secrets).replaceAll(` (${REDACTED})`, "").replaceAll(`(${REDACTED})`, "").trim();
}

function roomsBlock(show: Show, secrets: readonly string[]): string {
  const floors = new Map(show.house.floors.map((f) => [f.id, f.label ?? f.id]));
  const out: string[] = [];
  out.push(`<div class="scroll"><table><thead><tr><th scope="col">LOCATION (in the story)</th><th scope="col">Real room(s)</th><th scope="col">Floor</th><th scope="col">On the phones</th></tr></thead><tbody>`);
  for (const l of show.model.locations.values()) {
    const rooms = show.house.rooms.filter((r) => r.location !== undefined && foldName(r.location) === foldName(l.id));
    const realRooms = rooms.length > 0 ? rooms.map((r) => esc(roomLabel(r.label ?? r.id, secrets))).join("<br>") : esc(roomLabel(l.label ?? "—", secrets));
    const fl = [...new Set(rooms.map((r) => floors.get(r.floor) ?? r.floor))].join(", ") || "—";
    const notes: string[] = [];
    notes.push(l.hidden ? "hidden until revealed" : "open from the start");
    if (l.cutscene) notes.push("cutscene (phone on rails)");
    if (l.prison) notes.push(l.sealed ? "prison, sealed" : "prison");
    if (!l.checkin) notes.push("no check-in sign");
    if (l.capacity !== null) notes.push(`capacity ${l.capacity}`);
    out.push(`<tr><td><strong>${esc(l.id)}</strong></td><td>${realRooms}</td><td>${esc(fl)}</td><td>${esc(notes.join("; "))}</td></tr>`);
  }
  out.push(`</tbody></table></div>`);
  return out.join("\n").replaceAll(REDACTED, REDACTED_CHIP);
}

const VIEW_NOTES: Record<string, string> = {
  auto: "idle show + corner scan box; shows the reinstallation while someone plays",
  tv: "Trabolta's face full screen, his voice, slides and cutscenes",
  face: "Trabolta's face; pilots one scanned guest",
  chess: "the King's chess board, awake all night",
  casino: "Truthcoin games, awake all night",
  reinstall: "the reinstallation wizard + web game",
  world: "the virtual house",
  mirror: "the TV's spectator view",
  shadow: "camera with ghosts",
};

function terminalsBlock(show: Show, secrets: readonly string[]): string {
  const rooms = new Map(show.house.rooms.map((r) => [r.id, r]));
  const out: string[] = [];
  out.push(`<div class="scroll"><table><thead><tr><th scope="col">Spot</th><th scope="col">Name</th><th scope="col">Room → LOCATION</th><th scope="col">View</th><th scope="col">Notes</th></tr></thead><tbody>`);
  for (const t of show.house.terminals ?? []) {
    const r = t.room === undefined ? undefined : rooms.get(t.room);
    const view = t.view ?? "auto";
    const notes: string[] = [VIEW_NOTES[view] ?? ""];
    if (t.speaks === true) notes.push("speaks the room's lines");
    if (t.voice === false) notes.push("no voice link");
    out.push(
      `<tr><td><code>${esc(t.id)}</code></td><td>${esc(redact(t.name ?? t.id, secrets))}</td><td>${esc(roomLabel(r?.label ?? t.room ?? "—", secrets))}${r?.location !== undefined ? ` → ${esc(r.location)}` : ""}</td><td><code>${esc(view)}</code></td><td>${esc(notes.filter((n) => n !== "").join("; "))}</td></tr>`,
    );
  }
  out.push(`</tbody></table></div>`);
  return out.join("\n").replaceAll(REDACTED, REDACTED_CHIP);
}

// ───────────────────────── tick boxes ─────────────────────────

/** Every `<li data-ck>` → a labelled checkbox with an id from its list's
 *  `data-list` and its own text (deduplicated), so a tick survives an edit
 *  that only adds items elsewhere. */
export function checkboxify(html: string): string {
  // Only the body: a comment or the style block naming the marker must
  // never start a match.
  const at = html.indexOf("<body");
  if (at > 0) return html.slice(0, at) + checkboxify(html.slice(at));
  const used = new Set<string>();
  let list = "list";
  return html.replace(/<ul class="check" data-list="([a-z0-9-]+)">|<li data-ck>([\s\S]*?)<\/li>/gu, (whole, l: string | undefined, body: string | undefined) => {
    if (l !== undefined) {
      list = l;
      return whole;
    }
    const text = body!.replace(/<[^>]+>/gu, " ");
    const base = `ck-${list}-${slug(text).split("-").slice(0, 6).join("-")}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return `<li><input type="checkbox" id="${id}"><label for="${id}">${body}</label></li>`;
  });
}

// ───────────────────────── the page ─────────────────────────

export const MARKERS = ["counts", "cues", "beats", "cast", "rooms", "terminals"] as const;

export function buildShowPage(dir: string = DEFAULT_DIR): string {
  const show = loadShow(dir);
  const secrets = showSecrets(show);
  const template = readFileSync(join(dir, TEMPLATE), "utf8");
  const blocks: Record<(typeof MARKERS)[number], string> = {
    counts: countsBlock(show),
    cues: cuesBlock(show, secrets),
    beats: beatsBlock(show, secrets),
    cast: castBlock(show, secrets),
    rooms: roomsBlock(show, secrets),
    terminals: terminalsBlock(show, secrets),
  };
  let page = template;
  for (const k of MARKERS) {
    const marker = `<!-- @${k} -->`;
    if (!page.includes(marker)) throw new Error(`show-page: the template has no ${marker}`);
    page = page.split(marker).join(blocks[k]);
  }
  page = page.replace("<!-- @banner -->", `<!-- GENERATED by core/scripts/show-page.ts from the story + show-page/template.html — DO NOT EDIT.\n     Edit the template or the story, then: ${RERUN} -->`);
  return checkboxify(page);
}

function main(argv: readonly string[]): number {
  const check = argv.includes("--check");
  const quiet = argv.includes("--quiet");
  const arg = argv.find((a) => !a.startsWith("--"));
  const dir = arg === undefined ? DEFAULT_DIR : resolve(arg);
  const page = buildShowPage(dir);
  const out = join(dir, OUTPUT);
  const now = existsSync(out) ? readFileSync(out, "utf8") : null;
  if (check) {
    if (now !== page) {
      console.error(`show-page: ${OUTPUT} is out of date — run ${RERUN}`);
      return 1;
    }
    if (!quiet) console.log(`show-page: ${OUTPUT} is up to date`);
    return 0;
  }
  if (now !== page) writeFileSync(out, page);
  if (!quiet) console.log(`show-page: ${now === page ? "unchanged" : "wrote"} ${out} (${Math.round(page.length / 1024)} KB)`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
