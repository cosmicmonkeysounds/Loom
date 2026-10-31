//! Run → House → 🎵 Music (wave 58, `docs/loom-w58-music-contract.md`): the night's
//! music in one place.
//!
//! - **The strip**: the router, where the music is coming from, the last note.
//! - **Now playing**: the scene (a picker: picking holds it until the story's next
//!   music cue or **Follow the story**; the badge's words are `DRAFT w59d`), ⏮ ⏸ ⏭
//!   while a bed is on the TIDAL app, each bed (its playlist, rooms, track and
//!   progress, **⏭ Skip**),
//!   **⏭ Skip all**, **■ Stop music**, the empty playlists.
//! - **Play now**: the show's playlists, every playlist in the app's sidebar
//!   and a pasted link. A pick plays where the scene's music plays, by hand.
//! - **The level**: the 🎚 Mixer's own `src:music` fader.
//! - **Trabolta**: who he'd do it for, what he did last, and the lock.
//!
//! It reads while shown (`store/house-mixer.ts` `watch`, shared with the
//! Mixer). The words are `@loom/core/house-mixer`'s, so Play's Desk reads alike.

import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { djLines, handPlaylists, musicBedName, musicOnApp, musicSceneName, musicSource, scopeStrips, tidalPlaylistId, type MixerMusic, type MixerView, type MusicDj, type MusicTone } from '@loom/core/house-mixer'
import { mixerLevels, useHouseMixer } from '@/store/house-mixer'
import { bedProgress, bedRooms, formatClock } from '@/lib/house-mixer-view'
import { Centered, Strip } from './MixerPanel'
import { btn, btnDanger, heading, input, panel, TONE_CHIP, TONE_TEXT } from './ui'

const SOURCE_CHIP: Record<MusicTone, string> = { ok: TONE_CHIP.ok, warn: TONE_CHIP.warn, bad: TONE_CHIP.bad, idle: 'border-zinc-700 text-zinc-300' }

export function MusicPanel() {
  const view = useHouseMixer((s) => s.view)
  const gone = useHouseMixer((s) => s.gone)
  const reachable = useHouseMixer((s) => s.reachable)

  useEffect(() => {
    useHouseMixer.getState().watch(true)
    return () => useHouseMixer.getState().watch(false)
  }, [])

  if (gone === 'missing') return <Centered title="This event server has no music manager yet: update and restart it.">It is running code from before wave 40; the desk and the Cue designer still work.</Centered>
  if (gone === 'denied') return <Centered title="The server refused the music manager.">Only the event’s directors and hosts can run the house music. Sign in again, or ask the project’s owner.</Centered>
  if (view === null) return <Centered title={reachable ? 'Reading the music…' : 'Can’t reach the server: retrying…'} />
  return <MusicPage view={view} />
}

function MusicPage({ view }: { view: MixerView }) {
  const note = useHouseMixer((s) => s.note)
  const reachable = useHouseMixer((s) => s.reachable)
  const pending = useHouseMixer((s) => s.pending)
  const source = musicSource(view.music)
  const level = scopeStrips(view, { kind: 'all' }, mixerLevels({ view, pending })).find((s) => s.source === 'music')
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="house-music">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-xs" data-testid="music-status">
        <span className={clsx('rounded border px-1.5 py-0.5', view.router.online ? TONE_CHIP.ok : TONE_CHIP.warn)} data-testid="music-router">
          {view.router.online ? `🔊 router online${view.router.name !== null ? ` (${view.router.name})` : ''}` : '🔇 no router listening'}
        </span>
        <span className={clsx('rounded border px-1.5 py-0.5', SOURCE_CHIP[source.tone])} data-testid="music-source">
          {source.text}
        </span>
        {!reachable && <span className={TONE_TEXT.bad}>Can’t reach the server: retrying…</span>}
        {note !== null && (
          <span className={TONE_TEXT[note.tone]} data-testid="music-note">
            {note.text}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        <NowPlaying view={view} music={view.music} />
        <PlayNow music={view.music} />
        {level !== undefined && (
          <section className={panel} data-testid="music-level">
            <div className={clsx(heading, 'px-3 pt-2')}>Level</div>
            <Strip strip={level} scopeLabel="Everywhere" speakerRow={false} />
          </section>
        )}
        {view.dj !== undefined && view.dj !== null && <TraboltaCard dj={view.dj} />}
      </div>
    </div>
  )
}

// -- now playing ---------------------------------------------------------------

function NowPlaying({ view, music }: { view: MixerView; music: MixerMusic | null }) {
  const busy = useHouseMixer((s) => s.busy)
  const send = useHouseMixer((s) => s.music)
  const paused = music?.tidal?.paused === true
  return (
    <section className={clsx(panel, 'p-3')} data-testid="mixer-music">
      <div className="flex flex-wrap items-center gap-2">
        <div className={heading}>Now playing</div>
        {music !== null && (
          <>
            {music.scenes !== undefined && music.scenes.length > 0 ? (
              <label className="flex items-center gap-1 text-xs text-zinc-400">
                Scene
                <select
                  className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                  value={music.scene ?? ''}
                  disabled={busy !== null}
                  onChange={(e) => {
                    if (e.target.value !== '') void send({ action: 'scene', scene: e.target.value }, 'scene')
                  }}
                  data-testid="mixer-scene"
                >
                  {(music.scene === null || !music.scenes.includes(music.scene)) && <option value={music.scene ?? ''}>{music.scene !== null ? musicSceneName(music.scene) : '(none)'}</option>}
                  {music.scenes.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="text-xs text-zinc-300">Scene: {music.scene !== null ? musicSceneName(music.scene) : '(none)'}</span>
            )}
            {music.hand === true && (
              <>
                <span className={clsx('rounded border px-1.5 py-0.5 text-[11px]', TONE_CHIP.warn)} data-testid="mixer-hand">
                  {music.loan === true ? '🤖 Trabolta has the music: it goes back by itself' : 'by hand: until the story’s next music cue, or Follow the story'}
                </span>
                <button className={btn} disabled={busy !== null} onClick={() => void send({ action: 'story' }, 'story')} data-testid="mixer-follow">
                  {music.loan === true ? 'Take it back' : 'Follow the story'}
                </button>
              </>
            )}
            <span className="ml-auto flex gap-1">
              {musicOnApp(music) && (
                <>
                  <button className={btn} disabled={busy !== null} onClick={() => void send({ action: 'previous' }, 'previous')} title="Back a track" data-testid="music-previous">
                    ⏮
                  </button>
                  <button className={btn} disabled={busy !== null} onClick={() => void send({ action: paused ? 'resume' : 'pause' }, 'pause')} title={paused ? 'Play' : 'Pause'} data-testid="music-pause">
                    {paused ? '▶' : '⏸'}
                  </button>
                </>
              )}
              <button className={btn} disabled={busy !== null || music.beds.length === 0} onClick={() => void send({ action: 'next' }, 'next')} data-testid="mixer-skip-all">
                ⏭ Skip all
              </button>
              <button className={btnDanger} disabled={busy !== null} onClick={() => void send({ action: 'stop' }, 'stop')} data-testid="mixer-stop">
                ■ Stop music
              </button>
            </span>
          </>
        )}
      </div>
      {music === null ? (
        <p className="mt-2 text-xs text-zinc-500" data-testid="mixer-no-music">
          No soundtrack reported yet{view.router.online ? ': the router has no soundtrack.yaml, or hasn’t sent its first report' : ': the router isn’t listening'}.
        </p>
      ) : (
        <>
          {music.beds.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">{music.scene === null || music.scene === 'off' ? 'No music playing.' : 'This scene plays no beds.'}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {music.beds.map((b) => {
                const progress = bedProgress(b)
                const rooms = bedRooms(view, b)
                return (
                  <li key={b.playlist} className="flex items-center gap-2 rounded border border-zinc-800 px-2 py-1 text-xs" data-testid={`mixer-bed-${b.playlist}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium text-zinc-100">{musicBedName(b, music)}</span>
                        <span className="text-zinc-500">{rooms.length > 0 ? rooms.join(', ') : b.speakers.join(', ') || 'no speakers'}</span>
                      </div>
                      <div className="truncate text-zinc-300">{b.track ?? '(between tracks)'}</div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded bg-zinc-800">
                          {progress !== null && <div className="h-full bg-indigo-500" style={{ width: `${(progress * 100).toFixed(1)}%` }} />}
                        </div>
                        <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                          {formatClock(b.posS)}
                          {b.durS !== undefined ? ` / ${formatClock(b.durS)}` : ''}
                        </span>
                      </div>
                    </div>
                    <button className={btn} disabled={busy !== null} onClick={() => void send({ action: 'next', playlist: b.playlist }, `next:${b.playlist}`)} data-testid={`mixer-skip-${b.playlist}`}>
                      ⏭ Skip
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {music.missing.length > 0 && (
            <p className={clsx('mt-2 text-xs', TONE_TEXT.warn)} data-testid="mixer-missing">
              ⚠ {music.missing.length === 1 ? 'An empty playlist' : 'Empty playlists'} (no file on the router’s machine): {music.missing.join(', ')}
            </p>
          )}
        </>
      )}
    </section>
  )
}

// -- what to play ---------------------------------------------------------------

function PlayNow({ music }: { music: MixerMusic | null }) {
  const busy = useHouseMixer((s) => s.busy)
  const send = useHouseMixer((s) => s.music)
  const tell = useHouseMixer((s) => s.tell)
  const [link, setLink] = useState('')
  const show = handPlaylists(music)
  const app = music?.tidal
  if (show.length === 0 && app === undefined) return null
  const paste = () => {
    const id = tidalPlaylistId(link)
    if (id === null) {
      tell('That’s no TIDAL playlist link.', 'warn')
      return
    }
    void send({ action: 'tidal', id }, 'tidal')
    setLink('')
  }
  return (
    <section className={clsx(panel, 'p-3')} data-testid="music-play-now">
      <div className={heading}>Play now</div>
      <p className="mt-1 text-[11px] text-zinc-500">Plays where the scene’s music plays, by hand: the story’s music cues are held until the next one, or Follow the story.</p>
      {show.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {show.map((p) => (
            <button key={p.name} className={btn} disabled={busy !== null} onClick={() => void send({ action: 'playlist', playlist: p.name }, 'playlist')} data-testid={`music-show-${p.name}`}>
              ▶ {p.name}
            </button>
          ))}
        </div>
      )}
      {app !== undefined && app.library.length > 0 && (
        <details className="mt-2" data-testid="music-library">
          <summary className="cursor-pointer text-xs text-zinc-300">Your TIDAL playlists ({app.library.length})</summary>
          <div className="mt-1 flex flex-wrap gap-1">
            {app.library.map((p) => (
              <button key={p.id} className={btn} disabled={busy !== null} onClick={() => void send({ action: 'tidal', id: p.id, title: p.title }, 'tidal')} data-testid={`music-tidal-${p.id}`}>
                ▶ {p.title}
                {p.items !== undefined ? ` (${p.items})` : ''}
              </button>
            ))}
          </div>
        </details>
      )}
      {app !== undefined && (
        <form
          className="mt-2 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            paste()
          }}
        >
          <input className={clsx(input, 'flex-1')} value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a TIDAL playlist link" aria-label="TIDAL playlist link" data-testid="music-link" />
          <button type="submit" className={btn} disabled={busy !== null || link.trim() === ''} data-testid="music-link-play">
            ▶ Play
          </button>
        </form>
      )}
    </section>
  )
}

// -- Trabolta --------------------------------------------------------------------

function TraboltaCard({ dj }: { dj: MusicDj }) {
  const busy = useHouseMixer((s) => s.busy)
  const lockDj = useHouseMixer((s) => s.lockDj)
  const lines = djLines(dj)
  return (
    <section className={clsx(panel, 'p-3')} data-testid="music-dj">
      <div className={heading}>🤖 Trabolta at the stereo</div>
      <p className="mt-1 text-xs text-zinc-200">{lines.status}</p>
      {lines.pals !== null && <p className="mt-1 text-xs text-zinc-300">{lines.pals}</p>}
      {lines.last !== null && <p className="mt-1 text-xs text-zinc-500">{lines.last}</p>}
      <button className={clsx(dj.locked ? btn : btnDanger, 'mt-2')} disabled={busy !== null} onClick={() => void lockDj(!dj.locked)} data-testid="music-dj-lock">
        {dj.locked ? '🔓 Let him reach the music' : '🔒 Keep him off the music'}
      </button>
    </section>
  )
}
