//! The performer parts among the cast (T7-04). `ModView.cast` lists every
//! CHARACTER — the guests' programs, props like the Kernel, the agent-voiced
//! Trabolta — but a performer can sign in to only the server's *parts*
//! (`performerPickable`, flagged `part`). And "signed in" is the part being
//! *held* by a token: a held part whose phone isn't streaming is the moment
//! a director needs ⏏ Release, so it must not read as "nobody". Pure, so the
//! Run page's Performers list, the Stage cast strip and the Inspector agree.

import type { CastSummary } from '@/store/cockpit'

/** The rows a performer can sign in to. An older server flags no row as a
 *  part: then every non-agent character, as before. */
export function performerParts(cast: readonly CastSummary[]): CastSummary[] {
  if (cast.some((c) => c.part !== undefined)) return cast.filter((c) => c.part === true)
  return cast.filter((c) => c.agent !== true)
}

export const PartPresence = {
  /** Signed in and its phone streaming. */
  Online: 'online',
  /** A token holds the part but its phone isn't streaming (asleep, out of Wi-Fi, lost). */
  PhoneOffline: 'phone-offline',
  /** Nobody holds it. */
  Free: 'free',
  /** The server doesn't say (a local run). */
  Unknown: 'unknown',
} as const
export type PartPresence = (typeof PartPresence)[keyof typeof PartPresence]

export function partPresence(c: Pick<CastSummary, 'online' | 'held'>): PartPresence {
  if (c.online === true) return PartPresence.Online
  if (c.held === true) return PartPresence.PhoneOffline
  if (c.online === false || c.held === false) return PartPresence.Free
  return PartPresence.Unknown
}

/** The presence dot's words. */
export function partPresenceTitle(id: string, p: PartPresence): string {
  switch (p) {
    case PartPresence.Online:
      return `A performer is signed in as ${id}`
    case PartPresence.PhoneOffline:
      return `Signed in as ${id} — phone offline (asleep, off the Wi-Fi, or lost: ⏏ Release frees the part)`
    case PartPresence.Free:
      return `Nobody is signed in as ${id}`
    default:
      return id
  }
}

/** Is someone signed in (held, phone online or not)? */
export function isSignedIn(p: PartPresence): boolean {
  return p === PartPresence.Online || p === PartPresence.PhoneOffline
}
