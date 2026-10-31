//! Wave 58: Play goes fullscreen on a tap wherever the browser allows it, and
//! never spends a tap a button needed.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { canRequest, isFull, shouldRequest, startFullscreen } from "../src/fullscreen.ts";
import type { FullscreenEnv } from "../src/fullscreen.ts";

type Listener = (event: { pointerType?: string }) => void;

/** A browser with the standard API, or with only iPad's prefix, or none. */
function fakeEnv(api: "standard" | "webkit" | "none" = "standard") {
  const listeners = new Map<string, Listener[]>();
  const calls: unknown[] = [];
  const doc: FullscreenEnv["document"] & { fullscreenElement?: unknown } = {
    documentElement:
      api === "standard"
        ? { requestFullscreen: (options) => void calls.push(options) }
        : api === "webkit"
          ? { webkitRequestFullscreen: () => void calls.push("webkit") }
          : {},
    fullscreenEnabled: api === "standard" ? true : undefined,
    webkitFullscreenEnabled: api === "webkit" ? true : undefined,
    addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    removeEventListener: (type, listener) =>
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((l) => l !== listener),
      ),
  };
  const env: FullscreenEnv = { document: doc, navigator: {}, matchMedia: () => ({ matches: false }) };
  const fire = (type: string, event: { pointerType?: string } = {}) => (listeners.get(type) ?? []).forEach((l) => l(event));
  const tap = (pointerType: string) => {
    fire("pointerdown", { pointerType });
    fire("click");
  };
  return { env, doc, calls, tap, listeners };
}

describe("wave 58: fullscreen", () => {
  it("a phone's first tap asks, with the browser's bars hidden", () => {
    const { env, calls, tap } = fakeEnv();
    startFullscreen(env);
    tap("touch");
    expect(calls).toEqual([{ navigationUI: "hide" }]);
  });

  it("an iPad asks through its prefix", () => {
    const { env, calls, tap } = fakeEnv("webkit");
    startFullscreen(env);
    tap("touch");
    expect(calls).toEqual(["webkit"]);
  });

  it("an iPhone's Safari has nothing to ask, and listens to nothing", () => {
    const { env, calls, listeners } = fakeEnv("none");
    expect(canRequest(env.document)).toBe(false);
    startFullscreen(env);
    expect(listeners.size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("a framed page where fullscreen is refused never asks", () => {
    const { env, doc, calls, tap } = fakeEnv();
    doc.fullscreenEnabled = false;
    startFullscreen(env);
    tap("touch");
    expect(calls).toEqual([]);
  });

  it("does nothing while already full, and an installed app already is", () => {
    const { env, doc, calls, tap } = fakeEnv();
    startFullscreen(env);
    doc.fullscreenElement = {};
    tap("touch");
    expect(calls).toEqual([]);
    doc.fullscreenElement = null;
    expect(isFull({ ...env, navigator: { standalone: true } })).toBe(true);
    expect(isFull({ ...env, matchMedia: (q) => ({ matches: q.includes("standalone") }) })).toBe(true);
    expect(isFull({ ...env, matchMedia: (q) => ({ matches: q.includes("fullscreen") }) })).toBe(true);
    expect(isFull(env)).toBe(false);
  });

  it("a phone that dropped out goes back on its next tap", () => {
    const { env, doc, calls, tap } = fakeEnv();
    startFullscreen(env);
    tap("touch");
    doc.fullscreenElement = {};
    tap("touch");
    doc.fullscreenElement = null;
    tap("touch");
    expect(calls).toHaveLength(2);
  });

  it("a mouse is asked once: Esc stays Esc", () => {
    const { env, calls, tap } = fakeEnv();
    startFullscreen(env);
    tap("mouse");
    tap("mouse");
    expect(calls).toHaveLength(1);
  });

  it("leaves a tap a button already spent, and the next tap asks", () => {
    const { env, calls, tap } = fakeEnv();
    env.navigator = { userActivation: { isActive: false } };
    startFullscreen(env);
    tap("touch");
    expect(calls).toEqual([]);
    env.navigator = { userActivation: { isActive: true } };
    tap("touch");
    expect(calls).toHaveLength(1);
  });

  it("a keyboard press never asks", () => {
    const { env } = fakeEnv();
    expect(shouldRequest(env, "", false)).toBe(false);
  });

  it("a refused request stays quiet", async () => {
    const { env, doc, tap } = fakeEnv();
    doc.documentElement.requestFullscreen = () => Promise.reject(new Error("no"));
    startFullscreen(env);
    expect(() => tap("touch")).not.toThrow();
    await Promise.resolve();
  });

  it("the listeners come off", () => {
    const { env, calls, tap } = fakeEnv();
    startFullscreen(env)();
    tap("touch");
    expect(calls).toEqual([]);
  });

  it("an installed app opens fullscreen where the platform offers it", () => {
    const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8")) as Record<string, unknown>;
    expect(manifest["display"]).toBe("standalone");
    expect(manifest["display_override"]).toEqual(["fullscreen", "standalone"]);
  });

  it("only the page's own entry starts it, so an embedded player never does", () => {
    const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
    expect(main).toMatch(/startFullscreen\(/u);
  });
});
