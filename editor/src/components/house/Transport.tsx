//! Run → House: the transport — the big GO (Space) on the playhead's cue,
//! Stop (Esc: every running desk cue), the playhead ↑ / ↓, the running
//! runs with their progress, and the store's last note.

import clsx from 'clsx'
import { cueEvents, runProgress, type DeskView } from '@loom/core/house-desk'
import { useHouseDesk } from '@/store/house-desk'
import { runningRuns } from '@/lib/house-desk-view'
import { TONE_TEXT, btn } from './ui'

export function Transport({ view, now, keys }: { view: DeskView; now: number; keys: boolean }) {
  const busy = useHouseDesk((s) => s.busy)
  const dirty = useHouseDesk((s) => s.draft !== null)
  const note = useHouseDesk((s) => s.note)
  const go = useHouseDesk((s) => s.go)
  const stopRunning = useHouseDesk((s) => s.stopRunning)
  const stopRun = useHouseDesk((s) => s.stopRun)
  const moveStandby = useHouseDesk((s) => s.moveStandby)
  const cue = view.desk.cues.find((c) => c.id === view.standby) ?? null
  const running = runningRuns(view.runs)
  const events = cue !== null ? cueEvents(cue) : []
  return (
    <div className="border-b border-zinc-800 p-3" data-testid="house-transport">
      <div className="flex items-stretch gap-2">
        <button
          onClick={() => void go()}
          disabled={cue === null || busy === 'go'}
          className="flex min-w-0 flex-1 flex-col items-start rounded-lg bg-emerald-600 px-4 py-2 text-left text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
          title="GO the playhead’s cue (Space)"
          data-testid="house-go"
        >
          <span className="text-2xl font-bold leading-none tracking-wide">GO</span>
          <span className="mt-1 w-full truncate text-xs">
            {cue === null ? 'The end of the list' : `${cue.number !== undefined ? `${cue.number} · ` : ''}${cue.name}`}
          </span>
          {events.length > 0 && <span className="w-full truncate text-[10px] text-emerald-100/80">⚡ fires {events.join(', ')}</span>}
        </button>
        <div className="flex flex-col gap-1">
          <button onClick={() => void moveStandby(-1)} className={btn} title="Playhead up (↑)" data-testid="house-standby-up">
            ↑
          </button>
          <button onClick={() => void moveStandby(1)} className={btn} title="Playhead down (↓)" data-testid="house-standby-down">
            ↓
          </button>
        </div>
        <button
          onClick={() => void stopRunning()}
          disabled={running.length === 0}
          className="rounded-lg border border-red-800 bg-red-950/40 px-4 text-sm font-semibold text-red-100 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-40"
          title="Stop every running desk cue (Esc). ■ STOP ALL also fades out the house sounds."
          data-testid="house-stop"
        >
          ■ Stop
        </button>
      </div>
      <p className={clsx('mt-1 text-[10px]', keys ? 'text-zinc-400' : 'text-zinc-600')} data-testid="house-keys-cues">
        {keys ? 'Keys: Space GO · ↑ ↓ playhead · Esc stop · double-click a cue to GO it' : 'Keys are on the checks: click here for Space GO'}
      </p>
      {dirty && <p className="mt-1 text-[11px] text-amber-300">Unsaved edits: GO plays the saved desk.</p>}
      {note !== null && (
        <p className={clsx('mt-1 text-xs', TONE_TEXT[note.tone])} data-testid="house-note">
          {note.text}
        </p>
      )}
      {running.length > 0 && (
        <ul className="mt-2 space-y-1" data-testid="house-running">
          {running.map((r) => (
            <li key={r.run} className="flex items-center gap-2 text-xs">
              <span className="w-40 truncate text-zinc-200">{r.name}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-800">
                <span className="block h-full bg-emerald-500" style={{ width: `${Math.round(runProgress(r, now) * 100)}%` }} />
              </span>
              <span className="w-24 truncate text-[10px] text-zinc-500">{r.source === 'story' ? 'the story' : r.by}</span>
              <button onClick={() => void stopRun(r.run)} className={btn} title="Stop this cue" data-testid={`house-stop-run-${r.run}`}>
                ■
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
