//! Run → Director (wave 10): the running order by act, the night at a
//! glance, and the event / beat / broadcast tools. One page answers, in
//! order: what do I press next and is it safe (the NOW card), did my last
//! press land and what did it do (its banner and LAST), where is the night
//! (the Night bar), what else can I press (On hand), is the house OK (the
//! glance column), the whole running order, and the rare tools.
//!
//! Acts and the board are display only: NEXT / LAST, refusals and the
//! journal are the server's `cueState`, untouched. Every cue arms first and
//! fires on a second press (core's arm model, shared with the phone), on
//! the keyboard too (`director-keys.ts`, Calling mode only — a second
//! director sets Watching). Breakpoints are container queries on this root,
//! so the layout follows the tab area, not the window.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import clsx from 'clsx'
import { RunBackend, useCockpit } from '@/store/cockpit'
import { cueActs, cueRows, focusActIndex, type CueAct } from '@loom/core/cue-sheet'
import { LensGate } from '../tabs'
import { DirectorContext, type DirectorCtx } from './context'
import { DirectorMode, directorKey } from './director-keys'
import { useArmed } from './useArmed'
import { useAwardFields } from './useAwardFields'
import { NightBar } from './NightBar'
import { NowCard } from './NowCard'
import { OnHand } from './OnHand'
import { RunningOrder } from './RunningOrder'
import { GlanceColumn, GlanceStrip } from './Glance.tsx'
import { DirectorTools } from './DirectorTools'

export function DirectorTab() {
  const locked = useCockpit((s) => s.lens !== null)
  if (locked) return <LensGate what="fire events, beats, and broadcasts" />
  return <DirectorPage />
}

/** Where this console's Calling / Watching choice is kept. */
function modeKey(eventId: string | null): string {
  return `loom.director.mode.${eventId ?? 'local'}`
}

function readMode(key: string): DirectorMode {
  try {
    return localStorage.getItem(key) === DirectorMode.Watching ? DirectorMode.Watching : DirectorMode.Calling
  } catch {
    return DirectorMode.Calling
  }
}

function useDirectorMode(): [DirectorMode, (m: DirectorMode) => void] {
  const eventId = useCockpit((s) => (s.run?.backend === RunBackend.Server ? s.run.eventId : null))
  const key = modeKey(eventId)
  const [state, setState] = useState(() => ({ key, mode: readMode(key) }))
  const mode = state.key === key ? state.mode : readMode(key)
  const set = useCallback(
    (m: DirectorMode) => {
      setState({ key, mode: m })
      try {
        localStorage.setItem(key, m)
      } catch {
        // A private window: the choice lasts this visit.
      }
    },
    [key],
  )
  return [mode, set]
}

/** What a key event came from: a field (the keys leave typing alone), a
 *  native control Enter / Space activates that is not a cue (it keeps
 *  them), or a cue's own button (`data-cue-press`: Enter presses it). */
export function keyTarget(t: EventTarget | null): { editable: boolean; control: boolean; cue: string | null } {
  if (!(t instanceof HTMLElement)) return { editable: false, control: false, cue: null }
  const editable =
    t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.closest('[contenteditable="true"]') !== null
  const cue = t.dataset.cuePress ?? null
  const native = t.tagName === 'BUTTON' || t.tagName === 'SUMMARY' || (t.tagName === 'A' && t.hasAttribute('href'))
  return { editable, control: native && cue === null, cue }
}

/** Nothing on the page holds focus (it fell to `<body>`: the focused
 *  button unmounted or turned disabled) — the Director's keys still work. */
function focusIsNowhere(root: HTMLElement): boolean {
  const ae = document.activeElement
  if (ae === null || ae === document.body || ae === document.documentElement) return true
  return root.contains(ae) && ae instanceof HTMLElement && ae.matches(':disabled')
}

function ModeToggle({ mode, setMode }: { mode: DirectorMode; setMode: (m: DirectorMode) => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-zinc-700 text-[11px]" data-testid="director-mode" role="radiogroup" aria-label="Director mode">
      {[
        { m: DirectorMode.Calling, label: 'Calling', tip: 'You call the cues: the keyboard is on (Space · Space fires NEXT)' },
        { m: DirectorMode.Watching, label: 'Watching', tip: 'A second director: the house at a glance, the keyboard off (clicks still arm, then fire)' },
      ].map(({ m, label, tip }) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          onClick={() => setMode(m)}
          title={tip}
          className={clsx('px-2 py-0.5', mode === m ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200')}
          data-testid={`director-mode-${m}`}
        >
          {mode === m && m === DirectorMode.Calling ? '● ' : ''}
          {label}
        </button>
      ))}
    </div>
  )
}

function DirectorPage() {
  const interactions = useCockpit((s) => s.interactions)
  const cues = useCockpit((s) => s.cues)
  const [mode, setMode] = useDirectorMode()
  const rows = useMemo(() => cueRows(interactions, cues), [interactions, cues])
  const acts = useMemo(() => cueActs(rows), [rows])
  const focus = focusActIndex(acts)
  const actOf = useMemo(() => {
    const m = new Map<string, CueAct>()
    for (const a of acts) for (const r of a.rows) m.set(r.id, a)
    return m
  }, [acts])
  const arm = useArmed(rows, cues)
  const awards = useAwardFields(rows)
  const [cursor, setCursor] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [all, setAll] = useState(false)
  const [flash, setFlash] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  // The tab takes the keys when it opens.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(false), 900)
    return () => clearTimeout(t)
  }, [flash])

  const scrollTo = useCallback((id: string) => {
    const el = rootRef.current?.querySelector(`[data-cue-nav="${CSS.escape(id)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [])

  const showAct = useCallback((key: string) => {
    setToggled((t) => ({ ...t, [key]: true }))
    requestAnimationFrame(() => {
      rootRef.current?.querySelector(`[data-act-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }, [])

  /** Give the keys back to the page (focus fell off, or a mouse press). */
  const reclaim = useCallback(() => {
    const root = rootRef.current
    if (root !== null && focusIsNowhere(root)) root.focus({ preventScroll: true })
  }, [])

  // A Space the page handled must not also click the focused cue.
  const swallowUp = useRef(false)
  const handleKey = (e: globalThis.KeyboardEvent | KeyboardEvent<HTMLDivElement>): void => {
    if (mode !== DirectorMode.Calling) return
    const target = keyTarget(e.target)
    if (e.key === 'Escape' && arm.armed === null && arm.picking !== null && !target.editable) {
      e.preventDefault()
      e.stopPropagation()
      arm.setPicking(null)
      return
    }
    const order = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-cue-nav]') ?? [])].map((el) => el.dataset.cueNav!)
    const r = directorKey(
      { armed: arm.armed, cursor },
      { key: e.key, repeat: e.repeat, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, ...target },
      { mode, now: Date.now(), rows, order: [...new Set(order)], marks: cues, filter: query, locked: arm.pending !== null || arm.cooling },
    )
    if (!r.handled) return
    e.preventDefault()
    e.stopPropagation()
    swallowUp.current = e.key === ' '
    if (r.state.armed !== arm.armed) arm.apply(r.state.armed)
    if (r.state.cursor !== cursor) setCursor(r.state.cursor)
    switch (r.effect.kind) {
      case 'fire':
        void arm.fire(r.effect.id, r.effect.subject, r.effect.value)
        // The picker that held focus unmounts with the press.
        requestAnimationFrame(reclaim)
        break
      case 'pick':
        arm.setPicking(r.effect.id)
        scrollTo(r.effect.id)
        break
      case 'nothing-to-press':
        setFlash(true)
        break
      case 'clear-filter':
        setQuery('')
        break
      case 'focus-filter':
        filterRef.current?.focus()
        break
      case 'scroll':
        scrollTo(r.effect.id)
        break
      default:
        break
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => handleKey(e)
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' && swallowUp.current) e.preventDefault()
    swallowUp.current = false
  }
  // Focus that fell to <body> (a pressed button unmounted or turned
  // disabled) never strands the keys: with nothing focused, they reach the
  // page from the document. A field or another control that has focus is
  // never second-guessed.
  const latestKey = useRef(handleKey)
  useEffect(() => {
    latestKey.current = handleKey
  })
  useEffect(() => {
    const onDocKey = (e: globalThis.KeyboardEvent) => {
      const root = rootRef.current
      if (root === null || !root.isConnected || e.defaultPrevented) return
      if (e.target instanceof Node && root.contains(e.target)) return
      if (!focusIsNowhere(root)) return
      latestKey.current(e)
      if (e.defaultPrevented) root.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', onDocKey)
    return () => document.removeEventListener('keydown', onDocKey)
  }, [])
  // A mouse press on a button hands the keys back to the page, so a later
  // Space never re-clicks it (keyboard activation keeps its focus).
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (e.detail === 0 || !(e.target instanceof Element)) return
    if (e.target.closest('button, summary, [role="button"]') === null) return
    rootRef.current?.focus({ preventScroll: true })
  }

  const ctx: DirectorCtx = { rows, acts, focus, actOf, arm, awards, cursor, setCursor, mode, showAct }
  const hasCues = rows.length > 0
  const watching = mode === DirectorMode.Watching

  return (
    <DirectorContext.Provider value={ctx}>
      <div
        ref={rootRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onClickCapture={onClickCapture}
        className="@container h-full overflow-auto outline-none"
        data-director-root=""
        data-testid="director"
        data-mode={mode}
      >
        <div className="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Director</div>
              <span className="ml-auto" />
              <ModeToggle mode={mode} setMode={setMode} />
            </div>
            <NightBar />
          </div>
          <div className="@4xl:hidden">
            <GlanceStrip watching={watching} />
          </div>
          {watching ? (
            <div className="flex flex-col gap-3">
              {hasCues && <NowCard flash={flash} />}
              <div className="hidden @4xl:block">
                <GlanceColumn watching />
              </div>
              {hasCues && (
                <details className="rounded-xl border border-zinc-800" data-testid="director-folded">
                  <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-200">
                    On hand · Running order
                  </summary>
                  <div className="flex flex-col gap-3 p-3 pt-0">
                    <OnHand />
                    <RunningOrder ref={filterRef} query={query} setQuery={setQuery} toggled={toggled} setToggled={setToggled} all={all} setAll={setAll} />
                  </div>
                </details>
              )}
              <DirectorTools defaultOpen={!hasCues} />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-[minmax(0,1fr)_300px] @6xl:grid-cols-[minmax(0,56rem)_340px]">
              <div className="flex min-w-0 flex-col gap-4">
                {hasCues && <NowCard flash={flash} />}
                {hasCues && query.trim() === '' && <OnHand />}
                {hasCues && <RunningOrder ref={filterRef} query={query} setQuery={setQuery} toggled={toggled} setToggled={setToggled} all={all} setAll={setAll} />}
                <DirectorTools defaultOpen={!hasCues} />
              </div>
              <aside className="hidden self-start @4xl:sticky @4xl:top-0 @4xl:block @4xl:max-h-[calc(100vh-9rem)] @4xl:overflow-auto">
                <GlanceColumn watching={false} />
              </aside>
            </div>
          )}
        </div>
      </div>
    </DirectorContext.Provider>
  )
}
