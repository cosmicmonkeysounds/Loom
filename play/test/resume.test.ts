import { describe, expect, it } from "vitest";

import { adoptResume, resumeFromSearch, withoutResume } from "../src/resume.ts";

function fakeFetch(routes: Record<string, { status: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const hit = routes[url] ?? { status: 404, body: { error: "nope" } };
    return new Response(JSON.stringify(hit.body), { status: hit.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("re-pair link (N-02)", () => {
  it("reads code + token off the QR and strips only the token", () => {
    expect(resumeFromSearch("?code=EVT1&resume=tok-1")).toEqual({ code: "EVT1", token: "tok-1" });
    expect(resumeFromSearch("?resume=tok-1")).toBeNull();
    expect(resumeFromSearch("?code=EVT1&resume=")).toBeNull();
    expect(resumeFromSearch("?code=EVT1")).toBeNull();
    expect(withoutResume("?code=EVT1&resume=tok-1")).toBe("?code=EVT1");
    expect(withoutResume("?resume=tok-1")).toBe("");
  });

  it("adopts the token as the guest the event says it is", async () => {
    const f = fakeFetch({
      "/api/resolve-code": { status: 200, body: { eventId: "evt 1", role: "guest", title: "Trapped" } },
      "/e/evt%201/api/state?role=guest": { status: 200, body: { id: "g-abc", name: "Winamp", title: "Trapped" } },
    });
    const g = await adoptResume({ code: "EVT1", token: "tok-1" }, f.fn);
    expect(g).toEqual({ id: "g-abc", name: "Winamp", token: "tok-1", eventId: "evt 1", title: "Trapped" });
    expect(JSON.parse(String(f.calls[0]!.init!.body))).toEqual({ code: "EVT1" });
    expect((f.calls[1]!.init!.headers as Record<string, string>)["x-loom-token"]).toBe("tok-1");
  });

  it("explains a dead code or an expired token", async () => {
    const noEvent = fakeFetch({});
    await expect(adoptResume({ code: "OLD", token: "t" }, noEvent.fn)).rejects.toThrow(/event code/u);
    const expired = fakeFetch({
      "/api/resolve-code": { status: 200, body: { eventId: "evt" } },
      "/e/evt/api/state?role=guest": { status: 401, body: { error: "not signed in" } },
    });
    await expect(adoptResume({ code: "EVT1", token: "t" }, expired.fn)).rejects.toThrow(/expired/u);
  });
});
