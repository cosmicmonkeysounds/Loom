//! Pure formatting helpers for the Run cockpit. Kept out of the `.tsx`
//! component modules so Fast Refresh stays happy (a component file should
//! export only components).

import { RunBackend, RunMode, type RunInfo } from '@/store/cockpit'

/** Tailwind tone classes for a faction pill (falls back to a neutral grey). */
export function factionTone(faction: string | null | undefined): string {
  switch (faction) {
    case 'Mods':
      return 'bg-sky-500/15 text-sky-300'
    case 'Chatters':
      return 'bg-pink-500/15 text-pink-300'
    case 'TheAlgorithm':
      return 'bg-violet-500/15 text-violet-300'
    default:
      return 'bg-zinc-700/40 text-zinc-400'
  }
}

/** A glyph for a channel kind, so the rooms list scans quickly. */
export function channelGlyph(kind: string | undefined): string {
  switch (kind) {
    case 'lobby':
      return '🌐'
    case 'faction':
      return '🚩'
    case 'location':
      return '📍'
    case 'dm':
      return '✉️'
    case 'announcement':
      return '📢'
    case 'private':
    case 'group':
      return '🔒'
    default:
      return '#'
  }
}

/** The world badge — what this cockpit is driving right now. */
export function worldBadge(run: RunInfo | null): { label: string; badge: string; border: string } {
  if (run === null) return { label: 'no run', badge: 'bg-zinc-800 text-zinc-400', border: 'border-zinc-800' }
  if (run.backend === RunBackend.Local) {
    return run.scratch
      ? { label: '⚗ Scratch run', badge: 'bg-violet-950 text-violet-300', border: 'border-violet-900/60' }
      : { label: '◦ Local run', badge: 'bg-violet-950 text-violet-300', border: 'border-violet-900/60' }
  }
  return run.mode === RunMode.Live
    ? { label: '● Live event', badge: 'bg-emerald-950 text-emerald-300', border: 'border-emerald-900/60' }
    : { label: '◉ Shared rehearsal', badge: 'bg-amber-950 text-amber-300', border: 'border-amber-900/60' }
}


/** A character's declared faction as a participant may see it: under a
 *  lens a hidden, unrevealed allegiance reads as none — the phone never
 *  shows it either. */
export function publicFaction(faction: string | null, factions: Array<{ id: string; hidden: boolean; revealed: boolean }>, locked: boolean): string | null {
  if (!locked || faction === null) return faction
  const f = factions.find((x) => x.id === faction)
  return f !== undefined && f.hidden && !f.revealed ? null : faction
}

