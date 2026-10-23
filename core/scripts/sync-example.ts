//! Push an example story from `core/examples/<name>/` into a server
//! project, and restart the project's running event on the new text.
//!
//!   pnpm sync-example "Untitled Project"                # default example
//!   pnpm sync-example <project id> escape-the-internet
//!   pnpm sync-example "Untitled Project" --server http://localhost:7000
//!   pnpm sync-example "Trapped" --i-know-this-is-live    # reload a live show anyway
//!   LOOM_I_KNOW_THIS_IS_LIVE=1 pnpm dev --sync "Trapped" # the same, where a flag can't reach
//!
//! Dev tooling for the SaaS path: the editor's Run mode plays a *snapshot*
//! of the project (`event.scenario_source`), so editing the example folder
//! on disk changes nothing until it lands in `project_file` and the event
//! is reloaded. This does both, straight against Postgres (`DATABASE_URL`,
//! default `loom_dev`) and the event server's mod API (the event's own mod
//! code, read from the row). Files the example no longer has are removed
//! from the project. A reload cuts every guest's session — they re-join.
//!
//! **A live event is guarded** (OCT31 §3: never after doors). When the
//! event's mode is `live` and its roster holds a real guest (not a
//! director's persona — `core/scripts/live-guard.ts`), the project's files
//! are still written but the event is left alone — its snapshot untouched,
//! no reload — and the script exits **3**: Push draft from Run (typed
//! confirm) instead, or re-run with `--i-know-this-is-live`. `--no-reload`
//! is guarded the same way: the next process restart (a crash, a release)
//! plays the row's snapshot, maps and facts key included. A live event
//! whose roster can't be read (the server doesn't answer, or its mod state
//! carries no roster) is refused the same way. A preview (the rehearsal
//! run) is never guarded.
//!
//! The example's house maps (`house.json`, `house.<variant>.json`) are
//! project files too (SW-MAP-01), snapshotted on the event row and handed to
//! the reload like the `.loom` files — but the **project's copy wins**: a map
//! surveyed on the map page and kept with "Save to project" lives there, and
//! the repo's copy is usually older. So by default an example map is only
//! added when the project lacks that file; a project map that differs is
//! kept (both versions summarised). `--replace-maps` makes the project's maps
//! the example's (any project map it changes or deletes is copied to a temp
//! directory first, printed); `--keep-maps` touches no map at all. An example
//! map that doesn't validate stops the sync before anything is written.
//!
//! The example's `facts.json` (the facts judge's key, `server/facts.ts`) is
//! a project file too, snapshotted on the row beside the maps and handed to
//! the reload as `facts` — but unlike a map it is **always replaced**: it is
//! generated from the repo (`titi-facts`), never surveyed in the project. An
//! example with no `facts.json` removes the project's copy.
//!
//! The example's `audio.json` (the house speakers, `server/audio.ts`, wave
//! 17) follows a map's rules on **its own switch**: placed in the map editor
//! and kept with "Save to project", so the project's copy wins by default
//! (added only when the project has none, a differing one kept and
//! summarised). The map switches never touch it — the runbooks run
//! `--replace-maps` whenever a map changes, and that must not swap a
//! surveyed speaker layout for the repo's DRAFT starter. `--replace-audio`
//! replaces it (the project's copy backed up to a temp directory first; an
//! example with none removes the project's), `--keep-audio` leaves it alone.
//! It rides the row's snapshot and the reload as `audio`.
//!
//! The example's `lights.json` (the house lights, `server/lights.ts`, wave
//! 20) follows the same rules on **its own** switch: the project's copy wins
//! (added only when the project has none), `--replace-lights` replaces it
//! (backed up first; an example with none removes the project's),
//! `--keep-lights` leaves it alone. Neither the map nor the audio switches
//! touch it. It rides the row's snapshot and the reload as `lights`.

import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { scenarioDir, scenarioFactsFile, scenarioFiles, scenarioMapFiles } from "../examples/load.ts";
import { isMapFile, mapProblems, mapSummary, planMapSync, type MapFiles, type MapSyncMode } from "../server/house-maps.ts";
import { FACTS_FILE, factsProblems } from "../server/facts.ts";
import { AUDIO_FILE, audioProblems } from "../server/audio.ts";
import { LIGHTS_FILE, lightsProblems } from "../server/lights.ts";
import { LIVE_OVERRIDE, reloadVerdict, type GuardRow } from "./live-guard.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://127.0.0.1:5432/loom_dev";
/** The environment spelling of `--i-know-this-is-live` (see `syncOptions`). */
export const LIVE_OVERRIDE_ENV = "LOOM_I_KNOW_THIS_IS_LIVE";

function usage(): never {
  process.stderr.write(
    `usage: sync-example <project name | id> [example=trapped-in-the-internet] [--server URL] [--no-reload] [--keep-maps | --replace-maps] [--keep-audio | --replace-audio] [--keep-lights | --replace-lights] [--${LIVE_OVERRIDE}]   (or ${LIVE_OVERRIDE_ENV}=1)\n`,
  );
  process.exit(2);
}

/** The event row the sync works on. */
export interface SyncEvent {
  id: string;
  mode: string;
  status: string;
  event_code: string;
  prime_code: string;
  mod_code: string;
}

/** The event half of a sync (`reloadEvent`). */
export interface ReloadStep {
  /** The event server's origin (the public one through sync-show). */
  server: string;
  event: SyncEvent;
  /** `--i-know-this-is-live`. */
  override: boolean;
  /** False for `--no-reload`: write the snapshot, skip the restart. The
   *  guard still runs — a running event's next process restart (a crash,
   *  `release.sh`) plays the row's maps and facts key, so a snapshot
   *  written under a live show swaps them mid-night all the same. */
  reload?: boolean;
  /** Write the row's snapshot (`scenario_source` + `house_maps`). */
  saveSnapshot: () => Promise<void>;
  /** The `/api/mod/load` body. */
  body: unknown;
  out?: (line: string) => void;
}

/** Printed under a refusal: the flag can't get through `pnpm dev --sync`. */
const OVERRIDE_HINT = `  (exit 3 · through \`pnpm dev --sync\` or \`pnpm sync-example\`, which can't pass --${LIVE_OVERRIDE}: ${LIVE_OVERRIDE_ENV}=1)`;

/** The mod state's roster, or null when it carries none. */
function rosterOf(body: unknown): GuardRow[] | null {
  const roster = (body as { roster?: unknown } | null)?.roster;
  return Array.isArray(roster) ? (roster as GuardRow[]) : null;
}

/** A mod token from the event's own mod code, or null when the server doesn't answer. */
async function modLogin(at: string, passcode: string): Promise<string | null> {
  const login = await fetch(`${at}/api/mod/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode }),
  }).catch(() => null);
  if (login === null || !login.ok) return null;
  return ((await login.json()) as { token: string }).token;
}

/**
 * Save the event's snapshot and restart it on the new text — unless it is
 * a live show with real guests (see the header), which keeps both its
 * snapshot and its runtime, `--no-reload` or not. Returns the exit code:
 * 0, or 3 when a live event was left alone.
 */
export async function reloadEvent(step: ReloadStep): Promise<number> {
  const out = step.out ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const { event, server } = step;
  const at = `${server}/e/${encodeURIComponent(event.id)}`;
  let token: string | null = null;
  if (event.mode === "live" && !step.override) {
    // Read the roster BEFORE touching anything: a reload signs every guest out.
    token = await modLogin(at, event.mod_code);
    const st = token === null ? null : await fetch(`${at}/api/state?role=mod`, { headers: { "x-loom-token": token } }).catch(() => null);
    // A 200 without a roster array (a changed view, a proxy's error page)
    // is as unreadable as a refusal: a live event is never reloaded blind.
    const roster = st === null || !st.ok ? null : await st.json().then((b: unknown) => rosterOf(b), () => null);
    if (roster === null) {
      const why = st === null ? `the server at ${server} doesn't answer` : !st.ok ? `mod state → ${st.status}` : "the mod state carries no roster";
      out(`✘ live event ${event.id}: its roster can't be read (${why}) — the project's files are saved, the event's snapshot is untouched and it was NOT reloaded`);
      out(OVERRIDE_HINT);
      return 3;
    }
    const verdict = reloadVerdict({ mode: event.mode, roster, override: false });
    if (!verdict.ok) {
      out(`✘ ${verdict.reason}`);
      out(OVERRIDE_HINT);
      return 3;
    }
  }
  await step.saveSnapshot();
  const codes = `codes: guest ${event.event_code} · performer ${event.prime_code} · mod ${event.mod_code}`;
  if (step.reload === false) {
    out(`✓ event ${event.id} (${event.mode}, ${event.status}) snapshot updated, not reloaded (--no-reload) — ${codes}`);
    // The files were written straight into the database: without a resync
    // an open editor tab keeps the pre-sync text and its writer's next
    // keystroke is dropped (T4 recheck). `/api/mod/resync` folds the rows
    // into the open docs with no restart.
    token ??= await modLogin(at, event.mod_code);
    const resync =
      token === null
        ? null
        : await fetch(`${at}/api/mod/resync`, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: "{}" }).catch(() => null);
    // A 200 says `resynced: false` when the event has no project link (a LAN
    // default event, an old row): nothing was folded, so no ✓ (review 2).
    const resynced = resync !== null && resync.ok ? ((await resync.json().catch(() => null)) as { resynced?: unknown } | null)?.resynced === true : false;
    if (resync !== null && resync.ok) {
      out(resynced ? "✓ open editor tabs now show the synced files (resynced, no restart)" : "  (no co-editing docs to resync: the event has no project link)");
    } else {
      const why = token === null || resync === null ? `the server at ${server} doesn't answer` : `resync → ${resync.status}`;
      out(`⚠ open editor tabs still hold the pre-sync text (${why}): close and reopen them before typing, or a keystroke there is lost`);
    }
    return 0;
  }
  out(`✓ event ${event.id} (${event.mode}, ${event.status}) snapshot updated — ${codes}`);

  // Restart the live runtime on the new text (a real cut: guests re-join).
  token ??= await modLogin(at, event.mod_code);
  if (token === null) {
    out(`  (server at ${server} not reachable — the snapshot is saved; the event restarts on it when the server boots and you reload it)`);
    return 0;
  }
  const load = await fetch(`${at}/api/mod/load`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-loom-token": token },
    body: JSON.stringify(step.body),
  });
  if (!load.ok) throw new Error(`mod/load failed: ${load.status} ${await load.text()}`);
  out(`✓ event reloaded on the new story → ${server}/?code=${event.event_code}`);
  return 0;
}

/** The command line (and environment) a sync runs with. */
export interface SyncOptions {
  server: string;
  reload: boolean;
  override: boolean;
  mapMode: MapSyncMode;
  /** `audio.json`'s own mode (`--replace-audio` / `--keep-audio`): never the maps'. */
  audioMode: MapSyncMode;
  /** `lights.json`'s own mode (`--replace-lights` / `--keep-lights`): never the maps' or the audio's. */
  lightsMode: MapSyncMode;
  positional: string[];
}

/** The example's `audio.json` as a one-file record (none → empty); one that
 *  doesn't validate stops the sync. */
export function exampleAudio(example: string): Record<string, string> {
  const path = join(scenarioDir(example), AUDIO_FILE);
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  const problems = audioProblems(text);
  if (problems.length > 0) throw new Error(`the example's ${AUDIO_FILE} does not validate — nothing synced:\n  ${problems.join("\n  ")}`);
  return { [AUDIO_FILE]: text };
}

/**
 * What a sync does to the project's `audio.json`: `planMapSync`'s rules for
 * one file. `text` = the project's copy afterwards (null = none), `put` =
 * write it, `kept` = the project's differing copy stays, `replaced` = the
 * project text a `replace` loses (to back up). A kept copy that doesn't
 * validate stops the sync like a broken map.
 */
export function planAudioSync(project: Record<string, string>, example: Record<string, string>, mode: MapSyncMode): { text: string | null; put: boolean; kept: boolean; replaced: string | null } {
  const plan = planMapSync(project, example, mode);
  const text = plan.maps[AUDIO_FILE] ?? null;
  if (text !== null && !plan.put.includes(AUDIO_FILE)) {
    const problems = audioProblems(text);
    if (problems.length > 0) throw new Error(`the project's ${AUDIO_FILE} does not validate — nothing synced (fix it, or --replace-audio / --keep-audio):\n  ${problems.join("\n  ")}`);
  }
  return { text, put: plan.put.includes(AUDIO_FILE), kept: plan.kept.includes(AUDIO_FILE), replaced: plan.replaced.includes(AUDIO_FILE) ? (project[AUDIO_FILE] ?? null) : null };
}

/** The example's `lights.json` as a one-file record (none → empty); one that
 *  doesn't validate stops the sync. */
export function exampleLights(example: string): Record<string, string> {
  const path = join(scenarioDir(example), LIGHTS_FILE);
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  const problems = lightsProblems(text);
  if (problems.length > 0) throw new Error(`the example's ${LIGHTS_FILE} does not validate — nothing synced:\n  ${problems.join("\n  ")}`);
  return { [LIGHTS_FILE]: text };
}

/** What a sync does to the project's `lights.json`: `planAudioSync`'s rules
 *  (`planMapSync`'s for one file), its own error text. */
export function planLightsSync(project: Record<string, string>, example: Record<string, string>, mode: MapSyncMode): { text: string | null; put: boolean; kept: boolean; replaced: string | null } {
  const plan = planMapSync(project, example, mode);
  const text = plan.maps[LIGHTS_FILE] ?? null;
  if (text !== null && !plan.put.includes(LIGHTS_FILE)) {
    const problems = lightsProblems(text);
    if (problems.length > 0) throw new Error(`the project's ${LIGHTS_FILE} does not validate — nothing synced (fix it, or --replace-lights / --keep-lights):\n  ${problems.join("\n  ")}`);
  }
  return { text, put: plan.put.includes(LIGHTS_FILE), kept: plan.kept.includes(LIGHTS_FILE), replaced: plan.replaced.includes(LIGHTS_FILE) ? (project[LIGHTS_FILE] ?? null) : null };
}

/** Parse the arguments. `LOOM_I_KNOW_THIS_IS_LIVE=1` is the override for
 *  the callers that can't pass a flag through (`pnpm dev --sync`, the root
 *  `pnpm sync-example`). */
export function syncOptions(args: readonly string[], env: NodeJS.ProcessEnv = process.env): SyncOptions {
  const o: SyncOptions = {
    server: env.LOOM_SERVER ?? `http://localhost:${env.LOOM_PORT ?? 7000}`,
    reload: true,
    override: env[LIVE_OVERRIDE_ENV] === "1",
    mapMode: "merge",
    audioMode: "merge",
    lightsMode: "merge",
    positional: [],
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--server") o.server = args[++i] ?? usage();
    else if (a === "--no-reload") o.reload = false;
    else if (a === "--keep-maps") o.mapMode = "keep";
    else if (a === "--replace-maps") o.mapMode = "replace";
    else if (a === "--keep-audio") o.audioMode = "keep";
    else if (a === "--replace-audio") o.audioMode = "replace";
    else if (a === "--keep-lights") o.lightsMode = "keep";
    else if (a === "--replace-lights") o.lightsMode = "replace";
    else if (a === `--${LIVE_OVERRIDE}`) o.override = true;
    else if (a.startsWith("-")) usage();
    else o.positional.push(a);
  }
  return o;
}

/** The whole sync; resolves to the process exit code. */
export async function main(args: readonly string[]): Promise<number> {
  const { server, reload, override, mapMode, audioMode, lightsMode, positional } = syncOptions(args);
  const [projectRef, example = "trapped-in-the-internet"] = positional;
  if (!projectRef) usage();

  const files = scenarioFiles(example);
  if (files.length === 0) throw new Error(`no .loom files in example "${example}"`);
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 3000 });
  try {
    const project = (
      await pool.query<{ id: string; name: string }>(
        `select id, name from project where id = $1 or name = $1 order by created_at desc limit 1`,
        [projectRef],
      )
    ).rows[0];
    if (project === undefined) throw new Error(`no project named or with id "${projectRef}"`);

    // Maps (and audio.json): the project's copy wins unless --replace-maps
    // (--replace-audio for the speakers; see the header).
    const projectMaps: MapFiles = {};
    const projectAudio: Record<string, string> = {};
    const projectLights: Record<string, string> = {};
    for (const r of (await pool.query<{ path: string; content: string }>(`select path, content from project_file where project_id = $1`, [project.id])).rows) {
      if (isMapFile(r.path)) projectMaps[r.path] = r.content;
      else if (r.path === AUDIO_FILE && r.content.trim() !== "") projectAudio[r.path] = r.content;
      else if (r.path === LIGHTS_FILE && r.content.trim() !== "") projectLights[r.path] = r.content;
    }
    const exampleMaps: MapFiles = Object.fromEntries(scenarioMapFiles(example).map((f) => [f.path, f.source]));
    const bad = mapProblems(exampleMaps);
    if (bad !== null) throw new Error(`the example's ${bad.file} does not validate — nothing synced:\n  ${bad.problems.join("\n  ")}`);
    const plan = planMapSync(projectMaps, exampleMaps, mapMode);
    const maps = plan.maps;
    const broken = mapProblems(maps); // a kept project map the event would refuse
    if (broken !== null) {
      throw new Error(`the project's ${broken.file} does not validate — nothing synced (fix it, or --replace-maps / --keep-maps):\n  ${broken.problems.join("\n  ")}`);
    }
    if (plan.replaced.length > 0) {
      const dir = mkdtempSync(join(tmpdir(), "loom-sync-maps-"));
      for (const f of plan.replaced) writeFileSync(join(dir, f), projectMaps[f]!);
      process.stdout.write(`⚠️  replacing the project's ${plan.replaced.join(", ")} — its copies are in ${dir}\n`);
    }
    for (const f of plan.kept) {
      process.stdout.write(
        `⚠️  kept the project's ${f} (it differs from the example's — --replace-maps to overwrite it):\n` +
          `     project  ${mapSummary(projectMaps[f]!)}\n     example  ${mapSummary(exampleMaps[f]!)}\n`,
      );
    }
    // The speakers: merged like a map, on their own switch (never --replace-maps).
    const audioPlan = planAudioSync(projectAudio, exampleAudio(example), audioMode);
    const audio = audioPlan.text;
    if (audioPlan.replaced !== null) {
      const dir = mkdtempSync(join(tmpdir(), "loom-sync-audio-"));
      writeFileSync(join(dir, AUDIO_FILE), audioPlan.replaced);
      process.stdout.write(`⚠️  replacing the project's ${AUDIO_FILE} — its copy is in ${dir}\n`);
    }
    if (audioPlan.kept) process.stdout.write(`⚠️  kept the project's ${AUDIO_FILE} (it differs from the example's — --replace-audio to overwrite it)\n`);
    // The lights: likewise, on their own switch (--replace-lights).
    const lightsPlan = planLightsSync(projectLights, exampleLights(example), lightsMode);
    const lights = lightsPlan.text;
    if (lightsPlan.replaced !== null) {
      const dir = mkdtempSync(join(tmpdir(), "loom-sync-lights-"));
      writeFileSync(join(dir, LIGHTS_FILE), lightsPlan.replaced);
      process.stdout.write(`⚠️  replacing the project's ${LIGHTS_FILE} — its copy is in ${dir}\n`);
    }
    if (lightsPlan.kept) process.stdout.write(`⚠️  kept the project's ${LIGHTS_FILE} (it differs from the example's — --replace-lights to overwrite it)\n`);
    // The facts key: always the example's (generated, never edited in the project).
    const facts = scenarioFactsFile(example);
    if (facts !== null) {
      const problems = factsProblems(facts.source);
      if (problems.length > 0) throw new Error(`the example's ${FACTS_FILE} does not validate — nothing synced:\n  ${problems.join("\n  ")}`);
    }
    const pushed = [...files, ...plan.put.map((path) => ({ path, source: exampleMaps[path]! })), ...(facts !== null ? [facts] : []), ...(audioPlan.put && audio !== null ? [{ path: AUDIO_FILE, source: audio }] : []), ...(lightsPlan.put && lights !== null ? [{ path: LIGHTS_FILE, source: lights }] : [])];

    // Files: upsert every example file by path, drop the rest.
    const client = await pool.connect();
    try {
      await client.query("begin");
      const keep = [...files.map((f) => f.path), ...Object.keys(maps), ...(facts !== null ? [FACTS_FILE] : []), ...(audio !== null ? [AUDIO_FILE] : []), ...(lights !== null ? [LIGHTS_FILE] : [])];
      await client.query(`delete from project_file where project_id = $1 and not (path = any($2::text[]))`, [project.id, keep]);
      for (const f of pushed) {
        const r = await client.query(
          `update project_file set content = $3, updated_at = now() where project_id = $1 and path = $2`,
          [project.id, f.path, f.source],
        );
        if (r.rowCount === 0) {
          await client.query(`insert into project_file (id, project_id, path, content) values ($1, $2, $3, $4)`, [randomUUID(), project.id, f.path, f.source]);
        }
      }
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
    process.stdout.write(`✓ ${files.length} files of "${example}" → project "${project.name}" (${project.id})\n`);
    process.stdout.write(
      `✓ maps: ${Object.keys(maps).sort().join(", ") || "none"}` +
        (plan.put.length > 0 ? ` (written from the example: ${plan.put.join(", ")})` : " (the project's own)") +
        (plan.remove.length > 0 ? ` · removed ${plan.remove.join(", ")}` : "") +
        "\n",
    );
    process.stdout.write(facts !== null ? `✓ ${FACTS_FILE}: the example's (${facts.source.length} bytes)\n` : `✓ ${FACTS_FILE}: none in the example\n`);
    process.stdout.write(audio === null ? `✓ ${AUDIO_FILE}: none\n` : `✓ ${AUDIO_FILE}: ${audioPlan.put ? "the example's" : "the project's own"}\n`);
    process.stdout.write(lights === null ? `✓ ${LIGHTS_FILE}: none\n` : `✓ ${LIGHTS_FILE}: ${lightsPlan.put ? "the example's" : "the project's own"}\n`);
    // The row's data-file record: the maps plus the facts key, the speakers and the lights (`events-api.ts`).
    const snapshot: Record<string, string> = { ...maps, ...(facts !== null ? { [FACTS_FILE]: facts.source } : {}), ...(audio !== null ? { [AUDIO_FILE]: audio } : {}), ...(lights !== null ? { [LIGHTS_FILE]: lights } : {}) };

    // The concatenation the server uses (`db/queries.ts` projectSource).
    const source = [...files]
      .sort((a, b) => (a.path === "main.loom" ? 0 : 1) - (b.path === "main.loom" ? 0 : 1) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((f) => `# ── ${f.path} ${"─".repeat(Math.max(0, 60 - f.path.length))}\n${f.source}`)
      .join("\n\n");

    const event = (
      await pool.query<SyncEvent>(
        `select id, mode, status, event_code, prime_code, mod_code from event where project_id = $1 and status <> 'ended' order by created_at desc limit 1`,
        [project.id],
      )
    ).rows[0];
    if (event === undefined) {
      process.stdout.write("  (no running event for this project — launch one from the editor's Run mode)\n");
      return 0;
    }
    const saveSnapshot = async (): Promise<void> => {
      // The column the server's boot migration adds (`server/db/index.ts`) —
      // idempotent, so a sync never fails on a server that hasn't booted it yet.
      await pool.query(`alter table event add column if not exists house_maps jsonb`);
      await pool.query(`update event set scenario_source = $2, house_maps = $3::jsonb where id = $1`, [event.id, source, JSON.stringify(snapshot)]);
    };
    return await reloadEvent({ server, event, override, reload, saveSnapshot, body: { source, name: project.name, maps, facts: facts?.source ?? null, audio, lights } });
  } finally {
    await pool.end();
  }
}

// Run as a script (`tsx scripts/sync-example.ts …`); a test imports it.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.stderr.write(`sync-example: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    },
  );
}
