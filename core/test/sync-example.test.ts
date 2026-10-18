//! `sync-example` (what `scripts/sync-show.sh` runs) never reloads a live
//! show with real guests unless told to (S1-ops-02, decision D6): a reload
//! is `EventRuntime.restart()` — every guest token cleared, the journal
//! reset. The project's files are written either way; the guard decides
//! the event half (`reloadEvent`) against a fake event server here.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reloadVerdict } from "../scripts/live-guard.ts";
import { reloadEvent, syncOptions, type SyncEvent } from "../scripts/sync-example.ts";

const persona = { id: "p-ab12cd", name: "Ivo" };
const phone = { id: "g-2", name: "Winamp" };

describe("reloadVerdict", () => {
  it("refuses a live event with a real guest, naming them", () => {
    const v = reloadVerdict({ mode: "live", roster: [persona, phone], override: false });
    expect(v.ok).toBe(false);
    expect(v.ok ? "" : v.reason).toMatch(/1 real guest\(s\) \(Winamp\).*NOT reloaded.*--i-know-this-is-live/u);
  });

  it("allows a live event of personas only, any preview, and the override", () => {
    expect(reloadVerdict({ mode: "live", roster: [persona], override: false }).ok).toBe(true);
    expect(reloadVerdict({ mode: "live", roster: [], override: false }).ok).toBe(true);
    expect(reloadVerdict({ mode: "preview", roster: [phone], override: false }).ok).toBe(true);
    expect(reloadVerdict({ mode: "live", roster: [phone], override: true }).ok).toBe(true);
  });

  it("refuses a live event with no roster at all (never reloaded blind)", () => {
    const v = reloadVerdict({ mode: "live", roster: undefined, override: false });
    expect(v.ok).toBe(false);
    expect(v.ok ? "" : v.reason).toMatch(/roster can't be read.*NOT reloaded/u);
    expect(reloadVerdict({ mode: "preview", roster: undefined, override: false }).ok).toBe(true);
  });
});

describe("syncOptions", () => {
  it("takes the override as a flag, or as LOOM_I_KNOW_THIS_IS_LIVE=1 where a flag can't reach", () => {
    expect(syncOptions(["Trapped"], {}).override).toBe(false);
    expect(syncOptions(["Trapped", "--i-know-this-is-live"], {}).override).toBe(true);
    expect(syncOptions(["Trapped"], { LOOM_I_KNOW_THIS_IS_LIVE: "1" }).override).toBe(true);
    expect(syncOptions(["Trapped"], { LOOM_I_KNOW_THIS_IS_LIVE: "yes" }).override).toBe(false);
  });

  it("reads the rest of the line", () => {
    const o = syncOptions(["Trapped", "escape-the-internet", "--server", "http://x:1", "--no-reload", "--replace-maps"], { LOOM_PORT: "7311" });
    expect(o).toEqual({ server: "http://x:1", reload: false, override: false, mapMode: "replace", positional: ["Trapped", "escape-the-internet"] });
    expect(syncOptions([], { LOOM_PORT: "7311" }).server).toBe("http://localhost:7311");
  });
});

describe("reloadEvent", () => {
  let server: Server;
  let base = "";
  let roster: { id: string; name: string }[] = [];
  /** The mod state's body; null = `{title, roster}`. */
  let stateBody: unknown = null;
  let hits: string[] = [];
  let resyncStatus = 200;
  let resynced = true;

  beforeEach(async () => {
    hits = [];
    resyncStatus = 200;
    resynced = true;
    roster = [];
    stateBody = null;
    server = createServer((req, res) => {
      const path = (req.url ?? "").replace(/^\/e\/[^/]+/u, "");
      hits.push(`${req.method} ${path}`);
      res.setHeader("content-type", "application/json");
      if (path === "/api/mod/login") return void res.end(JSON.stringify({ token: "mod-tok" }));
      if (path === "/api/state?role=mod") {
        if (req.headers["x-loom-token"] !== "mod-tok") return void res.writeHead(401).end("{}");
        return void res.end(JSON.stringify(stateBody ?? { title: "Trapped", roster }));
      }
      if (path === "/api/mod/load") return void res.end(JSON.stringify({ ok: true, phase: "open" }));
      if (path === "/api/mod/resync") {
        if (resyncStatus !== 200) return void res.writeHead(resyncStatus).end("{}");
        return void res.end(JSON.stringify({ ok: true, resynced }));
      }
      res.writeHead(404).end("{}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  const event = (mode: string): SyncEvent => ({ id: "ev1", mode, status: "open", event_code: "GST", prime_code: "PRM", mod_code: "MOD" });
  async function run(mode: string, override = false, at = base, reload = true): Promise<{ code: number; saved: number; lines: string[] }> {
    let saved = 0;
    const lines: string[] = [];
    const code = await reloadEvent({
      server: at,
      event: event(mode),
      override,
      reload,
      saveSnapshot: async () => {
        saved++;
      },
      body: { source: "# x" },
      out: (l) => lines.push(l),
    });
    return { code, saved, lines };
  }
  const loads = (): number => hits.filter((h) => h === "POST /api/mod/load").length;

  it("leaves a live event with a real guest alone: no load, no snapshot, exit 3", async () => {
    roster = [persona, phone];
    const r = await run("live");
    expect(r.code).toBe(3);
    expect(loads()).toBe(0);
    expect(r.saved).toBe(0);
    expect(r.lines.join("\n")).toMatch(/real guest.*Winamp.*NOT reloaded/u);
    expect(r.lines.join("\n")).toMatch(/LOOM_I_KNOW_THIS_IS_LIVE=1/u);
  });

  it("reloads a live event whose roster is only personas", async () => {
    roster = [persona];
    const r = await run("live");
    expect(r.code).toBe(0);
    expect(r.saved).toBe(1);
    expect(loads()).toBe(1);
  });

  it("never reads the roster of a preview, real guests or not", async () => {
    roster = [phone];
    const r = await run("preview");
    expect(r.code).toBe(0);
    expect(loads()).toBe(1);
    expect(hits).not.toContain("GET /api/state?role=mod");
  });

  it("--i-know-this-is-live reloads exactly once", async () => {
    roster = [phone];
    const r = await run("live", true);
    expect(r.code).toBe(0);
    expect(r.saved).toBe(1);
    expect(loads()).toBe(1);
  });

  it("refuses a live event it can't check (server down): nothing saved, exit 3", async () => {
    const r = await run("live", false, "http://127.0.0.1:1");
    expect(r.code).toBe(3);
    expect(r.saved).toBe(0);
    expect(r.lines.join("\n")).toMatch(/roster can't be read/u);
  });

  it("refuses a live event whose mod state carries no roster: nothing saved, exit 3", async () => {
    stateBody = {};
    const r = await run("live");
    expect(r.code).toBe(3);
    expect(r.saved).toBe(0);
    expect(loads()).toBe(0);
    expect(r.lines.join("\n")).toMatch(/roster can't be read \(the mod state carries no roster\)/u);
  });

  it("--no-reload on a live event with a real guest saves nothing (the next restart would play it)", async () => {
    roster = [persona, phone];
    const r = await run("live", false, base, false);
    expect(r.code).toBe(3);
    expect(r.saved).toBe(0);
    expect(loads()).toBe(0);
    expect(r.lines.join("\n")).toMatch(/real guest.*Winamp/u);
  });

  it("--no-reload on a live event of personas saves the snapshot and never loads", async () => {
    roster = [persona];
    const r = await run("live", false, base, false);
    expect(r.code).toBe(0);
    expect(r.saved).toBe(1);
    expect(loads()).toBe(0);
    expect(r.lines.join("\n")).toMatch(/not reloaded \(--no-reload\)/u);
    expect(hits.filter((h) => h === "POST /api/mod/resync")).toHaveLength(1);
  });

  it("--no-reload on a live event it can't check refuses (exit 3)", async () => {
    const r = await run("live", false, "http://127.0.0.1:1", false);
    expect(r.code).toBe(3);
    expect(r.saved).toBe(0);
  });

  it("--no-reload on a preview never reads the roster, and resyncs the open editors with no restart (T4 recheck)", async () => {
    roster = [phone];
    const r = await run("preview", false, base, false);
    expect(r.code).toBe(0);
    expect(r.saved).toBe(1);
    expect(hits).toEqual(["POST /api/mod/login", "POST /api/mod/resync"]);
    expect(r.lines.join("\n")).toMatch(/open editor tabs now show the synced files/u);
  });

  it("--no-reload never claims a resync the server didn't do (no project link → resynced: false; review 2)", async () => {
    resynced = false;
    const r = await run("preview", false, base, false);
    expect(r.code).toBe(0);
    expect(hits).toEqual(["POST /api/mod/login", "POST /api/mod/resync"]);
    const text = r.lines.join("\n");
    expect(text).not.toMatch(/open editor tabs now show the synced files/u);
    expect(text).toMatch(/no co-editing docs to resync/u);
  });

  it("--no-reload says so when the open editors couldn't be resynced", async () => {
    resyncStatus = 502;
    let r = await run("preview", false, base, false);
    expect(r.code).toBe(0);
    expect(r.lines.join("\n")).toMatch(/open editor tabs still hold the pre-sync text \(resync → 502\)/u);
    r = await run("preview", false, "http://127.0.0.1:1", false);
    expect(r.code).toBe(0);
    expect(r.saved).toBe(1);
    expect(r.lines.join("\n")).toMatch(/still hold the pre-sync text \(the server at http:\/\/127\.0\.0\.1:1 doesn't answer\)/u);
    expect(loads()).toBe(0);
  });

  it("a preview on a server that is down still saves its snapshot (exit 0)", async () => {
    const r = await run("preview", false, "http://127.0.0.1:1");
    expect(r.code).toBe(0);
    expect(r.saved).toBe(1);
    expect(r.lines.join("\n")).toMatch(/not reachable — the snapshot is saved/u);
  });
});
