//! The screen layer (OCT31 K-17 + N-03): what the story puts on top of a
//! terminal or the TV — overlays, PNG slides (a Win98 text card when the PNG
//! is missing, never a broken image), the corner countdown, the Y2K clock
//! and the flicker. The precedence lives in `slides.ts`; this only draws it.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ScreenState } from "./screen.ts";
import { FLICKER_MS, formatCountdown, screenLayers, slideCopy, slideSources, y2kClock, type OverlayKind, type ScreenLayers } from "./slides.ts";

/** PNGs that failed to load this page-load: go straight to the next source. */
const missing = new Set<string>();

/** One slide: the first of its PNGs that loads, else its text card. */
export function SlideView({ slide, y2k }: { slide: { value: string; cue: string }; y2k: number | null }) {
  const sources = slideSources(slide, import.meta.env.BASE_URL);
  const firstOk = () => sources.find((s) => !missing.has(s)) ?? null;
  const [src, setSrc] = useState<string | null>(firstOk);
  useEffect(() => setSrc(firstOk()), [slide.cue, slide.value]);
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

  if (src !== null) {
    return (
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
  }
  if (copy.dark === true) return <div className="screen-slide dark" data-slide={slide.cue} data-card="" />;
  return (
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
export function ScreenLayer({ layers, gear }: { layers: ScreenLayers; gear: ReactNode }) {
  const covered = layers.overlay !== null || layers.slide !== null;
  return (
    <>
      {layers.overlay === null && layers.slide !== null && <SlideView slide={layers.slide} y2k={layers.y2k} />}
      {layers.overlay !== null && <OverlayView kind={layers.overlay} />}
      {layers.corner !== null && <CornerCountdown seconds={layers.corner} />}
      <Flicker seq={layers.flicker} />
      {covered && <div className="screen-gear">{gear}</div>}
    </>
  );
}

/** The layer, live: re-decided every second (holds, the corner, the clock). */
export function LiveScreenLayer({ state, piloting, gear }: { state: ScreenState | null; piloting: boolean; gear: ReactNode }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  // A fresh answer re-decides at once rather than up to a second later.
  const at = Math.max(now, state?.receivedAt ?? 0);
  return <ScreenLayer layers={screenLayers(state, at, { piloting })} gear={gear} />;
}
