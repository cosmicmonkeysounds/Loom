//! Run → House (wave 25, `docs/loom-house-desk.md` §6.1): the house desk as
//! the editor holds it. Bound from `App.tsx` beside the house sound, for as
//! long as a server project has a run. It long-polls `GET /api/mod/desk` on
//! `rev` (a dead server backs off on `lib/stream-retry.ts`'s 1 s → 15 s), and
//! holds the draft desk being edited, the selection, the checks' cursor, and
//! every press: GO with the playhead the screen showed, standby, stop, the
//! panic, the checks' tests and marks, Zigbee pairing.
//!
//! The pure edits are `lib/house-desk-edit.ts`; the page's view model is
//! `lib/house-desk-view.ts`. A local run has no desk: nothing is bound.

import { create } from 'zustand'
import { ApiError, deskApi, lightsApi, type DeskSaveAnswer } from '@/lib/api'
import { confirmAction } from '@/store/dialog'
import { probeVerdict, reconnectDelay } from '@/lib/stream-retry'
import { sameDesk } from '@/lib/house-desk-edit'
import { movePlayhead, runningRuns } from '@/lib/house-desk-view'
import { testNeedsConfirm, type DeskCheckRow, type DeskConfig, type DeskTestCall, type DeskView } from '@loom/core/house-desk'

/** How long the server may park a long poll (s). */
export const DESK_POLL_WAIT_S = 25
/** An answer that came back this fast with no new `rev` (a server that
 *  ignores `after`) waits this long before the next ask. */
export const DESK_POLL_FLOOR_MS = 1_000
/** How long a note stays under the transport. */
export const DESK_NOTE_MS = 5_000
/** Zigbee pairing opens for this long (s). */
export const DESK_PAIR_S = 120

/** The calls the store makes (the real ones are `deskApi` + `lightsApi.pair`). */
export interface DeskApiLike {
  get(eventId: string, after?: number, wait?: number): Promise<DeskView>
  save(eventId: string, desk: DeskConfig, base?: string): Promise<DeskSaveAnswer>
  project(eventId: string): Promise<void>
  go(eventId: string, opts: { cue?: string; standby?: string | null }): Promise<{ run: number | null; standby: string | null }>
  standby(eventId: string, cue: string | null): Promise<{ standby: string | null }>
  stop(eventId: string, what: { run: number } | { all: true; announce?: boolean }): Promise<{ stopped: number }>
  check(eventId: string, key: string, mark: 'ok' | 'bad' | null, note?: string): Promise<void>
  checkReset(eventId: string): Promise<void>
  test(eventId: string, call: DeskTestCall): Promise<void>
  pair(eventId: string, seconds: number): Promise<{ until: number | null }>
}

export interface DeskDeps {
  api: DeskApiLike
  sleep: (ms: number) => Promise<void>
  clock: () => number
}

export type DeskNoteTone = 'ok' | 'warn' | 'bad'

export interface HouseDeskState {
  eventId: string | null
  /** The last view (null: not read yet). */
  view: DeskView | null
  /** The last ask reached the server. */
  reachable: boolean
  /** The server has no desk (an older build: 404) or refused this session. */
  gone: 'missing' | 'denied' | null
  /** Server ms minus local ms at the last view (a run's progress uses it). */
  skew: number
  /** The desk being edited (null: no edits; the page shows the view's). */
  draft: DeskConfig | null
  /** The version and desk the draft was taken from (Save sends `base`). */
  base: string | null
  baseDesk: DeskConfig | null
  /** Someone saved the desk on the server since the draft was taken. */
  stale: boolean
  /** The selected cue (index into the shown desk) and step. */
  sel: number | null
  step: number | null
  /** The checks' cursor (a check key). */
  check: string | null
  busy: 'save' | 'project' | 'go' | 'stop' | 'reset' | 'pair' | null
  /** The check key whose test is in flight. */
  testing: string | null
  /** The last save's refusal and warnings. */
  saveProblems: string[]
  saveWarnings: string[]
  note: { text: string; tone: DeskNoteTone; at: number } | null

  bind: (eventId: string | null) => void
  /** One read now (no long poll). */
  refresh: () => Promise<void>
  /** Replace the draft (an edit op's result); selecting `sel` / `step` too when given. */
  edit: (next: DeskConfig, sel?: number | null, step?: number | null) => void
  discard: () => void
  save: () => Promise<void>
  saveToProject: () => Promise<void>
  select: (sel: number | null) => void
  selectStep: (step: number | null) => void
  /** GO: `cue`, or the playhead's cue (sent with the playhead shown). */
  go: (cue?: string) => Promise<void>
  standby: (cue: string | null) => Promise<void>
  moveStandby: (delta: -1 | 1) => Promise<void>
  /** Stop one run. */
  stopRun: (run: number) => Promise<void>
  /** Stop every running desk cue (the house sounds the story started play on). */
  stopRunning: () => Promise<void>
  /** ■ STOP ALL: every run and the house sounds. */
  stopAll: (announce?: boolean) => Promise<void>
  /** Run a check's test (or one of its colour buttons); live, ask first. */
  test: (row: Pick<DeskCheckRow, 'key' | 'label'>, call: DeskTestCall) => Promise<void>
  mark: (key: string, mark: 'ok' | 'bad' | null) => Promise<void>
  resetMarks: () => Promise<void>
  pair: (open: boolean) => Promise<void>
  setCheck: (key: string | null) => void
  say: (text: string, tone?: DeskNoteTone) => void
}

/** The desk the page shows: the draft, else the server's. */
export function shownDesk(s: Pick<HouseDeskState, 'draft' | 'view'>): DeskConfig | null {
  return s.draft ?? s.view?.desk ?? null
}

/** The draft differs from the desk it was taken from. */
export function isDirty(s: Pick<HouseDeskState, 'draft'>): boolean {
  return s.draft !== null
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const errorOf = (e: unknown): string | null => (e instanceof ApiError && typeof e.data['error'] === 'string' ? e.data['error'] : null)

export function createHouseDeskStore(deps: DeskDeps) {
  const { api, sleep, clock } = deps
  /** Bumped on every bind: a loop from an older bind stops. */
  let gen = 0
  let noteTimer: ReturnType<typeof setTimeout> | null = null

  return create<HouseDeskState>((set, get) => {
    const apply = (view: DeskView) => {
      const s = get()
      const stale = s.draft !== null && s.base !== null && view.version !== s.base
      const n = (s.draft ?? view.desk).cues.length
      set({
        view,
        reachable: true,
        gone: null,
        skew: view.now - clock(),
        stale,
        sel: s.sel !== null && s.sel >= n ? (n > 0 ? n - 1 : null) : s.sel,
      })
    }

    const loop = async (mine: number, eventId: string) => {
      let attempt = 0
      while (gen === mine) {
        const after = get().view?.rev
        const asked = clock()
        try {
          const view = after === undefined ? await api.get(eventId) : await api.get(eventId, after, DESK_POLL_WAIT_S)
          if (gen !== mine) return
          apply(view)
          attempt = 0
          if (after !== undefined && view.rev === after && clock() - asked < DESK_POLL_FLOOR_MS) await sleep(DESK_POLL_FLOOR_MS)
        } catch (e) {
          if (gen !== mine) return
          const status = e instanceof ApiError ? e.status : null
          if (probeVerdict(status) === 'stop') {
            set({ gone: status === 404 ? 'missing' : 'denied', reachable: true })
            return
          }
          set({ reachable: false })
          await sleep(reconnectDelay(attempt++))
        }
      }
    }

    const say = (text: string, tone: DeskNoteTone = 'ok') => {
      const note = { text, tone, at: clock() }
      set({ note })
      if (noteTimer !== null) clearTimeout(noteTimer)
      noteTimer = setTimeout(() => {
        if (get().note === note) set({ note: null })
      }, DESK_NOTE_MS)
    }

    /** The bound event, or null when nothing is bound. */
    const ev = () => get().eventId

    const stopWith = async (what: { run: number } | { all: true; announce?: boolean }): Promise<number | null> => {
      const eventId = ev()
      if (eventId === null) return null
      try {
        return (await api.stop(eventId, what)).stopped
      } catch (e) {
        say(`Couldn’t stop: ${message(e)}`, 'bad')
        return null
      }
    }

    return {
      eventId: null,
      view: null,
      reachable: true,
      gone: null,
      skew: 0,
      draft: null,
      base: null,
      baseDesk: null,
      stale: false,
      sel: null,
      step: null,
      check: null,
      busy: null,
      testing: null,
      saveProblems: [],
      saveWarnings: [],
      note: null,

      bind: (eventId) => {
        if (get().eventId === eventId) return
        gen++
        set({ eventId, view: null, reachable: true, gone: null, draft: null, base: null, baseDesk: null, stale: false, sel: null, step: null, check: null, busy: null, testing: null, saveProblems: [], saveWarnings: [], note: null })
        if (eventId !== null) void loop(gen, eventId)
      },

      refresh: async () => {
        const eventId = ev()
        if (eventId === null) return
        try {
          const view = await api.get(eventId)
          if (ev() === eventId) apply(view)
        } catch {
          if (ev() === eventId) set({ reachable: false })
        }
      },

      edit: (next, sel, step) => {
        const s = get()
        const from = s.draft !== null ? { base: s.base, baseDesk: s.baseDesk } : { base: s.view?.version ?? null, baseDesk: s.view?.desk ?? null }
        const clean = from.baseDesk !== null && sameDesk(next, from.baseDesk)
        set({
          draft: clean ? null : next,
          base: clean ? null : from.base,
          baseDesk: clean ? null : from.baseDesk,
          stale: clean ? false : s.stale,
          ...(sel !== undefined ? { sel } : {}),
          ...(step !== undefined ? { step } : {}),
        })
      },

      discard: () => set({ draft: null, base: null, baseDesk: null, stale: false, saveProblems: [], saveWarnings: [] }),

      save: async () => {
        const { eventId, draft, base } = get()
        if (eventId === null || draft === null || get().busy !== null) return
        set({ busy: 'save', saveProblems: [], saveWarnings: [] })
        try {
          const r = await api.save(eventId, draft, base ?? undefined)
          if (ev() !== eventId) return
          const view = get().view
          // Show the saved desk at once; the long poll brings the server's view.
          set({
            draft: get().draft === draft ? null : get().draft,
            base: get().draft === draft ? null : r.version,
            baseDesk: get().draft === draft ? null : draft,
            stale: false,
            saveWarnings: r.warnings,
            ...(view !== null ? { view: { ...view, desk: draft, version: r.version || view.version, source: r.source } } : {}),
          })
          say(r.warnings.length > 0 ? `Saved, with ${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}` : 'Saved for this event')
        } catch (e) {
          if (ev() !== eventId) return
          if (e instanceof ApiError && e.status === 400 && Array.isArray(e.data['problems'])) {
            set({ saveProblems: (e.data['problems'] as unknown[]).filter((p): p is string => typeof p === 'string') })
            say('Not saved: the desk has problems', 'bad')
          } else if (e instanceof ApiError && e.status === 409 && errorOf(e) === 'stale') {
            set({ busy: null })
            await get().refresh()
            const reload = await confirmAction({
              title: 'The desk changed on the server',
              body: 'Someone saved the house desk since you started editing (another console, or a reload). Load theirs and drop your edits? Cancel keeps your edits: the next Save replaces theirs.',
              confirmLabel: 'Load theirs',
              danger: true,
            })
            if (ev() !== eventId) return
            if (reload) get().discard()
            else {
              const v = get().view
              set({ base: v?.version ?? null, baseDesk: v?.desk ?? null, stale: false })
              say('Your edits are kept: Save again to replace theirs', 'warn')
            }
          } else say(`Couldn’t save: ${message(e)}`, 'bad')
        } finally {
          if (ev() === eventId && get().busy === 'save') set({ busy: null })
        }
      },

      saveToProject: async () => {
        const eventId = ev()
        if (eventId === null || get().busy !== null) return
        if (get().draft !== null) {
          say('Save your edits first: Save to project writes the desk in force', 'warn')
          return
        }
        set({ busy: 'project' })
        try {
          await api.project(eventId)
          say('Saved to the project as desk.json')
        } catch (e) {
          say(errorOf(e) === 'no project' ? 'This event has no project to save into' : `Couldn’t save to the project: ${message(e)}`, 'bad')
        } finally {
          if (ev() === eventId) set({ busy: null })
        }
        await get().refresh()
      },

      select: (sel) => set({ sel, step: null }),
      selectStep: (step) => set({ step }),

      go: async (cue) => {
        const { eventId, view } = get()
        if (eventId === null || view === null || get().busy === 'go') return
        if (cue === undefined && view.standby === null) {
          say('The playhead is past the last cue: pick a cue (↑) first', 'warn')
          return
        }
        set({ busy: 'go' })
        try {
          const r = await api.go(eventId, cue !== undefined ? { cue } : { standby: view.standby })
          const v = get().view
          if (ev() === eventId && v !== null) set({ view: { ...v, standby: r.standby } })
        } catch (e) {
          const err = errorOf(e)
          if (e instanceof ApiError && e.status === 409 && err === 'moved') {
            const v = get().view
            const standby = typeof e.data['standby'] === 'string' || e.data['standby'] === null ? (e.data['standby'] as string | null) : (v?.standby ?? null)
            if (v !== null) set({ view: { ...v, standby } })
            say('Standby moved — press GO again', 'warn')
          } else if (e instanceof ApiError && e.status === 409 && err === 'end') say('The end of the list: nothing to GO', 'warn')
          else if (e instanceof ApiError && e.status === 404) say('No such cue in the saved desk (save your edits first?)', 'bad')
          else say(`GO failed: ${message(e)}`, 'bad')
        } finally {
          if (ev() === eventId) set({ busy: null })
        }
      },

      standby: async (cue) => {
        const eventId = ev()
        const v = get().view
        if (eventId === null || v === null) return
        set({ view: { ...v, standby: cue } })
        try {
          const r = await api.standby(eventId, cue)
          const now = get().view
          if (ev() === eventId && now !== null) set({ view: { ...now, standby: r.standby } })
        } catch (e) {
          say(`Couldn’t move the playhead: ${message(e)}`, 'bad')
          await get().refresh()
        }
      },

      moveStandby: async (delta) => {
        const v = get().view
        if (v === null) return
        await get().standby(movePlayhead(v.desk, v.standby, delta))
      },

      stopRun: async (run) => {
        await stopWith({ run })
      },

      stopRunning: async () => {
        const v = get().view
        if (v === null) return
        const runs = runningRuns(v.runs)
        if (runs.length === 0) return
        for (const r of runs) await stopWith({ run: r.run })
        say(`Stopped ${runs.length} cue${runs.length === 1 ? '' : 's'}`)
      },

      stopAll: async (announce) => {
        if (ev() === null || get().busy === 'stop') return
        set({ busy: 'stop' })
        const stopped = await stopWith(announce === true ? { all: true, announce: true } : { all: true })
        if (get().busy === 'stop') set({ busy: null })
        if (stopped !== null) say(`■ Stopped everything${stopped > 0 ? ` (${stopped} cue${stopped === 1 ? '' : 's'})` : ''} and the house sounds`)
      },

      test: async (row, call) => {
        const { eventId, view } = get()
        if (eventId === null || view === null) return
        if (testNeedsConfirm(view)) {
          const ok = await confirmAction({
            title: 'The show is live',
            body: `Guests will hear or see this test (${row.label}). Test anyway?`,
            confirmLabel: 'Test',
            danger: true,
          })
          if (!ok || ev() !== eventId) return
        }
        set({ testing: row.key, check: row.key })
        try {
          await api.test(eventId, call)
        } catch (e) {
          say(`Test failed: ${message(e)}`, 'bad')
        } finally {
          if (get().testing === row.key) set({ testing: null })
        }
      },

      mark: async (key, mark) => {
        const eventId = ev()
        const v = get().view
        if (eventId === null || v === null) return
        const before = v.marks
        const marks = { ...before }
        if (mark === null) delete marks[key]
        else marks[key] = { mark, by: 'you', at: v.now }
        set({ view: { ...v, marks }, check: key })
        try {
          await api.check(eventId, key, mark)
        } catch (e) {
          const now = get().view
          if (ev() === eventId && now !== null) set({ view: { ...now, marks: before } })
          say(`Couldn’t mark it: ${message(e)}`, 'bad')
        }
      },

      resetMarks: async () => {
        const eventId = ev()
        if (eventId === null || get().busy !== null) return
        const ok = await confirmAction({ title: 'Clear every check mark?', body: 'Every ✓ and ✗ on this event’s checks goes, for every console.', confirmLabel: 'Clear marks', danger: true })
        if (!ok || ev() !== eventId) return
        set({ busy: 'reset' })
        try {
          await api.checkReset(eventId)
          const v = get().view
          if (v !== null) set({ view: { ...v, marks: {} }, check: null })
        } catch (e) {
          say(`Couldn’t clear the marks: ${message(e)}`, 'bad')
        } finally {
          if (ev() === eventId) set({ busy: null })
        }
      },

      pair: async (open) => {
        const eventId = ev()
        if (eventId === null || get().busy !== null) return
        set({ busy: 'pair' })
        try {
          const r = await api.pair(eventId, open ? DESK_PAIR_S : 0)
          const v = get().view
          if (v !== null) set({ view: { ...v, house: { ...v.house, pairUntil: open ? r.until : null } } })
          say(open ? `Zigbee pairing open for ${DESK_PAIR_S / 60} min: put the bulb in pairing mode` : 'Zigbee pairing closed')
        } catch (e) {
          say(`Couldn’t ${open ? 'open' : 'close'} pairing: ${message(e)}`, 'bad')
        } finally {
          if (ev() === eventId) set({ busy: null })
        }
      },

      setCheck: (check) => set({ check }),
      say,
    }
  })
}

const realApi: DeskApiLike = { ...deskApi, pair: (eventId, seconds) => lightsApi.pair(eventId, seconds) }

export const useHouseDesk = createHouseDeskStore({
  api: realApi,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  clock: () => Date.now(),
})
