// The Help overlay's open/closed state, as a tiny store so any surface can
// open it (TopBar button, ⌘/ / F1, the command palette) — same pattern as
// store/context-menu.ts.

import { create } from 'zustand'

type HelpState = {
  open: boolean
  /** The article slug to show, or null for the default (first article). */
  slug: string | null
  openHelp: (slug?: string) => void
  closeHelp: () => void
  toggleHelp: () => void
}

export const useHelp = create<HelpState>((set) => ({
  open: false,
  slug: null,
  openHelp: (slug) => set({ open: true, slug: slug ?? null }),
  closeHelp: () => set({ open: false }),
  toggleHelp: () => set((s) => ({ open: !s.open })),
}))
