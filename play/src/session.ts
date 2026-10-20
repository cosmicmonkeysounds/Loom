//! Barrel (wave 13): the role sessions moved into `session/` —
//! `shared.ts` (codes, pickers, brand, theme, per-sign-in state),
//! `channels.ts` (the guest's rooms), `guest.ts` (the guest session) and
//! `prime.ts` (the booth session). Every old name still resolves here; new
//! code imports the concrete module.

export {
  RESERVED_POLL_MS,
  codeFromUrl,
  fetchIdentities,
  fetchLanding,
  fetchPictures,
  landingBrand,
  perSessionUpdate,
  perSessionValue,
  reaskReason,
  registerBody,
  resolveCode,
  retryDelay,
  searchPrograms,
  useDocumentTitle,
  useIdentities,
  useLandingBrand,
  useTheme,
  type IdentityLookup,
  type KnownEvent,
  type PerSession,
  type ResolvedCode,
} from "./session/shared.ts";
export { buildGuestChannels, hasPendingCard, isListedRoom, isPinnedRoom, pendingWidget, personalStream, withAgents } from "./session/channels.ts";
export { SAY_TIMEOUT_MS, actFeedback, choiceEcho, defectTargets, requiredDecision, sayRefusalText, useGuestSession, withEchoes, type GuestSession } from "./session/guest.ts";
export { INBOX, buildPrimeChannels, usePrimeSession, type PrimeSession } from "./session/prime.ts";
