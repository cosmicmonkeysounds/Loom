//! The control-plane HTTP client for the Loom SaaS backend.
//!
//! Talks to the same server that hosts live events (`@loom/core` server):
//! BetterAuth under `/api/auth/*`, projects + files under `/api/projects/*`,
//! and event launch/lifecycle under `/api/projects/:id/event`. All requests
//! carry the session cookie (`credentials: "include"`); in dev the Vite proxy
//! makes these same-origin so the cookie flows.

import type { PrintCodes } from './print-sheet'
import type { AgentControl, AgentMindSummary, AgentThought, GuestView, PrimeView, WalletModView } from '@loom/core/views'
import type { ScreenTerminals } from '@/lib/terminals'
import type { RecapWire } from '@/components/cockpit/award-suggest'
import type { MapVariantsResponse, SwitchVariantResult } from '@/lib/map-variants'
import { kingFromScreen, kingFromWire, type KingView } from '@/lib/king'

const BASE = import.meta.env.VITE_LOOM_API ?? ''

/** A non-2xx response. Carries the status + parsed body so a caller can
 *  act on a specific outcome (e.g. a 409 "already active" launch that
 *  hands back the existing event) instead of just showing the message. */
export class ApiError extends Error {
  readonly status: number
  readonly data: Record<string, unknown>
  constructor(status: number, data: Record<string, unknown>) {
    super((data['error'] as string) || (data['message'] as string) || `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new ApiError(res.status, data)
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
  /** Display name of the author who launched it (null for older rows). */
  startedBy?: string | null
}

export const eventsApi = {
  async status(projectId: string): Promise<EventInfo | null> {
    return (await req<{ event: EventInfo | null }>('GET', `/api/projects/${projectId}/event`)).event
  },
  /** Launch the project's run. Codes are pinned across End → relaunch;
   *  `rotate: 'staff'` mints fresh performer + moderator codes and keeps the
   *  guest code (the invitations' QR stays valid). */
  async launch(projectId: string, mode: 'live' | 'preview', opts: { rotate?: 'staff' } = {}): Promise<EventInfo> {
    return (await req<{ event: EventInfo }>('POST', `/api/projects/${projectId}/event`, { mode, ...(opts.rotate ? { rotate: opts.rotate } : {}) })).event
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
  /** Promote the running rehearsal (`preview`) to a live event in place:
   *  the story restarts fresh, rehearsal guests/personas are removed, the
   *  codes + QR stay the same. 409 unless the active event is a rehearsal. */
  async goLive(projectId: string): Promise<EventInfo> {
    return (await req<{ event: EventInfo }>('POST', `/api/projects/${projectId}/event/golive`)).event
  },
}

/** Named arguments a fired signal binds in listening bodies (`fire x with k: v`). */
export type SignalArgs = Record<string, string | number | boolean>

// --- live moderation (per-event; authorized by the owning author's session) ---
// These hit the SAME `/e/:eventId/api/mod/*` routes the operator console uses,
// which now also accept the owning author's cookie — run + admin are one
// capability.

export type StatField = 'score' | 'faction' | 'location' | 'captured' | 'restricted'

/** The director's wallet routes (`/e/:id/api/mod/wallet/<route>`). */
export type WalletRoute = 'approve' | 'deny' | 'cancel' | 'stimulus' | 'approve-held' | 'unfreeze'

/** What `/api/mod/impersonate` mints. */
export interface PlayAsSession {
  token: string
  role: 'guest' | 'prime'
  id: string
  name: string
  eventId: string
  title: string
  /** A booth pane of a host part (`admin: true`): the session holds the host
   *  capability, so the pane shows the NEXT bar and reaches the host routes. */
  host?: boolean
}

/** What `/api/mod/guest/pair` mints (N-02). */
export interface GuestPairing {
  id: string
  name: string
  /** A single-use pair code (the phone trades it for a token). */
  pair: string
  /** When the code stops working (epoch ms; ten minutes after minting). */
  expiresAt: number
  /** Other tokens signed out (`revokeOthers`). */
  revoked: number
  /** `<join base>/?code=<event>&pair=<code>` — shown as a QR. */
  url: string
}

export const modApi = {
  async act(eventId: string, id: string, action: 'capture' | 'release'): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/act`, { id, action })
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
  /** Fire a generic `on <name>` signal, globally or on one subject —
   *  optionally *as* a character (`actor`), so only that character's hooks
   *  hear it (the performer-lens interaction path, like `/api/prime/act`).
   *  Resolves `refused: true` when the story refused the press (a cue
   *  pressed out of turn: at most a staff-room line, never LAST), and the
   *  cue state's press count after it (`presses`, a newer server). */
  async fireSignal(
    eventId: string,
    name: string,
    subject?: string,
    args?: SignalArgs | null,
    actor?: string | null,
    presses?: number,
  ): Promise<{ refused?: true; presses?: number }> {
    const r = await req<{ refused?: boolean; presses?: unknown } | null>('POST', `/e/${eventId}/api/mod/signal`, {
      name,
      subject,
      args: args ?? undefined,
      actor: actor ?? undefined,
      presses,
    })
    return {
      ...(r?.refused === true ? { refused: true as const } : {}),
      ...(typeof r?.presses === 'number' && Number.isFinite(r.presses) ? { presses: r.presses } : {}),
    }
  },
  /** Scan a guest as a character — fires that character's scan reaction.
   *  Resolves to the character's `respond` readouts (the booth's responses). */
  async scanAs(eventId: string, as: string, target: string): Promise<string[]> {
    const r = await req<{ responses?: string[] }>('POST', `/e/${eventId}/api/mod/scan`, { as, target })
    return r.responses ?? []
  },
  /** The server's own projection of one participant — exactly what the play
   *  app renders for them (`GuestView` for a guest/persona id, `PrimeView`
   *  for a character). Mod-authorized read of `/api/state?role=…&as=…`. */
  async lens(eventId: string, kind: 'guest' | 'prime', id: string): Promise<GuestView | PrimeView> {
    return await req<GuestView | PrimeView>(
      'GET',
      `/e/${eventId}/api/state?role=${kind}&as=${encodeURIComponent(id)}`,
    )
  },
  /** Everything printable: the codex QR links, the join link, one room
   *  check-in sign per LOCATION (K-12 — the Run → Print sheet). */
  async codes(eventId: string): Promise<PrintCodes> {
    return await req<PrintCodes>('POST', `/e/${eventId}/api/mod/codes`, {})
  },
  /** The event's push config (`GET /api/push/config`, no auth) — the print
   *  sheet reads `homescreen` (K-31b on) for the door sign's wording. */
  async pushConfig(eventId: string): Promise<{ enabled?: boolean; homescreen?: boolean }> {
    return await req<{ enabled?: boolean; homescreen?: boolean }>('GET', `/e/${eventId}/api/push/config`)
  },
  /** The ceremony recap (K-26, `GET /api/mod/recap`, directors only) — the
   *  cue sheet's award suggestions + its Copy recap button. */
  async recap(eventId: string): Promise<RecapWire> {
    return await req<RecapWire>('GET', `/e/${eventId}/api/mod/recap`)
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
  async persona(eventId: string, name?: string): Promise<{ id: string; owner?: string | null } | null> {
    const r = await req<{ guest: { id: string; owner?: string | null } | null }>(
      'POST',
      `/e/${eventId}/api/mod/persona`,
      { name },
    )
    return r.guest ?? null
  },
  /** Open a play-as session: the participant's OWN session (a guest /
   *  persona's, or a character's performer booth) for the Players page's
   *  embedded play app. Exact capabilities, journaled as this director, in
   *  server memory only. */
  async impersonate(eventId: string, role: 'guest' | 'prime', id: string): Promise<PlayAsSession> {
    return await req<PlayAsSession>('POST', `/e/${eventId}/api/mod/impersonate`, { role, id })
  },
  /** End a play-as session (its pane closed). */
  async endImpersonation(eventId: string, session: string): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/impersonate/end`, { session })
  },
  /** Re-pair a lost guest (N-02): a single-use, ten-minute pair code for
   *  the SAME guest, and the `?code=<event>&pair=<code>` link their new
   *  phone opens (it trades the code for a fresh token).
   *  `revokeOthers` also signs out every other phone holding that guest. */
  async pairGuest(eventId: string, id: string, opts: { revokeOthers?: boolean } = {}): Promise<GuestPairing> {
    return await req<GuestPairing>('POST', `/e/${eventId}/api/mod/guest/pair`, { id, ...(opts.revokeOthers ? { revokeOthers: true } : {}) })
  },
  /** Release a performer's part (N-10): drop the session holding it so the
   *  performer can re-sign on a loaner. Resolves to how many sessions held it. */
  async releasePart(eventId: string, character: string): Promise<number> {
    const r = await req<{ released?: number }>('POST', `/e/${eventId}/api/mod/prime/release`, { character })
    return r.released ?? 0
  },
  /** 👋 Went home / Back (wave 11 C5): a journaled world set of `<id>.gone`, `by` you. */
  async guestGone(eventId: string, id: string, gone: boolean): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/guest/gone`, { id, gone })
  },
  /** 🔓 A lost invitation (wave 11 C5): open a reserved program to anyone
   *  for `minutes` (the server's default is 2; 0 shuts it). Answers when
   *  the window closes (epoch ms), null when shut. */
  async claimUnlock(eventId: string, character: string, minutes?: number): Promise<number | null> {
    const r = await req<{ until?: number | null }>('POST', `/e/${eventId}/api/mod/claim/unlock`, minutes !== undefined ? { character, minutes } : { character })
    return typeof r.until === 'number' ? r.until : null
  },
  /** Write any world variable (the World browser's inline editing). */
  async setVar(eventId: string, path: string, value: string): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/var`, { path, value })
  },
  /** Hand a codex entry to a guest or a character (journaled `by` you). */
  async grantCodex(eventId: string, who: string, entry: string): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/codex`, { who, entry })
  },
  /** Move one guest's quest: start / update / complete / fail, with an
   *  optional line for the quest's thread. */
  async stepQuest(eventId: string, who: string, quest: string, action: string, text?: string | null): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/quest`, { who, quest, action, ...(text ? { text } : {}) })
  },
  /** The director's hand on the story's wallet: approve / deny / cancel one
   *  open item (`id`), pay the stimulus (`amount`, counts against the
   *  minter's limit), or approve every held transfer at once. Resolves to
   *  the wallet as it now stands. */
  async wallet(eventId: string, action: WalletRoute, body: { id: string } | { amount: number } | Record<string, never> = {}): Promise<WalletModView> {
    const r = await req<{ wallet: WalletModView }>('POST', `/e/${eventId}/api/mod/wallet/${action}`, body)
    return r.wallet
  },
  /** Reset the event: clear the journal + replay from the loaded scenario. */
  async reset(eventId: string): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/reset`, {})
  },
  /** The mind control panel: forward one control to the worker voicing a
   *  character. The server validates + forwards; 409 when nobody voices it. */
  async agentControl(eventId: string, control: Omit<AgentControl, 'by'>): Promise<{ ok: boolean; delivered: number }> {
    return await req<{ ok: boolean; delivered: number }>('POST', `/e/${eventId}/api/mod/agent/control`, control)
  },
  /** A page of the workers' recorded thoughts (the debugger's trace), plus
   *  the minds as last mirrored. */
  async agentTrace(
    eventId: string,
    o: { character?: string | null; after?: number; limit?: number } = {},
  ): Promise<{ thoughts: AgentThought[]; seq: number; characters: string[]; minds: AgentMindSummary[] }> {
    const q = new URLSearchParams()
    if (o.character) q.set('character', o.character)
    if (o.after !== undefined) q.set('after', String(o.after))
    if (o.limit !== undefined) q.set('limit', String(o.limit))
    const qs = q.toString()
    return await req('GET', `/e/${eventId}/api/mod/agent/trace${qs ? `?${qs}` : ''}`)
  },
}

// --- the whole ledger (T7-03: Export run) ----------------------------------

/** One page of `GET /e/:id/api/mod/log` — the raw ledger, oldest first.
 *  `entries` are the sim feed's own rows (a `SimEvent`, or `{seq, ts?,
 *  event}`); `next` is the `after` for the next page, null when done. */
export interface ModLogPage {
  entries: unknown[]
  next: number | null
  total: number
}

export const logApi = {
  /** A page of the event's ledger (mod-gated). `after` omitted = from the start. */
  async page(eventId: string, after: number | null, limit: number): Promise<ModLogPage> {
    const q = new URLSearchParams({ limit: String(limit) })
    if (after !== null) q.set('after', String(after))
    return await req<ModLogPage>('GET', `/e/${encodeURIComponent(eventId)}/api/mod/log?${q.toString()}`)
  },
}

// --- the wall terminals + TV (K-29: the director's heartbeat card) --------

export const screensApi = {
  /** Each terminal's last poll, the server's silence threshold and the TV-voice mute. */
  async terminals(eventId: string): Promise<ScreenTerminals> {
    return await req<ScreenTerminals>('GET', `/e/${eventId}/api/mod/screen/terminals`)
  },
  /** Mute / unmute the TV's room voice (K-18); every TV reads it off its next poll. */
  async setVoiceMuted(eventId: string, muted: boolean): Promise<{ muted: boolean }> {
    return await req<{ muted: boolean }>('POST', `/e/${eventId}/api/mod/screen/voice`, { muted })
  },
  /** Make one terminal show its name + spot full screen for 10 s (SW-SCR-21, install day). */
  async identify(eventId: string, name: string): Promise<{ name: string; until: number }> {
    return await req<{ name: string; until: number }>('POST', `/e/${eventId}/api/mod/screen/identify`, { name })
  },
}

// --- the house map variants (wave 5 E9: the tent ⇄ shed switch) ----------

export const mapApi = {
  /** The event's whole-map variants (`house.json`, `house.shed.json`, …), the active one flagged. */
  async variants(eventId: string): Promise<MapVariantsResponse> {
    return await req<MapVariantsResponse>('GET', `/e/${eventId}/api/mod/spatial/variants`)
  },
  /** Play another variant now. `base` = the map version the switch was
   *  confirmed against (`switchBase`): 409 when the map changed since. The
   *  server re-seats live players itself. */
  async switchVariant(eventId: string, file: string, base?: string): Promise<SwitchVariantResult> {
    return await req<SwitchVariantResult>('POST', `/e/${eventId}/api/mod/spatial/variant`, base !== undefined ? { file, base } : { file })
  },
  /** The house map the event plays now (`GET /api/spatial/house`, read with
   *  the author's session) — the Terminals card's spot pickers and claims
   *  (wave 14). Raw: `lib/terminal-setup.ts` `mapTerminals` reads it. */
  async house(eventId: string): Promise<unknown> {
    return await req<unknown>('GET', `/e/${eventId}/api/spatial/house`)
  },
  /** The shared King (wave 11 C2) off the lean screen state every terminal
   *  polls (`GET /api/screen/state` — no terminal name, so this read never
   *  shows up as a terminal on the heartbeat card). Null: no King on the
   *  map, or an older server. */
  async king(eventId: string): Promise<KingView | null> {
    return kingFromScreen(await req<unknown>('GET', `/e/${eventId}/api/screen/state`))
  },
  /** Set (or 👑 restore) the King's shared health: a journaled set of the
   *  prop's health path, `by` you. Resolves to the King as it now stands. */
  async setKing(eventId: string, hp: number): Promise<KingView | null> {
    const r = await req<{ king?: unknown }>('POST', `/e/${eventId}/api/mod/spatial/king`, { hp })
    return kingFromWire(r.king)
  },
}
