//! A lazy part that will not load never leaves a white page (review of the
//! fguest fix round): one retry after a short wait, then the boundary's
//! fallback — Reload for a whole app, Try again for the Help sheet.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChunkBoundary, ChunkFailed, retryImport } from "../src/lazy-chunk.tsx";

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
