// The bottom Mode Bar — the primary navigation of the IDE, DaVinci
// Resolve-style. Three modes: Writing (text + story graph), Run (the
// project's one run: rehearse, go live, moderate, be anyone), Integrations
// (ship the story into a game engine). The Run label carries a dot while
// a run exists (amber rehearsal / emerald live) — visible from any mode.
// Also hosts the left-rail / properties-tray collapse toggles.

import clsx from 'clsx'
import { useMode, MODES, type Mode } from '@/store/mode'
import { RunMode, useCockpit } from '@/store/cockpit'
import { RunCockpit } from '@/components/cockpit/providers'

/** A dot on the Run tab while a run exists (from any mode). */
function RunDot() {
  const mode = useCockpit((s) => s.run?.mode ?? null)
  if (mode === null) return null
  return (
    <span
      className={clsx('h-1.5 w-1.5 rounded-full', mode === RunMode.Live ? 'bg-emerald-400' : 'bg-amber-400')}
      title={mode === RunMode.Live ? 'live event running' : 'rehearsal running'}
      data-testid="mode-run-dot"
    />
  )
}

export function ModeBar() {
  const mode = useMode((s) => s.mode)
  const setMode = useMode((s) => s.setMode)
  const railOpen = useMode((s) => s.ui[s.mode].railOpen)
  const trayOpen = useMode((s) => s.ui[s.mode].trayOpen)
  const toggleRail = useMode((s) => s.toggleRail)
  const toggleTray = useMode((s) => s.toggleTray)

  return (
    <nav
      aria-label="Editor mode"
      data-testid="mode-bar"
      className="h-12 shrink-0 flex items-center border-t border-white/10 bg-zinc-950 px-2"
    >
      <SideToggle side="left" active={railOpen} onClick={toggleRail} />
      <div className="flex-1 flex items-center justify-center gap-1">
        {MODES.map((m) => {
          const active = m.id === mode
          return (
            <button
              key={m.id}
              type="button"
              data-testid={`mode-${m.id}`}
              aria-pressed={active}
              onClick={() => setMode(m.id)}
              title={`${m.label} (${m.hint})`}
              className={clsx(
                'h-9 px-3 rounded-md flex items-center gap-2 text-sm transition-colors',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400/60',
                active
                  ? 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-400/40'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5',
              )}
            >
              <ModeGlyph id={m.id} />
              <span className="font-medium">{m.label}</span>
              {m.id === 'run' && (
                <RunCockpit shared>
                  <RunDot />
                </RunCockpit>
              )}
              <kbd
                className={clsx(
                  'text-[10px] font-mono',
                  active ? 'text-blue-300/70' : 'text-zinc-600',
                )}
              >
                {m.hint}
              </kbd>
            </button>
          )
        })}
      </div>
      <SideToggle side="right" active={trayOpen} onClick={toggleTray} />
    </nav>
  )
}

function SideToggle({
  side,
  active,
  onClick,
}: {
  side: 'left' | 'right'
  active: boolean
  onClick: () => void
}) {
  const x = side === 'left' ? 9 : 15
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`Toggle ${side === 'left' ? 'left rail' : 'properties tray'}`}
      className={clsx(
        'h-9 w-9 grid place-items-center rounded-md transition-colors',
        active ? 'text-zinc-200' : 'text-zinc-600 hover:text-zinc-300',
      )}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1={x} y1="4" x2={x} y2="20" />
      </svg>
    </button>
  )
}

function ModeGlyph({ id }: { id: Mode }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (id) {
    case 'writing':
      return (
        <svg {...common} aria-hidden>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      )
    case 'run':
      // Play-in-a-circle — rehearse locally or moderate the live run.
      return (
        <svg {...common} aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 8.5l6 3.5-6 3.5Z" />
        </svg>
      )
    case 'integrations':
      // Puzzle piece — plugging the story into another runtime.
      return (
        <svg {...common} aria-hidden>
          <path d="M10 4.5a1.8 1.8 0 0 1 3.6 0V6h2.9a.9.9 0 0 1 .9.9v2.9h1.5a1.8 1.8 0 0 1 0 3.6H17.4v2.9a.9.9 0 0 1-.9.9h-2.9v-1.5a1.8 1.8 0 0 0-3.6 0V19H7.1a.9.9 0 0 1-.9-.9v-2.9H4.7a1.8 1.8 0 0 1 0-3.6h1.5V6.9A.9.9 0 0 1 7.1 6H10Z" />
        </svg>
      )
  }
}
