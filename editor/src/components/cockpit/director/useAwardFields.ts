//! The award rows' fields and the K-26 recap (W-24), moved unchanged from
//! the old cue sheet: who each subject cue names and its optional value
//! box, the recap's suggestions (fetched once `Night.ended` is set and on
//! ↻, a server run only — the local backend has no recap route), and Copy
//! recap for the `cast:Trabolta` paste. Fills only empty fields, so a
//! picker the director cleared stays clear until the next ↻.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RunBackend, useCockpit } from '@/store/cockpit'
import { modApi } from '@/lib/api'
import type { CueRow } from '@loom/core/cue-sheet'
import {
  awardSuggestion,
  fillAwards,
  nightEnded,
  pickWinner,
  type AwardFields,
  type AwardSuggestion,
  type RecapWire,
} from '../award-suggest'

export interface AwardFieldsApi {
  winners: Record<string, string>
  values: Record<string, string>
  /** A director's pick (clears a value box still holding the guess). */
  pick(id: string, who: string): void
  setValue(id: string, value: string): void
  suggestions: Record<string, AwardSuggestion | null>
  /** A server run with subject cues: the ↻ / Copy recap tools show. */
  recapTools: boolean
  recapNote: string | null
  loadRecap(): Promise<RecapWire | null>
  copyRecap(): Promise<void>
}

export function useAwardFields(rows: CueRow[]): AwardFieldsApi {
  const world = useCockpit((s) => s.world)
  const roster = useCockpit((s) => s.roster)
  const run = useCockpit((s) => s.run)
  const [fields, setFields] = useState<AwardFields>({ winners: {}, values: {}, auto: {} })
  const [recap, setRecap] = useState<RecapWire | null>(null)
  const [recapNote, setRecapNote] = useState<string | null>(null)

  const eventId = run?.backend === RunBackend.Server ? run.eventId : null
  const ended = nightEnded(world)
  const hasAwards = rows.some((r) => r.subject)
  // Fill on each fetch only (not on every snapshot).
  const latest = useRef({ rows, roster })
  useEffect(() => {
    latest.current = { rows, roster }
  })
  const applyRecap = useCallback((r: RecapWire) => {
    setRecap(r)
    setRecapNote(null)
    const now: Record<string, AwardSuggestion | null> = {}
    for (const row of latest.current.rows) if (row.subject) now[row.id] = awardSuggestion(row.id, r)
    const ids = new Set(latest.current.roster.map((p) => p.id))
    setFields((f) => fillAwards(f, now, ids))
  }, [])
  const recapFailed = (e: unknown) => setRecapNote(`recap: ${e instanceof Error ? e.message : String(e)}`)
  const loadRecap = async (): Promise<RecapWire | null> => {
    if (eventId === null) return null
    try {
      const r = await modApi.recap(eventId)
      applyRecap(r)
      return r
    } catch (e) {
      recapFailed(e)
      return null
    }
  }
  useEffect(() => {
    if (!ended || !hasAwards || eventId === null) return
    let live = true
    modApi.recap(eventId).then(
      (r) => live && applyRecap(r),
      (e: unknown) => live && recapFailed(e),
    )
    return () => {
      live = false
    }
  }, [ended, hasAwards, eventId, applyRecap])
  const suggestions = useMemo(() => {
    const out: Record<string, AwardSuggestion | null> = {}
    for (const r of rows) if (r.subject) out[r.id] = awardSuggestion(r.id, recap)
    return out
  }, [rows, recap])
  const copyRecap = async () => {
    const r = recap ?? (await loadRecap())
    if (r === null) return
    try {
      await navigator.clipboard.writeText(r.text)
      setRecapNote('recap copied')
    } catch {
      setRecapNote('copy failed — open Recap ↗ on the Run page')
    }
  }

  return {
    winners: fields.winners,
    values: fields.values,
    pick: (id, who) => setFields((f) => pickWinner(f, id, who)),
    setValue: (id, value) => setFields((f) => ({ ...f, values: { ...f.values, [id]: value } })),
    suggestions,
    recapTools: eventId !== null && hasAwards,
    recapNote,
    loadRecap,
    copyRecap,
  }
}
