//! The control-plane HTTP client for the Loom SaaS backend.
//!
//! Talks to the same server that hosts live events (`@loom/core` server):
//! BetterAuth under `/api/auth/*`, projects + files under `/api/projects/*`,
//! and event launch/lifecycle under `/api/projects/:id/event`. All requests
//! carry the session cookie (`credentials: "include"`); in dev the Vite proxy
//! makes these same-origin so the cookie flows.

import type { VoiceFlavour, VoiceFxMode } from '@loom/core/voice-fx'
import type { PrintBadges, PrintCodes } from './print-sheet'
import type { AgentControl, AgentMindSummary, AgentThought, GuestView, PrimeView, WalletModView } from '@loom/core/views'
import type { ScreenTerminals } from '@/lib/terminals'
import type { RecapWire } from '@/components/cockpit/award-suggest'
import type { MapVariantsResponse, SwitchVariantResult } from '@/lib/map-variants'
import { descentFromWire } from '@/lib/house-map-view'
import { kingFromScreen, kingFromWire, type KingView } from '@/lib/king'
import { audioStatusOf, routerOf, type AudioStatus, type AudioStopAnswer } from '@/lib/house-audio'
import { lightsStatusOf, type LightsStatus } from '@/lib/lights-status'
import { designerLightsOf, type DesignerLights } from '@/lib/cue-designer'
import type { LightsConfig } from '@loom/house'
import type { DeskConfig, DeskTestCall, DeskView } from '@loom/core/house-desk'
import type { AudioMix, MixChange, MixerView, MusicCommand } from '@loom/core/house-mixer'
import { audioMixOf, mixerViewOf } from '@/lib/house-mixer-view'
import { lettersViewOf, type LettersView } from '@/components/run/letters'
import { videoConsentViewOf, type VideoConsentView } from '@/components/run/video-consent'
import { creditsViewOf } from '@/components/run/credits-card'
import type { CreditsView } from '@loom/core/credits'
import { photosViewOf, type PhotosView } from '@loom/core/photos'

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
  /** 📣 Claim the show's caller (`on`) or let it go (wave 18 C8): the
   *  server keeps one caller, memory only, on every cue sheet's
   *  `cues.caller`. An older server answers 404. */
  async caller(eventId: string, on: boolean): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/caller`, { on })
  },
  /** Wave 59: ▶ every line of his left plays, or ✓ Done the scene is over. */
  async aloud(eventId: string, action: 'release' | 'done'): Promise<void> {
    await req('POST', `/e/${eventId}/api/mod/aloud`, { action })
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
  /** The printable blank ID badges `from`…`from + count - 1` and who has
   *  linked each (wave 23, `POST /api/mod/badges`) — the print sheet's Badges. */
  async badges(eventId: string, from: number, count: number): Promise<PrintBadges> {
    return await req<PrintBadges>('POST', `/e/${eventId}/api/mod/badges`, { from, count })
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
  /** Sign a guest's phone out (wave 59): their badge or invitation signs in
   *  again on any phone. Answers how many tokens went. */
  async releaseGuest(eventId: string, id: string): Promise<number> {
    const r = await req<{ released?: number }>('POST', `/e/${eventId}/api/mod/guest/release`, { id })
    return r.released ?? 0
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
  /** (wave 56) His voice: the director's mode, or one flavour now. */
  async setVoiceFx(eventId: string, body: { fx?: VoiceFxMode; shot?: VoiceFlavour }): Promise<{ fx: VoiceFxMode }> {
    return await req<{ fx: VoiceFxMode }>('POST', `/e/${eventId}/api/mod/screen/voice`, body)
  },
  /** The lean screen state every terminal polls (`GET /api/screen/state`, no
   *  terminal name, so this read never shows up on the heartbeat card). Raw:
   *  the Terminals card reads `night.door_override` off it (wave 20,
   *  `lib/terminals.ts` `doorOverrideFromScreen`). */
  async state(eventId: string): Promise<unknown> {
    return await req<unknown>('GET', `/e/${eventId}/api/screen/state`)
  },
  /** (wave 59) The Task Manager costume's switch and its link. */
  async costume(eventId: string): Promise<{ on: boolean; url: string }> {
    return await req<{ on: boolean; url: string }>('GET', `/e/${eventId}/api/mod/costume`)
  },
  /** (wave 59) The crew's kill switch. */
  async setCostume(eventId: string, on: boolean): Promise<{ on: boolean }> {
    return await req<{ on: boolean }>('POST', `/e/${eventId}/api/mod/costume`, { on })
  },
  /** Make one terminal show its name + spot full screen for 10 s (SW-SCR-21, install day). */
  async identify(eventId: string, name: string): Promise<{ name: string; until: number }> {
    return await req<{ name: string; until: number }>('POST', `/e/${eventId}/api/mod/screen/identify`, { name })
  },
}

// --- the house sound (wave 18b, Q7 / Q8) -----------------------------------

export const audioApi = {
  /** The event's `audio.json` in force, its source and whether the house
   *  Mac's router is listening (no `router=1`: this read never passes for
   *  the router). Null from a server with no audio route. */
  async status(eventId: string): Promise<AudioStatus | null> {
    return audioStatusOf(await req<unknown>('GET', `/e/${eventId}/api/mod/audio`))
  },
  /** ■ Stop house sounds: the router fades out every story sound and
   *  speaker test; `announce` also cuts the announcement and its queue.
   *  One-shot, never journaled. */
  async stop(eventId: string, announce: boolean): Promise<AudioStopAnswer> {
    const r = await req<{ ok?: unknown; seq?: unknown; router?: unknown }>('POST', `/e/${eventId}/api/mod/audio/stop`, { announce })
    return { ok: true, seq: typeof r.seq === 'number' ? r.seq : 0, router: routerOf(r.router) }
  },
  /** A director's save of the whole config (`base` = the version it was read
   *  at: 409 when someone saved since). Kept for this event only. */
  async save(eventId: string, audio: Record<string, unknown>, base: string): Promise<{ version: string; warnings: string[] }> {
    const r = await req<{ version?: unknown; warnings?: unknown }>('POST', `/e/${eventId}/api/mod/audio`, { audio, base })
    return { version: typeof r.version === 'string' ? r.version : '', warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === 'string') : [] }
  },
  /** One map terminal spot on (or off) the house list of tablets that also
   *  say the announcements (`base` = the version it was read at: 409 when
   *  someone saved since). Laid over the config in force for this event,
   *  never a whole director's save, so a newer project audio.json still
   *  plays here; Save to project writes the list into the file. */
  async announce(eventId: string, spot: string, on: boolean, base: string): Promise<{ version: string; terminals: string[] }> {
    const r = await req<{ version?: unknown; terminals?: unknown }>('POST', `/e/${eventId}/api/mod/audio/announce`, { spot, on, base })
    return { version: typeof r.version === 'string' ? r.version : '', terminals: Array.isArray(r.terminals) ? r.terminals.filter((t): t is string => typeof t === 'string') : [] }
  },
  /** The config in force becomes the project's `audio.json` (survives End → relaunch). */
  async saveToProject(eventId: string): Promise<void> {
    await req<unknown>('POST', `/e/${eventId}/api/mod/audio/project`, {})
  },
  /** An identifying tone + label on one speaker or one output (wave 17). */
  async test(eventId: string, target: { speaker: string } | { out: number }): Promise<{ seq: number }> {
    const r = await req<{ seq?: unknown }>('POST', `/e/${eventId}/api/mod/audio/test`, target)
    return { seq: typeof r.seq === 'number' ? r.seq : 0 }
  },
  /** Play a sound file, or say a house announcement, on the house speakers
   *  (wave 25: the desk's checks and steps). Memory only, never journaled. */
  async play(
    eventId: string,
    play: { sound: string; to?: string[]; gain?: number } | { say: string; to?: string[]; chime?: boolean },
  ): Promise<{ seq: number }> {
    const r = await req<{ seq?: unknown }>('POST', `/e/${eventId}/api/mod/audio/play`, play)
    return { seq: typeof r.seq === 'number' ? r.seq : 0 }
  },
  /** (wave 40) Run → House → 🎚 Mixer: the mix, the sources and rooms, the
   *  router's live meters and the soundtrack. Each read keeps the router's
   *  meters coming for a few seconds (`MIX_WATCH_MS`). 404 from an older server. */
  async getMixer(eventId: string): Promise<MixerView> {
    const v = mixerViewOf(await req<unknown>('GET', `/e/${eventId}/api/mod/audio/mixer`))
    if (v === null) throw new ApiError(502, { error: 'the server’s mixer answer is not one' })
    return v
  },
  /** (wave 40) Move the mix: `changes` in order, or `resetAll` (every level back to 0 dB). */
  async postMix(eventId: string, changes: MixChange[], resetAll = false): Promise<{ mix: AudioMix }> {
    const r = await req<{ mix?: unknown }>('POST', `/e/${eventId}/api/mod/audio/mix`, resetAll ? { changes, resetAll: true } : { changes })
    const mix = audioMixOf(r.mix)
    if (mix === null) throw new ApiError(502, { error: 'the server’s mix answer is not one' })
    return { mix }
  },
  /** (wave 40) Tell the soundtrack: skip, a scene by hand, stop, follow the story. One-shot. */
  async postMusic(eventId: string, cmd: MusicCommand): Promise<{ seq: number; router: boolean }> {
    const r = await req<{ seq?: unknown; router?: unknown }>('POST', `/e/${eventId}/api/mod/audio/music`, cmd)
    return { seq: typeof r.seq === 'number' ? r.seq : 0, router: typeof r.router === 'boolean' ? r.router : routerOf(r.router).online }
  },
}

// --- the house lights (wave 20, D8) --------------------------------------

export const lightsApi = {
  /** The event's `lights.json` in force, the lights module's presence and
   *  any open Zigbee pairing (`GET /api/mod/lights` with no `after`: it
   *  answers at once, never parks, and no `module=1`, so this read never
   *  counts as the module). Null from a server with no lights route. */
  async status(eventId: string): Promise<LightsStatus | null> {
    try {
      return lightsStatusOf(await req<unknown>('GET', `/e/${eventId}/api/mod/lights`))
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },
  /** Identify a fixture, play a look, or publish one state on a fixture. */
  async test(eventId: string, test: { fixture: string; set?: Record<string, unknown> } | { look: string }): Promise<{ seq: number }> {
    const r = await req<{ seq?: unknown }>('POST', `/e/${eventId}/api/mod/lights/test`, test)
    return { seq: typeof r.seq === 'number' ? r.seq : 0 }
  },
  /** Let new Zigbee devices join for `seconds` (0 closes). */
  async pair(eventId: string, seconds: number): Promise<{ until: number | null }> {
    const r = await req<{ until?: unknown }>('POST', `/e/${eventId}/api/mod/lights/pair`, { seconds })
    return { until: typeof r.until === 'number' ? r.until : null }
  },
  /** The whole lights config in force, for the Cue designer (wave 30). Null
   *  from a server with no lights route, or an answer that isn't one. */
  async config(eventId: string): Promise<DesignerLights | null> {
    try {
      return designerLightsOf(await req<unknown>('GET', `/e/${eventId}/api/mod/lights`))
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },
  /** Save the event's lights (`base`: the version the edit started from;
   *  409 `stale` when someone saved since, 400 `{problems}` when invalid). */
  async save(eventId: string, lights: LightsConfig, base?: string): Promise<{ version: string; warnings: string[] }> {
    const r = await req<{ version?: unknown; warnings?: unknown }>('POST', `/e/${eventId}/api/mod/lights`, base !== undefined ? { lights, base } : { lights })
    return { version: typeof r.version === 'string' ? r.version : '', warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === 'string') : [] }
  },
  /** The lights in force become the project's `lights.json` (409 `no project`). */
  async project(eventId: string): Promise<void> {
    await req<unknown>('POST', `/e/${eventId}/api/mod/lights/project`, {})
  },
}

// --- the house desk (wave 25: Run → House; docs/loom-house-desk.md §2.1) --

/** A save's answer. */
export interface DeskSaveAnswer {
  version: string
  source: DeskView['source']
  warnings: string[]
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const standbyOf = (v: unknown): string | null => (typeof v === 'string' ? v : null)

export const deskApi = {
  /** The desk view. With `after` it is a long poll: the server answers at
   *  once when its `rev` moved past `after`, else on the first change or
   *  after `wait` seconds (default 25, at most 30). */
  async get(eventId: string, after?: number, wait?: number): Promise<DeskView> {
    const q = new URLSearchParams()
    if (after !== undefined) q.set('after', String(after))
    if (wait !== undefined) q.set('wait', String(wait))
    const qs = q.toString()
    return await req<DeskView>('GET', `/e/${eventId}/api/mod/desk${qs !== '' ? `?${qs}` : ''}`)
  },
  /** A director's save (`base` = the version it was read at). 400 carries
   *  `problems`; 409 `stale` when someone saved since. */
  async save(eventId: string, desk: DeskConfig, base?: string): Promise<DeskSaveAnswer> {
    const r = await req<{ version?: unknown; source?: unknown; warnings?: unknown }>('POST', `/e/${eventId}/api/mod/desk`, base !== undefined ? { desk, base } : { desk })
    return {
      version: typeof r.version === 'string' ? r.version : '',
      source: r.source === 'project' || r.source === 'default' ? r.source : 'director',
      warnings: strings(r.warnings),
    }
  },
  /** The desk in force becomes the project's `desk.json` (409 `no project`). */
  async project(eventId: string): Promise<void> {
    await req<unknown>('POST', `/e/${eventId}/api/mod/desk/project`, {})
  },
  /** GO: `cue`, or the playhead's cue. `standby` is the playhead this
   *  console showed (409 `moved` when another console moved it). */
  async go(eventId: string, opts: { cue?: string; standby?: string | null }): Promise<{ run: number | null; standby: string | null }> {
    const body: Record<string, unknown> = {}
    if (opts.cue !== undefined) body['cue'] = opts.cue
    if (opts.standby !== undefined) body['standby'] = opts.standby
    const r = await req<{ run?: unknown; standby?: unknown }>('POST', `/e/${eventId}/api/mod/desk/go`, body)
    const run = typeof r.run === 'number' ? r.run : typeof r.run === 'object' && r.run !== null && typeof (r.run as { run?: unknown }).run === 'number' ? (r.run as { run: number }).run : null
    return { run, standby: standbyOf(r.standby) }
  },
  /** Put the playhead on `cue` (null: the end of the list). */
  async standby(eventId: string, cue: string | null): Promise<{ standby: string | null }> {
    const r = await req<{ standby?: unknown }>('POST', `/e/${eventId}/api/mod/desk/standby`, { cue })
    return { standby: standbyOf(r.standby) }
  },
  /** Stop one run, or every run and the house sounds (the panic). */
  async stop(eventId: string, what: { run: number } | { all: true; announce?: boolean }): Promise<{ stopped: number }> {
    const r = await req<{ stopped?: unknown }>('POST', `/e/${eventId}/api/mod/desk/stop`, what)
    return { stopped: typeof r.stopped === 'number' ? r.stopped : Array.isArray(r.stopped) ? r.stopped.length : 0 }
  },
  /** Mark a check (null clears it). */
  async check(eventId: string, key: string, mark: 'ok' | 'bad' | null, note?: string): Promise<void> {
    await req<unknown>('POST', `/e/${eventId}/api/mod/desk/check`, note !== undefined ? { key, mark, note } : { key, mark })
  },
  /** Clear every check mark. */
  async checkReset(eventId: string): Promise<void> {
    await req<unknown>('POST', `/e/${eventId}/api/mod/desk/check/reset`, {})
  },
  /** Run one of the checks' tests as `deskChecks` describes it. */
  async test(eventId: string, call: DeskTestCall): Promise<void> {
    await req<unknown>('POST', `/e/${eventId}${call.route}`, call.body)
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
  /** Trade the run's moderator code for a token: the embedded map editor
   *  speaks the same token routes as `/reinstall/map`. */
  async login(eventId: string, passcode: string): Promise<string> {
    return (await req<{ token: string }>('POST', `/e/${eventId}/api/mod/login`, { passcode })).token
  },
  /** The descent level a director forced (wave 49, C3.3). Throws a 404 on an older server. */
  async descent(eventId: string): Promise<number | null> {
    return descentFromWire(await req<unknown>('GET', `/e/${eventId}/api/mod/spatial/descent`))
  },
  /** Force the level of the next deals, or null for by visits. */
  async setDescent(eventId: string, level: number | null): Promise<number | null> {
    return descentFromWire(await req<unknown>('POST', `/e/${eventId}/api/mod/spatial/descent`, { level }))
  },
}

// --- Trabolta's letters (wave 41, `docs/loom-w41-contract.md` C5) ---------

/** Run's letters: directors only (never on the host allowlist). */
export const lettersApi = {
  /** Every address on file, its draft and its send. 404 from an older server. */
  async view(eventId: string): Promise<LettersView> {
    const v = lettersViewOf(await req<unknown>('GET', `/e/${eventId}/api/mod/letters`))
    if (v === null) throw new ApiError(502, { error: 'the server’s letters answer is not one' })
    return v
  },
  /** Ask the writer for every row without a draft (or `keys`; `redo`
   *  replaces a draft that is not sent). 409 `no_writer`. */
  async write(eventId: string, keys?: string[], redo?: boolean): Promise<{ queued: number }> {
    const r = await req<{ queued?: unknown }>('POST', `/e/${eventId}/api/mod/letters/write`, { ...(keys !== undefined ? { keys } : {}), ...(redo ? { redo: true } : {}) })
    return { queued: typeof r.queued === 'number' ? r.queued : 0 }
  },
  /** A director's own edit of one draft (`by` = you). */
  async draft(eventId: string, key: string, subject: string, text: string): Promise<void> {
    await req<unknown>('POST', `/e/${eventId}/api/mod/letters/draft`, { key, subject, text })
  },
  /** Send every drafted, unsent row (or `keys`), in the background. 409
   *  `mail_off` / `nothing_to_send` / `busy`. */
  async send(eventId: string, keys?: string[]): Promise<{ sending: number }> {
    const r = await req<{ sending?: unknown }>('POST', `/e/${eventId}/api/mod/letters/send`, keys !== undefined ? { keys } : {})
    return { sending: typeof r.sending === 'number' ? r.sending : 0 }
  },
  /** Take one row off file. */
  async forget(eventId: string, key: string): Promise<void> {
    await req<unknown>('POST', `/e/${eventId}/api/mod/letters/forget`, { key })
  },
}

// --- who opted out of the video (wave 44, `docs/loom-w44-contract.md` C6) --

/** The same-origin URL of a profile picture by serving key (`ModView.avatars`
 *  values, `VideoConsentRow.avatar`): the event server serves it publicly at
 *  `/e/:id/api/avatar/<key>`, as play draws it. */
export function avatarUrl(eventId: string, key: string): string {
  return `${BASE}/e/${encodeURIComponent(eventId)}/api/avatar/${encodeURIComponent(key)}`
}

/** Run's video consent: directors only (never on the host allowlist). */
export const videoApi = {
  /** Every guest's answer, the counts. 404 from an older server. */
  async view(eventId: string): Promise<VideoConsentView> {
    const v = videoConsentViewOf(await req<unknown>('GET', `/e/${eventId}/api/mod/video`))
    if (v === null) throw new ApiError(502, { error: 'the server’s video answer is not one' })
    return v
  },
  /** The same rows as `text/csv` (`program,video,id`, `out` first). */
  async csv(eventId: string): Promise<string> {
    const res = await fetch(`${BASE}/e/${eventId}/api/mod/video?format=csv`, { credentials: 'include' })
    if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))) as Record<string, unknown>)
    return await res.text()
  },
}

// --- the terminals' photos (wave 59p, `docs/loom-w59-photos-contract.md`) ----

function photosOf(raw: unknown): PhotosView {
  const v = photosViewOf(raw)
  if (v === null) throw new ApiError(502, { error: 'the server’s photos answer is not one' })
  return v
}

/** The photos' panel. Pictures of people: a director's session, or a host's token, on every call. */
export const photosApi = {
  async view(eventId: string): Promise<PhotosView> {
    return photosOf(await req<unknown>('GET', `/e/${encodeURIComponent(eventId)}/api/mod/photos`))
  },
  async arm(eventId: string, armed: boolean): Promise<PhotosView> {
    return photosOf(await req<unknown>('POST', `/e/${encodeURIComponent(eventId)}/api/mod/photos/arm`, { armed }))
  },
  async deleteAll(eventId: string): Promise<PhotosView> {
    const out = await req<{ view: unknown }>('POST', `/e/${encodeURIComponent(eventId)}/api/mod/photos/delete`, { confirm: 'delete' })
    return photosOf(out.view)
  },
  /** One spot's latest still, by the session cookie; `step` keeps the browser from caching it for good. */
  thumbUrl(eventId: string, spot: string, step: number): string {
    return `${BASE}/e/${encodeURIComponent(eventId)}/api/mod/photos/thumb?spot=${encodeURIComponent(spot)}&step=${step}`
  },
  /** The tar, a plain link: the browser saves it as it comes. */
  downloadUrl(eventId: string): string {
    return `${BASE}/e/${encodeURIComponent(eventId)}/api/mod/photos/download`
  },
}

// --- the credits (wave 44, `docs/loom-w44-contract.md` C5) ------------------

/** The roll as the server would send it now (mod: with `source` and
 *  `problems`). 404 `no_credits` with no file. */
export const creditsApi = {
  async view(eventId: string): Promise<CreditsView> {
    const v = creditsViewOf(await req<unknown>('GET', `/e/${eventId}/api/credits`))
    if (v === null) throw new ApiError(502, { error: 'the server’s credits answer is not one' })
    return v
  },
}
