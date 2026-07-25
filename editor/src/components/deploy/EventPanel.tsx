//! Deploy mode — the event lifecycle + admin panel: launch/lifecycle, the
//! shareable codes + join QR, live event stats, and a guest-QR scanner
//! (merged from the retired operator console) that pulls a scanned guest
//! straight into the Inspector. Moderating the running event (chat /
//! roster / director) lives in Run mode's Live source.

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useOperate } from '@/store/operate'
import { SelectionKind } from '@/store/cockpit'
import { useInspect } from '@/components/cockpit/inspect'
import { FactionPill } from '@/components/cockpit/ui'

// The Barcode Detection API isn't in the TS DOM lib; narrow shim (no `any`).
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike
function barcodeCtor(): BarcodeDetectorCtor | undefined {
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
      {title && <div className="mb-2 text-[10px] uppercase tracking-widest text-zinc-500">{title}</div>}
      {children}
    </section>
  )
}

function CodeRow({ label, code }: { label: string; code: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
        <div className="font-mono text-base tracking-widest text-zinc-100">{code}</div>
      </div>
      <button
        onClick={() => void navigator.clipboard?.writeText(code)}
        className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        title="Copy"
      >
        copy
      </button>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-800 px-2 py-1.5 text-center">
      <div className="truncate text-lg font-semibold text-zinc-100">{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  )
}

/** The live guest list — who's in the event right now. Presence comes
 *  straight off the mod snapshot (green = SSE stream open), so the host
 *  can see arrivals/drop-offs without leaving Deploy. Click → Inspector. */
function GuestList() {
  const roster = useOperate((s) => s.roster)
  const choices = useOperate((s) => s.choices)
  const inspect = useInspect()

  if (roster.length === 0) {
    return <p className="text-sm text-zinc-600">No guests yet — share the join code or QR below.</p>
  }
  // Connected guests first, then alphabetical, so the room reads top-down.
  const sorted = [...roster].sort(
    (a, b) => Number(b.online === true) - Number(a.online === true) || a.name.localeCompare(b.name),
  )
  return (
    <div className="max-h-72 overflow-auto">
      <ul className="flex flex-col">
        {sorted.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => inspect({ kind: SelectionKind.Guest, id: r.id })}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-900/60"
              data-testid={`deploy-guest-${r.id}`}
            >
              <span
                title={r.online ? 'connected now' : 'not connected'}
                className={clsx('h-2 w-2 shrink-0 rounded-full', r.online ? 'bg-emerald-400' : 'border border-zinc-600')}
              />
              <span className="min-w-0 flex-1 truncate text-zinc-200">
                {r.name} <span className="text-[10px] text-zinc-600">{r.id}</span>
              </span>
              {(choices[r.id]?.length ?? 0) > 0 && (
                <span title="waiting on a decision" className="shrink-0 text-[10px] text-indigo-300">
                  ⏳ deciding
                </span>
              )}
              {r.captured && <span className="shrink-0 text-xs text-red-400">🔒</span>}
              <FactionPill faction={r.trueFaction ?? r.faction} />
              <span className="w-20 shrink-0 truncate text-right text-xs text-zinc-500">{r.location ?? '—'}</span>
              <span className="w-12 shrink-0 text-right text-xs text-zinc-400">{r.score} pts</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Camera QR scan + manual entry → hands a guest id to `onFound`. */
function GuestScanner({ onFound }: { onFound: (id: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [scanning, setScanning] = useState(false)
  const [manual, setManual] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setScanning(false)
  }

  useEffect(() => stop, []) // stop the camera on unmount

  const start = async () => {
    setErr(null)
    const Ctor = barcodeCtor()
    if (!Ctor) {
      setErr("Camera scanning isn't supported on this browser — enter the id below.")
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      setScanning(true)
      // The <video> is always mounted (just hidden), so the ref is ready here.
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()
      const det = new Ctor({ formats: ['qr_code'] })
      const tick = async () => {
        if (!streamRef.current) return
        try {
          const codes = await det.detect(video)
          if (codes[0]?.rawValue) {
            const id = codes[0].rawValue.trim()
            stop()
            onFound(id)
            return
          }
        } catch {
          /* transient decode error — keep polling */
        }
        requestAnimationFrame(tick)
      }
      void tick()
    } catch (e) {
      setErr('Camera error: ' + (e as Error).message)
      stop()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Always mounted so the ref is ready when the camera starts; hidden when idle. */}
      <video
        ref={videoRef}
        playsInline
        className={clsx('w-full rounded-lg border border-zinc-800', !scanning && 'hidden')}
        style={{ maxHeight: 220 }}
      />
      <div className="flex gap-2">
        {scanning ? (
          <button onClick={stop} className="flex-1 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800">
            Stop camera
          </button>
        ) : (
          <button onClick={() => void start()} className="flex-1 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800">
            📷 Scan a guest's QR
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
          placeholder="…or enter a guest id (e.g. g-1a2b3c)"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && manual.trim() && onFound(manual.trim())}
        />
        <button
          onClick={() => manual.trim() && onFound(manual.trim())}
          className="shrink-0 rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
        >
          Look up
        </button>
      </div>
      {err && <div className="text-xs text-amber-400">{err}</div>}
    </div>
  )
}

export function EventPanel() {
  const event = useOperate((s) => s.event)
  const phase = useOperate((s) => s.phase)
  const busy = useOperate((s) => s.busy)
  const error = useOperate((s) => s.error)
  const scenario = useOperate((s) => s.scenario)
  const rosterLen = useOperate((s) => s.roster.length)
  const onlineLen = useOperate((s) => s.roster.filter((r) => r.online === true).length)
  const pendingLen = useOperate((s) => Object.keys(s.choices).length)
  const ledgerLen = useOperate((s) => s.ledgerLen)
  const launch = useOperate((s) => s.launch)
  const pause = useOperate((s) => s.pause)
  const resume = useOperate((s) => s.resume)
  const end = useOperate((s) => s.end)
  const reset = useOperate((s) => s.reset)
  const inspect = useInspect()

  const created = event ? new Date(event.createdAt) : null
  const createdLabel = created && !Number.isNaN(created.getTime()) ? created.toLocaleString() : null

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto max-w-3xl">
        {error && <div className="mb-3 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</div>}

        {!event ? (
          <Card title="Launch">
            <p className="mb-3 text-sm text-zinc-500">
              A <span className="text-amber-300">shared rehearsal</span> runs the event privately on the server: every
              co-writer on this project opens Run (⌘2), flips to Live, and directs the same run together — spawning
              test personas, making choices, chatting — while you talk it through on a call. <span className="text-emerald-300">Go
              live</span> when real guests should join by code.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => void launch('preview')}
                disabled={busy}
                className="flex-1 rounded-lg border border-amber-800/70 px-3 py-2 text-sm text-amber-200 hover:bg-amber-950/40 disabled:opacity-50"
                data-testid="deploy-launch-preview"
              >
                ◉ Start shared rehearsal
              </button>
              <button
                onClick={() => void launch('live')}
                disabled={busy}
                className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                ● Go live
              </button>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {event.mode === 'preview' && (
              <div className="md:col-span-2 rounded-xl border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-sm text-amber-200/90">
                ◉ <span className="font-medium">Shared rehearsal</span> — private, no guest codes needed. Co-writers on
                this project direct it together from Run (⌘2), spawning personas from the rail. End it here before
                going live.
              </div>
            )}
            {/* status */}
            <Card title="Status">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="mode" value={event.mode === 'preview' ? 'rehearsal' : event.mode} />
                <Stat label="phase" value={phase} />
                <Stat label="guests" value={rosterLen} />
                <Stat label="online now" value={onlineLen} />
                <Stat label="story events" value={ledgerLen} />
                <Stat label="stuck decisions" value={pendingLen} />
              </div>
              <div className="mt-3 space-y-1 text-xs text-zinc-500">
                {scenario && (
                  <div className="truncate">
                    Scenario: <span className="text-zinc-300">{scenario}</span>
                  </div>
                )}
                {createdLabel && (
                  <div>
                    Started: <span className="text-zinc-300">{createdLabel}</span>
                  </div>
                )}
                <div className="truncate">
                  Event id: <span className="font-mono text-zinc-400">{event.id}</span>
                </div>
              </div>
            </Card>

            {/* controls */}
            <Card title="Controls">
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  {phase === 'open' ? (
                    <button
                      onClick={() => void pause()}
                      disabled={busy}
                      className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
                    >
                      Pause
                    </button>
                  ) : (
                    <button
                      onClick={() => void resume()}
                      disabled={busy}
                      className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      Resume
                    </button>
                  )}
                  <button
                    onClick={() =>
                      window.confirm('Reset the event? The story restarts from the top and all chat is cleared.') && void reset()
                    }
                    disabled={busy}
                    className="flex-1 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    ↺ Reset
                  </button>
                </div>
                <button
                  onClick={() => window.confirm('End this event? Guests will be disconnected.') && void end()}
                  disabled={busy}
                  className="rounded-lg border border-red-900 px-3 py-2 text-sm text-red-300 hover:bg-red-950 disabled:opacity-50"
                >
                  End event
                </button>
                <a href={event.joinUrl} target="_blank" rel="noreferrer" className="text-center text-xs text-indigo-400 hover:underline">
                  → Open guest view
                </a>
              </div>
            </Card>

            {/* join */}
            <Card title="Join codes">
              <div className="flex flex-col gap-2">
                <CodeRow label="Guest event code" code={event.codes.event} />
                <CodeRow label="Performer code" code={event.codes.prime} />
                <CodeRow label="Moderator code" code={event.codes.mod} />
              </div>
            </Card>

            {/* QR */}
            <Card title="Join QR">
              <div className="rounded-lg bg-white p-2">
                <img src={`/api/qr?text=${encodeURIComponent(event.joinUrl)}`} alt="Join QR" className="mx-auto block h-44 w-44" />
              </div>
              <a href={event.joinUrl} target="_blank" rel="noreferrer" className="mt-2 block truncate text-center text-xs text-indigo-400 hover:underline">
                {event.joinUrl}
              </a>
            </Card>

            {/* who's here */}
            <div className="md:col-span-2">
              <Card title={`Guests — ${onlineLen} online · ${rosterLen} joined`}>
                <GuestList />
              </Card>
            </div>

            {/* scanner */}
            <div className="md:col-span-2">
              <Card title="Look up a guest">
                <p className="mb-2 text-xs text-zinc-500">Scan a guest's pass QR (or type their id) to open them in the Inspector.</p>
                <GuestScanner onFound={(id) => inspect({ kind: 'guest', id })} />
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
