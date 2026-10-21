//! The process-level routing `server.ts` does for the reinstallation games
//! (`docs/loom-reinstall.md` §2 / §3): the `/reinstall/` sub-app (redirect,
//! SPA fallback, traversal refusal, its CSP) and which `/e/:id` reads
//! resolve the author session (the spatial map + stream among them). The
//! session → `canModerateEvent` half needs BetterAuth + Postgres and is not
//! covered here.

import { describe, expect, it } from "vitest";

import { HTML_CSP, REINSTALL_CSP, TERMINAL_CSP, appRelPath, subAppRoute, wantsModRead } from "../server/routing.ts";

const params = (q = "") => new URLSearchParams(q);

describe("the /reinstall/ sub-app route", () => {
  it("the bare prefix redirects to the slash, keeping the query", () => {
    expect(subAppRoute("/reinstall", "/reinstall", "?code=EVT222&station=vr-1")).toEqual({ redirect: "/reinstall/?code=EVT222&station=vr-1" });
    expect(subAppRoute("/reinstall", "/reinstall", "")).toEqual({ redirect: "/reinstall/" });
  });

  it("the SPA's own routes (no extension) fall back to index.html; assets are themselves", () => {
    expect(subAppRoute("/reinstall/", "/reinstall", "")).toEqual({ file: "/index.html" });
    expect(subAppRoute("/reinstall/map", "/reinstall", "")).toEqual({ file: "/index.html" });
    expect(subAppRoute("/reinstall/some/deep/route", "/reinstall", "")).toEqual({ file: "/index.html" });
    expect(subAppRoute("/reinstall/assets/index-abc.js", "/reinstall", "")).toEqual({ file: "/assets/index-abc.js" });
  });

  it("is not fooled by a lookalike prefix", () => {
    expect(subAppRoute("/reinstallx", "/reinstall", "")).toBeNull();
    expect(subAppRoute("/terminal/", "/reinstall", "")).toBeNull();
  });

  it("refuses to climb out of the dist dir", () => {
    expect(appRelPath("/../x")).toBeNull();
    expect(appRelPath("/assets/../../etc/passwd")).toBeNull();
    expect(appRelPath("/")).toBe("index.html");
    expect(appRelPath("/index.html")).toBe("index.html");
    // A request URL normalises encoded dot segments before routing ever sees them.
    expect(new URL("http://x/reinstall/%2e%2e/%2E%2e/etc/passwd").pathname).toBe("/etc/passwd");
  });

  it("its CSP allows blob media + workers on top of the base policy", () => {
    expect(REINSTALL_CSP.startsWith(HTML_CSP)).toBe(true);
    expect(REINSTALL_CSP).toContain("media-src 'self' blob:");
    expect(REINSTALL_CSP).toContain("worker-src 'self' blob:");
    expect(TERMINAL_CSP).not.toContain("worker-src");
    expect(HTML_CSP).toContain("frame-ancestors 'none'");
  });
});

describe("which event reads resolve the author session", () => {
  it("the spatial map + stream (the editor reads them on its cookie)", () => {
    expect(wantsModRead("/api/spatial/house", params())).toBe(true);
    expect(wantsModRead("/api/spatial/stream", params("name=Map"))).toBe(true);
    // The voice link's stream (§2.4): a terminal's token, or the editor's cookie.
    expect(wantsModRead("/api/spatial/voice/stream", params("spot=hall"))).toBe(true);
  });

  it("the wall terminals' screen state (a terminal's mod token, or the author's session)", () => {
    expect(wantsModRead("/api/screen/state", params("name=Kitchen&view=auto"))).toBe(true);
  });

  it("the mod-role reads, not a guest's or performer's", () => {
    expect(wantsModRead("/events", params())).toBe(true);
    expect(wantsModRead("/api/state", params("role=mod"))).toBe(true);
    expect(wantsModRead("/api/history", params())).toBe(true);
    expect(wantsModRead("/api/state", params("role=guest"))).toBe(false);
    expect(wantsModRead("/events", params("role=prime"))).toBe(false);
  });

  it("the editor's exact identity lens (?as=) of a guest or a booth, on the author's session", () => {
    expect(wantsModRead("/api/state", params("role=prime&as=Host%20Hal"))).toBe(true);
    expect(wantsModRead("/api/state", params("role=guest&as=g-1"))).toBe(true);
    // A booth's or a guest's own read (no as=) never resolves the session.
    expect(wantsModRead("/api/state", params("role=prime"))).toBe(false);
  });

  it("never a game's own writes or anything else", () => {
    expect(wantsModRead("/api/spatial/pose", params())).toBe(false);
    expect(wantsModRead("/api/spatial/voice", params("seq=1"))).toBe(false);
    expect(wantsModRead("/api/spatial/found", params())).toBe(false);
    expect(wantsModRead("/api/guest/say", params())).toBe(false);
  });
});
