//! This console's Calling / Watching choice, shared by the Director page
//! and the Inspector tray (which needs it to know whether the page already
//! shows the house at a glance). Kept per event in localStorage, mirrored in
//! a small store so both readers re-render on a switch.

import { useCallback } from 'react'
import { create } from 'zustand'
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

const useModes = create<{ modes: Record<string, DirectorMode> }>(() => ({ modes: {} }))

export function useDirectorMode(): [DirectorMode, (m: DirectorMode) => void] {
  const eventId = useCockpit((s) => (s.run?.backend === RunBackend.Server ? s.run.eventId : null))
  const key = modeKey(eventId)
  const stored = useModes((s) => s.modes[key])
  const mode = stored ?? readMode(key)
  const set = useCallback(
    (m: DirectorMode) => {
      useModes.setState((s) => ({ modes: { ...s.modes, [key]: m } }))
      try {
        localStorage.setItem(key, m)
      } catch {
        // A private window: the choice lasts this visit.
      }
    },
    [key],
  )
  return [mode, set]
}
