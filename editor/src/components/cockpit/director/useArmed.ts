//! Arm, then fire (wave 10, spec §4.3): the Director page's one arm model,
//! core's `tapCue` / `armFor` / `armStillValid` (the phone's too). A first
//! click arms; a second one ≥ 300 ms and < 4 s later fires. An arm is bound
//! to the cue state it was made against and dropped — "Cues moved: …
//! Re-arm." — once another director or the story fires; it also drops on a
//! window blur, a hidden tab and after 4 s. One press is in flight at a
//! time (8 s at most: a hung one fails and unlocks; a landed one holds the
//! lock until the snapshot carrying it arrives, 3 s at most, so the next
//! arm binds past it; a press refused as moved holds it the same way until
//! the snapshot carrying the press that beat it), and NEXT cools down for
//! 1 s after one. What came back (taken /
//! not taken / failed) is the NOW card's banner and, for a refusal, the
//! Needs you item.

import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CockpitContext, useCockpit, type FireResult } from '@/store/cockpit'
import {
  ARM_MS,
  armFor as coreArmFor,
  armStillValid,
  cueValueArgs,
  tapCue,
  type Armed,
  type CueMarks,
  type CueRow,
} from '@loom/core/cue-sheet'
import { lastSeq, type RefusedPress } from './glance'
import { NO_ANSWER, PRESS_TIMEOUT_MS, SETTLE_MS, movedCue, movedPressedCue, ownMove, pressSettled, settleTarget, within } from './moves'
import { failureText } from '@/lib/press-failure'

/** NEXT's cooldown after a press. */
export const NEXT_COOLDOWN_MS = 1000

export const PressKind = {
  Taken: 'taken',
  Refused: 'refused',
  Failed: 'failed',
} as const
export type PressKind = (typeof PressKind)[keyof typeof PressKind]

export interface PressResult {
  kind: PressKind
  id: string
  /** The cue as the sheet shows it. */
  cue: string
  at: number
  /** The newest message seq when the press was sent (its reason follows). */
  seq: number
  message?: string
}

/** How a row reads in a banner: its code (else its number) and title. */
export function cueLabel(row: Pick<CueRow, 'code' | 'n' | 'title'>): string {
  return `${row.code ?? '#' + row.n} ${row.title}`
}

export interface ArmedApi {
  armed: Armed | null
  /** The subject cue whose who? picker is open. */
  picking: string | null
  setPicking(id: string | null): void
  /** A click on a cue: arm it, open its picker, fire it, or (inside the
   *  dead time) nothing. */
  tap(row: CueRow): void
  /** The picker answered: arm the subject cue for that person. */
  armFor(row: CueRow, who: string, value?: string): void
  /** Set the arm straight (the key reducer's new state). */
  apply(next: Armed | null): void
  fire(id: string, subject: string | null, value?: string, presses?: number): Promise<void>
  disarm(): void
  /** The cue in flight, if any. */
  pending: string | null
  /** NEXT is cooling down after a press. */
  cooling: boolean
  result: PressResult | null
  /** This console's newest refused press (Needs you keeps it 60 s). */
  refused: RefusedPress | null
  /** "Cues moved: … Re-arm." — an arm dropped because the state moved. */
  stale: string | null
  /** When `cues.last` last moved by someone else: who did it. */
  moved: { by: 'director' | 'story' | null; at: number } | null
}

interface PressOutcome {
  result: PressResult | null
  refused: RefusedPress | null
}
const NO_OUTCOME: PressOutcome = { result: null, refused: null }

/** Each cockpit's last press outcome, kept across the page's unmounts (a
 *  tab switch unmounts the Director) and read outside it (the Inspector
 *  tray's glance column says Needs you too). */
const outcomes = new WeakMap<object, PressOutcome>()
const listeners = new WeakMap<object, Set<() => void>>()

function setPressOutcome(store: object, next: PressOutcome): void {
  outcomes.set(store, next)
  for (const l of listeners.get(store) ?? []) l()
}

/** A cockpit's last press outcome, live (any component under its provider). */
export function usePressOutcome(store: object): PressOutcome {
  return useSyncExternalStore(
    useCallback(
      (cb: () => void) => {
        let set = listeners.get(store)
        if (set === undefined) listeners.set(store, (set = new Set()))
        set.add(cb)
        return () => set.delete(cb)
      },
      [store],
    ),
    () => outcomes.get(store) ?? NO_OUTCOME,
    // The same read on a server render (the glance's SSR tests).
    () => outcomes.get(store) ?? NO_OUTCOME,
  )
}

export function useArmed(rows: CueRow[], marks: CueMarks): ArmedApi {
  const fireSignal = useCockpit((s) => s.fireSignal)
  // Read at press time, never subscribed: a chat line in any room must not
  // re-render the whole Director page.
  const store = useContext(CockpitContext)
  const [armed, setArmed] = useState<Armed | null>(null)
  const [picking, setPicking] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [coolUntil, setCoolUntil] = useState(0)
  // The last press's outcome outlives the page: following the refusal's
  // own link to Chat (or any glance link) and coming back keeps the banner
  // and the Needs you item for their full time.
  const { result, refused } = usePressOutcome(store)
  const [stale, setStale] = useState<string | null>(null)
  const [moved, setMoved] = useState<ArmedApi['moved']>(null)

  const ownPress = useCockpit((s) => s.ownPress)
  const latest = useRef({ rows, marks, armed, pending, ownPress })
  useEffect(() => {
    latest.current = { rows, marks, armed, pending, ownPress }
  })

  const disarm = useCallback(() => {
    setArmed(null)
  }, [])

  // A landed press keeps the lock until the snapshot carrying it arrives
  // (else the next arm binds to a count from before it, and this console's
  // own 🍾 reads as "Cues moved"), or `SETTLE_MS` pass.
  const settle = useRef<{ presses: number; timer: ReturnType<typeof setTimeout> } | null>(null)
  const unlock = useCallback(() => {
    if (settle.current !== null) clearTimeout(settle.current.timer)
    settle.current = null
    latest.current.pending = null
    setPending(null)
  }, [])
  useEffect(() => () => {
    if (settle.current !== null) clearTimeout(settle.current.timer)
  }, [])

  // The arm dies after ARM_MS.
  useEffect(() => {
    if (armed === null) return
    const t = setTimeout(() => setArmed((a) => (a === armed ? null : a)), Math.max(0, armed.at + ARM_MS - Date.now()))
    return () => clearTimeout(t)
  }, [armed])

  // A blur or a hidden tab drops the arm.
  useEffect(() => {
    const onBlur = () => setArmed(null)
    const onVisible = () => {
      if (document.visibilityState === 'hidden') setArmed(null)
    }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // The cue state moved: a stale arm drops (naming the cue that moved it),
  // and a LAST this console did not press — from any surface — flashes who
  // moved it.
  const prevMarks = useRef<CueMarks>(marks)
  const firedCount = marks.fired.length
  useEffect(() => {
    const { armed: a, rows: rs, marks: m, ownPress } = latest.current
    const now = Date.now()
    const moved = movedCue(prevMarks.current, m)
    const lastMoved = m.last !== prevMarks.current.last
    prevMarks.current = m
    if (settle.current !== null && pressSettled(settle.current.presses, m.presses)) unlock()
    if (a !== null && !armStillValid(a, m, now)) {
      setArmed(null)
      const fresh = rs.find((r) => r.id === moved)
      setStale(`Cues moved: ${fresh !== undefined ? cueLabel(fresh) : 'a cue'} just fired. Re-arm.`)
    }
    if (lastMoved && m.last !== null && !ownMove(ownPress, m.last, now)) {
      setMoved({ by: m.lastBy === 'story' ? 'story' : 'director', at: now })
    }
  }, [marks.last, firedCount, marks.presses, unlock])

  // Transient notes clear themselves.
  useEffect(() => {
    if (stale === null) return
    const t = setTimeout(() => setStale(null), ARM_MS)
    return () => clearTimeout(t)
  }, [stale])
  useEffect(() => {
    if (moved === null) return
    const t = setTimeout(() => setMoved(null), 4000)
    return () => clearTimeout(t)
  }, [moved])
  useEffect(() => {
    if (coolUntil === 0) return
    const t = setTimeout(() => setCoolUntil(0), Math.max(0, coolUntil - Date.now()))
    return () => clearTimeout(t)
  }, [coolUntil])

  const fire = useCallback(
    async (id: string, subject: string | null, value?: string, presses?: number) => {
      if (latest.current.pending !== null) return
      const row = latest.current.rows.find((r) => r.id === id)
      if (row === undefined) return
      const seq = lastSeq(store.getState().messages)
      const cue = cueLabel(row)
      setArmed(null)
      setPicking(null)
      setStale(null)
      setPending(id)
      latest.current.pending = id
      const args = subject !== null ? cueValueArgs(value ?? '') : null
      // A press that hangs (venue Wi-Fi) never locks every cue for minutes.
      const res = await within(fireSignal(id, subject ?? undefined, args, null, presses), PRESS_TIMEOUT_MS, (): FireResult => ({ error: NO_ANSWER }))
      const at = Date.now()
      if (res.moved === true) {
        // Another director's press landed between the arm and this one:
        // the server fired nothing. Say so, like a stale arm — naming the
        // server's newest press (the marks are behind by definition).
        const { marks: m, rows: rs } = latest.current
        const pressedId = movedPressedCue(res.pressed, m.pressed)
        const fresh = rs.find((r) => r.id === pressedId)
        setStale(`Cues moved: ${fresh !== undefined ? cueLabel(fresh) : 'another press'} landed first. Nothing fired — re-arm.`)
        // Hold the lock until the marks show the press that beat this one
        // (the 409's own count): a re-arm on the lagging marks would be
        // refused as moved again, or dropped the moment that frame lands.
        const want = settleTarget(res, m.presses)
        if (want !== null) {
          settle.current = { presses: want, timer: setTimeout(unlock, SETTLE_MS) }
          return
        }
        latest.current.pending = null
        setPending(null)
        return
      }
      const was = outcomes.get(store) ?? NO_OUTCOME
      const next: PressOutcome =
        res.error !== undefined
          ? { ...was, result: { kind: PressKind.Failed, id, cue, at, seq, message: failureText(res.error) } }
          : res.refused === true
            ? { result: { kind: PressKind.Refused, id, cue, at, seq }, refused: { cue, at, seq } }
            : { ...was, result: { kind: PressKind.Taken, id, cue, at, seq } }
      setPressOutcome(store, next)
      if (row.next) setCoolUntil(at + NEXT_COOLDOWN_MS)
      const want = settleTarget(res, latest.current.marks.presses)
      if (want !== null) {
        settle.current = { presses: want, timer: setTimeout(unlock, SETTLE_MS) }
        return
      }
      latest.current.pending = null
      setPending(null)
    },
    [fireSignal, store, unlock],
  )

  const cooling = coolUntil !== 0

  const tap = useCallback(
    (row: CueRow) => {
      if (latest.current.pending !== null) return
      if (cooling && row.next) return
      const t = tapCue(latest.current.armed, row, Date.now(), latest.current.marks)
      switch (t.kind) {
        case 'arm':
          setStale(null)
          setPicking(null)
          setArmed(t.armed)
          break
        case 'pick':
          setArmed(null)
          setPicking(row.id)
          break
        case 'fire':
          void fire(t.id, t.subject, t.value, t.presses)
          break
        default:
          break
      }
    },
    [cooling, fire],
  )

  const armFor = useCallback((row: CueRow, who: string, value?: string) => {
    if (who === '') return
    setStale(null)
    setArmed(coreArmFor(row.id, who, Date.now(), value, latest.current.marks))
  }, [])

  return {
    armed,
    picking,
    setPicking,
    tap,
    armFor,
    apply: setArmed,
    fire,
    disarm,
    pending,
    cooling,
    result,
    refused,
    stale,
    moved,
  }
}
