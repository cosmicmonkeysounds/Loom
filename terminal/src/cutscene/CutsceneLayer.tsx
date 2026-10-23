//! The cutscene layer (wave 17, a lazy chunk): draws the scene `pick.ts`
//! chooses in the slot a slide card has always had (z 30, under the
//! overlays and the ⚙). The slide's scene — or its card — underneath, a
//! moment's scene over it. Each scene is keyed on its seq (a repeat starts
//! over) and drawn at `t` = the server's clock − its start, at ≤ 30 fps
//! while something plays, nothing while the page is hidden. A scene that
//! throws is dropped (the card shows); the layer never takes a screen down.
//! On the TV a scene's `face` mood flashes the face (`face-bus.ts`).

import { Component, memo, useEffect, useReducer, useRef, type ReactNode } from "react";
import "./kit/kit.css";
import "./cutscene.css";
import type { ScreenState } from "../screen.ts";
import type { ScreenLayers } from "../slides.ts";
import { sfx } from "../sound/bus.ts";
import { SCENE_FPS, serverNow, useReducedMotion, useSceneClock } from "./clock.ts";
import { flashFace } from "./face-bus.ts";
import { setMomentUp, setSceneClockUp } from "./moment-bus.ts";
import { MomentQueue, componentFor, drawsCountdown, faceFlashFor, pickScene, type ActiveScene } from "./pick.ts";
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
/** Room scenes (wave 20) that ended themselves, by key. */
const roomEnded = new Set<string>();
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
      roomEnded.clear();
      flashedFor(target).clear();
    }
    epoch.current = state.announceEpoch;
    queue.update(state, serverNow(state), scenes, target);
  }
  const now = serverNow(state, Date.now());
  const pick = pickScene({ state, now, layers, bare, target, scenes, queue, slideDone: (seq) => ended.has(seq), historyStarts: history, roomDone: (key) => roomEnded.has(key) });
  const room = pick.room ?? null;
  const playing = typeof pick.base === "object" || pick.top !== null || room !== null || queue.pending > 0;
  useSceneClock(playing, SCENE_FPS);

  // The TV face wears a starting scene's mood — once per scene, never again
  // when a held slide's scene leads again after a moment over it.
  const lead = room ?? pick.top ?? (typeof pick.base === "object" ? pick.base : null);
  useEffect(() => {
    const f = faceFlashFor(lead, target, flashedFor(target), state?.night);
    if (f !== null) flashFace(f.mood, f.ms);
  }, [lead, target]);
  // The idle show pauses under a moment's scene (`moment-bus.ts`).
  const momentOn = pick.top !== null;
  useEffect(() => setMomentUp(momentOn), [momentOn]);
  useEffect(() => () => setMomentUp(false), []);
  // The corner countdown stands aside for a scene that draws its own.
  const clockOn = drawsCountdown(pick, target);
  useEffect(() => setSceneClockUp(clockOn), [clockOn]);
  useEffect(() => () => setSceneClockUp(false), []);

  // A slide scene hidden under a moment is drawn frozen at the frame it was
  // covered (OB-6): one scene tree reconciled a frame, not two, and its
  // canvases stop. Uncovered, it reads the live clock again (its `t` jumps
  // to where it should be).
  const below = pick.base ?? pick.under;
  const hidden = pick.base === null && pick.under !== null;
  const baseNow = useRef(now);
  baseNow.current = baseClock(baseNow.current, now, hidden);

  if (state === null) return null;
  const host = (s: ActiveScene, hidden = false) => (
    <SceneHost
      key={s.key}
      scene={s}
      now={hidden ? baseNow.current : now}
      state={state}
      target={target}
      reduced={reduced}
      silent={hidden}
      onDone={() => {
        if (s.kind === "slide") ended.add(s.seq);
        else if (s.kind === "room") roomEnded.add(s.key);
        else queue.done(s.seq);
        bump();
      }}
    />
  );
  // The slide's card or scene sits in one standing wrapper, hidden (never
  // unmounted) under a moment that replaces it.
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
      {/* A room terminal's room scene (wave 20): the whole screen when it
          covers, else over the face only, taking no taps (never over the
          heart's docked choices). */}
      {room !== null && (
        <div className={room.def.covers === true ? "cutscene-top cutscene-room" : "cutscene-room-side"} data-room-scene={room.def.id} onClick={stopTap}>
          {host(room)}
        </div>
      )}
    </>
  );
}

const stopTap = (e: { stopPropagation(): void }) => e.stopPropagation();
/** A hidden scene plays no sound (it reports "dropped", as a locked bus does). */
const quiet: SceneProps["sfx"] = () => false;

/** The clock a slide scene is drawn at: live, or frozen where it was while hidden under a moment. */
export function baseClock(frozen: number, now: number, hidden: boolean): number {
  return hidden ? frozen : now;
}

export interface SceneHostProps {
  scene: ActiveScene;
  now: number;
  state: ScreenState;
  target: SceneTarget;
  reduced: boolean;
  silent: boolean;
  onDone: () => void;
}

/** One scene on its stage, at its `t`. Memoised: a render with the same
 *  scene, clock and state (a hidden base, frozen) does no work; `onDone`
 *  is the same act for the same scene, so it is not compared. */
export function sameSceneFrame(a: Omit<SceneHostProps, "onDone">, b: Omit<SceneHostProps, "onDone">): boolean {
  return a.scene.key === b.scene.key && a.scene.start === b.scene.start && a.now === b.now && a.state === b.state && a.target === b.target && a.reduced === b.reduced && a.silent === b.silent;
}
const SceneHost = memo(SceneHostView, sameSceneFrame);

function SceneHostView({ scene, now, state, target, reduced, silent, onDone }: SceneHostProps) {
  return <SceneStage def={scene.def} kind={scene.kind} target={target} t={Math.max(0, now - scene.start)} at={scene.at} seq={scene.seq} value={scene.value} who={scene.who} state={state} reduced={reduced} play={silent ? quiet : sfx} onDone={onDone} />;
}

/**
 * A scene drawn at a given `t` on its stage, behind its own error boundary —
 * what the layer draws, and what the preview draws at any `t` it likes.
 */
export function SceneStage({ def, kind, target, t, at, seq, value, who, state, reduced, play, onDone }: { def: SceneDef; kind: "slide" | "moment" | "room"; target: SceneTarget; t: number; at: number; seq: number; value: string; who: string | null; state: ScreenState; reduced: boolean; play: SceneProps["sfx"]; onDone: () => void }) {
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
