//! Which backend Run mode drives — resolved from the open workspace, never
//! picked by the user. A **server project** runs on the server (the
//! project's one shared event, `store/operate.ts`); a **local folder**
//! runs the in-browser `@loom/core` `Sim` (`store/sim.ts`). "Start
//! rehearsal" is therefore one action everywhere: on a server project it
//! IS the shared rehearsal every co-writer lands in.
//!
//! The one deliberate exception is the **scratch run**: on a server
//! project, while the shared run is live (real guests) or has other
//! directors on it, pushing a draft would restart the show for everyone —
//! so the header offers "test privately in this browser", an in-browser
//! run in the same cockpit (violet chrome, `scratch · this browser` strip,
//! one "back to the shared run" exit). It is session-only, never
//! persisted, and never auto-selected: a failed status fetch shows an
//! error + the option, it does not silently flip backends.

import { create } from 'zustand'
import { useWorkspace } from '@/store/workspace'
import { RunBackend, RunMode } from '@/store/cockpit'
import { useSim } from '@/store/sim'

/** The backend the open workspace resolves to. */
export function useRunBackend(): RunBackend {
  const projectId = useWorkspace((s) => s.projectId)
  return projectId !== null ? RunBackend.Server : RunBackend.Local
}

/** Non-hook twin for stores / event handlers. */
export function runBackend(): RunBackend {
  return useWorkspace.getState().projectId !== null ? RunBackend.Server : RunBackend.Local
}

/** What the shared run looked like when a scratch run was entered — so the
 *  scratch cockpit can still say "shared run: LIVE · 12 guests". */
export interface SharedRunSnapshot {
  mode: RunMode
  guests: number
}

interface ScratchState {
  /** An in-browser scratch run is the cockpit's backend right now. */
  active: boolean
  /** The shared run at the moment of entering (null outside a scratch run). */
  shared: SharedRunSnapshot | null
  /** Start a scratch run (compiles the current index into the local sim).
   *  Rolls back if no run could start (e.g. nothing indexed yet). */
  enter(shared?: SharedRunSnapshot): Promise<void>
  /** Tear the scratch run down and return to the shared run. */
  leave(): Promise<void>
}

export const useScratch = create<ScratchState>((set) => ({
  active: false,
  shared: null,
  enter: async (shared) => {
    set({ active: true, shared: shared ?? null })
    try {
      await useSim.getState().startRun(RunMode.Rehearsal, { scratch: true })
    } finally {
      if (useSim.getState().run === null) set({ active: false, shared: null })
    }
  },
  leave: async () => {
    await useSim.getState().end()
    set({ active: false, shared: null })
  },
}))

/** Non-hook twin for stores: is a scratch run the cockpit's backend now? */
export function scratchActive(): boolean {
  return useScratch.getState().active
}

// A scratch run that ends through the header's End (i.e. `useSim.end()`,
// not `leave()`) must still hand the cockpit back to the shared run.
useSim.subscribe((s, prev) => {
  if (prev.run !== null && s.run === null && useScratch.getState().active) {
    useScratch.setState({ active: false, shared: null })
  }
})

// A local run belongs to the workspace it was compiled from: switching
// projects (or closing one) ends it — and forgets the run that just ended —
// instead of letting the next project inherit a stranger's roster and log.
useWorkspace.subscribe((s, prev) => {
  if (s.root === prev.root && s.projectId === prev.projectId) return
  const sim = useSim.getState()
  if (sim.run !== null) void sim.end().then(() => useSim.setState({ lastRun: null }))
  else if (sim.lastRun !== null) useSim.setState({ lastRun: null })
  if (useScratch.getState().active) useScratch.setState({ active: false, shared: null })
})

/**
 * May the header offer a scratch run? Only when pushing a draft into the
 * shared run would land on someone else: the run is live, or other
 * directors are on it. (The empty state offers it separately when the
 * control plane is unreachable.)
 */
export function scratchAllowed(run: { mode: RunMode; directors?: string[] } | null, directors: string[]): boolean {
  if (run === null) return false
  return run.mode === RunMode.Live || directors.length > 1
}
