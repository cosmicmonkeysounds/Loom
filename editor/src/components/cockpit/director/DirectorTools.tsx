//! The Director's rare tools (spec §4.1), moved verbatim from the old
//! Director page: fire any named event (with arguments), fire a beat, and
//! broadcast a room-wide cue (🔔 Alert banners, chimes and buzzes every phone
//! it reaches). A `<details>` at the bottom of the centre column — open by
//! default when the story has no admin cues, so the page is never empty.

import { useState } from 'react'
import clsx from 'clsx'
import { parseSignalArgs } from '@/lib/signal-args'
import { useCockpit } from '@/store/cockpit'
import { alertCue } from '../broadcast'

export function SubjectSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const roster = useCockpit((s) => s.roster)
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-indigo-500"
    >
      <option value="">— everyone —</option>
      {roster.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name} ({r.id})
        </option>
      ))}
    </select>
  )
}

/** Sentinel `<option>` that reveals the free-text signal input. */
const CUSTOM_EVENT = '__custom'

export function DirectorTools({ defaultOpen }: { defaultOpen: boolean }) {
  const beats = useCockpit((s) => s.beats)
  const events = useCockpit((s) => s.events)
  const fireSignal = useCockpit((s) => s.fireSignal)
  const fireBeat = useCockpit((s) => s.fireBeat)
  const broadcast = useCockpit((s) => s.broadcast)

  const [signal, setSignal] = useState('')
  const [custom, setCustom] = useState('')
  const [signalSubject, setSignalSubject] = useState('')
  const [signalArgs, setSignalArgs] = useState('')
  const [beat, setBeat] = useState('')
  const [beatSubject, setBeatSubject] = useState('')
  const [cue, setCue] = useState('')
  const [scope, setScope] = useState('all')
  const [alertOn, setAlertOn] = useState(false)

  const chosenSignal = signal === CUSTOM_EVENT ? custom.trim() : signal
  const parsedArgs = parseSignalArgs(signalArgs)
  const argsBad = parsedArgs === undefined

  return (
    <details open={defaultOpen} className="group rounded-xl border border-zinc-800" data-testid="director-tools">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-200">
        Tools <span className="font-normal normal-case tracking-normal text-zinc-500">· Fire named event · Fire beat · Broadcast cue</span>
      </summary>
      <div className="flex flex-col gap-4 p-3 pt-0">
        <section className="rounded-xl border border-zinc-800 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Fire named event</div>
          <p className="mb-2 text-xs text-zinc-600">
            Triggers every <code>on &lt;name&gt;</code> hook — globally or on one guest. The list is
            every event the story declares.
          </p>
          <div className="flex flex-wrap gap-2">
            <select
              value={signal}
              onChange={(e) => setSignal(e.target.value)}
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-indigo-500"
              data-testid="director-event-select"
            >
              <option value="">— select an event —</option>
              {events.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
              <option value={CUSTOM_EVENT}>custom…</option>
            </select>
            {signal === CUSTOM_EVENT && (
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="event name (e.g. lockdown)"
                className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
              />
            )}
            <SubjectSelect value={signalSubject} onChange={setSignalSubject} />
            <button
              onClick={() => chosenSignal && !argsBad && void fireSignal(chosenSignal, signalSubject || undefined, parsedArgs)}
              disabled={!chosenSignal || argsBad}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              Fire
            </button>
            <input
              value={signalArgs}
              onChange={(e) => setSignalArgs(e.target.value)}
              placeholder="arguments — level: 3, who: Ivo  (binds like `fire x with level: 3`)"
              className={clsx(
                'w-full rounded border bg-zinc-950 px-2 py-1.5 font-mono text-xs outline-none focus:border-indigo-500',
                argsBad ? 'border-red-800' : 'border-zinc-700',
              )}
              data-testid="director-event-args"
            />
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Fire beat</div>
          <p className="mb-2 text-xs text-zinc-600">Inject a named story beat, optionally targeting one guest.</p>
          <div className="flex flex-wrap gap-2">
            <select
              value={beat}
              onChange={(e) => setBeat(e.target.value)}
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-indigo-500"
            >
              <option value="">— select a beat —</option>
              {beats.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <SubjectSelect value={beatSubject} onChange={setBeatSubject} />
            <button
              onClick={() => beat && void fireBeat(beat, beatSubject || undefined)}
              disabled={!beat}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              Fire
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Broadcast cue</div>
          <p className="mb-2 text-xs text-zinc-600">
            A room-wide cue, scoped (e.g. <code>faction(Mods)</code>, <code>location(Internet)</code>). An
            <strong> alert</strong> banners, chimes and buzzes every phone it reaches — booths included.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={cue}
              onChange={(e) => setCue(e.target.value)}
              placeholder="cue (e.g. intermission)"
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
            />
            <input
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="scope"
              className="w-32 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => cue.trim() && void broadcast(scope.trim() || 'all', alertCue(cue, alertOn))}
              className={clsx(
                'rounded px-3 py-1.5 text-sm text-white',
                alertOn ? 'bg-amber-600 hover:bg-amber-500' : 'bg-indigo-600 hover:bg-indigo-500',
              )}
              data-testid="director-broadcast-send"
            >
              {alertOn ? 'Send alert' : 'Send'}
            </button>
            <label className="flex w-full items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={alertOn}
                onChange={(e) => setAlertOn(e.target.checked)}
                data-testid="director-broadcast-alert"
              />
              🔔 Alert (chime + vibrate + banner)
            </label>
          </div>
        </section>
      </div>
    </details>
  )
}
