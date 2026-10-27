// Wave 32 (docs/loom-w32-contract.md): the talk scenes, read and checked the
// way the bots play them. Task Manager relays Clippy (`POST /api/mod/talk`),
// Trabolta answers the whole Desktop (the probe worker's public reply, or a
// canned line of his fired by hand), and ⚡ (`ad_burst`) flickers the
// screens before the ad attack and bursts an ad through them from it on.
// Pure, for `node --test`. The lines come from the show's own catalogue
// (core/src/talk-scenes.ts): the simulator writes no show text of its own.

import { TALK_AGENT, TALK_AS, TALK_ROOM, talkScene } from "../../../core/src/talk-back.ts";
import { read } from "./world.ts";

export { TALK_AGENT, TALK_AS };
/** The room every talk scene plays in, as a chat channel. */
export const TALK_CHANNEL = `loc:${TALK_ROOM}`;

/** A chat line as the director's history has it (the fields read here). */
export interface TalkMsg {
  seq: number;
  channel: string;
  from: string;
  kind: string;
  audience: "all" | string[];
  answers?: number;
  text?: string;
}

/** The scene's `n`th canned line for `who` (wrapping), or null when
 *  `Night.talk` names no scene the show has. */
export function cannedLine(scene: string, who: typeof TALK_AS | typeof TALK_AGENT, n = 0): { text: string; direction?: string } | null {
  const s = talkScene(scene);
  const chips = s === null ? [] : who === TALK_AS ? s.clippy : s.trabolta;
  if (chips.length === 0) return null;
  const c = chips[((n % chips.length) + chips.length) % chips.length]!;
  return c.direction !== undefined ? { text: c.text, direction: c.direction } : { text: c.text };
}

/** What the probe worker says to a request: a public (stage) request gets
 *  the scene's canned Trabolta line, a DM one of the probe's own lines.
 *  Null when the request carries no id. */
export function probeReply(req: { id?: string; stage?: { scene?: string } }, n: number, dmLines: readonly string[]): { id: string; say: string; stage: boolean } | null {
  if (req.id === undefined) return null;
  const scene = req.stage?.scene;
  if (scene !== undefined) {
    const line = cannedLine(scene, TALK_AGENT, n);
    if (line !== null) return { id: req.id, say: line.text, stage: true };
  }
  return { id: req.id, say: dmLines[n % dmLines.length] ?? "…", stage: scene !== undefined };
}

/** Trabolta's line in the Desktop after Clippy's (`after`), the newest
 *  first; undefined while none has landed. */
export function replyAfter(messages: readonly TalkMsg[], after: number): TalkMsg | undefined {
  return messages.filter((m) => m.channel === TALK_CHANNEL && m.from === TALK_AGENT && m.kind === "line" && m.seq > after).at(-1);
}

/** Why a talk line isn't what the room should have heard: in the Desktop,
 *  from `from`, said to everyone (audience "all", never the room's
 *  occupants) and, for an answer, naming the line it answers. */
export function talkLineProblems(m: TalkMsg | undefined, want: { from: string; answers?: number }): string[] {
  if (m === undefined) return [`no ${want.from} line in ${TALK_CHANNEL}`];
  const out: string[] = [];
  if (m.channel !== TALK_CHANNEL) out.push(`${want.from}'s line went to ${m.channel}, not ${TALK_CHANNEL}`);
  if (m.from !== want.from) out.push(`the line is ${m.from}'s, not ${want.from}'s`);
  if (m.audience !== "all") out.push(`${want.from}'s line reached ${Array.isArray(m.audience) ? m.audience.length : "?"} listener(s), not "all"`);
  if (want.answers !== undefined && m.answers !== want.answers) out.push(`${want.from}'s line answers ${m.answers ?? "nothing"}, not Clippy's line ${want.answers}`);
  return out;
}

/** The 📺 hijack's own three zeroes: the one copy with digits (C2). */
export const HIJACK_ZEROES = "000. 000. 000.";

/** Any decimal digit (the ad copy stays digit-free, C2/C8), the hijack's
 *  own zeroes aside. */
export const hasDigit = (s: string): boolean => /\p{Nd}/u.test(s.split(HIJACK_ZEROES).join(""));

/** How many more seconds of story time (`Time.elapsed`, whole seconds, one
 *  tick a second) the story holds a ⚡ back: the 📺 hijack's 8 s takeover
 *  (`glitch_kind` "full" and `Time.elapsed < glitch_at + 8`) and the 2 s
 *  between glitches (`Time.elapsed < burst_last + 2`), as main.loom's
 *  `when ad_burst` reads them. 0 when a ⚡ would fire now. The ticks drift
 *  on a loaded server, so the sim polls this rather than sleeping. */
export function glitchHeldFor(w: ReadonlyMap<string, string>): number {
  const now = Number(read(w, "Time.elapsed"));
  if (!Number.isFinite(now)) return 0;
  let until = 0;
  const at = Number(read(w, "Night.glitch_at"));
  if (read(w, "Night.glitch_kind") === "full" && Number.isFinite(at)) until = Math.max(until, at + 8);
  const last = Number(read(w, "Night.burst_last"));
  if (Number.isFinite(last) && last > 0) until = Math.max(until, last + 2);
  return Math.max(0, until - now);
}

/** What a ⚡ should have done to the world, by the scene it fired in.
 *  Before the ad attack (`intro`, `bottle`): a flicker, so `glitch_kind`,
 *  `glitch_text` and `burst_n` are unchanged. From it on (`ad`, `beans`): an
 *  ad burst, so `glitch_kind` "burst", `burst_n` one up and a digit-free
 *  `glitch_text`. The text is never printed (a line of show copy, but a
 *  failure note names only what is wrong). */
export function burstProblems(scene: string, before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  const nBefore = Number(read(before, "Night.burst_n"));
  const nAfter = Number(read(after, "Night.burst_n"));
  if (scene === "intro" || scene === "bottle") {
    for (const p of ["Night.glitch_kind", "Night.glitch_text", "Night.burst_n"]) {
      if (read(before, p) !== read(after, p)) out.push(`a flicker moved ${p}`);
    }
    if (read(after, "Night.burst_last") === read(before, "Night.burst_last")) out.push("the flicker never fired (Night.burst_last unchanged)");
    return out;
  }
  if (read(after, "Night.glitch_kind") !== "burst") out.push(`Night.glitch_kind = ${JSON.stringify(read(after, "Night.glitch_kind"))} (want "burst")`);
  if (!(nAfter === nBefore + 1)) out.push(`Night.burst_n ${read(before, "Night.burst_n")} → ${read(after, "Night.burst_n")} (want one more)`);
  const text = read(after, "Night.glitch_text");
  if (text === "none" || text === "") out.push("the burst carries no Night.glitch_text");
  else if (text === read(before, "Night.glitch_text")) out.push("the burst kept the previous glitch_text");
  else if (hasDigit(text)) out.push("the burst's glitch_text has a digit (the ad copy stays digit-free)");
  return out;
}
