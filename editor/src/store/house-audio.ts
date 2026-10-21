//! The house sound watch (wave 18b, Q7 / Q8): the Run header's **■ Stop
//! house sounds** and the Run page's House sound card. Bound for as long as
//! a server project has a run (`App.tsx`, beside the terminal heartbeat), so
//! the header button works from any Run page. Polls `GET /api/mod/audio`
//! every `AUDIO_POLL_MS` for the router's presence and the house list of
//! terminals that also say the announcements; the rules live in the pure
//! `lib/house-audio.ts`. A local run has no router: nothing is bound.

import { create } from 'zustand'
import { ApiError, audioApi } from '@/lib/api'
import { announceTerminalsOf, stopResultText, withAnnounceTerminal, type AudioStatus } from '@/lib/house-audio'

/** How often the card re-reads the config and the router's presence. */
export const AUDIO_POLL_MS = 10_000
/** How long a stop's feedback stays on the button. */
export const STOP_NOTE_MS = 4_000

interface HouseAudioState {
  eventId: string | null
  /** The last read (null = not read yet, or a server with no audio route). */
  status: AudioStatus | null
  /** The last read reached the server. */
  reachable: boolean
  /** A stop / save in flight. */
  busy: 'stop' | 'save' | 'project' | null
  /** The last stop's feedback (cleared after `STOP_NOTE_MS`). */
  stopNote: { text: string; ok: boolean; at: number } | null
  /** Why the last save / Save to project failed (or what a 409 means); null = fine. */
  saveError: string | null
  /** The last save landed as a director save (the card offers Save to project). */
  savedAt: number | null
  bind: (eventId: string | null) => void
  refresh: () => Promise<void>
  /** ■ Stop house sounds (`announce` also cuts the announcement). Never rejects. */
  stop: (announce: boolean) => Promise<void>
  /** Put one map spot on (or off) the house list and save. Never rejects. */
  setTerminal: (spot: string, on: boolean) => Promise<void>
  /** Write the config in force to the project's `audio.json`. Never rejects. */
  saveToProject: () => Promise<void>
}

let timer: ReturnType<typeof setInterval> | null = null
let noteTimer: ReturnType<typeof setTimeout> | null = null
let inFlight = false

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const useHouseAudio = create<HouseAudioState>((set, get) => ({
  eventId: null,
  status: null,
  reachable: true,
  busy: null,
  stopNote: null,
  saveError: null,
  savedAt: null,

  bind: (eventId) => {
    if (get().eventId === eventId) return
    if (timer !== null) clearInterval(timer)
    timer = null
    set({ eventId, status: null, reachable: true, busy: null, stopNote: null, saveError: null, savedAt: null })
    if (eventId === null) return
    timer = setInterval(() => void get().refresh(), AUDIO_POLL_MS)
    void get().refresh()
  },

  refresh: async () => {
    const eventId = get().eventId
    if (eventId === null || inFlight) return
    inFlight = true
    try {
      const status = await audioApi.status(eventId)
      if (get().eventId === eventId) set({ status, reachable: true })
    } catch {
      if (get().eventId === eventId) set({ reachable: false })
    } finally {
      inFlight = false
    }
  },

  stop: async (announce) => {
    const eventId = get().eventId
    if (eventId === null || get().busy === 'stop') return
    set({ busy: 'stop' })
    let note: HouseAudioState['stopNote']
    try {
      const r = await audioApi.stop(eventId, announce)
      note = { text: stopResultText(r, announce), ok: r.router.online, at: Date.now() }
    } catch (e) {
      note = { text: `Couldn’t stop the house sounds: ${message(e)}`, ok: false, at: Date.now() }
    }
    if (get().eventId !== eventId) return
    set({ busy: null, stopNote: note })
    if (noteTimer !== null) clearTimeout(noteTimer)
    noteTimer = setTimeout(() => {
      if (get().stopNote === note) set({ stopNote: null })
    }, STOP_NOTE_MS)
  },

  setTerminal: async (spot, on) => {
    const { eventId, status } = get()
    if (eventId === null || status === null || get().busy !== null) return
    if (announceTerminalsOf(status.audio).includes(spot) === on) return
    set({ busy: 'save', saveError: null })
    try {
      const next = withAnnounceTerminal(status.audio, spot, on)
      const r = await audioApi.save(eventId, next, status.version)
      // Hold the save at once (a poll may already be in flight), so the next
      // tick is based on this version, not the one before it.
      if (get().eventId === eventId) set({ savedAt: Date.now(), status: { ...status, audio: next, version: r.version || status.version, source: 'director' } })
    } catch (e) {
      if (get().eventId !== eventId) return
      set({
        saveError:
          e instanceof ApiError && e.status === 409
            ? 'The speakers changed since this card read them (a save from the map page?): reloaded. Tick it again.'
            : `Couldn’t save the house list: ${message(e)}`,
      })
    } finally {
      if (get().eventId === eventId) set({ busy: null })
    }
    await get().refresh()
  },

  saveToProject: async () => {
    const eventId = get().eventId
    if (eventId === null || get().busy !== null) return
    set({ busy: 'project', saveError: null })
    try {
      await audioApi.saveToProject(eventId)
      if (get().eventId === eventId) set({ savedAt: null })
    } catch (e) {
      if (get().eventId === eventId) set({ saveError: `Couldn’t save to the project: ${message(e)}` })
    } finally {
      if (get().eventId === eventId) set({ busy: null })
    }
    await get().refresh()
  },
}))
