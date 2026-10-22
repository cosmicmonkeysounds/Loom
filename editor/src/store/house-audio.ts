//! The house sound watch (wave 18b, Q7 / Q8): the Run header's **■ Stop
//! house sounds** and the Run page's House sound card. Bound for as long as
//! a server project has a run (`App.tsx`, beside the terminal heartbeat), so
//! the header button works from any Run page. Polls `GET /api/mod/audio`
//! every `AUDIO_POLL_MS` for the router's presence and the house list of
//! terminals that also say the announcements; the rules live in the pure
//! `lib/house-audio.ts`. A local run has no router: nothing is bound.

import { create } from 'zustand'
import { ApiError, audioApi, projectsApi } from '@/lib/api'
import { confirmAction } from '@/store/dialog'
import {
  StopOutcome,
  announceTerminalsOf,
  parseAudioFile,
  sameBesideHouseList,
  stopFailedText,
  stopOutcomeOf,
  stopResultText,
  withAnnounceTerminal,
  withAnnounceTerminals,
  type AudioStatus,
} from '@/lib/house-audio'

/** How often the card re-reads the config and the router's presence. */
export const AUDIO_POLL_MS = 10_000
/** How long a stop's feedback stays on the button. */
export const STOP_NOTE_MS = 4_000
/** How long a stop that reached nothing (or failed) stays on the button:
 *  someone has to act on it. */
export const STOP_WARN_MS = 15_000

interface HouseAudioState {
  eventId: string | null
  /** The server project the event belongs to (Save to project compares
   *  against its `audio.json`); null when unknown. */
  projectId: string | null
  /** The last read (null = not read yet, or a server with no audio route). */
  status: AudioStatus | null
  /** The last read reached the server. */
  reachable: boolean
  /** A stop / save in flight. */
  busy: 'stop' | 'save' | 'project' | null
  /** The last stop's feedback (cleared after `STOP_NOTE_MS`). */
  stopNote: { text: string; outcome: StopOutcome; at: number } | null
  /** Why the last save / Save to project failed (or what a 409 means); null = fine. */
  saveError: string | null
  /** The last save landed as a director save (the card offers Save to project). */
  savedAt: number | null
  bind: (eventId: string | null, projectId?: string | null) => void
  refresh: () => Promise<void>
  /** ■ Stop house sounds (`announce` also cuts the announcement). Never rejects. */
  stop: (announce: boolean) => Promise<void>
  /** Put one map spot on (or off) the house list and save. Never rejects. */
  setTerminal: (spot: string, on: boolean) => Promise<void>
  /** Write the config in force to the project's `audio.json`. A director
   *  save that differs from the project's file in more than the house list
   *  asks first, and then keeps the project's speakers and adds only the
   *  list. Never rejects. */
  saveToProject: () => Promise<void>
}

let timer: ReturnType<typeof setInterval> | null = null
let noteTimer: ReturnType<typeof setTimeout> | null = null
/** The read in flight (one at a time); a refresh asked for meanwhile waits
 *  for it and then reads again (`readAgain`). */
let reading: { eventId: string; done: Promise<void> } | null = null
let readAgain = false
/** Bumped as every write (a tick, Save to project) leaves and as it lands: a
 *  read that overlapped a write answers what the server held before it, so
 *  its answer is dropped and the write's own re-read follows. */
let writeGen = 0

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** The project's `audio.json` as a config: null = the project has none (or
 *  it isn't a JSON object); undefined = it could not be read. */
async function projectAudio(projectId: string): Promise<Record<string, unknown> | null | undefined> {
  try {
    const { files } = await projectsApi.get(projectId)
    return parseAudioFile(files.find((f) => f.path === 'audio.json')?.content)
  } catch {
    return undefined
  }
}

export const useHouseAudio = create<HouseAudioState>((set, get) => ({
  eventId: null,
  projectId: null,
  status: null,
  reachable: true,
  busy: null,
  stopNote: null,
  saveError: null,
  savedAt: null,

  bind: (eventId, projectId = null) => {
    if (get().projectId !== projectId) set({ projectId })
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
    if (eventId === null) return
    if (reading !== null && reading.eventId === eventId) {
      // A poll is out: it may have left before a write, so read once more after it.
      readAgain = true
      await reading.done
      return
    }
    const done = (async () => {
      do {
        readAgain = false
        const gen = writeGen
        try {
          const status = await audioApi.status(eventId)
          if (get().eventId === eventId && gen === writeGen) set({ status, reachable: true })
        } catch {
          if (get().eventId === eventId && gen === writeGen) set({ reachable: false })
        }
      } while (readAgain && get().eventId === eventId)
    })()
    const mine = { eventId, done }
    reading = mine
    try {
      await done
    } finally {
      if (reading === mine) reading = null
    }
  },

  stop: async (announce) => {
    const eventId = get().eventId
    if (eventId === null || get().busy === 'stop') return
    set({ busy: 'stop' })
    let note: HouseAudioState['stopNote']
    try {
      const r = await audioApi.stop(eventId, announce)
      note = { text: stopResultText(r, announce), outcome: stopOutcomeOf(r), at: Date.now() }
    } catch (e) {
      note = { text: stopFailedText(message(e)), outcome: StopOutcome.Failed, at: Date.now() }
    }
    if (get().eventId !== eventId) return
    set({ busy: null, stopNote: note })
    if (noteTimer !== null) clearTimeout(noteTimer)
    noteTimer = setTimeout(
      () => {
        if (get().stopNote === note) set({ stopNote: null })
      },
      note.outcome === StopOutcome.Stopped ? STOP_NOTE_MS : STOP_WARN_MS,
    )
  },

  setTerminal: async (spot, on) => {
    const { eventId, status } = get()
    if (eventId === null || status === null || get().busy !== null) return
    if (announceTerminalsOf(status.audio).includes(spot) === on) return
    const next = withAnnounceTerminal(status.audio, spot, on)
    // The box flips at once; a refused save puts it back.
    set({ busy: 'save', saveError: null, status: { ...status, audio: next } })
    writeGen++
    try {
      // The narrow route lays the list over the config in force (never a
      // whole director's save, which would pin the speakers too); an older
      // server without it takes the whole save, as before.
      let version: string
      let source = status.source
      try {
        version = (await audioApi.announce(eventId, spot, on, status.version)).version
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404 && e.message === 'unknown mod action')) throw e
        version = (await audioApi.save(eventId, next, status.version)).version
        source = 'director'
      }
      // Hold the save's version at once (a poll may already be in flight), so
      // the next tick is based on it, not the one before it.
      if (get().eventId === eventId) set({ savedAt: Date.now(), status: { ...status, audio: next, version: version || status.version, source, ...(source !== 'director' ? { announceSaved: true } : {}) } })
    } catch (e) {
      if (get().eventId !== eventId) return
      set({
        status,
        saveError:
          e instanceof ApiError && e.status === 409
            ? 'The speakers changed since this card read them (a save from the map page?): reloaded. Tick it again.'
            : `Couldn’t save the house list: ${message(e)}`,
      })
    } finally {
      writeGen++
      if (get().eventId === eventId) set({ busy: null })
    }
    await get().refresh()
  },

  saveToProject: async () => {
    const { eventId, projectId, status } = get()
    if (eventId === null || status === null || get().busy !== null) return
    // A director save holds the whole config. When the project's audio.json
    // has other speakers than it (a sync since, or a map-page save here),
    // writing it whole would undo that file: keep the project's speakers and
    // add only the house list, after asking.
    let merged: Record<string, unknown> | null = null
    if (status.source === 'director') {
      const project = projectId !== null ? await projectAudio(projectId) : undefined
      if (project === undefined) {
        const ok = await confirmAction({
          title: 'Save the whole speaker config to the project?',
          body: 'The project’s audio.json could not be read to compare. Save to project writes this event’s whole save (the device, the speakers, the routes and the house list) over it: if audio.json was synced since this save, that sync is lost.',
          confirmLabel: 'Save to project',
          danger: true,
        })
        if (!ok) return
      } else if (project !== null && !sameBesideHouseList(project, status.audio)) {
        const ok = await confirmAction({
          title: 'Keep the project’s speakers?',
          body: 'The project’s audio.json differs from this event’s save in more than the house list: it changed since this save (a sync of audio.json?), or the map page saved speakers on this event. Save the house list only: the project’s speakers stay, only the tablets’ list is added, and this event plays the project’s speakers from now on. To write the map page’s speakers instead, use Save to project on the map page’s Audio panel.',
          confirmLabel: 'Save the house list only',
        })
        if (!ok) return
        merged = withAnnounceTerminals(project, announceTerminalsOf(status.audio))
      }
    }
    if (get().eventId !== eventId || get().busy !== null) return
    set({ busy: 'project', saveError: null })
    writeGen++
    try {
      if (merged !== null) await audioApi.save(eventId, merged, status.version)
      await audioApi.saveToProject(eventId)
      if (get().eventId === eventId) set({ savedAt: null })
    } catch (e) {
      if (get().eventId === eventId)
        set({
          saveError:
            e instanceof ApiError && e.status === 409
              ? 'The speakers changed since this card read them: reloaded. Press Save to project again.'
              : `Couldn’t save to the project: ${message(e)}`,
        })
    } finally {
      writeGen++
      if (get().eventId === eventId) set({ busy: null })
    }
    await get().refresh()
  },
}))
