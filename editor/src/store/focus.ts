// The focus bus: panels read/write through this single store so hovering
// or pinning a beat / character / world-key on one surface (story graph,
// Story Bin, References) highlights it on every other.

import { create } from 'zustand'
import type { Position } from '@loom/core/lsp'

export type FocusRef =
  | { kind: 'character'; name: string }
  | { kind: 'beat'; name: string }
  | { kind: 'world-key'; key: string }
  // A cursor-positioned symbol — richer than a bare name, so the References
  // panel resolves the actual token under the cursor via `referencesAt`.
  | { kind: 'symbol'; label: string; uri: string; pos: Position }

type FocusState = {
  hover: FocusRef | null
  pinned: FocusRef | null
  setHover(ref: FocusRef | null): void
  pin(ref: FocusRef | null): void
}

export const useFocus = create<FocusState>((set) => ({
  hover: null,
  pinned: null,
  setHover: (ref) => set({ hover: ref }),
  pin: (ref) => set({ pinned: ref }),
}))
