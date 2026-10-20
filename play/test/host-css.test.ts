//! The host console's stylesheet (wave 13): red text that sits on the
//! silver face must reach 4.5:1 in both themes, and every night control
//! keeps the 44 px floor.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const host = readFileSync(new URL("../src/css/host.css", import.meta.url), "utf8");
const base = readFileSync(new URL("../src/css/base.css", import.meta.url), "utf8");
const themes = readFileSync(new URL("../src/css/themes.css", import.meta.url), "utf8");

/** `selector → declarations` for every plain rule (comments stripped). */
function rules(css: string): Array<{ sel: string; body: string }> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
}

/** A token's hex value in the first block of `css` that matches `scope`. */
function token(css: string, scope: RegExp, name: string): string {
  const block = css.match(scope)?.[1] ?? "";
  const v = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`, "u"))?.[1];
  if (v === undefined) throw new Error(`no ${name}`);
  return v;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const PLAIN = /^:root\s*\{([\s\S]*?)\}/mu;
const AOL = /:root\[data-theme="aol97"\]\s*\{([\s\S]*?)\}/u;

describe("the host console's colours", () => {
  it("red text on the silver face is --maroon, ≥ 4.5:1 in both themes", () => {
    expect(contrast(token(base, PLAIN, "--maroon"), token(base, PLAIN, "--face"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(themes, AOL, "--maroon"), token(themes, AOL, "--face"))).toBeGreaterThanOrEqual(4.5);
    // --bad on silver is why: under aol97 it is 3.6:1.
    expect(contrast(token(themes, AOL, "--bad"), token(themes, AOL, "--face"))).toBeLessThan(4.5);
  });
  it("--bad is text only on white (the bar, a filing), never on the face", () => {
    const onWhite = new Set([".host-strip-urgent", ".host-strip-needs", ".host-bar.armed .host-bar-tag", ".host-bar-stale, .host-bar-refused", ".host-filing-near", ".host-bar-title.quiet.urgent", ".host-bar.paused.armed .host-bar-tag"]);
    const red = rules(host).filter((r) => /(^|;|\s)color:\s*var\(--bad\)/u.test(r.body));
    for (const r of red) expect(onWhite.has(r.sel), r.sel).toBe(true);
    for (const sel of [".host-tab.counted", ".host-danger", ".host-confirm-yes.danger", ".host-note.alarm"]) {
      expect(rules(host).find((r) => r.sel === sel)?.body).toMatch(/color:\s*var\(--maroon\)/u);
    }
  });
});

describe("the host console's touch targets", () => {
  it("no control in host.css sets a min-height under the 44 px floor", () => {
    for (const r of rules(host)) {
      const m = r.body.match(/min-height:\s*(\d+)px/u);
      // The bar (52 px) and the dial steps (52 px) are over; nothing is under.
      if (m !== null) expect(Number(m[1]), r.sel).toBeGreaterThanOrEqual(44);
    }
    expect(rules(host).find((r) => r.sel === ".host-fold")?.body).toMatch(/min-height:\s*var\(--tap\)/u);
  });
  it("the console's close button is a 44 × 44 box with no hit pad past the screen's edge", () => {
    const x = rules(host).find((r) => r.sel === ".host-drawer-title .w95-x")?.body ?? "";
    expect(x).toMatch(/min-height:\s*var\(--tap\)/u);
    expect(x).toMatch(/min-width:\s*var\(--tap\)/u);
    // The shared 32 px button's ::after pad (6 px past each side) widened a
    // phone's layout viewport by 6 px with the drawer open.
    expect(rules(host).find((r) => r.sel === ".host-drawer-title .w95-x::after")?.body).toMatch(/inset:\s*0\b/u);
  });
  it("on a phone the NEXT bar's code chip stays one line tall beside a two-line refusal", () => {
    const chips = rules(host).filter((r) => r.sel === ".host-bar .host-code-narrow");
    expect(chips.some((r) => /display:\s*inline-block/u.test(r.body) && /align-self:\s*flex-start/u.test(r.body))).toBe(true);
  });
  it("a reply box inside a sheet fits the sheet's 8 px insets", () => {
    expect(rules(host).find((r) => r.sel === ".host-text.in-sheet")?.body).toMatch(/width:\s*calc\(100% - 16px\)/u);
  });
});
