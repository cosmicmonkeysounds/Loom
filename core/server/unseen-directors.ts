//! Directors stay out of sight (2026-10-24): no phone but a director's own
//! reads a director's name. A guest sees the hosts and the programs; a
//! booth, hosts included, sees parts by name and everyone at Run, on the
//! director phone or on a headless mod token as plain "Director".
//!
//! The server names whoever acted by the journal's `by` (an author's
//! display name, `Booth · Task Manager`, `agent:Trabolta`, `Phone · Ada`,
//! `Director`). These helpers turn that into what a non-director may read:
//! the part's name when it is one of the story's characters, else
//! `DIRECTOR`. Pure; the event runtime applies them to every booth and host
//! view, booth chat lines and a guest's rejoin answer. The director phone
//! and Run keep the real names (they are directors).

import type { HostView } from "../src/host-board.ts";
import { foldName } from "../src/parser/names.ts";
import type { SimModel } from "../src/runtime/sim/model.ts";
import type { ChatMessage } from "./chat.ts";

/** What a non-director reads for any director. */
export const DIRECTOR = "Director";

/** The part a journal `by` names (its `Booth · ` / `agent:` prefix off),
 *  when it is one of the story's characters; null for anyone else. */
export function partName(by: string | null | undefined, model: SimModel | null): string | null {
  if (typeof by !== "string" || model === null) return null;
  const t = by.trim().replace(/^Booth · /u, "").replace(/^agent:/u, "").trim();
  if (t === "") return null;
  const k = foldName(t);
  for (const id of model.characters.keys()) if (foldName(id) === k) return id;
  return null;
}

/** `by` as a booth or a guest may read it: the part, else "Director". */
export function seenName(by: string, model: SimModel | null): string {
  return partName(by, model) ?? DIRECTOR;
}

/** A caller claim (`cues.caller`) as a booth reads it. */
export function seenCaller<T extends { name: string } | null | undefined>(caller: T, model: SimModel | null): T {
  if (caller === null || caller === undefined) return caller;
  return { ...caller, name: seenName(caller.name, model) };
}

/** A chat line as a booth reads it: never the director who said it as a
 *  participant (`via`), the same as a guest's copy. */
export function forBooth(m: ChatMessage): ChatMessage {
  if (m.via === undefined) return m;
  const { via: _via, ...rest } = m;
  return rest;
}

/** A cue state (`cues` / `calls`) as a booth reads it: the caller and the
 *  last presser by part, a director as "Director". */
export function seenCues<T extends { caller?: { name: string; at: number } | null; lastName?: string | null }>(cues: T, model: SimModel | null): T {
  const out = { ...cues };
  if (out.caller !== undefined) out.caller = seenCaller(out.caller, model);
  if (typeof out.lastName === "string") out.lastName = seenName(out.lastName, model);
  return out;
}

/** A host booth's panel (built on the directors' view) with every
 *  director's name read as "Director": the caller, LAST's presser, a Run
 *  persona's owner, who ruled a filing. */
export function hostSeen(view: HostView, model: SimModel | null): HostView {
  const out: HostView = { ...view, cues: seenCues(view.cues, model) };
  out.roster = view.roster.map((p) => (typeof p.owner === "string" ? { ...p, owner: DIRECTOR } : p));
  if (view.judging !== null) {
    const row = <R extends { by?: string | null; ruling?: { by: string } | null }>(r: R): R => ({
      ...r,
      ...(typeof r.by === "string" ? { by: seenName(r.by, model) } : {}),
      ...(r.ruling != null ? { ruling: { ...r.ruling, by: seenName(r.ruling.by, model) } } : {}),
    });
    out.judging = { ...view.judging, pending: view.judging.pending.map(row), recent: view.judging.recent.map(row) };
  }
  return out;
}
