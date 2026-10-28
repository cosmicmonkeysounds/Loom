//! The Reinstallation Process video (wave 33): played full screen after the
//! Play here tap and before the begin, so no session is live (no pose
//! timeout, nothing timed) while it runs. Skippable only once the program
//! has completed a reinstallation (`introSkippable`).
//!
//! It never blocks the game: a video that won't load goes straight on, and
//! one that stalls for `VIDEO_STALL_MS` offers Continue. When the browser
//! refuses sound without a gesture (the tent laptop's `auto` start, no tap),
//! it plays muted with a big "sound on" button. Held (a story overlay on the
//! tent laptop) pauses it.

import { useEffect, useRef, useState } from "react";
import { INTRO_VIDEO_URL, VIDEO_STALL_MS } from "./game/tutorial.ts";

export function IntroVideo({ skippable, held = false, src = INTRO_VIDEO_URL, onDone }: { skippable: boolean; held?: boolean; src?: string; onDone: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const [stalled, setStalled] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    video.current?.pause();
    done.current();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Start it — with sound when the browser allows, else muted.
  useEffect(() => {
    const v = video.current;
    if (v === null) return;
    const p = v.play();
    p?.catch((e: unknown) => {
      if ((e as { name?: string }).name !== "NotAllowedError") return;
      v.muted = true;
      setMuted(true);
      v.play()?.catch(() => undefined);
    });
  }, []);

  // Held under an overlay: paused, and on again after.
  useEffect(() => {
    const v = video.current;
    if (v === null || finished.current) return;
    if (held) v.pause();
    else v.play()?.catch(() => undefined);
  }, [held]);

  // A stall (no progress while it should play) offers Continue.
  useEffect(() => {
    let last = -1;
    let since = Date.now();
    const t = window.setInterval(() => {
      const v = video.current;
      if (v === null || held) {
        since = Date.now();
        return;
      }
      if (v.currentTime !== last) {
        last = v.currentTime;
        since = Date.now();
        setStalled(false);
      } else if (Date.now() - since >= VIDEO_STALL_MS) setStalled(true);
    }, 1000);
    return () => window.clearInterval(t);
  }, [held]);

  const soundOn = () => {
    const v = video.current;
    if (v === null) return;
    v.muted = false;
    setMuted(false);
    v.play()?.catch(() => undefined);
  };

  return (
    <div className="intro-video">
      <video ref={video} src={src} playsInline preload="auto" onEnded={() => finishRef.current()} onError={() => finishRef.current()} />
      <div className="intro-video-bar">
        {muted && (
          <button className="w98-button big" onClick={soundOn} autoFocus>
            🔊 Turn the sound on
          </button>
        )}
        <span className="spacer" />
        {(skippable || stalled) && (
          <button className="w98-button big" onClick={() => finishRef.current()}>
            {skippable ? "Skip video ▶" : "Continue ▶"}
          </button>
        )}
      </div>
    </div>
  );
}
