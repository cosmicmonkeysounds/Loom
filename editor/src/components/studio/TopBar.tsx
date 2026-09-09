// The global top bar (Loom IDE redesign v2 §17.5): the app label, the
// open-folder name, and a per-mode layout reset.

import { useWorkspace } from '@/store/workspace'
import { useMode } from '@/store/mode'
import { useHelp } from '@/store/help'

export function TopBar() {
  const folder = useWorkspace((s) => s.root?.name ?? null)
  return (
    <header className="h-9 px-3 flex items-center gap-3 border-b border-white/10 bg-zinc-950 text-sm shrink-0">
      <span className="font-semibold tracking-wide">Loom</span>
      <span className="text-zinc-500 text-xs truncate max-w-[280px]">
        {folder ?? 'no folder open'}
      </span>
      <div className="ml-auto flex items-center gap-3">
        <HelpButton />
        <ResetLayout />
      </div>
    </header>
  )
}

function HelpButton() {
  const openHelp = useHelp((s) => s.openHelp)
  return (
    <button
      type="button"
      data-testid="open-help"
      onClick={() => openHelp()}
      title="Help — the Loom manual (⌘/)"
      className="text-zinc-600 hover:text-zinc-300"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-4 h-4"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M9.2 9.2a2.8 2.8 0 1 1 3.9 2.6c-.8.35-1.1.9-1.1 1.7v.3" />
        <circle cx="12" cy="17.2" r="0.4" fill="currentColor" />
      </svg>
    </button>
  )
}

function ResetLayout() {
  const mode = useMode((s) => s.mode)
  const reset = useMode((s) => s.reset)
  return (
    <button
      type="button"
      onClick={() => reset(mode)}
      title="Reset this mode's layout"
      className="text-zinc-600 hover:text-zinc-300 text-xs"
    >
      ⤢
    </button>
  )
}
