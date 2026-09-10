//! Control-plane data-layer tests against a real Postgres.
//!
//! These are gated on DB connectivity: with no reachable database (the
//! default in CI) every case skips, so `pnpm test` stays green offline. To
//! run them, point `DATABASE_URL` at a Postgres and re-run — e.g.
//! `DATABASE_URL=postgres://127.0.0.1:5432/loom_dev pnpm --filter @loom/core test db`.

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { dbReady, initSchema, pool } from '../server/db/index.ts'
import {
  acceptInvite,
  addMember,
  canModerateEvent,
  claimInvitesForEmail,
  createEvent,
  createInvite,
  createProject,
  deleteInvite,
  findUserByEmail,
  getInviteByToken,
  getProjectFor,
  listInvites,
  listMembers,
  listProjectsFor,
  projectSource,
  removeMember,
  setEventMode,
  activeEvent,
  upsertFile,
} from '../server/db/queries.ts'
import { migrateAuth } from '../server/auth-server.ts'

const OWNER = `test-owner-${randomUUID()}`
const FRIEND = `test-friend-${randomUUID()}`
const FRIEND_EMAIL = `${FRIEND}@example.test`
let hasDb = false

beforeAll(async () => {
  hasDb = await dbReady()
  if (hasDb) {
    // Same order as server boot: BetterAuth tables first (membership joins
    // the `user` table for invite-by-email), then the domain schema.
    await migrateAuth()
    await initSchema()
    // A second signed-up author to invite onto projects.
    await pool().query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, $2, $3, true, now(), now()) on conflict (id) do nothing`,
      [FRIEND, 'Friendly Dev', FRIEND_EMAIL],
    )
  }
})

afterAll(async () => {
  if (hasDb) {
    // Cascades to project_file + project_member + event rows.
    await pool().query('delete from project where owner_id = $1', [OWNER])
    await pool().query('delete from "user" where id = $1', [FRIEND])
    await pool().end()
  }
})

function codes(prefix: string) {
  return { event: `${prefix}E1`, prime: `${prefix}P1`, mod: `${prefix}M1` }
}

describe('control-plane data layer (Postgres)', () => {
  it('projectSource puts main.loom first and headers each file', async (ctx) => {
    if (!hasDb) return ctx.skip()
    const p = await createProject(OWNER, 'Source Test')
    // Insert out of order + with a path that sorts before "main".
    await upsertFile(p.id, 'cast/villain.loom', 'CHARACTER Villain\n')
    await upsertFile(p.id, 'main.loom', 'TITLE: Demo\n')

    const src = await projectSource(p.id)
    expect(src).not.toBeNull()
    const body = src!.source
    // main.loom leads despite "cast/…" sorting first alphabetically.
    expect(body.indexOf('main.loom')).toBeLessThan(body.indexOf('cast/villain.loom'))
    expect(body).toContain('# ── main.loom ')
    expect(body).toContain('TITLE: Demo')
    expect(body).toContain('CHARACTER Villain')
  })

  it('projectSource is null for a project with no files', async (ctx) => {
    if (!hasDb) return ctx.skip()
    const p = await createProject(OWNER, 'Empty')
    expect(await projectSource(p.id)).toBeNull()
  })

  it('enforces at most one active event per project', async (ctx) => {
    if (!hasDb) return ctx.skip()
    const p = await createProject(OWNER, 'One Active')
    const base = {
      project_id: p.id,
      mode: 'live' as const,
      status: 'open' as const,
      scenario_name: 'x',
      scenario_source: 'TITLE: x\n',
    }
    await createEvent({ id: randomUUID(), ...base, ...codeFields('AAA') })
    // A second active event for the same project violates the partial unique index.
    await expect(createEvent({ id: randomUUID(), ...base, ...codeFields('BBB') })).rejects.toThrow()
  })

  it('go-live flips a rehearsal to live in place, keeping id + codes, and records who launched it', async (ctx) => {
    if (!hasDb) return ctx.skip()
    const p = await createProject(OWNER, 'Go Live')
    const id = randomUUID()
    const row = await createEvent({
      id,
      project_id: p.id,
      mode: 'preview',
      status: 'open',
      scenario_name: 'x',
      scenario_source: 'TITLE: x\n',
      created_by_name: 'Ada',
      ...codeFields('GOL'),
    })
    expect(row.created_by_name).toBe('Ada')
    await setEventMode(id, 'live')
    const live = await activeEvent(p.id)
    expect(live?.id).toBe(id)
    expect(live?.mode).toBe('live')
    expect(live?.event_code).toBe(row.event_code)
    expect(live?.prime_code).toBe(row.prime_code)
    expect(live?.mod_code).toBe(row.mod_code)
    // Still the one active event — the partial unique index is untouched.
    await expect(
      createEvent({ id: randomUUID(), project_id: p.id, mode: 'live', status: 'open', scenario_name: 'x', scenario_source: 'y', ...codeFields('GOM') }),
    ).rejects.toThrow()
  })

  it('rejects a duplicate event code across live events', async (ctx) => {
    if (!hasDb) return ctx.skip()
    const p1 = await createProject(OWNER, 'Codes A')
    const p2 = await createProject(OWNER, 'Codes B')
    const common = { mode: 'live' as const, status: 'open' as const, scenario_name: 'x', scenario_source: 'y' }
    await createEvent({ id: randomUUID(), project_id: p1.id, ...common, event_code: 'DUP111', prime_code: 'DUP222', mod_code: 'DUP333' })
    await expect(
      createEvent({ id: randomUUID(), project_id: p2.id, ...common, event_code: 'DUP111', prime_code: 'NEW222', mod_code: 'NEW333' }),
    ).rejects.toThrow()
  })
})

function codeFields(prefix: string) {
  const c = codes(prefix)
  return { event_code: c.event, prime_code: c.prime, mod_code: c.mod }
}

describe('project membership (collaboration)', () => {
  it('resolves access + role for owner, member, and stranger', async (ctx) => {
    if (!hasDb) return ctx.skip()
    const p = await createProject(OWNER, 'Shared World')

    // Owner sees it as owner; the friend can't see it at all yet.
    expect((await getProjectFor(OWNER, p.id))?.role).toBe('owner')
    expect(await getProjectFor(FRIEND, p.id)).toBeNull()

    await addMember(p.id, FRIEND)
    const asFriend = await getProjectFor(FRIEND, p.id)
    expect(asFriend?.role).toBe('editor')
    expect(asFriend?.owner_email).toBeNull() // OWNER is a synthetic id with no `user` row — left join tolerates that
    expect((await getProjectFor(OWNER, p.id))?.role).toBe('owner')
  })

  it('lists shared projects alongside owned ones', async (ctx) => {
    if (!hasDb) return ctx.skip()
    const p = await createProject(OWNER, 'Listed Share')
    await addMember(p.id, FRIEND)
    const mine = await listProjectsFor(FRIEND)
    const hit = mine.find((x) => x.id === p.id)
    expect(hit?.role).toBe('editor')
    // The owner's listing carries role owner for the same project.
    const owners = await listProjectsFor(OWNER)
    expect(owners.find((x) => x.id === p.id)?.role).toBe('owner')
  })

  it('addMember is idempotent; removeMember revokes access', async (ctx) => {
    if (!hasDb) return ctx.skip()
    const p = await createProject(OWNER, 'Revocable')
    await addMember(p.id, FRIEND)
    await addMember(p.id, FRIEND) // no throw, no duplicate
    expect((await listMembers(p.id)).filter((m) => m.user_id === FRIEND)).toHaveLength(1)
    expect(await removeMember(p.id, FRIEND)).toBe(true)
    expect(await getProjectFor(FRIEND, p.id)).toBeNull()
    expect(await removeMember(p.id, FRIEND)).toBe(false)
  })

  it('members can moderate the project’s events; strangers cannot', async (ctx) => {
    if (!hasDb) return ctx.skip()
    const p = await createProject(OWNER, 'Mod Rights')
    const eventId = randomUUID()
    await createEvent({
      id: eventId,
      project_id: p.id,
      mode: 'preview',
      status: 'open',
      scenario_name: 'x',
      scenario_source: 'TITLE: x\n',
      ...codeFields('MODR'),
    })
    expect(await canModerateEvent(eventId, OWNER)).toBe(true)
    expect(await canModerateEvent(eventId, FRIEND)).toBe(false)
    await addMember(p.id, FRIEND)
    expect(await canModerateEvent(eventId, FRIEND)).toBe(true)
  })

  it('finds an invitee account by email, case-insensitively', async (ctx) => {
    if (!hasDb) return ctx.skip()
    expect((await findUserByEmail(FRIEND_EMAIL.toUpperCase()))?.id).toBe(FRIEND)
    expect(await findUserByEmail('nobody@nowhere.test')).toBeNull()
  })
})

describe('project invites (sharing with an address that has no account yet)', () => {
  it('creates a pending invite, re-inviting refreshes the token', async (ctx) => {
    if (!hasDb) return ctx.skip()
    const p = await createProject(OWNER, 'Invite Pending')
    const first = await createInvite(p.id, '  New.Person@Example.TEST ', OWNER)
    expect(first.email).toBe('new.person@example.test') // normalised
    expect(first.accepted_at).toBeNull()
    const again = await createInvite(p.id, 'new.person@example.test', OWNER)
    expect(again.id).toBe(first.id)
    expect(again.token).not.toBe(first.token)
    expect(await getInviteByToken(first.token)).toBeNull() // old link is dead
    expect((await getInviteByToken(again.token))?.project_name).toBe('Invite Pending')
    expect((await listInvites(p.id)).map((i) => i.id)).toEqual([again.id])
  })

  it('accepting by token grants membership once; the link then reads as used', async (ctx) => {
    if (!hasDb) return ctx.skip()
    const p = await createProject(OWNER, 'Invite Accept')
    const inv = await createInvite(p.id, 'someone@example.test', OWNER)
    // The link is the credential: FRIEND (a different address) can accept it.
    expect(await acceptInvite(inv.token, FRIEND)).toEqual({ project_id: p.id })
    expect((await getProjectFor(FRIEND, p.id))?.role).toBe('editor')
    expect(await listInvites(p.id)).toEqual([]) // no longer pending
    expect((await getInviteByToken(inv.token))?.accepted_at).not.toBeNull()
    expect(await acceptInvite(inv.token, FRIEND)).toBeNull() // second use → null
  })

  it('the owner accepting their own invite does not become a member of their project', async (ctx) => {
    if (!hasDb) return ctx.skip()
    const p = await createProject(OWNER, 'Invite Self')
    const inv = await createInvite(p.id, 'owner-alias@example.test', OWNER)
    expect(await acceptInvite(inv.token, OWNER)).toEqual({ project_id: p.id })
    expect((await listMembers(p.id)).some((m) => m.user_id === OWNER)).toBe(false)
    expect((await getProjectFor(OWNER, p.id))?.role).toBe('owner')
  })

  it('signing up with the invited address claims every pending invite for it', async (ctx) => {
    if (!hasDb) return ctx.skip()
    const a = await createProject(OWNER, 'Claim A')
    const b = await createProject(OWNER, 'Claim B')
    await createInvite(a.id, FRIEND_EMAIL.toUpperCase(), OWNER)
    await createInvite(b.id, FRIEND_EMAIL, OWNER)
    const joined = await claimInvitesForEmail(FRIEND, FRIEND_EMAIL)
    expect(new Set(joined)).toEqual(new Set([a.id, b.id]))
    expect((await listProjectsFor(FRIEND)).filter((x) => x.id === a.id || x.id === b.id)).toHaveLength(2)
    expect(await claimInvitesForEmail(FRIEND, FRIEND_EMAIL)).toEqual([]) // idempotent
  })

  it('revoking a pending invite kills the link', async (ctx) => {
    if (!hasDb) return ctx.skip()
    const p = await createProject(OWNER, 'Invite Revoke')
    const inv = await createInvite(p.id, 'gone@example.test', OWNER)
    expect(await deleteInvite(p.id, inv.id)).toBe(true)
    expect(await getInviteByToken(inv.token)).toBeNull()
    expect(await acceptInvite(inv.token, FRIEND)).toBeNull()
    expect(await deleteInvite(p.id, inv.id)).toBe(false)
  })
})
