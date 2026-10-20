//! Wave 13 integration: the accessibility floor on the shared primitives.
//! Every control used on the night is a 44 × 44 target (a small Win95 ×
//! keeps its bevel and grows a transparent hit area), and the NOW title
//! bar's text reaches 4.5:1 across the whole width of its caption.

import { describe, expect, it } from "vitest";
import { readBundledCss } from "./css.ts";

const css = readBundledCss().replace(/\/\*[\s\S]*?\*\//gu, "");

/** Every declaration block for exactly `sel` (outside @media), merged in cascade order. */
function decls(sel: string): Record<string, string> {
  const out: Record<string, string> = {};
  const top = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gu, "");
  for (const m of top.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    if (!m[1]!.split(",").map((s) => s.trim()).includes(sel)) continue;
    for (const d of m[2]!.split(";")) {
      const i = d.indexOf(":");
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  return out;
}

const px = (v: string | undefined): number => {
  if (v === undefined) return NaN;
  if (v === "var(--tap)") return 44;
  const m = /^(-?\d+(?:\.\d+)?)px$/u.exec(v);
  return m === null ? NaN : Number(m[1]);
};

/** `inset: a [b [c [d]]]` → [top, right, bottom, left]. */
function inset(v: string): [number, number, number, number] {
  const p = v.split(/\s+/u).map(px);
  const [t, r = t, b = t, l = r] = p as [number, number?, number?, number?];
  return [t!, r!, b!, l!];
}

/** The hit area of a box of `w × h` grown by a negative `::after` inset. */
function hitArea(sel: string, w: number, h: number): { w: number; h: number } {
  const after = decls(`${sel}::after`);
  expect(after["content"], `${sel}::after`).toBe('""');
  expect(after["position"]).toBe("absolute");
  const [t, r, b, l] = after["inset"] !== undefined ? inset(after["inset"]) : (["top", "right", "bottom", "left"].map((k) => px(after[k] ?? "0px")) as [number, number, number, number]);
  return { w: w - l - r, h: h - t - b };
}

describe("the 44 px floor on the shared primitives", () => {
  it("every box is border-box, so a min-height is the row's height", () => {
    expect(decls("*")["box-sizing"]).toBe("border-box");
  });

  it("a room row is 44 px tall with or without a subtitle", () => {
    expect(px(decls(".chrow")["min-height"])).toBeGreaterThanOrEqual(44);
  });

  it("the sheet's × keeps its 28 × 24 bevel and is a 44 × 44 target", () => {
    const x = decls(".sheet-x");
    expect([px(x["width"]), px(x["height"])]).toEqual([28, 24]);
    expect(x["position"]).toBe("relative");
    const hit = hitArea(".sheet-x", 28, 24);
    expect(hit.w).toBeGreaterThanOrEqual(44);
    expect(hit.h).toBeGreaterThanOrEqual(44);
    // it reaches no further up than the caption's 3 px + the sheet's 4 px,
    // so the sheet's scroll box never clips it
    expect(-inset(decls(".sheet-x::after")["inset"]!)[0]).toBeLessThanOrEqual(7);
  });

  it("a window's × (WinWindow / WinDialog) keeps a 32 × 28 bevel and is a 44 × 44 target", () => {
    const x = decls(".w95-btn.w95-x");
    expect([px(x["min-width"]), px(x["min-height"])]).toEqual([32, 28]);
    const hit = hitArea(".w95-btn.w95-x", 32, 28);
    expect(hit.w).toBeGreaterThanOrEqual(44);
    expect(hit.h).toBeGreaterThanOrEqual(44);
  });

  it("a tray button is 44 wide and reaches 44 tall", () => {
    const t = decls("button.tray-item");
    expect(px(t["min-width"])).toBe(44);
    const hit = hitArea("button.tray-item", 44, px(decls(".tray-item")["min-height"]));
    expect(hit.h).toBeGreaterThanOrEqual(44);
  });

  it("a tappable sender avatar (30 × 30) is a 44 × 44 target", () => {
    const hit = hitArea('.msg-avatar[tabindex="0"]', 30, 30);
    expect(hit.w).toBeGreaterThanOrEqual(44);
    expect(hit.h).toBeGreaterThanOrEqual(44);
  });

  it("no rule outside @media sets a control's min-height under 44 px unless it grows a hit area", () => {
    // the Win95-sized bevels below each have a ::after that reaches 44 (asserted above / in chrome.css)
    const sized = new Set([".w95-btn.w95-x", ".taskbar-btn", ".tray-item", ".w95-titlebar", ".thread-head .presence", ".taskbar-tray"]);
    const under: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      const v = /(?:^|;)\s*min-height:\s*(\d+)px/u.exec(m[2]!);
      if (v === null || Number(v[1]) >= 44) continue;
      const sel = m[1]!.trim();
      if (!/btn|button|-x\b|choice|link|chrow|tab\b|row\b/u.test(sel)) continue;
      if (sized.has(sel)) continue;
      under.push(`${sel} ${v[1]}px`);
    }
    expect(under).toEqual([]);
  });
});

// ── contrast ────────────────────────────────────────────────────────────

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** A token's value as the cascade leaves it for `scope` (later blocks win). */
function token(scope: ":root" | ':root[data-theme="aol97"]', name: string): string {
  let out: string | undefined;
  const scopes = scope === ":root" ? [":root"] : [":root", ':root[data-theme="aol97"]'];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    if (!scopes.includes(m[1]!.trim())) continue;
    const v = new RegExp(`(?:^|;|\\s)${name}:\\s*([^;]+)`, "u").exec(m[2]!)?.[1]?.trim();
    if (v !== undefined) out = v;
  }
  if (out === undefined) throw new Error(`no ${name} under ${scope}`);
  return out;
}
function hex(scope: ":root" | ':root[data-theme="aol97"]', name: string): string {
  const v = token(scope, name);
  const ref = /^var\((--[\w-]+)\)$/u.exec(v);
  if (ref !== null) return hex(scope, ref[1]!);
  expect(v, name).toMatch(/^#[0-9a-fA-F]{6}$/u);
  return v;
}
/** The colour stops of a `linear-gradient(90deg, var(--a), var(--b))` token, or the one colour. */
function stops(scope: ":root" | ':root[data-theme="aol97"]', name: string): string[] {
  const v = token(scope, name);
  const ref = /^var\((--[\w-]+)\)$/u.exec(v);
  if (ref !== null) return stops(scope, ref[1]!);
  const g = /^linear-gradient\(90deg,\s*(.+)\)$/u.exec(v);
  if (g === null) return [hex(scope, name)];
  return g[1]!.split(",").map((s) => /^var\((--[\w-]+)\)$/u.exec(s.trim())?.[1]).map((t) => {
    if (t === undefined) throw new Error(`a literal stop in ${name}`);
    return hex(scope, t);
  });
}

describe("the NOW title bar's contrast (≥ 4.5:1 for every line, the whole width)", () => {
  it("the bar paints --now-grad", () => {
    expect(decls(".title-bar")["background"]).toBe("var(--now-grad)");
  });

  for (const scope of [":root", ':root[data-theme="aol97"]'] as const) {
    it(`${scope}: the title and the sub-line on both ends of the caption`, () => {
      const ends = stops(scope, "--now-grad");
      const title = hex(scope, "--title-ink");
      const sub = hex(scope, "--on-bar");
      for (const end of ends) {
        expect(contrast(title, end), `title on ${end}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(sub, end), `sub-line on ${end}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${scope}: the alarm and restricted captions (white sub-line there)`, () => {
      const title = hex(scope, "--title-ink");
      for (const end of [hex(scope, "--maroon"), hex(scope, "--maroon-2"), hex(":root", "--restricted"), hex(":root", "--restricted-2")]) {
        expect(contrast(title, end), `on ${end}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("aol97: still a navy → blue caption, and the windows' #1084d0 end is why it is its own token", () => {
    const [from, to] = stops(':root[data-theme="aol97"]', "--now-grad");
    expect(from).toBe("#000080");
    expect(to).not.toBe(from);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(to!.slice(i, i + 2), 16));
    expect(b!).toBeGreaterThan(r! + 100); // blue
    expect(b!).toBeGreaterThan(g!);
    expect(contrast("#dfe7ff", hex(':root[data-theme="aol97"]', "--navy-2"))).toBeLessThan(4.5);
  });
});
