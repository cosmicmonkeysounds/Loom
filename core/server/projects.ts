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
import { EDITOR_URL } from "./config.ts";
import { readBody, sendJson, str } from "./http-util.ts";
import { inviteEmail, sendQuietly, type Delivery } from "./mail.ts";
import {
  acceptInvite,
  activeEvent,
  addMember,
  claimInvitesForEmail,
  createInvite,
  createProject,
  deleteFile,
  deleteInvite,
  deleteProject,
  findUserByEmail,
  getInviteByToken,
  getProjectFor,
  listFiles,
  listInvites,
  listMembers,
  listProjectsFor,
  normalizeEmail,
  removeMember,
  renameProject,
  upsertFile,
  type InviteRow,
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
# ROLE for guests; see the "trapped-in-the-internet" template for a full example.
`;

/** Example projects under `examples/` a new project may be seeded from. */
export const EXAMPLE_TEMPLATES = ["trapped-in-the-internet", "glass-orchard", "escape-the-internet"] as const;
export const DEFAULT_TEMPLATE = EXAMPLE_TEMPLATES[0];

/** Seed a new project's files from a named template. */
async function seedFiles(projectId: string, template: string): Promise<void> {
  if (template === "blank") {
    await upsertFile(projectId, "main.loom", BLANK_STARTER);
    return;
  }
  // Copy the on-disk example project verbatim (main.loom + the rest); an
  // unknown template id falls back to the default example.
  const name = (EXAMPLE_TEMPLATES as readonly string[]).includes(template) ? template : DEFAULT_TEMPLATE;
  for (const f of scenarioFiles(name)) {
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

/** The wire shape of one pending invite (the token stays server-side; the
 *  owner gets the full link instead, via `inviteUrl`). */
function inviteView(i: InviteRow) {
  return { id: i.id, email: i.email, createdAt: i.created_at, url: inviteUrl(i.token) };
}

/** The emailed deep link: the editor accepts the invite once signed in. */
export function inviteUrl(token: string): string {
  return `${EDITOR_URL}?invite=${encodeURIComponent(token)}`;
}

/** Deep link straight to a project the recipient can already open. */
export function projectUrl(projectId: string): string {
  return `${EDITOR_URL}?project=${encodeURIComponent(projectId)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The roster as the owner sees it: current members + pending invites. */
async function roster(projectId: string) {
  const [members, invites] = await Promise.all([listMembers(projectId), listInvites(projectId)]);
  return { members: members.map(memberView), invites: invites.map(inviteView) };
}

/**
 * Share a project with an email address. An existing author account is
 * added as a member on the spot; anyone else gets a pending invite that
 * turns into membership when they sign up with that address or open the
 * link. Either way the recipient is emailed (when a transport is
 * configured — see `mail.ts`); the owner gets told how it went out plus
 * the link, so they can pass it along by hand if email is off.
 */
export async function shareProject(
  project: ProjectAccessRow,
  inviter: AuthUser,
  rawEmail: string,
): Promise<{ hasAccount: boolean; url: string; delivery: Delivery; to: string } | { error: string; status: number }> {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_RE.test(email)) return { error: "enter a valid email address", status: 400 };
  const invitee = await findUserByEmail(email);
  if (invitee !== null && invitee.id === project.owner_id) return { error: "that's the project owner", status: 400 };
  let url: string;
  if (invitee !== null) {
    await addMember(project.id, invitee.id);
    url = projectUrl(project.id);
  } else {
    url = inviteUrl((await createInvite(project.id, email, inviter.id)).token);
  }
  const delivery = await sendQuietly(
    inviteEmail({
      to: email,
      inviterName: inviter.name.trim() || inviter.email,
      projectName: project.name,
      url,
      hasAccount: invitee !== null,
    }),
  );
  return { hasAccount: invitee !== null, url, delivery, to: email };
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
    sendJson(res, 200, await roster(project.id));
    return true;
  }
  if (method === "POST") {
    if (project.role !== "owner") {
      sendJson(res, 403, { error: "only the project owner can invite collaborators" });
      return true;
    }
    const body = await readBody(req);
    const result = await shareProject(project, user, str(body, "email"));
    if ("error" in result) {
      sendJson(res, result.status, { error: result.error });
      return true;
    }
    sendJson(res, 200, { ...(await roster(project.id)), notified: result });
    return true;
  }
  if (method === "DELETE") {
    const body = await readBody(req);
    const inviteId = str(body, "inviteId").trim();
    if (inviteId !== "") {
      // Revoke a pending invite (owner-only; the link stops working).
      if (project.role !== "owner") {
        sendJson(res, 403, { error: "only the project owner can revoke invites" });
        return true;
      }
      const ok = await deleteInvite(project.id, inviteId);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "no such invite" });
      return true;
    }
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
 * `/api/invites/:token` — the emailed link's landing data (GET, works
 * signed-out so the sign-up screen can say who invited you to what) and
 * `POST /api/invites/:token/accept` (signed-in) to join. Returns true when
 * the path matched.
 */
export async function handleInvites(
  res: ServerResponse,
  method: string,
  path: string,
  user: AuthUser | null,
): Promise<boolean> {
  const segs = path.split("/").filter(Boolean); // ["api","invites", token, "accept"?]
  if (segs.length < 3 || segs[2] === undefined) return false;
  const token = segs[2];
  if (segs.length === 3 && method === "GET") {
    const inv = await getInviteByToken(token);
    if (inv === null) {
      sendJson(res, 404, { error: "this invite link is no longer valid" });
      return true;
    }
    sendJson(res, 200, {
      invite: {
        projectId: inv.project_id,
        projectName: inv.project_name,
        email: inv.email,
        inviter: inv.inviter_name ?? inv.inviter_email ?? "another author",
        accepted: inv.accepted_at !== null,
        // Lets the landing screen default to sign-in vs. sign-up.
        accountExists: (await findUserByEmail(inv.email)) !== null,
      },
    });
    return true;
  }
  if (segs.length === 4 && segs[3] === "accept" && method === "POST") {
    if (user === null) {
      sendJson(res, 401, { error: "sign in" });
      return true;
    }
    const joined = await acceptInvite(token, user.id);
    if (joined === null) {
      // Already used (maybe by this very account via the email auto-claim):
      // if they can open the project anyway, treat it as success.
      const inv = await getInviteByToken(token);
      const project = inv === null ? null : await getProjectFor(user.id, inv.project_id);
      if (project === null) {
        sendJson(res, 404, { error: "this invite link is no longer valid" });
        return true;
      }
      sendJson(res, 200, { project: projectView(project, await activeEvent(project.id)) });
      return true;
    }
    const project = await getProjectFor(user.id, joined.project_id);
    sendJson(res, 200, { project: project === null ? null : projectView(project, await activeEvent(project.id)) });
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
      // Signing up with an invited address is enough to join — pending
      // invites addressed to this account are claimed on every listing.
      await claimInvitesForEmail(user.id, user.email);
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
      const template = str(body, "template") || DEFAULT_TEMPLATE;
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
