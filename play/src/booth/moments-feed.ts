//! What the booth hands its moments layer (wave 13 recheck): the session's
//! messages, with two booth rules laid over them before the layer reads
//! them. Pure, so the tests pin both on the real message shapes.
//!
//! 1. A line someone else puts in a staff room (`# hosts`, `# quarantine`)
//!    is a minor moment — a balloon whose "Take me there" opens the room —
//!    when a person wrote it (a host, a director, another booth) or it
//!    names this booth's character. The story's own notes there (a
//!    refusal, "🛡 Escort WinZip…") only badge the room: they mostly
//!    answer some booth's own press, which its card already showed.
//! 2. A burst of readouts that say the same thing about different guests
//!    (the late list: "⏰ WinZip is late…", "⏰ GarageBand is late…", all
//!    in the same second) is one moment — "⏰ WinZip, GarageBand and 4 more
//!    are late for the Second Moment of Truth — see Readouts." — never a
//!    pile of stickies. The rest of the burst still lands in Readouts; only
//!    the moments layer sees them folded. Every readout's moment is
//!    captioned "Readout" (its room is titled with the booth's own name).
//! 3. Wave 37 (C6): a performer's phone is about their job. A line to
//!    everyone (`audience: "all"`) never reaches a booth's layer (the house
//!    says it on the TV, the speakers and the 📜 Chat log); a player gets no
//!    "New quest" moment (the Quest Log's dot says it); and a minor readout
//!    about a guest who is not this booth's (`mine`) only badges Readouts.
//!    Every one of them still lands in its room.

import { staffLineWorthy } from "../stream/badges.ts";
import type { ChatMessage } from "../types.ts";

/** What a booth readout's moment is captioned (never the booth's own name). */
export const READOUT_CAPTION = "Readout";

/** Readouts this close together (story ms) are one burst. */
export const BURST_MS = 2_000;

/** How a burst names its guests: "A", "A and B", "A, B and C", "A, B and 4 more". */
export function burstNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** The hole a guest's name leaves in a readout's text (the template a burst shares). */
const HOLE = "\u0000";

/** A readout's template and the guest it names (`about` first, else the longest guest name in the text). */
function templateOf(m: ChatMessage, guestName: (id: string) => string | null, names: readonly string[]): { template: string; name: string | null } {
  const text = m.text.trim();
  const about = typeof m.about === "string" ? guestName(m.about) : null;
  const name = about !== null && text.includes(about) ? about : ([...names].sort((a, b) => b.length - a.length).find((n) => n !== "" && text.includes(n)) ?? null);
  return { template: name !== null ? text.replace(name, HOLE) : text, name };
}

/** The one line a folded burst says. */
export function burstLine(template: string, names: readonly string[], count: number): string {
  const glyph = (/^[^\p{L}\p{N}\u0000]*/u.exec(template)?.[0] ?? "").trim();
  const lead = glyph !== "" ? `${glyph} ` : "";
  const who = burstNames(names);
  const is = new RegExp(`^[^\\p{L}\\p{N}${HOLE}]*${HOLE} is (.+)$`, "u").exec(template);
  if (is !== null && names.length > 1) {
    // "late for the Second Moment of Truth. Go get them." → its first sentence.
    // Its first sentence, without a lookbehind (Safari before 16.4 throws on one).
    const rest = is[1]!.replace(/([.!?])\s[\s\S]*$/u, "$1").replace(/[.!?]+$/u, "").trim();
    return `${lead}${who} are ${rest} — see Readouts.`;
  }
  // Any other shape: the newest line, and how many more said the same.
  const newest = template.replace(HOLE, names[names.length - 1] ?? "").trim();
  return `${newest} (+${count - 1} more like it — see Readouts)`;
}

export interface BoothFeedOptions {
  /** The booth's character. */
  character: string;
  /** The view's staff-room ids (`PrimeView.staffRooms`). */
  staffRooms: ReadonlySet<string>;
  /** A guest's display name by id (`ChatMessage.about`). */
  guestName: (id: string) => string | null;
  /** Every guest's display name (a readout with no `about`). */
  names: readonly string[];
  /** Wave 18 (§4.12): a message a pop-out (or the open confrontation) covers:
   *  the moments layer never sees it (it still lands in Readouts). */
  covered?: (m: ChatMessage) => boolean;
  /** Wave 37 (C6): a player's booth (Antivirus, Clippy): no quest moments. */
  player?: boolean;
  /** Wave 37 (C6): is this guest this booth's (its claim, its door)? When
   *  given, a minor readout about anyone else stays in Readouts only. */
  mine?: (guestId: string) => boolean;
}

/** Does `text` name `who` as a word ("Password Manager: the patch bay" names Password Manager)? */
function names(text: string, who: string): boolean {
  if (who.trim() === "") return false;
  const esc = who.trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

/** Is `m` a staff-room line that raises a minor moment in this booth? */
export function staffMoment(m: ChatMessage, opts: Pick<BoothFeedOptions, "character" | "staffRooms">): boolean {
  if (!opts.staffRooms.has(m.channel) || m.moment !== undefined || m.alert === true) return false;
  const me = { id: opts.character, name: opts.character, booth: true };
  if (!staffLineWorthy(m, me)) return false;
  return m.from.trim() !== "" || names(m.text, opts.character);
}

/** A readout to this booth (`dm:<Character>`, `readout: true`). */
function readoutToMe(m: ChatMessage, character: string): boolean {
  return m.readout === true && m.channel === `dm:${character}` && !m.hidden && m.parentSeq == null;
}

/**
 * Wave 37 (C6): does the booth's layer skip `m` (it still lands in its
 * room)? A line to everyone; a quest on a player's booth; a minor readout
 * about a guest who is not this booth's (only when `mine` is given).
 */
export function offDuty(m: ChatMessage, opts: Pick<BoothFeedOptions, "character" | "player" | "mine">): boolean {
  if (m.audience === "all") return true;
  if (opts.player === true && m.quest !== undefined) return true;
  if (opts.mine === undefined || opts.character === "" || !readoutToMe(m, opts.character)) return false;
  return typeof m.about === "string" && m.about !== "" && m.alert !== true && (m.moment as string | undefined) !== "big" && opts.mine(m.about) !== true;
}

/**
 * The messages the booth's moments layer reads: the session's, with the
 * staff-room moments stamped (`moment: "minor"`) and each readout burst
 * folded into its last message (the others `hidden` for the layer only,
 * every readout captioned "Readout", not with the booth's own name;
 * the last one's text the burst's line and no `about`, so a card open on
 * one of the guests never swallows it). Unchanged messages are the same
 * objects; the map is new only when something changed.
 */
export function boothMomentFeed(messages: ReadonlyMap<number, ChatMessage>, opts: BoothFeedOptions): ReadonlyMap<number, ChatMessage> {
  const patch = new Map<number, ChatMessage>();
  const readouts: ChatMessage[] = [];
  for (const m of messages.values()) {
    if (opts.covered?.(m) === true) {
      patch.set(m.seq, { ...m, hidden: true });
      continue;
    }
    if (offDuty(m, opts)) {
      // Off duty (C6): never a moment here, never counted in a burst.
      if (!m.hidden) patch.set(m.seq, { ...m, hidden: true });
      continue;
    }
    if (staffMoment(m, opts)) patch.set(m.seq, { ...m, moment: "minor" });
    else if (opts.character !== "" && readoutToMe(m, opts.character) && Number.isInteger(m.seq)) {
      // Its room is the booth's own `dm:<Character>`, titled with the
      // character's own name: a sticky read "McAfee Anti-Virus: ⏰ …", as
      // if the booth had said it. It is a readout.
      const r = m.title === opts.character ? { ...m, title: READOUT_CAPTION } : m;
      if (r !== m) patch.set(m.seq, r);
      readouts.push(r);
    }
  }
  readouts.sort((a, b) => a.seq - b.seq);
  // Bursts: per template, members no more than BURST_MS apart.
  const open = new Map<string, { members: Array<{ m: ChatMessage; name: string | null }>; last: number }>();
  const done: Array<{ template: string; members: Array<{ m: ChatMessage; name: string | null }> }> = [];
  for (const m of readouts) {
    const { template, name } = templateOf(m, opts.guestName, opts.names);
    const g = open.get(template);
    if (g !== undefined && m.ts - g.last <= BURST_MS) {
      g.members.push({ m, name });
      g.last = m.ts;
      continue;
    }
    if (g !== undefined) done.push({ template, members: g.members });
    open.set(template, { members: [{ m, name }], last: m.ts });
  }
  for (const [template, g] of open) done.push({ template, members: g.members });
  for (const { template, members } of done) {
    if (members.length < 2) continue;
    const who = [...new Set(members.map((x) => x.name).filter((n): n is string => n !== null))];
    const last = members[members.length - 1]!.m;
    for (const { m } of members.slice(0, -1)) patch.set(m.seq, { ...m, hidden: true });
    const { about: _about, ...rest } = last;
    patch.set(last.seq, { ...rest, text: burstLine(template, who, members.length) });
  }
  if (patch.size === 0) return messages;
  const out = new Map(messages);
  for (const [seq, m] of patch) out.set(seq, m);
  return out;
}
