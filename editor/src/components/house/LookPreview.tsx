//! Run → House → Cue designer: a look played on screen. One lamp per
//! fixture the look reaches (named, with its room), animated off
//! `@loom/house` `previewAt` over the look's real plan (clamped for safety,
//! the fixture's caps applied), with play / pause, a scrubber and the
//! step markers. Nothing reaches the house from here; ▶ Test does. Keyed
//! by the look's name, so another look starts from 0.

import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LAMP_SETTLED, lampCss, planLook, previewAt, previewLength, resolveLightTargets, lookTargets, type HouseMap, type LightsConfig } from '@loom/house'
import { secondsText } from '@loom/core/house-desk'
import { stepMarkers } from '@/lib/cue-designer'
import { btn } from './ui'

export function LookPreview({ lights, house, name, step, onStep }: { lights: LightsConfig; house: HouseMap | null; name: string; step: number | null; onStep: (i: number) => void }) {
  const look = lights.looks[name]
  const plan = useMemo(() => planLook(lights, house, name), [lights, house, name])
  const fixtures = useMemo(() => (look === undefined ? [] : resolveLightTargets(lights, house, lookTargets(look)).fixtures), [lights, house, look])
  const length = plan === null ? 0 : previewLength(plan)
  const { markers, span } = useMemo(() => (look === undefined ? { markers: [], span: 1000 } : stepMarkers(look)), [look])
  // The scrubber covers one pass (a loop: its span, played over and over).
  const total = length === null ? span : Math.max(length, 500)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const started = useRef<{ wall: number; at: number } | null>(null)

  useEffect(() => {
    if (!playing) {
      started.current = null
      return
    }
    let raf = 0
    started.current = { wall: performance.now(), at: t >= total && length !== null ? 0 : t }
    const tick = () => {
      const s = started.current
      if (s === null) return
      const now = s.at + (performance.now() - s.wall)
      if (length !== null && now >= total) {
        setT(total)
        setPlaying(false)
        return
      }
      setT(now)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // `t` is read once at start on purpose (a scrub while playing restarts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, total, length])

  if (look === undefined || plan === null) return null
  const shown = previewAt(plan, fixtures, t)
  const byId = new Map(lights.fixtures.map((f) => [f.id, f]))
  const roomName = (id: string) => house?.rooms.find((r) => r.id === id)?.label || id
  const cursor = length === null ? (t % span) / span : Math.min(1, t / total)

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-black/60 p-3" data-testid="designer-preview">
      <div className="flex min-h-24 flex-wrap items-end justify-center gap-5">
        {fixtures.length === 0 && <p className="self-center text-xs text-amber-300">This look reaches no light: pick targets below.</p>}
        {fixtures.map((id) => {
          const l = shown[id] ?? LAMP_SETTLED
          const f = byId.get(id)
          const css = lampCss(l)
          const glow = Math.round(6 + (28 * l.brightness) / 254)
          return (
            <div key={id} className="flex w-24 flex-col items-center gap-1 text-center" data-testid={`designer-lamp-${id}`}>
              <div
                className="h-12 w-12 rounded-full border border-zinc-700 transition-none"
                style={{ background: css, boxShadow: `0 0 ${glow}px ${Math.round(glow / 2)}px ${css}` }}
                title={`${l.brightness}/254 ${l.color}${l.effect !== null ? ` · ${l.effect}` : ''}`}
              />
              <span className="w-full truncate text-[11px] text-zinc-200">{f?.name ?? id}</span>
              <span className="w-full truncate text-[10px] text-zinc-500">
                {f !== undefined ? `${roomName(f.room)} · ${f.kind === 'wled' ? 'WLED' : 'Zigbee'}` : ''}
                {f?.safety === true ? ' · safety' : ''}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-2">
        <button className={btn} onClick={() => setPlaying((p) => !p)} data-testid="designer-preview-play">
          {playing ? '❚❚ Pause' : t > 0 && (length === null || t < total) ? '▶ Resume' : '▶ Preview'}
        </button>
        <button
          className={btn}
          onClick={() => {
            setPlaying(false)
            setT(0)
          }}
          disabled={t === 0}
        >
          ⏮
        </button>
        <div className="relative h-7 flex-1" title="Drag to scrub">
          <div className="absolute inset-x-0 top-3 h-1 rounded bg-zinc-800" />
          {markers.map((m) => (
            <button
              key={m.index}
              onClick={() => onStep(m.index)}
              className={clsx('absolute top-0.5 h-5 w-2.5 -translate-x-1/2 rounded-sm border', step === m.index ? 'border-indigo-300 ring-1 ring-indigo-400' : 'border-zinc-600')}
              style={{ left: `${Math.min(100, ((m.x * span) / (length === null ? span : total)) * 100)}%`, background: m.off ? '#111' : (m.color ?? '#71717a'), opacity: m.level === null ? 0.7 : 0.35 + 0.65 * m.level }}
              title={`Step ${m.index + 1} at ${secondsText(m.x * span)}`}
            />
          ))}
          <div className="pointer-events-none absolute top-0 h-7 w-px bg-white/80" style={{ left: `${cursor * 100}%` }} />
          <input
            type="range"
            min={0}
            max={total}
            step={10}
            value={Math.min(t, total)}
            onChange={(e) => {
              setPlaying(false)
              setT(Number(e.target.value))
            }}
            className="absolute inset-0 h-7 w-full cursor-pointer opacity-0"
            aria-label="Preview time"
          />
        </div>
        <span className="w-20 text-right font-mono text-[11px] text-zinc-400">
          {secondsText(Math.round(t))}
          {length === null ? ' ↻' : ` / ${secondsText(total)}`}
        </span>
      </div>
      <p className="text-[10px] text-zinc-500">A preview: timing, colours, brightness and the safety floor are exact; real bulbs fade on their own curve and their built-in effects only roughly look like this.</p>
    </div>
  )
}
