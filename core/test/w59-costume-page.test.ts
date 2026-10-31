//! Wave 59: the costume's page must run on iOS 9.3.5 Safari, the newest an iPad
//! 2 gets. Nobody can try that here, so the rules that keep it true are held
//! by a parser: the script is ES5, it uses nothing iOS 9 lacks, the stylesheet
//! has no grid or gap, and each part is its own same-origin file.

import { spawn } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { connect, createServer as netServer, type AddressInfo } from "node:net";
import { runInNewContext } from "node:vm";
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

/** The page's script on a stub DOM: enough to hold a chord, no browser. */
function stubPage() {
  type Stub = { className: string; attrs: Record<string, string>; on: Record<string, (e: unknown) => void>; [k: string]: unknown };
  const stub = (attrs: Record<string, string> = {}): Stub => ({
    className: "",
    attrs,
    on: {},
    addEventListener(type: string, fn: (e: unknown) => void) {
      (this as Stub).on[type] = fn;
    },
    getAttribute: (n: string) => attrs[n] ?? null,
    setAttribute: (n: string, v: string) => void (attrs[n] = v),
    appendChild() {},
    removeChild() {},
    parentNode: null,
    firstChild: null,
  });
  const els: Record<string, Stub> = { "k-ctrl": stub({ "data-key": "ctrl" }), "k-alt": stub({ "data-key": "alt" }), "k-del": stub({ "data-key": "del" }), menu: { ...stub(), className: "hidden" } };
  const document = { getElementById: (id: string) => (els[id] ??= stub()), createElement: () => stub(), addEventListener() {}, elementFromPoint: () => null };
  class XMLHttpRequest {
    open() {}
    setRequestHeader() {}
    send() {}
  }
  runInNewContext(COSTUME_JS, { document, window: { location: { search: "?k=x" } }, XMLHttpRequest, setTimeout: () => 1, clearTimeout() {}, setInterval() {} });
  const touch = (type: string, changed: Array<[number, string]>, touches: number[]) =>
    els["app"]!.on[type]!({ type, preventDefault() {}, changedTouches: changed.map(([identifier, key]) => ({ identifier, target: els[key]! })), touches: touches.map((identifier) => ({ identifier })) });
  return { touch, menuOpen: () => !els["menu"]!.className.includes("hidden") };
}

describe("w59 costume page: three fingers", () => {
  it("all three held opens the menu, and a touch that lost its touchend holds nothing", () => {
    const real = stubPage();
    real.touch("touchstart", [[1, "k-ctrl"]], [1]);
    real.touch("touchstart", [[2, "k-alt"]], [1, 2]);
    expect(real.menuOpen()).toBe(false);
    real.touch("touchstart", [[3, "k-del"]], [1, 2, 3]);
    expect(real.menuOpen()).toBe(true);

    const lost = stubPage();
    lost.touch("touchstart", [[1, "k-ctrl"]], [1]);
    lost.touch("touchstart", [[2, "k-alt"]], [1, 2]);
    lost.touch("touchstart", [[3, "k-del"]], [3]); // 1 and 2 left the glass with no touchend
    expect(lost.menuOpen()).toBe(false);
  });
});

describe("w59 costume relay", () => {
  const RELAY = new URL("../../scripts/house-macbook/costume-relay.mjs", import.meta.url).pathname;

  it("adds the token, survives a malformed request and a bad body, and never prints the token", async () => {
    const heard: string[] = [];
    const up = httpServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        heard.push(`${req.method} ${req.url} ${body}`);
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("up");
      });
    });
    await new Promise<void>((r) => up.listen(0, "127.0.0.1", r));
    const free = netServer();
    await new Promise<void>((r) => free.listen(0, "127.0.0.1", r));
    const port = (free.address() as AddressInfo).port;
    await new Promise((r) => free.close(r));

    const token = "relay-test-token";
    const p = spawn(process.execPath, [RELAY, String(port)], { env: { ...process.env, COSTUME_LINK: `http://127.0.0.1:${(up.address() as AddressInfo).port}/costume?e=evt&k=${token}` } });
    let out = "";
    let exited: number | null = null;
    p.on("exit", (c) => (exited = c ?? -1));
    await new Promise<void>((ready) => {
      p.stdout.on("data", (d) => {
        out += d;
        ready();
      });
      p.stderr.on("data", (d) => (out += d));
    });

    try {
      const raw = await new Promise<string>((done) => {
        const s = connect(port, "127.0.0.1", () => s.write("GET // HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
        let got = "";
        s.on("data", (d) => (got += d));
        s.on("close", () => done(got));
      });
      expect(raw).toContain("404");
      const base = `http://127.0.0.1:${port}`;
      expect((await fetch(`${base}/api/costume/fire`, { method: "POST", body: "not json" })).status).toBe(502);
      expect(await (await fetch(`${base}/costume.js`)).text()).toBe("up");
      expect((await fetch(`${base}/api/mod/login`, { method: "POST", body: "{}" })).status).toBe(404);
      await fetch(`${base}/api/costume/fire`, { method: "POST", body: JSON.stringify({ id: "poke", k: "from-the-page" }) });
      expect(heard.at(-1)).toBe(`POST /e/evt/api/costume/fire ${JSON.stringify({ id: "poke", k: token })}`);
      expect(exited).toBeNull();
      expect(out).not.toContain(token);
    } finally {
      p.kill();
      up.close();
    }
  });
});
