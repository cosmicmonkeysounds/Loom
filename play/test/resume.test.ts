import { describe, expect, it } from "vitest";

import { adoptResume, resumeFromSearch, resumeToAdopt, storedGuestName, withoutResume } from "../src/resume.ts";

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
  it("reads code + pair code off the QR and strips only the pair code", () => {
    expect(resumeFromSearch("?code=EVT1&pair=p-1")).toEqual({ code: "EVT1", pair: "p-1" });
    expect(resumeFromSearch("?pair=p-1")).toBeNull();
    expect(resumeFromSearch("?code=EVT1&pair=")).toBeNull();
    expect(resumeFromSearch("?code=EVT1")).toBeNull();
    // A guest's raw token in the old `resume=` shape is not a re-pair link.
    expect(resumeFromSearch("?code=EVT1&resume=tok-1")).toBeNull();
    expect(withoutResume("?code=EVT1&pair=p-1")).toBe("?code=EVT1");
    expect(withoutResume("?pair=p-1")).toBe("");
  });

  it("trades the pair code for the guest's fresh token", async () => {
    const f = fakeFetch({
      "/api/resolve-code": { status: 200, body: { eventId: "evt 1", role: "guest", title: "Trapped" } },
      "/e/evt%201/api/guest/resume": { status: 200, body: { ok: true, id: "g-abc", name: "Winamp", token: "tok-1" } },
    });
    const g = await adoptResume({ code: "EVT1", pair: "p-1" }, f.fn);
    expect(g).toEqual({ id: "g-abc", name: "Winamp", token: "tok-1", eventId: "evt 1", title: "Trapped" });
    expect(JSON.parse(String(f.calls[0]!.init!.body))).toEqual({ code: "EVT1" });
    expect(f.calls[1]!.init!.method).toBe("POST");
    expect(JSON.parse(String(f.calls[1]!.init!.body))).toEqual({ pair: "p-1" });
  });

  it("explains a dead event code, a spent / expired pair code, and a throttle", async () => {
    const noEvent = fakeFetch({});
    await expect(adoptResume({ code: "OLD", pair: "p" }, noEvent.fn)).rejects.toThrow(/event code/u);
    const spent = fakeFetch({
      "/api/resolve-code": { status: 200, body: { eventId: "evt" } },
      "/e/evt/api/guest/resume": { status: 410, body: { error: "expired" } },
    });
    await expect(adoptResume({ code: "EVT1", pair: "p" }, spent.fn)).rejects.toThrow(/expired or was already used/u);
    const slow = fakeFetch({
      "/api/resolve-code": { status: 200, body: { eventId: "evt" } },
      "/e/evt/api/guest/resume": { status: 429, body: { error: "too many" } },
    });
    await expect(adoptResume({ code: "EVT1", pair: "p" }, slow.fn)).rejects.toThrow(/Too many tries/u);
  });

  it("names the guest this phone already is, so the app asks before switching", () => {
    expect(storedGuestName(null)).toBeNull();
    expect(storedGuestName("")).toBeNull();
    expect(storedGuestName("{not json")).toBeNull();
    expect(storedGuestName(JSON.stringify({ id: "g-1", name: "Winamp", token: "t" }))).toBe("Winamp");
    expect(storedGuestName(JSON.stringify({ id: "g-1", token: "t" }))).toBe("g-1");
  });
});

describe("Home Screen start link (K-31b)", () => {
  it("is a resume link marked home; the mark is stripped with the nonce", () => {
    expect(resumeFromSearch("?code=EVT1&pair=n-1&home=1")).toEqual({ code: "EVT1", pair: "n-1", home: true });
    expect(resumeFromSearch("?code=EVT1&pair=n-1&home=0")).toEqual({ code: "EVT1", pair: "n-1" });
    expect(withoutResume("?code=EVT1&pair=n-1&home=1")).toBe("?code=EVT1");
  });

  it("a relaunch on a phone holding a session drops the spent nonce, never asks to switch", () => {
    const home = { code: "EVT1", pair: "n-1", home: true };
    const qr = { code: "EVT1", pair: "p-1" };
    const guest = JSON.stringify({ id: "g-1", name: "Winamp", token: "t" });
    expect(resumeToAdopt(home, null, null)).toEqual(home); // the icon's first open
    expect(resumeToAdopt(home, guest, null)).toBeNull();
    expect(resumeToAdopt(home, null, JSON.stringify({ token: "pt" }))).toBeNull();
    expect(resumeToAdopt(qr, guest, null)).toEqual(qr); // a director's QR still asks
    expect(resumeToAdopt(null, guest, null)).toBeNull();
  });

  it("explains a spent icon nonce in Home Screen words", async () => {
    const spent = fakeFetch({
      "/api/resolve-code": { status: 200, body: { eventId: "evt" } },
      "/e/evt/api/guest/resume": { status: 410, body: { error: "expired" } },
    });
    await expect(adoptResume({ code: "EVT1", pair: "n", home: true }, spent.fn)).rejects.toThrow(/Home Screen icon/u);
  });
});
