//! Run → House → Cue designer: how the story fires a look, a sound or a
//! desk cue. The line to write (copy it), every line of the story that
//! already uses it (click to open it in Writing), and for a desk cue the
//! story events it fires with whether a `when` hears each.

import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { storyUses, whereOf, type StoryUseKind } from '@/lib/cue-designer'
import { openUse } from '@/lib/story-docs'
import { btn, heading } from './ui'

export function CopyLine({ text, testId }: { text: string; testId?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="flex items-center gap-2">
      <code className="whitespace-pre rounded bg-zinc-900 px-2 py-0.5 font-mono text-xs text-emerald-200" data-testid={testId}>
        {text}
      </code>
      <button
        className={btn}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(
            () => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            },
            () => undefined,
          )
        }}
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </span>
  )
}

/** The story's uses of `name` as `kind`, with the line to write when there are none. */
export function StoryHookup({
  kind,
  name,
  line,
  docs,
  extra,
  events,
}: {
  kind: StoryUseKind
  name: string
  /** The statement that fires it (`cue heart_wake`). */
  line: string
  docs: ReadonlyArray<{ uri: string; text: string }>
  extra?: React.ReactNode
  /** A desk cue's story events and whether the story hears them. */
  events?: ReadonlyArray<{ event: string; heard: boolean }>
}) {
  const uses = useMemo(() => storyUses(docs, kind, name), [docs, kind, name])
  return (
    <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-900/40 p-2" data-testid="designer-hookup">
      <div className={heading}>In the story</div>
      <p className="text-[11px] text-zinc-400">Write this line in a beat to fire it there (directors can also fire it from here or the Desk):</p>
      <CopyLine text={line} testId="designer-hookup-line" />
      {uses.length === 0 ? (
        <p className="text-[11px] text-amber-300/90">Not in the story yet: nothing fires it but a test or a desk GO.</p>
      ) : (
        <ul className="space-y-0.5">
          {uses.map((u) => (
            <li key={`${u.uri}:${u.line}`}>
              <button onClick={() => openUse(u)} className="flex w-full min-w-0 items-baseline gap-2 rounded px-1 text-left text-[11px] hover:bg-zinc-800" title="Open in Writing">
                <span className="shrink-0 font-mono text-indigo-300">{whereOf(u)}</span>
                <span className="truncate font-mono text-zinc-400">{u.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {events !== undefined && events.length > 0 && (
        <div className="space-y-1 pt-1">
          <p className="text-[11px] text-zinc-400">It tells the story, which listens with a <span className="font-mono">when</span>:</p>
          {events.map((e) => (
            <div key={e.event} className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className={clsx('font-mono', e.heard ? 'text-emerald-300' : 'text-amber-300')}>⚡ {e.event}</span>
              <span className="text-zinc-500">{e.heard ? '· the story hears it' : '· no when hears it yet:'}</span>
              {!e.heard && <CopyLine text={`when ${e.event}:`} />}
            </div>
          ))}
        </div>
      )}
      {extra}
    </div>
  )
}
