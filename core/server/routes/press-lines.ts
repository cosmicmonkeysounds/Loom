//! What a booth's press or scan said (fix round, CROSS-LANE C1): the
//! `/api/prime/act` and `/api/scan` replies carry, beside the `respond`
//! texts (`replies` / `responses`), the lines this one commit produced that
//! the booth should read on its card:
//!
//! - `staff`: the staff-room lines (`# hosts` and every other authored
//!   `kind: faction` CHANNEL no guest may join) — where a phase-guarded rule
//!   says why it refused the press ("🗣 The bottle is not on WinZip.");
//! - `said`: what the booth's own character said to the scanned guest
//!   ("Not yet. Finish your upload.").
//!
//! Pure over the chat messages the commit appended, so the server and a test
//! read the same rule.

import type { ChatMessage } from "../chat.ts";

/** One line the booth's character spoke to the guest. */
export interface SaidLine {
  from: string;
  text: string;
}

/** The extra card lines of one press / scan; each field is set only when non-empty. */
export interface PressLines {
  staff?: string[];
  said?: SaidLine[];
  /** Wave 18 fix (BN-F13): what reached the guest's own phone (their
   *  readouts and lines addressed to them alone, any speaker), at most 3:
   *  the booth's reply line says what they got. */
  toGuest?: string[];
}

/**
 * The card lines in `appended` (the messages one commit added): staff-room
 * lines (`staffChannels` = the authored ids, `staffRoomChannels`), and the
 * typed or scripted lines `character` addressed to `guest` (its `dm:` thread
 * or any room row whose audience names the guest). Hidden rows never count.
 */
export function pressLines(appended: readonly ChatMessage[], staffChannels: ReadonlySet<string>, character: string | null, guest: string): PressLines {
  const staff: string[] = [];
  const said: SaidLine[] = [];
  // The guest's moment (a `!` / `!!` line, a readout) leads: a codex card
  // unlocked by the same press is the entry's text, not what they were told
  // (BN2-FI: 🎀's reply line read the Computer Bingo entry).
  const toGuest: string[] = [];
  const toldFirst: string[] = [];
  for (const m of appended) {
    if (m.hidden) continue;
    const text = m.text.trim();
    if (text === "") continue;
    if (staffChannels.has(m.channel)) {
      staff.push(text);
      continue;
    }
    const theirs = guest !== "" && Array.isArray(m.audience) && m.audience.includes(guest);
    const card = m.kind === "codex" || m.kind === "quest" || m.kind === "wallet";
    if (theirs && m.kind !== "system" && !card && m.ambient !== true && !toGuest.includes(text) && !toldFirst.includes(text)) (m.moment !== undefined || m.alert === true || m.readout === true ? toldFirst : toGuest).push(text);
    if (character === null || m.kind !== "line" || m.from !== character) continue;
    if (theirs) said.push({ from: m.from, text });
  }
  const told = [...toldFirst, ...toGuest].slice(0, 3);
  return { ...(staff.length > 0 ? { staff } : {}), ...(said.length > 0 ? { said } : {}), ...(told.length > 0 ? { toGuest: told } : {}) };
}

/** A director's / host's cue press, as its 200 tells it (wave 18, C8):
 *  `staff` = the staff-room lines, `said` = what the press posted anywhere
 *  else (lines, notices, readouts; system rows skipped), each text once, at
 *  most 8. */
export function cueLines(appended: readonly ChatMessage[], staffChannels: ReadonlySet<string>): { staff?: string[]; said?: string[] } {
  const staff: string[] = [];
  const said: string[] = [];
  for (const m of appended) {
    if (m.hidden || m.kind === "system" || m.ambient === true) continue;
    const text = m.text.trim();
    if (text === "") continue;
    const into = staffChannels.has(m.channel) ? staff : said;
    if (!into.includes(text) && into.length < 8) into.push(text);
  }
  return { ...(staff.length > 0 ? { staff } : {}), ...(said.length > 0 ? { said } : {}) };
}
