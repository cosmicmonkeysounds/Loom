//! Run → House → 🎚 Mixer (wave 40, `docs/loom-w40-contract.md` C4): the
//! panel's pure view model on top of `@loom/core/house-mixer` — reading the
//! mixer GET off the wire, the optimistic levels a moving fader layers over
//! the server's, and the words the panel shows. The store is
//! `store/house-mixer.ts`; the panel `components/house/MixerPanel.tsx`.

import {
  applyMixChanges,
  clampMixDb,
  formatMixDb,
  levelOf,
  mixLevelsOf,
  MIX_DB_MIN,
  type AudioMix,
  type MixChange,
  type MixerMusic,
  type MixerMusicBed,
  type MixerStrip,
  type MixerTidal,
  type MixerView,
  type MixLevel,
  type MusicDj,
} from '@loom/core/house-mixer'
import { routerOf } from '@/lib/house-audio'

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** A mix off the wire (`{seq, levels}`), or null when it isn't one. */
export function audioMixOf(raw: unknown): AudioMix | null {
  if (!isRecord(raw) || typeof raw['seq'] !== 'number') return null
  return { seq: raw['seq'], levels: mixLevelsOf(raw['levels']) }
}

/** The soundtrack's report off the wire (null: none). */
export function mixerMusicOf(raw: unknown): MixerMusic | null {
  if (!isRecord(raw)) return null
  const beds: MixerMusicBed[] = []
  for (const b of Array.isArray(raw['beds']) ? raw['beds'] : []) {
    if (!isRecord(b) || typeof b['playlist'] !== 'string') continue
    beds.push({
      playlist: b['playlist'],
      speakers: strings(b['speakers']),
      track: typeof b['track'] === 'string' ? b['track'] : null,
      posS: typeof b['posS'] === 'number' ? b['posS'] : 0,
      ...(typeof b['durS'] === 'number' && b['durS'] > 0 ? { durS: b['durS'] } : {}),
      ...(b['live'] === true ? { live: true } : {}),
    })
  }
  return {
    scene: typeof raw['scene'] === 'string' ? raw['scene'] : null,
    beds,
    missing: strings(raw['missing']),
    ...(Array.isArray(raw['scenes']) ? { scenes: strings(raw['scenes']) } : {}),
    ...(raw['hand'] === true ? { hand: true } : {}),
    ...(raw['loan'] === true ? { loan: true } : {}),
    ...(isRecord(raw['tidal']) ? { tidal: { ...(raw['tidal'] as unknown as MixerTidal), library: Array.isArray(raw['tidal']['library']) ? (raw['tidal']['library'] as MixerTidal['library']) : [] } } : {}),
    ...(Array.isArray(raw['playlists']) ? { playlists: raw['playlists'].filter(isRecord).map((p) => ({ name: String(p['name'] ?? ''), tracks: typeof p['tracks'] === 'number' ? p['tracks'] : 0, loop: p['loop'] === true })) } : {}),
  }
}

/** `GET /api/mod/audio/mixer` read defensively (a missing list is empty, a
 *  missing mix is unity at seq 0), or null when the answer isn't one. */
export function mixerViewOf(raw: unknown): MixerView | null {
  if (!isRecord(raw)) return null
  const mix = audioMixOf(raw['mix'])
  if (mix === null) return null
  const meters = isRecord(raw['meters']) ? (raw['meters'] as unknown as MixerView['meters']) : null
  return {
    mix,
    sources: Array.isArray(raw['sources']) ? (raw['sources'].filter(isRecord) as unknown as MixerView['sources']) : [],
    rooms: Array.isArray(raw['rooms']) ? (raw['rooms'].filter(isRecord).map((r) => ({ ...r, speakers: Array.isArray(r['speakers']) ? r['speakers'] : [] })) as unknown as MixerView['rooms']) : [],
    meters: meters !== null ? { at: meters.at ?? 0, outputs: meters.outputs ?? {}, inputs: meters.inputs ?? {}, sources: meters.sources ?? {}, ...(meters.buses !== undefined ? { buses: meters.buses } : {}) } : null,
    music: mixerMusicOf(raw['music']),
    dj: isRecord(raw['dj']) ? (raw['dj'] as unknown as MusicDj) : null,
    router: routerOf(raw['router']),
    now: typeof raw['now'] === 'number' ? raw['now'] : 0,
  }
}

// -- the optimistic levels -------------------------------------------------------

/** One key the panel moved and the server hasn't shown back yet. */
export interface PendingLevel {
  /** The change the panel wants in force (a whole level, or a reset). */
  change: MixChange
  /** Bumped with each local move: an answer for an older one doesn't release it. */
  version: number
  /** The mix seq of the post's answer; null while unsent or in flight. A
   *  mixer GET whose `mix.seq` reaches it lets the server's level show again. */
  until: number | null
}

export type PendingMix = Record<string, PendingLevel>

/** The levels the panel draws: the server's, with every pending change on top. */
export function shownLevels(server: Readonly<Record<string, MixLevel>>, pending: Readonly<PendingMix>): Record<string, MixLevel> {
  const changes = Object.values(pending).map((p) => p.change)
  return changes.length === 0 ? { ...server } : applyMixChanges(server, changes)
}

/** The pending changes still held once the server's mix is at `seq`. */
export function releasePending(pending: Readonly<PendingMix>, seq: number): PendingMix {
  const out: PendingMix = {}
  for (const [k, p] of Object.entries(pending)) if (p.until === null || p.until > seq) out[k] = p
  return out
}

/** The whole-level change for `key` with `set` laid on its shown level. */
export function levelChange(levels: Readonly<Record<string, MixLevel>>, key: string, set: { db?: number; mute?: boolean }): MixChange {
  const was = levelOf(levels, key)
  return { key, db: set.db !== undefined ? clampMixDb(set.db) : was.db, mute: set.mute ?? was.mute }
}

// -- the words ----------------------------------------------------------------------

/** "plays at −6.0 dB" when a strip's sum differs from its own level, "silent"
 *  when something above it silences it (its own mute shows on its button). */
export function stripNote(strip: Pick<MixerStrip, 'level' | 'effective'>): string | null {
  const own = strip.level.mute || strip.level.db <= MIX_DB_MIN
  if (strip.effective === null) return own ? null : 'silent: a level above is muted or down'
  if (strip.effective === strip.level.db) return null
  return `plays at ${formatMixDb(strip.effective)} dB`
}

/** The rooms a bed's speakers are in (named), in the view's order. */
export function bedRooms(view: Pick<MixerView, 'rooms'>, bed: Pick<MixerMusicBed, 'speakers'>): string[] {
  const want = new Set(bed.speakers)
  return view.rooms.filter((r) => r.speakers.some((s) => want.has(s.id))).map((r) => r.name)
}

/** A bed's 0..1 progress through its track, or null with no length. */
export function bedProgress(bed: Pick<MixerMusicBed, 'posS' | 'durS'>): number | null {
  if (bed.durS === undefined || bed.durS <= 0) return null
  return Math.min(1, Math.max(0, bed.posS / bed.durS))
}

/** Seconds as "m:ss". */
export function formatClock(s: number): string {
  const t = Math.max(0, Math.floor(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/** A meter's colour by its peak: green, amber near the top, red at the limiter. */
export function meterTone(db: number | null): 'off' | 'ok' | 'hot' | 'clip' {
  if (db === null || db <= MIX_DB_MIN) return 'off'
  if (db >= -1) return 'clip'
  if (db >= -9) return 'hot'
  return 'ok'
}
