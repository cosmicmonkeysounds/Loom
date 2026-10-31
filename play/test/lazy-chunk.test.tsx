//! A lazy part that will not load never leaves a white page (review of the
//! fguest fix round): one retry after a short wait, then the boundary's
//! fallback — Reload for a whole app, Try again for the Help sheet.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChunkBoundary, ChunkDown, ChunkFailed, chunkOrDown, retryImport } from "../src/lazy-chunk.tsx";

describe("retryImport", () => {
  it("a failed fetch is tried once more after the wait", async () => {
    let n = 0;
    const waits: number[] = [];
    const load = () => (++n === 1 ? Promise.reject(new TypeError("Failed to fetch dynamically imported module")) : Promise.resolve("ok"));
    await expect(retryImport(load, 1500, async (ms) => void waits.push(ms))()).resolves.toBe("ok");
    expect([n, waits]).toEqual([2, [1500]]);
  });
  it("two failures reject (the boundary takes over)", async () => {
    let n = 0;
    const load = () => (n++, Promise.reject(new Error("gone")));
    await expect(retryImport(load, 0, async () => {})()).rejects.toThrow("gone");
    expect(n).toBe(2);
  });
});

describe("chunkOrDown", () => {
  const ASSET = "Failed to fetch dynamically imported module: https://party.example/assets/rejoin-calls-abc123.js";

  it("is retryImport while the chunk comes", async () => {
    let n = 0;
    const load = () => (++n === 1 ? Promise.reject(new TypeError(ASSET)) : Promise.resolve("ok"));
    await expect(chunkOrDown(load, 0, async () => {})()).resolves.toBe("ok");
    expect(n).toBe(2);
  });
  it("two failures throw ChunkDown, and the browser's words and the asset's URL go with them", async () => {
    const down = await chunkOrDown(() => Promise.reject(new TypeError(ASSET)), 0, async () => {})().catch((e: unknown) => e);
    expect(down).toBeInstanceOf(ChunkDown);
    expect(String((down as Error).message)).not.toMatch(/assets|https?:|Failed to fetch/u);
  });
  it("the page's three hand-loaded calls all use it, and all say so with Reload", () => {
    const ui = readFileSync(new URL("../src/ui.tsx", import.meta.url), "utf8");
    expect(ui).toContain('const loadRejoinCalls = chunkOrDown(() => import("./rejoin-calls.ts"));');
    expect(ui.match(/e instanceof ChunkDown\) setChunkDown\(true\)/gu)).toHaveLength(3);
    expect(ui).toMatch(/if \(chunkDown\) return <ChunkFailed what="This page"/u);
  });
});

describe("ChunkBoundary", () => {
  it("renders its children, and its fallback once a child throws", () => {
    const ok = renderToStaticMarkup(createElement(ChunkBoundary, { fallback: () => "fallback" }, "the booth"));
    expect(ok).toBe("the booth");
    const b = new ChunkBoundary({ fallback: (retry: () => void) => (typeof retry === "function" ? "fallback" : "?"), children: null });
    b.state = { ...b.state, ...ChunkBoundary.getDerivedStateFromError() };
    expect(b.render()).toBe("fallback");
  });
  it("the full-page fallback names what failed and offers Reload", () => {
    const html = renderToStaticMarkup(createElement(ChunkFailed, { what: "The booth", onBack: () => {} }));
    expect(html).toContain("The booth didn&#x27;t load");
    expect(html).toContain(">Reload<");
    expect(html).toContain("Back");
  });
});
