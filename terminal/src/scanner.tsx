//! The camera. Reads QR codes off the tablet's camera continuously while
//! the terminal is waiting: the native `BarcodeDetector` where the browser
//! has one (Chrome / Edge / Android), else frames are drawn to a canvas
//! and decoded by `jsQR`. A code is reported once, then ignored for a few
//! seconds so a pass held up to the lens doesn't re-fire.
//!
//! The stream is the page's one camera (`camera.ts`), shared with the camera
//! feed and the shadow view — the scanner never opens its own.
//!
//! `getUserMedia` needs a secure context: `https://` or `localhost`. On a
//! plain `http://192.168…` LAN address every browser refuses the camera —
//! the terminal then shows the typed fallback (see `app.tsx`) and says why.

import { useEffect, useRef } from "react";
import jsQR from "jsqr";
import { useCamera, type CameraState } from "./camera.ts";

/** Time before the same code may be reported again. */
const REPEAT_MS = 4000;
/** How often to look for a code (ms): the native detector, and jsQR just after a read. */
const SCAN_EVERY_MS = 120;
/** How often jsQR looks otherwise (ms): it runs on the main thread beside the idle show (OB-3). */
export const JSQR_EVERY_MS = 250;
/** jsQR stays fast this long after a read (a second pass held up, a re-scan). */
export const JSQR_FAST_MS = 3000;
/** jsQR decodes frames at most this wide (px): plenty for a phone-screen QR. */
export const JSQR_WIDTH = 480;

/** The next look's delay: the native detector always at its pace, jsQR fast
 *  only just after a read. `costMs` (wave 59): what the last decode took, so an
 *  old tablet's jsQR never takes more than half the page beside the feed. */
export function scanDelay(native: boolean, now: number, lastRead: number, costMs = 0): number {
  return Math.max(native || now - lastRead < JSQR_FAST_MS ? SCAN_EVERY_MS : JSQR_EVERY_MS, Math.round(costMs));
}

/** The size jsQR decodes a frame at. */
export function jsqrSize(videoWidth: number, videoHeight: number): { w: number; h: number } {
  const scale = Math.min(1, JSQR_WIDTH / videoWidth);
  return { w: Math.round(videoWidth * scale), h: Math.round(videoHeight * scale) };
}

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

async function nativeDetector(): Promise<BarcodeDetectorLike | null> {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (Ctor === undefined) return null;
  try {
    const formats = await Ctor.getSupportedFormats();
    return formats.includes("qr_code") ? new Ctor({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

export type { CameraState } from "./camera.ts";

/** Why the camera isn't running, in words a person at the wall can act on. */
export function cameraProblem(state: CameraState): string | null {
  switch (state) {
    case "insecure":
      return "The camera needs a secure address (https:// or localhost).";
    case "denied":
      return "Camera permission was refused — allow it in the browser and reload.";
    case "none":
      return "No camera on this device.";
    case "error":
      return "The camera couldn't start.";
    default:
      return null;
  }
}

export function Scanner({
  facing,
  active,
  onCode,
  onState,
}: {
  facing: "user" | "environment";
  active: boolean;
  onCode: (text: string) => void;
  /** The camera's state, for the host's own "no camera?" hint. */
  onState?: (state: CameraState) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const cam = useCamera(facing, active);
  const state: CameraState = cam.state;
  const stream = cam.stream;
  const handler = useRef(onCode);
  handler.current = onCode;
  const stateHandler = useRef(onState);
  stateHandler.current = onState;
  useEffect(() => {
    stateHandler.current?.(state);
  }, [state]);

  useEffect(() => {
    if (!active || stream === null) return;
    const v = video.current;
    if (v === null) return;
    let stopped = false;
    let timer = 0;
    const seen = new Map<string, number>();
    const canvas = document.createElement("canvas");
    let lastRead = Number.NEGATIVE_INFINITY;
    const report = (text: string) => {
      const now = Date.now();
      lastRead = now;
      const last = seen.get(text) ?? 0;
      if (now - last < REPEAT_MS) return;
      seen.set(text, now);
      handler.current(text);
    };
    void (async () => {
      v.srcObject = stream;
      try {
        await v.play();
      } catch {
        /* autoplay of a muted video is allowed; ignore */
      }
      const native = await nativeDetector();
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const scan = async () => {
        if (stopped) return;
        const started = performance.now();
        // Hidden (screen off, app switched): no decoding, just look again later.
        if (!document.hidden && v.readyState >= 2 && v.videoWidth > 0) {
          try {
            if (native !== null) {
              const codes = await native.detect(v);
              for (const c of codes) if (c.rawValue) report(c.rawValue);
            } else if (ctx !== null) {
              // Decode at a reduced size — plenty for a phone-screen QR and
              // cheap on an old tablet. The canvas is resized only when the
              // frame's size changes (a resize clears and reallocates it), and
              // a pass is dark on light (pass-qr.tsx): no inverted pass.
              const { w, h } = jsqrSize(v.videoWidth, v.videoHeight);
              if (canvas.width !== w) canvas.width = w;
              if (canvas.height !== h) canvas.height = h;
              ctx.drawImage(v, 0, 0, w, h);
              const img = ctx.getImageData(0, 0, w, h);
              const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
              if (hit !== null && hit.data) report(hit.data);
            }
          } catch {
            /* a frame failed to decode — try the next */
          }
        }
        timer = window.setTimeout(() => void scan(), scanDelay(native !== null, Date.now(), lastRead, native === null ? performance.now() - started : 0));
      };
      void scan();
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      // The stream is the hub's (the feed may still hold it): only let go of it here.
      v.srcObject = null;
    };
  }, [stream, active]);

  return (
    <div className={`scanner ${state}`}>
      <video ref={video} muted playsInline autoPlay className={facing === "user" ? "mirrored" : ""} />
      <div className="reticle" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      {state !== "live" && state !== "starting" && <div className="scanner-problem">{cameraProblem(state)}</div>}
    </div>
  );
}
