//! Wave 18, the moments lane (CONTRACTS A8, GUEST-SPEC §5.3): the card
//! registry learns which kinds a big moment renders inside itself, and
//! other lanes add kinds through `registerWidget` (the guest lane's `sides`
//! and `invite`).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WIDGETS, WidgetHost, registerWidget, widgetInline, type WidgetProps } from "../src/widgets.tsx";

describe("the inline flag", () => {
  it("poll, captcha and answer render inside a big moment; a fact card and a picture do not", () => {
    for (const k of ["poll", "captcha", "answer"]) expect(widgetInline(k), k).toBe(true);
    for (const k of ["fact", "image", "pass", "tutorial", "nope"]) expect(widgetInline(k), k).toBe(false);
  });
});

describe("registerWidget", () => {
  it("takes a whole def", () => {
    registerWidget("w18-def", { label: "🚪 choose a side", answerable: true, inline: true, fullBleed: true, render: () => createElement("i", null, "doors") });
    expect(WIDGETS["w18-def"]?.fullBleed).toBe(true);
    expect(widgetInline("w18-def")).toBe(true);
    expect(renderToStaticMarkup(createElement(WidgetHost, { card: { kind: "w18-def", text: "", params: {} }, seed: 1 }))).toBe("<i>doors</i>");
  });

  it("or a component and its flags (the label defaults to the kind, answerable to true)", () => {
    const Invite = (p: WidgetProps) => createElement("b", null, `invite ${p.card.text}`);
    registerWidget("w18-invite", Invite, { inline: true });
    expect(WIDGETS["w18-invite"]).toMatchObject({ label: "w18-invite", answerable: true, inline: true });
    expect(renderToStaticMarkup(createElement(WidgetHost, { card: { kind: "w18-invite", text: "Ada", params: {} }, seed: 2 }))).toBe("<b>invite Ada</b>");
  });

  it("registering a kind again replaces it", () => {
    registerWidget("w18-again", { label: "a", answerable: false, render: () => "a" });
    registerWidget("w18-again", { label: "b", answerable: false, render: () => "b" });
    expect(WIDGETS["w18-again"]?.label).toBe("b");
  });
});
