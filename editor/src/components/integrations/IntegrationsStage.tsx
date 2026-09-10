//! Integrations mode (⌘3) — center stage: where the story leaves Loom
//! for another runtime. Run (⌘2) hosts *live events*; this mode hosts
//! every other target the project ships into.
//!
//! Today that is the Wwise-style game-engine integration: link a Godot 4
//! project, install the `addons/loom` runtime into it, and build the open
//! workspace into `.loombank` + `LoomIDs.gd` inside the game project.
//! Unity / Unreal are listed as the spec'd-but-unwritten targets — the
//! bank format + conformance harness are what make them cheap
//! (`docs/loom-banks.md`).

import { isDesktop } from '@/lib/desktop'
import { GodotPanel } from './GodotPanel'

export function IntegrationsStage() {
  return (
    <div className="h-full w-full overflow-auto bg-zinc-950 p-4 text-zinc-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <header className="px-1">
          <h2 className="text-sm font-medium text-zinc-200">Integrations</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Ship this story into a game engine. Loom compiles the project into engine-agnostic{' '}
            <code className="text-zinc-400">.loombank</code> files plus generated ID headers, and installs a small
            native runtime on the engine side — the Wwise model.
          </p>
        </header>

        {isDesktop() ? (
          <GodotPanel />
        ) : (
          <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Game engine — Godot</h3>
            <p className="text-sm text-zinc-500">
              Linking a Godot project writes files into it, so it needs filesystem access the browser doesn’t grant.
              Open this workspace in the <strong className="text-zinc-300">Loom desktop app</strong> to link a project,
              install the runtime addon, and build banks.
            </p>
          </section>
        )}

        <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Other engines</h3>
          <ul className="space-y-1 text-sm text-zinc-500">
            <li>
              <span className="text-zinc-400">Unity</span> — not yet written. The bank format is engine-agnostic and
              the conformance harness is shared, so a runtime is a port, not a rewrite.
            </li>
            <li>
              <span className="text-zinc-400">Unreal</span> — same: <code className="text-zinc-400">LoomIDs.h</code>{' '}
              already generates alongside the GDScript and C# headers.
            </li>
          </ul>
        </section>
      </div>
    </div>
  )
}
