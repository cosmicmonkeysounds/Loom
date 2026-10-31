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

/** One limiter's shape: `max` hits per `windowMs`. */
export interface RateRule {
  max: number;
  windowMs: number;
}

/**
 * Every throttle the event server applies. The per-IP ones bite hard on a
 * party's house Wi-Fi, where every phone shares one public IP — so each is
 * env-configurable (`LOOM_RL_*`) and the night's deployment raises them.
 */
export interface RateLimits {
  /** `/api/resolve-code` per IP (a code oracle). `LOOM_RL_RESOLVE`. */
  resolve: RateRule;
  /** Successful guest registrations per IP. `LOOM_RL_REGISTER`. */
  register: RateRule;
  /** Failed passcode attempts per IP before the lockout. `LOOM_RL_LOGIN_FAILURES`. */
  loginFailures: RateRule;
  /** Wrong codex codes per guest or booth part (`/api/guest/codex/redeem`, `/api/prime/codex/redeem`). `LOOM_RL_REDEEM_MISSES`. */
  redeemMisses: RateRule;
  /** Typed codes that are no printed code, per guest or booth part
   *  (`/api/guest/printed`, `/api/prime/printed`, wave 59). `LOOM_RL_PRINTED`. */
  printedAsks: RateRule;
  /** Widget answers per guest (`/api/guest/widget`) — a story that re-deals
   *  a card after every answer (📝 File a fact) can't be tapped into a
   *  flood of its thread + journal. `LOOM_RL_WIDGETS`. */
  widgets: RateRule;
  /** Wallet calls per guest (`/api/guest/wallet/*`) — the only brake on a
   *  phone flooding the approver's queue with tiny sends. `LOOM_RL_WALLET`. */
  wallet: RateRule;
  /** `/api/qr` per IP (it renders caller-chosen content). Every guest pass
   *  and the Run page's join QR draw on it, and the house Wi-Fi is one IP,
   *  so a door rush needs it raised. `LOOM_RL_QR`. */
  qr: RateRule;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  resolve: { max: 30, windowMs: 60_000 },
  register: { max: 20, windowMs: 60_000 },
  loginFailures: { max: 10, windowMs: 5 * 60_000 },
  redeemMisses: { max: 8, windowMs: 60_000 },
  printedAsks: { max: 30, windowMs: 60_000 },
  widgets: { max: 20, windowMs: 60_000 },
  wallet: { max: 30, windowMs: 60_000 },
  qr: { max: 60, windowMs: 60_000 },
};

const ENV_KEYS: Record<keyof RateLimits, string> = {
  resolve: "LOOM_RL_RESOLVE",
  register: "LOOM_RL_REGISTER",
  loginFailures: "LOOM_RL_LOGIN_FAILURES",
  redeemMisses: "LOOM_RL_REDEEM_MISSES",
  printedAsks: "LOOM_RL_PRINTED",
  widgets: "LOOM_RL_WIDGETS",
  wallet: "LOOM_RL_WALLET",
  qr: "LOOM_RL_QR",
};

/**
 * Read `LOOM_RL_*` overrides. Each takes `<max>` or `<max>/<seconds>`
 * (`LOOM_RL_REGISTER=400` or `LOOM_RL_LOGIN_FAILURES=60/300`); a missing or
 * malformed value keeps the default (logged, never fatal).
 */
export function rateLimitsFromEnv(env: Record<string, string | undefined>): RateLimits {
  const out = { ...DEFAULT_RATE_LIMITS };
  for (const key of Object.keys(ENV_KEYS) as (keyof RateLimits)[]) {
    const raw = env[ENV_KEYS[key]]?.trim();
    if (raw === undefined || raw === "") continue;
    const m = /^(\d+)(?:\s*\/\s*(\d+))?$/.exec(raw);
    const max = m !== null ? Number(m[1]) : NaN;
    const secs = m?.[2] !== undefined ? Number(m[2]) : null;
    if (!Number.isSafeInteger(max) || max < 1 || (secs !== null && secs < 1)) {
      console.warn(`${ENV_KEYS[key]}=${raw} ignored (want <max> or <max>/<seconds>)`);
      continue;
    }
    out[key] = { max, windowMs: secs !== null ? secs * 1000 : DEFAULT_RATE_LIMITS[key].windowMs };
  }
  return out;
}

/** A limiter built from a rule. */
export function limiterFor(rule: RateRule): RateLimiter {
  return new RateLimiter(rule.max, rule.windowMs);
}
