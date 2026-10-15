//! The terminal heartbeat card (OCT31 K-29) and its header pill. Every wall
//! terminal and the TV report in every 1–2 s; one silent for 20 s turns red
//! and the editor chimes (again every minute until acknowledged). The card
//! also carries the TV-voice mute (K-18). Reads `store/terminals.ts`, which
//! App.tsx binds to the server run — a local run has no terminals, so both
//! render nothing there. The chess phone runs the Lichess app and never
//! reports (OP-12 covers it).

import clsx from 'clsx'
import { CockpitTab, useCockpit } from '@/store/cockpit'
import { useTerminals } from '@/store/terminals'
import { TerminalStatus, formatSilence, isTvView } from '@/lib/terminals'

/** `📟 5/6` in the stage header — red while any terminal is silent; click → Run. */
export function TerminalsPill() {
  const rows = useTerminals((s) => s.rows)
  const reachable = useTerminals((s) => s.reachable)
  const setTab = useCockpit((s) => s.setTab)
  if (rows.length === 0 && reachable) return null
  const silent = rows.filter((r) => r.status === TerminalStatus.Silent).length
  const bad = silent > 0 || !reachable
  return (
    <button
      onClick={() => setTab(CockpitTab.Run)}
      className={clsx(
        'rounded-full border px-2 py-0.5 text-[11px]',
        bad ? 'animate-pulse border-red-700 bg-red-950/60 text-red-200' : 'border-emerald-800/70 bg-emerald-950/30 text-emerald-200',
      )}
      title={!reachable ? 'Can’t reach the server — terminal status unknown' : bad ? `${silent} terminal(s) silent — open Run` : 'Every terminal is reporting'}
      data-testid="run-terminals-pill"
    >
      📟 {rows.length - silent}/{rows.length}
    </button>
  )
}

export function TerminalsCard() {
  const rows = useTerminals((s) => s.rows)
  const reachable = useTerminals((s) => s.reachable)
  const acked = useTerminals((s) => s.acked)
  const voiceMuted = useTerminals((s) => s.voiceMuted)
  const ack = useTerminals((s) => s.ack)
  const forget = useTerminals((s) => s.forget)
  const setVoiceMuted = useTerminals((s) => s.setVoiceMuted)
  const muteError = useTerminals((s) => s.muteError)
  const silent = rows.some((r) => r.status === TerminalStatus.Silent)
  const hasTv = rows.some((r) => isTvView(r.view))

  return (
    <section
      className={clsx('rounded-xl border bg-zinc-950 p-3', silent || !reachable ? 'border-red-800/80' : rows.length > 0 ? 'border-emerald-800/60' : 'border-zinc-800')}
      data-testid="run-terminals"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">Terminals</span>
        {(hasTv || voiceMuted === true) && voiceMuted !== null && (
          <button
            onClick={() => void setVoiceMuted(!voiceMuted)}
            className={clsx(
              'ml-auto rounded border px-2 py-0.5 text-[11px]',
              voiceMuted ? 'border-amber-700 bg-amber-950/40 text-amber-200' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-900',
            )}
            title="The TV speaks Trabolta’s lines in the Desktop room; muted = captions only"
            data-testid="run-terminals-voice"
          >
            {voiceMuted ? '🔇 TV voice muted' : '🔊 TV voice on'}
          </button>
        )}
      </div>
      {muteError !== null && (
        <p className="mb-2 rounded bg-amber-950/60 px-2 py-1 text-xs text-amber-200" data-testid="run-terminals-mute-error">
          {muteError}
        </p>
      )}
      {!reachable && (
        <p className="mb-2 rounded bg-red-950/60 px-2 py-1 text-xs text-red-200" data-testid="run-terminals-unreachable">
          Can’t reach the server — the terminals may be fine. Check this laptop’s connection (and the house uplink).
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-600">
          No terminal has reported yet. Each wall tablet and the TV shows up here once it polls; one silent for 20 s turns red
          and this editor chimes.
        </p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="run-terminals-list">
          {rows.map((r) => {
            const dead = r.status === TerminalStatus.Silent
            return (
              <li
                key={r.name}
                className={clsx('flex items-center gap-2 rounded px-2 py-1 text-xs', dead ? 'bg-red-950/50 text-red-100' : 'text-zinc-300')}
                data-testid="run-terminal-row"
                data-status={r.status}
              >
                <span className={clsx('h-2 w-2 shrink-0 rounded-full', dead ? 'bg-red-500' : 'bg-emerald-500')} />
                <span className="font-medium">{r.name}</span>
                <span className="text-zinc-500">
                  {[r.spot, r.view].filter((x) => x !== '').join(' · ')}
                  {r.remembered ? ' · not seen since the server restarted' : ''}
                </span>
                <span className={clsx('ml-auto tabular-nums', dead ? 'text-red-300' : 'text-zinc-600')}>
                  {dead ? `silent ${formatSilence(r.silentFor)}` : 'live'}
                </span>
                {dead && !acked.has(r.name) && (
                  <button onClick={() => ack(r.name)} className="rounded border border-red-700 px-1.5 text-[11px] hover:bg-red-900/60" title="Stop the repeat chime for this one">
                    ack
                  </button>
                )}
                {dead && (
                  <button onClick={() => forget(r.name)} className="px-1 text-[11px] text-red-300/70 hover:text-red-100" title="Forget it (switched off on purpose)">
                    ✕
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {silent && (
        <p className="mt-2 text-xs text-zinc-500">
          A silent tablet: tap it / reload in Fully Kiosk, check its Wi-Fi and power, or swap the spare. The chess phone never shows
          here.
        </p>
      )}
    </section>
  )
}
