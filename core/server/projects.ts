//! Control-plane HTTP: an author's projects and their `.loom` files.
//!
//! Every route here is behind a signed-in author (the caller is resolved by
//! `server.ts` and passed in as `user`). Access is enforced at the query
//! layer — a project the author neither owns nor was invited onto reads as
//! 404, never a leak. Members (invited collaborators) can read + edit files
//! and run events; owner-only actions — rename, delete, and managing the
//! member list itself — check the resolved `role`.

import type { IncomingMessage, ServerResponse } from "node:http";

import { scenarioFiles } from "../examples/load.ts";
import { collabHub } from "./collab.ts";
import { readBody, sendJson, str } from "./http-util.ts";
import {
  activeEvent,
  addMember,
  createProject,
  deleteFile,
  deleteProject,
  findUserByEmail,
  getProjectFor,
  listFiles,
  listMembers,
  listProjectsFor,
  removeMember,
  renameProject,
  upsertFile,
  type ProjectAccessRow,
} from "./db/queries.ts";

/** A signed-in author. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

const BLANK_STARTER = `# Untitled Event
#
# Write your world here. The \`# Title\` heading above is what guests see in
# the participant app — rename it. A minimal event needs a lobby SPACE and a
# ROLE for guests; see the "escape-the-internet" template for a full example.
`;

/** Seed a new project's files from a named template. */
async function seedFiles(projectId: string, template: string): Promise<void> {
  if (template === "blank") {
    await upsertFile(projectId, "main.loom", BLANK_STARTER);
    return;
  }
  // Default: copy the on-disk example project verbatim (main.loom + the rest).
  for (const f of scenarioFiles("escape-the-internet")) {
    await upsertFile(projectId, f.path, f.source);
  }
}

/** The public shape of a project row + its active-event summary. */
function projectView(p: ProjectAccessRow, active: { id: string; mode: string; status: string } | null) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    updatedAt: p.updated_at,
    /** The caller's standing: "owner" or "editor" (invited collaborator). */
    role: p.role,
    /** Who owns it — null on the caller's own projects. */
    owner: p.role === "owner" ? null : { name: p.owner_name, email: p.owner_email },
    activeEvent: active ? { id: active.id, mode: active.mode, status: active.status } : null,
  };
}

/** The wire shape of one collaborator row. */
function memberView(m: { user_id: string; role: string; name: string | null; email: string | null }) {
  return { userId: m.user_id, role: m.role, name: m.name, email: m.email };
}

/** `/api/projects/:id/members` — list / invite / remove collaborators. */
async function handleMembers(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  project: ProjectAccessRow,
  user: AuthUser,
): Promise<boolean> {
  if (method === "GET") {
    const members = await listMembers(project.id);
    sendJson(res, 200, { members: members.map(memberView) });
    return true;
  }
  if (method === "POST") {
    if (project.role !== "owner") {
      sendJson(res, 403, { error: "only the project owner can invite collaborators" });
      return true;
    }
    const body = await readBody(req);
    const email = str(body, "email").trim();
    if (email === "") {
      sendJson(res, 400, { error: "email required" });
      return true;
    }
    const invitee = await findUserByEmail(email);
    if (invitee === null) {
      sendJson(res, 404, { error: "no account with that email — they need to sign up first" });
      return true;
    }
    if (invitee.id === project.owner_id) {
      sendJson(res, 400, { error: "that's the project owner" });
      return true;
    }
    await addMember(project.id, invitee.id);
    const members = await listMembers(project.id);
    sendJson(res, 200, { members: members.map(memberView) });
    return true;
  }
  if (method === "DELETE") {
    const body = await readBody(req);
    const target = str(body, "userId").trim() || user.id; // no body → leave
    // The owner can remove anyone; a member can only remove themself (leave).
    if (project.role !== "owner" && target !== user.id) {
      sendJson(res, 403, { error: "only the project owner can remove others" });
      return true;
    }
    const ok = await removeMember(project.id, target);
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not a member" });
    return true;
  }
  return false;
}

/**
 * Handle a `/api/projects…` request for `user`. Returns true when the path
 * matched a projects route (even on error), false to fall through to 404.
 */
export async function handleProjects(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  user: AuthUser,
): Promise<boolean> {
  const segs = path.split("/").filter(Boolean); // ["api","projects", id?, "files"|"members"?]

  // /api/projects
  if (segs.length === 2) {
    if (method === "GET") {
      const projects = await listProjectsFor(user.id);
      const withActive = await Promise.all(
        projects.map(async (p) => projectView(p, await activeEvent(p.id))),
      );
      sendJson(res, 200, { projects: withActive });
      return true;
    }
    if (method === "POST") {
      const body = await readBody(req);
      const name = str(body, "name").trim() || "Untitled Project";
      const template = str(body, "template") || "escape-the-internet";
      const project = await createProject(user.id, name);
      await seedFiles(project.id, template);
      sendJson(res, 200, {
        project: projectView({ ...project, role: "owner", owner_name: null, owner_email: null }, null),
      });
      return true;
    }
    return false;
  }

  // /api/projects/:id[/files | /members]
  if (segs.length === 3 || segs.length === 4) {
    const id = segs[2]!;
    const project = await getProjectFor(user.id, id);
    if (project === null) {
      sendJson(res, 404, { error: "no such project" });
      return true;
    }

    // /api/projects/:id
    if (segs.length === 3) {
      if (method === "GET") {
        const files = await listFiles(id);
        sendJson(res, 200, {
          project: projectView(project, await activeEvent(id)),
          files: files.map((f) => ({ path: f.path, content: f.content, updatedAt: f.updated_at })),
        });
        return true;
      }
      if (method === "PATCH") {
        if (project.role !== "owner") {
          sendJson(res, 403, { error: "only the project owner can rename it" });
          return true;
        }
        const body = await readBody(req);
        const name = str(body, "name").trim();
        if (name === "") {
          sendJson(res, 400, { error: "name required" });
          return true;
        }
        const updated = await renameProject(user.id, id, name);
        sendJson(res, 200, {
          project: projectView({ ...updated!, role: "owner", owner_name: null, owner_email: null }, await activeEvent(id)),
        });
        return true;
      }
      if (method === "DELETE") {
        if (project.role !== "owner") {
          sendJson(res, 403, { error: "only the project owner can delete it" });
          return true;
        }
        await deleteProject(user.id, id);
        sendJson(res, 200, { ok: true });
        return true;
      }
      return false;
    }

    // /api/projects/:id/members — collaboration roster.
    if (segs[3] === "members") {
      return handleMembers(req, res, method, project, user);
    }

    // /api/projects/:id/files  — upsert / delete a single file by body path
    if (segs[3] === "files") {
      if (method === "GET") {
        const files = await listFiles(id);
        sendJson(res, 200, { files: files.map((f) => ({ path: f.path, content: f.content, updatedAt: f.updated_at })) });
        return true;
      }
      if (method === "PUT") {
        const body = await readBody(req);
        const filePath = str(body, "path").trim();
        if (filePath === "" || filePath.includes("..")) {
          sendJson(res, 400, { error: "bad file path" });
          return true;
        }
        const file = await upsertFile(id, filePath, str(body, "content"));
        // If a live co-editing doc exists, fold this write into it (else the
        // next collab persist would clobber it); tell every editor's tree.
        collabHub().adoptExternalWrite(id, filePath, file.content);
        collabHub().notifyFileChange(id, "put", filePath);
        sendJson(res, 200, { file: { path: file.path, content: file.content, updatedAt: file.updated_at } });
        return true;
      }
      if (method === "DELETE") {
        const body = await readBody(req);
        const filePath = str(body, "path");
        const ok = await deleteFile(id, filePath);
        if (ok) {
          collabHub().dropDoc(id, filePath);
          collabHub().notifyFileChange(id, "delete", filePath);
        }
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "no such file" });
        return true;
      }
    }
  }

  return false;
}
