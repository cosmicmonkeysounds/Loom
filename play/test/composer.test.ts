//! T5-01: a typed message the server refuses (slow mode, paused doors, a
//! room you can't post in) stays in the composer and the guest is told why.

import { describe, expect, it } from "vitest";

import { sendFromComposer } from "../src/chat.tsx";
import { ApiError } from "../src/client.ts";
import { sayRefusalText } from "../src/session.ts";

describe("the composer's send", () => {
  it("nothing to send: no call", () => {
    let called = false;
    expect(sendFromComposer("   ", () => (called = true))).toBeNull();
    expect(called).toBe(false);
  });

  it("clears once the server takes it, keeps the text after a refusal", async () => {
    const sent: string[] = [];
    expect(await sendFromComposer("  hi there ", (t) => sent.push(t))).toBe(true);
    expect(sent).toEqual(["hi there"]);
    expect(await sendFromComposer("hello", () => Promise.resolve({ ok: true }))).toBe(true);
    expect(await sendFromComposer("again", () => Promise.reject(new ApiError("slow mode — wait 4s", 429)))).toBe(false);
    expect(
      await sendFromComposer("boom", () => {
        throw new Error("sync");
      }),
    ).toBe(false);
  });
});

describe("why a line wasn't sent", () => {
  it("slow mode names the wait and says the text is kept", () => {
    const t = sayRefusalText(new ApiError("slow mode — wait 4s", 429));
    expect(t).toContain("slow mode — wait 4s");
    expect(t).toContain("still in the box");
  });

  it("paused doors say the show is paused", () => {
    expect(sayRefusalText(new ApiError("doors are closed", 409))).toContain("paused");
  });

  it("any other refusal shows the server's reason", () => {
    expect(sayRefusalText(new ApiError("you can't post here", 403))).toBe("⛔ Not sent: you can't post here");
    expect(sayRefusalText(new TypeError("Failed to fetch"))).toContain("connection");
  });

  it("a dead session explains itself elsewhere: no banner", () => {
    expect(sayRefusalText(new ApiError("unknown guest", 404))).toBeNull();
    expect(sayRefusalText(new ApiError("unauthorized", 401))).toBeNull();
    expect(sayRefusalText(new ApiError("unknown event", 404))).toBeNull();
    expect(sayRefusalText(new ApiError("sign in first", 403))).toBeNull();
  });
});
