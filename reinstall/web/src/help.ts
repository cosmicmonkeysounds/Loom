//! 🆘 Help Me at the tent (wave 44, `docs/loom-w44-contract.md` C9), pure:
//! when the button is offered, what it reads, and how long it rests after a
//! press. The press itself fires the story's own guest button for the
//! program the flow serves (`api.ts` `askForHelp`), so the hosts' alert and
//! the once-a-minute rule are the story's (`main.loom` `tent_help_me`).

import type { Program } from "./program.ts";

/** The story's guest button (`INTERACTION tent_help_me`). */
export const TENT_HELP_SIGNAL = "tent_help_me";
/** After a press the button rests this long (the story alerts once a minute). */
export const HELP_HOLD_MS = 60_000;
/** A failed press says so this long, then the button is back. */
export const HELP_FAIL_MS = 8000;

export type HelpState = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; until: number } | { kind: "failed"; until: number };

export const HELP_IDLE: HelpState = { kind: "idle" };

/** Offered to a program being reinstalled: captured, or marked (the begin
 *  captures them). Not a party favour after the ending: nobody is in trouble. */
export function helpOffered(program: Pick<Program, "captured" | "marked">): boolean {
  return program.captured || program.marked;
}

/** The state once its time is up (`now` in ms). */
export function helpAt(s: HelpState, now: number): HelpState {
  return (s.kind === "sent" || s.kind === "failed") && now >= s.until ? HELP_IDLE : s;
}

/** The answer of a press → the next state. */
export function helpAnswered(outcome: "ok" | "failed", now: number): HelpState {
  return outcome === "ok" ? { kind: "sent", until: now + HELP_HOLD_MS } : { kind: "failed", until: now + HELP_FAIL_MS };
}

// DRAFT w44 (the button's copy)
export function helpFace(s: HelpState): { label: string; disabled: boolean; note: string | null } {
  switch (s.kind) {
    case "idle":
      return { label: "🆘 Help Me", disabled: false, note: null };
    case "sending":
      return { label: "🆘 Calling…", disabled: true, note: null };
    case "sent":
      return { label: "🆘 Help is coming…", disabled: true, note: "Help is on the way. Stay where you are." };
    case "failed":
      return { label: "🆘 Help Me", disabled: false, note: "Couldn't call for help: wave at the tent's host." };
  }
}
