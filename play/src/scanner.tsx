//! The booth camera. Reads QR codes continuously while it is on: the
//! native `BarcodeDetector` where the browser has one (Chrome / Android),
//! else each frame is drawn to a canvas and decoded by `jsQR` — which is
//! what makes an **iPhone** (Safari has no `BarcodeDetector`) scan at the
//! door. Lifted from `terminal/src/scanner.tsx`. A code is reported once,
//! then ignored for a few seconds (`repeatGate`), so the camera stays on
//! and a queue of guests scans pass after pass.
//!
//! `getUserMedia` needs a secure context (`https://` or `localhost`); on a
//! plain-http LAN address the performer is told to type the id.

import { useEffect, useRef } from "react";
import { cameraFailure, decodeSize, repeatGate, type CameraState } from "./scan.ts";
import { retryImport } from "./lazy-chunk.tsx";

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
  getSupportedFormats?: () => Promise<string[]>;
}

async function nativeDetector(): Promise<BarcodeDetectorLike | null> {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (Ctor === undefined) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
    return formats.includes("qr_code") ? new Ctor({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

export function CameraScanner({ onCode, onState }: { onCode: (text: string) => void; onState: (state: CameraState) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onCode);
  handler.current = onCode;
  const stateHandler = useRef(onState);
  stateHandler.current = onState;

  useEffect(() => {
    const v = video.current;
    if (v === null) return;
    const setState = (s: CameraState) => stateHandler.current(s);
    if (!window.isSecureContext || typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setState(window.isSecureContext ? "none" : "insecure");
      return;
    }
    setState("starting");
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;
    const fresh = repeatGate(REPEAT_MS);
    const report = (text: string) => {
      if (fresh(text)) handler.current(text);
    };
    const canvas = document.createElement("canvas");
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        if (!stopped) setState(cameraFailure((e as DOMException).name));
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
        /* a muted inline video may autoplay; ignore */
      }
      setState("live");
      const native = await nativeDetector();
      // jsQR only where there is no native detector (iPhone Safari), and only
      // once a camera is live: its own chunk, never in the first load.
      // A fetch that fails is tried once more; if it still won't come, the
      // camera says so (the typed fallback shows) instead of reading nothing.
      const decode = native === null ? await retryImport(() => import("jsqr"))().then((m) => m.default, () => null) : null;
      if (native === null && decode === null) {
        if (!stopped) setState("error");
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const scan = async () => {
        if (stopped) return;
        if (v.readyState >= 2 && v.videoWidth > 0) {
          try {
            if (native !== null) {
              const codes = await native.detect(v);
              for (const c of codes) if (c.rawValue) report(c.rawValue);
            } else if (ctx !== null && decode !== null) {
              const size = decodeSize(v.videoWidth, v.videoHeight);
              canvas.width = size.width;
              canvas.height = size.height;
              ctx.drawImage(v, 0, 0, size.width, size.height);
              const img = ctx.getImageData(0, 0, size.width, size.height);
              const hit = decode(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
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
  }, []);

  // `muted` + `playsInline` are what let iOS Safari play the preview inline.
  return <video ref={video} muted playsInline autoPlay className="cam" />;
}
