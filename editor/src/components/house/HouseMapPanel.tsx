//! Run → House → 🗺 Map (wave 49, `docs/loom-w49-contract.md` C7): the real
//! map editor in-process, signed in with the run's moderator code, so a
//! director is never asked for a passcode. The editor itself
//! (`@loom/reinstall/map`, three.js behind it) is a lazy chunk; everything
//! here stays in the first load.
//!
//! In the Tauri shell the map's `window.confirm`s answer false with no UI, so
//! there it offers *Open in browser* in place of the embed. Beside the embed,
//! **Open in a new tab ↗** is the map's own page.

import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { ChunkBoundary, retryImport } from '@loom/play/lazy-chunk.tsx'
import { useCockpit } from '@/store/cockpit'
import { useDialog } from '@/store/dialog'
import { useHouseView } from '@/store/house-view'
import { mapApi } from '@/lib/api'
import { isDesktop } from '@/lib/desktop'
import { mapPageUrl, serverOrigin } from '@/lib/house-map-view'

const MapEmbed = lazy(retryImport(() => import('@loom/reinstall/map').then((m) => ({ default: m.MapEmbed }))))

const API_BASE: string | undefined = import.meta.env.VITE_LOOM_API

const link = 'rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-indigo-300 hover:bg-zinc-900'

function Say({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center text-sm text-zinc-500" data-testid="house-map-say">
      <div className="max-w-md">
        <p className="text-zinc-300">{title}</p>
        {children !== undefined && <div className="mt-2">{children}</div>}
      </div>
    </div>
  )
}

/** A dialog over the map has the keys. */
const dialogUp = () => useDialog.getState().current !== null

/** The panel's body once it has a run: one sign-in per event and code. A new
 *  token (the codes changed, the old one was refused) reaches the same
 *  mounted editor, so a draft stays. */
function SignedInMap({ eventId, code, title, joinUrl }: { eventId: string; code: string; title: string; joinUrl: string | null }) {
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const shown = useHouseView((s) => s.mapShown)
  const signInAgain = useCallback(() => setTick((n) => n + 1), [])
  useEffect(() => {
    let cancelled = false
    mapApi.login(eventId, code).then(
      (t) => {
        if (cancelled) return
        setToken(t)
        setError(null)
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      cancelled = true
    }
  }, [eventId, code, tick])

  const url = mapPageUrl(joinUrl, code)
  const origin = serverOrigin(joinUrl)
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="house-map-panel">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-2 py-1 text-[11px] text-zinc-500">
        <span>The map this run plays. A save reaches every game and terminal at once.</span>
        {error !== null && (
          <span className="text-red-400" data-testid="house-map-error">
            Couldn’t sign in to the map: {error}{' '}
            <button type="button" className="underline" onClick={signInAgain}>
              Try again
            </button>
          </span>
        )}
        {url !== null && (
          <a href={url} target="_blank" rel="noreferrer" className={`ml-auto ${link}`} data-testid="house-map-new-tab">
            Open in a new tab ↗
          </a>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {token === null ? (
          error === null && <Say title="Signing in to the map…" />
        ) : (
          <ChunkBoundary
            fallback={() => (
              <Say title="The map editor didn’t load: the connection dropped, or Loom was just updated.">
                <button type="button" className={link} onClick={() => window.location.reload()} data-testid="house-map-reload">
                  Reload
                </button>
              </Say>
            )}
          >
            <Suspense fallback={<Say title="Loading the map editor…" />}>
              <MapEmbed
                eventId={eventId}
                token={token}
                title={title}
                shown={shown}
                keysOff={dialogUp}
                onRevoked={signInAgain}
                className="absolute inset-0"
                {...(API_BASE !== undefined && API_BASE !== '' ? { apiBase: API_BASE } : {})}
                {...(origin !== null ? { linkOrigin: origin } : {})}
              />
            </Suspense>
          </ChunkBoundary>
        )}
      </div>
    </div>
  )
}

/** The Tauri shell: the map's own page, in a real browser. */
function OpenInBrowser({ url }: { url: string | null }) {
  const [copied, setCopied] = useState(false)
  return (
    <Say title="The map opens in your browser from the desktop app.">
      <p>Its save and delete questions don’t work in this window. It is the same map, signed in as this run.</p>
      {url !== null && (
        <p className="mt-3 flex justify-center gap-2">
          <a href={url} target="_blank" rel="noreferrer" className={link} data-testid="house-map-browser">
            Open in browser ↗
          </a>
          <button
            type="button"
            className={link}
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(() => setCopied(true))
            }}
            data-testid="house-map-copy"
          >
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
        </p>
      )}
    </Say>
  )
}

export function HouseMapPanel() {
  const run = useCockpit((s) => s.run)
  const eventId = run?.eventId ?? null
  const code = run?.codes?.mod ?? null
  if (run === null || eventId === null || code === null) {
    return <Say title="Start a rehearsal to edit the map.">The map is edited on the run: start one from the Run page, then come back here.</Say>
  }
  if (isDesktop()) return <OpenInBrowser url={mapPageUrl(run.joinUrl, code)} />
  return <SignedInMap key={eventId} eventId={eventId} code={code} title={run.scenario ?? ''} joinUrl={run.joinUrl} />
}
