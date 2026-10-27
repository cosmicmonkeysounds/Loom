//! Where the cutscenes hang in the screen layer (wave 17), in the base
//! bundle: the lazy cutscene chunk behind an error boundary. Until it has
//! loaded — or after it failed (tried again `RETRY_MS` later, in place) —
//! a slide shows its plain card, exactly as before the cutscenes, and (wave
//! 32) an ad burst the base bundle's `BurstFlash` over it.

import { Component, Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import { BurstFlash } from "../burst-flash.tsx";
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
  const card = props.layers.overlay === null ? props.card : null;
  const burst = props.layers.burst ?? null;
  const fallback = burst === null ? card : (
    <>
      {card}
      <BurstFlash key={burst.seq} seq={burst.seq} at={burst.at} t={burst.t} text={burst.text} />
    </>
  );
  return (
    <Boundary key={attempt} fallback={fallback} onError={() => setBroken(true)}>
      <Suspense fallback={fallback}>
        <Layer {...props} />
      </Suspense>
    </Boundary>
  );
}
