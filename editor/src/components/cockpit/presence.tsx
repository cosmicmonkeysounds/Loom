//! The presence dot — one colour per `PartPresence` (`parts.ts`): a part
//! whose performer is streaming (emerald), a held part whose phone is
//! offline (amber), an agent a worker is voicing (sky), anything else
//! hollow. Shared by the Stage's cast strip and the Director's glance, so
//! the two always agree.

import clsx from 'clsx'
import { PartPresence } from './parts'

/** The dot's fill for a presence. */
function presenceDotClass(presence: PartPresence): string {
  return presence === PartPresence.Online
    ? 'bg-emerald-400'
    : presence === PartPresence.PhoneOffline
      ? 'bg-amber-400'
      : presence === PartPresence.Voiced
        ? 'bg-sky-400'
        : 'border border-zinc-600'
}

/** A 6 px presence dot; nothing for `Unknown` (no presence to show). */
export function PresenceDot({ presence, className }: { presence: PartPresence; className?: string }) {
  if (presence === PartPresence.Unknown) return null
  return <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', presenceDotClass(presence), className)} />
}
