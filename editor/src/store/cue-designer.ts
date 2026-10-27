//! Run → House → Cue designer (wave 30): the lights the designer edits, as
//! the editor holds them. Bound from `App.tsx` beside the house desk, for as
//! long as a server project has a run. It reads `GET /api/mod/lights` (the
//! whole `lights.json` in force, the story's cue names, the problems) and
//! the house map the event plays (`/api/spatial/house`, so a look aimed at a
//! room or a LOCATION previews on the right lamps), re-reads both every
//! `DESIGNER_POLL_MS` while nothing is being edited, and holds the draft:
//! look edits are `@loom/house` look ops on a `LightsConfig`, saved with
//! `base` (409 `stale` → ask, as the desk does).
//!
//! The house's sounds, speakers and desk cues come from the house desk's
//! view (`store/house-desk.ts`); this store only plays them (an audition is
//! `POST /api/mod/audio/play`). Once the doors are open every test and play
//! asks first, like the checks. Pure ops: `lib/cue-designer.ts`.

import { create } from 'zustand'
import { validateLights, type HouseMap, type LightState, type LightsConfig } from '@loom/house'
import { ApiError, audioApi, lightsApi, mapApi } from '@/lib/api'
import { confirmAction } from '@/store/dialog'
import { useHouseDesk } from '@/store/house-desk'
import type { DesignerLights } from '@/lib/cue-designer'

/** How often the designer re-reads the lights and the map while not editing. */
export const DESIGNER_POLL_MS = 15_000
/** How long a note stays. */
export const DESIGNER_NOTE_MS = 5_000

/** What the designer's right side shows. */
export type DesignerSel = { kind: 'look'; name: string } | { kind: 'sound'; name: string } | { kind: 'cue'; id: string }

export interface DesignerApiLike {
  config(eventId: string): Promise<DesignerLights | null>
  house(eventId: string): Promise<unknown>
  save(eventId: string, lights: LightsConfig, base?: string): Promise<{ version: string; warnings: string[] }>
  project(eventId: string): Promise<void>
  test(eventId: string, test: { fixture: string; set?: Record<string, unknown> } | { look: string }): Promise<{ seq: number }>
  play(eventId: string, play: { sound: string; to?: string[]; gain?: number } | { say: string; to?: string[]; chime?: boolean }): Promise<{ seq: number }>
}

export interface DesignerDeps {
  api: DesignerApiLike
  sleep: (ms: number) => Promise<void>
  clock: () => number
  /** Are the doors open (the desk's `live`)? Then a test asks first. */
  live: () => boolean
  /** Ask (the app's dialog). */
  confirm: (title: string, body: string, label: string) => Promise<boolean>
  /** After a save: the desk's view re-reads (its looks and lengths changed). */
  saved?: () => void
}

export type DesignerNoteTone = 'ok' | 'warn' | 'bad'

export interface CueDesignerState {
  eventId: string | null
  /** The last read (null: not read yet, or the server has no lights route). */
  read: DesignerLights | null
  house: HouseMap | null
  reachable: boolean
  /** The server answered 404: an older build with no lights route. */
  missing: boolean
  /** The lights being edited (null: no edits). */
  draft: LightsConfig | null
  base: string | null
  /** Someone saved the lights since the draft was taken. */
  stale: boolean
  sel: DesignerSel | null
  /** The selected step of the selected look. */
  step: number | null
  busy: 'save' | 'project' | 'test' | 'play' | null
  saveProblems: string[]
  saveWarnings: string[]
  note: { text: string; tone: DesignerNoteTone; at: number } | null

  bind: (eventId: string | null) => void
  refresh: () => Promise<void>
  /** Replace the draft (a look op's result), optionally selecting. */
  edit: (next: LightsConfig, sel?: DesignerSel | null, step?: number | null) => void
  discard: () => void
  /** Save the draft; true when it saved (or there was nothing to save). */
  save: () => Promise<boolean>
  saveToProject: () => Promise<void>
  select: (sel: DesignerSel | null) => void
  selectStep: (step: number | null) => void
  /** Play a look on the house (saving first when it has unsaved edits). */
  testLook: (name: string) => Promise<void>
  /** One state on one fixture (a step tried on its own). */
  testState: (fixture: string, set: LightState) => Promise<void>
  playSound: (sound: string, to?: string[], gain?: number) => Promise<void>
  say: (text: string, to?: string[]) => Promise<void>
  tell: (text: string, tone?: DesignerNoteTone) => void
}

/** The lights the page shows: the draft, else the last read. */
export function shownLights(s: Pick<CueDesignerState, 'draft' | 'read'>): LightsConfig | null {
  return s.draft ?? s.read?.lights ?? null
}

/** Has the look unsaved edits (the draft's differs from the last read)? */
export function lookDirty(s: Pick<CueDesignerState, 'draft' | 'read'>, name: string): boolean {
  if (s.draft === null) return false
  return JSON.stringify(s.draft.looks[name]) !== JSON.stringify(s.read?.lights.looks[name])
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The map off `/api/spatial/house`, or null (no map, or not one). */
export function houseOf(raw: unknown): HouseMap | null {
  const h = isRecord(raw) && isRecord(raw['house']) ? raw['house'] : raw
  return isRecord(h) && Array.isArray(h['rooms']) && Array.isArray(h['floors']) ? (h as unknown as HouseMap) : null
}

export function createCueDesignerStore(deps: DesignerDeps) {
  const { api, sleep, clock } = deps
  let gen = 0
  let noteTimer: ReturnType<typeof setTimeout> | null = null

  return create<CueDesignerState>((set, get) => {
    const tell = (text: string, tone: DesignerNoteTone = 'ok') => {
      const note = { text, tone, at: clock() }
      set({ note })
      if (noteTimer !== null) clearTimeout(noteTimer)
      noteTimer = setTimeout(() => {
        if (get().note === note) set({ note: null })
      }, DESIGNER_NOTE_MS)
    }

    const read = async (eventId: string): Promise<void> => {
      try {
        const [lights, house] = await Promise.all([api.config(eventId), api.house(eventId).catch(() => null)])
        if (get().eventId !== eventId) return
        const s = get()
        set({
          read: lights,
          missing: lights === null,
          house: houseOf(house) ?? s.house,
          reachable: true,
          stale: s.draft !== null && lights !== null && s.base !== null && lights.version !== s.base,
        })
      } catch {
        if (get().eventId === eventId) set({ reachable: false })
      }
    }

    const loop = async (mine: number, eventId: string) => {
      await read(eventId)
      while (gen === mine) {
        await sleep(DESIGNER_POLL_MS)
        if (gen !== mine) return
        if (get().draft === null && get().busy === null) await read(eventId)
      }
    }

    /** Once the doors are open, ask before guests see or hear a test. */
    const mayTest = async (what: string): Promise<boolean> => !deps.live() || (await deps.confirm('The show is live', `Guests will hear or see this (${what}). Go ahead?`, 'Play it'))

    return {
      eventId: null,
      read: null,
      house: null,
      reachable: true,
      missing: false,
      draft: null,
      base: null,
      stale: false,
      sel: null,
      step: null,
      busy: null,
      saveProblems: [],
      saveWarnings: [],
      note: null,

      bind: (eventId) => {
        if (get().eventId === eventId) return
        gen++
        set({ eventId, read: null, house: null, reachable: true, missing: false, draft: null, base: null, stale: false, sel: null, step: null, busy: null, saveProblems: [], saveWarnings: [], note: null })
        if (eventId !== null) void loop(gen, eventId)
      },

      refresh: async () => {
        const eventId = get().eventId
        if (eventId !== null) await read(eventId)
      },

      edit: (next, sel, step) => {
        const s = get()
        const saved = s.read?.lights ?? null
        const clean = saved !== null && JSON.stringify(next) === JSON.stringify(saved)
        set({
          draft: clean ? null : next,
          base: clean ? null : s.draft !== null ? s.base : (s.read?.version ?? null),
          stale: clean ? false : s.stale,
          ...(sel !== undefined ? { sel } : {}),
          ...(step !== undefined ? { step } : {}),
        })
      },

      discard: () => set({ draft: null, base: null, stale: false, saveProblems: [], saveWarnings: [] }),

      save: async () => {
        const { eventId, draft, base } = get()
        if (eventId === null) return false
        if (draft === null) return true
        if (get().busy !== null) return false
        const v = validateLights(draft, get().house)
        if (!v.ok) {
          set({ saveProblems: v.problems, saveWarnings: v.warnings })
          tell('Fix the problems first (in red).', 'bad')
          return false
        }
        set({ busy: 'save', saveProblems: [], saveWarnings: [] })
        try {
          const r = await api.save(eventId, draft, base ?? undefined)
          set({ draft: null, base: null, stale: false, saveWarnings: r.warnings })
          tell(r.warnings.length > 0 ? `Saved, with ${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}.` : 'Saved: the lights module plays the new looks now.', r.warnings.length > 0 ? 'warn' : 'ok')
          await read(eventId)
          deps.saved?.()
          return true
        } catch (e) {
          if (e instanceof ApiError && e.status === 409 && e.data['error'] === 'stale') {
            set({ stale: true })
            const theirs = await deps.confirm('Someone else saved the lights', 'Another director saved the lights while you were editing. Load theirs (your edits are dropped), or keep yours and save over theirs?', 'Load theirs')
            if (theirs) {
              set({ draft: null, base: null, stale: false })
              await read(eventId)
            } else {
              set({ base: get().read?.version ?? null, stale: false })
              tell('Kept yours: Save again to write them over.', 'warn')
            }
            return false
          }
          if (e instanceof ApiError && e.status === 400) {
            const problems = Array.isArray(e.data['problems']) ? e.data['problems'].filter((p): p is string => typeof p === 'string') : [message(e)]
            set({ saveProblems: problems })
            tell('The server refused the lights (in red).', 'bad')
            return false
          }
          tell(`Couldn’t save: ${message(e)}`, 'bad')
          return false
        } finally {
          set({ busy: null })
        }
      },

      saveToProject: async () => {
        const eventId = get().eventId
        if (eventId === null || get().busy !== null) return
        if (get().draft !== null && !(await get().save())) return
        set({ busy: 'project' })
        try {
          await api.project(eventId)
          tell('Saved into the project as lights.json.')
        } catch (e) {
          tell(e instanceof ApiError && e.status === 409 ? 'This event has no project to save into.' : `Couldn’t save to the project: ${message(e)}`, 'bad')
        } finally {
          set({ busy: null })
        }
      },

      select: (sel) => set({ sel, step: null }),
      selectStep: (step) => set({ step }),

      testLook: async (name) => {
        const eventId = get().eventId
        if (eventId === null || get().busy !== null) return
        if (lookDirty(get(), name)) {
          const ok = await deps.confirm('Save first?', `The house plays the saved “${name}”. Save your edits to the lights, then play it?`, 'Save and play')
          if (!ok || !(await get().save())) return
        }
        if (!(await mayTest(`the look ${name}`))) return
        set({ busy: 'test' })
        try {
          await api.test(eventId, { look: name })
          tell(`💡 Sent ${name} to the lights.`)
        } catch (e) {
          tell(`Couldn’t play ${name}: ${message(e)}`, 'bad')
        } finally {
          set({ busy: null })
        }
      },

      testState: async (fixture, state) => {
        const eventId = get().eventId
        if (eventId === null || get().busy !== null) return
        if (!(await mayTest(`a light on ${fixture}`))) return
        set({ busy: 'test' })
        try {
          await api.test(eventId, { fixture, set: state as Record<string, unknown> })
        } catch (e) {
          tell(`Couldn’t light ${fixture}: ${message(e)}`, 'bad')
        } finally {
          set({ busy: null })
        }
      },

      playSound: async (sound, to, gain) => {
        const eventId = get().eventId
        if (eventId === null || get().busy !== null) return
        if (!(await mayTest(`the sound ${sound}`))) return
        set({ busy: 'play' })
        try {
          await api.play(eventId, { sound, ...(to !== undefined && to.length > 0 ? { to } : {}), ...(gain !== undefined && gain !== 0 ? { gain } : {}) })
          tell(`🔊 Playing ${sound}.`)
        } catch (e) {
          tell(`Couldn’t play ${sound}: ${message(e)}`, 'bad')
        } finally {
          set({ busy: null })
        }
      },

      say: async (text, to) => {
        const eventId = get().eventId
        const t = text.trim()
        if (eventId === null || t === '' || get().busy !== null) return
        if (!(await mayTest('an announcement'))) return
        set({ busy: 'play' })
        try {
          await api.play(eventId, { say: t, ...(to !== undefined && to.length > 0 ? { to } : {}) })
          tell('📢 Sent to the speakers.')
        } catch (e) {
          tell(`Couldn’t say it: ${message(e)}`, 'bad')
        } finally {
          set({ busy: null })
        }
      },

      tell,
    }
  })
}

const realApi: DesignerApiLike = {
  config: (id) => lightsApi.config(id),
  house: (id) => mapApi.house(id),
  save: (id, lights, base) => lightsApi.save(id, lights, base),
  project: (id) => lightsApi.project(id),
  test: (id, t) => lightsApi.test(id, t),
  play: (id, p) => audioApi.play(id, p),
}

export const useCueDesigner = createCueDesignerStore({
  api: realApi,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  clock: () => Date.now(),
  live: () => useHouseDesk.getState().view?.live === true,
  confirm: (title, body, confirmLabel) => confirmAction({ title, body, confirmLabel }),
  saved: () => void useHouseDesk.getState().refresh(),
})
