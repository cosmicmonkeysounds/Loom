//! The camera. Reads QR codes off the tablet's camera continuously while
//! the terminal is waiting: the native `BarcodeDetector` where the browser
//! has one (Chrome / Edge / Android), else frames are drawn to a canvas
//! and decoded by `jsQR`. A code is reported once, then ignored for a few
//! seconds so a pass held up to the lens doesn't re-fire.
//!
//! `getUserMedia` needs a secure context: `https://` or `localhost`. On a
//! plain `http://192.168…` LAN address every browser refuses the camera —
//! the terminal then shows the typed fallback (see `app.tsx`) and says why.

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/** Time before the same code may be reported again. */
const REPEAT_MS = 4000;
/** How often to look for a code (ms). */
const SCAN_EVERY_MS = 120;

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

export type CameraState = "starting" | "live" | "insecure" | "denied" | "none" | "error";

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
  const [state, setState] = useState<CameraState>("starting");
  const handler = useRef(onCode);
  handler.current = onCode;
  const stateHandler = useRef(onState);
  stateHandler.current = onState;
  useEffect(() => {
    stateHandler.current?.(state);
  }, [state]);

  useEffect(() => {
    if (!active) return;
    const v = video.current;
    if (v === null) return;
    if (!window.isSecureContext || typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setState(window.isSecureContext ? "none" : "insecure");
      return;
    }
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;
    const seen = new Map<string, number>();
    const canvas = document.createElement("canvas");
    const report = (text: string) => {
      const now = Date.now();
      const last = seen.get(text) ?? 0;
      if (now - last < REPEAT_MS) return;
      seen.set(text, now);
      handler.current(text);
    };
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) {
        const name = (e as DOMException).name;
        setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "none" : "error");
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      v.srcObject = stream;
      try {
        await v.play();
      } catch {
        /* autoplay of a muted video is allowed; ignore */
      }
      setState("live");
      const native = await nativeDetector();
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const scan = async () => {
        if (stopped) return;
        if (v.readyState >= 2 && v.videoWidth > 0) {
          try {
            if (native !== null) {
              const codes = await native.detect(v);
              for (const c of codes) if (c.rawValue) report(c.rawValue);
            } else if (ctx !== null) {
              // Decode at a reduced size — plenty for a phone-screen QR
              // and cheap enough for a tablet at ~8 fps.
              const scale = Math.min(1, 640 / v.videoWidth);
              canvas.width = Math.round(v.videoWidth * scale);
              canvas.height = Math.round(v.videoHeight * scale);
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
              if (hit !== null && hit.data) report(hit.data);
            }
          } catch {
            /* a frame failed to decode — try the next */
          }
        }
        timer = window.setTimeout(() => void scan(), SCAN_EVERY_MS);
      };
      void scan();
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      v.srcObject = null;
    };
  }, [facing, active]);

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
