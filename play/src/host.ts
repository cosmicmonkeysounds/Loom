//! Where the participant app is running — the seam that lets the SAME app
//! run standalone on a phone (the default: the whole page, `localStorage`
//! sessions, `?code=` / `?unlock=` links, viewport breakpoints) or embedded
//! several times over inside the editor's Run → Players page (`embed.tsx`:
//! each copy in its own shadow root, an in-memory session handed in by the
//! director, breakpoints from its own pane width, keys scoped to its pane).
//!
//! Everything that used to reach for a page-global (`localStorage`,
//! `document.documentElement`, `window` keydown, the URL, the typewriter's
//! crawl-once memory) goes through the host instead, so two panes never
//! share a session, a theme, a keystroke, or a crawl.

import { createContext, useContext } from "react";

/** Key/value persistence for the role sessions (`loom.guest` / `loom.prime`). */
export interface SessionStorage {
  load<T>(key: string): T | null;
  save(key: string, value: unknown): void;
  drop(key: string): void;
}

/**
 * Which lines crawl in like game dialogue: only a line that *arrives* while
 * you are watching — never the backlog, and never again once it has crawled
 * (re-opening a room must not replay it). Sessions set `baseline` from the
 * history frame; the bubble marks a seq done the moment it starts.
 */
export interface Crawl {
  /** Reset for a new stream (a fresh sign-in). */
  reset(): void;
  /** The backlog just loaded: everything at or below `maxSeq` is old news. */
  loaded(maxSeq: number): void;
  /** Should this seq crawl now? Claims it if so (one crawl, ever). */
  claim(seq: number): boolean;
  /** Lines crawl one at a time, in order, like dialogue: `go` runs once
   *  every earlier line still crawling has finished. */
  start(seq: number, go: () => void): void;
  /** A crawl finished (or its bubble left the screen) — release the next. */
  finish(seq: number): void;
}

export function createCrawl(): Crawl {
  let baseline = Number.MAX_SAFE_INTEGER;
  const done = new Set<number>();
  let active: number | null = null;
  let queue: Array<{ seq: number; go: () => void }> = [];
  const pump = () => {
    if (active !== null || queue.length === 0) return;
    queue.sort((a, b) => a.seq - b.seq);
    const next = queue.shift()!;
    active = next.seq;
    next.go();
  };
  return {
    reset() {
      baseline = Number.MAX_SAFE_INTEGER;
      done.clear();
      active = null;
      queue = [];
    },
    loaded(maxSeq) {
      baseline = maxSeq;
    },
    claim(seq) {
      if (seq <= baseline || done.has(seq)) return false;
      done.add(seq);
      return true;
    },
    start(seq, go) {
      queue.push({ seq, go });
      pump();
    },
    finish(seq) {
      if (active === seq) active = null;
      else queue = queue.filter((q) => q.seq !== seq);
      pump();
    },
  };
}

export interface PlayHost {
  /** Running inside another app (the editor), not as the page itself. */
  embedded: boolean;
  storage: SessionStorage;
  /** The element that carries the story's `data-theme`. */
  themeRoot(): HTMLElement | null;
  /** Where page-wide shortcuts (the decision tray's 1–9 / arrows) listen. */
  keyTarget(): EventTarget | null;
  /** Honour URL affordances (`?code=`, `?unlock=`) and name the browser tab. */
  ownsPage: boolean;
  /** Chime + vibrate on an alert broadcast. */
  sound: boolean;
  /** The two-pane layout, when the host decides it (an embedded pane's own
   *  width); null → the viewport media query. */
  wide: boolean | null;
  crawl: Crawl;
  /** The session ended — the participant left, or a run transition dropped
   *  it (`notice` says why, null when they left). */
  onEnded(role: "guest" | "prime", notice: string | null): void;
}

function localStore(): SessionStorage {
  return {
    load<T>(k: string): T | null {
      try {
        return JSON.parse(localStorage.getItem(k) ?? "null") as T | null;
      } catch {
        return null;
      }
    },
    save: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
    drop: (k) => localStorage.removeItem(k),
  };
}

/** An in-memory store, optionally seeded (an embedded pane's handed-in session). */
export function memoryStore(seed: Record<string, unknown> = {}): SessionStorage {
  const m = new Map<string, string>(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    load<T>(k: string): T | null {
      const raw = m.get(k);
      return raw === undefined ? null : (JSON.parse(raw) as T);
    },
    save: (k, v) => void m.set(k, JSON.stringify(v)),
    drop: (k) => void m.delete(k),
  };
}

/** The standalone page. */
export const browserHost: PlayHost = {
  embedded: false,
  storage: localStore(),
  themeRoot: () => (typeof document === "undefined" ? null : document.documentElement),
  keyTarget: () => (typeof window === "undefined" ? null : window),
  ownsPage: true,
  sound: true,
  wide: null,
  crawl: createCrawl(),
  onEnded: () => {},
};

export const PlayHostContext = createContext<PlayHost>(browserHost);

export function usePlayHost(): PlayHost {
  return useContext(PlayHostContext);
}
