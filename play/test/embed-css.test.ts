import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scopeCss } from "../src/embed-css.ts";

const CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("embedded pane stylesheet", () => {
  const scoped = scopeCss(CSS);

  it("leaves no page-level selector behind", () => {
    expect(scoped).not.toMatch(/:root\b/u);
    expect(scoped).not.toMatch(/(^|\n)\s*(html|body)\b[^-]/u);
    expect(scoped).not.toMatch(/#root\b/u);
  });

  it("themes the pane root, not the page", () => {
    expect(scoped).toContain('.play-root[data-theme="aol97"] {');
    expect(scoped).toContain('.play-root[data-theme="aol97"] { font-size: 13px; }');
  });

  it("sizes against the pane: container units + container queries", () => {
    expect(scoped).not.toMatch(/\d(vh|vw)\b/u);
    expect(scoped).toContain("88cqh");
    expect(scoped).toContain("@container play (min-height: 520px)");
    expect(scoped).not.toMatch(/@media \((min|max)-(width|height)/u);
    // A preference query is about the person — kept.
    expect(scoped).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
