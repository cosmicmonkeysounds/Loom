//! A guest's pass QR, drawn in the browser (D8, S1-ops-06). The server's
//! `/api/qr` allows 60 a minute per IP, and on show night every phone on the
//! house Wi-Fi is one IP — a door rush spent the budget and the pass a
//! performer had to scan came up broken. Drawing it here (as the editor's
//! print sheet does) costs no request at all. The SVG matches what
//! `/api/qr` drew (`margin: 1`), as an `<img>` so the pass styles still
//! apply.

import { useMemo } from "react";
import QRCode from "qrcode";

/** The QR's SVG for `text`: one path of dark modules over a white quiet
 *  zone of `margin` modules. Synchronous — a pass never flickers in. */
export function passQrSvg(text: string, margin = 1): string {
  const { modules } = QRCode.create(text || " ", { errorCorrectionLevel: "M" });
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

/** `passQrSvg` as an `<img>` source. */
export function passQrSrc(text: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(passQrSvg(text))}`;
}

/** The pass QR for a guest id. */
export function PassQr({ text, alt }: { text: string; alt: string }) {
  const src = useMemo(() => passQrSrc(text), [text]);
  return <img alt={alt} src={src} />;
}
