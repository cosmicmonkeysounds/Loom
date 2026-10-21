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
let stopAnswer: { status: number; body: unknown } = { status: 200, body: { ok: true, seq: 3, router: { online: true, lastSeen: 1, name: 'house-mac' } } }
/** Hold the next GET until `releaseGet` is called (a poll in flight). */
let holdNextGet = false
let releaseGet: (() => void) | null = null

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  calls = []
  version = 'v1'
  audio = { version: 1, cues: {}, announce: { to: ['everywhere'], chime: true } }
  saveStatus = 200
  stopAnswer = { status: 200, body: { ok: true, seq: 3, router: { online: true, lastSeen: 1, name: 'house-mac' } } }
  holdNextGet = false
  releaseGet = null
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/]+/u, '')
    const body = init?.body !== undefined ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ method: init?.method ?? 'GET', path, body })
    if (path === '/e/ev1/api/mod/audio' && (init?.method ?? 'GET') === 'GET') {
      // The answer is what the server held when the request arrived.
      const snap = { audio: JSON.parse(JSON.stringify(audio)) as unknown, version }
      if (holdNextGet) {
        holdNextGet = false
        await new Promise<void>((r) => {
          releaseGet = r
        })
      }
      return answer(200, { audio: snap.audio, version: snap.version, source: snap.version === 'v1' ? 'project' : 'director', router: { online: true, lastSeen: 1, name: 'house-mac' }, problems: [], warnings: [], now: 2 })
    }
    if (path === '/e/ev1/api/mod/audio/stop') return answer(stopAnswer.status, stopAnswer.body)
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
    expect(useHouseAudio.getState().stopNote).toMatchObject({ outcome: 'stopped', text: '■ Stopped the house sounds and the announcement' })
  })

  it('a stop with no router says it can’t reach the house Mac; a failed stop says nothing was stopped', async () => {
    await bound()
    stopAnswer = { status: 200, body: { ok: true, seq: 4, router: { online: false, lastSeen: 1, name: 'house-mac' } } }
    await useHouseAudio.getState().stop(false)
    expect(useHouseAudio.getState().stopNote).toMatchObject({ outcome: 'noRouter' })
    expect(useHouseAudio.getState().stopNote?.text).toMatch(/can’t reach the house Mac/u)
    stopAnswer = { status: 401, body: { error: 'Unauthorized' } }
    await useHouseAudio.getState().stop(false)
    expect(useHouseAudio.getState().stopNote).toMatchObject({ outcome: 'failed' })
    expect(useHouseAudio.getState().stopNote?.text).toMatch(/^The stop failed .*nothing was stopped/u)
    expect(useHouseAudio.getState().busy).toBeNull()
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

  it('a poll that left before a tick never undoes it, and the next tick is based on the save', async () => {
    await bound()
    holdNextGet = true
    const poll = useHouseAudio.getState().refresh() // reads v1, no terminals
    await vi.waitFor(() => expect(releaseGet).not.toBeNull())
    const tick = useHouseAudio.getState().setTerminal('tent', true) // saves v2, then waits on the poll
    await vi.waitFor(() => expect(version).toBe('v2'))
    releaseGet!()
    await Promise.all([poll, tick])
    const s = useHouseAudio.getState().status!
    expect(s.version).toBe('v2')
    expect(s.audio['announce']).toMatchObject({ terminals: ['tent'] })
    // The write re-read after the stale poll landed.
    expect(calls.filter((c) => c.method === 'GET').length).toBe(3)
    await useHouseAudio.getState().setTerminal('casino', true)
    expect(useHouseAudio.getState().saveError).toBeNull()
    const last = calls.filter((c) => c.method === 'POST' && c.path === '/e/ev1/api/mod/audio').at(-1)!
    expect(last.body?.['base']).toBe('v2')
  })
})
