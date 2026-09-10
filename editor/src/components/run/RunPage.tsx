//! The Run page — the first tab, front of house only. With no run: one
//! centred panel that explains what a rehearsal does and starts one (or
//! goes live, on a server project). With a run: getting people in (join
//! codes, QR, join link, performer sign-in per character), who is
//! directing, and guest lookup by pass QR. The lifecycle (pause / restart
//! / push draft / go live / end) lives ONCE, in the stage header — never
//! here; the rail, the Chat decision tray, and the Inspector cover status,
//! personas, and pending choices. Reads the cockpit contract only, so the
//! page is identical on both backends (a local run just has no codes).

import { useContext, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { CockpitContext, RunBackend, RunMode, useCockpit } from '@/store/cockpit'
import { useWorkspace } from '@/store/workspace'
import { useRunBackend, useScratch } from '@/store/run'
import { confirmAction } from '@/store/dialog'
import { downloadRunExport } from '@/lib/run-export'
import { useInspect } from '@/components/cockpit/inspect'
import { FactionPill } from '@/components/cockpit/ui'
import { runAge } from './run-chrome'

// The Barcode Detection API isn't in the TS DOM lib; narrow shim (no `any`).
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike
function barcodeCtor(): BarcodeDetectorCtor | undefined {
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
}

function Card({ title, children, tone }: { title?: string; children: React.ReactNode; tone?: 'live' }) {
  return (
    <section className={clsx('rounded-xl border bg-zinc-950 p-3', tone === 'live' ? 'border-emerald-800/60' : 'border-zinc-800')}>
      {title && <div className="mb-2 text-[10px] uppercase tracking-widest text-zinc-500">{title}</div>}
      {children}
    </section>
  )
}

function CodeRow({ label, code, testid }: { label: string; code: string; testid: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
        <div className="font-mono text-base tracking-widest text-zinc-100" data-testid={testid}>
          {code}
        </div>
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

/** The run that just ended, if any — exportable, and named. */
function LastRunLine() {
  const lastRun = useCockpit((s) => s.lastRun)
  const store = useContext(CockpitContext)
  if (lastRun === null) return null
  const when = new Date(lastRun.endedAt)
  return (
    <p className="mt-4 text-xs text-zinc-500" data-testid="run-last-run">
      Ended by {lastRun.endedBy ?? 'you'} at {Number.isNaN(when.getTime()) ? '—' : when.toLocaleTimeString()} ·{' '}
      <button onClick={() => downloadRunExport(store.getState())} className="text-indigo-400 underline hover:text-indigo-200">
        Export that run
      </button>
    </p>
  )
}

/** No run yet: what a rehearsal does, and the one button that starts it. */
function EmptyState() {
  const backend = useRunBackend()
  const projectName = useWorkspace((s) => s.projectName ?? s.root?.name ?? 'this story')
  const busy = useCockpit((s) => s.busy)
  const error = useCockpit((s) => s.error)
  const startRun = useCockpit((s) => s.startRun)
  const enterScratch = useScratch((s) => s.enter)
  const server = backend === RunBackend.Server

  const goLive = async () => {
    const ok = await confirmAction({
      title: 'Go live with real guests?',
      body: 'Guests can join by code the moment it starts. Rehearse first if you have not — a rehearsal promotes to live in place, keeping its codes.',
      confirmLabel: 'Go live',
      danger: true,
    })
    if (ok) await startRun(RunMode.Live)
  }

  return (
    <div className="grid h-full place-items-center p-6">
      <div className="w-full max-w-md text-center" data-testid="run-empty">
        <h2 className="text-lg font-semibold text-zinc-100">Rehearse {projectName}</h2>
        <p className="mt-2 text-sm text-zinc-500">
          A persona named after you joins, the entry beat plays, its choices dock in Chat, and the story map lights up
          as you go.{server ? ' Every co-writer on this project lands in the same run.' : ''}
        </p>
        <div className="mt-5 flex flex-col items-center gap-2">
          <button
            onClick={() => void startRun(RunMode.Rehearsal)}
            disabled={busy}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            data-testid="run-start"
          >
            ▶ Start rehearsal
          </button>
          {server ? (
            <button onClick={() => void goLive()} disabled={busy} className="text-xs text-emerald-400/90 underline hover:text-emerald-200" data-testid="run-go-live">
              Go live with real guests →
            </button>
          ) : (
            <p className="text-xs text-zinc-600">
              Runs in this browser. Hosting a live event needs a server project — create one from the launchpad.
            </p>
          )}
        </div>
        {error !== null && (
          <div className="mt-4 rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-left text-xs text-red-300" data-testid="run-error">
            <div>{error}</div>
            {server && (
              <button onClick={() => void enterScratch()} className="mt-2 rounded border border-violet-800/60 px-2 py-1 text-violet-200 hover:bg-violet-950/40" data-testid="run-scratch-enter">
                ⚗ Test privately in this browser
              </button>
            )}
          </div>
        )}
        <LastRunLine />
      </div>
    </div>
  )
}

/** Getting people in — codes, QR, the join link, performer sign-in. */
function JoinCard() {
  const run = useCockpit((s) => s.run)
  const cast = useCockpit((s) => s.cast)
  if (run === null || run.codes === null || run.joinUrl === null) return null
  const live = run.mode === RunMode.Live
  return (
    <Card title="Join" tone={live ? 'live' : undefined}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <CodeRow label="Guest event code" code={run.codes.event} testid="run-join-code-event" />
          <CodeRow label="Performer code" code={run.codes.prime} testid="run-join-code-prime" />
          <CodeRow label="Moderator code" code={run.codes.mod} testid="run-join-code-mod" />
          <a href={run.joinUrl} target="_blank" rel="noreferrer" className="text-center text-xs text-indigo-400 hover:underline">
            Open guest view ↗
          </a>
        </div>
        <div>
          <div className="rounded-lg bg-white p-2">
            <img src={`/api/qr?text=${encodeURIComponent(run.joinUrl)}`} alt="Join QR" className="mx-auto block h-40 w-40" />
          </div>
          <a href={run.joinUrl} target="_blank" rel="noreferrer" className="mt-2 block truncate text-center text-xs text-indigo-400 hover:underline">
            {run.joinUrl}
          </a>
        </div>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        {live
          ? 'Guests join with the event code; performers sign in at the play app’s performer station with their character name + the performer code.'
          : 'These codes work now — anyone with the event code can join this rehearsal. They stay the same when you go live, so you can print them.'}
      </p>
      {cast.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-zinc-500">Performers</div>
          <ul className="flex flex-col gap-1">
            {cast.map((c) => {
              const line = `${c.id} · performer code ${run.codes!.prime}`
              return (
                <li key={c.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 px-2 py-1 text-xs">
                  {c.online !== undefined && (
                    <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', c.online ? 'bg-emerald-400' : 'border border-zinc-600')} title={c.online ? 'a performer is signed in' : 'nobody signed in as this character'} />
                  )}
                  <span className="min-w-0 flex-1 truncate text-zinc-200">{c.id}</span>
                  <FactionPill faction={c.faction} />
                  <button onClick={() => void navigator.clipboard?.writeText(line)} className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" title={`Copy “${line}”`}>
                    copy sign-in
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Card>
  )
}

function DirectingCard() {
  const run = useCockpit((s) => s.run)
  const directors = useCockpit((s) => s.directors)
  const me = useCockpit((s) => s.me)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  if (run === null) return null
  const age = runAge(run.startedAt, now)
  return (
    <Card title="Directing now">
      {directors.length === 0 ? (
        <p className="text-xs text-zinc-600">Only you.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" data-testid="run-directors">
          {directors.map((name, i) => (
            <li key={`${name}-${i}`} className="rounded-full border border-amber-800/60 bg-amber-950/30 px-2 py-0.5 text-xs text-amber-200">
              {name}
              {name === me ? ' (you)' : ''}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-zinc-600">
        {run.startedBy ? `Started by ${run.startedBy}` : 'Started'}
        {age !== null ? ` · ${age} ago` : ''}. Every co-writer on this project can open Run and direct alongside you — fire
        beats, answer stuck choices, spawn personas, speak as anyone. Everything lands in the same journal, attributed.
      </p>
    </Card>
  )
}

function LookupCard() {
  const inspect = useInspect()
  return (
    <Card title="Look up a guest">
      <p className="mb-2 text-xs text-zinc-500">Scan a guest's pass QR (or type their id) to open them in the Inspector.</p>
      <GuestScanner onFound={(id) => inspect({ kind: 'guest', id })} />
    </Card>
  )
}

function LocalCard() {
  const run = useCockpit((s) => s.run)
  const shared = useScratch((s) => s.shared)
  const leaveScratch = useScratch((s) => s.leave)
  if (run === null) return null
  return (
    <Card title={run.scratch ? 'Scratch run' : 'Local run'}>
      <p className="text-sm text-zinc-400">Runs in this browser — nothing reaches anyone. Personas you add are yours alone.</p>
      {run.scratch && (
        <>
          {shared !== null && (
            <p className="mt-2 text-xs text-zinc-500" data-testid="run-scratch-shared">
              Shared run when you stepped out: <span className={shared.mode === RunMode.Live ? 'text-emerald-300' : 'text-amber-300'}>{shared.mode === RunMode.Live ? 'LIVE' : 'rehearsal'}</span> · {shared.guests} guests
            </p>
          )}
          <button onClick={() => void leaveScratch()} className="mt-3 rounded-lg border border-violet-700/70 px-3 py-1.5 text-sm text-violet-200 hover:bg-violet-950/40" data-testid="run-scratch-leave-page">
            ← Back to the shared run
          </button>
        </>
      )}
    </Card>
  )
}

export function RunPage() {
  const run = useCockpit((s) => s.run)
  const error = useCockpit((s) => s.error)
  if (run === null) return <EmptyState />
  const server = run.backend === RunBackend.Server
  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {error && <div className="rounded bg-red-950 px-3 py-2 text-sm text-red-300" data-testid="run-error">{error}</div>}
        {server ? (
          <>
            <JoinCard />
            <DirectingCard />
            <LookupCard />
          </>
        ) : (
          <LocalCard />
        )}
      </div>
    </div>
  )
}
