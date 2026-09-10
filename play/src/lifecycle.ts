//! Pure run-lifecycle policy for the participant app: which `lifecycle`
//! notices from the server (`reset` / `reload` / `golive` / `ended`) end a
//! guest or performer session, and what the join screen then says. Kept
//! free of React + storage so it unit-tests directly (`test/lifecycle.test.ts`).

/** The transitions the server announces on its `lifecycle` SSE event. */
export const LifecycleKind = {
  /** Restarted on the same snapshot (`/api/mod/reset`). */
  Reset: "reset",
  /** Restarted on the project's current text (push draft). */
  Reload: "reload",
  /** A shared rehearsal was promoted in place to the live event. */
  GoLive: "golive",
  /** The run ended. */
  Ended: "ended",
} as const;
export type LifecycleKind = (typeof LifecycleKind)[keyof typeof LifecycleKind];

/** The two participant roles this app hosts. */
export const SessionRole = { Guest: "guest", Performer: "performer" } as const;
export type SessionRole = (typeof SessionRole)[keyof typeof SessionRole];

/**
 * Does this transition invalidate the stored session? Every restart clears
 * guest tokens server-side (guests re-register into the fresh story); a
 * performer's character sign-in survives `reset` / `reload` (the server just
 * re-sends snapshot + history) but not `golive` (performer sessions are
 * wiped when the show starts) or `ended`.
 */
export function lifecycleDropsSession(kind: string, role: SessionRole): boolean {
  switch (kind) {
    case LifecycleKind.Reset:
    case LifecycleKind.Reload:
      return role === SessionRole.Guest;
    case LifecycleKind.GoLive:
    case LifecycleKind.Ended:
      return true;
    default:
      return false;
  }
}

/** The one-line explanation the join screen shows after a session was
 *  dropped by a transition; `null` for a transition that keeps the session. */
export function lifecycleNotice(kind: string, role: SessionRole): string | null {
  if (!lifecycleDropsSession(kind, role)) return null;
  const again = role === SessionRole.Guest ? "join again with your code" : "sign in again with your passcode";
  switch (kind) {
    case LifecycleKind.Reset:
    case LifecycleKind.Reload:
      return `The story restarted — ${again}.`;
    case LifecycleKind.GoLive:
      return `The rehearsal ended and the show is starting — ${again}.`;
    case LifecycleKind.Ended:
      return "This event has ended.";
    default:
      return null;
  }
}

/**
 * A guest POST answered 401 (token no longer known) or 404 `unknown guest`
 * means the run restarted while this phone wasn't listening — treat it
 * exactly like a `reset` notice.
 */
export function guestSessionDead(status: number, message: string): boolean {
  return status === 401 || (status === 404 && /unknown guest/i.test(message));
}

/**
 * A performer POST answered 403 "sign in" means the booth's token lost its
 * character — the show went live while this phone was in a pocket. (A 403
 * "you can't post here" is a policy refusal, not a dead session.)
 */
export function performerSessionDead(status: number, message: string): boolean {
  return status === 403 && /sign in/i.test(message);
}
