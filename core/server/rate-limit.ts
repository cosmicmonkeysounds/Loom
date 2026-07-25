//! Tiny in-memory sliding-window rate limiter.
//!
//! The event server's passcodes are short and speakable by design (six
//! characters read across a noisy room), so the security of the login
//! endpoints rests on throttling online guessing, not on code entropy.
//! This limiter is deliberately minimal: per-key (usually per-IP) hit
//! windows in a Map, pruned lazily — no timers, no external store. A
//! multi-process deployment would need a shared store, but the event
//! server is a single process by design (the `Sim` is in-memory).
//!
//! Pure and clock-injectable so the rules are unit-testable.

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  /**
   * @param max      how many hits a key may record per window
   * @param windowMs the sliding window length
   */
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Would another hit be allowed for this key right now? (Does not record.) */
  allowed(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length < this.max;
  }

  /** Record a hit for this key. Call after the event you're counting. */
  record(key: string, now = Date.now()): void {
    const list = this.recent(key, now);
    list.push(now);
    this.hits.set(key, list);
  }

  /**
   * Record-and-check in one step: returns true (and counts the hit) while
   * the key is under its limit, false once it is over.
   */
  take(key: string, now = Date.now()): boolean {
    if (!this.allowed(key, now)) return false;
    this.record(key, now);
    return true;
  }

  /** Drop a key's history (e.g. forgive failures after a success). */
  reset(key: string): void {
    this.hits.delete(key);
  }

  private recent(key: string, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length === 0) this.hits.delete(key);
    return list;
  }
}
