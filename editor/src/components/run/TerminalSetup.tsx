//! **Set up a terminal** (wave 14) — the Terminals card's link builder, so
//! a director never types a spot, a view, a room or a character: the spot is
//! one of the event's house map terminals (picking it fills the name and the
//! view + room it most likely wants), the view one of `TERMINAL_VIEWS` with
//! its one-line help, the room one of the story's LOCATIONs, the character
//! one of the cast (agent-voiced first). Out comes the `/terminal/?code=…`
//! link the tablet opens once, as text, a QR drawn in the browser and a copy
//! button. The link carries the moderator code, so the card says so. Rules
//! in pure `lib/terminal-setup.ts`.

import { useEffect, useMemo, useState } from 'react'
import { useCockpit } from '@/store/cockpit'
import { useTerminals } from '@/store/terminals'
import { qrSvg } from '@/lib/print-sheet'
import {
  TERMINAL_VIEWS,
  TerminalView,
  characterOptions,
  isTerminalView,
  pickSpot,
  pickView,
  roomHelp,
  roomOptions,
  terminalBase,
  terminalLink,
  unclaimedSpots,
  viewHasCharacter,
  viewOption,
  type TerminalSetup as Setup,
} from '@/lib/terminal-setup'

const selectCls = 'min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 disabled:opacity-50'
const labelCls = 'w-20 shrink-0 text-[11px] text-zinc-500'

export function TerminalSetup() {
  const run = useCockpit((s) => s.run)
  const cast = useCockpit((s) => s.cast)
  const locations = useCockpit((s) => s.locations)
  const map = useTerminals((s) => s.map)
  const mapRooms = useTerminals((s) => s.mapRooms)
  const rows = useTerminals((s) => s.rows)
  const loadMap = useTerminals((s) => s.loadMap)
  const characters = useMemo(() => characterOptions(cast), [cast])
  const rooms = useMemo(() => roomOptions(map ?? [], mapRooms, locations.map((l) => l.id)), [map, mapRooms, locations])
  const free = useMemo(() => new Set(unclaimedSpots(map ?? [], rows).map((t) => t.id)), [map, rows])
  const [setup, setSetup] = useState<Setup>({ name: '', spot: '', view: TerminalView.Auto, room: '', character: '', announce: false })
  const [qr, setQr] = useState<{ link: string; svg: string } | null>(null)
  const [copiedLink, setCopiedLink] = useState<string | null>(null)

  // The character defaults to the first agent-voiced one (the cast lands after mount).
  const chosen: Setup = setup.character === '' && characters.length > 0 ? { ...setup, character: characters[0]!.id } : setup
  const base = run?.joinUrl ? terminalBase(run.joinUrl) : null
  const mod = run?.codes?.mod ?? null
  const link = base !== null && mod !== null ? terminalLink(base, mod, chosen) : null
  const svg = qr !== null && qr.link === link ? qr.svg : null
  const copied = copiedLink !== null && copiedLink === link

  useEffect(() => {
    let live = true
    if (link !== null) void qrSvg(link).then((s) => live && setQr({ link, svg: s })).catch(() => undefined)
    return () => {
      live = false
    }
  }, [link])

  if (link === null) return null
  const spotOf = (id: string) => map?.find((t) => t.id === id) ?? null
  const spot = spotOf(setup.spot)
  const view = viewOption(setup.view)
  const chess = setup.view === TerminalView.Chess
  // A stored room the lists don't know (a renamed LOCATION): kept selectable so the select never lies.
  const roomList = setup.room !== '' && !rooms.includes(setup.room) ? [setup.room, ...rooms] : rooms

  return (
    <details className="mt-3 rounded-lg border border-zinc-800 px-2 py-1.5" data-testid="run-terminal-setup" onToggle={(e) => (e.currentTarget.open ? void loadMap() : undefined)}>
      <summary className="cursor-pointer text-xs text-zinc-300">🛠 Set up a terminal…</summary>
      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2">
            <span className={labelCls}>Spot</span>
            <select
              className={selectCls}
              value={setup.spot}
              onChange={(e) => setSetup((s) => pickSpot(s, spotOf(e.target.value)))}
              data-testid="run-terminal-setup-spot"
            >
              <option value="">— unplaced (no map spot) —</option>
              {(map ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.id}){t.location !== '' ? ` · ${t.location}` : ''}
                  {free.has(t.id) ? ' · unclaimed' : ''}
                </option>
              ))}
            </select>
          </label>
          {map === null && <p className="pl-[5.5rem] text-[11px] text-amber-300">No house map read yet: the spot list is empty. A terminal with no spot shows no world view.</p>}
          <label className="flex items-center gap-2">
            <span className={labelCls}>Name</span>
            <input
              className={selectCls}
              value={setup.name}
              onChange={(e) => setSetup((s) => ({ ...s, name: e.target.value }))}
              placeholder={spot?.name ?? 'Terminal'}
              title="What the heartbeat list and the journal call this tablet (filled from the spot)"
              data-testid="run-terminal-setup-name"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className={labelCls}>View</span>
            <select
              className={selectCls}
              value={setup.view}
              onChange={(e) => isTerminalView(e.target.value) && setSetup((s) => pickView(s, e.target.value as TerminalView, spotOf(s.spot)))}
              data-testid="run-terminal-setup-view"
            >
              {TERMINAL_VIEWS.map((v) => (
                <option key={v.id} value={v.id} title={v.help}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          {view !== null && <p className="pl-[5.5rem] text-[11px] text-zinc-500" data-testid="run-terminal-setup-view-help">{view.help}</p>}
          <label className="flex items-center gap-2">
            <span className={labelCls}>Room</span>
            <select
              className={selectCls}
              value={chess ? '' : setup.room}
              disabled={chess}
              onChange={(e) => setSetup((s) => ({ ...s, room: e.target.value }))}
              data-testid="run-terminal-setup-room"
            >
              <option value="">{setup.view === TerminalView.Tv ? '— The Desktop (default) —' : '— none (not a room terminal) —'}</option>
              {roomList.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <p className="pl-[5.5rem] text-[11px] text-zinc-500">{roomHelp(setup.view)}</p>
          <label className="flex items-center gap-2">
            <span className={labelCls}>Character</span>
            <select
              className={selectCls}
              value={viewHasCharacter(setup.view) ? chosen.character : ''}
              disabled={!viewHasCharacter(setup.view)}
              onChange={(e) => setSetup((s) => ({ ...s, character: e.target.value }))}
              data-testid="run-terminal-setup-character"
            >
              {!viewHasCharacter(setup.view) && <option value="">— the King (no character) —</option>}
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}
                  {c.agent ? ' · voiced' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pl-[5.5rem] text-[11px] text-zinc-400">
            <input type="checkbox" checked={setup.announce} onChange={(e) => setSetup((s) => ({ ...s, announce: e.target.checked }))} data-testid="run-terminal-setup-announce" />
            Also say the house announcements (off for most tablets: the house speakers reach them)
          </label>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          {/* `qrcode`'s own SVG output for our own link — no user markup. */}
          <div className="h-36 w-36 rounded bg-white p-1 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg ?? '' }} data-testid="run-terminal-setup-qr" />
          <div className="flex gap-1">
            <button
              onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopiedLink(link))}
              className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-900"
              data-testid="run-terminal-setup-copy"
            >
              {copied ? '✓ Copied' : 'Copy link'}
            </button>
            <a href={link} target="_blank" rel="noreferrer" className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-indigo-300 hover:bg-zinc-900">
              Open ↗
            </a>
          </div>
        </div>
      </div>
      <p className="mt-2 break-all font-mono text-[10px] text-zinc-500" data-testid="run-terminal-setup-link">
        {link}
      </p>
      <p className="mt-1 text-[11px] text-amber-300/80">
        The link carries the moderator code: open it on the tablet, never post it. The tablet keeps the setup and scrubs the code from its address bar.
      </p>
    </details>
  )
}
