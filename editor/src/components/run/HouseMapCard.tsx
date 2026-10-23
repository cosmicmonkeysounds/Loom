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
//!
//! Wave 11: the **shared King** under the variants (`KingRow`) — his one
//! health bar for the whole night, off the lean screen state polled every
//! few seconds, with **Set…** and **👑 Restore** (`POST /api/mod/spatial/king
//! {hp}`, journaled `by` you). Rules + wire parsing in pure `lib/king.ts`.
//!
//! Wave 20 (D8): the **💡 row** (`LightsRow`) — the house lights at a glance
//! off `GET /api/mod/lights` (no long poll; every 15 s, every 5 s while
//! pairing): *💡 lights module online · N fixtures* (or *offline*), *pairing
//! … s* while Zigbee joining is open, and the problems / warnings counts.
//! Placing fixtures, looks and *Pair new device* live in the map editor's
//! 💡 Lights tab. Rules + wire parsing in pure `lib/lights-status.ts`.

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useCockpit } from '@/store/cockpit'
import { confirmAction, promptText } from '@/store/dialog'
import { ApiError, lightsApi, mapApi } from '@/lib/api'
import { KingReadOrder, kingConfirm, kingFill, kingHpText, kingStatusLine, parseKingHp, type KingView } from '@/lib/king'
import {
  LIGHTS_PAIR_POLL_MS,
  LIGHTS_POLL_MS,
  lightsLine,
  lightsReadFor,
  lightsShown,
  moduleTitle,
  pairDeadline,
  pairText,
  problemsText,
  type LightsRead,
  type LightsStatus,
  type PairClock,
} from '@/lib/lights-status'
import { canSwitchTo, freshTarget, switchBase, switchConfirm, variantLabel, variantTitle, type MapVariant, type MapVariantsResponse } from '@/lib/map-variants'

/** How often the card re-reads the King (a hit in the tent shows within it). */
const KING_POLL_MS = 4000

/** The King off the lean screen state, re-read every `KING_POLL_MS` while
 *  the card is mounted; null = no King (or an older server). `set` adopts a
 *  route's answer at once, and a poll begun before it is dropped
 *  (`KingReadOrder`). */
function useKing(eventId: string | null): [KingView | null, (k: KingView | null) => void] {
  const [king, setKing] = useState<KingView | null>(null)
  const order = useRef(new KingReadOrder())
  const adopt = useCallback((k: KingView | null) => {
    order.current.adopt()
    setKing(k)
  }, [])
  useEffect(() => {
    if (eventId === null) return
    let cancelled = false
    const read = async () => {
      const ticket = order.current.begin()
      try {
        const k = await mapApi.king(eventId)
        if (!cancelled && order.current.fresh(ticket)) setKing(k)
      } catch {
        // keep the last reading; the next poll retries
      }
    }
    void read()
    const t = setInterval(() => void read(), KING_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [eventId])
  return [king, adopt]
}

/** The house lights off `GET /api/mod/lights`, re-read every
 *  `LIGHTS_POLL_MS` (`LIGHTS_PAIR_POLL_MS` while pairing is open); null = no
 *  lights route (an older server) or nothing read yet. `deadline`: when an
 *  open pairing closes, on this editor's clock (`pairDeadline`). */
function useLights(eventId: string | null): { status: LightsStatus | null; deadline: PairClock | null } {
  const [read, setRead] = useState<LightsRead>({ eventId: null, status: null, deadline: null })
  const shown = lightsReadFor(read, eventId)
  const pairing = shown.deadline !== null
  useEffect(() => {
    if (eventId === null) return
    let cancelled = false
    const load = async () => {
      try {
        const status = await lightsApi.status(eventId)
        if (!cancelled) setRead({ eventId, status, deadline: status === null ? null : pairDeadline(status, Date.now()) })
      } catch {
        // keep the last reading; the next poll retries
      }
    }
    void load()
    const t = setInterval(() => void load(), pairing ? LIGHTS_PAIR_POLL_MS : LIGHTS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [eventId, pairing])
  return shown
}

/** A 1 s clock while `on` (the pairing countdown). */
function useSecondTick(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}

export function LightsRow({ status, deadline }: { status: LightsStatus; deadline: PairClock | null }) {
  const now = useSecondTick(deadline !== null && deadline.closesAt !== null)
  const pairing = pairText(deadline, now)
  const issues = problemsText(status)
  const online = status.module?.online === true
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-2 text-xs" data-testid="run-house-lights">
      <span className={clsx(online ? 'text-zinc-300' : 'text-amber-300')} title={moduleTitle(status)} data-testid="run-house-lights-line" data-online={online ? 'true' : 'false'}>
        {lightsLine(status)}
      </span>
      {pairing !== null && (
        <span className="rounded bg-sky-950/60 px-1 text-[11px] tabular-nums text-sky-200" title="Zigbee joining is open: put the new bulb in pairing mode now" data-testid="run-house-lights-pair">
          {pairing}
        </span>
      )}
      {issues !== null && (
        <span
          className={clsx('rounded px-1 text-[11px]', status.problems.length > 0 ? 'bg-red-950/70 text-red-200' : 'bg-amber-950/60 text-amber-200')}
          title={[...status.problems, ...status.warnings].join('\n')}
          data-testid="run-house-lights-issues"
        >
          {issues}
        </span>
      )}
    </div>
  )
}

function KingRow({ eventId, king, onKing }: { eventId: string; king: KingView; onKing: (k: KingView | null) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const apply = async (hp: number) => {
    const ok = await confirmAction({ ...kingConfirm(king, hp), confirmLabel: hp === king.max ? '👑 Restore' : `Set to ${hp}`, danger: hp < king.hp })
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      const k = await mapApi.setKing(eventId, hp)
      // The answer carries no `armed`: keep the last reading's.
      if (k !== null) onKing({ ...k, armed: king.armed })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const setTo = async () => {
    const text = await promptText({ title: 'Set the King’s health', body: `A whole number from 0 to ${king.max}. Every game and the chess terminal follow.`, defaultValue: String(king.hp), confirmLabel: 'Next…' })
    if (text === null) return
    const hp = parseKingHp(text, king.max)
    if (hp === null) {
      setError(`Not a health from 0 to ${king.max}: “${text}”.`)
      return
    }
    if (hp !== king.hp) await apply(hp)
  }
  const fill = kingFill(king)
  return (
    <div className="mt-2 border-t border-zinc-800 pt-2" data-testid="run-house-king">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-300">{king.fallen ? '🧎 The King' : '♚ The King'}</span>
        <span
          className="relative h-2.5 w-32 overflow-hidden rounded-sm border border-zinc-600 bg-zinc-900"
          role="meter"
          aria-label="The King's health"
          aria-valuemin={0}
          aria-valuemax={king.max}
          aria-valuenow={king.hp}
        >
          <span className={clsx('absolute inset-y-0 left-0', fill > 0.5 ? 'bg-emerald-500' : fill > 0.2 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${fill * 100}%` }} />
        </span>
        <span className="tabular-nums text-zinc-100" data-testid="run-house-king-hp">
          {kingHpText(king)}
        </span>
        {king.armed === false && <span className="text-[11px] text-zinc-500" title="The prop's armed path is off: a checkmate gives no code now">not armed</span>}
        <span className="ml-auto inline-flex gap-1">
          <button type="button" className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-40" disabled={busy} onClick={() => void setTo()} data-testid="run-house-king-set">
            Set…
          </button>
          <button
            type="button"
            className="rounded border border-amber-700/60 px-2 py-0.5 text-[11px] text-amber-200 hover:bg-amber-950 disabled:opacity-40"
            disabled={busy || king.hp === king.max}
            title={king.hp === king.max ? 'He is at full health' : `Back to ${king.max}`}
            onClick={() => void apply(king.max)}
            data-testid="run-house-king-restore"
          >
            👑 Restore
          </button>
        </span>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">{kingStatusLine(king)}</p>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  )
}

export function HouseMapCard() {
  const eventId = useCockpit((s) => s.run?.eventId ?? null)
  const [king, setKingView] = useKing(eventId)
  const lights = useLights(eventId)
  const showLights = lightsShown(lights.status)
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

  if (eventId === null || ((data === null || data.variants.length === 0) && error === null && king === null && !showLights)) return null

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
      {king !== null && <KingRow eventId={eventId} king={king} onKing={setKingView} />}
      {showLights && <LightsRow status={lights.status!} deadline={lights.deadline} />}
      {variants.length === 1 && <p className="text-[11px] text-zinc-600">This event has one map — add a house.&lt;variant&gt;.json to the project for a second.</p>}
      {note && <p className="text-[11px] text-zinc-400" data-testid="run-house-map-note">{note}</p>}
      {error && <p className="text-[11px] text-red-400" data-testid="run-house-map-error">{error}</p>}
    </section>
  )
}
