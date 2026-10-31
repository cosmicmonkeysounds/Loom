// The teleprompter's script (wave 55, `docs/loom-w55-contract.md`): pure and
// eager. The server marks each line of a beat with `aloud:` (`ChatMessage.aloud`);
// here those lines become one running script per reader, in sections. A
// section is one run of one beat; one where this reader says nothing (a
// ceremony Trabolta hosted) is left out. `seq` marks how far they have read.

import type { ChatMessage } from "../types.ts";

export interface ScriptLine {
  seq: number;
  /** Story clock (ms). */
  ts: number;
  /** Who says it; "" for a stage direction or a program's own reading. */
  speaker: string;
  text: string;
  manner: string | null;
  /** This reader says it out loud; otherwise it is a cue. */
  mine: boolean;
  /** Wave 59: his, said by the TV when the prompter reaches it. */
  his?: boolean;
}

export interface ScriptSection {
  title: string;
  lines: ScriptLine[];
}

/** A sign-in on a new phone is shown what landed this recently, not the whole
 *  night. Past the longest read (wave 58: the monologue lands at once and takes
 *  14 minutes at the prompter's pace), so a phone swapped mid-read still gets it. */
export const ALOUD_WINDOW_MS = 20 * 60_000;

export function scriptOf(messages: Iterable<ChatMessage>, me: string): ScriptSection[] {
  const rows = [...messages].filter((m) => m.hidden !== true && m.aloud?.readers.includes(me) === true).sort((a, b) => a.seq - b.seq);
  const sections: ScriptSection[] = [];
  let beat: string | null | undefined;
  let ts = -1;
  for (const m of rows) {
    if (m.beat !== beat || m.ts !== ts || sections.length === 0) sections.push({ title: m.beat ?? "", lines: [] });
    beat = m.beat;
    ts = m.ts;
    sections[sections.length - 1]!.lines.push({
      seq: m.seq,
      ts: m.ts,
      speaker: m.kind === "narration" ? "" : m.from,
      text: m.text,
      manner: m.manner ?? null,
      mine: m.aloud?.reader === me,
    });
  }
  return sections.filter((s) => s.lines.some((l) => l.mine));
}

/** This reader's lines past the mark. */
export function unreadLines(script: readonly ScriptSection[], mark: number): ScriptLine[] {
  return script.flatMap((s) => s.lines.filter((l) => l.mine && l.seq > mark));
}

export function lastSeq(script: readonly ScriptSection[]): number {
  const lines = script[script.length - 1]?.lines ?? [];
  return lines[lines.length - 1]?.seq ?? 0;
}

/** Where a phone with no mark starts counting: older lines are not news. */
export function markFloor(script: readonly ScriptSection[], clock: number): number {
  let floor = 0;
  for (const s of script) for (const l of s.lines) if (l.ts < clock - ALOUD_WINDOW_MS) floor = l.seq;
  return floor;
}
