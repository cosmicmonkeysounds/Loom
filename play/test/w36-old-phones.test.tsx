//! Wave 36: older iPhones and Android phones. Profile pictures survive a
//! bad moment (a failed load is retried, React owns the `<img>`), and the
//! page never zooms in for good (no double-tap zoom, no field under 16px),
//! which on an iPhone left the app panning sideways.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvatarsContext, avatarLookup, PICTURE_RETRY_MS, PICTURE_START, pictureFailed, pictureGaveUp, pictureRetry, pictureUrl } from "../src/avatars.ts";
import { PictureGrid } from "../src/picture-pick.tsx";
import { PersonAvatar } from "../src/ui/primitives.tsx";
import { readBundledCss } from "./css.ts";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

describe("a picture's tries", () => {
  it("loads the plain URL first, waits after a failure, then retries with ?try=n", () => {
    let t = PICTURE_START;
    expect(pictureUrl("/e/x/api/avatar/k", t)).toBe("/e/x/api/avatar/k");
    t = pictureFailed(t);
    expect(t).toEqual({ fails: 1, waiting: true });
    expect(pictureUrl("/e/x/api/avatar/k", t)).toBeNull(); // the initials while it waits
    t = pictureRetry(t);
    expect(pictureUrl("/e/x/api/avatar/k", t)).toBe("/e/x/api/avatar/k?try=1");
    expect(pictureUrl("/a?b=1", t)).toBe("/a?b=1&try=1");
  });

  it("gives up after the last retry, and only then", () => {
    let t = PICTURE_START;
    for (let n = 0; n < PICTURE_RETRY_MS.length; n++) {
      t = pictureRetry(pictureFailed(t));
      expect(pictureGaveUp(t)).toBe(false);
      expect(pictureUrl("/p", t)).toBe(`/p?try=${n + 1}`);
    }
    t = pictureFailed(t);
    expect(t.waiting).toBe(false);
    expect(pictureGaveUp(t)).toBe(true);
    expect(pictureUrl("/p", t)).toBeNull();
  });

  it("waits longer each time", () => {
    expect(PICTURE_RETRY_MS.length).toBeGreaterThan(0);
    for (let i = 1; i < PICTURE_RETRY_MS.length; i++) expect(PICTURE_RETRY_MS[i]!).toBeGreaterThan(PICTURE_RETRY_MS[i - 1]!);
  });
});

describe("the avatar tile", () => {
  const lookup = avatarLookup("evt", { winamp: "abc" });
  const tile = (name: string) => renderToStaticMarkup(createElement(AvatarsContext.Provider, { value: lookup }, createElement(PersonAvatar, { name })));

  it("draws the picture over the initials, eagerly", () => {
    const out = tile("Winamp");
    expect(out).toContain('class="pavatar md  pic"');
    expect(out).toContain("W<img");
    expect(out).toContain('src="/e/evt/api/avatar/abc"');
    expect(out).not.toContain("loading=");
  });

  it("is just the initials with no picture", () => {
    expect(tile("Notepad")).not.toContain("<img");
  });

  it("the picker's options load eagerly too", () => {
    const out = renderToStaticMarkup(createElement(PictureGrid, { eventId: "evt", options: [{ key: "k1", file: "Logo.png" }], selected: "k1", onSelect: () => {} }));
    expect(out).toContain('src="/e/evt/api/avatar/k1"');
    expect(out).toContain('aria-checked="true"');
    expect(out).not.toContain("loading=");
  });

  it("never pulls a node out from under React", () => {
    for (const f of ["ui/primitives.tsx", "picture-pick.tsx"]) {
      expect(src(f), f).not.toMatch(/currentTarget\.remove\(\)/u);
      expect(src(f), f).not.toMatch(/style\.display\s*=/u);
    }
  });
});

describe("the page never stays zoomed in", () => {
  const css = readBundledCss().replace(/\/\*[\s\S]*?\*\//gu, "");

  it("no double-tap zoom, no text inflation, no sideways page", () => {
    const html = /(^|\})\s*html \{([^}]*)\}/u.exec(css)?.[2] ?? "";
    expect(html).toMatch(/touch-action: manipulation;/u);
    expect(html).toMatch(/-webkit-text-size-adjust: 100%;/u);
    expect(html).toMatch(/overflow-x: hidden;/u);
  });

  it("every text field is 16px at least (iOS zooms into a smaller one)", () => {
    expect(css).toMatch(/input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="range"\]\), textarea, select \{ font-size: 16px !important; \}/u);
    // No field asks for more than 16px, so the floor never shrinks one.
    for (const rule of css.split("}")) {
      const [sel = "", body = ""] = rule.split("{");
      if (!/\b(input|textarea|select)\b/u.test(sel)) continue;
      for (const m of body.matchAll(/font(?:-size)?:[^;]*?(\d+)px/gu)) expect(Number(m[1]), sel.trim()).toBeLessThanOrEqual(16);
    }
  });

  it("the viewport keeps pinch zoom", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html).not.toMatch(/user-scalable|maximum-scale/u);
  });
});
