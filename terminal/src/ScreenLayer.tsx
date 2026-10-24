//! The screen layer (OCT31 K-17 + N-03): what the story puts on top of a
//! terminal or the TV — overlays, PNG slides (a Win98 text card when the PNG
//! is missing, never a broken image), the corner countdown, the Y2K clock
//! and the flicker. On the TV only, a slide plays its `.mp4` first when one
//! is there (N-04a), over its PNG / card (shown at once; the clip covers it
//! only once it has a frame) and gone on an error or at its end. The precedence lives in `slides.ts`; this only draws it.
//! Wave 17: where the screen draws cutscenes, the slide's slot is the
//! cutscene layer's (`cutscene/slot.tsx`) — a scene for the slide, else the
//! card, and the moments' scenes over it.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IDENTIFY_MS, identifyOn, type ScreenState } from "./screen.ts";
import type { ScreenChart } from "./screen.ts";
import { ringChime } from "./announce.ts";
import { BUILD } from "./health.ts";
import { CutsceneSlot } from "./cutscene/slot.tsx";
import { useSceneClockUp } from "./cutscene/moment-bus.ts";
import { FLICKER_MS, STAFF_TAG, chartCallouts, chartLines, formatCountdown, screenLayers, slideCopy, slideSources, slideVideoSources, y2kClock, type OverlayKind, type ScreenLayers } from "./slides.ts";

/** PNGs that failed to load this page-load: go straight to the next source. */
const missing = new Set<string>();
/** Clips that failed to load this page-load (most slides have none): asked once. */
const missingVideo = new Set<string>();

/** Where a slide's video is (`video`: the TV, N-04a) and whether it plays muted. */
export interface SlideVideoOpts {
  video?: boolean;
  muted?: boolean;
}

/** One slide: on the TV its first clip that plays, then the first of its
 *  PNGs that loads, else its text card. */
export function SlideView({ slide, y2k, chart = null, chartShown, video = false, muted = false }: { slide: { value: string; cue: string }; y2k: number | null; chart?: ScreenChart | null; chartShown?: number } & SlideVideoOpts) {
  const sources = slideSources(slide, import.meta.env.BASE_URL);
  const firstOk = () => sources.find((s) => !missing.has(s)) ?? null;
  const [src, setSrc] = useState<string | null>(firstOk);
  useEffect(() => setSrc(firstOk()), [slide.cue, slide.value]);
  const clips = video ? slideVideoSources(slide, import.meta.env.BASE_URL) : [];
  const firstClip = () => clips.find((s) => !missingVideo.has(s)) ?? null;
  // Null once the clip has ended: the slide falls through to its PNG / card.
  const [clip, setClip] = useState<string | null>(firstClip);
  useEffect(() => setClip(firstClip()), [slide.cue, slide.value, video]);
  const copy = slideCopy(slide.value);

  if (slide.value === "y2k") {
    // The clock is live, so it is always drawn — a PNG would freeze it.
    const c = y2kClock(y2k);
    return (
      <div className="screen-slide y2k-slide" data-slide={slide.cue}>
        <div className="y2k-tray">
          <span className="y2k-time">{c.time}</span>
          <span className="y2k-date">{c.date}</span>
        </div>
      </div>
    );
  }

  if (chart !== null && chart.rows.length > 0) {
    // A live chart (the Trust Chart): drawn from the server's rows, never a
    // PNG, so an assessment mid-chart moves a name at the next poll. Rows
    // reveal bottom-up (hidden ones keep their place); the call-outs follow
    // the names the story picks, never a row's position.
    const lines = chartLines(chart);
    const shown = chartShown ?? lines.length;
    const done = shown >= lines.length;
    const words = chartCallouts(chart.slide);
    return (
      <div className="screen-slide" data-slide={slide.cue} data-chart="">
        <div className="slide-window chart-window" role="table" aria-label={copy.title}>
          <div className="ad-titlebar">
            <span>{copy.title}</span>
            <span className="ad-x">×</span>
          </div>
          <div className="slide-body">
            <h2>{copy.title}</h2>
            {done && (chart.top !== null || chart.bottom !== null) && (
              <div className="chart-callouts">
                {chart.top !== null && (
                  <div className="chart-callout chart-callout-top">
                    {words.top}: {chart.top}
                  </div>
                )}
                {chart.bottom !== null && (
                  <div className="chart-callout chart-callout-bottom">
                    {words.bottom}: {chart.bottom}
                  </div>
                )}
              </div>
            )}
            <ol className="chart-rows">
              {lines.map((r, i) => (
                <li
                  key={r.name}
                  className={`chart-row${i < lines.length - shown ? " chart-hidden" : ""}${r.name === chart.top ? " chart-top" : ""}${r.name === chart.bottom ? " chart-bottom" : ""}${r.staff ? " chart-staff" : ""}`}
                  role="row"
                >
                  <span className="chart-rank">{r.rank}.</span>
                  <span className="chart-name">{r.name}</span>
                  {r.staff && <span className="chart-staff-tag">{STAFF_TAG}</span>}
                  <span className="chart-value">{r.value}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    );
  }

  // The still underneath: the first PNG that loads, else the text card.
  let still: ReactNode;
  if (src !== null) {
    still = (
      <div className="screen-slide" data-slide={slide.cue}>
        <img
          key={src}
          className="slide-image"
          src={src}
          alt={copy.title || slide.value}
          onError={() => {
            missing.add(src);
            setSrc(firstOk());
          }}
        />
      </div>
    );
  } else if (copy.dark === true) {
    still = <div className="screen-slide dark" data-slide={slide.cue} data-card="" />;
  } else {
    still = (
      <div className="screen-slide" data-slide={slide.cue} data-card="">
        <div className="slide-window" role="img" aria-label={copy.title}>
          <div className="ad-titlebar">
            <span>{copy.title}</span>
            <span className="ad-x">×</span>
          </div>
          <div className="slide-body">
            <h2>{copy.title}</h2>
            {copy.lines?.map((l) => <p key={l}>{l}</p>)}
          </div>
        </div>
      </div>
    );
  }
  if (clip === null) return still;
  // A clip is tried on top of the still, hidden until it has a frame: with
  // no mp4 (the usual case) the PNG / card shows at once, never black.
  return (
    <>
      {still}
      <SlideClip
        key={clip}
        src={clip}
        cue={slide.cue}
        muted={muted}
        onFail={() => {
          missingVideo.add(clip);
          setClip(firstClip());
        }}
        onEnded={() => setClip(null)}
      />
    </>
  );
}

/**
 * A slide's clip (N-04a), played once from the start. The TV's Chrome runs
 * with `--autoplay-policy=no-user-gesture-required`; should a browser still
 * refuse sound, it plays muted rather than not at all. `muted` is the
 * director's TV mute (set on the element: React's `muted` prop isn't kept).
 */
function SlideClip({ src, cue, muted, onFail, onEnded }: { src: string; cue: string; muted: boolean; onFail: () => void; onEnded: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  // Shown only once it has a frame (`loadeddata`): until then the still shows.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (v === null) return;
    v.muted = muted;
    v.play()?.catch((e: unknown) => {
      if ((e as { name?: string } | null)?.name !== "NotAllowedError") return; // a load failure lands on onError
      v.muted = true;
      v.play()?.catch(() => {});
    });
    // `muted` follows below; this runs once per clip.
  }, [src]);
  useEffect(() => {
    if (ref.current !== null) ref.current.muted = muted;
  }, [muted]);
  return (
    <div className={`screen-slide${ready ? "" : " clip-waiting"}`} data-slide={cue} data-video="">
      <video ref={ref} className="slide-video" src={src} playsInline preload="auto" onLoadedData={() => setReady(true)} onError={onFail} onEnded={onEnded} />
    </div>
  );
}

const OVERLAY_TEXT: Record<Exclude<OverlayKind, "blackout">, string> = {
  go_to_living_room: "GO TO THE LIVING ROOM",
  alarm: "INTRUSION — SERVER ROOM",
};

/** A full-screen overlay. The flashing ones blink at 1 Hz on a black field. */
export function OverlayView({ kind }: { kind: OverlayKind }) {
  if (kind === "blackout") return <div className="screen-overlay blackout" data-overlay={kind} />;
  return (
    <div className="screen-overlay" data-overlay={kind}>
      <div className={`overlay-text ${kind}`}>
        {kind === "alarm" && <span className="overlay-icon">⚠</span>}
        {OVERLAY_TEXT[kind]}
      </div>
    </div>
  );
}

/** The corner countdown under the cutscenes: it stands aside while a scene
 *  draws the story's countdown itself — one clock, never two (livetv-3). */
function SceneCorner({ seconds }: { seconds: number }) {
  return useSceneClockUp() ? null : <CornerCountdown seconds={seconds} />;
}

/** The corner countdown: a Win98 tray box. */
export function CornerCountdown({ seconds }: { seconds: number }) {
  return (
    <div className={`screen-corner${seconds <= 60 ? " last" : ""}`} data-corner={seconds}>
      ⏱ {formatCountdown(seconds)}
    </div>
  );
}

/** Plays one stutter per new flicker seq. */
function Flicker({ seq }: { seq: number | null }) {
  const played = useRef(new Set<number>());
  const [on, setOn] = useState<number | null>(null);
  useEffect(() => {
    if (seq === null || played.current.has(seq)) return;
    played.current.add(seq);
    setOn(seq);
    const t = window.setTimeout(() => setOn(null), FLICKER_MS);
    return () => window.clearTimeout(t);
  }, [seq]);
  return on === null ? null : <div key={on} className="screen-flicker" aria-hidden="true" />;
}

/**
 * Everything the story layers on top. `gear` is the ⚙ (2 s hold), drawn over
 * a covering slide / overlay so setup is never out of reach.
 */
export function ScreenLayer({ layers, gear, video, muted, onSlideTap, cutscene }: { layers: ScreenLayers; gear: ReactNode; onSlideTap?: () => void; cutscene?: (card: ReactNode) => ReactNode } & SlideVideoOpts) {
  const covered = layers.overlay !== null || layers.slide !== null;
  const slide = layers.overlay === null && layers.slide !== null && <SlideView slide={layers.slide} y2k={layers.y2k} chart={layers.chart} chartShown={layers.chartShown} video={video} muted={muted} />;
  return (
    <>
      {/* A tap on a slide peeks under it (B21) where `onSlideTap` is given;
          the wrapper is unstyled, so the slide keeps its own fixed box. With
          the cutscenes (wave 17) the wrapper always stands, so the layer
          under it is never remounted, and the card is theirs to show. Only a
          slide peeks: with none up (a moment alone) a tap does nothing, and
          the cutscene layer keeps a tap on a moment from reaching here. */}
      {cutscene !== undefined ? (
        <div className="slide-tap" data-peekable={onSlideTap !== undefined ? "" : undefined} onClick={layers.slide !== null ? onSlideTap : undefined}>
          {cutscene(slide === false ? null : slide)}
        </div>
      ) : slide !== false && onSlideTap !== undefined ? (
        <div className="slide-tap" data-peekable="" onClick={onSlideTap}>
          {slide}
        </div>
      ) : (
        slide
      )}
      {layers.overlay !== null && <OverlayView kind={layers.overlay} />}
      {layers.corner !== null && (cutscene !== undefined ? <SceneCorner seconds={layers.corner} /> : <CornerCountdown seconds={layers.corner} />)}
      <Flicker seq={layers.flicker} />
      {covered && <div className="screen-gear">{gear}</div>}
    </>
  );
}

/** The layer, live: re-decided every second (holds, the corner, the clock).
 *  `cutscenes` (wave 17): the slide's slot draws the cutscene layer (`cutscene/`). */
export function LiveScreenLayer({ state, piloting, peek = false, room = false, onSlideTap, gear, video, cutscenes = false }: { state: ScreenState | null; piloting: boolean; peek?: boolean; room?: boolean; onSlideTap?: () => void; gear: ReactNode; video?: boolean; cutscenes?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  // A fresh answer re-decides at once rather than up to a second later.
  const at = Math.max(now, state?.receivedAt ?? 0);
  const layers = screenLayers(state, at, { piloting, peek, room });
  const bare = piloting || peek || room;
  return (
    <ScreenLayer
      layers={layers}
      gear={gear}
      video={video}
      muted={state?.voice?.muted === true}
      onSlideTap={onSlideTap}
      cutscene={cutscenes ? (card) => <CutsceneSlot state={state} layers={layers} bare={bare} card={card} gear={gear} /> : undefined}
    />
  );
}

/**
 * A director's `identify` (SW-SCR-21, install day): this screen's name and
 * spot full screen for as long as the server says (~10 s), with one chime
 * when it starts (silent while sound is locked). Above every slide and
 * overlay, below the ⚙; any touch is ignored so a guest can't dismiss it.
 * Counted down on the device (`identifyOn`): a lost server never leaves it up.
 */
export function IdentifyOverlay({ state, name, spot, view }: { state: ScreenState | null; name: string; spot: string; view: string }) {
  const [now, setNow] = useState(() => Date.now());
  const until = state?.identify === true ? state.receivedAt + (state.identifyLeft ?? IDENTIFY_MS) : 0;
  useEffect(() => {
    if (until === 0) return;
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(0, until - Date.now()) + 50);
    return () => window.clearTimeout(id);
  }, [until]);
  const on = identifyOn(state, Math.max(now, state?.receivedAt ?? 0));
  const was = useRef(false);
  useEffect(() => {
    if (on && !was.current) void ringChime();
    was.current = on;
  }, [on]);
  if (!on) return null;
  return (
    <div className="identify-overlay" role="status" data-testid="identify">
      <div className="identify-name">{name.toUpperCase()}</div>
      <div className="identify-sub">{[spot, view].filter((x) => x !== "").join(" · ")}</div>
      <div className="identify-ver">build {BUILD}</div>
    </div>
  );
}
