//! Wave 41 (C2): the ✉️ email card — one optional address for Trabolta's
//! letter. `emailResult` is the same check as the server's `bad_email`; the
//! receipt never shows the address back.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EMAIL_MAX, WIDGETS, emailReceipt, emailResult, widgetInline, widgetLabel, type WidgetResult } from "../src/widgets.tsx";
import { settledLine } from "../src/stream/settled.ts";

const card = (params: Record<string, string> = {}) => ({ kind: "email", text: "Where should Trabolta write?", params });
const render = (answered: WidgetResult | null, onAnswer: ((r: WidgetResult) => void) | null = () => {}, params: Record<string, string> = {}) =>
  renderToStaticMarkup(createElement(() => WIDGETS["email"]!.render({ card: card(params), seed: 1, ...(onAnswer !== null ? { onAnswer } : {}), answered })));

describe("emailResult", () => {
  it("sends a trimmed address", () => {
    expect(emailResult("  guest@example.com ")).toEqual({ email: "guest@example.com" });
    expect(emailResult("first.last+tag@mail.example.co.uk")).toEqual({ email: "first.last+tag@mail.example.co.uk" });
  });

  it("refuses what isn't an address", () => {
    for (const bad of ["", "   ", "guest", "guest@", "@example.com", "guest@example", "guest@@example.com", "two words@example.com", "guest@exa mple.com", "<guest@example.com>", "a@b.com, c@d.com", "a@b.com;", '"q"@example.com'])
      expect(emailResult(bad), bad).toBeNull();
  });

  it("caps at 254 characters", () => {
    const at = "@example.com";
    const fits = "a".repeat(EMAIL_MAX - at.length) + at;
    expect(fits).toHaveLength(EMAIL_MAX);
    expect(emailResult(fits)).toEqual({ email: fits });
    expect(emailResult("a" + fits)).toBeNull();
  });
});

describe("the ✉️ email card", () => {
  it("is an answerable inline kind labelled ✉️ your inbox", () => {
    expect(WIDGETS["email"]?.answerable).toBe(true);
    expect(widgetInline("email")).toBe(true);
    expect(WIDGETS["email"]?.supersedes).toBeUndefined();
    expect(widgetLabel({ kind: "email", text: "", params: {} })).toBe("✉️ your inbox");
  });

  it("asks with an email field, a disabled Send until it's an address, and a quiet No thanks", () => {
    const html = render(null);
    expect(html).toContain('type="email"');
    expect(html).toMatch(/autocomplete="email"/iu);
    expect(html).toMatch(/inputmode="email"/iu);
    expect(html).toContain('class="email-text"');
    expect(html).toMatch(/<button[^>]*class="choice primary widget-go"[^>]*disabled=""[^>]*>Send<\/button>/u);
    expect(html).toMatch(/<button[^>]*class="link"[^>]*>No thanks<\/button>/u);
  });

  it("takes the story's button, skip and placeholder", () => {
    const html = render(null, () => {}, { button: "Write to me", skip: "Not tonight", placeholder: "you@example.com" });
    expect(html).toContain(">Write to me</button>");
    expect(html).toContain(">Not tonight</button>");
    expect(html).toContain('placeholder="you@example.com"');
  });

  it("reads ✔ on file / ✖ no thanks once answered, and never the address", () => {
    expect(emailReceipt({ given: true })).toBe("✔ on file");
    expect(emailReceipt({ email: "guest@example.com" })).toBe("✔ on file");
    expect(emailReceipt({ skipped: true })).toBe("✖ no thanks");
    expect(emailReceipt({})).toBe("✔ answered");
    const given = render({ email: "guest@example.com" });
    expect(given).toContain("✔ on file");
    expect(given).not.toContain("guest@example.com");
    expect(given).not.toContain("<input");
    expect(render({ skipped: true })).toContain("✖ no thanks");
    expect(render({ given: true })).toContain("✔ on file");
  });

  it("is read-only without onAnswer", () => {
    const html = render(null, null);
    expect(html).not.toContain("<input");
    expect(html).toContain("shown to a guest");
  });

  it("settles in the stream without the address", () => {
    const c = card();
    expect(settledLine({ card: c, answered: { email: "guest@example.com" }, superseded: false, answerable: true })).toMatch(/on file$/u);
    expect(settledLine({ card: c, answered: { skipped: true }, superseded: false, answerable: true })).toMatch(/no thanks$/u);
    expect(settledLine({ card: c, answered: { email: "guest@example.com" }, superseded: false, answerable: true })).not.toContain("guest@example.com");
  });

  it("is 16 px or more (the wave 36 iOS floor) and a 44 px target", () => {
    const css = readFileSync(new URL("../src/css/base.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.answer-text, \.email-text \{[^}]*font: 16px/u);
    expect(css).toMatch(/\.email-text \{ min-height: var\(--tap\)/u);
    // and the global field floor reaches type="email" too
    expect(css).toMatch(/input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="range"\]\), textarea, select \{ font-size: 16px !important; \}/u);
  });
});
