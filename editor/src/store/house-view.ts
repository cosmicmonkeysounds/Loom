//! Run → House (wave 30): which view the tab shows (Desk, Cue designer,
//! Setup, the Music manager since wave 58, the Mixer since wave 40, the Map since wave 49), the Desk's right column (Cue or Checks) and the side its keys
//! drive, kept across tab switches (memory only). The Map's two flags are
//! `house/HouseMapHost.tsx`'s: which run's map has been opened (it stays
//! mounted from then on, off the page, so a draft outlives a tab or a mode),
//! and whether it is on screen now (the map takes keys only then).

import { create } from 'zustand'
import type { DeskPane } from '@/lib/house-desk-view'

/** The House tab's view and the Desk's right column, kept across tab switches. */
export type HouseView = 'desk' | 'designer' | 'setup' | 'music' | 'mixer' | 'map'
export const useHouseView = create<{
  view: HouseView
  pane: DeskPane
  keys: DeskPane
  mapEvent: string | null
  mapShown: boolean
  setView: (v: HouseView) => void
  setPane: (p: DeskPane) => void
  setKeys: (k: DeskPane) => void
  /** The Map view came on screen for this event (null: it left). */
  showMap: (eventId: string | null) => void
}>((set) => ({
  view: 'desk',
  pane: 'cues',
  keys: 'cues',
  mapEvent: null,
  mapShown: false,
  setView: (view) => set({ view }),
  setPane: (pane) => set({ pane, keys: pane }),
  setKeys: (keys) => set({ keys }),
  showMap: (eventId) => set(eventId === null ? { mapShown: false } : { mapShown: true, mapEvent: eventId }),
}))
