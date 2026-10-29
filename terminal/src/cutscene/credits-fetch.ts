//! The credits a screen rolls (wave 44, C8): `GET /e/<id>/api/credits` with
//! the terminal's mod token (`access-bus.ts`), asked once per credits slide
//! (its `seq`, within the sim's `announceEpoch`: a restart's seqs start
//! over). A 404 (`no_credits`) is final: the scene draws the fallback card.
//! A network error or another status draws the fallback too, but is asked
//! again a few times (`CREDITS_RETRY_MS`), so a server that blinked still
//! rolls the real credits. Pure but for the module's one cache: fetch and
//! the timer are injected, so tests drive it in node.

import type { CreditsPerson, CreditsSection, CreditsView } from "../../../core/src/credits.ts";
import { sceneAccess, type SceneAccess } from "./access-bus.ts";

/** One answer: the view, none (404), or an error worth asking again. */
export type CreditsLoad = { kind: "ok"; view: CreditsView } | { kind: "none" } | { kind: "error" };

/** What a screen has for a roll: still asking, the view, or nothing (draw the fallback). */
export type CreditsEntry = { status: "loading" } | { status: "ready"; view: CreditsView } | { status: "none" } | { status: "failed" };

/** A fetch is given up after this long (ms). */
export const CREDITS_TIMEOUT_MS = 8000;
/** After an error, ask again this much later (ms) … */
export const CREDITS_RETRY_MS = 5000;
/** … this many times in all. */
export const CREDITS_TRIES = 4;
/** Rolls the cache remembers (the newest). */
export const CREDITS_KEEP = 4;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A route's JSON as a `CreditsView`, or null when it isn't one (no title, no sections). */
export function asCreditsView(raw: unknown): CreditsView | null {
  if (!isObj(raw) || typeof raw["title"] !== "string" || !Array.isArray(raw["sections"])) return null;
  const sections: CreditsSection[] = [];
  for (const s of raw["sections"] as unknown[]) {
    if (!isObj(s)) continue;
    const people: CreditsPerson[] = Array.isArray(s["people"])
      ? (s["people"] as unknown[]).filter((p): p is CreditsPerson => isObj(p) && typeof p["role"] === "string" && typeof p["name"] === "string").map((p) => ({ role: p.role, name: p.name }))
      : [];
    sections.push({ heading: typeof s["heading"] === "string" ? s["heading"] : "", people, lines: strs(s["lines"]), ...(s["programs"] === true ? { programs: true as const } : {}) });
  }
  return {
    title: raw["title"],
    subtitle: typeof raw["subtitle"] === "string" && raw["subtitle"].trim() !== "" ? raw["subtitle"] : null,
    sections,
    end: strs(raw["end"]),
    roll: typeof raw["roll"] === "number" ? raw["roll"] : 0,
  };
}

/** Ask the server for the credits. Never throws. */
export async function fetchCredits(access: SceneAccess | null, fetchFn: typeof fetch = fetch, timeoutMs = CREDITS_TIMEOUT_MS): Promise<CreditsLoad> {
  if (access === null) return { kind: "error" };
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl === null ? null : setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${access.base}/api/credits`, { headers: { "x-loom-token": access.token }, cache: "no-store", ...(ctl === null ? {} : { signal: ctl.signal }) });
    if (res.status === 404) return { kind: "none" };
    if (!res.ok) return { kind: "error" };
    const view = asCreditsView(await res.json());
    return view === null ? { kind: "none" } : { kind: "ok", view };
  } catch {
    return { kind: "error" };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** The cache's key for a roll: the sim's epoch and the slide's seq. */
export function creditsKey(epoch: string | null, seq: number): string {
  return `${epoch ?? ""}#${seq}`;
}

export interface CreditsCacheOpts {
  load: () => Promise<CreditsLoad>;
  /** `setTimeout` (injected for tests). */
  later?: (fn: () => void, ms: number) => unknown;
  retryMs?: number;
  tries?: number;
  keep?: number;
}

/** One answer per roll, shared by every scene that draws it (the TV's take and a remount). */
export class CreditsCache {
  private readonly entries = new Map<string, CreditsEntry>();
  private readonly listeners = new Set<() => void>();
  constructor(private opts: CreditsCacheOpts) {}

  /** Swap the loader (the preview's fixture). Forgets every roll. */
  setLoad(load: () => Promise<CreditsLoad>): void {
    this.opts = { ...this.opts, load };
    this.entries.clear();
  }

  /** What there is for `key` now (nothing asked yet: `loading`). */
  peek(key: string): CreditsEntry {
    return this.entries.get(key) ?? { status: "loading" };
  }

  /** Has `key` been asked for? */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Ask for `key` once (again only after an error, `tries` in all). */
  request(key: string): void {
    if (this.entries.has(key)) return;
    this.entries.set(key, { status: "loading" });
    while (this.entries.size > (this.opts.keep ?? CREDITS_KEEP)) this.entries.delete(this.entries.keys().next().value as string);
    this.attempt(key, 1);
  }

  /** Put an answer in by hand (tests, the preview). */
  seed(key: string, entry: CreditsEntry): void {
    this.entries.set(key, entry);
    this.emit();
  }

  /** Hear every change; returns the unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private attempt(key: string, n: number): void {
    const load = this.opts.load;
    void load().then(
      (r) => this.settle(key, n, load, r),
      () => this.settle(key, n, load, { kind: "error" }),
    );
  }

  private settle(key: string, n: number, load: () => Promise<CreditsLoad>, r: CreditsLoad): void {
    // Forgotten meanwhile, or the loader swapped: not ours to fill.
    if (!this.entries.has(key) || load !== this.opts.load) return;
    const prev = this.entries.get(key)!;
    if (r.kind === "ok") this.entries.set(key, { status: "ready", view: r.view });
    else if (r.kind === "none") this.entries.set(key, { status: "none" });
    else {
      // An error: the fallback now (unless an answer came), and ask again.
      if (prev.status === "loading") this.entries.set(key, { status: "failed" });
      if (n < (this.opts.tries ?? CREDITS_TRIES)) (this.opts.later ?? setTimeout)(() => this.entries.has(key) && this.attempt(key, n + 1), this.opts.retryMs ?? CREDITS_RETRY_MS);
    }
    this.emit();
  }

  private emit(): void {
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch {
        /* a scene that went away */
      }
    }
  }
}

/** The page's one cache, asking with the terminal's access. */
export const creditsCache = new CreditsCache({ load: () => fetchCredits(sceneAccess()) });
