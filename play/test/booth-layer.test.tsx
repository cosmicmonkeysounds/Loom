// Wave 13 (booth lane): the booth window (scanner, guest card, Guests) is a
// real modal — role dialog, focus moved in and trapped — and Escape inside a
// sheet opened over it (the card's "Share lore…") closes that sheet, never
// the whole card under it.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BoothLayer, escapeIsOurs } from "../src/booth/layer.tsx";

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
