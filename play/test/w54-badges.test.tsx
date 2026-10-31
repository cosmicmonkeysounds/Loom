// Wave 54: one QR per person. What each printed code means to a booth, to a
// guest's own 📷 and to a phone's camera; the sign that presses a button.

import { describe, expect, it } from "vitest";
import { actFromSearch, withoutAct } from "../src/act-link.ts";
import { initialRole, roleForBrand } from "../src/app-role.ts";
import { guestScan, SCAN_STAFF } from "../src/guest-scan-sheet.tsx";
import { landingLink, rejoinLine } from "../src/guest-scan.tsx";
import { memoryStore } from "../src/host.ts";
import { enterBy } from "../src/rejoin-calls.ts";
import { cardFromSearch, cardPlan, rememberBadge, storedBadge, withoutCard } from "../src/rejoin.ts";
import { parseScan, scanProblem, STAFF_BADGE } from "../src/scan.ts";

const BASE = "https://party.example/?code=EVT1";
const BADGE = "k3m9q2xz";
const INVITED = `${BASE}&claim=abcde12345&badge=${BADGE}`;
const STAFF = `${BASE}&part=fghjk67890`;
const SIGN = `${BASE}&act=go%20to%20the%20bathroom`;

describe("a booth's scanner", () => {
  it("reads an invited badge as the guest's pass", () => {
    expect(parseScan(INVITED)).toEqual({ kind: "guest", id: BADGE, badge: true });
  });
  it("says what a staff badge is, and never reads it as a pass", () => {
    const hit = parseScan(STAFF);
    expect(hit).toEqual({ kind: "staff" });
    expect(scanProblem(hit)).toBe(STAFF_BADGE);
  });
  it("says what a sign is", () => {
    expect(scanProblem(parseScan(SIGN))).toMatch(/sign/u);
  });
});

describe("a guest's 📷", () => {
  it("presses the button a sign names", () => {
    expect(guestScan(SIGN)).toEqual({ kind: "act", name: "go to the bathroom" });
  });
  it("says a staff badge isn't theirs", () => {
    expect(guestScan(STAFF)).toEqual({ kind: "note", text: SCAN_STAFF });
  });
  it("reads an invited badge as a badge, not an invitation", () => {
    expect(guestScan(INVITED)).toEqual({ kind: "badge", badge: BADGE });
  });
});

describe("a phone's camera", () => {
  const search = (url: string) => new URL(url).search;

  it("a staff badge on the guest code opens a booth, and the code is left in the address", () => {
    const card = cardFromSearch(search(STAFF))!;
    expect(card).toEqual({ code: "EVT1", part: "fghjk67890" });
    expect(cardPlan(card, null, false)).toEqual({ kind: "part", code: "EVT1", part: "fghjk67890", confirm: null });
    expect(withoutCard(search(STAFF))).toBe("?code=EVT1");
    // The guest code never pulls a signed-in booth back to the chooser.
    expect(roleForBrand("prime", "guest")).toBe("prime");
  });

  it("a staff badge never signs a guest's phone out without asking", () => {
    expect(cardPlan(cardFromSearch(search(STAFF)), "Calculator", false)).toMatchObject({ kind: "part", confirm: "Calculator" });
  });

  it("an invited badge keeps its claim through the entry", () => {
    expect(new URLSearchParams(withoutCard(search(INVITED))).get("claim")).toBe("abcde12345");
  });

  it("a sign opens the guest app, and a page with no session lands, never the picker", () => {
    expect(initialRole(search(SIGN), () => null)).toBe("guest");
    const link = landingLink(search(SIGN))!;
    expect(link).toEqual({ kind: "act" });
    expect(rejoinLine(link)).toMatch(/sign works/u);
  });

  it("a sign presses once: the link leaves the address", () => {
    expect(actFromSearch(search(SIGN))).toBe("go to the bathroom");
    expect(actFromSearch("?code=EVT1")).toBeNull();
    expect(actFromSearch("?code=EVT1&act=%20")).toBeNull();
    expect(withoutAct(search(SIGN))).toBe("?code=EVT1");
  });

  it("a badge kept beside a stale session still links at the join", () => {
    const store = memoryStore();
    rememberBadge(store, "evt1", BADGE);
    expect(storedBadge(store, "EVT1")).toBe(BADGE);
  });
});

describe("the entry", () => {
  it("sends the claim beside the badge", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (url === "/api/resolve-code") return new Response(JSON.stringify({ eventId: "e1" }), { status: 200 });
      seen.push(body);
      return new Response(JSON.stringify({ ok: true, resumed: false, badge: 601 }), { status: 200 });
    }) as typeof fetch;
    expect(await enterBy("EVT1", { badge: BADGE, claim: "abcde12345" }, fetchFn)).toMatchObject({ kind: "fresh", badge: 601 });
    expect(seen).toEqual([{ passcode: "EVT1", badge: BADGE, claim: "abcde12345" }]);
  });
});
