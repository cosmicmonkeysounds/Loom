//! The booth's pure decisions (wave 13): which story buttons sit on a
//! guest card's face, which facts it leads with, what the taskbar tray
//! shows, which rooms the sidebar lists, and when the camera runs. Kept free
//! of React so the tests pin each rule.

import { foldName } from "../avatars.ts";
import type { SpaceGroup } from "../rooms/spaces.ts";
import { badgeWorthy } from "../stream/badges.ts";
import type { Channel, CountdownSummary, GuestCardView, Interaction, ObjectiveView, PrimeGuest, WalletQueueView } from "../types.ts";

/** An objective's reserved button words: a guest's own pass / scan, never a booth's story button. */
const RESERVED = new Set(["pass", "scan"]);

/** At most this many story buttons on a card's face. */
export const FACE_MAX = 3;

/** One story button on a guest card, with whether it is on offer now. */
export interface CardButton {
  interaction: Interaction;
  /** On offer for this guest right now (the server's `card.live`). */
  live: boolean;
  /** A live objective names it (a face button the objective asks for, not one only live because of this guest). */
  named?: boolean;
}

/** A guest card's story buttons: the face (≤ 3) and the rest, under "All buttons…". */
export interface CardButtons {
  face: CardButton[];
  rest: CardButton[];
}

/**
 * Split the story's performer buttons for one booth: `mine` — this
 * character's own (or anyone's) and on offer right now (`while:`), in
 * story order; `more` — the rest (another character's, out of phase).
 * Another character's `by:` button (`only`) is left out: the server refuses
 * it from this booth. A host or admin booth keeps it under More (it may
 * press any). Since wave 13 the booth view carries no `who: admin` cue (the
 * cue sheet is the host's), and one that slips through is never offered.
 */
export function splitInteractions(list: readonly Interaction[], character: string, admin: boolean): { mine: Interaction[]; more: Interaction[] } {
  const mine: Interaction[] = [];
  const more: Interaction[] = [];
  const me = foldName(character);
  for (const i of list) {
    if (i.who === "admin") {
      if (admin) more.push(i);
      continue;
    }
    const ours = i.actors === undefined || i.actors.some((a) => foldName(a) === me);
    if (!ours && i.only === true && !admin) continue;
    (ours && i.live !== false ? mine : more).push(i);
  }
  return { mine, more };
}

/**
 * The face of a guest card: the union of every live objective's buttons, in
 * objective order then written order, that the server says are live for
 * this guest (`card.live`); then the buttons live *because of this guest*
 * (`card.guestScoped`) that no objective names; at most three. A story with
 * no objective at all falls back to this character's own live buttons.
 * Everything else the booth may press goes to `rest` (live ones first),
 * so the "All buttons…" fold still reaches every one.
 *
 * Without a card (an older server, or the card request failed) the view's
 * own `live` flags stand in for `card.live`.
 */
export function cardButtons(
  interactions: readonly Interaction[],
  objectives: readonly ObjectiveView[] | undefined,
  card: Pick<GuestCardView, "live" | "guestScoped"> | null,
  character: string,
  admin: boolean,
): CardButtons {
  const byId = new Map(interactions.filter((i) => i.who !== "admin").map((i) => [i.id, i]));
  const split = splitInteractions(interactions, character, admin);
  const offered = [...split.mine, ...split.more];
  const live = new Set(card !== null ? card.live : offered.filter((i) => i.live !== false).map((i) => i.id));
  const faceIds: string[] = [];
  const add = (id: string) => {
    if (faceIds.length >= FACE_MAX || faceIds.includes(id) || !live.has(id) || !byId.has(id)) return;
    faceIds.push(id);
  };
  const objs = objectives ?? [];
  for (const o of objs) for (const id of o.buttons) if (!RESERVED.has(id)) add(id);
  const named = new Set(faceIds);
  for (const id of card?.guestScoped ?? []) add(id);
  if (objs.length === 0) for (const i of split.mine) add(i.id);
  const face = faceIds.map((id) => ({ interaction: byId.get(id)!, live: true, ...(named.has(id) ? { named: true } : {}) }));
  // The rest: what this booth may press, minus the face; live ones first.
  const seen = new Set(faceIds);
  const restAll = offered.filter((i) => !seen.has(i.id) && i.who !== "admin");
  // A host / admin booth may press another character's `by:` button: the
  // card's `live` names them, so they belong in the fold too.
  for (const id of live) if (!seen.has(id) && !restAll.some((i) => i.id === id) && byId.has(id)) restAll.push(byId.get(id)!);
  const rest = [...restAll.filter((i) => live.has(i.id)), ...restAll.filter((i) => !live.has(i.id))].map((i) => ({ interaction: i, live: live.has(i.id) }));
  return { face, rest };
}

/** One line of what a press or a scan came to, as the card shows it. */
export type OutcomeLine =
  /** The story's reply to the booth (`respond` / `reply`). */
  | { kind: "reply"; text: string }
  /** What the character said to the guest (`Norton: Not yet. Finish your upload.`). */
  | { kind: "said"; from: string; text: string }
  /** A staff-room line the press produced: the story refused it, and why. */
  | { kind: "staff"; text: string }
  /** Nothing came back: "✔ Sent — no reply from the story". */
  | { kind: "none"; text: string };

/**
 * What the card says a press (or a scan) came to (C1): the story's replies,
 * the character's own lines to the guest, the staff-room explanation of a
 * refusal — and, when there is none of those, "✔ Sent — no reply from the
 * story" (never a bare ✔ that reads as success). Replies first, then what
 * was said, then the refusal; empty strings dropped.
 */
export function pressOutcome(r: { replies?: readonly string[]; said?: ReadonlyArray<{ from: string; text: string }>; staff?: readonly string[] }, kind: "press" | "scan"): OutcomeLine[] {
  const clean = (t: unknown) => (typeof t === "string" ? t.trim() : "");
  const out: OutcomeLine[] = [];
  for (const t of r.replies ?? []) if (clean(t) !== "") out.push({ kind: "reply", text: clean(t) });
  for (const l of r.said ?? []) if (l !== null && typeof l === "object" && clean(l.text) !== "") out.push({ kind: "said", from: clean(l.from), text: clean(l.text) });
  for (const t of r.staff ?? []) if (clean(t) !== "") out.push({ kind: "staff", text: clean(t) });
  if (out.length > 0) return out;
  return [{ kind: "none", text: kind === "scan" ? "✔ Scanned — no reply from the story" : "✔ Sent — no reply from the story" }];
}

/** The "All buttons…" fold opens by itself only when it is this short. */
export const FOLD_AUTO_MAX = 6;

/**
 * Does the card's "All buttons…" fold open by itself? Only when the face is
 * empty, the fold holds a button that is live now, and the fold is short
 * (≤ `FOLD_AUTO_MAX`): Clippy's 31 or a door part's 7 stay folded behind
 * their count — the performer opens them on purpose.
 */
export function foldOpensItself(buttons: CardButtons, cardRead: boolean): boolean {
  return cardRead && buttons.face.length === 0 && buttons.rest.some((b) => b.live) && buttons.rest.length <= FOLD_AUTO_MAX;
}

/**
 * One request at a time ("📡 Scan again"): `run` starts one only when none
 * is on its way and answers `null` to every tap until it settles. Each
 * scan is journaled and runs the story's scan hook, so a burst of taps
 * must never become a burst of scans.
 */
export function inFlightGate(): { run: <T>(start: () => Promise<T>) => Promise<T> | null; busy: () => boolean } {
  let busy = false;
  return {
    run: (start) => {
      if (busy) return null;
      busy = true;
      return start().finally(() => {
        busy = false;
      });
    },
    busy: () => busy,
  };
}

/** How long a card's buttons ignore taps after the card is replaced (a
 *  press's answer, a re-scan): longer than core's `ARM_DEAD_MS` (300 ms),
 *  so the second tap of a double tap never lands on whichever button moved
 *  under the finger when the new card re-flowed the face. */
export const FACE_SETTLE_MS = 600;

/** May a tap on the card's buttons fire at `now`? Not inside
 *  `FACE_SETTLE_MS` of the card being replaced (`landedAt`). */
export function faceSettled(landedAt: number | null, now: number, ms: number = FACE_SETTLE_MS): boolean {
  return landedAt === null || now - landedAt >= ms;
}

/**
 * When an open card must be re-read from the server (`/api/prime/card`):
 * the night moved (an objective opened or ticked a box, `Night.step` /
 * `Night.phase`) or the guest's own row changed (someone else acted on
 * them). Equal keys = the card on screen is still good.
 */
export function cardReadKey(
  guestId: string,
  objectives: readonly ObjectiveView[] | undefined,
  night: { step?: number | null; phase?: string | null } | undefined,
  row: PrimeGuest | null,
): string {
  return JSON.stringify([guestId, (objectives ?? []).map((o) => [o.id, o.checklist.map((c) => c.done)]), night?.step ?? null, night?.phase ?? null, row]);
}

/** One fact on a guest card. `loud` = read it first (Not cleared, 🔒,
 *  Marked); `warn` = mind it (⛔, Late, Bathroom Mode); `quiet` = plain
 *  text (📍, ✓ Cleared, a value). */
export interface FactChip {
  text: string;
  tone: "quiet" | "loud" | "warn";
}

/** A true flag a performer must act on (escort them, keep them in): loud. */
const LOUD_ON = /^(marked|in the internet|corrupt(ed)?|quarantin(e|ed)|banish(ed)?|captured|infected|flagged|wanted)\b/iu;
/** A true flag to mind (late, away from their phone): warn. */
const WARN_ON = /^(late|bathroom|afk|away|suspect(ed)?|watch(list|ed)?|on the watchlist)\b/iu;

/** How loud a true flag reads on the card. */
export function flagTone(label: string): FactChip["tone"] {
  const l = label.trim();
  return LOUD_ON.test(l) ? "loud" : WARN_ON.test(l) ? "warn" : "quiet";
}

/** A boolean flag whose *false* is the exception a performer must see:
 *  the gates a guest passes on the way in ("Not cleared", "Not checked in"). */
const GATE = /^(cleared|checked[\s-]?in|uploaded|registered|verified|scanned|approved|signed[\s-]?in|joined|arrived|present)\b/iu;

function isBoolValue(v: string): boolean {
  return v === "true" || v === "false";
}

/**
 * The facts a guest card leads with, by severity: the loud ones first (🔒
 * captured, a failed gate "Not cleared", a true Marked / In the Internet),
 * then the ones to mind (⛔ restricted, Late, Bathroom Mode), then where
 * they stand and the quiet rest (✓ Cleared, "Label: value"). A false
 * boolean that is not a gate is left out: "Not marked" on every card would
 * be noise.
 */
export function factChips(g: PrimeGuest, where: string | null): FactChip[] {
  const loud: FactChip[] = [];
  const warn: FactChip[] = [];
  const quiet: FactChip[] = [];
  if (g.captured) loud.push({ text: "🔒 Captured", tone: "loud" });
  if (g.restricted === true) warn.push({ text: "⛔ Restricted", tone: "warn" });
  for (const f of g.flags ?? []) {
    if (isBoolValue(f.value)) {
      if (f.on) {
        const tone = flagTone(f.label);
        (tone === "loud" ? loud : tone === "warn" ? warn : quiet).push({ text: tone === "quiet" ? `✓ ${f.label}` : f.label.trim(), tone });
      } else if (GATE.test(f.label.trim())) loud.push({ text: `✗ Not ${f.label.trim().toLowerCase()}`, tone: "loud" });
    } else if (f.on) quiet.push({ text: `${f.label}: ${f.value}`, tone: "quiet" });
  }
  return [...loud, ...warn, ...(where !== null ? [{ text: `📍 ${where}`, tone: "quiet" as const }] : []), ...quiet];
}

/**
 * The guest a card reads its facts off (C3): the live row from the booth's
 * snapshot (it follows another booth's act at once), whose `flags` the
 * server trims to the ones that are on plus failed gates; the card's own
 * read (`/api/prime/card`) carries the full list, so a false gate the
 * snapshot left out still reads "Not …". A label the row has wins.
 */
export function cardGuestFacts(row: PrimeGuest | null, read: PrimeGuest | null): PrimeGuest | null {
  if (row === null) return read;
  if (read === null || read.id !== row.id || read.flags === undefined) return row;
  const have = new Set((row.flags ?? []).map((f) => f.label));
  const extra = read.flags.filter((f) => !have.has(f.label) && !f.on && isBoolValue(f.value) && GATE.test(f.label.trim()));
  return extra.length === 0 ? row : { ...row, flags: [...(row.flags ?? []), ...extra] };
}

/** The tray's countdown: the soonest live one at story time `nowMs`, in seconds left. */
export function soonest(countdowns: readonly CountdownSummary[] | undefined, nowMs: number | null): { label: string; left: number } | null {
  if (countdowns === undefined || countdowns.length === 0 || nowMs === null) return null;
  let best: { label: string; left: number } | null = null;
  for (const c of countdowns) {
    const left = c.endsAt - nowMs / 1000;
    if (left <= 0) continue;
    if (best === null || left < best.left) best = { label: c.label, left };
  }
  return best;
}

/** "⏳ 14:59" under ten minutes, "⏳ 14 m" above (a clock never reads as a
 *  time of day); "⏸ …" while the story clock is stopped. */
export function trayClock(left: number, paused = false): string {
  const s = Math.max(0, Math.floor(left));
  const icon = paused ? "⏸" : "⏳";
  if (s >= 600) return `${icon} ${Math.floor(s / 60)} m`;
  return `${icon} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Is the story clock stopped (the event paused, the doors not yet open)?
 *  The view says so with `paused: true` — a guest's view and a booth's
 *  (`PrimeView.paused`) alike. */
export function viewPaused(view: object | null | undefined): boolean {
  return (view as { paused?: unknown } | null | undefined)?.paused === true;
}

/** Held transfers waiting on the approver's booth (the CRA's 🧾 tray item). */
export function heldCount(wallet: WalletQueueView | undefined): number {
  return wallet?.queue.filter((t) => t.state === "held").length ?? 0;
}

/** The act chip: the cue sheet's focus act, short enough for the tray
 *  ("Act C"; a title only when the act has no code). `title` is the full
 *  name, for the tooltip. */
export function actChip(act: { code: string | null; title: string | null } | null | undefined): { text: string; title: string } | null {
  if (act === null || act === undefined) return null;
  const full = [act.code, act.title].filter((x): x is string => x !== null && x !== "").join(" · ");
  if (full === "") return null;
  return { text: act.code !== null && act.code !== "" ? `Act ${act.code}` : act.title!, title: `Act ${full}` };
}

/**
 * The tray's act: the performer's own NOW objective's `act:` when it names
 * one ("Doors" before the show starts, "Act B" once it is under way), else
 * the cue sheet's focus act. The focus act is the act of NEXT, so during
 * the doors it already reads "Act B" while every objective says Doors.
 */
export function trayAct(
  act: { code: string | null; title: string | null } | null | undefined,
  objectives: readonly Pick<ObjectiveView, "act">[] | undefined,
): { text: string; title: string } | null {
  const own = objectives?.[0]?.act?.trim() ?? "";
  if (own === "") return actChip(act);
  const sheet = actChip(act);
  if (act?.code !== null && act?.code !== undefined && act.code === own && sheet !== null) return sheet;
  return /^[A-Z]$/u.test(own) ? { text: `Act ${own}`, title: `Act ${own}` } : { text: own, title: own };
}

/** Does this booth hold the host capability now (C4)? The latest view
 *  says so (`PrimeView.host`, re-sent on every snapshot); an older server's
 *  view carries none, and then the sign-in's answer stands. */
export function boothHost(auth: { host?: boolean } | null | undefined, view: { host?: true } | null | undefined): boolean {
  return (view?.host ?? auth?.host) === true;
}

/** Room ids the booth keeps reachable but out of the sidebar. */
const OFF_LIST = new Set(["__scanner"]);

/** The sidebar section a guest's waiting message puts their thread in. */
export const MESSAGES_SPACE = "guests";

/**
 * Has guest thread `c` an unread line the guest typed to this character
 * (`dm:<character>`)? `c.unread` counts the badge-worthy messages past the
 * read mark (`unreadOf`), and the thread holds every line addressed to the
 * guest, so its unread lines are the last `c.unread` *badge-worthy* rows —
 * never just the last `c.unread` rows (a story line to the guest after
 * theirs would hide it). A story line to the guest, or the guest's line to
 * another character a host stream carries, never counts.
 */
export function guestAwaitsReply(c: Channel, character: string): boolean {
  if (c.kind !== "guest" || c.unread <= 0 || character === "") return false;
  const name = c.people?.[0]?.name ?? c.title;
  const me = { id: character, name: character, booth: true };
  let left = c.unread;
  for (let k = c.messages.length - 1; k >= 0 && left > 0; k--) {
    const m = c.messages[k]!;
    if (!badgeWorthy(m, me)) continue;
    left -= 1;
    if (m.channel === `dm:${character}` && m.from === name && !m.hidden) return true;
  }
  return false;
}

/** How many guests wait on this character: threads holding an unread line
 *  the guest typed to it (the 🗂 Guests button's badge — never the head
 *  count, which reads as unread mail). */
export function guestsWaiting(channels: readonly Channel[], character: string): number {
  return character === "" ? 0 : channels.filter((c) => guestAwaitsReply(c, character)).length;
}

/**
 * The booth's lean sidebar: no Scanner row (the taskbar's 📷 Scan replaces
 * it) and no per-guest threads (they open from 🗂 Guests, the card's 💬 or
 * a readout) — except a guest who typed to this character and is not yet
 * read: their thread sits in a "Messages" section just under the booth's
 * own rooms until it is opened (and stays while it is the open room), so a
 * guest's "help, I'm stuck" never goes unseen. Everything stays in the
 * session's channel list, so a link or a card can still open it.
 */
export function boothSidebar(spaces: readonly SpaceGroup[], opts: { character?: string; activeId?: string | null } = {}): SpaceGroup[] {
  const character = opts.character ?? "";
  const keepGuest = (c: Channel) => c.id === opts.activeId || (character !== "" && guestAwaitsReply(c, character));
  const out: SpaceGroup[] = [];
  let messages: SpaceGroup | null = null;
  for (const s of spaces) {
    if (s.id === MESSAGES_SPACE) {
      const waiting = s.channels.filter((c) => c.kind === "guest" && keepGuest(c));
      if (waiting.length > 0) messages = { ...s, title: "Messages", channels: waiting };
      continue;
    }
    const channels = s.channels.filter((c) => !OFF_LIST.has(c.id) && c.kind !== "guest");
    if (channels.length > 0) out.push({ ...s, channels });
  }
  if (messages !== null) {
    // Right under the booth's own rooms (Readouts), above the house's long list.
    const at = out.findIndex((s) => s.id === "booth");
    const after = at >= 0 ? at + 1 : out.findIndex((s) => s.id !== "pinned" && s.id !== "staff");
    out.splice(after < 0 ? out.length : after, 0, messages);
  }
  return out;
}

/** The booth's own sections, never folded however quiet. */
const BOOTH_KEEP_SPACES: ReadonlySet<string> = new Set(["pinned", "staff", "booth", "cast"]);

/** Which booth rooms may fold into "Other rooms (n)": the house's — its
 *  location rooms and the story's chatrooms (`# back-channel`, `# general`)
 *  — when empty and quiet (`roomTier` decides that). Readouts, the Wallet,
 *  the staff rooms, the Cast, the broadcast feed and a guest's thread stay
 *  up. */
export function boothFoldable(c: Pick<Channel, "kind" | "spaceId">): boolean {
  if (BOOTH_KEEP_SPACES.has(c.spaceId)) return false;
  return c.kind !== "lobby" && c.kind !== "guest";
}

/** The guests matching a search, by name or id (folded), sorted by name. */
export function filterGuests(guests: readonly PrimeGuest[], q: string): PrimeGuest[] {
  const needle = foldName(q);
  const hits = needle === "" ? [...guests] : guests.filter((g) => foldName(g.name).includes(needle) || g.id.toLowerCase().includes(q.trim().toLowerCase()));
  return hits.sort((a, b) => a.name.localeCompare(b.name));
}

/** The camera runs while the scanner is open — a card over it included, so
 *  the next guest never waits through a camera restart (or a second
 *  permission prompt on iOS). */
export function cameraOn(scannerOpen: boolean, _cardOpen = false): boolean {
  return scannerOpen;
}

/** Does a pass the camera reads open a card? Not while a card is up or a
 *  scan is on its way, nor the pass whose card was just closed (`gate`). */
export function passAccepted(cardOpen: boolean, busy: boolean, gateAllows: boolean): boolean {
  return !cardOpen && !busy && gateAllows;
}

/** What the scanner window's × (or Escape) does: over a card it goes back
 *  to the live camera for the next guest; on the camera it leaves. */
export function scannerClose(cardOpen: boolean): "camera" | "leave" {
  return cardOpen ? "camera" : "leave";
}

/**
 * After a card closes the guest is often still holding their pass to the
 * lens: ignore that one pass for `ms`, so closing a card never re-opens it,
 * while the next guest in the queue scans at once.
 */
export function closedGate(ms: number, now: () => number = Date.now): { closed: (id: string) => void; allows: (id: string) => boolean } {
  let last: { id: string; at: number } | null = null;
  return {
    closed: (id) => {
      last = { id, at: now() };
    },
    allows: (id) => last === null || last.id !== id || now() - last.at >= ms,
  };
}

/** The booth's stream URL. The capabilities ride it so a sign-in that adds
 *  admin or host reopens the stream (the server fixes visibility at connect). */
export function primeStreamUrl(base: string, auth: { token: string; admin: boolean; host?: boolean } | null): string | null {
  if (auth === null) return null;
  const cap = `${auth.admin ? "a" : ""}${auth.host === true ? "h" : ""}`;
  return `${base}/events?role=prime&token=${encodeURIComponent(auth.token)}${cap !== "" ? `&cap=${cap}` : ""}`;
}
