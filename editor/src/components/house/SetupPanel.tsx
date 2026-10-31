//! Run → House → Setup (wave 30): is the house connected, and what to do
//! when it isn't. One card per system off `@loom/core/house-desk`
//! `deskSetup` (🔊 the sound router, 💡 the lights module, 🧠 each outside
//! mind: the same words a host's Desk shows), the order to bring the house
//! up in, the checks' progress, and the help articles with the full
//! runbooks. The view re-reads with the desk's long poll (≤ 25 s).

import clsx from 'clsx'
import { checkProgress, deskChecks, deskSetup, type DeskSetupRow, type DeskView } from '@loom/core/house-desk'
import { useHelp } from '@/store/help'
import { useHouseDesk } from '@/store/house-desk'
import { btn, heading, TONE_CHIP } from './ui'

const MARK = { ok: '✓', warn: '⚠', bad: '✗' } as const

export function SetupPanel({ view, now, onChecks, onDesigner }: { view: DeskView; now: number; onChecks: () => void; onDesigner: () => void }) {
  const rows = deskSetup({ house: view.house, now })
  const progress = checkProgress(deskChecks(view))
  const pair = useHouseDesk((s) => s.pair)
  const busy = useHouseDesk((s) => s.busy)
  const refresh = useHouseDesk((s) => s.refresh)
  const help = (slug: string) => useHelp.getState().openHelp(slug)
  const allOk = rows.every((r) => r.tone === 'ok')
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="house-setup">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base text-zinc-100">{allOk ? 'The house is connected ✓' : 'Connect the house'}</h2>
          <button className={clsx(btn, 'ml-auto')} onClick={() => void refresh()} title="Read the house again now">
            ↻ Check again
          </button>
        </div>
        <div className="space-y-2">
          {rows.map((r) => (
            <SetupCard key={r.id} row={r} />
          ))}
          {view.house.minds === undefined && <p className="text-[11px] text-zinc-500">This server doesn’t report the outside minds yet: see Run → Mind for Trabolta.</p>}
        </div>

        <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
          <div className={heading}>Bring the house up, in this order</div>
          <ol className="list-decimal space-y-1.5 pl-5 text-xs text-zinc-300">
            <li>
              <b>The audio machine</b>: the interface powered and plugged in, then stagehand’s <code>audio</code> job. 🔊 Sound turns green with the interface’s name.
            </li>
            <li>
              <b>The lights machine</b>: the broker (Mosquitto), Zigbee2MQTT on the USB stick, then stagehand’s <code>show</code> and <code>lights</code> jobs. WLED strips join over Wi-Fi to the same broker. 💡 Lights turns green.
            </li>
            <li>
              <b>The mind’s machine</b>: stagehand’s <code>agents</code> job with this event’s id, on Claude with its key in place and Ollama standing by. 🧠 turns green, and Run → Mind shows his thinking.
            </li>
            <li>
              <b>New bulbs</b>:{' '}
              <button className={btn} disabled={busy !== null} onClick={() => void pair(view.house.pairUntil === null)}>
                {view.house.pairUntil !== null ? '■ Stop pairing' : '🔗 Pair a bulb'}
              </button>{' '}
              (2 minutes), reset the bulb so it joins, name it in Zigbee2MQTT, then place it on the house map’s 💡 Lights tab and Save to project.
            </li>
            <li>
              <b>Walk the checks</b> with a phone (a host’s Desk) or here:{' '}
              <button className={btn} onClick={onChecks}>
                Checks → {progress.ok}/{progress.total} ✓{progress.bad > 0 ? ` · ${progress.bad} ✗` : ''}
              </button>
            </li>
            <li>
              <b>Design the cues</b> — lighting looks, sounds, desk cues — and put <code>cue &lt;name&gt;</code> in the story:{' '}
              <button className={btn} onClick={onDesigner}>
                Cue designer →
              </button>
            </li>
          </ol>
        </section>

        <section className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
          <div className={heading}>The full runbooks</div>
          <p>
            <button className="text-indigo-300 hover:underline" onClick={() => help('house-setup')}>
              Help → Setting up the house
            </button>{' '}
            (which machine runs what, each device step by step) ·{' '}
            <button className="text-indigo-300 hover:underline" onClick={() => help('cue-designer')}>
              Help → The Cue designer
            </button>{' '}
            ·{' '}
            <button className="text-indigo-300 hover:underline" onClick={() => help('house-desk')}>
              Help → The house desk
            </button>
          </p>
          <p>
            On the machines themselves: <code>scripts/house-desktop/README.md</code> (Windows: audio, lights, the TV), <code>scripts/house-macbook/</code> (macOS: the mind), <code>stagehand/README.md</code>.
          </p>
        </section>
      </div>
    </div>
  )
}

function SetupCard({ row }: { row: DeskSetupRow }) {
  return (
    <details open={row.tone !== 'ok'} className={clsx('rounded-xl border p-3', TONE_CHIP[row.tone])} data-testid={`house-setup-${row.id}`}>
      <summary className="flex cursor-pointer list-none items-baseline gap-2">
        <span className="w-4 text-center">{MARK[row.tone]}</span>
        <span className="text-sm font-semibold">{row.title}</span>
        <span className="min-w-0 flex-1 truncate text-xs opacity-90">{row.status}</span>
        {row.fix.length > 0 && <span className="text-[10px] opacity-70">{row.fix.length} to do</span>}
      </summary>
      {row.fix.length > 0 && (
        <ol className="mt-2 list-decimal space-y-1 pl-9 text-xs">
          {row.fix.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ol>
      )}
    </details>
  )
}
