//! K-31b — the switch and the nonce manifest (`server/routes/k31b.ts`): the
//! Home Screen app's `start_url` carries the event code + the nonce, marked
//! `home=1`; anything that isn't a well-formed nonce link (every Android
//! phone) gets the static file.

import type { ServerResponse } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { homescreenEnabled, homescreenManifest, homescreenStartUrl, serveHomescreenManifest } from "../server/routes/k31b.ts";

const STATIC = { name: "Loom", short_name: "Loom", start_url: "/", scope: "/", display: "standalone" };

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeRes() {
  const res = {
    status: 0,
    headers: {} as Record<string, string>,
    body: "",
    writeHead(s: number, h: Record<string, string>) {
      res.status = s;
      res.headers = h;
      return res;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res;
}

describe("K-31b switch", () => {
  it("is off unless LOOM_HOMESCREEN says on", () => {
    expect(homescreenEnabled({})).toBe(false);
    expect(homescreenEnabled({ LOOM_HOMESCREEN: "off" })).toBe(false);
    expect(homescreenEnabled({ LOOM_HOMESCREEN: "" })).toBe(false);
    for (const v of ["on", "1", "true", "YES", " on "]) expect(homescreenEnabled({ LOOM_HOMESCREEN: v })).toBe(true);
  });
});

describe("K-31b manifest", () => {
  it("puts the code + nonce in start_url, labelled with the event", () => {
    const m = homescreenManifest(STATIC, "?code=EVT202&pair=abc_DEF-123&name=Trapped%20in%20the%20Internet");
    expect(m).toEqual({ ...STATIC, name: "Trapped in the Internet", short_name: "Trapped in the Internet", start_url: "/?code=EVT202&pair=abc_DEF-123&home=1" });
    expect(homescreenStartUrl("EVT 1", "a/b")).toBe("/?code=EVT%201&pair=a%2Fb&home=1");
    // No name → the static label stays.
    expect(homescreenManifest(STATIC, "?code=E&pair=p")).toEqual({ ...STATIC, start_url: "/?code=E&pair=p&home=1" });
  });

  it("anything but a well-formed nonce link is the static file (Android unchanged)", () => {
    for (const q of ["", "?code=E", "?pair=p", "?code=E&pair=", "?code=E&pair=a%22b", "?code=%3Cscript%3E&pair=p", `?code=E&pair=${"x".repeat(65)}`]) {
      expect(homescreenManifest(STATIC, q)).toBeNull();
    }
  });

  it("serves no-cache JSON only while switched on, built on the build's own manifest", () => {
    const d = mkdtempSync(join(tmpdir(), "loom-hs-"));
    dirs.push(d);
    writeFileSync(join(d, "manifest.webmanifest"), JSON.stringify({ ...STATIC, theme_color: "#123456" }));
    const dist = pathToFileURL(`${d}/`);
    const off = fakeRes();
    expect(serveHomescreenManifest("?code=E&pair=p", dist, off as unknown as ServerResponse, false)).toBe(false);
    expect(off.status).toBe(0);
    const bad = fakeRes();
    expect(serveHomescreenManifest("?code=E", dist, bad as unknown as ServerResponse, true)).toBe(false);
    const on = fakeRes();
    expect(serveHomescreenManifest("?code=E&pair=p", dist, on as unknown as ServerResponse, true)).toBe(true);
    expect(on.status).toBe(200);
    expect(on.headers["cache-control"]).toBe("no-cache");
    expect(on.headers["content-type"]).toBe("application/manifest+json");
    expect(JSON.parse(on.body)).toMatchObject({ theme_color: "#123456", start_url: "/?code=E&pair=p&home=1" });
    // No build → the built-in fallback, still with the nonce.
    const none = fakeRes();
    expect(serveHomescreenManifest("?code=E&pair=p", pathToFileURL(`${d}/missing/`), none as unknown as ServerResponse, true)).toBe(true);
    expect(JSON.parse(none.body)).toMatchObject({ display: "standalone", start_url: "/?code=E&pair=p&home=1" });
  });
});
