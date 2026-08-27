//! Live co-editing client for server projects (the SaaS path).
//!
//! Mirrors `@loom/core`'s `server/collab.ts`: every server-backed file is a
//! Yjs `Y.Doc` (one `Y.Text` at `"content"`), synced with the server over
//! JSON POSTs (base64 Yjs updates) + one Server-Sent-Events stream per
//! project. CodeMirror binds to the doc via `y-codemirror.next` (remote
//! cursors + names ride the shared Awareness), while non-editor write paths
//! (story-graph ops, format-on-save) fold whole-text replacements in through
//! `collabWrite`'s minimal-splice diff — so every edit, from any surface,
//! merges instead of clobbering.
//!
//! The module is a singleton keyed to the open project (like `lsp-client`):
//! `startCollab` on project open, `stopCollab` on close. Everything degrades
//! gracefully — if the server has no collab routes (or the stream drops),
//! `openCollabDoc` returns null and the workspace store falls back to the
//! plain files API (last-write-wins), exactly the old behavior.

import * as Y from 'yjs'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'

/** Origin marking transactions that came FROM the server (never re-posted). */
export const REMOTE_ORIGIN = Symbol('collab-remote')
/** Origin for programmatic local writes (graph edits, format-on-save). */
export const LOCAL_ORIGIN = Symbol('collab-local')

export interface CollabHandlers {
  /** The doc's text changed (any origin) — reflect into the store/LSP. */
  onText: (path: string, text: string) => void
  /** A file appeared/disappeared server-side — reconcile the tree. */
  onFiles: (op: 'put' | 'delete', path: string) => void
}

interface DocEntry {
  doc: Y.Doc
  ytext: Y.Text
  awareness: Awareness
  undoManager: Y.UndoManager
  synced: boolean
  /** Updates that arrived over SSE mid-handshake; applied after sync. */
  buffered: Uint8Array[]
  /** Outgoing updates not yet accepted by the server. */
  outbox: Uint8Array[]
  sendTimer: ReturnType<typeof setTimeout> | null
  awarenessTimer: ReturnType<typeof setTimeout> | null
  awarenessDirty: boolean
}

const BASE = import.meta.env.VITE_LOOM_API ?? ''

// -- module state ----------------------------------------------------------

let projectId: string | null = null
let cid = ''
let stream: EventSource | null = null
let handlers: CollabHandlers | null = null
let localUser: { name: string; color: string } = { name: 'Author', color: '#8b5cf6' }
const docs = new Map<string, DocEntry>()
const opening = new Map<string, Promise<DocEntry | null>>()

// -- helpers ---------------------------------------------------------------

function toB64(u: Uint8Array): string {
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode(...u.subarray(i, i + CH))
  return btoa(s)
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}

const CURSOR_COLORS = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6']

function colorFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return CURSOR_COLORS[Math.abs(h) % CURSOR_COLORS.length]
}

async function post<T = Record<string, unknown>>(action: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/collab/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`collab ${action}: HTTP ${res.status}`)
  return (await res.json()) as T
}

/**
 * Replace a `Y.Text`'s content as a minimal single splice (longest common
 * prefix + suffix) — the client half of the shared shape in
 * `@loom/core`'s `server/collab.ts`.
 */
export function replaceIntoYText(ytext: Y.Text, next: string, origin?: unknown): void {
  const prev = ytext.toString()
  if (prev === next) return
  let start = 0
  const minLen = Math.min(prev.length, next.length)
  while (start < minLen && prev[start] === next[start]) start++
  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--
    endNext--
  }
  ytext.doc!.transact(() => {
    if (endPrev > start) ytext.delete(start, endPrev - start)
    if (endNext > start) ytext.insert(start, next.slice(start, endNext))
  }, origin)
}

// -- outgoing update queue -------------------------------------------------

function scheduleSend(path: string, entry: DocEntry): void {
  if (entry.sendTimer !== null) return
  entry.sendTimer = setTimeout(() => {
    entry.sendTimer = null
    void flushOutbox(path, entry)
  }, 20)
}

async function flushOutbox(path: string, entry: DocEntry): Promise<void> {
  if (entry.outbox.length === 0 || projectId === null) return
  const merged = Y.mergeUpdates(entry.outbox)
  entry.outbox = []
  try {
    await post('update', { path, update: toB64(merged), cid })
  } catch {
    // Offline / server hiccup: keep it queued; the reconnect resync (or the
    // next local edit) retries.
    entry.outbox.unshift(merged)
    if (entry.sendTimer === null) {
      entry.sendTimer = setTimeout(() => {
        entry.sendTimer = null
        void flushOutbox(path, entry)
      }, 2000)
    }
  }
}

function scheduleAwareness(path: string, entry: DocEntry): void {
  entry.awarenessDirty = true
  if (entry.awarenessTimer !== null) return
  entry.awarenessTimer = setTimeout(() => {
    entry.awarenessTimer = null
    if (!entry.awarenessDirty || projectId === null) return
    entry.awarenessDirty = false
    const update = encodeAwarenessUpdate(entry.awareness, [entry.awareness.clientID])
    void post('awareness', { path, update: toB64(update), cid }).catch(() => {})
  }, 80)
}

// -- doc lifecycle ---------------------------------------------------------

function makeEntry(path: string): DocEntry {
  const doc = new Y.Doc()
  const ytext = doc.getText('content')
  // Presence is announced only once the doc has synced (see openCollabDoc),
  // so a failed handshake never POSTs stray awareness.
  const awareness = new Awareness(doc)
  const undoManager = new Y.UndoManager(ytext)
  const entry: DocEntry = {
    doc,
    ytext,
    awareness,
    undoManager,
    synced: false,
    buffered: [],
    outbox: [],
    sendTimer: null,
    awarenessTimer: null,
    awarenessDirty: false,
  }
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) {
      entry.outbox.push(update)
      if (entry.synced) scheduleSend(path, entry)
    }
    // Reflect EVERY change (local or remote) into the store synchronously —
    // idempotent for local edits, the delivery path for remote ones.
    handlers?.onText(path, ytext.toString())
  })
  awareness.on('update', (_changes: unknown, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) scheduleAwareness(path, entry)
  })
  return entry
}

/**
 * The live doc for a server file — created on demand, synced with the
 * server before it's handed out. Null when collab isn't available (no
 * project stream started, or the server lacks the routes): callers fall
 * back to the plain files API.
 */
export async function openCollabDoc(
  path: string,
): Promise<{ ytext: Y.Text; awareness: Awareness; undoManager: Y.UndoManager; text: string } | null> {
  if (projectId === null) return null
  const ready = docs.get(path)
  if (ready?.synced) return { ytext: ready.ytext, awareness: ready.awareness, undoManager: ready.undoManager, text: ready.ytext.toString() }
  let pending = opening.get(path)
  if (pending === undefined) {
    pending = (async (): Promise<DocEntry | null> => {
      const entry = docs.get(path) ?? makeEntry(path)
      docs.set(path, entry)
      try {
        const r = await post<{ update: string; sv: string }>('sync', {
          path,
          sv: toB64(Y.encodeStateVector(entry.doc)),
        })
        Y.applyUpdate(entry.doc, fromB64(r.update), REMOTE_ORIGIN)
        for (const u of entry.buffered) Y.applyUpdate(entry.doc, u, REMOTE_ORIGIN)
        entry.buffered = []
        entry.synced = true
        entry.awareness.setLocalStateField('user', localUser)
        // Push anything the server is missing (e.g. edits queued offline).
        const missing = Y.encodeStateAsUpdate(entry.doc, fromB64(r.sv))
        if (missing.length > 2) {
          entry.outbox.push(missing)
          scheduleSend(path, entry)
        }
        return entry
      } catch {
        entry.doc.destroy()
        docs.delete(path)
        return null
      } finally {
        opening.delete(path)
      }
    })()
    opening.set(path, pending)
  }
  const entry = await pending
  if (entry === null) return null
  return { ytext: entry.ytext, awareness: entry.awareness, undoManager: entry.undoManager, text: entry.ytext.toString() }
}

/** The synced doc for a path if one exists (for the CodeMirror binding). */
export function collabEntryFor(path: string): { ytext: Y.Text; awareness: Awareness; undoManager: Y.UndoManager } | null {
  const entry = docs.get(path)
  if (!entry?.synced) return null
  return { ytext: entry.ytext, awareness: entry.awareness, undoManager: entry.undoManager }
}

/**
 * Fold a whole-text replacement (graph edit, format-on-save) into the live
 * doc. Returns false when the file has no live doc — the caller should
 * fall back to the plain files API.
 */
export function collabWrite(path: string, next: string): boolean {
  const entry = docs.get(path)
  if (!entry?.synced) return false
  replaceIntoYText(entry.ytext, next, LOCAL_ORIGIN)
  return true
}

/** The live text for a path, if a synced doc exists (tree reconciliation). */
export function collabTextFor(path: string): string | null {
  const entry = docs.get(path)
  return entry?.synced ? entry.ytext.toString() : null
}

/** Forget a file's doc (deleted or renamed away). */
export function dropCollabDoc(path: string): void {
  const entry = docs.get(path)
  if (entry === undefined) return
  if (entry.sendTimer !== null) clearTimeout(entry.sendTimer)
  if (entry.awarenessTimer !== null) clearTimeout(entry.awarenessTimer)
  entry.awareness.destroy()
  entry.doc.destroy()
  docs.delete(path)
}

// -- the project stream ----------------------------------------------------

async function resyncAll(): Promise<void> {
  for (const [path, entry] of docs) {
    if (!entry.synced) continue
    try {
      const r = await post<{ update: string; sv: string }>('sync', {
        path,
        sv: toB64(Y.encodeStateVector(entry.doc)),
      })
      Y.applyUpdate(entry.doc, fromB64(r.update), REMOTE_ORIGIN)
      const missing = Y.encodeStateAsUpdate(entry.doc, fromB64(r.sv))
      if (missing.length > 2) {
        entry.outbox.push(missing)
      }
      if (entry.outbox.length > 0) scheduleSend(path, entry)
    } catch {
      // Still offline — the next reconnect retries.
    }
  }
}

/** Is live co-editing up for the open project? */
export function isCollabActive(): boolean {
  return projectId !== null
}

/** Start co-editing for a server project (idempotent per project). */
export function startCollab(pid: string, user: { name: string }, h: CollabHandlers): void {
  if (projectId === pid) {
    handlers = h
    return
  }
  stopCollab()
  projectId = pid
  handlers = h
  cid = Math.random().toString(36).slice(2, 10)
  localUser = { name: user.name || 'Author', color: colorFor(user.name || 'Author') }

  const es = new EventSource(`${BASE}/api/projects/${pid}/collab/stream?cid=${cid}`, { withCredentials: true })
  stream = es
  let hadOpen = false
  es.onopen = () => {
    // The first open needs no resync (docs handshake on creation); every
    // reconnect reconciles both directions via state vectors.
    if (hadOpen) void resyncAll()
    hadOpen = true
  }
  es.addEventListener('update', (ev) => {
    const { path, update } = JSON.parse((ev as MessageEvent).data) as { path: string; update: string }
    const entry = docs.get(path)
    if (entry === undefined) {
      // Someone is editing a file we haven't opened — pull it in so the
      // story graph / lint stay live across the whole project.
      void openCollabDoc(path)
      return
    }
    const u = fromB64(update)
    if (!entry.synced) entry.buffered.push(u)
    else Y.applyUpdate(entry.doc, u, REMOTE_ORIGIN)
  })
  es.addEventListener('awareness', (ev) => {
    const { path, update } = JSON.parse((ev as MessageEvent).data) as { path: string; update: string }
    const entry = docs.get(path)
    if (entry?.synced) applyAwarenessUpdate(entry.awareness, fromB64(update), REMOTE_ORIGIN)
  })
  es.addEventListener('files', (ev) => {
    const { op, path } = JSON.parse((ev as MessageEvent).data) as { op: 'put' | 'delete'; path: string }
    if (op === 'delete') dropCollabDoc(path)
    handlers?.onFiles(op, path)
  })
}

/** Tear down the stream + every doc (project closed / switched). */
export function stopCollab(): void {
  stream?.close()
  stream = null
  for (const [path, entry] of docs) {
    removeAwarenessStates(entry.awareness, [entry.awareness.clientID], 'closing')
    void path
  }
  for (const path of [...docs.keys()]) dropCollabDoc(path)
  opening.clear()
  projectId = null
  handlers = null
}
