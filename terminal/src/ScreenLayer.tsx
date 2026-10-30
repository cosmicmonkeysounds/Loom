//! The screen layer (OCT31 K-17 + N-03): what the story puts on top of a
//! terminal or the TV — overlays, PNG slides (a Win98 text card when the PNG
//! is missing, never a broken image), the corner countdown, the Y2K clock
//! and the flicker. On the TV only, a slide plays its `.mp4` first when one
//! is there (N-04a), over its PNG / card (shown at once; the clip covers it
//! only once it has a frame) and gone on an error or at its end. The precedence lives in `slides.ts`; this only draws it.
//! Wave 17: where the screen draws cutscenes, the slide's slot is the
//! cutscene layer's (`cutscene/slot.tsx`) — a scene for the slide, else the
//! card, and the moments' scenes over it. Wave 26 (T2): the glitch takeover
//! (`GlitchTakeover`, CSS only, in this bundle) over every view.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IDENTIFY_MS, identifyOn, type ScreenState } from "./screen.ts";
import type { ScreenChart } from "./screen.ts";
import { ringChime } from "./announce.ts";
import { BUILD } from "./health.ts";
import { BurstFlash } from "./burst-flash.tsx";
import { CutsceneSlot } from "./cutscene/slot.tsx";
import { useReducedMotion } from "./cutscene/clock.ts";
import { useMomentUp, useSceneClockUp } from "./cutscene/moment-bus.ts";
import { useDreamPhase, useDreamReady, useDreamSpeaking } from "./dream/DreamView.tsx";
import { moshMode } from "./dream/dream.ts";
import { Mosh } from "./dream/Mosh.tsx";
import { FlickerPlays, GLITCH_MS, GLITCH_TEXT, STAFF_TAG, chartCallouts, chartLines, formatCountdown, plainLayers, screenLayers, slideCopy, slideSources, slideVideoSources, y2kClock, endFlicker, offerFlicker, type OverlayKind, type ScreenLayers } from "./slides.ts";
import { sfx } from "./sound/bus.ts";

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
export function SlideView({ slide, y2k, chart = null, chartShown, video = false, muted = false, dream = false }: { slide: { value: string; cue: string }; y2k: number | null; chart?: ScreenChart | null; chartShown?: number; /** (wave 50) Clippy's dream is up: the clock floats on it. */ dream?: boolean } & SlideVideoOpts) {
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
      <div className="screen-slide y2k-slide" data-slide={slide.cue} data-dream={dream ? "" : undefined}>
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

/** Plays one whole stutter per new flicker seq, however late the poll
 *  brought it (`FlickerPlays`); its end never hangs on the seq (a late one
 *  that goes stale mid-stutter still finishes and goes). */
function Flicker({ seq }: { seq: number | null }) {
  const plays = useRef<FlickerPlays | null>(null);
  plays.current ??= new FlickerPlays();
  const [on, setOn] = useState<number | null>(null);
  // The deps are part of the rule (`offerFlicker`): start on the seq, end on the stutter.
  useEffect(() => offerFlicker(plays.current!, seq, setOn), [seq]);
  useEffect(() => endFlicker(on, setOn), [on]);
  return on === null ? null : <div key={on} className="screen-flicker" aria-hidden="true" />;
}

// --- the glitch takeover (wave 26, T2) ------------------------------------------------

/** The takeover's beats (ms from its cue): the tear, the cascade of error
 *  windows, the tear-out back to whatever is under it. */
export const GLITCH_BEATS = { tear: 0, cascade: 700, tearOut: 6000, end: GLITCH_MS } as const;
/** The tear's colour bands: top and height (% of the screen), tint, how far
 *  each jumps (em). Cyan, magenta, yellow and white only: never full-field red. */
const GLITCH_BANDS: ReadonlyArray<{ top: number; h: number; tint: "c" | "m" | "y" | "w"; dx: number }> = [
  { top: 6, h: 5, tint: "c", dx: 3 },
  { top: 19, h: 9, tint: "m", dx: -4 },
  { top: 33, h: 3, tint: "w", dx: 6 },
  { top: 44, h: 12, tint: "y", dx: -2 },
  { top: 61, h: 4, tint: "c", dx: -5 },
  { top: 72, h: 8, tint: "m", dx: 4 },
  { top: 88, h: 6, tint: "w", dx: -3 },
];
/** The error windows' cascade: where each lands (% left / top), one every `GLITCH_WIN_EVERY_MS`. */
const GLITCH_WINDOWS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 8, y: 10 },
  { x: 52, y: 14 },
  { x: 22, y: 34 },
  { x: 60, y: 42 },
  { x: 6, y: 58 },
  { x: 40, y: 64 },
  { x: 30, y: 20 },
  { x: 64, y: 70 },
];
export const GLITCH_WIN_EVERY_MS = 550;

/** The takeover's accents (seconds after its start), synth library only — skipped once past. */
export const GLITCH_SOUNDS: ReadonlyArray<{ at: number; name: "glitch" | "static" | "critical" | "error"; gain: number; pitch?: number }> = [
  { at: 0, name: "glitch", gain: 0.8 },
  { at: 0.25, name: "static", gain: 0.6 },
  { at: 0.7, name: "critical", gain: 0.7 },
  { at: 1.6, name: "error", gain: 0.5 },
  { at: 2.7, name: "error", gain: 0.5, pitch: 1.12 },
  { at: 3.9, name: "error", gain: 0.5, pitch: 1.26 },
  { at: 6.0, name: "static", gain: 0.6 },
];

/** How long a takeover first drawn `t0` ms in stays up (it unmounts itself then). */
export function glitchLeftMs(t0: number): number {
  return Math.max(0, GLITCH_MS - t0);
}

/** The glitch cues (`seq:at`) whose accents this page has scheduled. Module
 *  level, so a takeover remounted mid-way (its layer moved) stays silent:
 *  the first one's sounds are already queued on the audio clock. */
const glitchSounded = new Set<string>();
/** May this takeover schedule its sounds? True once per cue per page. */
export function claimGlitchSounds(seq: number, at: number): boolean {
  const key = `${seq}:${at}`;
  if (glitchSounded.has(key)) return false;
  glitchSounded.add(key);
  return true;
}
/** Forget the cues already sounded (tests). */
export function resetGlitchSounds(): void {
  glitchSounded.clear();
}

/**
 * The glitch takeover: every terminal, 8 s, once (`slides.ts` `glitchLayer`
 * decides when). CSS only — no canvas, no frame loop, nothing lazy that could
 * fail to load: a dark field, colour bands tearing sideways (0–0.7 s), a
 * cascade of Win98 error windows reading the hijack's zeroes (wave 32: the
 * cue's own words, `text`, when the story set them) over scanlines,
 * a rolling bar and a coarse noise (0.7–6 s, the whole layer jolting on a
 * 2.5 Hz step), then it tears out to whatever is under it (6–8 s). Nothing
 * flashes faster than 3 Hz and no field is red; reduced motion holds one
 * still frame. It covers a pilot or a game without ending it, and takes the
 * taps while it is up (the ⚙ stays over it). `t0` is how far in this page
 * first drew it (a poll's lateness): the animations start that far along.
 */
export function GlitchTakeover({ seq, at: cueAt, t, text = GLITCH_TEXT }: { seq: number; at: number; t: number; text?: string }) {
  // Drawn from where it stood when this page first saw it (one poll late at most).
  const [t0] = useState(() => Math.max(0, Math.min(GLITCH_MS, t)));
  // Gone the moment it ends, not on the layer's next 1 s re-decide: an
  // invisible layer at z 36 would swallow taps (and a reduced-motion still
  // frame would linger).
  const [over, setOver] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setOver(true), glitchLeftMs(t0));
    return () => window.clearTimeout(id);
  }, [t0]);
  useEffect(() => {
    // Once per cue per page: a remount mid-takeover never schedules them twice.
    if (!claimGlitchSounds(seq, cueAt)) return;
    for (const c of GLITCH_SOUNDS) {
      const delay = c.at - t0 / 1000;
      if (delay < -0.15) continue; // that accent is past: never late
      sfx(c.name, { over: true, gain: c.gain, pitch: c.pitch, delay: Math.max(0, delay) });
    }
  }, [seq, cueAt, t0]);
  if (over) return null;
  const at = (ms: number) => ({ animationDelay: `${ms - t0}ms` });
  return (
    <div className="screen-glitch" data-glitch={seq} aria-hidden="true" style={at(0)}>
      <div className="sg-jolt" style={at(GLITCH_BEATS.cascade)}>
        <div className="sg-noise" style={at(0)} />
        <div className="sg-scan" />
        <div className="sg-roll" style={at(GLITCH_BEATS.cascade)} />
        {GLITCH_BANDS.map((b, i) => (
          <div key={i} className={`sg-band sg-${b.tint}`} style={{ top: `${b.top}%`, height: `${b.h}%`, ["--dx" as string]: `${b.dx}em`, ...at(0) }} />
        ))}
        <div className="sg-wins" style={at(0)}>
          {GLITCH_WINDOWS.map((w, i) => (
            <div key={i} className="sg-win" style={{ left: `${w.x}%`, top: `${w.y}%`, ...at(GLITCH_BEATS.cascade + i * GLITCH_WIN_EVERY_MS) }}>
              <div className="sg-win-bar">
                <span>{text}</span>
                <span className="sg-win-x">×</span>
              </div>
              <div className="sg-win-body">
                <span className="sg-win-icon">✖</span>
                <span>{text}</span>
              </div>
              <div className="sg-win-ok">OK</div>
            </div>
          ))}
          <div className="sg-big" data-long={text.length > GLITCH_TEXT.length ? "" : undefined} style={at(GLITCH_BEATS.cascade + 300)}>
            {text}
          </div>
        </div>
      </div>
      <div className="sg-tear" style={at(GLITCH_BEATS.tearOut)} />
    </div>
  );
}

/**
 * Everything the story layers on top. `gear` is the ⚙ (2 s hold), drawn over
 * a covering slide / overlay so setup is never out of reach.
 */
export function ScreenLayer({ layers, gear, video, muted, onSlideTap, cutscene }: { layers: ScreenLayers; gear: ReactNode; onSlideTap?: () => void; cutscene?: (card: ReactNode) => ReactNode } & SlideVideoOpts) {
  const covered = layers.overlay !== null || layers.slide !== null;
  const slide = layers.overlay === null && layers.slide !== null && <SlideView slide={layers.slide} y2k={layers.y2k} chart={layers.chart} chartShown={layers.chartShown} video={video} muted={muted} dream={layers.dream === "through"} />;
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
      {/* (wave 32) A view with no cutscene layer (chess, casino) still sees an
          ad burst: the base bundle's picture of it. The cutscene layer draws
          its own (and `slot.tsx` this one while its chunk isn't up). */}
      {cutscene === undefined && layers.burst != null && <BurstFlash key={layers.burst.seq} seq={layers.burst.seq} at={layers.burst.at} t={layers.burst.t} text={layers.burst.text} />}
      {layers.glitch !== null && <GlitchTakeover key={layers.glitch.seq} seq={layers.glitch.seq} at={layers.glitch.at} t={layers.glitch.t} text={layers.glitch.text} />}
      {(covered || layers.glitch !== null) && <div className="screen-gear">{gear}</div>}
    </>
  );
}

/** The layer, live: re-decided every second (holds, the corner, the clock).
 *  `cutscenes` (wave 17): the slide's slot draws the cutscene layer (`cutscene/`). */
export function LiveScreenLayer({ state, piloting, peek = false, room = false, slides = true, onSlideTap, gear, video, cutscenes = false, announcing = false, target = "wall", dreamKey = "", plain = false }: { state: ScreenState | null; piloting: boolean; peek?: boolean; room?: boolean; slides?: boolean; onSlideTap?: () => void; gear: ReactNode; video?: boolean; cutscenes?: boolean; /** The announcement banner is up. */ announcing?: boolean; target?: "tv" | "wall"; dreamKey?: string; /** The CRT (wave 52b): no glitch, burst, flicker or dream. */ plain?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  // A fresh answer re-decides at once rather than up to a second later; so
  // does any other render (the dream's two moments are on the second, not `now`'s).
  const at = Math.max(now, state?.receivedAt ?? 0, Date.now());
  // `slides` false (the tent's kiosk, wave 26 T3): no story slide, corner or
  // Y2K clock — but its moments (beat cutscenes) and the glitch still play.
  const dreamReady = useDreamReady();
  useDreamPhase(state); // renders on the takeover's two moments, not a second late
  const drawn = screenLayers(state, at, { piloting, peek, room, slides, dreamReady });
  const layers = plain ? plainLayers(drawn) : drawn;
  const bare = piloting || peek || room;
  // Wave 50: what gets through the dream comes through it data moshed.
  const moment = useMomentUp();
  const speaking = useDreamSpeaking();
  const reduced = useReducedMotion();
  // The clock only floats on the dream now: a tap belongs to what is under it
  // (the scan box in plain view), not to a slide that isn't covering it.
  const seeThrough = layers.dream === "through" && layers.slide?.value === "y2k";
  useEffect(() => {
    document.body.toggleAttribute("data-dream-clock", seeThrough);
    return () => document.body.removeAttribute("data-dream-clock");
  }, [seeThrough]);
  const mosh = moshMode({ phase: layers.dream, overlay: layers.overlay, slide: layers.slide?.value ?? null, glitch: layers.glitch !== null, burst: layers.burst !== null, moment, announcing, speaking, busy: bare, reduced });
  return (
    <>
      <ScreenLayer
        layers={layers}
        gear={gear}
        video={video}
        muted={state?.voice?.muted === true}
        onSlideTap={onSlideTap}
        cutscene={cutscenes ? (card) => <CutsceneSlot state={state} layers={layers} bare={bare} card={card} gear={gear} /> : undefined}
      />
      {mosh !== null && <Mosh key={mosh} mode={mosh} target={target} seedKey={dreamKey} reduced={reduced} />}
    </>
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
