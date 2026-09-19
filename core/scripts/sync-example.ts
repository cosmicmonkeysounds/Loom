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

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { scenarioFiles } from "../examples/load.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://127.0.0.1:5432/loom_dev";

function usage(): never {
  process.stderr.write("usage: sync-example <project name | id> [example=trapped-in-the-internet] [--server URL] [--no-reload]\n");
  process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let server = process.env.LOOM_SERVER ?? `http://localhost:${process.env.LOOM_PORT ?? 7000}`;
  let reload = true;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--server") server = args[++i] ?? usage();
    else if (a === "--no-reload") reload = false;
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

    // Files: upsert every example file by path, drop the rest.
    const client = await pool.connect();
    try {
      await client.query("begin");
      const keep = files.map((f) => f.path);
      await client.query(`delete from project_file where project_id = $1 and not (path = any($2::text[]))`, [project.id, keep]);
      for (const f of files) {
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
    await pool.query(`update event set scenario_source = $2 where id = $1`, [event.id, source]);
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
      body: JSON.stringify({ source, name: project.name }),
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
