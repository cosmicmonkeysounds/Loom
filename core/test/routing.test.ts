//! `pickJoinBase` — the base URL behind every guest-join QR, the Run page's
//! join link (`events-api.ts` `joinUrl`) and `/api/mod/codes`. On the VPS the
//! container's own interfaces are Docker-internal, so `LOOM_BASE_URL` must
//! win or a phone on cellular scans a QR it can't reach (K-01).

import { describe, expect, it } from "vitest";

import { pickJoinBase } from "../server/routing.ts";

const LAN = ["http://localhost:7000", "http://172.18.0.3:7000", "http://192.168.1.20:7000"];

describe("pickJoinBase", () => {
  it("returns LOOM_BASE_URL when it is set", () => {
    expect(pickJoinBase("https://app.mapsandducks.com", LAN)).toBe("https://app.mapsandducks.com");
  });

  it("drops a trailing slash and whitespace so `${base}/?code=` stays one slash", () => {
    expect(pickJoinBase(" https://app.mapsandducks.com/ ", LAN)).toBe("https://app.mapsandducks.com");
  });

  it("falls back to the first non-localhost interface when unset or blank", () => {
    expect(pickJoinBase(undefined, LAN)).toBe("http://172.18.0.3:7000");
    expect(pickJoinBase("", LAN)).toBe("http://172.18.0.3:7000");
    expect(pickJoinBase("   ", LAN)).toBe("http://172.18.0.3:7000");
  });

  it("uses localhost only when it is the sole address", () => {
    expect(pickJoinBase(undefined, ["http://localhost:7000"])).toBe("http://localhost:7000");
  });
});
