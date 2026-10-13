import { describe, expect, it } from "vitest";
import { mayReload, retryable } from "../src/retry.ts";

describe("retryable lazy loads", () => {
  it("shares a successful load", async () => {
    let calls = 0;
    const load = retryable(async () => ++calls);
    expect(await load()).toBe(1);
    expect(await load()).toBe(1);
    expect(calls).toBe(1);
  });

  it("forgets a failed load, so the next call tries again", async () => {
    let calls = 0;
    const load = retryable(async () => {
      calls += 1;
      if (calls === 1) throw new Error("chunk failed");
      return "ok";
    });
    await expect(load()).rejects.toThrow("chunk failed");
    expect(await load()).toBe("ok");
    expect(calls).toBe(2);
  });

  it("shares one in-flight load", async () => {
    let calls = 0;
    const load = retryable(() => new Promise<number>((r) => setTimeout(() => r(++calls), 1)));
    const [a, b] = await Promise.all([load(), load()]);
    expect([a, b, calls]).toEqual([1, 1, 1]);
  });

  it("reloads only a reachable page, and not in a loop", () => {
    expect(mayReload(false, null, 1000, 60_000)).toBe(false);
    expect(mayReload(true, null, 1000, 60_000)).toBe(true);
    expect(mayReload(true, 1000, 30_000, 60_000)).toBe(false);
    expect(mayReload(true, 1000, 61_000, 60_000)).toBe(true);
  });
});
