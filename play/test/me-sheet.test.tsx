//! Wave 18 (GUEST-SPEC §8.1, G8, Q21): the Me sheet — picture, name, where,
//! Truthcoin, every group as a badge, the pass, Change my picture, Sides &
//! crews, the settings. A join adds a badge; nothing replaces the sheet.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MeSheet, meBadges } from "../src/guest/me.tsx";
import { MeButton } from "../src/guest/frame.tsx";
import type { GuestView } from "../src/types.ts";

const noop = () => {};
function view(o: Record<string, unknown> = {}): GuestView {
  return { id: "g-1", name: "Winamp", role: null, faction: null, score: 0, location: "The Desktop", captured: false, pendingChoice: null, decisionChannel: null, channels: [], spaces: [], roster: [], factions: ["Unlimited Power", "The Way Out"], ...o } as GuestView;
}
const render = (v: GuestView, o: Partial<Parameters<typeof MeSheet>[0]> = {}) =>
  renderToStaticMarkup(createElement(MeSheet, { view: v, where: "📍 The Desktop", wake: { supported: true, on: false, toggle: noop }, push: true, sides: true, onPass: noop, onPicture: noop, onSides: noop, onAlerts: noop, onClose: noop, ...o }));

describe("the Me sheet", () => {
  it("badges: the side (◆), other groups, then the crew (◇)", () => {
    expect(meBadges(view() as never)).toEqual([]);
    expect(meBadges(view({ faction: "Unlimited Power", groups: ["Unlimited Power", "Program"] }) as never)).toEqual([
      { name: "Unlimited Power", kind: "side" },
      { name: "Program", kind: "group" },
    ]);
    expect(meBadges(view({ faction: "Unlimited Power", groups: ["Unlimited Power", "The Night Shift"], crew: { id: "crew-1", name: "The Night Shift", founder: "g-1", members: ["g-1"] } }) as never)).toEqual([
      { name: "Unlimited Power", kind: "side" },
      { name: "The Night Shift", kind: "crew" },
    ]);
  });

  it("a join adds a badge; the picture, the name and the pass stay", () => {
    const before = render(view());
    const after = render(view({ faction: "Unlimited Power", groups: ["Unlimited Power"] }));
    for (const out of [before, after]) {
      expect(out).toContain("Winamp");
      expect(out).toContain("Show my pass");
      expect(out).toContain("Change my picture");
      expect(out).toContain('class="pavatar lg');
    }
    expect(before).toContain("No badges yet.");
    expect(after).toContain("◆ Unlimited Power");
  });

  it("the wallet, Sides & crews and the settings only when there are any", () => {
    const rich = render(view({ wallet: { name: "Truthcoin", balance: 150, escrowed: 0, maxTransfer: 50, transfers: [], requests: [], offers: [] } }));
    expect(rich).toContain("150 Truthcoin");
    expect(rich).toContain("Sides &amp; crews");
    expect(rich).toContain("Keep my screen on");
    expect(rich).toContain("Get alerts on this phone");
    const bare = render(view(), { wake: null, push: false, sides: false });
    expect(bare).not.toContain("SETTINGS");
    expect(bare).not.toContain("Sides &amp; crews");
  });

  it("the top bar's picture opens it", () => {
    const out = renderToStaticMarkup(createElement(MeButton, { name: "Winamp", onOpen: noop }));
    expect(out).toContain('data-tour="me"');
    expect(out).toContain('aria-label="Me"');
  });
});
