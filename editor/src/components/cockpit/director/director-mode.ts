//! This console's Calling / Watching choice, shared by the Director page
//! and the Inspector tray (which needs it to know whether the page already
//! shows the house at a glance).
//!
//! Wave 18 (B8, Q1 — hosts call the show equally from Play): on an event
//! server that knows callers (`cues.caller` on the cue state), Calling **is**
//! the server's one caller claim. Picking Calling posts `POST
//! /api/mod/caller {on: true}`, Watching lets it go; another console's claim
//! (a host booth, the director phone, another director) turns this one to
//! Watching. The page shows who is calling. The flip reads back at once and
//! trusts itself for `FLIP_MS` until the cue state agrees.
//!
//! Elsewhere (the in-browser rehearsal, an older server) the choice stays
//! per console: kept per event in localStorage, mirrored in a small store so
//! both readers re-render on a switch.

import { useCallback } from 'react'
import { create } from 'zustand'
import { foldName } from '@loom/core/parser'
import { RunBackend, useCockpit } from '@/store/cockpit'
import { DirectorMode } from './director-keys'

/** Where this console's Calling / Watching choice is kept. */
export function modeKey(eventId: string | null): string {
  return `loom.director.mode.${eventId ?? 'local'}`
}

function readMode(key: string): DirectorMode {
  try {
    return localStorage.getItem(key) === DirectorMode.Watching ? DirectorMode.Watching : DirectorMode.Calling
  } catch {
    return DirectorMode.Calling
  }
}

/** `cues.caller` (CONTRACTS C8): who calls the show, by name. */
export interface ShowCaller {
  name: string
  at: number
}

/** The cue state's caller, feature-detected: `known` is false for an
 *  older server (no `caller` key), and then the choice stays local. */
export function showCallerOf(cues: unknown): { known: boolean; caller: ShowCaller | null } {
  if (cues === null || typeof cues !== 'object' || !('caller' in cues)) return { known: false, caller: null }
  const c = (cues as { caller?: unknown }).caller
  if (c === null || typeof c !== 'object') return { known: true, caller: null }
  const name = (c as { name?: unknown }).name
  if (typeof name !== 'string' || name.trim() === '') return { known: true, caller: null }
  const at = (c as { at?: unknown }).at
  return { known: true, caller: { name: name.trim(), at: typeof at === 'number' ? at : 0 } }
}

/** Is the caller this console (the director name it signs as)? */
export function callerIsMe(caller: ShowCaller | null, me: string): boolean {
  return caller !== null && me.trim() !== '' && foldName(caller.name) === foldName(me)
}

/** The mode a server claim gives this console: Calling only while it holds
 *  the claim. */
export function claimMode(caller: ShowCaller | null, me: string): DirectorMode {
  return callerIsMe(caller, me) ? DirectorMode.Calling : DirectorMode.Watching
}

/** The page's line beside the toggle. */
export function callerNote(caller: ShowCaller | null, me: string): string {
  if (caller === null) return '📣 Nobody is calling.'
  if (callerIsMe(caller, me)) return "📣 You're calling."
  return `📣 ${caller.name} is calling.`
}

/** How long a flip trusts itself over a cue state that disagrees. */
export const FLIP_MS = 10_000

/** The mode shown: this console's fresh flip, else the claim. */
export function shownMode(claim: DirectorMode, flip: { mode: DirectorMode; at: number } | null, now: number): DirectorMode {
  return flip !== null && now - flip.at <= FLIP_MS ? flip.mode : claim
}

interface ModeState {
  modes: Record<string, DirectorMode>
  flips: Record<string, { mode: DirectorMode; at: number }>
}

const useModes = create<ModeState>(() => ({ modes: {}, flips: {} }))

/** What the page shows about the caller: null when the claim is not the
 *  server's (local runs, an older server). */
export interface CallerInfo {
  caller: ShowCaller | null
  note: string
}

export function useDirectorMode(): [DirectorMode, (m: DirectorMode) => void, CallerInfo | null] {
  const eventId = useCockpit((s) => (s.run?.backend === RunBackend.Server ? s.run.eventId : null))
  const cues = useCockpit((s) => s.cues)
  const me = useCockpit((s) => s.me)
  const claimCaller = useCockpit((s) => s.claimCaller)
  const key = modeKey(eventId)
  const stored = useModes((s) => s.modes[key])
  const flip = useModes((s) => s.flips[key] ?? null)
  const server = eventId !== null ? showCallerOf(cues) : { known: false, caller: null }
  const local = stored ?? readMode(key)
  const mode = server.known ? shownMode(claimMode(server.caller, me), flip, Date.now()) : local
  const known = server.known
  const set = useCallback(
    (m: DirectorMode) => {
      useModes.setState((s) => ({ modes: { ...s.modes, [key]: m }, flips: known ? { ...s.flips, [key]: { mode: m, at: Date.now() } } : s.flips }))
      try {
        localStorage.setItem(key, m)
      } catch {
        // A private window: the choice lasts this visit.
      }
      if (!known) return
      void claimCaller(m === DirectorMode.Calling).then((ok) => {
        // Refused: drop the flip, so the page shows the server's claim.
        if (!ok) useModes.setState((s) => ({ ...s, flips: Object.fromEntries(Object.entries(s.flips).filter(([k]) => k !== key)) }))
      })
    },
    [key, known, claimCaller],
  )
  const info = server.known ? { caller: mode === DirectorMode.Calling && server.caller === null ? { name: me, at: 0 } : server.caller, note: '' } : null
  if (info !== null) info.note = callerNote(mode === DirectorMode.Watching && callerIsMe(info.caller, me) ? null : info.caller, me)
  return [mode, set, info]
}
