//! The no-input leash — pure (the clock is passed in). 120 s without input
//! ends a session (§3), and only time the player could have touched
//! something counts: while the tab is hidden the leash pauses (and the game
//! stops its keepalives, so the server's own 60 s pose timeout applies
//! instead — a tab left hidden is dropped by the server, not shown frozen
//! on every terminal forever). Coming back resumes the leash where it was,
//! never with an instant idle kill.

/** No input for this long ends the session (§3). */
export const IDLE_LIMIT_MS = 120_000;
/** The HUD starts counting down this long before. */
export const IDLE_WARN_MS = 20_000;

export class IdleLeash {
  private lastInputAt: number;
  private hiddenAt: number | null = null;

  constructor(now: number) {
    this.lastInputAt = now;
  }

  /** The player did something. */
  touch(now: number): void {
    this.lastInputAt = now;
    if (this.hiddenAt !== null) this.hiddenAt = now;
  }

  /** The tab went out of sight: the leash stops counting. */
  hide(now: number): void {
    if (this.hiddenAt === null) this.hiddenAt = now;
  }

  /** The tab is back: the hidden stretch never happened, as far as the leash is concerned. */
  show(now: number): void {
    if (this.hiddenAt === null) return;
    this.lastInputAt += Math.max(0, now - this.hiddenAt);
    this.hiddenAt = null;
  }

  get hidden(): boolean {
    return this.hiddenAt !== null;
  }

  /** Visible ms since the last input. */
  idleFor(now: number): number {
    return Math.max(0, (this.hiddenAt ?? now) - this.lastInputAt);
  }

  /** The leash has run out. */
  expired(now: number, limit = IDLE_LIMIT_MS): boolean {
    return this.idleFor(now) >= limit;
  }

  /** Whole seconds left once inside the warning window, else null. */
  warning(now: number, limit = IDLE_LIMIT_MS, warn = IDLE_WARN_MS): number | null {
    const idle = this.idleFor(now);
    return idle >= limit - warn ? Math.max(0, Math.ceil((limit - idle) / 1000)) : null;
  }
}
