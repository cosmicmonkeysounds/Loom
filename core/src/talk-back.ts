//! Talk-back (wave 32): Trabolta answers Clippy live in the Desktop.
//!
//! During a talk scene (the story's `Night.talk` names one; "none" = none)
//! the hosts' phones carry a talk panel. Task Manager types what Clippy just
//! said out loud (or taps a canned Clippy line) and `POST /api/mod/talk
//! {as: "Clippy", text, direction?}` commits it as Clippy's line in the
//! Desktop, then asks Trabolta's worker for a PUBLIC reply: a journaled
//! `say` by Trabolta in `loc:The Desktop` with audience "all", which the TV
//! speaks like any scripted line. A canned Trabolta line (`as: "Trabolta"`)
//! is committed straight away and stands in for a reply still owed.
//!
//! The scene catalog (the canned lines, per scene) is the show's, in
//! `talk-scenes.ts`; this module is the shape and the pure rules the
//! server, the host board and the play app share. Browser-safe, no imports
//! beyond `talk-scenes.ts`.

import { TALK_SCENES } from "./talk-scenes.ts";

/** The most characters a talk line (typed or canned) may hold. */
export const TALK_MAX = 280;
/** The most characters of a director's hidden steer on a canned Clippy line. */
export const TALK_DIRECTION_MAX = 300;
/** The room every talk scene plays in. */
export const TALK_ROOM = "The Desktop";
/** Who the host speaks for. */
export const TALK_AS = "Clippy";
/** Who answers. */
export const TALK_AGENT = "Trabolta";

/** One canned line on the panel. `label` is the chip's short face (the
 *  text is used when absent); `direction` is a hidden steer for the worker
 *  that rides with a canned Clippy line (never shown, never said). */
export interface TalkChip {
  text: string;
  label?: string;
  direction?: string;
}

/** One talk scene, as the show writes it. */
export interface TalkScene {
  /** The `Night.talk` value that opens it. */
  id: string;
  /** The panel's heading, e.g. "The ad attack". */
  title: string;
  /** A line for Task Manager: what this scene is for. */
  hint: string;
  /** Canned Clippy lines: tapping one sends it like typed text. The last
   *  one or two should hand the room on to what comes next. */
  clippy: TalkChip[];
  /** Canned Trabolta lines: tapping one commits it at once as his line (the
   *  model is slow, offline, or off the rails). */
  trabolta: TalkChip[];
  /** The admin INTERACTION a "⚡ Glitch" chip fires, or absent for none. */
  glitch?: string;
}

/** What a host's view carries while a talk scene is on (`HostView.talk`).
 *  Absent (or null) when none is. */
export interface TalkView {
  scene: string;
  title: string;
  hint: string;
  clippy: TalkChip[];
  trabolta: TalkChip[];
  glitch: string | null;
  /** A reply is owed: Clippy's newest line waits on the worker. */
  thinking: boolean;
  /** Since when (server ms) it has been owed; null when not thinking. */
  since: number | null;
  /** A worker voicing Trabolta is connected. */
  online: boolean;
  /** Trabolta is awake (the gate the worker answers through). */
  awake: boolean;
}

/** A talk post, as the route reads it. */
export interface TalkPost {
  as: typeof TALK_AS | typeof TALK_AGENT;
  text: string;
  direction?: string;
}

/** The scene `Night.talk` names, or null ("none", unset, or unknown). */
export function talkScene(night: string | null | undefined, catalog: Readonly<Record<string, TalkScene>> = TALK_SCENES): TalkScene | null {
  if (!night || night === "none") return null;
  return catalog[night] ?? null;
}

/** Shape-check a talk post's body: the post, or the 400 error word. */
export function readTalkPost(body: unknown): TalkPost | { error: "as" | "empty" | "too_long" | "direction" } {
  const b = (body ?? {}) as Record<string, unknown>;
  const as = b["as"] ?? TALK_AS;
  if (as !== TALK_AS && as !== TALK_AGENT) return { error: "as" };
  const raw = typeof b["text"] === "string" ? (b["text"] as string) : "";
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return { error: "empty" };
  if (text.length > TALK_MAX) return { error: "too_long" };
  const d = b["direction"];
  if (d !== undefined && d !== null && (typeof d !== "string" || d.length > TALK_DIRECTION_MAX)) return { error: "direction" };
  const direction = typeof d === "string" && d.trim() ? d.trim() : undefined;
  return direction && as === TALK_AS ? { as, text, direction } : { as, text };
}

/** The host view's talk block. */
export function talkView(
  night: string | null | undefined,
  state: { thinking: boolean; since: number | null; online: boolean; awake: boolean },
  catalog: Readonly<Record<string, TalkScene>> = TALK_SCENES,
): TalkView | null {
  const s = talkScene(night, catalog);
  if (!s) return null;
  return {
    scene: s.id,
    title: s.title,
    hint: s.hint,
    clippy: s.clippy,
    trabolta: s.trabolta,
    glitch: s.glitch ?? null,
    thinking: state.thinking,
    since: state.thinking ? state.since : null,
    online: state.online,
    awake: state.awake,
  };
}
