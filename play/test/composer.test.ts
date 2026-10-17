//! T5-01: a typed message the server refuses (slow mode, paused doors, a
//! room you can't post in) stays in the composer and the guest is told why.

import { describe, expect, it, vi } from "vitest";

import { sendFromComposer } from "../src/chat.tsx";
import { ApiError, RequestTimeout, withTimeout } from "../src/client.ts";
import { SAY_TIMEOUT_MS, sayRefusalText } from "../src/session.ts";

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

describe("a send the server never answers", () => {
  it("gives the button back after the timeout and keeps the text", async () => {
    vi.useFakeTimers();
    try {
      const hung = new Promise<never>(() => {});
      const cleared = sendFromComposer("still there?", () => withTimeout(hung, SAY_TIMEOUT_MS));
      await vi.advanceTimersByTimeAsync(SAY_TIMEOUT_MS);
      expect(await cleared).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an answer in time passes through, an error keeps its own reason", async () => {
    expect(await withTimeout(Promise.resolve(7), 1000)).toBe(7);
    await expect(withTimeout(Promise.reject(new ApiError("doors are closed", 409)), 1000)).rejects.toBeInstanceOf(ApiError);
  });

  it("says it may have landed", () => {
    const t = sayRefusalText(new RequestTimeout(SAY_TIMEOUT_MS));
    expect(t).toContain("connection");
    expect(t).toContain("send it again");
  });
});
