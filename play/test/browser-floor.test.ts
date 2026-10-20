//! Wave 13 (CONTRACTS §0, the browser floor): play runs on guests' phones
//! (iOS Safari 15+, Android Chrome 100+) and old station tablets (Chrome 87
//! / Safari 14). Every file under `play/src` is grepped for what those
//! can't run: `:has()` outside an `@supports selector(:has(…))` guard, CSS
//! nesting, `dvh`/`svh`/`lvh` with no `vh` declared first, an authored
//! `@container` (only `embed-css.ts` writes those), `<dialog>` /
//! `showModal()`, the `inert` attribute, `Array.prototype.at`,
//! `structuredClone`, and a `color-mix()` with no plain colour declared
//! first for the same property.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, "utf8") }));
const css = files.filter((f) => f.path.endsWith(".css"));
// embed-css.ts rewrites the stylesheet for the editor's panes: it writes container queries on purpose
const code = files.filter((f) => /\.(tsx?|ts)$/u.test(f.path) && f.path !== "embed-css.ts" && !f.path.endsWith(".d.ts"));

const stripCss = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//gu, "");
/** Code with comments and string/template contents blanked (JSX text stays). */
const stripCode = (t: string): string =>
  t
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gmu, "$1");

/** The plain rules of a stylesheet, `@media` / `@supports` bodies included: `{at, sel, body}`. */
function cssRules(text: string): Array<{ at: string[]; sel: string; body: string; depth: number }> {
  const out: Array<{ at: string[]; sel: string; body: string; depth: number }> = [];
  const stack: string[] = [];
  let buf = "";
  for (const ch of stripCss(text)) {
    if (ch === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (ch === "}") {
      const sel = stack.pop() ?? "";
      if (!sel.startsWith("@")) out.push({ at: [...stack], sel, body: buf, depth: stack.filter((s) => !s.startsWith("@")).length });
      buf = "";
    } else buf += ch;
  }
  return out;
}

/** `prop: value` pairs of a block, in order. */
function declsOf(body: string): Array<[string, string]> {
  return body
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d.includes(":"))
    .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]);
}

/** Rules that use `test` on a property with no earlier plain value of that property. */
function unguarded(test: RegExp, plain: (v: string) => boolean): string[] {
  const bad: string[] = [];
  for (const f of css)
    for (const r of cssRules(f.text)) {
      const seen = new Map<string, boolean>();
      for (const [prop, value] of declsOf(r.body)) {
        if (test.test(value) && seen.get(prop) !== true) bad.push(`${f.path} | ${r.sel} | ${prop}`);
        if (!test.test(value) && plain(value)) seen.set(prop, true);
      }
    }
  return bad;
}

describe("play's stylesheets stay inside the browser floor", () => {
  it("finds the stylesheets", () => {
    expect(css.map((f) => f.path).sort()).toContain("styles.css");
    expect(css.length).toBeGreaterThanOrEqual(9);
  });

  it("no :has() outside an @supports selector(:has(…)) guard", () => {
    const bad: string[] = [];
    for (const f of css)
      for (const r of cssRules(f.text))
        if (r.sel.includes(":has(") && !r.at.some((a) => /^@supports\s+selector\(\s*:has\(/u.test(a))) bad.push(`${f.path} | ${r.sel}`);
    expect(bad).toEqual([]);
  });

  it("no CSS nesting", () => {
    const bad = css.flatMap((f) => cssRules(f.text).filter((r) => r.depth > 0).map((r) => `${f.path} | ${r.sel}`));
    expect(bad).toEqual([]);
  });

  it("no authored @container", () => {
    expect(css.filter((f) => /@container\b/u.test(stripCss(f.text))).map((f) => f.path)).toEqual([]);
  });

  it("dvh / svh / lvh only after a vh fallback for the same property", () => {
    expect(unguarded(/\d(?:d|s|l)vh\b/u, (v) => /\dvh\b/u.test(v))).toEqual([]);
  });

  it("color-mix() only after a plain colour for the same property", () => {
    expect(unguarded(/color-mix\(/u, () => true)).toEqual([]);
  });
});

describe("play's code stays inside the browser floor", () => {
  const hits = (re: RegExp, allow: Set<string> = new Set()): string[] =>
    code.flatMap((f) => stripCode(f.text).split("\n").flatMap((line, i) => (re.test(line) && !allow.has(f.path) ? [`${f.path}:${i + 1} ${line.trim().slice(0, 80)}`] : [])));

  it("finds the code", () => {
    expect(code.length).toBeGreaterThan(50);
  });

  it("no <dialog> and no showModal()", () => {
    expect(hits(/<dialog[\s>]|\bshowModal\s*\(|HTMLDialogElement/u)).toEqual([]);
  });

  it("no structuredClone", () => {
    expect(hits(/\bstructuredClone\s*\(/u)).toEqual([]);
  });

  it("no Array.prototype.at", () => {
    expect(hits(/\.at\(\s*-?[\w.]+\s*\)/u)).toEqual([]);
  });

  it("the inert attribute only as a hint the code also enforces by hand", () => {
    // booth/scanner.tsx sets `inert` on the camera section under a card; on
    // Safari < 15.5 it is ignored, and booth/layer.tsx's own Tab trap skips
    // `[inert]` by hand, while the card covers the section for taps.
    expect(hits(/\binert\b(?!["'\]])|["']inert["']\s*[,)]/u, new Set(["booth/scanner.tsx", "booth/layer.tsx"]))).toEqual([]);
  });

  it("no CSS-in-JS uses of the banned CSS (dvh, :has, @container) outside embed-css.ts", () => {
    expect(hits(/:has\(|@container\b|\d(?:d|s|l)vh\b/u)).toEqual([]);
  });
});
