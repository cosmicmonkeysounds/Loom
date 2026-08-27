//! Typed data access for the control-plane tables. All SQL lives here so the
//! HTTP handlers (`projects.ts`, `events-api.ts`) stay about policy, not
//! column names.

import { randomUUID } from "node:crypto";

import { pool } from "./index.ts";

export interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface FileRow {
  id: string;
  project_id: string;
  path: string;
  content: string;
  updated_at: string;
}

export type EventMode = "live" | "preview";
export type EventStatus = "idle" | "open" | "paused" | "ended";

export interface EventRow {
  id: string;
  project_id: string;
  mode: EventMode;
  status: EventStatus;
  event_code: string;
  prime_code: string;
  mod_code: string;
  scenario_name: string;
  scenario_source: string;
  created_at: string;
  ended_at: string | null;
}

// --- projects -----------------------------------------------------------

/** Turn a display name into a URL-ish slug. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project"
  );
}

export async function createProject(ownerId: string, name: string): Promise<ProjectRow> {
  // Pick a slug unique within this owner (append a short suffix on clash).
  const base = slugify(name);
  let slug = base;
  for (let i = 0; i < 5; i++) {
    const clash = await pool().query("select 1 from project where owner_id = $1 and slug = $2", [ownerId, slug]);
    if (clash.rowCount === 0) break;
    slug = `${base}-${randomUUID().slice(0, 4)}`;
  }
  const id = randomUUID();
  const { rows } = await pool().query<ProjectRow>(
    `insert into project (id, owner_id, name, slug) values ($1, $2, $3, $4) returning *`,
    [id, ownerId, name, slug],
  );
  return rows[0]!;
}

/** The caller's standing on a project: owns it, or was invited onto it. */
export type ProjectRole = "owner" | "editor";

export interface ProjectAccessRow extends ProjectRow {
  role: ProjectRole;
  /** The owning author (null owner fields when the row is the caller's own). */
  owner_name: string | null;
  owner_email: string | null;
}

/** Every project `userId` can open: their own plus ones shared with them. */
export async function listProjectsFor(userId: string): Promise<ProjectAccessRow[]> {
  const { rows } = await pool().query<ProjectAccessRow>(
    `select p.*, 'owner' as role, null as owner_name, null as owner_email
       from project p where p.owner_id = $1
     union all
     select p.*, m.role as role, u.name as owner_name, u.email as owner_email
       from project_member m
       join project p on p.id = m.project_id
       left join "user" u on u.id = p.owner_id
      where m.user_id = $1
     order by updated_at desc`,
    [userId],
  );
  return rows;
}

/**
 * A project by id, only if `userId` owns it or is a member (else null — a
 * project you can't access reads as 404, never a leak). The returned `role`
 * is what handlers gate owner-only actions (delete, rename, sharing) on.
 */
export async function getProjectFor(userId: string, id: string): Promise<ProjectAccessRow | null> {
  const { rows } = await pool().query<ProjectAccessRow>(
    `select p.*,
            case when p.owner_id = $2 then 'owner' else m.role end as role,
            case when p.owner_id = $2 then null else u.name end as owner_name,
            case when p.owner_id = $2 then null else u.email end as owner_email
       from project p
       left join project_member m on m.project_id = p.id and m.user_id = $2
       left join "user" u on u.id = p.owner_id
      where p.id = $1 and (p.owner_id = $2 or m.user_id is not null)`,
    [id, userId],
  );
  return rows[0] ?? null;
}

export async function renameProject(ownerId: string, id: string, name: string): Promise<ProjectRow | null> {
  const { rows } = await pool().query<ProjectRow>(
    "update project set name = $3, updated_at = now() where id = $1 and owner_id = $2 returning *",
    [id, ownerId, name],
  );
  return rows[0] ?? null;
}

export async function deleteProject(ownerId: string, id: string): Promise<boolean> {
  const res = await pool().query("delete from project where id = $1 and owner_id = $2", [id, ownerId]);
  return (res.rowCount ?? 0) > 0;
}

export async function touchProject(id: string): Promise<void> {
  await pool().query("update project set updated_at = now() where id = $1", [id]);
}

// --- members (collaboration) --------------------------------------------

export interface MemberRow {
  user_id: string;
  role: string;
  created_at: string;
  /** From the BetterAuth `user` table (null if the account vanished). */
  name: string | null;
  email: string | null;
}

export async function listMembers(projectId: string): Promise<MemberRow[]> {
  const { rows } = await pool().query<MemberRow>(
    `select m.user_id, m.role, m.created_at, u.name, u.email
       from project_member m
       left join "user" u on u.id = m.user_id
      where m.project_id = $1
      order by m.created_at`,
    [projectId],
  );
  return rows;
}

/** Add (idempotently) a collaborator to a project. */
export async function addMember(projectId: string, userId: string): Promise<void> {
  await pool().query(
    `insert into project_member (project_id, user_id) values ($1, $2)
     on conflict (project_id, user_id) do nothing`,
    [projectId, userId],
  );
}

export async function removeMember(projectId: string, userId: string): Promise<boolean> {
  const res = await pool().query("delete from project_member where project_id = $1 and user_id = $2", [projectId, userId]);
  return (res.rowCount ?? 0) > 0;
}

/** Look up a signed-up author account by email (the invite handle). */
export async function findUserByEmail(email: string): Promise<{ id: string; name: string | null; email: string } | null> {
  const { rows } = await pool().query<{ id: string; name: string | null; email: string }>(
    `select id, name, email from "user" where lower(email) = lower($1)`,
    [email.trim()],
  );
  return rows[0] ?? null;
}

// --- files --------------------------------------------------------------

export async function listFiles(projectId: string): Promise<FileRow[]> {
  const { rows } = await pool().query<FileRow>("select * from project_file where project_id = $1 order by path", [projectId]);
  return rows;
}

export async function getFile(projectId: string, path: string): Promise<FileRow | null> {
  const { rows } = await pool().query<FileRow>(
    "select * from project_file where project_id = $1 and path = $2",
    [projectId, path],
  );
  return rows[0] ?? null;
}

export async function upsertFile(projectId: string, path: string, content: string): Promise<FileRow> {
  const { rows } = await pool().query<FileRow>(
    `insert into project_file (id, project_id, path, content) values ($1, $2, $3, $4)
     on conflict (project_id, path) do update set content = excluded.content, updated_at = now()
     returning *`,
    [randomUUID(), projectId, path, content],
  );
  await touchProject(projectId);
  return rows[0]!;
}

export async function deleteFile(projectId: string, path: string): Promise<boolean> {
  const res = await pool().query("delete from project_file where project_id = $1 and path = $2", [projectId, path]);
  if ((res.rowCount ?? 0) > 0) await touchProject(projectId);
  return (res.rowCount ?? 0) > 0;
}

/**
 * A project's files concatenated into one `.loom` source string — `main.loom`
 * first, then the rest by path, with the same per-file header comment the
 * on-disk example loader uses (`examples/load.ts`), so the compiled model is
 * identical whether an author splits the world across files or not.
 */
export async function projectSource(projectId: string): Promise<{ name: string; source: string } | null> {
  const files = await listFiles(projectId);
  if (files.length === 0) return null;
  const ordered = [...files].sort((a, b) => {
    const am = a.path === "main.loom" ? 0 : 1;
    const bm = b.path === "main.loom" ? 0 : 1;
    return am - bm || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  });
  const source = ordered
    .map((f) => `# ── ${f.path} ${"─".repeat(Math.max(0, 60 - f.path.length))}\n${f.content}`)
    .join("\n\n");
  return { name: projectId, source };
}

// --- events -------------------------------------------------------------

/** The one active (non-ended) event for a project, if any. */
export async function activeEvent(projectId: string): Promise<EventRow | null> {
  const { rows } = await pool().query<EventRow>(
    "select * from event where project_id = $1 and status <> 'ended' order by created_at desc limit 1",
    [projectId],
  );
  return rows[0] ?? null;
}

export async function createEvent(row: Omit<EventRow, "created_at" | "ended_at">): Promise<EventRow> {
  const { rows } = await pool().query<EventRow>(
    `insert into event
       (id, project_id, mode, status, event_code, prime_code, mod_code, scenario_name, scenario_source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning *`,
    [
      row.id,
      row.project_id,
      row.mode,
      row.status,
      row.event_code,
      row.prime_code,
      row.mod_code,
      row.scenario_name,
      row.scenario_source,
    ],
  );
  return rows[0]!;
}

export async function getEvent(id: string): Promise<EventRow | null> {
  const { rows } = await pool().query<EventRow>("select * from event where id = $1", [id]);
  return rows[0] ?? null;
}

export async function setEventStatus(id: string, status: EventStatus): Promise<void> {
  const ended = status === "ended";
  await pool().query(`update event set status = $2, ended_at = ${ended ? "now()" : "ended_at"} where id = $1`, [id, status]);
}

/** Every non-ended event across all projects (for boot rehydration). */
export async function liveEvents(): Promise<EventRow[]> {
  const { rows } = await pool().query<EventRow>("select * from event where status <> 'ended'");
  return rows;
}

/**
 * May this signed-in author moderate the event? True for the owning author
 * AND every invited collaborator on the project behind it — run == admin for
 * the whole writing team, so co-writers moderate from the editor's Run/Deploy
 * modes without typing a mod code.
 */
export async function canModerateEvent(eventId: string, userId: string): Promise<boolean> {
  const { rows } = await pool().query(
    `select 1
       from event e
       join project p on p.id = e.project_id
       left join project_member m on m.project_id = p.id and m.user_id = $2
      where e.id = $1 and (p.owner_id = $2 or m.user_id is not null)`,
    [eventId, userId],
  );
  return rows.length > 0;
}
