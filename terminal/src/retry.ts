//! Lazy-chunk loading that survives a failure. `React.lazy` caches a
//! rejected import for good, so a world-view chunk that failed once (a Wi-Fi
//! blip, a rebuild that renamed the hashed chunk) would never load again;
//! `retryable` shares one in-flight / settled load and forgets a failed one,
//! so the next call tries again.

/** A loader that shares a successful load and retries after a failed one. */
export function retryable<T>(factory: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () =>
    (pending ??= factory().catch((e: unknown) => {
      pending = null;
      throw e;
    }));
}

/**
 * Should a screen that can't load its code reload the page? Only when the
 * page itself is reachable (a reload while the server is down would leave a
 * TV on the browser's error page) and not within `minGapMs` of the last
 * reload this tab made (no reload loop).
 */
export function mayReload(pageReachable: boolean, lastReload: number | null, now: number, minGapMs: number): boolean {
  return pageReachable && (lastReload === null || now - lastReload >= minGapMs);
}
