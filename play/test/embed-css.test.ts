import { transformWithEsbuild } from "vite";
import { describe, expect, it } from "vitest";
import { scopeCss } from "../src/embed-css.ts";
import { readBundledCss, stylesImports } from "./css.ts";

// The stylesheet as the dev server serves it (spaced, quoted), and as
// `vite build` minifies `styles.css?inline` for the editor's Run → Players.
const CSS = readBundledCss();
const MINIFIED = (await transformWithEsbuild(CSS, "styles.css", { loader: "css", minify: true })).code;

describe("styles.css is only the lane files, in order", () => {
  it("imports exactly the lane files (wave 44: the credits roll last)", () => {
    expect(stylesImports()).toEqual([
      "./css/base.css",
      "./css/themes.css",
      "./css/w95.css",
      "./css/chrome.css",
      "./css/factions.css",
      "./css/stream.css",
      "./css/moments.css",
      "./css/booth.css",
      "./css/host.css",
      "./css/credits.css",
    ]);
  });
});

for (const [name, css] of [
  ["as written", CSS],
  ["minified", MINIFIED],
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

describe("the rewrite rules", () => {
  it("turns a bare html rule into the pane root (wave 36's zoom guards)", () => {
    expect(scopeCss("html { touch-action: manipulation; }")).toContain(".play-root { touch-action: manipulation; }");
    expect(scopeCss("a{}html{overflow-x:hidden}")).toContain("}.play-root {overflow-x:hidden}");
  });
  it("turns the dynamic viewport units into container units", () => {
    const out = scopeCss(".pass { height: 100vh; height: 100dvh; min-height: 50svh; max-height: 90lvh; width: 100dvw; }");
    expect(out).toContain(".pass { height: 100cqh; height: 100cqh; min-height: 50cqh; max-height: 90cqh; width: 100cqw; }");
  });

  it("turns range-syntax size queries into container queries (the editor's lightningcss build)", () => {
    const out = scopeCss("@media (height>=520px){.a{top:0}}@media (width<=399px){.b{top:0}}@media (400px<width){.c{top:0}}@media print{.d{top:0}}");
    expect(out).toContain("@container play (height>=520px){.a{top:0}}@container play (width<=399px){.b{top:0}}@container play (400px<width){.c{top:0}}@media print{.d{top:0}}");
  });

  it("reads the minified forms: no spaces, no quotes", () => {
    const out = scopeCss('html,body,#root{height:100%}body{margin:0}:root[data-theme=aol97] body{font-size:13px}:root{--a:1}@media (max-width:400px){.x{top:0}}');
    expect(out).toContain('.play-root {height:100%}.play-root {margin:0}.play-root[data-theme="aol97"]{font-size:13px}.play-root{--a:1}@container play (max-width:400px){.x{top:0}}');
  });
});
