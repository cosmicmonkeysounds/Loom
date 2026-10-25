//! Run → House: the status strip — the router, the lights and the desk's
//! own health as chips (`deskStatus`), ■ STOP ALL (the panic: every desk
//! run and the house sounds), and where the desk in force comes from, with
//! Save to project.

import clsx from 'clsx'
import { deskStatus, type DeskView } from '@loom/core/house-desk'
import { useHouseDesk } from '@/store/house-desk'
import { sourceText } from '@/lib/house-desk-view'
import { TONE_CHIP, btn } from './ui'

export function DeskStatusStrip({ view }: { view: DeskView }) {
  const busy = useHouseDesk((s) => s.busy)
  const dirty = useHouseDesk((s) => s.draft !== null)
  const reachable = useHouseDesk((s) => s.reachable)
  const stopAll = useHouseDesk((s) => s.stopAll)
  const saveToProject = useHouseDesk((s) => s.saveToProject)
  const chips = deskStatus(view)
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2" data-testid="house-status">
      <button
        onClick={() => void stopAll()}
        disabled={busy === 'stop'}
        className="rounded border border-red-700 bg-red-900/60 px-3 py-1 text-xs font-semibold text-red-50 hover:bg-red-800 disabled:opacity-50"
        title="The panic: stop every running desk cue and fade out every house sound (not the announcement)"
        data-testid="house-stop-all"
      >
        {busy === 'stop' ? '■ Stopping…' : '■ STOP ALL'}
      </button>
      {view.live && (
        <span className="rounded-full border border-red-700 bg-red-950/60 px-2 py-0.5 text-[11px] font-semibold text-red-200" data-testid="house-live">
          LIVE · tests ask first
        </span>
      )}
      {chips.map((c) => (
        <span key={`${c.kind}-${c.text}`} className={clsx('rounded-full border px-2 py-0.5 text-[11px]', TONE_CHIP[c.tone])} data-testid={`house-chip-${c.kind}`}>
          {c.text}
        </span>
      ))}
      {!reachable && <span className="rounded bg-red-950/60 px-2 py-0.5 text-[11px] text-red-200">Can’t reach the server: retrying</span>}
      <span className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-zinc-400" data-testid="house-source">
        {sourceText(view.source)} · <span className="font-mono text-zinc-500">{view.version}</span>
        {view.source === 'director' && (
          <button
            onClick={() => void saveToProject()}
            disabled={busy !== null || dirty}
            className={btn}
            title={dirty ? 'Save your edits first' : 'Write this desk into the project as desk.json (it then survives End → relaunch)'}
            data-testid="house-save-project"
          >
            {busy === 'project' ? 'Saving…' : 'Save to project'}
          </button>
        )}
      </span>
    </div>
  )
}
