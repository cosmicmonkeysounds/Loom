//! A guest's pass QR, drawn in the browser (D8, S1-ops-06). The server's
//! `/api/qr` allows 60 a minute per IP, and on show night every phone on the
//! house Wi-Fi is one IP — a door rush spent the budget and the pass a
//! performer had to scan came up broken. Drawing it here (as the editor's
//! print sheet does) costs no request at all. The SVG matches what
//! `/api/qr` drew (`margin: 1`), as an `<img>` so the pass styles still
//! apply.
//!
//! Wave 18: the encoder (`qrcode`, ~9 kB gzip) is its own chunk, kept out of
//! the guest's first load. The app prefetches it right after the first
//! paint (`prefetchQr`), so by the time a pass is asked for it is there;
//! until then the pass is a white square of the same size.

import { useEffect, useMemo, useState } from "react";
import type QRCodeLib from "qrcode";

type QrLib = typeof QRCodeLib;
let lib: QrLib | null = null;
let loading: Promise<QrLib> | null = null;

/** Fetch the QR encoder (once; a failed fetch is tried again next time). */
export function loadQr(): Promise<QrLib> {
  if (lib !== null) return Promise.resolve(lib);
  loading ??= import("qrcode").then(
    (m) => (lib = (m.default ?? m) as QrLib),
    (e: unknown) => {
      loading = null;
      throw e;
    },
  );
  return loading;
}

/** Start fetching the encoder now (the app calls it after its first paint). */
export function prefetchQr(): void {
  loadQr().catch(() => {});
}

/** The QR's SVG for `text` with an encoder in hand: one path of dark modules
 *  over a white quiet zone of `margin` modules. */
export function qrSvg(qr: QrLib, text: string, margin = 1): string {
  const { modules } = qr.create(text || " ", { errorCorrectionLevel: "M" });
  const n = modules.size;
  const side = n + margin * 2;
  let d = "";
  for (let row = 0; row < n; row++) {
    let col = 0;
    while (col < n) {
      if (!modules.get(row, col)) {
        col++;
        continue;
      }
      // One horizontal run per path segment keeps the SVG small.
      const start = col;
      while (col < n && modules.get(row, col)) col++;
      d += `M${start + margin} ${row + margin}h${col - start}v1h${start - col}z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="240" height="240" shape-rendering="crispEdges">` +
    `<rect width="${side}" height="${side}" fill="#ffffff"/><path fill="#000000" d="${d}"/></svg>`
  );
}

/** The pass's SVG, once the encoder has loaded (`loadQr`); a blank white
 *  square before that. */
export function passQrSvg(text: string, margin = 1): string {
  if (lib !== null) return qrSvg(lib, text, margin);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="240" height="240"><rect width="1" height="1" fill="#ffffff"/></svg>`;
}

/** `passQrSvg` as an `<img>` source. */
export function passQrSrc(text: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(passQrSvg(text))}`;
}

/** The pass QR for a guest id (redrawn once the encoder arrives). */
export function PassQr({ text, alt }: { text: string; alt: string }) {
  const [ready, setReady] = useState(lib !== null);
  useEffect(() => {
    if (ready) return;
    let live = true;
    loadQr().then(
      () => live && setReady(true),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [ready]);
  const src = useMemo(() => passQrSrc(text), [text, ready]);
  return <img alt={alt} src={src} />;
}
