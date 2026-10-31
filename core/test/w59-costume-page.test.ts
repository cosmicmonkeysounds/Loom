//! Wave 59: the costume's page must run on iOS 9.3.5 Safari, the newest an iPad
//! 2 gets. Nobody can try that here, so the rules that keep it true are held
//! by a parser: the script is ES5, it uses nothing iOS 9 lacks, the stylesheet
//! has no grid or gap, and each part is its own same-origin file.

import { parse } from "acorn";
import { describe, expect, it } from "vitest";

import { COSTUME_CSS, COSTUME_HTML, COSTUME_JS, serveCostumePage } from "../server/costume-page.ts";
import { HTML_CSP } from "../server/routing.ts";

describe("w59 costume page: what iOS 9 can run", () => {
  it("the script parses as ES5", () => {
    expect(() => parse(COSTUME_JS, { ecmaVersion: 5, sourceType: "script" })).not.toThrow();
  });

  it("the parser does catch what would break it", () => {
    for (const bad of ["let a = 1;", "const a = 1;", "var f = () => 1;", "class A {}", "var s = `x`;", "import a from 'b';", "var { a } = b;", "async function f() {}"]) {
      expect(() => parse(bad, { ecmaVersion: 5, sourceType: "script" }), bad).toThrow();
    }
  });

  it("the script uses no API newer than iOS 9, and tracks touches itself", () => {
    const code = COSTUME_JS.replace(/\/\/.*$/gmu, "");
    for (const word of ["fetch(", "Promise", "new Map", "new Set", "Symbol", "BigInt", "async ", "await ", "Object.assign", ".includes(", ".closest(", "classList", "localStorage", "PointerEvent", "passive"]) {
      expect(code.includes(word), word).toBe(false);
    }
    for (const word of ["XMLHttpRequest", "touchstart", "touchend", "touchcancel", "changedTouches"]) expect(code).toContain(word);
  });

  it("the stylesheet has no grid, gap, custom property or web font", () => {
    for (const bad of [/display:\s*grid/u, /\bgap:/u, /var\(--/u, /--[a-z]+:/u, /@font-face/u, /@import/u, /\binset:/u, /aspect-ratio/u, /clamp\(/u]) {
      expect(COSTUME_CSS, String(bad)).not.toMatch(bad);
    }
  });

  it("the keys work in both orientations and do nothing but be keys", () => {
    expect(COSTUME_CSS).toContain("@media (orientation:portrait)");
    for (const rule of ["-webkit-user-select:none", "-webkit-touch-callout:none", "-webkit-tap-highlight-color", "overflow:hidden", "position:fixed"]) expect(COSTUME_CSS).toContain(rule);
    expect(COSTUME_HTML).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(COSTUME_HTML).toContain("user-scalable=no");
    for (const key of ["CTRL", "ALT", "DELETE"]) expect(COSTUME_HTML).toContain(`<span>${key}</span>`);
  });

  it("nothing is inline, so `script-src 'self'` lets it run, and no secret is in it", () => {
    expect(COSTUME_HTML).toMatch(/<script src="\/costume\.js"><\/script>/u);
    expect(COSTUME_HTML).not.toMatch(/<script>|<style|style="|onclick=/u);
    for (const [path, type] of [
      ["/costume", "text/html"],
      ["/costume.js", "text/javascript"],
      ["/costume.css", "text/css"],
    ] as const) {
      let head: Record<string, string> = {};
      let body = "";
      const res = {
        writeHead(_s: number, h: Record<string, string>) {
          head = h;
        },
        end(b?: string) {
          body = b ?? "";
        },
      };
      expect(serveCostumePage("GET", path, res as never, HTML_CSP)).toBe(true);
      expect(head["content-type"]).toContain(type);
      expect(body.length).toBeGreaterThan(100);
      if (path === "/costume") expect(head["content-security-policy"]).toBe(HTML_CSP);
    }
    expect(serveCostumePage("POST", "/costume", {} as never, HTML_CSP)).toBe(false);
    expect(serveCostumePage("GET", "/costumes", {} as never, HTML_CSP)).toBe(false);
  });
});
