//! Wave 13 fix round, the host capability on the server:
//!
//! - C2: a host token opens the doors, pauses and resumes; restart / load /
//!   resync and the rest of the lifecycle stay refused.
//! - C4: `PrimeView.host` on every path — a restart or reload re-derives each
//!   booth's host from its part's `admin: true`, and a director's Run →
//!   Players pane of a host part is a host (journaled by the director).
//! - The editor's exact identity lens answers the author's session and a mod
//!   token (and the router resolves the session for it).

import { afterAll, describe, expect, it } from "vitest";
import { Store } from "../server/store.ts";
import { NOT_FROM_A_BOOTH } from "../server/routes/host.ts";
import { wantsModRead } from "../server/routing.ts";
import { CODES, booth, call, cleanup, freshDir, get, guest, mod, post, primeStream, runtime, story } from "./w13-fix-harness.ts";

afterAll(cleanup);

describe("C2: the doors, pause and resume from a host booth", () => {
  it("a host token opens the doors, pauses and resumes; the rest of the lifecycle stays refused", async () => {
    const rt = runtime();
    const host = (await booth(rt, "Task Manager")).json;
    expect(host).toMatchObject({ host: true, admin: false });
    const token = host.token as string;
    expect((await post(rt, "/api/mod/start", { token })).json).toMatchObject({ ok: true, phase: "open" });
    expect((await post(rt, "/api/mod/stop", { token })).json).toMatchObject({ ok: true, phase: "paused" });
    expect((await post(rt, "/api/mod/start", { token })).json).toMatchObject({ ok: true, phase: "open" });
    for (const [path, body] of [
      ["/api/mod/reset", {}],
      ["/api/mod/load", { source: story(true) }],
      ["/api/mod/resync", {}],
      ["/api/mod/codex", { who: "x", entry: "x" }],
      ["/api/mod/var", { path: "Night.step", value: "3" }],
      ["/api/mod/set", { id: "x", field: "score", value: 1 }],
      ["/api/mod/impersonate", { role: "prime", id: "Clippy" }],
    ] as const) {
      const r = await post(rt, path, { ...body, token });
      expect([path, r.status, r.json.error]).toEqual([path, 403, NOT_FROM_A_BOOTH]);
    }
    // The codes a host reads still leave out the mod passcode (no rotation here).
    const codes = await post(rt, "/api/mod/codes", { token });
    expect(codes.status).toBe(200);
    expect(codes.json.modPass).toBeUndefined();
    // A plain booth may not.
    const plain = (await booth(rt, "Norton")).json.token as string;
    expect((await post(rt, "/api/mod/stop", { token: plain })).status).toBe(403);
  });
});

describe("the editor's exact identity lens on a server project", () => {
  it("the router resolves the author session for ?as= reads", () => {
    expect(wantsModRead("/api/state", new URLSearchParams("role=prime&as=Task%20Manager"))).toBe(true);
    expect(wantsModRead("/api/state", new URLSearchParams("role=guest&as=g-1"))).toBe(true);
    expect(wantsModRead("/api/state", new URLSearchParams("role=guest"))).toBe(false);
  });

  it("answers the author's session and a mod token, with host for an admin part; never a host token", async () => {
    const rt = runtime();
    rt.openDoors();
    const g = await guest(rt, "Winamp");
    const author = await call(rt, "GET", "/api/state?role=prime&as=Task%20Manager", {}, { moderator: true });
    expect(author.status).toBe(200);
    expect(author.json.host).toBe(true);
    expect((await call(rt, "GET", `/api/state?role=guest&as=${g.id}`, {}, { moderator: true })).status).toBe(200);
    const modToken = (await post(rt, "/api/mod/login", { passcode: CODES.mod })).json.token as string;
    const viaToken = await get(rt, `/api/state?role=prime&as=Task%20Manager&token=${modToken}`);
    expect(viaToken.status).toBe(200);
    expect(viaToken.json.host).toBe(true);
    expect((await get(rt, `/api/state?role=prime&as=Norton&token=${modToken}`)).json.host).toBeUndefined();
    const host = (await booth(rt, "Task Manager")).json.token as string;
    expect((await get(rt, `/api/state?role=prime&as=Norton&token=${host}`)).status).toBe(403);
  });
});
