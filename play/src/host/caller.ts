//! Who is calling the show (wave 18 B8, Q1: *hosts should be able to
//! equally see and call the event from Play*). One caller at a time, claimed
//! out loud: any host, the director phone or Run says `📣 I'll call`
//! (`POST /api/mod/caller {on}`), every cue-sheet view carries it as
//! `cues.caller {name, at}` (memory only on the server), and a FIRE from
//! anyone else asks once before it goes. Pure, so the director phone and the
//! host dock read the same words. No imports from `director.tsx` (it imports
//! this file).

import { foldName } from "../avatars.ts";

/** `cues.caller` (CONTRACTS C8): the console calling the show, by name, and
 *  the story ms it claimed. Absent from an older server; null when nobody
 *  calls. */
export interface CueCaller {
  name: string;
  at: number;
}

/** The caller a cue-state carries, feature-detected: an older server (or
 *  one whose core lane has not merged) sends none, and that reads as
 *  nobody. Anything malformed is nobody too. */
export function cueCaller(marks: unknown): CueCaller | null {
  if (marks === null || typeof marks !== "object") return null;
  const c = (marks as { caller?: unknown }).caller;
  if (c === null || typeof c !== "object") return null;
  const name = (c as { name?: unknown }).name;
  if (typeof name !== "string" || name.trim() === "") return null;
  const at = (c as { at?: unknown }).at;
  return { name: name.trim(), at: typeof at === "number" ? at : 0 };
}

/** Does this server know callers at all (its cue state carries a
 *  `caller` key, null or not)? An older one never does, and the chip and
 *  the claim stay away rather than read "nobody". */
export function callerKnown(marks: unknown): boolean {
  return marks !== null && typeof marks === "object" && "caller" in marks;
}

/** Is the caller this console? `me` is every name this console may be
 *  recorded under (a booth's part; a phone's typed name and its
 *  `Phone · <name>` label), folded like every name in the app. */
export function callerIsMe(caller: CueCaller | null, me: ReadonlyArray<string | null | undefined>): boolean {
  if (caller === null) return false;
  const k = foldName(caller.name);
  return me.some((m) => typeof m === "string" && m.trim() !== "" && foldName(m) === k);
}

/** A name the bar can show whole: a part ("Task Manager") or a phone
 *  ("Phone · Sam"). Anything else is a director at Run (an author's name,
 *  a headless mod token's "Director"), shown as `Run`. With no part list
 *  (the director phone) every name is shown as it is. */
function shownName(name: string, parts: readonly string[] | null): string {
  if (parts === null) return name;
  if (/^phone\b/iu.test(name)) return name;
  const k = foldName(name);
  return parts.some((p) => foldName(p) === k) ? name : "Run";
}

/** The NEXT bar's caller chip: `📣 You` / `📣 Task Manager` / `📣 Run` /
 *  `📣 nobody`. */
export function callerText(caller: CueCaller | null, me: ReadonlyArray<string | null | undefined>, parts: readonly string[] | null = null): string {
  if (caller === null) return "📣 nobody";
  if (callerIsMe(caller, me)) return "📣 You";
  return `📣 ${shownName(caller.name, parts)}`;
}

/** The Cues tab's *Who's calling* line. */
export function callerLine(caller: CueCaller | null, me: ReadonlyArray<string | null | undefined>): string {
  if (caller === null) return "📣 Nobody is calling.";
  if (callerIsMe(caller, me)) return "📣 You're calling.";
  return `📣 ${caller.name} is calling.`;
}

/** Does a FIRE from this console ask first (someone else is calling)? */
export function asksBeforeFire(caller: CueCaller | null, me: ReadonlyArray<string | null | undefined>): boolean {
  return caller !== null && !callerIsMe(caller, me);
}

/** The ask's words (BOOTH-SPEC §5.3, the copy deck). */
export function fireAnywayText(caller: CueCaller, cue: string): { title: string; body: string } {
  return { title: `Fire ${cue}?`, body: `${caller.name} is calling the show. Fire it anyway? They'll see you did.` };
}

/** The claim this console shows while its own write settles: the flip
 *  wins over a view that disagrees for `ms`, like the TV-voice toggle. */
export interface CallerFlip {
  on: boolean;
  at: number;
}

/** The caller as this console shows it: a fresh claim of its own (`on`)
 *  reads as `me`, a fresh let-go as nobody (when the view still names this
 *  console), else the view. */
export function shownCaller(view: CueCaller | null, flip: CallerFlip | null, me: string, now: number, ms: number): CueCaller | null {
  if (flip === null || now - flip.at > ms) return view;
  if (flip.on) return callerIsMe(view, [me]) ? view : { name: me, at: view?.at ?? 0 };
  return callerIsMe(view, [me]) ? null : view;
}
