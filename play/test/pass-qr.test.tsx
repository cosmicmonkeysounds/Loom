//! S1-ops-06 (D8): the pass QR is drawn in the browser — never an
//! `/api/qr` request, which a door rush on one house IP could spend — and it
//! scans back to the guest id.

import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";

import { PassQr, passQrSrc, passQrSvg } from "../src/pass-qr.tsx";
import { PassCard } from "../src/widgets.tsx";

/** Paint the SVG's runs (`M x y h w v1 h-w z`) onto RGBA pixels, `scale`
 *  per module, so jsQR can read it the way a booth camera would. */
function rasterize(svg: string, scale = 4): { data: Uint8ClampedArray; side: number } {
  const modules = Number(/viewBox="0 0 (\d+) /.exec(svg)![1]);
  const quiet = 4; // a scanner wants a wider quiet zone than the card's 1
  const side = (modules + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (const [, x, y, w] of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let col = Number(x); col < Number(x) + Number(w); col++) {
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          const i = (((Number(y) + quiet) * scale + py) * side + (col + quiet) * scale + px) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { data, side };
}

describe("passQrSvg", () => {
  it("scans back to the guest id", () => {
    for (const id of ["g-bd8666", "g-1", "a much longer pass text, 1234567890"]) {
      const { data, side } = rasterize(passQrSvg(id));
      expect(jsQR(data, side, side)?.data).toBe(id);
    }
  });

  it("is an inline SVG image, never a server request", () => {
    const src = passQrSrc("g-bd8666");
    expect(src.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    const html = renderToStaticMarkup(createElement(PassQr, { text: "g-bd8666", alt: "QR" }));
    expect(html).toContain('alt="QR"');
    expect(html).not.toContain("/api/qr");
  });

  it("the show-pass card renders the pass in the browser", () => {
    const html = renderToStaticMarkup(
      createElement(PassCard, { card: { kind: "pass", text: "", params: {} }, seed: 1, viewer: { id: "g-bd8666", name: "Calculator" } }),
    );
    expect(html).toContain('alt="Your QR pass"');
    expect(html).toContain('src="data:image/svg+xml;utf8,');
    expect(html).not.toContain("/api/qr");
  });

  it("no pass in the play app asks the server for its QR", () => {
    const dir = new URL("../src/", import.meta.url);
    for (const f of readdirSync(dir)) {
      if (!/\.tsx?$/.test(f)) continue;
      // Code only — not the comments that say why there is no such URL.
      const code = readFileSync(new URL(f, dir), "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
      expect(code, f).not.toContain("/api/qr");
    }
  });
});
