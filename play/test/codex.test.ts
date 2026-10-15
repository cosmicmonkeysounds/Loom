import { describe, expect, it } from "vitest";

import { pmChannelId, pmOtherParty, unlockFromSearch, withoutUnlock } from "../src/codex.ts";

describe("private threads", () => {
  it("one id whoever opens it, and the other party from my side", () => {
    expect(pmChannelId("g-b", "g-a")).toBe("pm:g-a:g-b");
    expect(pmChannelId("g-a", "g-b")).toBe("pm:g-a:g-b");
    expect(pmOtherParty("pm:g-a:g-b", "g-a")).toBe("g-b");
    expect(pmOtherParty("pm:g-a:g-b", "g-b")).toBe("g-a");
    expect(pmOtherParty("pm:g-a:g-b", "g-c")).toBeNull();
    expect(pmOtherParty("dm:Trabolta", "g-a")).toBeNull();
  });
});

describe("unlock deep link", () => {
  it("reads the code off a scanned QR's link and can strip it for reload safety", () => {
    expect(unlockFromSearch("?code=EVT1&unlock=SANDY-1997")).toBe("SANDY-1997");
    expect(unlockFromSearch("?code=EVT1")).toBeNull();
    expect(unlockFromSearch("?unlock=")).toBeNull();
    expect(withoutUnlock("?code=EVT1&unlock=SANDY-1997")).toBe("?code=EVT1");
    expect(withoutUnlock("?unlock=X")).toBe("");
  });
});
