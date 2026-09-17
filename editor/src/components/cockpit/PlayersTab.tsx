//! Run → **Players** — a full rehearsal from one screen. Every pane is the
//! REAL participant app (`@loom/play/embed`: the same guest / performer
//! components a phone runs, isolated in a shadow root) on that participant's
//! own session (`openPlayer` → `/api/mod/impersonate`), so a director can
//! seat three personas and two performer booths side by side and play the
//! whole show — CAPTCHAs, codex, DMs, threads, scans, card actions — without
//! opening a single play-app tab.
//!
//! The lineup (`store/players.ts`) outlives its sessions: a restart kills
//! every persona, so a guest pane re-seats itself on a same-named persona
//! (yours if the cockpit already re-spawned it, else a new one) during a
//! rehearsal; a booth just re-opens. Server runs only — the play app talks
//! to an event server, and an in-browser run has none.

import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { PlayEmbed } from '@loom/play/embed'
import {
  CockpitContext,
  PlayerRole,
  RunBackend,
  RunMode,
  SelectionKind,
  isPersonaId,
  useCockpit,
  type PlayerSession,
} from '@/store/cockpit'
import { promptText } from '@/store/dialog'
import { PANE_PX, PaneWidth, reseatTarget, usePlayers, type PlayerSlot } from '@/store/players'
import { useInspect } from './inspect'
import { usePlayAs } from './play-as'

/** Why a pane has no live session right now. */
const PaneState = {
  Opening: 'opening',
  Live: 'live',
  /** The participant signed out inside the pane. */
  Left: 'left',
  /** A run transition cut the session; re-opening / re-seating. */
  Cut: 'cut',
  /** The person is gone and won't come back on their own (a real guest
   *  after a restart, or a persona during a live show). */
  Gone: 'gone',
  Failed: 'failed',
} as const
type PaneState = (typeof PaneState)[keyof typeof PaneState]

/** Wait for a respawned persona to show up before spawning another. */
const RESEAT_GRACE_MS = 1500

function PlayerPane({ slot, width }: { slot: PlayerSlot; width: number }) {
  const openPlayer = useCockpit((s) => s.openPlayer)
  const closePlayer = useCockpit((s) => s.closePlayer)
  const addPersona = useCockpit((s) => s.addPersona)
  const setPerspective = useCockpit((s) => s.setPerspective)
  const connected = useCockpit((s) => s.connected)
  const mode = useCockpit((s) => s.run?.mode ?? null)
  const me = useCockpit((s) => s.me)
  const person = useCockpit((s) =>
    slot.role === PlayerRole.Guest ? s.roster.find((r) => r.id === slot.id) : s.cast.find((c) => c.id === slot.id),
  )
  const exists = person !== undefined
  const inspect = useInspect()
  const cockpit = useContext(CockpitContext)
  const [session, setSession] = useState<PlayerSession | null>(null)
  const [state, setState] = useState<PaneState>(PaneState.Opening)
  const [note, setNote] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const live = useRef<PlayerSession | null>(null)

  // Open (or re-open) a session whenever the pane is (re)targeted.
  useEffect(() => {
    if (!connected || !exists) return
    if (state !== PaneState.Opening) return
    let alive = true
    void openPlayer(slot.role, slot.id).then((s) => {
      if (!alive) {
        if (s !== null) void closePlayer(s)
        return
      }
      if (s === null) {
        setFailure(cockpit.getState().error)
        setState(PaneState.Failed)
        return
      }
      live.current = s
      setSession(s)
      setState(PaneState.Live)
      setNote(null)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, exists, state, slot.id, slot.role, attempt])

  // Close the server session when the pane goes away.
  useEffect(
    () => () => {
      if (live.current !== null) void closePlayer(live.current)
    },
    [closePlayer],
  )

  const reopen = useCallback(() => {
    if (live.current !== null) void closePlayer(live.current)
    live.current = null
    setSession(null)
    setState(PaneState.Opening)
    setAttempt((n) => n + 1)
  }, [closePlayer])

  const onEnded = useCallback(
    (_role: 'guest' | 'prime', notice: string | null) => {
      live.current = null
      setSession(null)
      setNote(notice)
      setState(notice === null ? PaneState.Left : PaneState.Cut)
    },
    [],
  )

  // Where the pane really is. A person who vanished under a live session (a
  // restart, a removal) is a cut even before the pane's stream notices; a
  // cut guest who won't come back on their own — a real guest, or a persona
  // once the show is live — is gone.
  const isGuest = slot.role === PlayerRole.Guest
  const cut = state === PaneState.Cut || (state === PaneState.Live && !exists)
  const view: PaneState =
    cut && !exists && isGuest && (!isPersonaId(slot.id) || mode !== RunMode.Rehearsal) ? PaneState.Gone : cut ? PaneState.Cut : state

  // A cut session comes back: a booth re-opens; a guest re-opens if they
  // still exist, else a persona is re-seated during a rehearsal.
  useEffect(() => {
    if (view !== PaneState.Cut || !connected) return
    if (exists) {
      const t = setTimeout(reopen, 400)
      return () => clearTimeout(t)
    }
    if (!isGuest) return // a booth waits for the cast to come back
    let alive = true
    const t = setTimeout(() => {
      void (async () => {
        const players = usePlayers.getState()
        const current = players.slots.find((s) => s.key === slot.key)
        if (!alive || current === undefined || current.id !== slot.id) return
        const roster = cockpit.getState().roster
        const reuse = reseatTarget(current, roster, me, players.slots)
        const id = reuse ?? (await addPersona(current.name))
        if (!alive) return
        if (id === null) {
          setState(PaneState.Failed)
          return
        }
        players.rebind(slot.key, id)
        live.current = null
        setSession(null)
        setState(PaneState.Opening)
      })()
    }, RESEAT_GRACE_MS)
    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, connected, exists, slot.id])

  const remove = () => usePlayers.getState().remove(slot.key)
  const displayName = person !== undefined && 'name' in person && typeof person.name === 'string' ? person.name : slot.name

  return (
    <section
      className="flex h-full shrink-0 flex-col overflow-hidden rounded border border-zinc-800 bg-zinc-900"
      style={{ width }}
      data-testid={`player-pane-${slot.id}`}
    >
      <header className="flex items-center gap-1.5 border-b border-zinc-800 px-2 py-1 text-xs">
        <span title={isGuest ? 'guest app' : 'performer booth'}>{isGuest ? '🎟️' : '🎭'}</span>
        <span className="truncate font-medium text-zinc-100">{displayName}</span>
        {isGuest && !isPersonaId(slot.id) && (
          <span className="rounded bg-amber-950 px-1 text-[10px] text-amber-300" title="a real guest — you are acting as them">
            real guest
          </span>
        )}
        <span
          className={clsx(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            view === PaneState.Live ? 'bg-emerald-400' : view === PaneState.Gone || view === PaneState.Failed ? 'bg-red-500' : 'bg-zinc-600',
          )}
          title={view}
        />
        <span className="ml-auto flex items-center gap-0.5">
          <PaneButton
            label="👁"
            title="Be them in the cockpit (Chat, Stage, Roster follow)"
            onClick={() => setPerspective(slot.id)}
            disabled={!exists}
          />
          <PaneButton
            label="ⓘ"
            title="Inspect"
            onClick={() => inspect({ kind: isGuest ? SelectionKind.Guest : SelectionKind.Character, id: slot.id })}
            disabled={!exists}
          />
          <PaneButton label="↻" title="Reconnect this pane" onClick={reopen} disabled={!exists} testid={`player-reopen-${slot.id}`} />
          <PaneButton label="✕" title="Close this pane" onClick={remove} testid={`player-close-${slot.id}`} />
        </span>
      </header>
      <div className="relative min-h-0 flex-1">
        {session !== null && view === PaneState.Live && (
          <PlayEmbed key={session.token} session={session} onEnded={onEnded} className="absolute inset-0" />
        )}
        {(session === null || view !== PaneState.Live) && (
          <div className="grid h-full place-items-center p-6 text-center text-xs text-zinc-500">
            <div>
              <p>
                {view === PaneState.Opening && (exists ? 'Opening…' : 'Waiting for them to arrive…')}
                {view === PaneState.Cut && (note ?? 'Session ended.') + (exists || !isGuest ? ' Reconnecting…' : ' Re-seating…')}
                {view === PaneState.Left && 'Signed out in the app.'}
                {view === PaneState.Gone && `${slot.name} is gone from this run.`}
                {view === PaneState.Failed && (failure ?? 'Could not open this participant.')}
              </p>
              {(view === PaneState.Left || view === PaneState.Failed) && exists && (
                <button onClick={reopen} className="mt-2 rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800">
                  Open again
                </button>
              )}
              {view === PaneState.Gone && isGuest && (
                <button
                  onClick={() =>
                    void addPersona(slot.name).then((id) => {
                      if (id === null) return
                      usePlayers.getState().rebind(slot.key, id)
                      setState(PaneState.Opening)
                    })
                  }
                  className="mt-2 rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
                >
                  Seat a new persona named {slot.name}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function PaneButton({
  label,
  title,
  onClick,
  disabled,
  testid,
}: {
  label: string
  title: string
  onClick: () => void
  disabled?: boolean
  testid?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30"
      data-testid={testid}
    >
      {label}
    </button>
  )
}

function Toolbar() {
  const roster = useCockpit((s) => s.roster)
  const cast = useCockpit((s) => s.cast)
  const addPersona = useCockpit((s) => s.addPersona)
  const slots = usePlayers((s) => s.slots)
  const width = usePlayers((s) => s.width)
  const playAs = usePlayAs()
  const seated = (role: PlayerRole, id: string) => slots.some((s) => s.role === role && s.id === id)

  const newGuest = async () => {
    const name = await promptText({
      title: 'New guest',
      body: 'Spawns a persona you own and opens their play app.',
      placeholder: 'Their name',
      confirmLabel: 'Seat them',
    })
    if (name === null) return
    const id = await addPersona(name)
    if (id !== null) usePlayers.getState().add(PlayerRole.Guest, id, name)
  }
  const seatCast = () => {
    for (const c of cast) usePlayers.getState().add(PlayerRole.Performer, c.id, c.id)
  }
  const openGuests = roster.filter((r) => !seated(PlayerRole.Guest, r.id))
  const openCast = cast.filter((c) => !seated(PlayerRole.Performer, c.id))
  const select = 'rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-xs text-zinc-300 outline-none focus:border-indigo-500'
  const button = 'rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40'

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
      <button onClick={() => void newGuest()} className={clsx(button, 'border-indigo-800 text-indigo-200')} data-testid="players-new-guest">
        + New guest
      </button>
      <select
        value=""
        onChange={(e) => {
          const r = roster.find((x) => x.id === e.target.value)
          if (r) void playAs(PlayerRole.Guest, r.id, r.name)
        }}
        className={select}
        disabled={openGuests.length === 0}
        data-testid="players-add-guest"
      >
        <option value="">+ Guest…</option>
        {openGuests.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {isPersonaId(r.id) ? (r.owner ? ` · ${r.owner}'s persona` : ' · persona') : ' · real guest'}
          </option>
        ))}
      </select>
      <select
        value=""
        onChange={(e) => e.target.value && void playAs(PlayerRole.Performer, e.target.value, e.target.value)}
        className={select}
        disabled={openCast.length === 0}
        data-testid="players-add-performer"
      >
        <option value="">+ Performer…</option>
        {openCast.map((c) => (
          <option key={c.id} value={c.id}>
            {c.id}
            {c.online ? ' · performer signed in' : ''}
          </option>
        ))}
      </select>
      <button onClick={seatCast} className={button} disabled={openCast.length === 0} title="Open a performer booth for every character">
        Seat the cast
      </button>
      <span className="ml-auto flex items-center gap-2">
        <span className="flex overflow-hidden rounded border border-zinc-800 text-xs">
          {Object.values(PaneWidth).map((w) => (
            <button
              key={w}
              onClick={() => usePlayers.getState().setWidth(w)}
              className={clsx('px-2 py-0.5', width === w ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200')}
              title={`${PANE_PX[w]}px panes`}
            >
              {w}
            </button>
          ))}
        </span>
        <button onClick={() => usePlayers.getState().clear()} className={button} disabled={slots.length === 0}>
          Close all
        </button>
      </span>
    </div>
  )
}

export function PlayersTab() {
  const run = useCockpit((s) => s.run)
  const slots = usePlayers((s) => s.slots)
  const width = usePlayers((s) => s.width)

  if (run !== null && run.backend !== RunBackend.Server) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-sm text-zinc-500" data-testid="players-local">
        <div className="max-w-md">
          <p className="text-zinc-300">Players need an event server.</p>
          <p className="mt-2">
            Each pane is the real participant app, talking to the event exactly as a phone would. This run is in your browser
            {run.scratch ? ' (a scratch run)' : ''}, so there is nothing for it to talk to — open a server project to rehearse with
            Players. Until then, <span className="text-zinc-300">👁 Be</span> anyone from the header to see and act as them here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" data-testid="players-tab">
      <Toolbar />
      {slots.length === 0 ? (
        <div className="grid flex-1 place-items-center p-8 text-center text-sm text-zinc-500">
          <div className="max-w-md">
            <p className="text-zinc-300">Play the whole show from here.</p>
            <p className="mt-2">
              Seat guests and performers side by side. Each pane is their own play app: chat, choices, CAPTCHAs, the codex, DMs,
              scans and card actions all work exactly as on a phone, and everything is recorded as you.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-2" data-testid="players-grid">
          {slots.map((slot) => (
            <PlayerPane key={slot.key} slot={slot} width={PANE_PX[width]} />
          ))}
        </div>
      )}
    </div>
  )
}
