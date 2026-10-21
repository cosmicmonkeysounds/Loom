//! One way to fetch a guest part on first use (wave 18): Mission's window,
//! the Notifications bin, the Me sheet, the sides chunk. A part is fetched
//! once more after a short wait if it fails (`retryableLazy`), sits behind
//! a `ChunkBoundary` (Try again, never a white page), and `prefetch` starts
//! the fetch early (Mission's, at page load: the join screen paints first,
//! the home is there by the time the stream is).

import { Suspense, createElement, useState, type ComponentType, type ReactNode } from "react";
import { ChunkBoundary, retryImport, retryableLazy } from "../lazy-chunk.tsx";

export interface LazyPart<P extends object> {
  (props: P): ReactNode;
  prefetch: () => void;
}

export function lazyPart<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, what: string, waiting: ReactNode = null): LazyPart<P> {
  const part = retryableLazy<P>(load);
  function Part(props: P) {
    const [, setRound] = useState(0);
    const C = part.current();
    return (
      <ChunkBoundary
        fallback={(retry) => (
          <div className="lazy-failed" role="alert">
            <p className="sub">{what} didn't load — check the connection.</p>
            <button
              type="button"
              className="choice primary"
              onClick={() => {
                part.again();
                setRound((n) => n + 1);
                retry();
              }}
            >
              Try again
            </button>
          </div>
        )}
      >
        <Suspense fallback={waiting}>{createElement(C as unknown as ComponentType<P>, props)}</Suspense>
      </ChunkBoundary>
    );
  }
  Part.prefetch = () => void retryImport(load)().catch(() => {});
  return Part;
}
