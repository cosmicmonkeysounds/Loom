//! Where the cutscenes hang in the screen layer (wave 17), in the base
//! bundle: the lazy cutscene chunk behind an error boundary. Until it has
//! loaded — or after it failed (tried again `RETRY_MS` later, in place) —
//! a slide shows its plain card, exactly as before the cutscenes.

import { Component, Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CutsceneLayerProps } from "./CutsceneLayer.tsx";
import { loadCutscenes } from "./load.ts";

/** After the chunk failed to load (or draw), try again this much later (ms). */
export const RETRY_MS = 30_000;

class Boundary extends Component<{ fallback: ReactNode; onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(): void {
    this.props.onError();
  }
  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function CutsceneSlot(props: CutsceneLayerProps) {
  const [attempt, setAttempt] = useState(0);
  const [broken, setBroken] = useState(false);
  // A fresh `lazy` per attempt: React caches each one's settled payload.
  const Layer = useMemo(() => lazy(loadCutscenes), [attempt]);
  useEffect(() => {
    if (!broken) return;
    const t = window.setTimeout(() => {
      setBroken(false);
      setAttempt((a) => a + 1);
    }, RETRY_MS);
    return () => window.clearTimeout(t);
  }, [broken]);
  const fallback = props.layers.overlay === null ? props.card : null;
  return (
    <Boundary key={attempt} fallback={fallback} onError={() => setBroken(true)}>
      <Suspense fallback={fallback}>
        <Layer {...props} />
      </Suspense>
    </Boundary>
  );
}
