//! How a line is delivered to a phone (wave 13): the interrupt ladder a
//! story's `alerts:` world value picks (balloon → sticky → dialog → bsod),
//! the dialogue manners that make a line effect text, and the `~` prefix
//! that marks a broadcast as a per-person notice. Dependency-free: the play
//! app imports it by path (`../../core/src/delivery.ts`), so nothing here
//! may reach `node:*`, `server/*` or the sim.

/** The interrupt ladder, low → high (D2). */
export type AlertLevel = "balloon" | "sticky" | "dialog" | "bsod";
export const ALERT_LEVELS: readonly AlertLevel[] = ["balloon", "sticky", "dialog", "bsod"];
export const DEFAULT_ALERT_LEVEL: AlertLevel = "sticky";

/** A world value as written (`display()` output, quotes allowed) → its level; anything else → "sticky". Case-insensitive. */
export function alertLevelOf(raw: string | null | undefined): AlertLevel {
  if (raw == null) return DEFAULT_ALERT_LEVEL;
  const word = String(raw).trim().replace(/^["'`]+|["'`]+$/g, "").trim().toLowerCase();
  return (ALERT_LEVELS as readonly string[]).includes(word) ? (word as AlertLevel) : DEFAULT_ALERT_LEVEL;
}

/** One rung lower, floored at "balloon" (a minor moment). */
export function lowerRung(level: AlertLevel): AlertLevel {
  const i = ALERT_LEVELS.indexOf(level);
  return ALERT_LEVELS[Math.max(0, i - 1)] ?? "balloon";
}

/** Dialogue manners that make a line effect text (folded, any word of the manner matches). */
export const EFFECT_MANNERS: ReadonlySet<string> = new Set([
  "glitch",
  "glitching",
  "glitched",
  "static",
  "corrupted",
  "corrupt",
  "scream",
  "screaming",
  "screams",
  "distorted",
  "garbled",
  "error",
  "flicker",
  "flickering",
  "bsod",
]);

/** Does this manner mark effect text? "quietly", "whispering", "weakly" → false; "glitch", "quietly, glitching" → true. */
export function isEffectManner(manner: string | null | undefined): boolean {
  if (!manner) return false;
  for (const word of manner.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word && EFFECT_MANNERS.has(word)) return true;
  }
  return false;
}

/** `~` at the start of a broadcast cue (outside or just inside its quotes) marks a per-person notice. Mirrors chat.ts `splitAlert`. */
export function splitNotice(rawCue: string): { cue: string; notice: boolean } {
  const t = rawCue.trim();
  if (t.startsWith("~")) return { cue: t.slice(1).trim(), notice: true };
  if (t.startsWith('"~')) return { cue: `"${t.slice(2).trimStart()}`, notice: true };
  return { cue: t, notice: false };
}

/** One leading emoji / symbol cluster: a pictograph or symbol, then any
 *  variation selector, skin tone, keycap mark or ZWJ-joined pictograph. */
const NOTICE_GLYPH =
  /^(?:\p{RI}\p{RI}|[#*0-9]\uFE0F?\u20E3|(?:\p{Extended_Pictographic}|\p{S})(?:\uFE0F|\uFE0E|\p{EMod}|\u20E3|\u200D(?:\p{Extended_Pictographic}|\p{S}))*)/u;

/** A notice's collapse key: its leading emoji / symbol cluster (`✅`, `🤷`, `🎀`), else "•". */
export function noticeKey(text: string): string {
  const t = text.trim().replace(/^["'`]+/, "").trimStart();
  const m = NOTICE_GLYPH.exec(t);
  return m ? m[0] : "•";
}

/** Moment classes the server stamps (§2.3). `big` (wave 18, C1): an
 *  un-ignorable full-screen moment (`reply !!…`, `broadcast "!!…"`,
 *  `show … with moment: big`) — a booth renders it as its pop-out rung. */
export type MomentClass = "major" | "minor" | "big";

/** A moment's exit button (wave 18, C2): where a tap takes the viewer.
 *  Resolved server-side from the story's `with go:` words (or a default:
 *  a card's DM thread, a quest step's quest, a codex unlock's entry, a
 *  wallet card's Wallet) — never the lobby. A `room` the viewer cannot see
 *  is dropped per viewer before it is sent. */
export type GoTarget =
  | { kind: "room"; id: string; label: string }
  | { kind: "dm"; id: string; label: string }
  | { kind: "pass" | "scan" | "chats" | "mission" | "notifications" | "sides" | "wallet" | "me"; label: string }
  | { kind: "codex"; entry?: string; label: string }
  | { kind: "quests"; quest?: string; label: string }
  | { kind: "act"; id: string; label: string };

/** The reserved `go:` words (C2), each a screen of the phone. */
export const GO_WORDS = ["pass", "scan", "chats", "mission", "notifications", "sides", "wallet", "me", "codex", "quests"] as const;

/** The label a reserved `go:` word gets when the story writes none. */
export const GO_LABELS: Readonly<Record<(typeof GO_WORDS)[number], string>> = {
  pass: "Show my pass",
  scan: "Scan",
  chats: "Chats",
  mission: "What do I do?",
  notifications: "See all",
  sides: "Choose a side",
  wallet: "Open my Wallet",
  me: "Me",
  codex: "Open the Codex",
  quests: "Open the Quest Log",
};

/** The dead time before a big moment's acknowledge button works (C1). */
export const BIG_DEAD_MS = 1200;
