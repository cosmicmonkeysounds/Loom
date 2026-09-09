//! Run mode (Live source) — the Setup page: the live event's lifecycle
//! from inside the cockpit (pause / resume / reset / push the current
//! draft / end), a stale-draft warning when the project's text has moved
//! past the running snapshot, who else is directing right now, and this
//! console's personas with their pending choices — the Live twin of the
//! Sim source's Setup page, so a shared rehearsal and a local one are
//! driven the same way. Launching lives in Deploy (⌘4).

import { useState } from 'react'
import clsx from 'clsx'
import { useOperate } from '@/store/operate'
import { useMode } from '@/store/mode'
import { confirmAction } from '@/store/dialog'
import { GLOBAL_CHOICE_KEY } from '@/store/sim'
import { SelectionKind, useCockpit } from '@/store/cockpit'
import { FactionPill } from '@/components/cockpit/ui'
import { PendingChoice } from '@/components/cockpit/Inspector'
import { useInspect } from '@/components/cockpit/inspect'

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
      {title && <div className="mb-2 text-[10px] uppercase tracking-widest text-zinc-500">{title}</div>}
      {children}
    </section>
  )
}

const btn = 'rounded px-3 py-1.5 text-sm text-white disabled:opacity-40'

/** The "your draft has moved on" banner + the push button. Shared with Deploy. */
export function DraftSync({ compact = false }: { compact?: boolean }) {
  const event = useOperate((s) => s.event)
  const busy = useOperate((s) => s.busy)
  const pushDraft = useOperate((s) => s.pushDraft)
  if (!event) return null
  const stale = event.stale === true
  const push = () => {
    void (async () => {
      const ok = await confirmAction({
        title: 'Push the current draft into the running event?',
        body: 'The story restarts from the top on the project’s current text. Chat is cleared; guests keep their codes and rejoin where they are.',
        confirmLabel: 'Push draft',
        danger: true,
      })
      if (ok) await pushDraft()
    })()
  }
  return (
    <div
      className={clsx(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
        stale ? 'border-amber-800/70 bg-amber-950/30 text-amber-200' : 'border-zinc-800 text-zinc-500',
      )}
      data-testid="live-draft-sync"
      data-stale={stale}
    >
      <span className="flex-1">
        {stale
          ? 'The project’s text has changed since this event started — guests are playing the older draft.'
          : compact
            ? 'The event is running the current draft.'
            : 'The event is running the project’s current draft. Edit in Writing (⌘1), then push to test the change live.'}
      </span>
      <button
        onClick={push}
        disabled={busy}
        className={clsx(
          'rounded px-3 py-1 text-xs font-medium disabled:opacity-40',
          stale ? 'bg-amber-600 text-white hover:bg-amber-500' : 'border border-zinc-700 text-zinc-300 hover:bg-zinc-800',
        )}
        data-testid="live-push-draft"
      >
        ⇪ Push current draft
      </button>
    </div>
  )
}

function Lifecycle() {
  const event = useOperate((s) => s.event)
  const phase = useOperate((s) => s.phase)
  const busy = useOperate((s) => s.busy)
  const error = useOperate((s) => s.error)
  const scenario = useOperate((s) => s.scenario)
  const ledgerLen = useOperate((s) => s.ledgerLen)
  const pause = useOperate((s) => s.pause)
  const resume = useOperate((s) => s.resume)
  const reset = useOperate((s) => s.reset)
  const end = useOperate((s) => s.end)
  const setMode = useMode((s) => s.setMode)
  if (!event) return null
  const preview = event.mode === 'preview'
  return (
    <Card title={preview ? 'Shared rehearsal' : 'Live event'}>
      <div className="flex flex-wrap items-center gap-2">
        {phase === 'open' ? (
          <button onClick={() => void pause()} disabled={busy} className={clsx(btn, 'bg-amber-600 hover:bg-amber-500')} data-testid="live-pause">
            ⏸ Pause
          </button>
        ) : (
          <button onClick={() => void resume()} disabled={busy} className={clsx(btn, 'bg-emerald-600 hover:bg-emerald-500')} data-testid="live-resume">
            ▶ Resume
          </button>
        )}
        <button
          onClick={() => {
            void (async () => {
              const ok = await confirmAction({
                title: 'Restart the story?',
                body: 'Every director’s console restarts with you: the story replays from the top and all chat is cleared.',
                confirmLabel: 'Restart',
                danger: true,
              })
              if (ok) await reset()
            })()
          }}
          disabled={busy}
          className={clsx(btn, 'border border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800')}
          data-testid="live-reset"
        >
          ↺ Restart
        </button>
        <button
          onClick={() => {
            void (async () => {
              const ok = await confirmAction({
                title: preview ? 'End the shared rehearsal?' : 'End this event?',
                body: 'Everyone connected — guests, performers, co-directors — is disconnected.',
                confirmLabel: 'End',
                danger: true,
              })
              if (ok) await end()
            })()
          }}
          disabled={busy}
          className={clsx(btn, 'border border-red-900/70 bg-transparent text-red-300 hover:bg-red-950/40')}
          data-testid="live-end"
        >
          ■ End
        </button>
        <span className="ml-auto text-xs text-zinc-500">
          {phase} · {ledgerLen} events{scenario ? ` · ${scenario}` : ''}
        </span>
      </div>
      <div className="mt-3">
        <DraftSync />
      </div>
      <p className="mt-2 text-xs text-zinc-600">
        Join codes, the QR, and guest lookup live in{' '}
        <button onClick={() => setMode('deploy')} className="text-zinc-400 underline hover:text-zinc-200">
          Deploy (⌘4)
        </button>
        .
      </p>
      {error && <div className="mt-2 rounded bg-red-950 px-2 py-1 text-xs text-red-300">{error}</div>}
    </Card>
  )
}

function Directors() {
  const directors = useCockpit((s) => s.directors)
  const connected = useCockpit((s) => s.connected)
  return (
    <Card title="Directing now">
      {directors.length === 0 ? (
        <p className="text-xs text-zinc-600">{connected ? 'Only you.' : 'Not connected.'}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {directors.map((name, i) => (
            <li key={`${name}-${i}`} className="rounded-full border border-amber-800/60 bg-amber-950/30 px-2 py-0.5 text-xs text-amber-200">
              {name}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-zinc-600">
        Every co-writer on this project can open Run → Live and direct alongside you: fire beats, answer stuck
        choices, spawn personas, speak as anyone. Everything lands in the same journal.
      </p>
    </Card>
  )
}

function PersonaCard({ id }: { id: string }) {
  const row = useCockpit((s) => s.roster.find((r) => r.id === id))
  const selection = useCockpit((s) => s.selection)
  const inspect = useInspect()
  if (row === undefined) return null
  const selected = selection?.kind === SelectionKind.Guest && selection.id === id
  return (
    <div className={clsx('rounded-lg border', selected ? 'border-indigo-500/60' : 'border-zinc-800')}>
      <button
        onClick={() => inspect({ kind: SelectionKind.Guest, id })}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900/60"
        data-testid={`live-persona-${id}`}
      >
        <span className="text-sm font-medium text-zinc-100">{row.name}</span>
        <FactionPill faction={row.trueFaction ?? row.faction} />
        <span className="text-xs text-zinc-500">{row.location ?? '—'}</span>
        {row.captured && <span className="text-xs text-red-400">🔒</span>}
        <span className="ml-auto text-xs text-zinc-400">{row.score} pts</span>
      </button>
      <PendingChoice person={id} />
    </div>
  )
}

function Personas() {
  const personas = useCockpit((s) => s.personas)
  const addPersona = useCockpit((s) => s.addPersona)
  const [name, setName] = useState('')
  const add = () => {
    void addPersona(name)
    setName('')
  }
  return (
    <Card title="Your personas — act as a guest">
      <div className="flex flex-col gap-2">
        {personas.map((id) => (
          <PersonaCard key={id} id={id} />
        ))}
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="persona name"
            className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm outline-none focus:border-indigo-500"
            data-testid="live-persona-name"
          />
          <button onClick={add} className="rounded bg-zinc-800 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-700" data-testid="live-persona-add">
            + Add persona
          </button>
        </div>
        <p className="text-xs text-zinc-600">
          A persona is a real guest in the event’s world that you puppet from here — the shared-rehearsal way to
          walk the story with co-writers before anyone joins by code. Personas spawned by other directors appear
          in the Roster.
        </p>
      </div>
    </Card>
  )
}

function GlobalChoices() {
  const has = useCockpit((s) => (s.choices[GLOBAL_CHOICE_KEY]?.length ?? 0) > 0)
  if (!has) return null
  return (
    <Card title="Story decision (unbound)">
      <PendingChoice person={GLOBAL_CHOICE_KEY} />
    </Card>
  )
}

export function LiveSetupTab() {
  return (
    <div className="h-full overflow-auto p-3">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <Lifecycle />
        <GlobalChoices />
        <Personas />
        <Directors />
      </div>
    </div>
  )
}
