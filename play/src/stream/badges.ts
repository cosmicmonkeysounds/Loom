//! The room list's badge rule (wave 13): a badge counts only what is for the
//! viewer — a line or readout addressed to you (a DM, a private thread, your
//! own readout), a new Codex entry or quest, a card that asks, a docked decision, an alert. Never the
//! house-wide lines everyone gets, GENERATOR barks, notices about other
//! people, system lines, or your own words.

import { boothAlertFilter } from "../alerts.ts";
import type { Viewer } from "../rooms/threads-state.ts";
import type { Channel, ChatMessage } from "../types.ts";
import { cardAsks } from "../widgets.tsx";

/** Is this message addressed to the viewer (a guest by id, a booth as `@<character>`)? */
export function addressedTo(m: Pick<ChatMessage, "audience">, me: Viewer): boolean {
  if (!Array.isArray(m.audience)) return false;
  return me.booth ? m.audience.includes(`@${me.name}`) : m.audience.includes(me.id);
}

/** Does one message earn a badge for `me`? */
export function badgeWorthy(m: ChatMessage, me: Viewer): boolean {
  if (m.parentSeq != null || m.hidden || m.ambient) return false;
  if (m.from !== "" && (m.from === me.name || m.from === me.id)) return false; // your own words
  // A booth's alert is one to @its character or a staff room's — the
  // moments' own rule (`boothAlertFilter`), minus the house-wide ones the
  // guests got; never a faction's, or a guest's own `reply !…`.
  if (m.alert) return me.booth ? m.audience !== "all" && boothAlertFilter(me.name)(m) : true;
  if (m.notice !== undefined) return false;
  if (m.kind === "widget") {
    if (m.widget === undefined || !cardAsks(m.widget)) return false;
    return addressedTo(m, me) || (!me.booth && m.audience === "all");
  }
  // A Codex entry you just learned, a quest handed to you: yours alone.
  if (m.kind === "codex" || m.kind === "quest") return addressedTo(m, me);
  if (m.kind === "line" || m.kind === "narration") {
    if (!addressedTo(m, me)) return false;
    // A line addressed to the room's occupants (typed chat where you stand)
    // is the room talking; a DM, a private thread or a readout is for you.
    return m.readout === true || m.channel.startsWith("dm:") || m.channel.startsWith("pm:") || m.channelKind === "dm";
  }
  return false;
}

/** How many badge-worthy messages `c` has past `seen` (its read mark). An
 *  unknown viewer (an old call site) counts every message, as before. */
export function unreadOf(c: Channel, seen: number, me: Viewer | undefined): number {
  const fresh = c.messages.filter((m) => m.seq > seen && (me === undefined || badgeWorthy(m, me))).length;
  return c.decision ? Math.max(1, fresh) : fresh;
}
