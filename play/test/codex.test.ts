import { describe, expect, it } from "vitest";

import { ApiError } from "../src/client.ts";
import { REDEEM_THROTTLED, pmChannelId, pmOtherParty, redeemErrorText, shareErrorText, unlockFromSearch, withoutUnlock } from "../src/codex.ts";

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

describe("the Codex box on a failed redeem (K-11)", () => {
  it("says to wait on a 429 and stays quiet otherwise", () => {
    expect(redeemErrorText(new ApiError("slow down", 429))).toBe(REDEEM_THROTTLED);
    expect(REDEEM_THROTTLED).toMatch(/Too many tries/u);
    expect(redeemErrorText(new ApiError("nope", 400))).toBeNull();
    expect(redeemErrorText(new Error("offline"))).toBeNull();
    expect(redeemErrorText(null)).toBeNull();
  });
});

describe("a refused Share… (T5-05)", () => {
  it("shows the server's reason", () => {
    expect(shareErrorText(new ApiError("they won't take lore about someone else", 403))).toBe("⛔ Not shared: they won't take lore about someone else");
    expect(shareErrorText(new ApiError("you're restricted", 403))).toContain("restricted");
    expect(shareErrorText(new TypeError("Failed to fetch"))).toContain("connection");
  });

  it("a dead session says nothing here (the join screen explains)", () => {
    expect(shareErrorText(new ApiError("unknown guest", 404))).toBeNull();
    expect(shareErrorText(new ApiError("unknown event", 404))).toBeNull();
    expect(shareErrorText(new ApiError("sign in first", 403))).toBeNull();
  });
});
