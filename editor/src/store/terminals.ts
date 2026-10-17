//! The terminal heartbeat watch (OCT31 K-29) — the director's Run card + the
//! header pill. Bound for as long as a server project has a run (`App.tsx`
//! follows the operate store's event), never per mode, so a dead kiosk
//! chimes even while the director is on Writing. Polls
//! `GET /e/:id/api/mod/screen/terminals` every `TERMINALS_POLL_MS`; the
//! rules live in the pure `lib/terminals.ts`.

import { create } from 'zustand'
import { screensApi } from '@/lib/api'
import { playChime } from '@/lib/chime'
import {
  TERMINALS_POLL_MS,
  mergeTerminals,
  newlySilent,
  pruneAcks,
  shouldChime,
  type ScreenTerminals,
  type TerminalMemory,
  type TerminalRow,
} from '@/lib/terminals'

interface TerminalsState {
  eventId: string | null
  rows: TerminalRow[]
  /** The TV-voice mute as the server last said (null = not known yet). */
  voiceMuted: boolean | null
  /** Why the last TV-mute flip failed (offline, a 403), shown on the card; null = fine. */
  muteError: string | null
  /** The last poll reached the server. */
  reachable: boolean
  /** Silent terminals the director has acknowledged (no re-chime). */
  acked: Set<string>
  /** Watch one event's terminals (null = stop). */
  bind: (eventId: string | null) => void
  ack: (name: string) => void
  /** Drop a remembered terminal (a spare that was switched off on purpose). */
  forget: (name: string) => void
  /** Flip the TV-voice mute. Never rejects: a failure lands in `muteError`. */
  setVoiceMuted: (muted: boolean) => Promise<void>
  /** Why the last identify failed; null = fine. */
  identifyError: string | null
  /** Ask one terminal to show its name (SW-SCR-21). Never rejects: a failure lands in `identifyError`. */
  identify: (name: string) => Promise<void>
  /** One poll now (the interval calls it). */
  tick: () => Promise<void>
}

let timer: ReturnType<typeof setInterval> | null = null
let memory: TerminalMemory = {}
let lastChime = 0
let inFlight = false

const keyOf = (eventId: string) => `loom.terminals.${eventId}`
/** A remembered terminal unseen this long is dropped on load (last week's rehearsal tablets). */
const FORGET_AFTER_MS = 12 * 60 * 60 * 1000

function load(eventId: string): TerminalMemory {
  try {
    const raw = localStorage.getItem(keyOf(eventId))
    const v = raw === null ? null : (JSON.parse(raw) as unknown)
    if (v === null || typeof v !== 'object') return {}
    const cutoff = Date.now() - FORGET_AFTER_MS
    const out: TerminalMemory = {}
    for (const [name, m] of Object.entries(v as TerminalMemory)) {
      if (m !== null && typeof m === 'object' && typeof m.lastSeen === 'number' && m.lastSeen >= cutoff) out[name] = { spot: String(m.spot ?? ''), view: String(m.view ?? ''), room: typeof m.room === 'string' ? m.room : '', lastSeen: m.lastSeen }
    }
    return out
  } catch {
    return {}
  }
}
function save(eventId: string, m: TerminalMemory): void {
  try {
    localStorage.setItem(keyOf(eventId), JSON.stringify(m))
  } catch {
    /* private window / blocked storage: the server's list still works */
  }
}

export const useTerminals = create<TerminalsState>((set, get) => ({
  eventId: null,
  rows: [],
  voiceMuted: null,
  muteError: null,
  identifyError: null,
  reachable: true,
  acked: new Set(),

  bind: (eventId) => {
    if (get().eventId === eventId) return
    if (timer !== null) clearInterval(timer)
    timer = null
    memory = eventId === null ? {} : load(eventId)
    lastChime = 0
    set({ eventId, rows: mergeTerminals(memory, null, Date.now()).rows, voiceMuted: null, muteError: null, identifyError: null, reachable: true, acked: new Set() })
    if (eventId === null) return
    timer = setInterval(() => void get().tick(), TERMINALS_POLL_MS)
    void get().tick()
  },

  ack: (name) => set((s) => ({ acked: new Set([...s.acked, name]) })),

  forget: (name) => {
    const { eventId } = get()
    delete memory[name]
    if (eventId !== null) save(eventId, memory)
    set((s) => ({ rows: s.rows.filter((r) => r.name !== name) }))
  },

  setVoiceMuted: async (muted) => {
    const { eventId } = get()
    if (eventId === null) return
    try {
      const r = await screensApi.setVoiceMuted(eventId, muted)
      if (get().eventId === eventId) set({ voiceMuted: r.muted, muteError: null })
    } catch (e) {
      if (get().eventId === eventId) set({ muteError: `Couldn’t ${muted ? 'mute' : 'unmute'} the TV voice: ${e instanceof Error ? e.message : String(e)}` })
    }
  },

  identify: async (name) => {
    const { eventId } = get()
    if (eventId === null) return
    try {
      await screensApi.identify(eventId, name)
      if (get().eventId === eventId) set({ identifyError: null })
    } catch (e) {
      if (get().eventId === eventId) set({ identifyError: `Couldn’t identify ${name}: ${e instanceof Error ? e.message : String(e)}` })
    }
  },

  tick: async () => {
    const eventId = get().eventId
    if (eventId === null || inFlight) return
    inFlight = true
    let server: ScreenTerminals | null
    try {
      server = await screensApi.terminals(eventId)
    } catch {
      server = null
    } finally {
      inFlight = false
    }
    if (get().eventId !== eventId) return // re-bound meanwhile
    const now = Date.now()
    const { memory: next, rows } = mergeTerminals(memory, server, now)
    memory = next
    if (server !== null) save(eventId, memory)
    const prev = get().rows
    const acked = pruneAcks(get().acked, rows)
    if (shouldChime(newlySilent(prev, rows), rows, acked, lastChime, now)) {
      lastChime = now
      playChime()
    }
    set({ rows, acked, reachable: server !== null, ...(server !== null ? { voiceMuted: server.voiceMuted } : {}) })
  },
}))
