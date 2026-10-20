//! Wave 13 Stage A: the shared tokens (CONTRACTS §5.1a) are defined for
//! both themes, the Win95 primitives take every colour from tokens, and the
//! status bar follows the theme.

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { setThemeColor } from "../src/session/shared.ts";
import { WinDialog, WinWindow, trapNext } from "../src/ui/window.tsx";
import { readBundledCss } from "./css.ts";

const CSS = readBundledCss();
const TOKENS = [
  "--z-dock", "--z-drawer", "--z-sheet", "--z-tour", "--z-toast", "--z-moment", "--z-pass", "--z-takeover", "--z-glitch",
  "--tap", "--safe-top", "--safe-bottom", "--title-h", "--taskbar-h", "--title-grad", "--title-ink",
  "--tray-face", "--tray-inset", "--balloon-bg", "--balloon-ink", "--dialog-face", "--bsod-bg", "--bsod-ink", "--dim-ink",
];

/** Every custom property a block declares, by the block's selector. */
function declared(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  const esc = selector.replace(/[[\]().*+?^$|\\]/g, "\\$&");
  for (const m of CSS.matchAll(new RegExp(`(^|\\n)${esc} \\{([^}]*)\\}`, "gu"))) {
    for (const d of m[2]!.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gu)) out.set(d[1]!, d[2]!.trim());
  }
  return out;
}

describe("the wave 13 tokens", () => {
  const plain = declared(":root");
  const aol = declared(':root[data-theme="aol97"]');

  it("every token is defined under both themes", () => {
    for (const t of TOKENS) {
      expect(plain.get(t), `plain ${t}`).toBeDefined();
      expect(aol.get(t), `aol97 ${t}`).toBeDefined();
    }
  });

  it("the layer order and the touch floor are the same in both", () => {
    for (const t of TOKENS.filter((t) => t.startsWith("--z-") || t === "--tap")) expect(aol.get(t)).toBe(plain.get(t));
    expect(plain.get("--tap")).toBe("44px");
    expect(Number(plain.get("--z-glitch"))).toBeGreaterThan(Number(plain.get("--z-takeover")));
    expect(Number(plain.get("--z-pass"))).toBeGreaterThan(Number(plain.get("--z-moment")));
  });

  it("aol97 has the Win95 colours; plain the flat ones", () => {
    expect(aol.get("--balloon-bg")).toBe("#ffffe1");
    expect(aol.get("--bsod-bg")).toBe("#0000aa");
    expect(aol.get("--title-grad")).toMatch(/linear-gradient/u);
    expect(plain.get("--title-grad")).toBe("var(--navy)");
    expect(plain.get("--safe-top")).toBe("env(safe-area-inset-top, 0px)");
  });

  it("the Win95 primitives write no colour literal (only tokens)", () => {
    const w95 = CSS.slice(CSS.indexOf(".w95-window {"), CSS.indexOf(".w95-dialog {") + 80);
    expect(w95).not.toMatch(/#[0-9a-f]{3,6}\b|rgba?\(/iu);
  });
});

describe("Win95 windows", () => {
  it("a window has its caption bar; a dialog is a div modal, never <dialog>", () => {
    const win = renderToStaticMarkup(createElement(WinWindow, { title: "Pass", tone: "alarm" }, "body"));
    expect(win).toContain('class="w95-titlebar alarm"');
    const dlg = renderToStaticMarkup(createElement(WinDialog, { title: "Alert", onClose: () => {} }, "Hello"));
    expect(dlg).toContain('role="dialog"');
    expect(dlg).toContain('aria-modal="true"');
    expect(dlg).not.toContain("<dialog");
    expect(dlg).toContain('aria-label="Close"');
  });

  it("Tab wraps inside the dialog, both ways", () => {
    expect(trapNext(3, 2, false)).toBe(0);
    expect(trapNext(3, 0, true)).toBe(2);
    expect(trapNext(3, -1, false)).toBe(0);
    expect(trapNext(3, -1, true)).toBe(2);
    expect(trapNext(0, -1, false)).toBe(-1);
  });
});

describe("the status bar follows the theme", () => {
  it("sets theme-color from the computed --navy, and leaves it alone without one", () => {
    const meta = { content: "#3b3a5c", setAttribute(_k: string, v: string) { this.content = v; } };
    setThemeColor(meta, " #000080");
    expect(meta.content).toBe("#000080");
    setThemeColor(meta, "");
    expect(meta.content).toBe("#000080");
    setThemeColor(null, "#3b3a5c");
  });
});
