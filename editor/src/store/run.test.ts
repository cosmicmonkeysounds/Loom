// The backend resolver + the guarded scratch lane: a server project runs on
// the server, a local folder in the browser, and a scratch run is a local run
// entered from a server project that hands the cockpit back when it ends.

import { beforeEach, describe, expect, it } from 'vitest'
import { lspWorkspaceSync, uriFor } from '@/lib/lsp-client'
import { RunBackend, RunMode } from '@/store/cockpit'
import { runBackend, scratchAllowed, useScratch } from '@/store/run'
import { useSim } from '@/store/sim'
import { useWorkspace } from '@/store/workspace'

const MAIN = `entry: opening

ROLE Guest
  score: 0 to 100 = 0

== opening
  The lights dim.
`

describe('run backend resolver', () => {
  beforeEach(async () => {
    await useSim.getState().end()
    useScratch.setState({ active: false })
    lspWorkspaceSync().reset()
    lspWorkspaceSync().updateMany([[uriFor('main.loom'), MAIN]])
  })

  it('follows the workspace kind, never a user switch', () => {
    useWorkspace.setState({ projectId: null })
    expect(runBackend()).toBe(RunBackend.Local)
    useWorkspace.setState({ projectId: 'p-1' })
    expect(runBackend()).toBe(RunBackend.Server)
    useWorkspace.setState({ projectId: null })
  })

  it('offers a scratch run only when pushing a draft would land on someone else', () => {
    expect(scratchAllowed(null, [])).toBe(false)
    expect(scratchAllowed({ mode: RunMode.Rehearsal }, ['me'])).toBe(false)
    expect(scratchAllowed({ mode: RunMode.Rehearsal }, ['me', 'Ana'])).toBe(true)
    expect(scratchAllowed({ mode: RunMode.Live }, ['me'])).toBe(true)
  })

  it('enter() starts a scratch-flagged local run; leave() or ending it hands the cockpit back', async () => {
    await useScratch.getState().enter()
    expect(useScratch.getState().active).toBe(true)
    expect(useSim.getState().run?.scratch).toBe(true)
    await useScratch.getState().leave()
    expect(useScratch.getState().active).toBe(false)
    expect(useSim.getState().run).toBeNull()

    await useScratch.getState().enter()
    await useSim.getState().end() // the header's End, not leave()
    expect(useScratch.getState().active).toBe(false)
  })
})
