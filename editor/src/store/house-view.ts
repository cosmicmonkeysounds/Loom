//! Run → House (wave 30): which view the tab shows (Desk, Cue designer,
//! Setup), the Desk's right column (Cue or Checks) and the side its keys
//! drive, kept across tab switches (memory only).

import { create } from 'zustand'
import type { DeskPane } from '@/lib/house-desk-view'

/** The House tab's view and the Desk's right column, kept across tab switches. */
export type HouseView = 'desk' | 'designer' | 'setup'
export const useHouseView = create<{ view: HouseView; pane: DeskPane; keys: DeskPane; setView: (v: HouseView) => void; setPane: (p: DeskPane) => void; setKeys: (k: DeskPane) => void }>((set) => ({
  view: 'desk',
  pane: 'cues',
  keys: 'cues',
  setView: (view) => set({ view }),
  setPane: (pane) => set({ pane, keys: pane }),
  setKeys: (keys) => set({ keys }),
}))
