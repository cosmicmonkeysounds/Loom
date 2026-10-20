import { describe, expect, it } from "vitest";
import { scopeCss } from "../src/embed-css.ts";
import { readBundledCss, stylesImports } from "./css.ts";

// The stylesheet as the dev server serves it: the lane files, inlined.
const CSS = readBundledCss();

describe("styles.css is only the lane files, in order", () => {
  it("imports exactly the eight files", () => {
    expect(stylesImports()).toEqual([
      "./css/base.css",
      "./css/themes.css",
      "./css/w95.css",
      "./css/chrome.css",
      "./css/stream.css",
      "./css/moments.css",
      "./css/booth.css",
      "./css/host.css",
    ]);
  });
});

for (const [name, css] of [
  ["as written", CSS],
] as const) {
  describe(`embedded pane stylesheet (${name})`, () => {
    const scoped = scopeCss(css);

    it("leaves no page-level selector behind", () => {
      expect(scoped).not.toMatch(/:root\b/u);
      expect(scoped).not.toMatch(/(^|[\n}])\s*(html|body)\b[^-]/u);
      expect(scoped).not.toMatch(/#root\b/u);
    });

    it("themes the pane root, not the page", () => {
      expect(scoped).toMatch(/\.play-root\[data-theme="?aol97"?\] ?\{/u);
      expect(scoped).toMatch(/\.play-root\[data-theme="aol97"\] ?\{ ?font-size: ?13px;? ?\}/u);
    });

    it("sizes against the pane: container units + container queries", () => {
      expect(scoped).not.toMatch(/\d[dsl]?(vh|vw)\b/u);
      expect(scoped).toContain("88cqh");
      expect(scoped).toMatch(/@container play \(min-height: ?520px\)/u);
      expect(scoped).not.toMatch(/@media ?\((min|max)-(width|height)/u);
      // A preference query is about the person — kept.
      expect(scoped).toMatch(/@media \(prefers-reduced-motion: ?reduce\)/u);
    });
  });
}
