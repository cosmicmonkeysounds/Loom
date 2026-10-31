//! Run → House → 🎚 Mixer (wave 40, `docs/loom-w40-contract.md` C4): the
//! live balance of the house sound. Now Playing moved to 🎵 Music in wave 58
//! (`MusicPanel.tsx`), which shares this store and `Strip`.
//!
//! - **The strip**: is the sound router listening (the mix is kept and
//!   applies when it connects), its name, the last note, **Reset all**.
//! - **The console**: one column per scope (Everywhere, then each room),
//!   side by side, scrolling across: `scopeStrips` with a fader (−60 … +10,
//!   0.5 dB; double-click, Alt-click or 0 resets it), the dB, a mute, the
//!   live meter, and "plays at" when the levels above move it.
//!
//! It reads while shown (`store/house-mixer.ts` `watch`); faders are
//! optimistic and throttled there. Pure side: `lib/house-mixer-view.ts`.

import clsx from 'clsx'
import { useEffect, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { formatMixDb, meterFill, mixerScopes, MIX_DB_MAX, MIX_DB_MIN, MIX_DB_STEP, scopeKeys, scopeStrips, type MixerStrip, type MixerView, type MixScope } from '@loom/core/house-mixer'
import { mixerLevels, useHouseMixer } from '@/store/house-mixer'
import { meterTone, stripNote } from '@/lib/house-mixer-view'
import { btn, btnDanger, heading, TONE_CHIP, TONE_TEXT } from './ui'

export function MixerPanel() {
  const view = useHouseMixer((s) => s.view)
  const gone = useHouseMixer((s) => s.gone)
  const reachable = useHouseMixer((s) => s.reachable)

  useEffect(() => {
    useHouseMixer.getState().watch(true)
    return () => useHouseMixer.getState().watch(false)
  }, [])

  if (gone === 'missing') return <Centered title="This event server has no mixer yet: update and restart it.">It is running code from before wave 40; the desk and the Cue designer still work.</Centered>
  if (gone === 'denied') return <Centered title="The server refused the mixer.">Only the event’s directors and hosts can move the house mix. Sign in again, or ask the project’s owner.</Centered>
  if (view === null) return <Centered title={reachable ? 'Reading the mixer…' : 'Can’t reach the server: retrying…'} />
  return <MixerPage view={view} />
}

export function Centered({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-8 text-center text-sm text-zinc-500" data-testid="mixer-explain">
      <div className="max-w-md">
        <p className="text-zinc-300">{title}</p>
        {children !== undefined && <p className="mt-2">{children}</p>}
      </div>
    </div>
  )
}

function MixerPage({ view }: { view: MixerView }) {
  const note = useHouseMixer((s) => s.note)
  const reachable = useHouseMixer((s) => s.reachable)
  const pending = useHouseMixer((s) => s.pending)
  const levels = mixerLevels({ view, pending })
  const moved = Object.keys(view.mix.levels).length
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="house-mixer">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-xs" data-testid="mixer-status">
        <span className={clsx('rounded border px-1.5 py-0.5', view.router.online ? TONE_CHIP.ok : TONE_CHIP.warn)} data-testid="mixer-router">
          {view.router.online ? `🔊 router online${view.router.name !== null ? ` (${view.router.name})` : ''}` : '🔇 no router listening: the mix is kept and applies when it connects'}
        </span>
        {view.router.online && view.meters === null && <span className="text-zinc-500">no live meters yet</span>}
        {!reachable && <span className={TONE_TEXT.bad}>Can’t reach the server: retrying…</span>}
        {note !== null && (
          <span className={TONE_TEXT[note.tone]} data-testid="mixer-note">
            {note.text}
          </span>
        )}
        <span className="ml-auto text-zinc-500">{moved === 0 ? 'every level at 0 dB' : `${moved} level${moved === 1 ? '' : 's'} moved`}</span>
        <button className={btnDanger} disabled={moved === 0 && Object.keys(pending).length === 0} onClick={() => void useHouseMixer.getState().resetAll()} data-testid="mixer-reset-all" title="Every fader and mute back to 0 dB">
          Reset all
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className={clsx(heading, 'mb-1.5')}>Console</div>
        <div className="flex gap-3 overflow-x-auto pb-2" data-testid="mixer-console">
          {mixerScopes(view).map((s) => (
            <ScopeColumn key={s.id} id={s.id} label={s.label} scope={s.scope} strips={scopeStrips(view, s.scope, levels)} resetKeys={scopeKeys(view, s.scope)} />
          ))}
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          A source plays at the sum of its faders: Master, the source everywhere, the room, the source in the room, the speaker. Double-click, Alt-click or press 0 on a fader for 0 dB. Speaker tests are never mixed.
        </p>
      </div>
    </div>
  )
}

// -- the console ---------------------------------------------------------------

function ScopeColumn({ id, label, scope, strips, resetKeys }: { id: string; label: string; scope: MixScope; strips: MixerStrip[]; resetKeys: string[] }) {
  return (
    <section className="flex w-64 shrink-0 flex-col rounded-xl border border-zinc-800 bg-zinc-950" data-testid={`mixer-scope-${id}`}>
      <header className="flex items-center gap-2 border-b border-zinc-800 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">{label}</span>
        <button className={btn} disabled={resetKeys.length === 0} onClick={() => void useHouseMixer.getState().resetKeys(resetKeys)} title={`Every fader in ${label} back to 0 dB`} data-testid={`mixer-reset-${id}`}>
          Reset
        </button>
      </header>
      <div className="divide-y divide-zinc-900">
        {strips.map((s) => (
          <Strip key={s.key ?? `meter:${s.source}`} strip={s} scopeLabel={label} speakerRow={scope.kind === 'room' && s.kind === 'speaker'} />
        ))}
      </div>
    </section>
  )
}

const METER_COLOUR = { off: 'bg-zinc-700', ok: 'bg-emerald-500', hot: 'bg-amber-400', clip: 'bg-red-500' } as const

function Meter({ db }: { db: number | null }) {
  const fill = meterFill(db)
  return (
    <div className="h-1.5 overflow-hidden rounded bg-zinc-800" title={db !== null ? `peak ${db.toFixed(1)} dBFS` : 'no meter'} data-testid="mixer-meter">
      <div className={clsx('h-full transition-[width] duration-150', METER_COLOUR[meterTone(db)])} style={{ width: `${(fill * 100).toFixed(1)}%` }} />
    </div>
  )
}

export function Strip({ strip, scopeLabel, speakerRow }: { strip: MixerStrip; scopeLabel: string; speakerRow: boolean }) {
  const key = strip.key
  if (strip.kind === 'meter' || key === null) {
    return (
      <div className="space-y-1 px-2 py-1.5" data-testid={`mixer-strip-meter-${strip.source ?? ''}`}>
        <div className="truncate text-xs text-zinc-300">{strip.label}</div>
        <Meter db={strip.meterDb} />
        {strip.note !== undefined && <div className="text-[10px] text-zinc-500">{strip.note}</div>}
      </div>
    )
  }
  const s = useHouseMixer.getState
  const db = strip.level.db
  const muted = strip.level.mute
  const note = stripNote(strip)
  const reset = () => s().resetKey(key)
  const onMouseDown = (e: MouseEvent<HTMLInputElement>) => {
    if (!e.altKey) return
    e.preventDefault()
    reset()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === '0' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      reset()
    }
  }
  return (
    <div className={clsx('space-y-1 px-2 py-1.5', strip.kind === 'scope' && 'bg-zinc-900/40', speakerRow && 'pl-4')} data-testid={`mixer-strip-${key}`}>
      <div className="flex items-center gap-2">
        <span className={clsx('min-w-0 flex-1 truncate text-xs', strip.kind === 'scope' ? 'font-medium text-zinc-100' : 'text-zinc-300')}>
          {speakerRow ? `🔈 ${strip.label}` : strip.label}
        </span>
        <span className={clsx('w-12 text-right font-mono text-[11px]', muted ? 'text-zinc-600 line-through' : db === 0 ? 'text-zinc-500' : 'text-zinc-100')} data-testid="mixer-db">
          {formatMixDb(db)}
        </span>
        <button
          className={clsx('rounded border px-1.5 py-0.5 text-[10px] font-semibold', muted ? 'border-red-700 bg-red-900/60 text-red-100' : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800')}
          aria-pressed={muted}
          aria-label={`Mute ${strip.label} (${scopeLabel})`}
          onClick={() => s().setMute(key, !muted)}
          data-testid="mixer-mute"
        >
          M
        </button>
      </div>
      <input
        type="range"
        min={MIX_DB_MIN}
        max={MIX_DB_MAX}
        step={MIX_DB_STEP}
        value={db}
        onChange={(e) => s().setLevel(key, Number(e.target.value))}
        onDoubleClick={reset}
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
        aria-label={`${strip.label} (${scopeLabel}) level`}
        aria-valuetext={`${formatMixDb(db)} dB${muted ? ', muted' : ''}`}
        title="Double-click, Alt-click or press 0: back to 0 dB"
        className={clsx('h-4 w-full cursor-pointer accent-indigo-500', muted && 'opacity-50')}
        data-testid="mixer-fader"
      />
      <Meter db={strip.meterDb} />
      {note !== null && <div className={clsx('text-[10px]', strip.effective === null ? 'text-amber-300' : 'text-zinc-500')}>{note}</div>}
    </div>
  )
}
