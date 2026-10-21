import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNightEnded } from "../src/api.ts";
import type { ReinstallConfig } from "../src/config.ts";

const config: ReinstallConfig = { eventId: "ev 1", title: "T", token: "tok", name: "Tent", role: "both", camera: "user", arrowsTurn: true };

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

// S1: after an ending the tablet reads the party favour off the lean screen
// state — polled with no terminal name, so it never shows on Run → Terminals.
describe("fetchNightEnded", () => {
  it("reads night.ended off the screen state with the device's token and no name", async () => {
    const fetch = answer(200, { night: { ended: true } });
    expect(await fetchNightEnded(config)).toBe(true);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/e/ev%201/api/screen/state");
    expect(url).not.toMatch(/name=/u);
    expect((init?.headers as Record<string, string>)["x-loom-token"]).toBe("tok");
  });

  it("false before the end; null when the server can't say", async () => {
    answer(200, { night: { ended: false } });
    expect(await fetchNightEnded(config)).toBe(false);
    answer(200, { night: { ended: null } });
    expect(await fetchNightEnded(config)).toBeNull();
    answer(200, {});
    expect(await fetchNightEnded(config)).toBeNull();
    answer(403, { error: "moderators only" });
    expect(await fetchNightEnded(config)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await fetchNightEnded(config)).toBeNull();
  });
});
