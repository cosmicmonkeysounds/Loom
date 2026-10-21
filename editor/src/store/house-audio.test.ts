// The house sound store against a fake server (wave 18b, Q7 / Q8): it reads
// GET /api/mod/audio, stops the house sounds (with or without the
// announcement), edits the house list as a director save with `base`, says
// what a 409 means and reloads, and saves to the project.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHouseAudio } from './house-audio'

interface Call {
  method: string
  path: string
  body: Record<string, unknown> | undefined
}

let calls: Call[] = []
let version = 'v1'
let audio: Record<string, unknown> = { version: 1, cues: {}, announce: { to: ['everywhere'], chime: true } }
let saveStatus = 200

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  calls = []
  version = 'v1'
  audio = { version: 1, cues: {}, announce: { to: ['everywhere'], chime: true } }
  saveStatus = 200
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/]+/u, '')
    const body = init?.body !== undefined ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ method: init?.method ?? 'GET', path, body })
    if (path === '/e/ev1/api/mod/audio' && (init?.method ?? 'GET') === 'GET') {
      return answer(200, { audio, version, source: version === 'v1' ? 'project' : 'director', router: { online: true, lastSeen: 1, name: 'house-mac' }, problems: [], warnings: [], now: 2 })
    }
    if (path === '/e/ev1/api/mod/audio/stop') return answer(200, { ok: true, seq: 3, router: { online: true, lastSeen: 1, name: 'house-mac' } })
    if (path === '/e/ev1/api/mod/audio') {
      if (saveStatus !== 200) {
        version = 'v9'
        return answer(saveStatus, { error: 'the speakers changed since you loaded them', version })
      }
      audio = body!['audio'] as Record<string, unknown>
      version = 'v2'
      return answer(200, { ok: true, version, source: 'director', warnings: [] })
    }
    if (path === '/e/ev1/api/mod/audio/project') {
      version = 'v1'
      return answer(200, { ok: true, file: 'audio.json', version, source: 'project' })
    }
    return answer(404, { error: 'no' })
  })
})

afterEach(() => {
  useHouseAudio.getState().bind(null)
  vi.unstubAllGlobals()
})

async function bound(): Promise<void> {
  useHouseAudio.getState().bind('ev1')
  await vi.waitFor(() => expect(useHouseAudio.getState().status).not.toBeNull())
}

describe('the house sound store', () => {
  it('reads the config and the router on bind; unbinding forgets it', async () => {
    await bound()
    expect(useHouseAudio.getState().status).toMatchObject({ version: 'v1', source: 'project', router: { online: true } })
    useHouseAudio.getState().bind(null)
    expect(useHouseAudio.getState().status).toBeNull()
  })

  it('stops the house sounds, with the announcement only when asked', async () => {
    await bound()
    await useHouseAudio.getState().stop(false)
    await useHouseAudio.getState().stop(true)
    expect(calls.filter((c) => c.path.endsWith('/audio/stop')).map((c) => c.body)).toEqual([{ announce: false }, { announce: true }])
    expect(useHouseAudio.getState().stopNote).toMatchObject({ ok: true, text: '■ Stopped the house sounds and the announcement' })
  })

  it('a tick saves the whole config back with base, then re-reads', async () => {
    await bound()
    await useHouseAudio.getState().setTerminal('tent', true)
    const save = calls.find((c) => c.method === 'POST' && c.path === '/e/ev1/api/mod/audio')!
    expect(save.body).toEqual({ audio: { version: 1, cues: {}, announce: { to: ['everywhere'], chime: true, terminals: ['tent'] } }, base: 'v1' })
    expect(useHouseAudio.getState().status).toMatchObject({ version: 'v2', source: 'director' })
    expect(useHouseAudio.getState().savedAt).not.toBeNull()
    // Already on the list: no save.
    const before = calls.length
    await useHouseAudio.getState().setTerminal('tent', true)
    expect(calls.length).toBe(before)
  })

  it('a 409 says the speakers changed and reloads', async () => {
    await bound()
    saveStatus = 409
    await useHouseAudio.getState().setTerminal('tent', true)
    expect(useHouseAudio.getState().saveError).toMatch(/changed since this card read them/u)
    expect(useHouseAudio.getState().status?.version).toBe('v9')
    expect(useHouseAudio.getState().busy).toBeNull()
  })

  it('Save to project writes the project file and re-reads', async () => {
    await bound()
    await useHouseAudio.getState().setTerminal('tent', true)
    await useHouseAudio.getState().saveToProject()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/e/ev1/api/mod/audio/project')).toBe(true)
    expect(useHouseAudio.getState().status?.source).toBe('project')
  })
})
