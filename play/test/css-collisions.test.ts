//! Wave 13: a lane's stylesheet never restyles a `base.css` class by its
//! bare name. The lane files load after `base.css`, so a rule like
//! `.tray { display: flex }` in `chrome.css` silently rewrote the story's
//! decision box (`<div class="tray dialogue">`) everywhere — on phones and
//! in Run → Players panes. A lane names its own classes (`.taskbar-tray`)
//! or scopes the base one under its own (`.cut-foot .tray.dialogue`).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LANE_FILES = ["w95", "chrome", "stream", "moments", "booth", "host"] as const;

/** Lane rules that restyle a base class on purpose: `"<file> | <selector>"`. */
const ALLOWED = new Set<string>([]);

function read(name: string): string {
  return readFileSync(new URL(`../src/css/${name}.css`, import.meta.url), "utf8");
}

/** Every selector in a stylesheet, `@media` / `@supports` bodies included. */
function selectorsOf(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  const out: string[] = [];
  for (const m of text.matchAll(/([^{};]+)\{/gu)) {
    const prelude = m[1]!.trim();
    if (prelude.startsWith("@")) continue;
    for (const s of prelude.split(",")) if (s.trim()) out.push(s.trim());
  }
  return out;
}

/** Every class name any selector in `css` mentions. */
function classesOf(css: string): Set<string> {
  const out = new Set<string>();
  for (const s of selectorsOf(css)) for (const c of s.matchAll(/\.([A-Za-z_][\w-]*)/gu)) out.add(c[1]!);
  return out;
}

/** The lane selectors whose first compound is a bare (or element-qualified) base class. */
function collisions(base: string, lane: string): string[] {
  const taken = classesOf(base);
  return selectorsOf(lane).filter((s) => {
    const m = /^(?:[a-z][\w-]*)?\.([A-Za-z_][\w-]*)/u.exec(s);
    return m !== null && taken.has(m[1]!);
  });
}

describe("lane stylesheets never restyle a base class by its bare name", () => {
  const base = read("base");

  it("catches the shape of the wave 13 `.tray` bug", () => {
    const lane = ".tray { display: flex; }\n.tray.live { color: red; }\n@media (max-width: 399px) {\n  .tray > :nth-child(n+4) { display: none; }\n}\n.cut-foot .tray.dialogue { color: white; }\n.taskbar-tray { display: flex; }";
    expect(collisions(".tray { display: block; }\n.tray-title { margin: 0; }", lane)).toEqual([
      ".tray", ".tray.live", ".tray > :nth-child(n+4)",
    ]);
  });

  for (const file of LANE_FILES) {
    it(`${file}.css`, () => {
      const hits = collisions(base, read(file)).filter((s) => !ALLOWED.has(`${file} | ${s}`));
      expect(hits, `${file}.css restyles base classes; rename or scope them`).toEqual([]);
    });
  }
});
