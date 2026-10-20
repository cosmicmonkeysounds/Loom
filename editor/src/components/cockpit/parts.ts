//! The performer parts among the cast (T7-04). `ModView.cast` lists every
//! CHARACTER — the guests' programs, props like the Kernel, the agent-voiced
//! Trabolta — but a performer can sign in to only the server's *parts*
//! (`performerPickable`, flagged `part`). And "signed in" is the part being
//! *held* by a token: a held part whose phone isn't streaming is the moment
//! a director needs ⏏ Release, so it must not read as "nobody". An agent is
//! never a part, but its row's `online` says a worker is voicing it — kept
//! as its own dot. Pure, so the Run page's Performers list, the Stage cast
//! strip and the Inspector agree.

import { PartPresence } from '@loom/core/host-board'

// Wave 13: the rules moved verbatim to `@loom/core/host-board` (a Play host
// booth's People tab shares them); the editor keeps its own copy only of the
// dot's words.
export { PartPresence, castPresence, isSignedIn, partPresence, performerParts } from '@loom/core/host-board'

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
