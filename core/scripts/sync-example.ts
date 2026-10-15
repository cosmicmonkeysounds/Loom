//! Push an example story from `core/examples/<name>/` into a server
//! project, and restart the project's running event on the new text.
//!
//!   pnpm sync-example "Untitled Project"                # default example
//!   pnpm sync-example <project id> escape-the-internet
//!   pnpm sync-example "Untitled Project" --server http://localhost:7000
//!
//! Dev tooling for the SaaS path: the editor's Run mode plays a *snapshot*
//! of the project (`event.scenario_source`), so editing the example folder
//! on disk changes nothing until it lands in `project_file` and the event
//! is reloaded. This does both, straight against Postgres (`DATABASE_URL`,
//! default `loom_dev`) and the event server's mod API (the event's own mod
//! code, read from the row). Files the example no longer has are removed
//! from the project. A reload cuts every guest's session — they re-join.
//!
//! The example's house maps (`house.json`, `house.<variant>.json`) are
//! project files too (SW-MAP-01): they are pushed, dropped, snapshotted on
//! the event row and handed to the reload like the `.loom` files. A project
//! map the push would change or delete — one saved from the map page since
//! the last sync, say — is copied to a temp directory first (printed), so a
//! surveyed map is never lost to a stale example; `--keep-maps` leaves the
//! project's maps alone entirely.

import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { scenarioFiles, scenarioMapFiles } from "../examples/load.ts";
import { isMapFile, planMapSync, type MapFiles } from "../server/house-maps.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://127.0.0.1:5432/loom_dev";

function usage(): never {
  process.stderr.write("usage: sync-example <project name | id> [example=trapped-in-the-internet] [--server URL] [--no-reload] [--keep-maps]\n");
  process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let server = process.env.LOOM_SERVER ?? `http://localhost:${process.env.LOOM_PORT ?? 7000}`;
  let reload = true;
  let keepMaps = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--server") server = args[++i] ?? usage();
    else if (a === "--no-reload") reload = false;
    else if (a === "--keep-maps") keepMaps = true;
    else if (a.startsWith("-")) usage();
    else positional.push(a);
  }
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

    // Maps: the example's replace the project's (unless --keep-maps); any
    // project map that would change or vanish is backed up first.
    const projectMaps: MapFiles = {};
    for (const r of (await pool.query<{ path: string; content: string }>(`select path, content from project_file where project_id = $1`, [project.id])).rows) {
      if (isMapFile(r.path)) projectMaps[r.path] = r.content;
    }
    const exampleMaps: MapFiles = Object.fromEntries(scenarioMapFiles(example).map((f) => [f.path, f.source]));
    const maps = keepMaps ? projectMaps : exampleMaps;
    if (!keepMaps) {
      const plan = planMapSync(projectMaps, exampleMaps);
      if (plan.replaced.length > 0) {
        const dir = mkdtempSync(join(tmpdir(), "loom-sync-maps-"));
        for (const f of plan.replaced) writeFileSync(join(dir, f), projectMaps[f]!);
        process.stdout.write(`⚠️  the project's ${plan.replaced.join(", ")} differed from the example's — the project's copies are in ${dir}\n`);
      }
    }
    const pushed = keepMaps ? files : [...files, ...Object.entries(exampleMaps).map(([path, source]) => ({ path, source }))];

    // Files: upsert every example file by path, drop the rest.
    const client = await pool.connect();
    try {
      await client.query("begin");
      const keep = [...files.map((f) => f.path), ...Object.keys(maps)];
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
    process.stdout.write(keepMaps ? `  (maps kept: ${Object.keys(maps).join(", ") || "none"})\n` : `✓ maps: ${Object.keys(maps).join(", ") || "none"}\n`);

    // The concatenation the server uses (`db/queries.ts` projectSource).
    const source = [...files]
      .sort((a, b) => (a.path === "main.loom" ? 0 : 1) - (b.path === "main.loom" ? 0 : 1) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((f) => `# ── ${f.path} ${"─".repeat(Math.max(0, 60 - f.path.length))}\n${f.source}`)
      .join("\n\n");

    const event = (
      await pool.query<{ id: string; mode: string; status: string; event_code: string; prime_code: string; mod_code: string }>(
        `select id, mode, status, event_code, prime_code, mod_code from event where project_id = $1 and status <> 'ended' order by created_at desc limit 1`,
        [project.id],
      )
    ).rows[0];
    if (event === undefined) {
      process.stdout.write("  (no running event for this project — launch one from the editor's Run mode)\n");
      return;
    }
    // The column the server's boot migration adds (`server/db/index.ts`) —
    // idempotent, so a sync never fails on a server that hasn't booted it yet.
    await pool.query(`alter table event add column if not exists house_maps jsonb`);
    await pool.query(`update event set scenario_source = $2, house_maps = $3::jsonb where id = $1`, [event.id, source, JSON.stringify(maps)]);
    process.stdout.write(`✓ event ${event.id} (${event.mode}, ${event.status}) snapshot updated — codes: guest ${event.event_code} · performer ${event.prime_code} · mod ${event.mod_code}\n`);
    if (!reload) return;

    // Restart the live runtime on the new text (a real cut: guests re-join).
    const login = await fetch(`${server}/e/${encodeURIComponent(event.id)}/api/mod/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: event.mod_code }),
    }).catch(() => null);
    if (login === null || !login.ok) {
      process.stdout.write(`  (server at ${server} not reachable — the snapshot is saved; the event restarts on it when the server boots and you reload it)\n`);
      return;
    }
    const { token } = (await login.json()) as { token: string };
    const load = await fetch(`${server}/e/${encodeURIComponent(event.id)}/api/mod/load`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-loom-token": token },
      body: JSON.stringify({ source, name: project.name, maps }),
    });
    if (!load.ok) throw new Error(`mod/load failed: ${load.status} ${await load.text()}`);
    process.stdout.write(`✓ event reloaded on the new story → ${server}/?code=${event.event_code}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`sync-example: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
