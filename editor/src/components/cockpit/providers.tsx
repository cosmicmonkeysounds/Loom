//! Cockpit providers — bind the shared cockpit components to a backend.
//! `RunCockpit` resolves the store from the open workspace (`store/run.ts`):
//! a server project → `useOperate` (the project's shared event), a local
//! folder → `useSim` (the in-browser engine) — and the guarded scratch lane
//! swaps the local store in on a server project for the duration of the
//! scratch run. Both stores are module singletons, so the provider value is
//! referentially stable. This file and `store/run.ts` are the ONLY places
//! that may import a concrete store (see the ESLint restricted-imports rule).

import type { ReactNode } from 'react'
import { CockpitContext, RunBackend } from '@/store/cockpit'
import { useOperate } from '@/store/operate'
import { useSim } from '@/store/sim'
import { useRunBackend, useScratch } from '@/store/run'

/** Run mode's provider — the stage, rail, and inspector tray all peer
 *  into whichever backend the workspace resolves to. `shared` ignores a
 *  scratch run (the Mode Bar dot must report the real shared run). */
export function RunCockpit({ children, shared = false }: { children: ReactNode; shared?: boolean }) {
  const backend = useRunBackend()
  const scratch = useScratch((s) => s.active)
  const store = backend === RunBackend.Local || (scratch && !shared) ? useSim : useOperate
  return <CockpitContext.Provider value={store}>{children}</CockpitContext.Provider>
}
