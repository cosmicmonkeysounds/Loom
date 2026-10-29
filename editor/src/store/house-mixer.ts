//! Run → House → 🎚 Mixer (wave 40, `docs/loom-w40-contract.md` C4): the
//! house mix as the editor holds it. Bound from `App.tsx` beside the house
//! desk (the event), but it reads only while the Mixer view is shown
//! (`watch(true)` from the panel) and the tab is visible: `GET
//! /api/mod/audio/mixer` every `MIXER_POLL_MS` (each read also keeps the
//! router's live meters coming). A 404 (an older server) or a 401 / 403
//! stops it; a dead server backs off on `lib/stream-retry.ts`.
//!
//! Faders are optimistic: a move is kept as a pending change per key
//! (`lib/house-mixer-view.ts` `PendingMix`) laid over the server's levels
//! until a mixer GET shows a `mix.seq` at least the post's answer. Posts
//! go at most every `MIX_POST_MS` per key, one in flight at a time, and the
//! last value always goes. The music commands are one-shot posts.

import { create } from 'zustand'
import { MIX_CHANGES_MAX, type AudioMix, type MixChange, type MixerView, type MixLevel, type MusicCommand } from '@loom/core/house-mixer'
import { ApiError, audioApi } from '@/lib/api'
import { confirmAction } from '@/store/dialog'
import { reconnectDelay } from '@/lib/stream-retry'
import { levelChange, releasePending, shownLevels, type PendingMix } from '@/lib/house-mixer-view'

/** How often the panel reads the mixer while shown. */
export const MIXER_POLL_MS = 1_000
/** At most one post per fader this often (≤ 10 a second). */
export const MIX_POST_MS = 100
/** How long a note stays. */
export const MIXER_NOTE_MS = 5_000

export interface MixerApiLike {
  get(eventId: string): Promise<MixerView>
  mix(eventId: string, changes: MixChange[], resetAll?: boolean): Promise<{ mix: AudioMix }>
  music(eventId: string, cmd: MusicCommand): Promise<{ seq: number; router: boolean }>
}

export interface MixerDeps {
  api: MixerApiLike
  sleep: (ms: number) => Promise<void>
  clock: () => number
  /** Is the page visible (`document.visibilityState`)? Hidden: no reads. */
  visible: () => boolean
  confirm: (title: string, body: string, label: string) => Promise<boolean>
}

export type MixerNoteTone = 'ok' | 'warn' | 'bad'

export interface HouseMixerState {
  eventId: string | null
  /** The Mixer view is shown (the panel is mounted). */
  watching: boolean
  /** The last read (null: not read yet). */
  view: MixerView | null
  reachable: boolean
  /** The server has no mixer (an older build: 404) or refused this session. */
  gone: 'missing' | 'denied' | null
  /** Moves the server hasn't shown back yet, by key. */
  pending: PendingMix
  /** The music command in flight (its button's label), or null. */
  busy: string | null
  note: { text: string; tone: MixerNoteTone; at: number } | null

  bind: (eventId: string | null) => void
  /** The panel is shown (true) or gone (false). */
  watch: (on: boolean) => void
  refresh: () => Promise<void>
  /** Move a fader (dB, clamped to the grid). */
  setLevel: (key: string, db: number) => void
  setMute: (key: string, mute: boolean) => void
  /** One fader back to 0 dB, unmuted. */
  resetKey: (key: string) => void
  /** A column's Reset: every key it holds a level under. */
  resetKeys: (keys: readonly string[]) => Promise<void>
  /** The toolbar's Reset all (asks first). */
  resetAll: () => Promise<void>
  music: (cmd: MusicCommand, label?: string) => Promise<void>
  tell: (text: string, tone?: MixerNoteTone) => void
}

/** The levels the panel draws: the server's with the pending moves on top. */
export function mixerLevels(s: Pick<HouseMixerState, 'view' | 'pending'>): Record<string, MixLevel> {
  return shownLevels(s.view?.mix.levels ?? {}, s.pending)
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** What a music command did, for the note. */
function musicText(cmd: MusicCommand): string {
  switch (cmd.action) {
    case 'next':
      return cmd.playlist !== undefined ? `⏭ Skipped ${cmd.playlist}` : '⏭ Skipped every bed'
    case 'scene':
      return `🎵 Playing ${cmd.scene} by hand`
    case 'stop':
      return '■ Music stopped'
    case 'story':
      return '🎵 Following the story again'
  }
}

interface KeyQueue {
  lastSent: number
  timer: ReturnType<typeof setTimeout> | null
  inflight: boolean
}

export function createHouseMixerStore(deps: MixerDeps) {
  const { api, sleep, clock } = deps
  /** Bumped on every bind and watch change: an older loop stops. */
  let gen = 0
  let version = 0
  let queues = new Map<string, KeyQueue>()
  let noteTimer: ReturnType<typeof setTimeout> | null = null

  return create<HouseMixerState>((set, get) => {
    const tell = (text: string, tone: MixerNoteTone = 'ok') => {
      const note = { text, tone, at: clock() }
      set({ note })
      if (noteTimer !== null) clearTimeout(noteTimer)
      noteTimer = setTimeout(() => {
        if (get().note === note) set({ note: null })
      }, MIXER_NOTE_MS)
    }

    const failed = (e: unknown, what: string) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) tell(`The server refused ${what}: hosts and directors only.`, 'bad')
      else if (e instanceof ApiError && e.status === 404) tell(`This event server has no mixer yet: update and restart it.`, 'bad')
      else tell(`Couldn’t ${what}: ${message(e)}`, 'bad')
    }

    const apply = (view: MixerView) => set({ view, reachable: true, gone: null, pending: releasePending(get().pending, view.mix.seq) })

    /** One read; false when the loop should stop (404 / 401 / 403). */
    const read = async (eventId: string, mine: number): Promise<'ok' | 'down' | 'stop'> => {
      try {
        const view = await api.get(eventId)
        if (gen === mine) apply(view)
        return 'ok'
      } catch (e) {
        if (gen !== mine) return 'stop'
        const status = e instanceof ApiError ? e.status : null
        if (status === 404 || status === 401 || status === 403) {
          set({ gone: status === 404 ? 'missing' : 'denied', reachable: true })
          return 'stop'
        }
        set({ reachable: false })
        return 'down'
      }
    }

    const loop = async (mine: number, eventId: string) => {
      let attempt = 0
      while (gen === mine) {
        if (deps.visible()) {
          const r = await read(eventId, mine)
          if (r === 'stop' || gen !== mine) return
          attempt = r === 'down' ? attempt + 1 : 0
        }
        await sleep(attempt > 0 ? Math.max(MIXER_POLL_MS, reconnectDelay(attempt - 1)) : MIXER_POLL_MS)
      }
    }

    const restart = () => {
      gen++
      const { eventId, watching } = get()
      if (eventId !== null && watching) void loop(gen, eventId)
    }

    const queueOf = (key: string): KeyQueue => {
      let q = queues.get(key)
      if (q === undefined) {
        q = { lastSent: -Infinity, timer: null, inflight: false }
        queues.set(key, q)
      }
      return q
    }

    /** An answer's seq for the pending moves it carried (when still theirs). */
    const answered = (sent: Array<{ key: string; version: number }>, seq: number) => {
      const pending = { ...get().pending }
      for (const { key, version: v } of sent) {
        const p = pending[key]
        if (p !== undefined && p.version === v) pending[key] = { ...p, until: seq }
      }
      const shown = get().view?.mix.seq ?? -1
      set({ pending: releasePending(pending, shown) })
    }

    /** A refused post: its moves go back to the server's levels. */
    const dropped = (sent: Array<{ key: string; version: number }>) => {
      const pending = { ...get().pending }
      for (const { key, version: v } of sent) if (pending[key]?.version === v) delete pending[key]
      set({ pending })
    }

    /** Send `key`'s pending move now, or when its throttle allows. */
    const flush = (key: string) => {
      const eventId = get().eventId
      const q = queueOf(key)
      if (eventId === null || q.inflight || q.timer !== null) return
      const p = get().pending[key]
      if (p === undefined || p.until !== null) return
      const wait = q.lastSent + MIX_POST_MS - clock()
      if (wait > 0) {
        q.timer = setTimeout(() => {
          q.timer = null
          flush(key)
        }, wait)
        return
      }
      q.inflight = true
      q.lastSent = clock()
      const mine = queues
      const sent = [{ key, version: p.version }]
      api.mix(eventId, [p.change]).then(
        (r) => {
          if (mine !== queues) return
          q.inflight = false
          answered(sent, r.mix.seq)
          flush(key)
        },
        (e: unknown) => {
          if (mine !== queues) return
          q.inflight = false
          dropped(sent)
          failed(e, 'move the mix')
          flush(key)
        },
      )
    }

    /** Hold a move for `key` and send it (throttled). */
    const want = (change: MixChange) => {
      const v = ++version
      set({ pending: { ...get().pending, [change.key]: { change, version: v, until: null } } })
      flush(change.key)
    }

    /** One post for several keys at once (a Reset), bypassing the throttle. */
    const batch = async (changes: MixChange[], resetAll: boolean) => {
      const eventId = get().eventId
      if (eventId === null) return
      const pending = { ...get().pending }
      const sent: Array<{ key: string; version: number }> = []
      for (const c of changes) {
        const q = queueOf(c.key)
        if (q.timer !== null) {
          clearTimeout(q.timer)
          q.timer = null
        }
        const v = ++version
        pending[c.key] = { change: c, version: v, until: null }
        sent.push({ key: c.key, version: v })
      }
      set({ pending })
      const mine = queues
      try {
        // Reset all goes with no changes: the server clears every level.
        const r = await api.mix(eventId, resetAll ? [] : changes, resetAll)
        if (mine === queues) answered(sent, r.mix.seq)
      } catch (e) {
        if (mine !== queues) return
        dropped(sent)
        failed(e, resetAll ? 'reset the mix' : 'reset those faders')
      }
    }

    return {
      eventId: null,
      watching: false,
      view: null,
      reachable: true,
      gone: null,
      pending: {},
      busy: null,
      note: null,

      bind: (eventId) => {
        if (get().eventId === eventId) return
        for (const q of queues.values()) if (q.timer !== null) clearTimeout(q.timer)
        queues = new Map()
        set({ eventId, view: null, reachable: true, gone: null, pending: {}, busy: null, note: null })
        restart()
      },

      watch: (on) => {
        if (get().watching === on) return
        set({ watching: on, ...(on ? { gone: null } : {}) })
        restart()
      },

      refresh: async () => {
        const eventId = get().eventId
        if (eventId !== null) await read(eventId, gen)
      },

      setLevel: (key, db) => want(levelChange(mixerLevels(get()), key, { db })),
      setMute: (key, mute) => want(levelChange(mixerLevels(get()), key, { mute })),
      resetKey: (key) => want({ key, reset: true }),

      resetKeys: async (keys) => {
        const unique = [...new Set(keys)]
        for (let i = 0; i < unique.length; i += MIX_CHANGES_MAX) await batch(unique.slice(i, i + MIX_CHANGES_MAX).map((key) => ({ key, reset: true })), false)
      },

      resetAll: async () => {
        if (get().eventId === null) return
        const ok = await deps.confirm('Reset the whole mix?', 'Every fader and mute, everywhere and in every room, goes back to 0 dB. The house hears it at once.', 'Reset all')
        if (!ok) return
        const keys = new Set([...Object.keys(get().view?.mix.levels ?? {}), ...Object.keys(get().pending)])
        await batch(
          [...keys].map((key) => ({ key, reset: true })),
          true,
        )
      },

      music: async (cmd, label) => {
        const eventId = get().eventId
        if (eventId === null || get().busy !== null) return
        set({ busy: label ?? cmd.action })
        try {
          const r = await api.music(eventId, cmd)
          if (r.router) tell(`${musicText(cmd)}.`)
          else tell(`${musicText(cmd)}: no router listening, it goes when one connects (within a minute).`, 'warn')
          void get().refresh()
        } catch (e) {
          failed(e, 'tell the soundtrack')
        } finally {
          set({ busy: null })
        }
      },

      tell,
    }
  })
}

const realApi: MixerApiLike = {
  get: (id) => audioApi.getMixer(id),
  mix: (id, changes, resetAll) => audioApi.postMix(id, changes, resetAll),
  music: (id, cmd) => audioApi.postMusic(id, cmd),
}

export const useHouseMixer = createHouseMixerStore({
  api: realApi,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  clock: () => Date.now(),
  visible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
  confirm: (title, body, confirmLabel) => confirmAction({ title, body, confirmLabel, danger: true }),
})
