//! The cutscene layer (wave 17, a lazy chunk): draws the scene `pick.ts`
//! chooses in the slot a slide card has always had (z 30, under the
//! overlays and the ⚙). The slide's scene — or its card — underneath, a
//! moment's scene over it. Each scene is keyed on its seq (a repeat starts
//! over) and drawn at `t` = the server's clock − its start, at ≤ 30 fps
//! while something plays, nothing while the page is hidden. A scene that
//! throws is dropped (the card shows); the layer never takes a screen down.
//! On the TV a scene's `face` mood flashes the face (`face-bus.ts`).

import { Component, useEffect, useReducer, useRef, type ReactNode } from "react";
import "./kit/kit.css";
import "./cutscene.css";
import type { ScreenState } from "../screen.ts";
import type { ScreenLayers } from "../slides.ts";
import { sfx } from "../sound/bus.ts";
import { SCENE_FPS, serverNow, useReducedMotion, useSceneClock } from "./clock.ts";
import { flashFace } from "./face-bus.ts";
import { MomentQueue, componentFor, faceFlashFor, pickScene, type ActiveScene } from "./pick.ts";
import { SCENES } from "./registry.ts";
import type { SceneDef, SceneProps, SceneTarget } from "./types.ts";

export interface CutsceneLayerProps {
  state: ScreenState | null;
  layers: Pick<ScreenLayers, "overlay" | "slide">;
  /** No slides here right now (a pilot, a peek, a room terminal): no scenes either. */
  bare: boolean;
  /** The slide's plain card (`SlideView`), for a slide no scene draws. */
  card: ReactNode;
  /** The ⚙, drawn over a moment's scene when no slide brought its own. */
  gear: ReactNode;
  /** The scenes to choose from (the preview hands in its own). */
  scenes?: readonly SceneDef[];
  /** Force the target (the preview); else the screen state's (`tv` for the TV and mirrors). */
  target?: SceneTarget;
}

/** The queue and the scenes that ended themselves, per target — kept across a remount (the app moves the layer between screens). */
const queues = new Map<SceneTarget, MomentQueue>();
const endedSlides = new Map<SceneTarget, Set<number>>();
/** When each history slide (`at` 0) was first drawn, server ms, per target (`pickScene`'s `historyStarts`). */
const historyStarts = new Map<SceneTarget, Map<number, number>>();
function queueFor(t: SceneTarget): MomentQueue {
  let q = queues.get(t);
  if (q === undefined) queues.set(t, (q = new MomentQueue()));
  return q;
}
/** The scenes whose `face` mood has flashed, per target (once per scene, cleared on a restart). */
const flashed = new Map<SceneTarget, Set<string>>();
function flashedFor(t: SceneTarget): Set<string> {
  let s = flashed.get(t);
  if (s === undefined) flashed.set(t, (s = new Set()));
  return s;
}
function historyFor(t: SceneTarget): Map<number, number> {
  let s = historyStarts.get(t);
  if (s === undefined) historyStarts.set(t, (s = new Map()));
  return s;
}
function endedFor(t: SceneTarget): Set<number> {
  let s = endedSlides.get(t);
  if (s === undefined) endedSlides.set(t, (s = new Set()));
  return s;
}

export function CutsceneLayer({ state, layers, bare, card, gear, scenes = SCENES, target: forced }: CutsceneLayerProps) {
  const target: SceneTarget = forced ?? (state?.target === "tv" ? "tv" : "wall");
  const reduced = useReducedMotion();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const queue = queueFor(target);
  const ended = endedFor(target);
  const history = historyFor(target);
  // Each new answer feeds the queue once, before this render picks.
  const fed = useRef<ScreenState | null>(null);
  const epoch = useRef<string | null | undefined>(undefined);
  if (state !== null && fed.current !== state) {
    fed.current = state;
    if (epoch.current !== undefined && epoch.current !== state.announceEpoch) {
      // A restart: its seqs start over.
      ended.clear();
      history.clear();
      flashedFor(target).clear();
    }
    epoch.current = state.announceEpoch;
    queue.update(state, serverNow(state), scenes, target);
  }
  const now = serverNow(state, Date.now());
  const pick = pickScene({ state, now, layers, bare, target, scenes, queue, slideDone: (seq) => ended.has(seq), historyStarts: history });
  const playing = typeof pick.base === "object" || pick.top !== null || queue.pending > 0;
  useSceneClock(playing, SCENE_FPS);

  // The TV face wears a starting scene's mood — once per scene, never again
  // when a held slide's scene leads again after a moment over it.
  const lead = pick.top ?? (typeof pick.base === "object" ? pick.base : null);
  useEffect(() => {
    const f = faceFlashFor(lead, target, flashedFor(target));
    if (f !== null) flashFace(f.mood, f.ms);
  }, [lead, target]);

  if (state === null) return null;
  const host = (s: ActiveScene, hidden = false) => (
    <SceneHost
      key={s.key}
      scene={s}
      now={now}
      state={state}
      target={target}
      reduced={reduced}
      silent={hidden}
      onDone={() => {
        if (s.kind === "slide") ended.add(s.seq);
        else queue.done(s.seq);
        bump();
      }}
    />
  );
  // The slide's card or scene sits in one standing wrapper, hidden (never
  // unmounted) under a moment that replaces it.
  const below = pick.base ?? pick.under;
  const hidden = pick.base === null && pick.under !== null;
  return (
    <>
      {below !== null && (
        <div className="cutscene-base" data-hidden={hidden ? "" : undefined} aria-hidden={hidden ? true : undefined}>
          {below === "card" ? card : host(below, hidden)}
        </div>
      )}
      {pick.top !== null && (
        // A tap on a moment never peeks the slide under it (B21 is for held slides).
        <div className="cutscene-top" onClick={stopTap}>
          {host(pick.top)}
          {layers.slide === null && <div className="screen-gear">{gear}</div>}
        </div>
      )}
    </>
  );
}

const stopTap = (e: { stopPropagation(): void }) => e.stopPropagation();
/** A hidden scene plays no sound (it reports "dropped", as a locked bus does). */
const quiet: SceneProps["sfx"] = () => false;

/** One scene on its stage, at its `t`. */
function SceneHost({ scene, now, state, target, reduced, silent, onDone }: { scene: ActiveScene; now: number; state: ScreenState; target: SceneTarget; reduced: boolean; silent: boolean; onDone: () => void }) {
  return <SceneStage def={scene.def} kind={scene.kind} target={target} t={Math.max(0, now - scene.start)} at={scene.at} seq={scene.seq} value={scene.value} who={scene.who} state={state} reduced={reduced} play={silent ? quiet : sfx} onDone={onDone} />;
}

/**
 * A scene drawn at a given `t` on its stage, behind its own error boundary —
 * what the layer draws, and what the preview draws at any `t` it likes.
 */
export function SceneStage({ def, kind, target, t, at, seq, value, who, state, reduced, play, onDone }: { def: SceneDef; kind: "slide" | "moment"; target: SceneTarget; t: number; at: number; seq: number; value: string; who: string | null; state: ScreenState; reduced: boolean; play: SceneProps["sfx"]; onDone: () => void }) {
  const View = componentFor(def, target);
  if (View === null) return null;
  return (
    <div className={`cutscene-stage cutscene-${kind}`} data-scene={def.id} data-seq={seq}>
      <SceneBoundary id={def.id} onError={onDone}>
        <View t={t} at={at} seq={seq} value={value} state={state} night={state.night} who={who} target={target} sfx={play} done={onDone} reduced={reduced} />
      </SceneBoundary>
    </div>
  );
}

/** A scene that throws ends (its slide shows the card); the rest of the screen carries on. */
class SceneBoundary extends Component<{ id: string; onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(e: unknown): void {
    console.warn(`cutscene ${this.props.id} failed`, e);
    this.props.onError();
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
