// Wave 59p (docs/loom-w59-photos-contract.md): the Desk's 📷 Terminal photos: the
// poll's outcome, the thumbnails' pace, the panel drawn off a fixture, and that a
// host's phone reaches only the panel, the thumbnail and the arm.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { PHOTO_CAP_BYTES, type PhotosView } from "../../core/src/photos.ts";
import { HOST_READS, HOST_ROUTES, hostCalls, type HostRoute } from "../src/host/api.ts";
import { NOT_PHOTOS, THUMB_EVERY_MS, armHint, photosPollOutcome, thumbDue } from "../src/host/photos-model.ts";
import { PhotoRow, PhotosHead } from "../src/host/photos.tsx";

function view(o: Partial<PhotosView> = {}): PhotosView {
  return { armed: false, since: null, now: 100_000, count: 0, bytes: 0, capBytes: PHOTO_CAP_BYTES, stopped: null, terminals: [], ...o };
}

describe("the poll", () => {
  it("reads a view, and says what's wrong", () => {
    expect(photosPollOutcome(200, view({ armed: true }))).toMatchObject({ kind: "view", view: { armed: true } });
    expect(photosPollOutcome(404, { error: "not found" })).toEqual({ kind: "error", message: NOT_PHOTOS });
    expect(photosPollOutcome(200, { something: "else" })).toEqual({ kind: "error", message: NOT_PHOTOS });
    expect(photosPollOutcome(403, {})).toEqual({ kind: "error", message: "This booth isn't a host any more." });
    expect(photosPollOutcome(500, { error: "boom" })).toEqual({ kind: "error", message: "boom" });
    expect(photosPollOutcome(502, null)).toEqual({ kind: "error", message: "HTTP 502" });
  });
});

describe("a thumbnail", () => {
  it("is fetched for a new still, at most every 30 s, and never with no still", () => {
    expect(thumbDue(null, null, 0)).toBe(false);
    expect(thumbDue(null, 5, 0)).toBe(true);
    const shown = { lastAt: 5, fetchedAt: 1000 };
    expect(thumbDue(shown, 5, 1_000_000)).toBe(false);
    expect(thumbDue(shown, 6, 1000 + THUMB_EVERY_MS - 1)).toBe(false);
    expect(thumbDue(shown, 6, 1000 + THUMB_EVERY_MS)).toBe(true);
  });
});

describe("the panel", () => {
  const head = (v: PhotosView, note: string | null = null) => renderToStaticMarkup(createElement(PhotosHead, { view: v, note, onArm: () => {} }));
  it("says SAFE, plainly, and what a press does", () => {
    const html = head(view({ count: 1, bytes: 2048 }));
    expect(html).toContain("SAFE");
    expect(html).toContain(armHint(false));
    expect(html).toContain("host-photos-state safe");
    expect(html).toContain("aria-pressed=\"false\"");
    expect(html).toContain("1 photo · 2 KB of 3.0 GB");
  });
  it("says ARMED, in the red class, and what a press does", () => {
    const html = head(view({ armed: true }));
    expect(html).toContain("ARMED");
    expect(html).toContain(armHint(true));
    expect(html).toContain("host-photos-state armed");
    expect(readFileSync(new URL("../src/host/photos.css", import.meta.url), "utf8")).toMatch(/\.host-photos-state\.armed \{ background: var\(--bad\)/u);
  });
  it("says when it has stopped, and why", () => {
    expect(head(view({ stopped: "cap" }))).toContain("3.0 GB cap");
    expect(head(view({ stopped: "disk" }))).toContain("nearly full");
    expect(head(view(), "Can't reach the server")).toContain("Can&#x27;t reach the server");
  });
  it("draws a terminal's count, last shot, thumbnail and note", () => {
    const t = { spot: "hall", name: "Hall", count: 12, bytes: 1, lastAt: 88_000, note: "No camera: it's off in ⚙, refused, or missing." };
    const html = renderToStaticMarkup(createElement(PhotoRow, { t, now: 100_000, thumb: "blob:x" }));
    expect(html).toContain("Hall");
    expect(html).toContain("12 · last 12 s ago");
    expect(html).toContain("src=\"blob:x\"");
    expect(html).toContain("No camera");
    expect(renderToStaticMarkup(createElement(PhotoRow, { t: { ...t, note: null, lastAt: null }, now: 100_000, thumb: null }))).toContain("last never");
  });
});

describe("a host's reach", () => {
  it("arms through the allowlist, and only that", async () => {
    const sent: Array<{ route: HostRoute; body: Record<string, unknown> }> = [];
    const calls = hostCalls(async (route, body) => (sent.push({ route, body }), {}), () => "Night.alerts");
    await calls.photosArm(true);
    await calls.photosArm(false);
    expect(sent).toEqual([
      { route: "/api/mod/photos/arm", body: { armed: true } },
      { route: "/api/mod/photos/arm", body: { armed: false } },
    ]);
    expect(HOST_READS).toContain("/api/mod/photos");
    expect(HOST_READS).toContain("/api/mod/photos/thumb");
    for (const never of ["/api/mod/photos/shot", "/api/mod/photos/delete", "/api/mod/photos/download"]) {
      expect(HOST_ROUTES as readonly string[]).not.toContain(never);
      expect(HOST_READS as readonly string[]).not.toContain(never);
    }
  });
});
