//! The lazily loaded parts of the app (wave 13 fix round: the booth, the
//! director's cue sheet, the Help articles) and what happens when one will
//! not load. A chunk fetch can fail — a phone on the house Wi-Fi dropping a
//! request, or a page left open across a deploy, whose old chunk names no
//! longer exist — and `React.lazy` then throws to the nearest error
//! boundary. With none, the whole app unmounts to a white page. So every
//! lazy part is fetched once more after a short wait (`retryImport`) and
//! sits behind a `ChunkBoundary` that says what failed and offers the way
//! back (Reload, or Try again).

import { Component, lazy, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";

/** How long before the one retry of a failed chunk fetch. */
export const RETRY_MS = 1500;

/** `load()`, and once more after `wait` ms if it fails (pure but for the timer). */
export function retryImport<T>(load: () => Promise<T>, wait = RETRY_MS, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): () => Promise<T> {
  return () => load().catch(() => sleep(wait).then(load));
}

/** What a chunk loaded by hand threw (`chunkOrDown`). The browser's own error
 *  names the asset's full URL, and no guest should read that. */
export class ChunkDown extends Error {}

/** `retryImport` for a chunk with no boundary round it: its caller's catch tells
 *  a chunk that won't load (`ChunkDown`, `ChunkFailed`'s job) from a refusal. */
export function chunkOrDown<T>(load: () => Promise<T>, wait = RETRY_MS, sleep?: (ms: number) => Promise<void>): () => Promise<T> {
  const fetched = retryImport(load, wait, sleep);
  return () =>
    fetched().catch(() => {
      throw new ChunkDown("a chunk didn't load");
    });
}

/**
 * A `React.lazy` part that can be asked for again: a rejected lazy keeps its
 * rejection for good, so "Try again" needs a fresh one (`again()`).
 */
export function retryableLazy<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): { current: () => LazyExoticComponent<ComponentType<P>>; again: () => void } {
  let comp = lazy(retryImport(load));
  return {
    current: () => comp,
    again: () => {
      comp = lazy(retryImport(load));
    },
  };
}

interface Props {
  /** What shows instead, with a retry that re-mounts the part. */
  fallback: (retry: () => void) => ReactNode;
  children: ReactNode;
}

/** An error boundary round a lazy part: its fallback instead of a white page. */
export class ChunkBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): Partial<{ failed: boolean }> {
    return { failed: true };
  }
  retry = () => this.setState({ failed: false });
  render() {
    if (this.state.failed) return this.props.fallback(this.retry);
    return this.props.children;
  }
}

/** The full-page fallback when a whole app (the booth, the cue sheet) would not load. */
export function ChunkFailed({ what, onBack }: { what: string; onBack?: () => void }) {
  return (
    <div className="root">
      <div className="hero" role="alert">
        <div className="glyph" aria-hidden>
          📡
        </div>
        <p className="sub">{what} didn't load — the connection dropped, or the show was just updated.</p>
        <button type="button" className="choice primary" onClick={() => window.location.reload()}>
          Reload
        </button>
        {onBack !== undefined && (
          <button type="button" className="link" onClick={onBack}>
            ← Back
          </button>
        )}
      </div>
    </div>
  );
}
