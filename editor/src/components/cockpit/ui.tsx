//! Small shared components for the Run (Operate) cockpit. Pure formatting
//! helpers live alongside in `format.ts` (kept separate so this component file
//! exports only components).

import type { NameBadge } from '@/store/cockpit'
import { factionTone } from './format'

/** A small faction badge; renders "unaligned" when there's no faction. */
export function FactionPill({ faction }: { faction: string | null | undefined }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${factionTone(faction)}`}>
      {faction ?? 'unaligned'}
    </span>
  )
}

/** The story's `badge:` lines a person wears now (wave 18b: 🚻 Bathroom
 *  Mode), one glyph each with its label as the tooltip; nothing when none.
 *  On people lists only, never on a chat line (a line is the past, the
 *  badge the present). */
export function NameBadges({ badges, className }: { badges: readonly NameBadge[] | undefined; className?: string }) {
  if (badges === undefined || badges.length === 0) return null
  return (
    <span className={className ?? 'shrink-0 text-[10px]'} data-testid="name-badges">
      {badges.map((b) => (
        <span key={`${b.glyph}${b.label}`} title={b.label} aria-label={b.label} role="img">
          {b.glyph}
        </span>
      ))}
    </span>
  )
}
