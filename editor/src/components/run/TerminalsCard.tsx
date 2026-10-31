//! The terminal heartbeat card (OCT31 K-29) and its header pill. Every wall
//! terminal and the TV report in every 1–2 s; one silent for 20 s turns red
//! and the editor chimes (again every minute until acknowledged). The card
//! also carries the TV-voice mute (K-18). Reads `store/terminals.ts`, which
//! App.tsx binds to the server run — a local run has no terminals, so both
//! render nothing there. The chess phone runs the Lichess app and never
//! reports (OP-12 covers it). Each row carries the device badges a current
//! terminal build reports and an **identify** button (SW-SCR-21): install
//! day's "which tablet is this?" — its name full screen for 10 s. A room
//! terminal (wave 7) says its room; one off the server-room spot is amber.
//! Wave 14: each row says which house map spot it claims (amber when the spot
//! isn't on the map playing now, or two live terminals claim it), the map's
//! spots no live terminal claims are listed, and **Set up a terminal**
//! (`TerminalSetup.tsx`) builds a tablet's provisioning link from pickers.
//! Wave 20: the server-room terminal's 🚪 door sensor badges (green shut /
//! amber open with the level, red fault, a small ⚠ warning, amber override
//! while the story follows the 🚪 buttons) lead its row (`doorBadges`).
//! Wave 22: its 🔌 patch bay badges follow (the cable count, ✓ complete, an
//! amber ? for inputs between levels, red fault, amber *buttons* while the
//! story follows the 🔌 buttons: `patchBadges`).
//! Wave 59: 🎭 the Task Manager costume's switch, which is the crew's kill
//! switch, and its link (`docs/trapped/costume.md`). The link carries the
//! costume's narrow token: copy it, never post it.
//! Wave 59p: 📷 the terminals' photos (`PhotosCard.tsx`).

import { VOICE_FLAVOURS, VOICE_FLAVOUR_LABEL, VOICE_FX_MODES, type VoiceFxMode } from '@loom/core/voice-fx'
import clsx from 'clsx'
import { CockpitTab, useCockpit } from '@/store/cockpit'
import { useTerminals } from '@/store/terminals'
import { ROOM_TERMINAL_SPOT, TerminalStatus, formatSilence, isTvView, majorityVersion, strayRoom, terminalBadges } from '@/lib/terminals'
import { SpotClaim, doubleClaims, spotClaim, unclaimedSpots, viewOption } from '@/lib/terminal-setup'
import { TerminalSetup } from './TerminalSetup'
import { PhotosCard } from './PhotosCard'

/** `📟 5/6` in the stage header — red while any terminal is silent; click → Run. */
export function TerminalsPill() {
  const rows = useTerminals((s) => s.rows)
  const reachable = useTerminals((s) => s.reachable)
  const setTab = useCockpit((s) => s.setTab)
  if (rows.length === 0 && reachable) return null
  const silent = rows.filter((r) => r.status === TerminalStatus.Silent).length
  const bad = silent > 0 || !reachable
  return (
    <button
      onClick={() => setTab(CockpitTab.Run)}
      className={clsx(
        'rounded-full border px-2 py-0.5 text-[11px]',
        bad ? 'animate-pulse border-red-700 bg-red-950/60 text-red-200' : 'border-emerald-800/70 bg-emerald-950/30 text-emerald-200',
      )}
      title={!reachable ? 'Can’t reach the server — terminal status unknown' : bad ? `${silent} terminal(s) silent — open Run` : 'Every terminal is reporting'}
      data-testid="run-terminals-pill"
    >
      📟 {rows.length - silent}/{rows.length}
    </button>
  )
}

const VOICE_FX_LABEL: Record<VoiceFxMode, string> = { auto: 'Auto', clean: 'Clean', broken: 'Broken' }

/** Wave 56: how broken his voice is. Auto follows the night; Clean is the kill
 *  switch; a flavour breaks his next lines in that way, in any mode. */
function VoiceFxRow({ mode }: { mode: VoiceFxMode }) {
  const setVoiceFx = useTerminals((s) => s.setVoiceFx)
  const fireVoiceShot = useTerminals((s) => s.fireVoiceShot)
  return (
    <div className="mb-2 rounded border border-zinc-800 px-2 py-1" data-testid="run-terminals-voicefx">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11px] text-zinc-400" title="Trabolta's voice comes apart towards the end of the night and in the major glitches. It follows the story by itself.">
          🌀 His voice
        </span>
        {VOICE_FX_MODES.map((m) => (
          <button
            key={m}
            onClick={() => void setVoiceFx(m)}
            aria-pressed={mode === m}
            className={clsx('rounded border px-2 py-0.5 text-[11px]', mode === m ? 'border-emerald-700 bg-emerald-950/40 text-emerald-200' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-900')}
            data-testid={`run-terminals-voicefx-${m}`}
          >
            {VOICE_FX_LABEL[m]}
          </button>
        ))}
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-zinc-500">Fire a flavour (8 s, on his next words)</summary>
        <div className="mt-1 flex flex-wrap gap-1">
          {VOICE_FLAVOURS.map((f) => (
            <button key={f} onClick={() => void fireVoiceShot(f)} className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-900" data-testid={`run-terminals-voicefx-shot-${f}`}>
              {VOICE_FLAVOUR_LABEL[f]}
            </button>
          ))}
        </div>
      </details>
    </div>
  )
}

/** Wave 59: the iPad on Task Manager's chest. Off, every press on it reads Not Responding. */
function CostumeRow({ costume }: { costume: { on: boolean; url: string } }) {
  const setCostume = useTerminals((s) => s.setCostume)
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 rounded border border-zinc-800 px-2 py-1" data-testid="run-terminals-costume">
      <span className="mr-1 text-[11px] text-zinc-400" title="Task Manager’s CTRL ALT DELETE iPad. Anyone at the party can press it; the server decides what lands.">
        🎭 Costume
      </span>
      <button
        onClick={() => void setCostume(!costume.on)}
        aria-pressed={costume.on}
        className={clsx('rounded border px-2 py-0.5 text-[11px]', costume.on ? 'border-emerald-700 bg-emerald-950/40 text-emerald-200' : 'border-amber-700 bg-amber-950/40 text-amber-200')}
        data-testid="run-terminals-costume-switch"
      >
        {costume.on ? 'On' : 'Off'}
      </button>
      <button
        onClick={() => void navigator.clipboard?.writeText(costume.url)}
        className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-900"
        title="Copy the link for the iPad. It holds the costume’s token: send it to the iPad, never post it."
        data-testid="run-terminals-costume-link"
      >
        Copy link
      </button>
    </div>
  )
}

export function TerminalsCard() {
  const rows = useTerminals((s) => s.rows)
  const reachable = useTerminals((s) => s.reachable)
  const acked = useTerminals((s) => s.acked)
  const voiceMuted = useTerminals((s) => s.voiceMuted)
  const ack = useTerminals((s) => s.ack)
  const forget = useTerminals((s) => s.forget)
  const setVoiceMuted = useTerminals((s) => s.setVoiceMuted)
  const muteError = useTerminals((s) => s.muteError)
  const voiceFx = useTerminals((s) => s.voiceFx)
  const costume = useTerminals((s) => s.costume)
  const identify = useTerminals((s) => s.identify)
  const identifyError = useTerminals((s) => s.identifyError)
  const map = useTerminals((s) => s.map)
  const doorOverride = useTerminals((s) => s.doorOverride)
  const patchOverride = useTerminals((s) => s.patchOverride)
  const majority = majorityVersion(rows)
  const doubled = doubleClaims(rows)
  const unclaimed = map === null ? [] : unclaimedSpots(map, rows)
  const spotName = (id: string) => map?.find((t) => t.id === id)?.name ?? id
  const silent = rows.some((r) => r.status === TerminalStatus.Silent)
  const hasTv = rows.some((r) => isTvView(r.view))

  return (
    <section
      className={clsx('rounded-xl border bg-zinc-950 p-3', silent || !reachable ? 'border-red-800/80' : rows.length > 0 ? 'border-emerald-800/60' : 'border-zinc-800')}
      data-testid="run-terminals"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">Terminals</span>
        {(hasTv || voiceMuted === true) && voiceMuted !== null && (
          <button
            onClick={() => void setVoiceMuted(!voiceMuted)}
            className={clsx(
              'ml-auto rounded border px-2 py-0.5 text-[11px]',
              voiceMuted ? 'border-amber-700 bg-amber-950/40 text-amber-200' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-900',
            )}
            title="The TV speaks Trabolta’s lines in the Desktop room; muted = captions only"
            data-testid="run-terminals-voice"
          >
            {voiceMuted ? '🔇 TV voice muted' : '🔊 TV voice on'}
          </button>
        )}
      </div>
      {voiceFx !== null && (hasTv || voiceFx !== 'auto') && <VoiceFxRow mode={voiceFx} />}
      {costume !== null && <CostumeRow costume={costume} />}
      {muteError !== null && (
        <p className="mb-2 rounded bg-amber-950/60 px-2 py-1 text-xs text-amber-200" data-testid="run-terminals-mute-error">
          {muteError}
        </p>
      )}
      {identifyError !== null && (
        <p className="mb-2 rounded bg-amber-950/60 px-2 py-1 text-xs text-amber-200" data-testid="run-terminals-identify-error">
          {identifyError}
        </p>
      )}
      {!reachable && (
        <p className="mb-2 rounded bg-red-950/60 px-2 py-1 text-xs text-red-200" data-testid="run-terminals-unreachable">
          Can’t reach the server — the terminals may be fine. Check this laptop’s connection (and the house uplink).
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-600">
          No terminal has reported yet. Each wall tablet and the TV shows up here once it polls; one silent for 20 s turns red
          and this editor chimes.
        </p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="run-terminals-list">
          {rows.map((r) => {
            const dead = r.status === TerminalStatus.Silent
            return (
              <li
                key={r.name}
                className={clsx('flex items-center gap-2 rounded px-2 py-1 text-xs', dead ? 'bg-red-950/50 text-red-100' : 'text-zinc-300')}
                data-testid="run-terminal-row"
                data-status={r.status}
              >
                <span className={clsx('h-2 w-2 shrink-0 rounded-full', dead ? 'bg-red-500' : 'bg-emerald-500')} />
                <span className="font-medium">{r.name}</span>
                <SpotBadge spot={r.spot} claim={spotClaim(r.spot, map)} doubled={!dead && doubled.has(r.spot)} name={spotName(r.spot)} />
                <span className="text-zinc-500" title={viewOption(r.view)?.help}>
                  {r.view}
                  {r.remembered ? ' · not seen since the server restarted' : ''}
                </span>
                {r.room !== '' && (
                  <span
                    className={clsx('rounded px-1 text-[10px]', strayRoom(r) ? 'bg-amber-950/60 text-amber-200' : 'text-zinc-400')}
                    title={
                      strayRoom(r)
                        ? `A room terminal off the ${ROOM_TERMINAL_SPOT} spot: it sleeps until ${r.room} opens and speaks that room’s lines. If it was the TV once, clear its room in ⚙.`
                        : `A room terminal: asleep until ${r.room} is open to everyone, then it speaks that room’s lines`
                    }
                    data-testid="run-terminal-room"
                    data-stray={strayRoom(r) ? 'true' : undefined}
                  >
                    room {r.room}
                  </span>
                )}
                {terminalBadges(r, majority, doorOverride, patchOverride).map((b) => (
                  <span
                    key={b.key}
                    title={b.title}
                    className={clsx(
                      'rounded px-1 text-[10px] tabular-nums',
                      b.tone === 'ok'
                        ? 'bg-emerald-950/60 text-emerald-200'
                        : b.tone === 'amber'
                          ? 'bg-amber-950/60 text-amber-200'
                          : b.tone === 'red'
                            ? 'bg-red-950/70 text-red-200'
                            : !b.warn
                              ? 'text-zinc-500'
                              : b.key === 'version'
                                ? 'bg-amber-950/60 text-amber-200'
                                : 'bg-red-950/70 text-red-200',
                    )}
                    data-tone={b.tone}
                    data-testid={`run-terminal-badge-${b.key}`}
                  >
                    {b.text}
                  </span>
                ))}
                <span className={clsx('ml-auto tabular-nums', dead ? 'text-red-300' : 'text-zinc-600')}>
                  {dead ? `silent ${formatSilence(r.silentFor)}` : 'live'}
                </span>
                {!dead && (
                  <button
                    onClick={() => void identify(r.name)}
                    className="rounded border border-zinc-700 px-1.5 text-[11px] text-zinc-400 hover:bg-zinc-900"
                    title="Show this terminal’s name full screen for 10 s (with a chime)"
                    data-testid="run-terminal-identify"
                  >
                    identify
                  </button>
                )}
                {dead && !acked.has(r.name) && (
                  <button onClick={() => ack(r.name)} className="rounded border border-red-700 px-1.5 text-[11px] hover:bg-red-900/60" title="Stop the repeat chime for this one">
                    ack
                  </button>
                )}
                {dead && (
                  <button onClick={() => forget(r.name)} className="px-1 text-[11px] text-red-300/70 hover:text-red-100" title="Forget it (switched off on purpose)">
                    ✕
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {unclaimed.length > 0 && (
        <p className="mt-2 text-xs text-zinc-500" data-testid="run-terminals-unclaimed">
          <span className="text-zinc-400">Unclaimed spots:</span>{' '}
          {unclaimed.map((t, i) => (
            <span key={t.id} title={`${t.id}${t.location !== '' ? ` · ${t.location}` : ''}: no live terminal says it hangs here`}>
              {i > 0 ? ' · ' : ''}
              {t.name}
            </span>
          ))}
        </p>
      )}
      <PhotosCard />
      <TerminalSetup />
      {silent && (
        <p className="mt-2 text-xs text-zinc-500">
          A silent tablet: tap it / reload in Fully Kiosk, check its Wi-Fi and power, or swap the spare. The chess phone never shows
          here.
        </p>
      )}
    </section>
  )
}

/** A row's map spot: plain when it is on the map playing now, amber when it
 *  isn't (an old id, the other variant's) or another live terminal claims it,
 *  muted *no spot* when the tablet was provisioned unplaced. */
function SpotBadge({ spot, claim, doubled, name }: { spot: string; claim: SpotClaim; doubled: boolean; name: string }) {
  if (claim === SpotClaim.Unplaced) {
    return (
      <span className="text-[10px] text-zinc-600" title="Provisioned with no map spot: no world view, and the map can’t place it" data-testid="run-terminal-spot" data-claim={claim}>
        no spot
      </span>
    )
  }
  const warn = claim === SpotClaim.OffMap || doubled
  return (
    <span
      className={clsx('rounded px-1 text-[10px]', warn ? 'bg-amber-950/60 text-amber-200' : 'text-zinc-400')}
      title={
        claim === SpotClaim.OffMap
          ? `Spot “${spot}” is not on the house map playing now: re-provision it with Set up a terminal`
          : doubled
            ? `Two live terminals claim ${spot}: one was set up from a copied link`
            : claim === SpotClaim.Unknown
              ? `Spot ${spot} (the house map isn’t known)`
              : `Hangs on the map’s ${spot} spot`
      }
      data-testid="run-terminal-spot"
      data-claim={claim}
      data-doubled={doubled ? 'true' : undefined}
    >
      {claim === SpotClaim.OffMap ? `⚠ ${spot} not on map` : `📍 ${claim === SpotClaim.OnMap ? name : spot}`}
    </span>
  )
}
