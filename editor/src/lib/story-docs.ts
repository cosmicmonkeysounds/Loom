//! Run → House → Cue designer (wave 30): the story as the designer reads it
//! — every indexed `.loom` file's text (recomputed when the LSP index
//! changes) — and opening one of its lines in Writing.

import { useMemo } from 'react'
import { lspWorkspaceSync } from '@/lib/lsp-client'
import { navigateToLocation } from '@/lib/lsp-nav'
import { useLspIndexGen } from '@/lib/lsp-index'
import { useMode } from '@/store/mode'
import type { StoryUse } from '@/lib/cue-designer'

/** Every indexed story file's text, recomputed when the index changes. */
export function useStoryDocs(): Array<{ uri: string; text: string }> {
  const gen = useLspIndexGen((s) => s.gen)
  return useMemo(() => {
    void gen
    return [...lspWorkspaceSync().docs.entries()].map(([uri, d]) => ({ uri, text: d.text }))
  }, [gen])
}

/** Open a story line in Writing. */
export function openUse(u: StoryUse): void {
  useMode.getState().setMode('writing')
  void navigateToLocation({ uri: u.uri, range: { start: { line: u.line, character: u.character }, end: { line: u.line, character: u.character } } })
}
