//! The house sound on the Run page (wave 18b, Q7 / Q8), pure so it tests
//! without a server. The event's `audio.json` (`GET /e/:id/api/mod/audio`,
//! the map editor's own read) says where the story's sounds and the house
//! announcements play, whether the router on the house Mac is listening,
//! and — new in wave 18b — which map terminal spots' tablets also say the
//! announcements (`announce.terminals`, the house setting a tablet follows
//! unless its own ⚙ says Always / Never).
//!
//! Two actions ride it:
//! - **■ Stop house sounds** (`POST /api/mod/audio/stop {announce?}`): the
//!   router fades out every story sound and speaker test; with
//!   `announce` it also cuts the announcement playing and empties its
//!   queue. One-shot, never journaled; the TV voice, the terminals and the
//!   live mics are untouched.
//! - **the house list**: ticking a spot edits `announce.terminals` and saves
//!   the whole config back (`POST /api/mod/audio {audio, base}`, 409 when
//!   someone saved since). That is a *director save*, kept for this event
//!   only; **Save to project** (`POST /api/mod/audio/project`) writes it to
//!   the project's `audio.json` so it survives End → relaunch.
//!
//! The editor has no dependency on `@loom/house`: the config is carried as
//! plain JSON and only `announce.terminals` is touched.

/** Is the house Mac's router listening (`AudioView.router`)? */
export interface AudioRouter {
  online: boolean
  /** Its last poll (server ms); null = none since the server started. */
  lastSeen: number | null
  name: string | null
}

/** Where the config in force comes from (`AudioView.source`). */
export type AudioSource = 'director' | 'project' | 'env' | 'default'

/** `GET /api/mod/audio`, the parts the Run page reads. */
export interface AudioStatus {
  /** The whole `audio.json` in force, as JSON (sent back whole on a save). */
  audio: Record<string, unknown>
  version: string
  source: AudioSource
  router: AudioRouter
  problems: string[]
  warnings: string[]
  /** (wave 18b) The server's clock (ms) as of this answer; absent from an older server. */
  now?: number
}

/** `POST /api/mod/audio/stop`. */
export interface AudioStopAnswer {
  ok: true
  seq: number
  router: AudioRouter
}

/** Read a `GET /api/mod/audio` answer, or null when it isn't one (an older
 *  server, a story with no audio route). */
export function audioStatusOf(wire: unknown): AudioStatus | null {
  if (wire === null || typeof wire !== 'object') return null
  const w = wire as Record<string, unknown>
  if (w['audio'] === null || typeof w['audio'] !== 'object' || typeof w['version'] !== 'string') return null
  const src = w['source']
  const source: AudioSource = src === 'director' || src === 'project' || src === 'env' ? src : 'default'
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return {
    audio: w['audio'] as Record<string, unknown>,
    version: w['version'],
    source,
    router: routerOf(w['router']),
    problems: strings(w['problems']),
    warnings: strings(w['warnings']),
    ...(typeof w['now'] === 'number' ? { now: w['now'] } : {}),
  }
}

/** A router presence off the wire (missing = offline, never seen). */
export function routerOf(v: unknown): AudioRouter {
  const r = (v ?? {}) as Record<string, unknown>
  return {
    online: r['online'] === true,
    lastSeen: typeof r['lastSeen'] === 'number' ? r['lastSeen'] : null,
    name: typeof r['name'] === 'string' && r['name'] !== '' ? r['name'] : null,
  }
}

/** The map terminal spots on the house list (`announce.terminals`). */
export function announceTerminalsOf(audio: Record<string, unknown> | null | undefined): string[] {
  const a = audio?.['announce']
  if (a === null || typeof a !== 'object') return []
  const t = (a as Record<string, unknown>)['terminals']
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []
}

/** What a config with no `announce` block plays the announcements on (the
 *  router's own default, `@loom/house` `AUDIO_EVERYWHERE`). */
export const ANNOUNCE_DEFAULT_TO = ['everywhere']

/** The config with `spot` on (or off) the house list — everything else kept
 *  as it is. An `audio.json` with no `announce` block gets the router's
 *  default one (`to: ["everywhere"]`), so ticking a tablet never moves the
 *  house speakers. The list is dropped when it empties. */
export function withAnnounceTerminal(audio: Record<string, unknown>, spot: string, on: boolean): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(audio)) as Record<string, unknown>
  const prev = next['announce']
  const block: Record<string, unknown> = prev !== null && typeof prev === 'object' ? (prev as Record<string, unknown>) : { to: [...ANNOUNCE_DEFAULT_TO] }
  const had = announceTerminalsOf(next)
  const list = on ? (had.includes(spot) ? had : [...had, spot]) : had.filter((t) => t !== spot)
  if (list.length > 0) block['terminals'] = list
  else delete block['terminals']
  next['announce'] = block
  return next
}

/** "Router online · house-mac" / "No router listening (last seen 4 min ago)". */
export function routerLine(router: AudioRouter, now: number): string {
  if (router.online) return `Router online${router.name !== null ? ` · ${router.name}` : ''}`
  if (router.lastSeen === null) return 'No router listening: none has polled since the server started'
  const min = Math.max(0, Math.round((now - router.lastSeen) / 60_000))
  return `No router listening (last seen ${min < 1 ? 'under a minute' : `${min} min`} ago${router.name !== null ? `, ${router.name}` : ''})`
}

/** What a press of ■ Stop came to. */
export const StopOutcome = {
  /** The server took it and a router is listening: it fades out now. */
  Stopped: 'stopped',
  /** The server took it, but no router is listening: the stop reaches nothing.
   *  The house Mac may still be playing (its uplink down mid-song). */
  NoRouter: 'noRouter',
  /** The request itself failed (signed out, the server down, a 5xx, an
   *  older server with no stop route): nothing was stopped. */
  Failed: 'failed',
} as const
export type StopOutcome = (typeof StopOutcome)[keyof typeof StopOutcome]

/** The by-hand stop on the house Mac, for when the server can't reach it. */
export const STOP_BY_HAND = 'stop it there: `stagehand sounds stop`, or MQTT `show/audio/stop`'

/** What a stop the server took came to, for the button's moment of feedback. */
export function stopResultText(answer: AudioStopAnswer, announce: boolean): string {
  if (!answer.router.online) return `No router is listening, so the stop can’t reach the house Mac: ${STOP_BY_HAND}`
  return announce ? '■ Stopped the house sounds and the announcement' : '■ Stopped the house sounds'
}

/** The outcome of a stop the server took. */
export function stopOutcomeOf(answer: AudioStopAnswer): StopOutcome {
  return answer.router.online ? StopOutcome.Stopped : StopOutcome.NoRouter
}

/** A stop request that failed: nothing was stopped. */
export function stopFailedText(error: string): string {
  return `The stop failed (${error}): nothing was stopped. Press it again, or ${STOP_BY_HAND}`
}

/** The header button's short label for an outcome. */
export function stopButtonLabel(outcome: StopOutcome): string {
  switch (outcome) {
    case StopOutcome.Stopped:
      return '■ Stopped'
    case StopOutcome.NoRouter:
      return '■ No router: stop it on the house Mac'
    case StopOutcome.Failed:
      return '■ Stop failed: retry'
  }
}

/** Where the config in force comes from, for the card's line. */
export function sourceLabel(source: AudioSource): string {
  switch (source) {
    case 'director':
      return 'this event’s save (not in the project: Save to project keeps it after End → relaunch)'
    case 'project':
      return 'the project’s audio.json'
    case 'env':
      return 'the server’s LOOM_AUDIO file'
    case 'default':
      return 'the default (the project has no audio.json)'
  }
}
