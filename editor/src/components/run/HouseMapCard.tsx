//! The House map card on the Run page (wave 5 E9): the tent ⇄ shed switch
//! without a moderator-passcode device on `/reinstall/map`. One button per
//! whole-map variant (`GET /api/mod/spatial/variants`), the playing one
//! highlighted, an invalid one disabled with its problems as the tooltip.
//! A switch always asks first — it moves every tablet, headset and wall
//! terminal at once — and warns when this event's map edits would be
//! dropped (`edited`); then `POST /api/mod/spatial/variant {file, base}`
//! with the re-read list's map version, so a switch or save another
//! director made while the confirm was open is refused (409). Server
//! runs only; a story with no house map shows nothing. Labels in pure
//! `lib/map-variants.ts`.

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useCockpit } from '@/store/cockpit'
import { confirmAction } from '@/store/dialog'
import { ApiError, mapApi } from '@/lib/api'
import { canSwitchTo, freshTarget, switchBase, switchConfirm, variantLabel, variantTitle, type MapVariant, type MapVariantsResponse } from '@/lib/map-variants'

export function HouseMapCard() {
  const eventId = useCockpit((s) => s.run?.eventId ?? null)
  const [data, setData] = useState<MapVariantsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Bumped to re-fetch (↻, after a switch). RunPage keys the card on the
  // event id, so a new event starts it fresh.
  const [tick, setTick] = useState(0)
  const reload = () => setTick((n) => n + 1)

  useEffect(() => {
    if (eventId === null) return
    let cancelled = false
    void (async () => {
      try {
        const r = await mapApi.variants(eventId)
        if (cancelled) return
        setData(r)
        setError(null)
      } catch (e) {
        if (cancelled) return
        // An older server without the route: nothing to show.
        if (e instanceof ApiError && e.status === 404) setData(null)
        else setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [eventId, tick])

  if (eventId === null || ((data === null || data.variants.length === 0) && error === null)) return null

  const switchTo = async (v: MapVariant) => {
    if (data === null || busy || !canSwitchTo(v)) return
    // Re-read the list first: the confirm's "drops this event's edits"
    // warning must reflect a save made since the card loaded.
    let now = data
    try {
      now = await mapApi.variants(eventId)
      setData(now)
    } catch {
      // keep the list we have; the switch itself reports any failure
    }
    const target = freshTarget(v.file, now)
    if (target === null) {
      setNote(`${variantLabel(v, now.variants)} can't be switched to now (already playing, or no longer valid).`)
      return
    }
    const ok = await confirmAction({ ...switchConfirm(target, now), confirmLabel: `Switch to ${variantLabel(target, now.variants)}`, danger: true })
    if (!ok) return
    setBusy(true)
    setNote(null)
    try {
      const r = await mapApi.switchVariant(eventId, target.file, switchBase(now))
      const parts = [`Now playing ${variantLabel(target, now.variants)}.`]
      if (r.dropped) parts.push('The event’s map edits were dropped.')
      if (r.warnings.length > 0) parts.push(`⚠ ${r.warnings.join(' · ')}`)
      setNote(parts.join(' '))
      setError(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setNote('The map changed while you were confirming (another director switched or saved). Nothing was switched — check the buttons and press again.')
        setError(null)
      } else setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      reload()
    }
  }

  const variants = data?.variants ?? []
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-3" data-testid="run-house-map">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">House map</span>
        {variants.length > 0 && (
          <span className="inline-flex overflow-hidden rounded border border-zinc-700 text-xs" role="group" aria-label="House map variant">
            {variants.map((v) => (
              <button
                key={v.file}
                type="button"
                className={clsx('px-2 py-0.5 disabled:cursor-not-allowed', v.active ? 'bg-indigo-600 text-white' : v.ok ? 'text-zinc-300 hover:bg-zinc-800' : 'text-zinc-600 line-through')}
                aria-pressed={v.active}
                disabled={busy || (!v.active && !v.ok)}
                title={variantTitle(v)}
                onClick={() => void switchTo(v)}
                data-testid={`run-house-map-${v.file}`}
              >
                {variantLabel(v, variants)}
              </button>
            ))}
          </span>
        )}
        {data?.edited && (
          <span className="text-[11px] text-amber-400" title="A director saved map edits to this event; switching drops them" data-testid="run-house-map-edited">
            ✎ edited on this event
          </span>
        )}
        <button type="button" className="ml-auto text-[11px] text-zinc-500 hover:text-zinc-200" onClick={reload} title="Reload the variant list">
          ↻
        </button>
      </div>
      {variants.length === 1 && <p className="text-[11px] text-zinc-600">This event has one map — add a house.&lt;variant&gt;.json to the project for a second.</p>}
      {note && <p className="text-[11px] text-zinc-400" data-testid="run-house-map-note">{note}</p>}
      {error && <p className="text-[11px] text-red-400" data-testid="run-house-map-error">{error}</p>}
    </section>
  )
}
