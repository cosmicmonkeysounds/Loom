//! The ceremony's award suggestions (W-24, the Oct 31 cut): each award cue
//! on the cue sheet mapped to its K-26 recap list, so the director reads a
//! winner off `GET /e/:id/api/mod/recap` instead of cross-checking the text
//! tab by hand. Suggestions only: the cue sheet pre-fills an *empty* winner
//! picker and value box and never touches what the director chose.
//!
//! Rehearsal personas are skipped, ties at the top (or the bottom, for
//! Least Trusted) are all listed, and a count award with nobody above 0
//! suggests no one.

// Wave 13: the module moved verbatim to `@loom/core/host-board` (a Play host
// booth's award picker shares it); the editor re-exports it under the same
// names.
export { AWARD_SOURCES, awardSuggestion, fillAwards, nightEnded, pickWinner, suggestionHint } from '@loom/core/host-board'
export type { AwardFields, AwardSuggestion, RecapDuckRowWire, RecapListName, RecapRowWire, RecapWire } from '@loom/core/host-board'
