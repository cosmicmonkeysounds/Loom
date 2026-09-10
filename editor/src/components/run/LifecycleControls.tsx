//! The run's lifecycle, in the Run header on every page: Pause / Resume,
//! a Restart split button (restart this draft · push the current draft ·
//! go live · end), and the guarded scratch lane ("test draft privately")
//! on a server project whose shared run is live or has other directors.
//! Same controls on both backends; only what a click *means* differs,
//! and that lives behind the cockpit contract. Destructive actions on a
//! LIVE run need the event code typed — real guests are in the room.

import clsx from 'clsx'
import { CockpitPhase, RunBackend, RunMode, useCockpit } from '@/store/cockpit'
import { openContextMenu, type ContextMenuEntry } from '@/store/context-menu'
import { confirmAction, promptText } from '@/store/dialog'
import { scratchAllowed, useScratch } from '@/store/run'

const btn = 'rounded px-2.5 py-1 text-xs font-medium disabled:opacity-40'

/** Ask for the event code before a destructive action on a live run. */
async function typedConfirm(title: string, body: string, code: string): Promise<boolean> {
  const typed = await promptText({
    title,
    body: `${body} Type the event code (${code}) to confirm.`,
    placeholder: code,
    confirmLabel: 'Confirm',
  })
  return typed !== null && typed.trim().toUpperCase() === code.toUpperCase()
}

export function LifecycleControls() {
  const run = useCockpit((s) => s.run)
  const phase = useCockpit((s) => s.phase)
  const busy = useCockpit((s) => s.busy)
  const directors = useCockpit((s) => s.directors)
  const roster = useCockpit((s) => s.roster)
  const pause = useCockpit((s) => s.pause)
  const resume = useCockpit((s) => s.resume)
  const restart = useCockpit((s) => s.restart)
  const pushDraft = useCockpit((s) => s.pushDraft)
  const goLive = useCockpit((s) => s.goLive)
  const end = useCockpit((s) => s.end)
  const scratch = useScratch((s) => s.active)
  const enterScratch = useScratch((s) => s.enter)
  const leaveScratch = useScratch((s) => s.leave)

  if (run === null) return null
  const live = run.mode === RunMode.Live
  const server = run.backend === RunBackend.Server
  const connected = roster.filter((r) => r.online === true).length
  const who = directors.length > 0 ? directors.join(', ') : 'you'
  const code = run.codes?.event ?? ''

  const confirmRestart = async (): Promise<boolean> => {
    if (live) return typedConfirm('Restart the live event?', `The story replays from the top for everyone; ${connected} connected guests are signed out and rejoin with the same code.`, code)
    if (server) {
      return confirmAction({
        title: 'Restart the shared rehearsal?',
        body: `Every director's console (${who}) restarts with you on the same draft; chat is cleared. Joined phones rejoin with the same code.`,
        confirmLabel: 'Restart',
        danger: true,
      })
    }
    return true
  }

  const confirmPush = async (): Promise<boolean> => {
    if (live) return typedConfirm('Push the current draft into the live event?', `The story restarts from the top on the project's current text; ${connected} connected guests are signed out and rejoin with the same code.`, code)
    if (server) {
      return confirmAction({
        title: 'Push the current draft?',
        body: `Restarts the shared rehearsal for ${who} on the project's current text, including co-writers' in-progress edits. Joined phones rejoin with the same code.`,
        confirmLabel: 'Push draft',
        danger: true,
      })
    }
    return true
  }

  const confirmGoLive = async (): Promise<boolean> =>
    confirmAction({
      title: 'Go live?',
      body:
        `The story restarts from the top; rehearsal personas and joined guests are removed; performers sign in again with the performer code; codes and QR stay the same. Directing now: ${who} — their consoles switch to LIVE.` +
        (run.stale ? ' You have unpushed edits — going live runs the launched snapshot; push the draft first if you want them.' : ''),
      confirmLabel: 'Go live',
      danger: true,
    })

  const confirmEnd = async (): Promise<boolean> => {
    if (live) return typedConfirm('End the live event?', `${connected} connected guests and every performer are disconnected for good.`, code)
    if (server) {
      return confirmAction({ title: 'End the shared rehearsal?', body: `Everyone connected — ${who}, personas, joined phones — is disconnected.`, confirmLabel: 'End', danger: true })
    }
    return confirmAction({ title: 'End this run?', body: 'The in-browser run stops. You can export it afterwards from the Log page.', confirmLabel: 'End' })
  }

  const menu = (e: React.MouseEvent) => {
    const items: ContextMenuEntry[] = [
      { label: '↺ Restart this draft', testid: 'run-restart-same', onSelect: () => void (async () => (await confirmRestart()) && (await restart()))() },
      {
        label: run.stale ? '⇪ Push current draft (changed)' : '⇪ Push current draft',
        testid: 'run-push-draft-menu',
        onSelect: () => void (async () => (await confirmPush()) && (await pushDraft()))(),
      },
    ]
    if (server && !live) {
      items.push({ label: '● Go live…', testid: 'run-go-live', onSelect: () => void (async () => (await confirmGoLive()) && (await goLive()))() })
    }
    items.push({ separator: true }, { label: '■ End', kind: 'danger', testid: 'run-end', onSelect: () => void (async () => (await confirmEnd()) && (await end()))() })
    openContextMenu(items, { x: e.clientX, y: e.clientY })
  }

  return (
    <div className="flex items-center gap-1" data-testid="run-lifecycle">
      {phase === CockpitPhase.Open ? (
        <button onClick={() => void pause()} disabled={busy} className={clsx(btn, 'bg-amber-600/80 text-white hover:bg-amber-500')} data-testid="run-pause" title="Freeze the story clock">
          ⏸ Pause
        </button>
      ) : (
        <button onClick={() => void resume()} disabled={busy} className={clsx(btn, 'bg-emerald-600 text-white hover:bg-emerald-500')} data-testid="run-resume" title="Continue the story clock">
          ▶ Resume
        </button>
      )}
      {/* On a stale rehearsal the push is the obvious next thing — surface it. */}
      {run.stale && !live && (
        <button
          onClick={() => void (async () => (await confirmPush()) && (await pushDraft()))()}
          disabled={busy}
          className={clsx(btn, 'bg-amber-600 text-white hover:bg-amber-500')}
          data-testid="run-push-draft"
          data-stale="true"
          title="The project's text changed since this run started — restart it on the current draft"
        >
          ⇪ Push draft
        </button>
      )}
      <button
        onClick={menu}
        disabled={busy}
        className={clsx(btn, 'border border-zinc-700 text-zinc-200 hover:bg-zinc-800', live && run.stale && 'border-amber-600/70')}
        data-testid="run-restart"
        data-stale={run.stale ? 'true' : 'false'}
        title={live && run.stale ? 'Restart · push draft (the text changed) · end' : 'Restart · push draft · go live · end'}
      >
        ↺ Restart ▾{live && run.stale ? <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" aria-label="draft changed" /> : null}
      </button>
      {!(run.stale && !live) && (
        // Keep the push control addressable whenever the amber one isn't —
        // quiet when nothing changed, amber-dotted on a stale LIVE run (where
        // the push needs the typed confirm rather than a big button).
        <button
          onClick={() => void (async () => (await confirmPush()) && (await pushDraft()))()}
          disabled={busy}
          className={clsx(btn, run.stale ? 'text-amber-300 hover:text-amber-200' : 'text-zinc-500 hover:text-zinc-200')}
          data-testid="run-push-draft"
          data-stale={run.stale ? 'true' : 'false'}
          title={run.stale ? "The project's text changed — push it into the live event (typed confirm)" : 'The run is on the current draft'}
        >
          ⇪
        </button>
      )}
      {scratch ? (
        <button
          onClick={() => void leaveScratch()}
          className={clsx(btn, 'border border-violet-700/70 text-violet-200 hover:bg-violet-950/40')}
          data-testid="run-scratch-leave"
          title="Drop this private run and return to the shared one"
        >
          ← Back to the shared run
        </button>
      ) : (
        server &&
        scratchAllowed(run, directors) && (
          <button
            onClick={() => void enterScratch({ mode: run.mode, guests: roster.length })}
            disabled={busy}
            className={clsx(btn, 'border border-violet-800/60 text-violet-300 hover:bg-violet-950/40')}
            data-testid="run-scratch-enter"
            title="Try the current draft in a private in-browser run — the shared run is untouched"
          >
            ⚗ Test draft privately
          </button>
        )
      )}
    </div>
  )
}
