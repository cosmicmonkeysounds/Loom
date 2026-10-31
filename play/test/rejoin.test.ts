// Wave 23: getting back in — badge / cast-card links, the enter / ask /
// poll calls over a fake fetch, the card plan, and the scanners' badge reads.

import { describe, expect, it } from "vitest";
import { badgeFromText, badgeLinkOf, badgeLinkText, cardFromSearch, cardPlan, heldOf, printedBadge, rememberBadge, storedBadge, forgetBadge, withoutCard, BADGE_UNKNOWN } from "../src/rejoin.ts";
import { askHeld, askHost, askLine, enterBy, enterPart, filterNames, heldLine, joinedNames, letGo, pollAsk, RejoinError } from "../src/rejoin-calls.ts";
import { memoryStore } from "../src/host.ts";
import { guestScan } from "../src/guest-scan-sheet.tsx";
import { parseScan } from "../src/scan.ts";
import { rejoinDetail } from "../src/host/model.ts";

const CODE = "k3m9q2xz";
const LINK = `https://party.example/?code=EVT1&badge=${CODE.toUpperCase()}`;

/** A fetch that answers by path. */
function fakeFetch(routes: Record<string, (body: Record<string, unknown>) => { status: number; body: unknown }>) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fn = (async (path: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    calls.push({ path, body });
    const h = routes[path];
    const out = h === undefined ? { status: 404, body: { error: "no route" } } : h(body);
    return { ok: out.status >= 200 && out.status < 300, status: out.status, json: async () => out.body } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const resolve = { "/api/resolve-code": () => ({ status: 200, body: { eventId: "ev1", title: "The Party" } }) };

describe("links", () => {
  it("reads a badge from a link or a typed code, never a pass", () => {
    expect(badgeFromText(LINK)).toBe(CODE);
    expect(badgeFromText("K3M9-Q2XZ")).toBe(CODE);
    expect(badgeFromText(" k3m9 q2xz ")).toBe(CODE);
    expect(badgeFromText("g-3f9a1c")).toBeNull();
    expect(badgeFromText("https://party.example/?code=EVT1")).toBeNull();
    expect(printedBadge(CODE)).toBe("K3M9-Q2XZ");
  });
  it("finds a card on the address and strips only its credential", () => {
    expect(cardFromSearch(`?code=EVT1&badge=${CODE}`)).toEqual({ code: "EVT1", badge: CODE });
    expect(cardFromSearch("?code=PRM1&part=abc")).toEqual({ code: "PRM1", part: "abc" });
    expect(cardFromSearch(`?badge=${CODE}`)).toBeNull();
    expect(cardFromSearch("?code=EVT1")).toBeNull();
    expect(withoutCard(`?code=EVT1&badge=${CODE}&room=x`)).toBe("?code=EVT1&room=x");
    expect(withoutCard("?part=abc")).toBe("");
  });
  it("plans by what the phone holds", () => {
    const badge = { code: "EVT1", badge: CODE };
    expect(cardPlan(null, null, false)).toEqual({ kind: "none" });
    expect(cardPlan(badge, null, false)).toEqual({ kind: "enter", code: "EVT1", badge: CODE });
    // A signed-in guest never switches by someone's badge: it links or reads as a pass.
    expect(cardPlan(badge, "Winamp", false)).toEqual({ kind: "link", badge: CODE });
    expect(cardPlan(badge, null, true)).toEqual({ kind: "none" });
    expect(cardPlan({ code: "PRM1", part: "p" }, "Winamp", false)).toEqual({ kind: "part", code: "PRM1", part: "p", confirm: "Winamp" });
    expect(cardPlan({ code: "PRM1", part: "p" }, null, true)).toEqual({ kind: "part", code: "PRM1", part: "p", confirm: null });
  });
  it("keeps a blank badge for its event code only", () => {
    const store = memoryStore();
    rememberBadge(store, "evt1", CODE);
    expect(storedBadge(store, "EVT1 ")).toBe(CODE);
    expect(storedBadge(store, "OTHER")).toBeNull();
    forgetBadge(store);
    expect(storedBadge(store, "EVT1")).toBeNull();
  });
});

describe("enter", () => {
  it("a linked badge is the guest; a blank one says join", async () => {
    const f = fakeFetch({ ...resolve, "/e/ev1/api/guest/enter": (b) => (b["badge"] === CODE ? { status: 200, body: { ok: true, resumed: true, id: "g-1", name: "Winamp", token: "t1", badge: 4 } } : { status: 200, body: { ok: true, resumed: false, badge: 5 } }) });
    expect(await enterBy("EVT1", { badge: CODE }, f.fn)).toEqual({ kind: "in", guest: { id: "g-1", name: "Winamp", token: "t1", eventId: "ev1", title: "The Party" } });
    expect(await enterBy("EVT1", { badge: "zzzzzzzz" }, f.fn)).toEqual({ kind: "fresh", eventId: "ev1", badge: 5 });
    expect(f.calls[1]!.body).toEqual({ passcode: "EVT1", badge: CODE });
  });
  it("says why in words", async () => {
    const f = fakeFetch({ ...resolve, "/e/ev1/api/guest/enter": () => ({ status: 404, body: { error: "x" } }) });
    await expect(enterBy("EVT1", { badge: CODE }, f.fn)).rejects.toThrow(BADGE_UNKNOWN);
    const busy = fakeFetch({ "/api/resolve-code": () => ({ status: 429, body: {} }) });
    await expect(enterBy("EVT1", { badge: CODE }, busy.fn)).rejects.toBeInstanceOf(RejoinError);
  });
  it("a cast card signs in as its part", async () => {
    const f = fakeFetch({ ...resolve, "/e/ev1/api/prime/login": (b) => (b["part"] === "p1" ? { status: 200, body: { token: "pt", character: "Clippy", admin: false, host: true } } : { status: 404, body: {} }) });
    expect(await enterPart("PRM1", "p1", f.fn)).toEqual({ token: "pt", character: "Clippy", admin: false, host: true, eventId: "ev1", title: "The Party" });
    await expect(enterPart("PRM1", "nope", f.fn)).rejects.toThrow(/staff badge/);
  });
});

describe("ask a host", () => {
  it("lists, asks, and polls to a token", async () => {
    let state = "pending";
    const f = fakeFetch({
      ...resolve,
      "/e/ev1/api/guest/rejoin/names": () => ({ status: 200, body: { ok: true, names: ["Calculator", "Winamp"] } }),
      "/e/ev1/api/guest/rejoin": (b) => ({ status: 200, body: { ok: true, request: "r1", name: String(b["name"]) } }),
      "/e/ev1/api/guest/rejoin/poll": () => ({ status: 200, body: state === "pending" ? { state } : { state, id: "g-2", name: "Winamp", token: "t2", by: "Task Manager" } }),
    });
    const list = await joinedNames("EVT1", f.fn);
    expect(list.names).toEqual(["Calculator", "Winamp"]);
    expect(filterNames(list.names, "win")).toEqual(["Winamp"]);
    const ask = await askHost("EVT1", "Winamp", list, f.fn);
    expect(ask).toEqual({ eventId: "ev1", title: "The Party", request: "r1", name: "Winamp" });
    expect(await pollAsk(ask, f.fn)).toEqual({ kind: "pending" });
    state = "approved";
    const got = await pollAsk(ask, f.fn);
    expect(got).toMatchObject({ kind: "approved", by: "Task Manager", guest: { id: "g-2", token: "t2", eventId: "ev1" } });
    expect(askLine(got, "Winamp")).toBe("Task Manager let you back in as Winamp.");
    expect(askLine({ kind: "denied", by: null }, "Winamp")).toMatch(/^A host said no/);
  });
  it("a network blip while waiting is still waiting", async () => {
    const broken = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(await pollAsk({ eventId: "ev1", request: "r", name: "W" }, broken)).toEqual({ kind: "pending" });
  });
});

describe("linking from a signed-in phone", () => {
  it("reads every answer", () => {
    expect(badgeLinkOf(200, { ok: true, badge: 3 })).toEqual({ kind: "linked", n: 3 });
    expect(badgeLinkOf(200, { ok: true, badge: 3, already: true })).toEqual({ kind: "already", n: 3 });
    expect(badgeLinkOf(409, { holder: "g-9", name: "Winamp" })).toEqual({ kind: "theirs", id: "g-9", name: "Winamp" });
    expect(badgeLinkOf(404, {})).toEqual({ kind: "unknown" });
    expect(badgeLinkOf(500, {})).toBeNull();
    expect(badgeLinkText({ kind: "theirs", id: "g-9", name: "W" })).toBeNull();
    expect(badgeLinkText({ kind: "linked", n: 1 })).toMatch(/Badge linked/);
  });
});

describe("scanners", () => {
  it("a guest's in-app scan of a badge is a badge, not the join code", () => {
    expect(guestScan(LINK, "g-1")).toEqual({ kind: "badge", badge: CODE });
  });
  it("a booth reads a badge as a pass by its code", () => {
    expect(parseScan(LINK)).toEqual({ kind: "guest", id: CODE, badge: true });
    expect(parseScan("https://party.example/?code=EVT1")).toMatchObject({ kind: "wall" });
  });
  it("a host's row says how long ago and to check", () => {
    expect(rejoinDetail({ at: 0 }, 150_000)).toMatch(/^Asked 2 min ago/);
    expect(rejoinDetail({ at: 0 }, 1_000)).toMatch(/^Asked just now/);
  });
});

describe("wave 59: one holder", () => {
  const held = (extra: Record<string, unknown>) => () => ({ status: 409, body: { error: "that is signed in on another phone", held: true, ...extra } });

  it("a held badge throws what's printed on it, never a sign-in", async () => {
    const f = fakeFetch({ ...resolve, "/e/ev1/api/guest/enter": held({ ref: "B012" }) });
    const e = await enterBy("EVT1", { badge: CODE }, f.fn).catch((x: unknown) => x);
    expect(heldOf(e)).toEqual({ name: null, ref: "B012" });
    expect((e as Error).message).toBe("Badge B012 is already signed in on a phone.");
    // Closed doors stay their own sentence.
    const shut = fakeFetch({ ...resolve, "/e/ev1/api/guest/enter": () => ({ status: 409, body: { error: "doors are closed" } }) });
    const c = await enterBy("EVT1", { badge: CODE }, shut.fn).catch((x: unknown) => x);
    expect(heldOf(c)).toBeNull();
    expect((c as Error).message).toMatch(/doors/);
    expect(heldOf(new Error("x"))).toBeNull();
  });

  it("a held staff badge throws its part's name", async () => {
    const f = fakeFetch({ ...resolve, "/e/ev1/api/prime/login": held({ name: "Clippy", error: "Clippy is already taken by another performer" }) });
    const e = await enterPart("EVT1", "p1", f.fn).catch((x: unknown) => x);
    expect(heldOf(e)).toEqual({ name: "Clippy", ref: null });
    expect((e as Error).message).toBe("Clippy is already signed in on a phone.");
  });

  it("the phone's own token goes with a re-scan", async () => {
    const f = fakeFetch({ ...resolve, "/e/ev1/api/guest/enter": () => ({ status: 200, body: { ok: true, resumed: true, id: "g-1", name: "W", token: "t1" } }), "/e/ev1/api/prime/login": () => ({ status: 200, body: { token: "pt", character: "Clippy" } }) });
    await enterBy("EVT1", { badge: CODE }, f.fn, "t1");
    expect(f.calls[1]!.body).toEqual({ passcode: "EVT1", badge: CODE, token: "t1" });
    await enterPart("EVT1", "p1", f.fn, "pt");
    expect(f.calls[3]!.body).toEqual({ passcode: "EVT1", part: "p1", token: "pt" });
  });

  it("asks for a refused card, naming only what's printed on it", async () => {
    const f = fakeFetch({ ...resolve, "/e/ev1/api/guest/rejoin": () => ({ status: 200, body: { ok: true, request: "r9", name: "" } }) });
    const ask = await askHeld({ code: "EVT1", by: { badge: CODE }, name: null, ref: "B012" }, f.fn);
    expect(ask).toEqual({ eventId: "ev1", title: "The Party", request: "r9", name: "your program" });
    expect(f.calls[1]!.body).toEqual({ passcode: "EVT1", badge: CODE });
    expect(askLine({ kind: "pending" }, ask.name)).toMatch(/back in as your program/);
  });

  it("an approved ask for a part comes back a booth", async () => {
    const f = fakeFetch({ "/e/ev1/api/guest/rejoin/poll": () => ({ status: 200, body: { state: "approved", part: true, character: "Task Manager", name: "Task Manager", token: "pt", admin: false, host: true, by: "Task Manager" } }) });
    const got = await pollAsk({ eventId: "ev1", title: "The Party", request: "r", name: "Task Manager" }, f.fn);
    expect(got).toEqual({ kind: "booth", by: "Task Manager", booth: { token: "pt", character: "Task Manager", admin: false, host: true, eventId: "ev1", title: "The Party" } });
    expect(askLine(got, "Task Manager")).toBe("Task Manager let you back in as Task Manager.");
  });

  it("the refused line names the card, and a bare one names nothing", () => {
    expect(heldLine({ name: "Microsoft Excel", ref: "F01" })).toBe("Microsoft Excel is already signed in on a phone.");
    expect(heldLine({ name: null, ref: null })).toBe("That badge is already signed in on a phone.");
  });

  it("lets go of a session a phone stops being, and never throws", async () => {
    const seen: Array<[string, unknown]> = [];
    const fn = (async (path: string, init?: { headers?: Record<string, string> }) => {
      seen.push([path, init?.headers?.["x-loom-token"]]);
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    letGo({ token: "t1", eventId: "ev 1" }, "guest", fn);
    letGo({ token: "t2", eventId: "ev1" }, "prime", fn);
    letGo(null, "guest", fn);
    letGo({ token: 3 }, "guest", fn);
    expect(seen).toEqual([
      ["/e/ev%201/api/guest/logout", "t1"],
      ["/e/ev1/api/prime/logout", "t2"],
    ]);
  });
});
