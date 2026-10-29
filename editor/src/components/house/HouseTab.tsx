//! Run → House (wave 25, `docs/loom-house-desk.md` §6.1): the house desk —
//! a small QLab for the house. The status strip on top, then three views
//! (wave 30):
//!
//! - **Desk**: the transport and the cue list on the left; on the right
//!   either the inspector (edit the selected cue) or the checks (walk every
//!   speaker and light).
//! - **Cue designer** (`CueDesigner.tsx`): design lighting looks with a
//!   live preview, audition sounds, build desk cues, and see how the story
//!   fires each.
//! - **Setup** (`SetupPanel.tsx`): is the sound router, the lights module
//!   and each outside mind connected, and what to do when not.
//! - **Mixer** (`MixerPanel.tsx`, wave 40): the live balance of the house
//!   sound per room and source, and the soundtrack's transport.
//!
//! Server runs only: a local run explains why. The stores are
//! `store/house-desk.ts`, `store/cue-designer.ts` and `store/house-mixer.ts` (bound from `App.tsx`);
//! the view models are `lib/house-desk-view.ts` and `lib/cue-designer.ts`.
//!
//! Keys (Desk view only; never while typing, never under a dialog): in the
//! cue list Space GOes, ↑ / ↓ move the playhead; on the checks T tests, Y ✓,
//! N ✗, ↓ the next open check, ↑ back; Esc stops the running cues on either
//! side.

import clsx from 'clsx'
import { useEffect, useMemo, type ReactNode } from 'react'
import { deskChecks, deskSetup, nextOpenCheck, validateDesk, type DeskView } from '@loom/core/house-desk'
import { RunBackend, useCockpit } from '@/store/cockpit'
import { useDialog } from '@/store/dialog'
import { shownDesk, useHouseDesk } from '@/store/house-desk'
import { checkCursor, checkStep, deskDurationsOf, deskKeyAction, deskRefsOf, runningRuns } from '@/lib/house-desk-view'
import { useNow } from '@/components/cockpit/director/clock'
import { DeskStatusStrip } from './DeskStatusStrip'
import { Transport } from './Transport'
import { CueList } from './CueList'
import { CueInspector, SaveBar } from './CueInspector'
import { ChecksPanel } from './ChecksPanel'
import { useHouseView, type HouseView } from '@/store/house-view'
import { CueDesigner } from './CueDesigner'
import { SetupPanel } from './SetupPanel'
import { MixerPanel } from './MixerPanel'

const VIEWS: Array<{ id: HouseView; label: string }> = [
  { id: 'desk', label: '🎛 Desk' },
  { id: 'designer', label: '🎨 Cue designer' },
  { id: 'setup', label: '🔌 Setup' },
  { id: 'mixer', label: '🎚 Mixer' },
]

export function HouseTab() {
  const run = useCockpit((s) => s.run)
  if (run !== null && run.backend !== RunBackend.Server) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-sm text-zinc-500" data-testid="house-local">
        <div className="max-w-md">
          <p className="text-zinc-300">The house desk lives on the event server.</p>
          <p className="mt-2">
            Its cues play the house speakers and lights through the sound router and the lights module (stagehand, on the house machines),
            which talk to an event server. This run is in your browser{run.scratch ? ' (a scratch run)' : ''}, so there is no house to reach — open a server
            project and start its rehearsal to build and test the desk.
          </p>
        </div>
      </div>
    )
  }
  return <HouseDesk />
}

function HouseDesk() {
  const view = useHouseDesk((s) => s.view)
  const gone = useHouseDesk((s) => s.gone)
  const reachable = useHouseDesk((s) => s.reachable)
  if (gone === 'missing')
    return <Explain title="This event server has no house desk yet.">It is running older code: update and restart the server, then come back.</Explain>
  if (gone === 'denied') return <Explain title="The server refused the house desk.">Sign in again, or ask the project’s owner for access.</Explain>
  if (view === null) return <Explain title={reachable ? 'Reading the house desk…' : 'Can’t reach the server: retrying…'} />
  return <DeskPage view={view} />
}

function Explain({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center text-sm text-zinc-500" data-testid="house-explain">
      <div className="max-w-md">
        <p className="text-zinc-300">{title}</p>
        {children !== undefined && <p className="mt-2">{children}</p>}
      </div>
    </div>
  )
}

function DeskPage({ view }: { view: DeskView }) {
  const draft = useHouseDesk((s) => s.draft)
  const skew = useHouseDesk((s) => s.skew)
  const check = useHouseDesk((s) => s.check)
  // The right column's view, and which side the keys drive (the side last
  // clicked: walking the checks never GOes a cue by Space).
  const houseView = useHouseView((s) => s.view)
  const setView = useHouseView((s) => s.setView)
  const pane = useHouseView((s) => s.pane)
  const setPane = useHouseView((s) => s.setPane)
  const keys = useHouseView((s) => s.keys)
  const setKeys = useHouseView((s) => s.setKeys)
  const desk = shownDesk({ draft, view })!
  const running = runningRuns(view.runs).length > 0
  const now = useNow(true, running ? 250 : 1000) + skew
  const durations = useMemo(() => deskDurationsOf(view.house), [view.house])
  const validation = useMemo(() => validateDesk(desk, deskRefsOf(view.house)), [desk, view.house])
  const sections = useMemo(() => deskChecks(view), [view])
  const cursor = checkCursor(sections, check)
  const open = sections.reduce((n, s) => n + s.rows.filter((r) => r.mark === null).length, 0)

  useEffect(() => {
    if (houseView !== 'desk') return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const t = e.target instanceof HTMLElement ? e.target : null
      const action = deskKeyAction(
        { key: e.key, tag: t?.tagName, editable: t?.isContentEditable === true, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, repeat: e.repeat },
        keys,
        useDialog.getState().current !== null,
      )
      if (action === null) return
      const s = useHouseDesk.getState()
      // Esc with nothing running is left to whoever else listens for it.
      if (action.kind === 'stop' && runningRuns(s.view?.runs ?? []).length === 0) return
      e.preventDefault()
      switch (action.kind) {
        case 'go':
          void s.go()
          return
        case 'stop':
          void s.stopRunning()
          return
        case 'standby':
          void s.moveStandby(action.delta)
          return
        case 'test':
          if (cursor !== null) void s.test(cursor, cursor.test)
          return
        case 'mark':
          if (cursor !== null) {
            const next = nextOpenCheck(sections, cursor.key)
            void s.mark(cursor.key, action.mark).then(() => {
              if (next !== null) useHouseDesk.getState().setCheck(next.key)
            })
          }
          return
        case 'next-open': {
          const next = nextOpenCheck(sections, cursor?.key ?? null)
          if (next !== null) s.setCheck(next.key)
          return
        }
        case 'check': {
          const to = checkStep(sections, cursor?.key ?? null, action.delta)
          if (to !== null) s.setCheck(to.key)
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keys, cursor, sections, houseView])

  const setupTone = deskSetup({ house: view.house, now }).reduce<'ok' | 'warn' | 'bad'>((t, r) => (r.tone === 'bad' || t === 'bad' ? 'bad' : r.tone === 'warn' || t === 'warn' ? 'warn' : 'ok'), 'ok')
  const openDesk = (index: number) => {
    useHouseDesk.getState().select(index)
    setView('desk')
    setPane('cues')
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="house-tab">
      <DeskStatusStrip view={view} />
      <div role="tablist" aria-label="House views" className="flex shrink-0 gap-1 border-b border-zinc-800 px-2 pt-1 text-sm">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={houseView === v.id}
            onClick={() => setView(v.id)}
            className={clsx('rounded-t border border-b-0 px-3 py-1', houseView === v.id ? 'border-zinc-700 bg-zinc-900 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-200')}
            data-testid={`house-view-${v.id}`}
          >
            {v.label}
            {v.id === 'setup' && setupTone !== 'ok' && <span className={clsx('ml-1', setupTone === 'bad' ? 'text-red-400' : 'text-amber-300')}>{setupTone === 'bad' ? '✗' : '⚠'}</span>}
          </button>
        ))}
      </div>
      {houseView === 'designer' && <CueDesigner view={view} onOpenDesk={openDesk} />}
      {houseView === 'setup' && (
        <SetupPanel
          view={view}
          now={now}
          onChecks={() => {
            setView('desk')
            setPane('checks')
          }}
          onDesigner={() => setView('designer')}
        />
      )}
      {houseView === 'mixer' && <MixerPanel />}
      {houseView === 'desk' && (
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col border-r border-zinc-800" onMouseDown={() => setKeys('cues')}>
          <Transport view={view} now={now} keys={keys === 'cues'} />
          <CueList desk={desk} view={view} now={now} durations={durations} />
          <Recent view={view} />
        </section>
        <section className="flex min-h-0 flex-col" onMouseDown={() => setKeys(pane)}>
          <div role="tablist" className="flex border-b border-zinc-800 text-sm">
            {(['cues', 'checks'] as const).map((p) => (
              <button
                key={p}
                role="tab"
                aria-selected={pane === p}
                onClick={() => setPane(p)}
                className={clsx('border-b-2 px-3 py-1.5', pane === p ? 'border-indigo-500 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-200')}
                data-testid={`house-pane-${p}`}
              >
                {p === 'cues' ? 'Cue' : `Checks${open > 0 ? ` (${open} open)` : ' ✓'}`}
              </button>
            ))}
          </div>
          {pane === 'cues' ? (
            <>
              <SaveBar validation={validation} />
              <div className="min-h-0 flex-1 overflow-auto">
                <CueInspector desk={desk} view={view} durations={durations} validation={validation} />
              </div>
            </>
          ) : (
            <ChecksPanel view={view} sections={sections} cursor={cursor} now={now} keys={keys === 'checks'} />
          )}
        </section>
      </div>
      )}
    </div>
  )
}

/** What the house did lately (tests, plays, GOs, story events), newest first. */
function Recent({ view }: { view: DeskView }) {
  if (view.recent.length === 0) return null
  return (
    <div className="max-h-28 shrink-0 overflow-auto border-t border-zinc-800 px-3 py-1.5" data-testid="house-recent">
      <div className="text-[10px] uppercase tracking-widest text-zinc-500">Recent</div>
      <ul>
        {view.recent.slice(0, 8).map((a, i) => (
          <li key={`${a.at}-${i}`} className="truncate text-[11px] text-zinc-400">
            <span className="text-zinc-600">{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> {a.text}
            <span className="text-zinc-600"> · {a.by}</span>
            {a.result !== undefined && <span className={a.result === 'played' ? 'text-emerald-400' : 'text-amber-300'}> · {a.result}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
