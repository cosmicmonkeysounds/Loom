//! The phone's own Back (wave 18 fix NM-F9): on Android the system Back
//! gesture (and a browser's ←) walked the page away from the app after any
//! exit, because nothing in the app ever made a history entry. While the
//! guest is anywhere but home (a room, an overlay, another window) the app
//! keeps exactly one entry of its own on the stack; Back pops it and the app
//! steps back one place instead (`onBack`), then puts the entry back while
//! there is still somewhere to step back from. Reaching home in the app
//! takes its entry off again.
//!
//! Only when the app owns the page (`host.ownsPage`): embedded in an
//! editor's Run → Players pane it never touches the page's history (one
//! pane must never move another).

import { useEffect, useRef } from "react";

/** The bits of `window.history` the stack needs (a fake in tests). */
export interface HistoryLike {
  pushState(data: unknown, unused: string): void;
  back(): void;
}

/** The marker on the app's own entry. */
export const BACK_MARK = { loomBack: 1 } as const;

/**
 * The one-entry stack, pure over a `HistoryLike`: `sync(away)` after every
 * render (away = not home), `pop()` on each `popstate` — true when the app
 * should step back (it was our entry), false when it was our own `back()`.
 */
export class BackStack {
  private pushed = false;
  private ignore = 0;
  constructor(private readonly history: HistoryLike) {}

  sync(away: boolean): void {
    if (away && !this.pushed) {
      this.history.pushState(BACK_MARK, "");
      this.pushed = true;
    } else if (!away && this.pushed) {
      this.pushed = false;
      this.ignore += 1;
      this.history.back();
    }
  }

  pop(): boolean {
    if (this.ignore > 0) {
      this.ignore -= 1;
      return false;
    }
    if (!this.pushed) return false;
    this.pushed = false;
    return true;
  }
}

/** Wire `BackStack` to the page: `away` = the guest is not home; `onBack` steps back one place. */
export function useSystemBack(ownsPage: boolean, away: boolean, onBack: () => void): void {
  const stack = useRef<BackStack | null>(null);
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    if (!ownsPage || typeof window === "undefined") return;
    const s = new BackStack(window.history);
    stack.current = s;
    const on = () => {
      // Still somewhere to step back from after this step: the next render's
      // `sync` (it runs on every one) puts the entry back.
      if (s.pop()) back.current();
    };
    window.addEventListener("popstate", on);
    return () => {
      window.removeEventListener("popstate", on);
      stack.current = null;
    };
  }, [ownsPage]);
  useEffect(() => {
    stack.current?.sync(away);
  });
}
