// Wave 59: the refused screen says only what is printed on the card, and
// always offers a way on. The round trip itself is `test/rejoin.test.ts` and
// the server's `w59-claims.test.ts`.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeldPanel } from "../src/held.tsx";
import type { HeldCard } from "../src/rejoin.ts";

const render = (card: HeldCard) => renderToStaticMarkup(createElement(HeldPanel, { card, onGuest: () => {}, onBooth: () => {}, onBack: () => {} }));

describe("the refused screen", () => {
  it("a blank badge names its ref, never a program", () => {
    const html = render({ code: "EVT1", by: { badge: "k3m9q2xz" }, name: null, ref: "B012" });
    expect(html).toContain("Badge B012 is already signed in on a phone.");
    expect(html).toContain("Ask a host");
    expect(html).toContain("Back");
  });
  it("an invited or a staff badge names what's printed on it", () => {
    expect(render({ code: "EVT1", by: { claim: "c" }, name: "Microsoft Excel", ref: "F01" })).toContain("Microsoft Excel is already signed in on a phone.");
    expect(render({ code: "EVT1", by: { part: "p" }, name: "Clippy", ref: null })).toContain("Clippy is already signed in on a phone.");
  });
});
