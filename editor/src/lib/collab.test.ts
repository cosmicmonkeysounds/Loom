// The collab client against a fake hub (the server's `CollabHub` handshake
// shape over a stubbed `fetch` + `EventSource`): a stream the server closed
// reopens and resyncs, and a server that restarted — and so rebuilt every
// doc from its stored row, a NEW history of the same text — is rebased
// onto, never merged with (which would double the file, here and in the
// stored row).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { collabEntryFor, collabTextFor, collabWrite, openCollabDoc, serverLostHistory, startCollab, stopCollab } from '@/lib/collab'

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64')
const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'))

/** The server's `CollabHub`, minus fan-out: one Y.Doc per file seeded from
 *  the stored row on first touch; a restart persists and forgets them. */
class FakeHub {
  stored = new Map<string, string>()
  docs = new Map<string, Y.Doc>()
  /** Every route answers 502 (the proxy while the server is down). */
  down = false

  doc(path: string): Y.Doc {
    let d = this.docs.get(path)
    if (d === undefined) {
      d = new Y.Doc()
      const s = this.stored.get(path)
      if (s) d.getText('content').insert(0, s)
      this.docs.set(path, d)
    }
    return d
  }

  text(path: string): string {
    return this.doc(path).getText('content').toString()
  }

  persist(): void {
    for (const [p, d] of this.docs) this.stored.set(p, d.getText('content').toString())
  }

  restart(): void {
    this.persist()
    this.docs.clear()
  }

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (this.down) return new Response('bad gateway', { status: 502 })
    const { pathname } = new URL(url, 'http://loom.test')
    const action = /\/collab\/(\w+)$/.exec(pathname)?.[1]
    if (action === undefined) return Response.json({ event: null }) // the reopen probe
    const body = JSON.parse(String(init?.body ?? '{}')) as { path: string; sv?: string; update?: string }
    if (action === 'sync') {
      const d = this.doc(body.path)
      const sv = body.sv !== undefined && body.sv !== '' ? unb64(body.sv) : undefined
      return Response.json({ update: b64(Y.encodeStateAsUpdate(d, sv)), sv: b64(Y.encodeStateVector(d)) })
    }
    if (action === 'update') Y.applyUpdate(this.doc(body.path), unb64(body.update!))
    return Response.json({ ok: true })
  }
}

/** Just enough `EventSource` for collab.ts: open / close-for-good. */
class FakeEventSource {
  static all: FakeEventSource[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeEventSource.all.push(this)
  }
  addEventListener(): void {}
  close(): void {
    this.readyState = 2
  }
  open(): void {
    this.readyState = 1
    this.onopen?.()
  }
  /** A non-200 answer: closed for good, the browser never retries. */
  fail(): void {
    this.readyState = 2
    this.onerror?.()
  }
}

const PATH = 'main.loom'
const SEED = '== Power On\nHello\n'
const latest = () => FakeEventSource.all[FakeEventSource.all.length - 1]!

let hub: FakeHub
let rebinds: string[]

beforeEach(async () => {
  vi.useFakeTimers()
  hub = new FakeHub()
  hub.stored.set(PATH, SEED)
  rebinds = []
  FakeEventSource.all = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('fetch', hub.fetch)
  startCollab('p-1', { name: 'Ada' }, { onText: () => {}, onFiles: () => {}, onRebind: (p) => rebinds.push(p) })
  latest().open()
  const opened = await openCollabDoc(PATH)
  expect(opened?.text).toBe(SEED)
  collabWrite(PATH, `${SEED}edit\n`)
  await vi.advanceTimersByTimeAsync(50)
  expect(hub.text(PATH)).toBe(`${SEED}edit\n`)
})

afterEach(() => {
  stopCollab()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('serverLostHistory', () => {
  it('is true only when a client the server reported went missing or back', () => {
    const prev = new Map([
      [1, 5],
      [2, 3],
    ])
    expect(serverLostHistory(prev, new Map([[1, 5], [2, 3], [9, 1]]))).toBe(false)
    expect(serverLostHistory(prev, new Map([[1, 7], [2, 3]]))).toBe(false)
    expect(serverLostHistory(prev, new Map([[1, 5]]))).toBe(true)
    expect(serverLostHistory(prev, new Map([[1, 4], [2, 3]]))).toBe(true)
    expect(serverLostHistory(new Map(), new Map([[7, 2]]))).toBe(false)
  })
})

describe('a collab stream the server closed', () => {
  it('reopens and merges an outage edit once when the server kept its doc', async () => {
    const before = collabEntryFor(PATH)!.ytext
    hub.down = true
    latest().fail()
    collabWrite(PATH, `${SEED}edit\noutage\n`) // queued: every post 502s
    await vi.advanceTimersByTimeAsync(1_000) // the first probe: still down
    expect(FakeEventSource.all).toHaveLength(1)
    hub.down = false
    await vi.advanceTimersByTimeAsync(2_000) // the second probe answers → reopen
    expect(FakeEventSource.all).toHaveLength(2)
    latest().open()
    await vi.advanceTimersByTimeAsync(100)
    expect(collabTextFor(PATH)).toBe(`${SEED}edit\noutage\n`)
    expect(hub.text(PATH)).toBe(`${SEED}edit\noutage\n`)
    expect(collabEntryFor(PATH)!.ytext).toBe(before) // same doc, no rebind
    expect(rebinds).toEqual([])
  })

  it('rebases onto a restarted server instead of doubling the file', async () => {
    latest().fail()
    hub.restart() // a fresh doc seeded from the row: a new history of the same text
    // Typed while the stream is dead: the post lands on the NEW doc, whose
    // history it doesn't share (it waits there as unintegrated structs).
    collabWrite(PATH, `${SEED}edit\noutage\n`)
    await vi.advanceTimersByTimeAsync(1_000)
    latest().open()
    await vi.advanceTimersByTimeAsync(100)
    expect(collabTextFor(PATH)).toBe(`${SEED}edit\noutage\n`)
    expect(hub.text(PATH)).toBe(`${SEED}edit\noutage\n`)
    hub.persist()
    expect(hub.stored.get(PATH)).toBe(`${SEED}edit\noutage\n`)
    expect(rebinds).toEqual([PATH])
    // The new doc is live: the next edit reaches the server once.
    collabWrite(PATH, `${SEED}edit\noutage\nafter\n`)
    await vi.advanceTimersByTimeAsync(50)
    expect(hub.text(PATH)).toBe(`${SEED}edit\noutage\nafter\n`)
  })

  it('rebases when the server was down for the whole outage, edits queued', async () => {
    hub.down = true
    latest().fail()
    collabWrite(PATH, `== Power On\nHi\nedit\n`) // a deletion + an insert, both queued
    hub.restart()
    hub.down = false
    await vi.advanceTimersByTimeAsync(1_000)
    latest().open()
    await vi.advanceTimersByTimeAsync(2_100) // incl. the queued outbox's 2 s retry
    expect(collabTextFor(PATH)).toBe(`== Power On\nHi\nedit\n`)
    expect(hub.text(PATH)).toBe(`== Power On\nHi\nedit\n`)
    expect(rebinds).toEqual([PATH])
  })
})
