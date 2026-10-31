//! 🔇 Stop all house sounds (wave 18b, Q7): the host dock's More → House
//! sound and the director phone's ☰ both post `POST /api/mod/audio/stop
//! {announce}` (a mod token, or a host booth's: the route is on the host
//! allowlist). One-shot, never journaled: the house router fades every
//! story sound and speaker test out over 0.3 s, and `announce` also cuts
//! the announcement playing and empties its queue. The TV voice (its own
//! mute), the terminals and the live mics are untouched.

/** The stop route's answer. */
export interface StopAnswer {
  ok?: boolean;
  seq?: number;
  router?: { online?: boolean } | null;
}

export const STOP_SOUNDS_LABEL = "🔇 Stop all house sounds";
export const STOP_WITH_ANNOUNCE_LABEL = "🔇 + the announcement";

/** What a host reads after a stop: the router fades out, or nobody is
 *  listening (the audio job is down: nothing to stop). */
export function stopSoundsLine(answer: StopAnswer | null | undefined, announce: boolean): string {
  if (answer?.router?.online !== true) return "⚠ No sound router is listening: nothing to stop (is the Desktop's audio job running?)";
  return announce ? "🔇 House sounds and the announcement are fading out" : "🔇 House sounds are fading out";
}
