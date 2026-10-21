//! Wave 18 (integration): the new frame, the pop-outs and the big moments
//! work inside an editor Run → Players pane (`embed.tsx`, shadow roots):
//! their styles ride the one embedded stylesheet, sized against the pane;
//! nothing in the wave's new code drives the page's history or listens on
//! the whole document (one pane's key must never reach another); and the
//! focus checks read the pane's own shadow root.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scopeCss } from "../src/embed-css.ts";
import { focusedIn, typingIn } from "../src/ui/focus.ts";
import { readBundledCss } from "./css.ts";

const SRC = join(__dirname, "../src");
const scoped = scopeCss(readBundledCss());

/** Every .ts / .tsx file under a src folder (or the one file). */
function files(rel: string): string[] {
  const p = join(SRC, rel);
  if (/\.tsx?$/u.test(rel)) return [p];
  return (readdirSync(p, { recursive: true }) as string[]).filter((f) => /\.tsx?$/u.test(f)).map((f) => join(p, f));
}
/** Code only: comments carry the words this test forbids, to say why. */
const code = (f: string) => readFileSync(f, "utf8").replace(/^\s*(\/\/|\*|\/\*).*$/gmu, "");

/** The wave's new or rebuilt parts. */
const WAVE_18 = ["moments", "sides", "guest", "booth/wanted", "booth/pick", "booth/popouts", "booth/confront.tsx", "booth/door.tsx", "booth/cue-bar.tsx", "booth/waiting.tsx", "host/caller.ts", "host/fire-anyway.tsx", "ui/focus.ts", "ui/progress.tsx", "pass-qr.tsx"];

describe("the embedded stylesheet carries the wave 18 surfaces, pane-sized", () => {
  it("the big moment, the pop-outs, Notifications, the doors and the Me sheet are in it", () => {
    for (const sel of [".moments-big", ".popout-host", ".popout-strip", ".moments-notif", ".moments-bell", ".doors", ".me-sheet"]) expect(scoped, sel).toContain(sel);
  });
  it("a fixed layer is held by the pane (the frame contains it) and sized in container units", () => {
    expect(scoped).toMatch(/\.play-frame \{[^}]*contain: strict/u);
    expect(scoped).not.toMatch(/\d[dsl]?(vh|vw)\b/u);
    expect(scoped).toMatch(/\.popout-host > \.popout \{[^}]*max-height: 70cqh/u);
  });
});

describe("no page-level reach in the wave's new code", () => {
  const all = WAVE_18.flatMap(files);
  it("finds the files it checks", () => {
    expect(all.length).toBeGreaterThan(30);
  });
  it("never the history API", () => {
    for (const f of all) expect(code(f), f).not.toMatch(/history\.(push|replace)State|history\.back|popstate/u);
  });
  it("never a document- or window-wide listener (keys go through the host's key target)", () => {
    for (const f of all) expect(code(f), f).not.toMatch(/(document|window)\.addEventListener/u);
  });
  it("the guest's push links touch the URL only when the app owns the page", () => {
    const s = readFileSync(join(SRC, "session/guest.ts"), "utf8");
    for (const m of s.matchAll(/window\.history\.replaceState/gu)) {
      const before = s.slice(Math.max(0, m.index! - 400), m.index);
      expect(before, "a replaceState with no ownsPage guard").toMatch(/ownsPage/u);
    }
  });
});

describe("focus in a shadow root (focus.ts)", () => {
  const field = { tagName: "INPUT", isContentEditable: false };
  const pane = { activeElement: field };
  const inPane = { getRootNode: () => pane } as unknown as Node;
  it("reads the pane's own active element, not the page's", () => {
    const saved = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = { activeElement: { tagName: "DIV", shadowRoot: pane } };
    try {
      expect(focusedIn(inPane)).toBe(field);
      expect(typingIn(inPane)).toBe(true);
      // No node: down through the open shadow root to the field.
      expect(focusedIn()).toBe(field);
    } finally {
      (globalThis as { document?: unknown }).document = saved;
    }
  });
});
