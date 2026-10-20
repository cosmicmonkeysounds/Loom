// Wave 13 (booth lane): the booth window (scanner, guest card, Guests) is a
// real modal — role dialog, focus moved in and trapped — and Escape inside a
// sheet opened over it (the card's "Share lore…") closes that sheet, never
// the whole card under it.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BoothLayer, escapeIsOurs } from "../src/booth/layer.tsx";
import { ReadoutsView } from "../src/booth/readouts.tsx";
import { readBundledCss } from "./css.ts";

const layerWith = (nestedDialog: boolean) => ({ querySelector: (sel: string) => (nestedDialog && sel === '[role="dialog"]' ? ({} as Element) : null) });

describe("the booth window's Escape", () => {
  it("is the window's while nothing is open inside it", () => {
    expect(escapeIsOurs(layerWith(false))).toBe(true);
  });
  it("is left to a sheet open inside it (Share lore…), wherever focus sits", () => {
    expect(escapeIsOurs(layerWith(true))).toBe(false);
  });
  it("does nothing before the window is mounted", () => {
    expect(escapeIsOurs(null)).toBe(false);
  });
});

describe("the booth window", () => {
  it("is a modal dialog with a focusable box to trap Tab in", () => {
    const html = renderToStaticMarkup(
      <BoothLayer title="🪪 Ada" label="Ada's card" onClose={() => {}}>
        <button type="button">Send</button>
      </BoothLayer>,
    );
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-label="Ada&#x27;s card"/);
    expect(html).toContain('class="booth-layer-box" tabindex="-1"');
    expect(html).toContain('aria-label="Close"');
  });
});

describe("the 44 px floor on the booth's own controls", () => {
  it("the Readouts back arrow and the booth windows' close box are tap-sized", () => {
    const html = renderToStaticMarkup(
      <ReadoutsView channel={{ id: "__inbox", kind: "dm", title: "Readouts", spaceId: "booth", messages: [], unread: 0, decision: null, lastTs: 0 }} wide={false} onBack={() => {}} guests={[]} onGuest={() => {}} />,
    );
    expect(html).toContain('class="back booth-back"');
    const css = readBundledCss();
    expect(css).toMatch(/\.back\.booth-back \{ width: var\(--tap\); height: var\(--tap\);/);
    expect(css).toMatch(/\.booth-layer-win > \.w95-titlebar \.w95-x \{ min-height: var\(--tap\); \}/);
  });
});
