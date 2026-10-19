//! The Director page's clocks: a wall-clock tick while something counts
//! down, and the countdowns read off the story clock (`storyNow`, which
//! stands still while the run is paused).

import { useEffect, useState } from 'react'
import { CockpitPhase, storyNow, useCockpit, type CountdownSummary } from '@/store/cockpit'
import { countdownLeft } from '@loom/core/cue-sheet'

/** `Date.now()`, re-read every `ms` while `active` — and at once when it
 *  turns active, so a clock that sat idle never reads its mount time. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => (active ? startTick(setNow, ms) : undefined), [active, ms])
  return now
}

/** The tick behind `useNow`: reads the clock now, then every `ms`; returns
 *  the stop. */
export function startTick(setNow: (ms: number) => void, ms: number): () => void {
  setNow(Date.now())
  const t = setInterval(() => setNow(Date.now()), ms)
  return () => clearInterval(t)
}

export interface LiveCountdown {
  label: string
  path: string
  /** Whole seconds left. */
  left: number
}

/** `m:ss` (or `h:mm:ss`). */
export function formatLeft(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

/** The live countdowns, soonest first, ticking. */
export function useCountdowns(): LiveCountdown[] {
  const countdowns = useCockpit((s) => s.countdowns)
  const clock = useCockpit((s) => s.storyClock)
  const running = useCockpit((s) => s.phase === CockpitPhase.Open)
  const wall = useNow(countdowns.length > 0 && running)
  return liveCountdowns(countdowns, storyNow(clock, running, wall))
}

export function liveCountdowns(countdowns: readonly CountdownSummary[], nowMs: number | null): LiveCountdown[] {
  const out: LiveCountdown[] = []
  for (const c of countdowns) {
    const left = countdownLeft(c.endsAt, nowMs)
    if (left !== null) out.push({ label: c.label, path: c.path, left })
  }
  return out.sort((a, b) => a.left - b.left)
}
