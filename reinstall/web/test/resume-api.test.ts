//! (wave 40) Suspend + resume on the wire: `POST /api/spatial/suspend` holds
//! a walk; `POST /api/spatial/resume` picks it up (the assignment, the pose
//! to respawn at, whether the intro was done). Dead-session statuses become
//! an `over` value; a malformed ok answer is an error, never a crash.

import { describe, expect, it } from "vitest";
import { postResume, postSuspend } from "../src/api.ts";

function stubFetch(status: number, body: unknown): { urls: string[]; inits: RequestInit[]; fetch: typeof fetch } {
  const urls: string[] = [];
  const inits: RequestInit[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    inits.push(init ?? {});
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { urls, inits, fetch: f };
}

const throwingFetch = (async () => {
  throw new Error("offline");
}) as unknown as typeof fetch;

const POSE = { p: [1, 2, 3], yaw: 0.5, pitch: -0.1 };
const ASSIGNMENT = { session: "s-1", token: "tok-1", guest: "g-1", name: "WINAMP", houseVersion: "show", reinstalled: 2 };

describe("postSuspend (wave 40)", () => {
  it("POSTs {} with the session token, keepalive, and reports ok", async () => {
    const s = stubFetch(200, { ok: true });
    expect(await postSuspend("/e/ev", "tok-1", s.fetch)).toBe(true);
    expect(s.urls).toEqual(["/e/ev/api/spatial/suspend"]);
    expect(s.inits[0]!.method).toBe("POST");
    expect((s.inits[0]!.headers as Record<string, string>)["x-loom-token"]).toBe("tok-1");
    expect(s.inits[0]!.keepalive).toBe(true);
    expect(String(s.inits[0]!.body)).toBe("{}");
  });

  it("is false on a dead session or a network failure", async () => {
    expect(await postSuspend("/e/ev", "tok-1", stubFetch(410, { error: "gone" }).fetch)).toBe(false);
    expect(await postSuspend("/e/ev", "tok-1", throwingFetch)).toBe(false);
  });
});

describe("postResume (wave 40)", () => {
  it("returns the assignment, the pose and the intro flag on ok", async () => {
    const s = stubFetch(200, { ok: true, assignment: ASSIGNMENT, pose: POSE, ready: true });
    const r = await postResume("/e/ev", "tok-1", s.fetch);
    expect(s.urls).toEqual(["/e/ev/api/spatial/resume"]);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.pose).toEqual({ p: [1, 2, 3], yaw: 0.5, pitch: -0.1 });
      expect(r.ready).toBe(true);
      expect(r.assignment.name).toBe("WINAMP");
    }
  });

  it("maps 401 / 410 / 404 to an over value", async () => {
    for (const status of [401, 410, 404]) {
      const r = await postResume("/e/ev", "tok-1", stubFetch(status, { error: "gone" }).fetch);
      expect(r).toEqual({ kind: "over", status });
    }
  });

  it("is an error (not a crash) when the ok answer is incomplete", async () => {
    const r = await postResume("/e/ev", "tok-1", stubFetch(200, { ok: true, ready: true }).fetch); // no pose / assignment
    expect(r.kind).toBe("error");
  });

  it("is an error on a network failure", async () => {
    const r = await postResume("/e/ev", "tok-1", throwingFetch);
    expect(r.kind).toBe("error");
  });
});
