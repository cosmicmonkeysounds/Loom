//! The Stage — the director's floor plan. One card per LOCATION with the
//! guests standing in it as live chips (presence · story position ·
//! decision/captured/restricted badges), an "Elsewhere" card for the unplaced, and a
//! cast strip showing which performers are actually signed in. Everything
//! clicks through to the Inspector, so "who is that and what are they
//! doing" is one glance + one click from any cockpit page.

import { useState } from 'react'
import clsx from 'clsx'
import { CockpitTab, SelectionKind, useCockpit, type CastSummary, type RosterRow } from '@/store/cockpit'
import { useGraph } from '@/store/graph'
import { openContextMenu } from '@/store/context-menu'
import { FactionPill } from './ui'
import { PartPresence, castPresence, isSignedIn, partPresenceTitle, performerParts } from './parts'
import { publicFaction } from './format'
import { useInspect } from './inspect'
import { useGuestMenu } from './guest-menu'

/** DataTransfer type for a guest chip being dragged between locations. */
const DRAG_GUEST = 'application/x-loom-guest'

/** A guest as a live chip: presence · name · story position · badges. */
function GuestChip({ r }: { r: RosterRow }) {
  const choices = useCockpit((s) => s.choices)
  const setTab = useCockpit((s) => s.setTab)
  // Under a lens you are a participant: no god-view secrets, no moving people.
  const locked = useCockpit((s) => s.lens !== null)
  const inspect = useInspect()
  const menu = useGuestMenu()
  const hasChoice = (choices[r.id]?.length ?? 0) > 0

  const showBeat = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!r.beat) return
    setTab(CockpitTab.Story)
    useGraph.getState().reveal(r.beat)
  }

  return (
    <button
      onClick={() => inspect({ kind: SelectionKind.Guest, id: r.id })}
      onContextMenu={(e) => menu(r, e)}
      draggable={!locked}
      onDragStart={(e) => {
        if (locked) return
        e.dataTransfer.setData(DRAG_GUEST, r.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className={clsx(
        'flex w-full items-center gap-2 rounded-lg border border-zinc-800 px-2 py-1.5 text-left hover:border-zinc-600 hover:bg-zinc-900/60',
        locked ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
      )}
      data-testid={`stage-guest-${r.id}`}
      title={`${r.name} · ${r.score} pts${r.beat ? ` · in ${r.beat}` : ''}${locked ? '' : ' — drag onto a location to move them'}`}
    >
      {r.online !== undefined && (
        <span
          className={clsx('h-2 w-2 shrink-0 rounded-full', r.online ? 'bg-emerald-400' : 'border border-zinc-600')}
          title={r.online ? 'connected now' : 'not connected'}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-zinc-200">{r.name}</span>
        {r.beat ? (
          <span
            onClick={showBeat}
            title={`Story position: ${r.beat} — click to show on the map`}
            className="block truncate text-[10px] text-amber-300/80 hover:text-amber-200"
          >
            ⤷ {r.beat}
          </span>
        ) : (
          <span className="block truncate text-[10px] text-zinc-600">no beat yet</span>
        )}
      </span>
      {hasChoice && (
        <span title="waiting on a decision" className="shrink-0 text-[11px] text-indigo-300">
          ⏳
        </span>
      )}
      {r.captured && (
        <span title="captured" className="shrink-0 text-[11px] text-red-400">
          🔒
        </span>
      )}
      {r.restricted && (
        <span title="restricted" className="shrink-0 text-[11px] text-red-400">
          ⛔
        </span>
      )}
      <FactionPill faction={locked ? r.faction : (r.trueFaction ?? r.faction)} />
    </button>
  )
}

/** One location card with its occupants. A real location (`id !== null`)
 *  is a drop target: dropping a guest chip journals a `location` write —
 *  the same `arrive` mutation as walking there, so enters/exits hooks fire. */
function LocationCard({
  id,
  label,
  prison,
  guests,
}: {
  id: string | null
  label: string
  prison?: boolean
  guests: RosterRow[]
}) {
  const setStat = useCockpit((s) => s.setStat)
  const inspect = useInspect()
  const [over, setOver] = useState(false)
  const droppable = id !== null
  return (
    <section
      className={clsx(
        'flex min-h-28 flex-col rounded-xl border bg-zinc-950 p-2 transition-colors',
        over ? 'border-indigo-400 bg-indigo-950/20' : 'border-zinc-800',
      )}
      onDragOver={(e) => {
        if (!droppable || !e.dataTransfer.types.includes(DRAG_GUEST)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        if (!droppable) return
        const gid = e.dataTransfer.getData(DRAG_GUEST)
        if (gid === '') return
        e.preventDefault()
        if (!guests.some((g) => g.id === gid)) void setStat(gid, 'location', id)
      }}
      data-testid={`stage-location-${id ?? 'elsewhere'}`}
    >
      <button
        onClick={() => id !== null && inspect({ kind: SelectionKind.Location, id })}
        disabled={id === null}
        className="flex items-center gap-2 px-1 pb-1.5 text-left"
      >
        <span className="truncate text-[11px] font-semibold uppercase tracking-widest text-zinc-400">{label}</span>
        {prison === true && <span className="shrink-0 text-[10px] text-red-400">prison</span>}
        <span className="ml-auto shrink-0 text-[10px] text-zinc-600">{guests.length}</span>
      </button>
      <div className="flex flex-col gap-1">
        {guests.length === 0 && <div className="px-1 py-2 text-center text-[11px] text-zinc-700">empty</div>}
        {guests.map((r) => (
          <GuestChip key={r.id} r={r} />
        ))}
      </div>
    </section>
  )
}

/** The cast strip: every character, performer presence marked on the parts
 *  (a part held by a phone that isn't streaming still counts as signed in). */
function CastStrip() {
  const cast = useCockpit((s) => s.cast)
  const factions = useCockpit((s) => s.factions)
  const locked = useCockpit((s) => s.lens !== null)
  const setPerspective = useCockpit((s) => s.setPerspective)
  const inspect = useInspect()
  if (cast.length === 0) return null
  const partIds = new Set(performerParts(cast).map((c) => c.id))
  const presenceOf = (c: CastSummary) => castPresence(c, partIds.has(c.id))
  const tracked = cast.some((c) => partIds.has(c.id) && presenceOf(c) !== PartPresence.Unknown)
  const signedIn = cast.filter((c) => isSignedIn(presenceOf(c)))
  const offline = signedIn.filter((c) => presenceOf(c) === PartPresence.PhoneOffline).length
  // Signed-in performers first, then the other parts, the agents, then the rest of the ensemble.
  const rank = (c: CastSummary) => (isSignedIn(presenceOf(c)) ? 0 : partIds.has(c.id) ? 1 : c.agent === true ? 2 : 3)
  const sorted = [...cast].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
  return (
    <div className="border-b border-zinc-800 px-3 py-2">
      <div className="flex items-baseline gap-2 pb-1.5">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">Cast</span>
        {tracked && (
          <span className="text-[10px] text-zinc-600">
            <span className={signedIn.length > 0 ? 'text-emerald-300' : 'text-zinc-500'}>{signedIn.length}</span> performer
            {signedIn.length === 1 ? '' : 's'} signed in
            {offline > 0 && <span className="text-amber-300"> · {offline} phone{offline === 1 ? '' : 's'} offline</span>}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sorted.map((c) => {
          const presence = presenceOf(c)
          return (
            <button
              key={c.id}
              onClick={() => inspect({ kind: SelectionKind.Character, id: c.id })}
              onContextMenu={(e) => {
                e.preventDefault()
                openContextMenu(
                  [
                    { label: `Inspect ${c.id}`, onSelect: () => inspect({ kind: SelectionKind.Character, id: c.id }) },
                    { label: `Be ${c.id}`, onSelect: () => setPerspective(c.id) },
                  ],
                  { x: e.clientX, y: e.clientY },
                )
              }}
              className={clsx(
                'flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs',
                presence === PartPresence.Online
                  ? 'border-emerald-700/60 bg-emerald-950/30'
                  : presence === PartPresence.PhoneOffline
                    ? 'border-amber-700/60 bg-amber-950/30'
                    : presence === PartPresence.Voiced
                      ? 'border-sky-800/60 bg-sky-950/30'
                      : 'border-zinc-800 hover:bg-zinc-900/60',
              )}
              title={partPresenceTitle(c.id, presence)}
              data-testid={`stage-cast-${c.id}`}
              data-presence={presence}
            >
              {presence !== PartPresence.Unknown && (
                <span
                  className={clsx(
                    'h-1.5 w-1.5 rounded-full',
                    presence === PartPresence.Online
                      ? 'bg-emerald-400'
                      : presence === PartPresence.PhoneOffline
                        ? 'bg-amber-400'
                        : presence === PartPresence.Voiced
                          ? 'bg-sky-400'
                          : 'border border-zinc-600',
                  )}
                />
              )}
              <span className="text-zinc-200">{c.id}</span>
              <FactionPill faction={publicFaction(c.faction, factions, locked)} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function StageTab() {
  const roster = useCockpit((s) => s.roster)
  const locations = useCockpit((s) => s.locations)
  const running = useCockpit((s) => s.run !== null)

  if (!running) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-sm text-zinc-600">
        The stage lights up once a rehearsal starts.
      </div>
    )
  }

  const byLocation = new Map<string, RosterRow[]>()
  for (const r of roster) {
    const key = r.location !== null && locations.some((l) => l.id === r.location) ? r.location : ''
    const list = byLocation.get(key) ?? []
    list.push(r)
    byLocation.set(key, list)
  }
  const elsewhere = byLocation.get('') ?? []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CastStrip />
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {locations.length === 0 && (
          <p className="pb-3 text-xs text-zinc-600">
            No LOCATIONs authored — declare some and each becomes a card here (and a chat room).
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {locations.map((l) => (
            <LocationCard
              key={l.id}
              id={l.id}
              label={l.label || l.id}
              prison={l.prison}
              guests={byLocation.get(l.id) ?? []}
            />
          ))}
          {elsewhere.length > 0 && <LocationCard id={null} label="Elsewhere" guests={elsewhere} />}
        </div>
      </div>
    </div>
  )
}
