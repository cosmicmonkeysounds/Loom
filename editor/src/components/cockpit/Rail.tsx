//! The cockpit's left rail — the director's at-a-glance read on the run.
//! Top: which world this cockpit is driving (a local run · a scratch run
//! · the shared rehearsal · the LIVE event — colour-coded so they are
//! unmistakable), phase, connection, and live stats (guests + online
//! presence, ledger, pending decisions, co-directors). Below: a live
//! **Guests** list (presence dots, owner chips — "you" / "Ana's persona",
//! location, decision badges, right-click actions, an inline persona
//! spawner) and the **Rooms** navigator — both collapsible, so the rail
//! serves every page, not just Chat. Identical on both backends; the
//! identity control ("who am I right now") lives in the stage header.

import { useState } from 'react'
import clsx from 'clsx'
import { CockpitPhase, CockpitTab, SelectionKind, useCockpit, type RosterRow } from '@/store/cockpit'
import { useRooms, useRoomCounts } from './rooms'
import { channelGlyph, worldBadge } from './format'
import { useInspect } from './inspect'
import { useGuestMenu } from './guest-menu'

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

/** Inline "spawn a persona" row — a guest you puppet: local on a folder,
 *  a journaled `/api/mod/persona` guest (owned by you) on the server. */
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
        title="Spawn a persona you can be (choices, chat, scans)"
        className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-700"
        data-testid="rail-persona-add"
      >
        +
      </button>
    </div>
  )
}

/** Presence dot: green = streaming now, hollow = registered but away.
 *  The local run doesn't track presence — no dot at all there. */
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

/** Whose persona this is — "you", a co-writer's name, or nothing for a real guest. */
function OwnerChip({ owner, me }: { owner: string | null | undefined; me: string }) {
  if (!owner) return null
  const mine = owner === me
  return (
    <span
      title={mine ? 'your persona' : `${owner}'s persona`}
      className={clsx(
        'shrink-0 rounded px-1 text-[9px] uppercase tracking-wide',
        mine ? 'bg-violet-500/20 text-violet-300' : 'bg-zinc-800 text-zinc-400',
      )}
    >
      {mine ? 'you' : owner}
    </span>
  )
}

function GuestRow({ r, hasChoice }: { r: RosterRow; hasChoice: boolean }) {
  const selection = useCockpit((s) => s.selection)
  const me = useCockpit((s) => s.me)
  const perspective = useCockpit((s) => s.perspective)
  const locked = useCockpit((s) => s.lens !== null)
  const inspect = useInspect()
  const menu = useGuestMenu()
  const selected = selection?.kind === SelectionKind.Guest && selection.id === r.id
  const being = perspective === r.id

  return (
    <button
      onClick={() => inspect({ kind: SelectionKind.Guest, id: r.id })}
      onContextMenu={(e) => menu(r, e)}
      title={`${r.name} — ${r.location ?? 'no location'} · ${r.score} pts${r.owner ? (r.owner === me ? ' · your persona' : ` · ${r.owner}'s persona`) : ''}`}
      className={clsx(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
        selected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900/60',
        being && 'border-l-2 border-indigo-400',
      )}
      data-testid={`rail-guest-${r.id}`}
    >
      <PresenceDot online={r.online} />
      <span className="min-w-0 flex-1 truncate">{r.name}</span>
      <OwnerChip owner={r.owner} me={me} />
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
      <span className="shrink-0 truncate text-[10px] text-zinc-600">{locked ? '' : (r.location ?? '')}</span>
    </button>
  )
}

export function CockpitRail() {
  const phase = useCockpit((s) => s.phase)
  const connected = useCockpit((s) => s.connected)
  const run = useCockpit((s) => s.run)
  const roster = useCockpit((s) => s.roster)
  const ledgerLen = useCockpit((s) => s.ledgerLen)
  const choices = useCockpit((s) => s.choices)
  const modsOnline = useCockpit((s) => s.modsOnline)
  const directors = useCockpit((s) => s.directors)
  const activeTab = useCockpit((s) => s.activeTab)
  const activeChannel = useCockpit((s) => s.activeChannel)
  const setTab = useCockpit((s) => s.setTab)
  const selectChannel = useCockpit((s) => s.selectChannel)
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
  const world = worldBadge(run)
  const running = run !== null

  const openRoom = (key: string) => {
    selectChannel(key)
    setTab(CockpitTab.Chat)
  }

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100">
      {/* Identity + vitals — which world, what state, who's here. */}
      <div className={clsx('border-b p-3', world.border)} data-testid="rail-identity">
        <div className="flex items-center justify-between gap-2">
          <span
            className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest', world.badge)}
            data-testid="run-backend"
          >
            {world.label}
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
            <span title={directors.length > 0 ? `Directing now: ${directors.join(', ')}` : undefined} data-testid="rail-directors">
              <Stat
                value={modsOnline}
                label={modsOnline === 1 ? 'director' : 'directors'}
                tone={modsOnline > 1 ? 'text-amber-300' : 'text-zinc-400'}
              />
            </span>
          )}
        </div>
        {running && !connected && <div className="mt-1 text-[10px] text-amber-400">○ reconnecting…</div>}
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
            {running ? 'No guests yet — share the join code from the Run page.' : 'Guests appear once a rehearsal starts.'}
          </div>
        )}
        {roster.map((r) => (
          <GuestRow key={r.id} r={r} hasChoice={(choices[r.id]?.length ?? 0) > 0} />
        ))}
        {running && <AddPersonaRow />}
      </Section>

      {/* Rooms — one click into any thread, from any page. */}
      <Section
        title="Rooms"
        detail={rooms.length > 0 ? `${rooms.length}` : undefined}
        open={roomsOpen}
        onToggle={() => setRoomsOpen((v) => !v)}
      >
        {rooms.length === 0 && <div className="px-3 py-1 text-xs text-zinc-600">Rooms appear once a rehearsal starts.</div>}
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
              data-testid={`rail-room-${r.key}`}
            >
              <span className="shrink-0 text-xs">{r.kind === 'guest' ? '🎟️' : channelGlyph(r.kind)}</span>
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              {r.canPost === false && <span className="shrink-0 text-[9px] text-zinc-600" title="read-only for you here">🔇</span>}
              {counts.get(r.key) ? <span className="shrink-0 text-[10px] text-zinc-600">{counts.get(r.key)}</span> : null}
            </button>
          )
        })}
      </Section>
    </div>
  )
}
