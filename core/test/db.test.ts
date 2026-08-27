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
  addMember,
  canModerateEvent,
  createEvent,
  createProject,
  findUserByEmail,
  getProjectFor,
  listMembers,
  listProjectsFor,
  projectSource,
  removeMember,
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
