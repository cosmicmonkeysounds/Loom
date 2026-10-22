//! The tent laptop's pane (wave 18b): the reinstall app's stylesheet moved
//! off the page (`:root`, `html, body, #root`, `body`) onto the shadow host
//! and the pane's root, as written and as `vite build` minifies it; and the
//! station's own rules keep to the old-browser rules (Chrome 87 / Safari 14).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PANE_CSS, scopeReinstallCss } from "../src/reinstall/scope-css.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const reinstallCss = read("../../reinstall/web/src/styles.css");
const stationCss = read("../src/reinstall/reinstall.css");

describe("the reinstall stylesheet, scoped for the pane", () => {
  it("moves the page rules onto the host and the pane's root (as written)", () => {
    const out = scopeReinstallCss(reinstallCss);
    expect(out).not.toMatch(/:root\b/u);
    expect(out).not.toMatch(/(^|[}\n])\s*html\s*,\s*body/u);
    expect(out).not.toMatch(/(^|[}\n])\s*body\s*\{/u);
    expect(out).toContain(":host {\n  --teal: #008080;");
    expect(out).toContain(".ri-root { height: 100%; margin: 0; }");
    expect(out).toMatch(/\.ri-root \{\n {2}background: var\(--teal\);/u);
    // Classes that merely end in "body" are left alone.
    expect(out).toContain(".w98-body {");
    expect(out).toContain(".celebrate-body {");
    expect(out.endsWith(PANE_CSS)).toBe(true);
  });

  it("does the same to the minified form a build inlines", () => {
    const min = ":root{--teal:#008080;--ink:#000}*{box-sizing:border-box}html,body,#root{height:100%;margin:0}body{background:var(--teal)}.w98-body{flex:1}.bd-body{left:0}";
    expect(scopeReinstallCss(min)).toBe(":host{--teal:#008080;--ink:#000}*{box-sizing:border-box}.ri-root {height:100%;margin:0}.ri-root {background:var(--teal)}.w98-body{flex:1}.bd-body{left:0}" + PANE_CSS);
  });

  it("the pane fills the window under the screen layer, without the inset shorthand", () => {
    expect(PANE_CSS).toMatch(/:host \{ position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 15;/u);
    expect(PANE_CSS).not.toMatch(/\binset\s*:/u);
  });
});

describe("the station's own rules (old browsers)", () => {
  it("use nothing Chrome 87 / Safari 14 lack", () => {
    expect(stationCss).not.toMatch(/:has\(/u);
    expect(stationCss).not.toMatch(/color-mix\(/u);
    expect(stationCss).not.toMatch(/\binset\s*:/u);
    expect(stationCss).not.toMatch(/(^|[;{\s])gap\s*:/u);
    expect(stationCss).not.toMatch(/aspect-ratio/u);
  });

  it("animate transform / opacity only, and hold still for reduced motion", () => {
    for (const m of stationCss.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n\}/gu)) {
      expect(m[1]).not.toMatch(/\b(top|left|width|height|box-shadow|background)\s*:/u);
    }
    expect(stationCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/u);
  });
});
