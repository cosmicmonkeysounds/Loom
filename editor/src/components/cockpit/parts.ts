//! The performer parts among the cast (T7-04). `ModView.cast` lists every
//! CHARACTER — the guests' programs, props like the Kernel, the agent-voiced
//! Trabolta — but a performer can sign in to only the server's *parts*
//! (`performerPickable`, flagged `part`). And "signed in" is the part being
//! *held* by a token: a held part whose phone isn't streaming is the moment
//! a director needs ⏏ Release, so it must not read as "nobody". An agent is
//! never a part, but its row's `online` says a worker is voicing it — kept
//! as its own dot. Pure, so the Run page's Performers list, the Stage cast
//! strip and the Inspector agree.

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
  /** An agent-voiced character (`mind: external`) a stagehand worker is voicing. */
  Voiced: 'voiced',
  /** An agent-voiced character with no worker connected (its `hold:` line answers). */
  Unvoiced: 'unvoiced',
  /** The server doesn't say (a local run), or not a part at all. */
  Unknown: 'unknown',
} as const
export type PartPresence = (typeof PartPresence)[keyof typeof PartPresence]

export function partPresence(c: Pick<CastSummary, 'online' | 'held'>): PartPresence {
  if (c.online === true) return PartPresence.Online
  if (c.held === true) return PartPresence.PhoneOffline
  if (c.online === false || c.held === false) return PartPresence.Free
  return PartPresence.Unknown
}

/** Any cast row's dot: a part's performer presence, an agent's worker
 *  (`online` on an agent row means a worker is connected — the director's
 *  "is the laptop up" check), nothing for the rest of the ensemble. */
export function castPresence(c: Pick<CastSummary, 'online' | 'held' | 'agent'>, isPart: boolean): PartPresence {
  if (c.agent === true) return c.online === true ? PartPresence.Voiced : c.online === false ? PartPresence.Unvoiced : PartPresence.Unknown
  return isPart ? partPresence(c) : PartPresence.Unknown
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
    case PartPresence.Voiced:
      return `A worker is voicing ${id}`
    case PartPresence.Unvoiced:
      return `No worker is voicing ${id} — a director can reply as ${id} from Chat`
    default:
      return id
  }
}

/** Is someone signed in (held, phone online or not)? */
export function isSignedIn(p: PartPresence): boolean {
  return p === PartPresence.Online || p === PartPresence.PhoneOffline
}
