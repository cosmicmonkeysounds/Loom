//! The control-plane HTTP client for the Loom SaaS backend.
//!
//! Talks to the same server that hosts live events (`@loom/core` server):
//! BetterAuth under `/api/auth/*`, projects + files under `/api/projects/*`,
//! and event launch/lifecycle under `/api/projects/:id/event`. All requests
//! carry the session cookie (`credentials: "include"`); in dev the Vite proxy
//! makes these same-origin so the cookie flows.

const BASE = import.meta.env.VITE_LOOM_API ?? ''

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error((data['error'] as string) || (data['message'] as string) || `HTTP ${res.status}`)
  return data as T
}

// --- auth (BetterAuth) --------------------------------------------------

export interface AuthUser {
  id: string
  email: string
  name: string
}

export const authApi = {
  async signUp(name: string, email: string, password: string): Promise<void> {
    await req('POST', '/api/auth/sign-up/email', { name, email, password })
  },
  async signIn(email: string, password: string): Promise<void> {
    await req('POST', '/api/auth/sign-in/email', { email, password })
  },
  async signOut(): Promise<void> {
    await req('POST', '/api/auth/sign-out', {})
  },
  async session(): Promise<AuthUser | null> {
    const s = await req<{ user?: AuthUser } | null>('GET', '/api/auth/get-session')
    return s?.user ?? null
  },
}

// --- projects + files ---------------------------------------------------

export interface ProjectSummary {
  id: string
  name: string
  slug: string
  updatedAt: string
  /** The caller's standing: 'owner', or 'editor' on a project shared with them.
   *  (Optional so summaries from older servers read as owned.) */
  role?: 'owner' | 'editor'
  /** Who owns it — set only on projects shared with the caller. */
  owner?: { name: string | null; email: string | null } | null
  activeEvent: { id: string; mode: string; status: string } | null
}

/** One collaborator on a project (an invited author account). */
export interface ProjectMember {
  userId: string
  role: string
  name: string | null
  email: string | null
}

export interface ProjectFile {
  path: string
  content: string
  updatedAt?: string
}

export const projectsApi = {
  async list(): Promise<ProjectSummary[]> {
    return (await req<{ projects: ProjectSummary[] }>('GET', '/api/projects')).projects
  },
  async create(name: string, template?: string): Promise<ProjectSummary> {
    return (await req<{ project: ProjectSummary }>('POST', '/api/projects', { name, template })).project
  },
  async get(id: string): Promise<{ project: ProjectSummary; files: ProjectFile[] }> {
    return req('GET', `/api/projects/${id}`)
  },
  async rename(id: string, name: string): Promise<ProjectSummary> {
    return (await req<{ project: ProjectSummary }>('PATCH', `/api/projects/${id}`, { name })).project
  },
  async remove(id: string): Promise<void> {
    await req('DELETE', `/api/projects/${id}`)
  },
  async putFile(id: string, path: string, content: string): Promise<void> {
    await req('PUT', `/api/projects/${id}/files`, { path, content })
  },
  async deleteFile(id: string, path: string): Promise<void> {
    await req('DELETE', `/api/projects/${id}/files`, { path })
  },
}

// --- collaboration (project members + pending invites) ------------------
// Owner-managed: share with an email. An existing author is added on the
// spot; anyone else gets a pending invite (emailed link, or auto-claimed
// when they sign up with that address). Members see the project under
// "Shared with you" and can edit files + run its events.

/** A share sent to an address with no account yet. `url` is the invite link. */
export interface PendingInvite {
  id: string
  email: string
  createdAt: string
  url: string
}

export interface ProjectRoster {
  members: ProjectMember[]
  invites: PendingInvite[]
}

/** How a share went out: emailed (`smtp` / `resend`) or only logged (`none`). */
export type MailDelivery = 'smtp' | 'resend' | 'none'

export interface ShareResult extends ProjectRoster {
  notified: { to: string; hasAccount: boolean; url: string; delivery: MailDelivery }
}

export const membersApi = {
  async list(projectId: string): Promise<ProjectRoster> {
    return req('GET', `/api/projects/${projectId}/members`)
  },
  async add(projectId: string, email: string): Promise<ShareResult> {
    return req('POST', `/api/projects/${projectId}/members`, { email })
  },
  /** Owner removes a collaborator; omit `userId` to leave a shared project. */
  async remove(projectId: string, userId?: string): Promise<void> {
    await req('DELETE', `/api/projects/${projectId}/members`, userId !== undefined ? { userId } : {})
  },
  /** Owner revokes a pending invite — its link stops working. */
  async revokeInvite(projectId: string, inviteId: string): Promise<void> {
    await req('DELETE', `/api/projects/${projectId}/members`, { inviteId })
  },
}

/** What an invite link points at (readable signed-out, for the landing card). */
export interface InvitePeek {
  projectId: string
  projectName: string
  email: string
  inviter: string
  accepted: boolean
  /** Whether an author account already exists for `email`. */
  accountExists: boolean
}

export const invitesApi = {
  async peek(token: string): Promise<InvitePeek> {
    return (await req<{ invite: InvitePeek }>('GET', `/api/invites/${encodeURIComponent(token)}`)).invite
  },
  /** Join the project (signed-in). Resolves to the project, now openable. */
  async accept(token: string): Promise<ProjectSummary | null> {
    return (await req<{ project: ProjectSummary | null }>('POST', `/api/invites/${encodeURIComponent(token)}/accept`)).project
  },
}

// --- events (launch / lifecycle) ----------------------------------------

export interface EventInfo {
  id: string
  projectId: string
  mode: 'live' | 'preview'
  status: string
  codes: { event: string; prime: string; mod: string }
  joinUrl: string
  createdAt: string
  /** The project's files have moved on since this event's story snapshot
   *  was taken — "Push current draft" would change what guests play. */
  stale?: boolean
}

export const eventsApi = {
  async status(projectId: string): Promise<EventInfo | null> {
    return (await req<{ event: EventInfo | null }>('GET', `/api/projects/${projectId}/event`)).event
  },
  async launch(projectId: string, mode: 'live' | 'preview'): Promise<EventInfo> {
    return (await req<{ event: EventInfo }>('POST', `/api/projects/${projectId}/event`, { mode })).event
  },
  async pause(projectId: string): Promise<EventInfo> {
    return (await req<{ event: EventInfo }>('POST', `/api/projects/${projectId}/event/pause`)).event
  },
  async resume(projectId: string): Promise<EventInfo> {
    return (await req<{ event: EventInfo }>('POST', `/api/projects/${projectId}/event/resume`)).event
  },
  async end(projectId: string): Promise<void> {
    await req('POST', `/api/projects/${projectId}/event/end`)
  },
  /** Push the project's current text into the running event: the story
   *  restarts on the new draft (journal + chat cleared), codes are kept. */
  async reload(projectId: string): Promise<EventInfo> {
    return (await req<{ event: EventInfo }>('POST', `/api/projects/${projectId}/event/reload`)).event
  },
}

/** Named arguments a fired signal binds in listening bodies (`fire x with k: v`). */
export type SignalArgs = Record<string, string | number | boolean>

// --- live moderation (per-event; authorized by the owning author's session) ---
// These hit the SAME `/e/:eventId/api/mod/*` routes the operator console uses,
// which now also accept the owning author's cookie — run + admin are one
// capability.

export type StatField = 'score' | 'faction' | 'location' | 'captured'

export const modApi = {
  async act(eventId: string, id: string, action: 'capture' | 'release' | 'signal', name?: string): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/act`, { id, action, name })
  },
  async hideMessage(eventId: string, seq: number, hidden: boolean): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/message`, { seq, hidden })
  },
  async broadcast(eventId: string, scope: string, cue: string): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/broadcast`, { scope, cue })
  },
  /** Post a message into any room, as the Operator or in a character's voice. */
  async say(eventId: string, channel: string, text: string, as?: string, parentSeq?: number | null): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/say`, { channel, text, as, parentSeq })
  },
  /** Live-edit one guest stat (score / faction / location / captured). */
  async setStat(eventId: string, id: string, field: StatField, value: string | number | boolean): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/set`, { id, field, value })
  },
  /** Fire a named story beat (optionally targeting one guest). */
  async fireBeat(eventId: string, name: string, subject?: string): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/beat`, { name, subject })
  },
  /** Fire a generic `on <name>` signal, globally or on one subject. */
  async fireSignal(eventId: string, name: string, subject?: string, args?: SignalArgs | null): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/signal`, { name, subject, args: args ?? undefined })
  },
  /** Scan a guest as a character — fires that character's scan reaction. */
  async scanAs(eventId: string, as: string, target: string): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/scan`, { as, target })
  },
  /** Expose a hidden faction (the secret-villain reveal). */
  async reveal(eventId: string, faction: string): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/reveal`, { faction })
  },
  /** Answer a pending choice on a participant's behalf (`__global` for an
   *  unbound story menu) — journaled like the guest's own answer. */
  async choose(eventId: string, person: string, index: number): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/choose`, { person, index })
  },
  /** Spawn a test persona (a director-puppeted guest) on the event — the
   *  shared-rehearsal path: each co-writer adds and plays their own.
   *  Returns the created guest so the editor can claim it as "yours". */
  async persona(eventId: string, name?: string): Promise<{ id: string } | null> {
    const r = await req<{ guest: { id: string } | null }>('POST', `/e/${eventId}/api/mod/persona`, { name })
    return r.guest ?? null
  },
  /** Write any world variable (the World browser's inline editing). */
  async setVar(eventId: string, path: string, value: string): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/var`, { path, value })
  },
  /** Reset the event: clear the journal + replay from the loaded scenario. */
  async reset(eventId: string): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/reset`, {})
  },
}
