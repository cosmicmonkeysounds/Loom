//! The dismissable banner under the Run header: a lifecycle transition
//! someone else caused ("Ana pushed the current draft — the story
//! restarted"), or a run this console adopted because a co-writer had
//! already started it. Read from `CockpitState.notice` on both backends.

import clsx from 'clsx'
import { useCockpit } from '@/store/cockpit'

export function LifecycleBanner() {
  const notice = useCockpit((s) => s.notice)
  const dismiss = useCockpit((s) => s.dismissNotice)
  if (notice === null) return null
  const at = new Date(notice.at)
  const when = Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString()
  return (
    <div
      className={clsx(
        'flex items-center gap-3 border-b px-3 py-1.5 text-xs',
        notice.tone === 'warn' ? 'border-amber-800/60 bg-amber-950/30 text-amber-200' : 'border-indigo-800/60 bg-indigo-950/30 text-indigo-200',
      )}
      role="status"
      data-testid="run-notice"
    >
      <span className="min-w-0 flex-1 truncate">{notice.text}</span>
      <span className="shrink-0 text-[10px] opacity-70">{when}</span>
      <button
        onClick={dismiss}
        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] opacity-70 hover:bg-white/10 hover:opacity-100"
        aria-label="Dismiss"
        data-testid="run-notice-dismiss"
      >
        ✕
      </button>
    </div>
  )
}
