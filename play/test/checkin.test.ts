import { describe, expect, it } from "vitest";

import { checkinFromSearch, withoutCheckin } from "../src/checkin.ts";

describe("room check-in deep link", () => {
  it("reads the room slug off a sign's link and strips it for reload safety", () => {
    expect(checkinFromSearch("?code=EVT1&checkin=the-cache")).toBe("the-cache");
    expect(checkinFromSearch("?code=EVT1&checkin=The%20Cache")).toBe("The Cache");
    expect(checkinFromSearch("?code=EVT1")).toBeNull();
    expect(checkinFromSearch("?checkin=")).toBeNull();
    expect(withoutCheckin("?code=EVT1&checkin=the-cache")).toBe("?code=EVT1");
    expect(withoutCheckin("?checkin=the-cache")).toBe("");
  });
});
