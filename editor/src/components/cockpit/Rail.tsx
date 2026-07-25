//! The cockpit's left rail — the admin's at-a-glance read on the event.
//! Top: which backend this cockpit is driving (SIM rehearsal vs LIVE
//! event — color-coded so the two are unmistakable), phase, connection,
//! and live stats (guests + online presence, ledger, pending decisions).
//! Below: the perspective lens, a live **Guests** list (presence dots,
//! location, decision badges, right-click moderation), and the **Rooms**
//! navigator — both collapsible, so the rail serves every page, not just
//! Chat. Shared by Run mode's Sim (local simulator) and Live sources.

import { useState } from 'react'
import clsx from 'clsx'
import {
  CockpitPhase,
  CockpitTab,
  OPERATOR_LENS,
  SelectionKind,
  useCockpit,
  type RosterRow,
} from '@/store/cockpit'
import { useLiveRun } from '@/store/run'
import { useOperate } from '@/store/operate'
import { useRooms, useRoomCounts } from './rooms'
import { channelGlyph } from './format'
import { useInspect } from './inspect'
import { useGuestMenu } from './guest-menu'

/** The "viewing as" lens picker: Operator · every guest · every character. */
function PerspectiveSelect() {
  const roster = useCockpit((s) => s.roster)
  const cast = useCockpit((s) => s.cast)
  const perspective = useCockpit((s) => s.perspective)
  const setPerspective = useCockpit((s) => s.setPerspective)
  return (
    <select
      value={perspective}
      onChange={(e) => setPerspective(e.target.value)}
      className="mt-2 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
      title="Viewing as"
      data-testid="cockpit-perspective"
    >
      <option value={OPERATOR_LENS}>👁 Operator (everything)</option>
      {roster.length > 0 && (
        <optgroup label="Guests">
          {roster.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.id})
            </option>
          ))}
        </optgroup>
      )}
      {cast.length > 0 && (
        <optgroup label="Cast">
          {cast.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  )
}

/** One numeric readout in the header strip. */
function Stat({ value, label, tone }: { value: string | number; label: string; tone?: string }) {
  return (
    <span className="text-xs text-zinc-500">
      <span className={clsx('font-medium', tone ?? 'text-zinc-200')}>{value}</span> {label}
    </span>
  )
}

/** A collapsible rail section with a count in the header. */
function Section({
  title,
  detail,
  open,
  onToggle,
  children,
}: {
  title: string
  detail?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className={clsx('flex min-h-0 flex-col', open && 'flex-1')}>
      <button
        onClick={onToggle}
        className="flex w-full shrink-0 items-center gap-1.5 px-3 py-2 text-left text-[10px] uppercase tracking-widest text-zinc-500 hover:text-zinc-300"
      >
        <span className="w-3">{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        {detail && <span className="ml-auto normal-case tracking-normal text-zinc-600">{detail}</span>}
      </button>
      {open && <div className="min-h-0 flex-1 overflow-auto pb-2">{children}</div>}
    </div>
  )
}

/** Inline "spawn a persona" row — the shared-rehearsal entry point: on
 *  the Sim source it's a local puppet, on a preview/live event it's a
 *  journaled `/api/mod/persona` guest each co-writer can play. */
function AddPersonaRow() {
  const addPersona = useCockpit((s) => s.addPersona)
  const [name, setName] = useState('')
  const add = () => {
    void addPersona(name.trim() || undefined)
    setName('')
  }
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        placeholder="new persona…"
        className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
        data-testid="rail-persona-name"
      />
      <button
        onClick={add}
        title="Spawn a persona you can act as (choices, chat, scans)"
        className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-700"
        data-testid="rail-persona-add"
      >
        +
      </button>
    </div>
  )
}

/** Presence dot: green = streaming now, hollow = registered but away.
 *  The local sim doesn't track presence — no dot at all there. */
function PresenceDot({ online }: { online: boolean | undefined }) {
  if (online === undefined) return null
  return (
    <span
      title={online ? 'connected now' : 'not connected'}
      className={clsx(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        online ? 'bg-emerald-400' : 'border border-zinc-600',
      )}
    />
  )
}

function GuestRow({ r, hasChoice }: { r: RosterRow; hasChoice: boolean }) {
  const selection = useCockpit((s) => s.selection)
  // "yours" only means something once the roster holds people you DON'T
  // puppet (other writers' personas, real guests) — solo sims skip it.
  const mine = useCockpit((s) => s.personas.includes(r.id) && s.personas.length < s.roster.length)
  const inspect = useInspect()
  const menu = useGuestMenu()
  const selected = selection?.kind === SelectionKind.Guest && selection.id === r.id

  return (
    <button
      onClick={() => inspect({ kind: SelectionKind.Guest, id: r.id })}
      onContextMenu={(e) => menu(r, e)}
      title={`${r.name} — ${r.location ?? 'no location'} · ${r.score} pts${mine ? ' · your persona' : ''}`}
      className={clsx(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
        selected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900/60',
      )}
      data-testid={`rail-guest-${r.id}`}
    >
      <PresenceDot online={r.online} />
      <span className="min-w-0 flex-1 truncate">{r.name}</span>
      {mine && (
        <span title="your persona" className="shrink-0 rounded bg-violet-500/20 px-1 text-[9px] uppercase tracking-wide text-violet-300">
          you
        </span>
      )}
      {hasChoice && (
        <span title="waiting on a decision" className="shrink-0 text-[10px] text-indigo-300">
          ⏳
        </span>
      )}
      {r.captured && (
        <span title="captured" className="shrink-0 text-[10px] text-red-400">
          🔒
        </span>
      )}
      <span className="shrink-0 truncate text-[10px] text-zinc-600">{r.location ?? ''}</span>
    </button>
  )
}

export function CockpitRail() {
  const phase = useCockpit((s) => s.phase)
  const connected = useCockpit((s) => s.connected)
  const live = useCockpit((s) => s.live)
  const roster = useCockpit((s) => s.roster)
  const ledgerLen = useCockpit((s) => s.ledgerLen)
  const choices = useCockpit((s) => s.choices)
  const modsOnline = useCockpit((s) => s.modsOnline)
  const activeTab = useCockpit((s) => s.activeTab)
  const activeChannel = useCockpit((s) => s.activeChannel)
  const setTab = useCockpit((s) => s.setTab)
  const selectChannel = useCockpit((s) => s.selectChannel)
  const isLiveSource = useLiveRun()
  const preview = useOperate((s) => s.event?.mode === 'preview')
  const rooms = useRooms()
  const counts = useRoomCounts()

  const [guestsOpen, setGuestsOpen] = useState(true)
  const [roomsOpen, setRoomsOpen] = useState(true)

  const phaseTone =
    phase === CockpitPhase.Open
      ? 'bg-emerald-900 text-emerald-300'
      : phase === CockpitPhase.Paused
        ? 'bg-amber-900 text-amber-300'
        : 'bg-zinc-800 text-zinc-400'

  const onlineCount = roster.filter((r) => r.online === true).length
  const tracksPresence = roster.some((r) => r.online !== undefined)
  const pendingCount = Object.keys(choices).length

  const openRoom = (key: string) => {
    selectChannel(key)
    setTab(CockpitTab.Chat)
  }

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100">
      {/* Identity + vitals — which backend, what state, who's here. */}
      <div
        className={clsx(
          'border-b p-3',
          isLiveSource ? (preview ? 'border-amber-900/60' : 'border-emerald-900/60') : 'border-violet-900/60',
        )}
        data-testid="rail-identity"
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={clsx(
              'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest',
              isLiveSource
                ? preview
                  ? 'bg-amber-950 text-amber-300'
                  : 'bg-emerald-950 text-emerald-300'
                : 'bg-violet-950 text-violet-300',
            )}
          >
            {isLiveSource ? (preview ? '◉ Shared rehearsal' : '● Live event') : '◦ Sim rehearsal'}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${phaseTone}`}>{phase}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <Stat value={roster.length} label="guests" />
          {tracksPresence && (
            <Stat value={onlineCount} label="online" tone={onlineCount > 0 ? 'text-emerald-300' : 'text-zinc-400'} />
          )}
          <Stat value={ledgerLen} label="events" />
          <Stat
            value={pendingCount}
            label={pendingCount === 1 ? 'decision' : 'decisions'}
            tone={pendingCount > 0 ? 'text-indigo-300' : 'text-zinc-400'}
          />
          {modsOnline !== null && (
            <Stat
              value={modsOnline}
              label={modsOnline === 1 ? 'director' : 'directors'}
              tone={modsOnline > 1 ? 'text-amber-300' : 'text-zinc-400'}
            />
          )}
        </div>
        {live && !connected && <div className="mt-1 text-[10px] text-amber-400">○ reconnecting…</div>}
        {live && <PerspectiveSelect />}
      </div>

      {/* Guests — the live who's-here list, on every page. */}
      <Section
        title="Guests"
        detail={
          roster.length === 0 ? undefined : tracksPresence ? `${onlineCount}/${roster.length} online` : `${roster.length}`
        }
        open={guestsOpen}
        onToggle={() => setGuestsOpen((v) => !v)}
      >
        {roster.length === 0 && (
          <div className="px-3 py-1 text-xs text-zinc-600">
            {live ? 'No guests yet — share the join code from Deploy.' : 'Guests appear once a session is live.'}
          </div>
        )}
        {roster.map((r) => (
          <GuestRow key={r.id} r={r} hasChoice={(choices[r.id]?.length ?? 0) > 0} />
        ))}
        {live && <AddPersonaRow />}
      </Section>

      {/* Rooms — one click into any thread, from any page. */}
      <Section
        title="Rooms"
        detail={rooms.length > 0 ? `${rooms.length}` : undefined}
        open={roomsOpen}
        onToggle={() => setRoomsOpen((v) => !v)}
      >
        {rooms.length === 0 && <div className="px-3 py-1 text-xs text-zinc-600">Rooms appear once a session is live.</div>}
        {rooms.map((r) => {
          const active = activeTab === CockpitTab.Chat && r.key === activeChannel
          return (
            <button
              key={r.key}
              onClick={() => openRoom(r.key)}
              className={clsx(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900/60',
              )}
            >
              <span className="shrink-0 text-xs">{channelGlyph(r.kind)}</span>
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              {counts.get(r.key) ? <span className="shrink-0 text-[10px] text-zinc-600">{counts.get(r.key)}</span> : null}
            </button>
          )
        })}
      </Section>
    </div>
  )
}
