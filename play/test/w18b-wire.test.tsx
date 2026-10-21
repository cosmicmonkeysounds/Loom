// Wave 18b (engine lane): the wire mirror's new readers — badges (`badge:`
// lines), the hidden lobby, faction mode's `canFound` — and `NameBadges`.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { badgesOf, canFoundOf, lobbyHidden } from "../src/guest/wire.ts";
import { NameBadges } from "../src/ui/primitives.tsx";
import type { GuestView } from "../src/types.ts";

describe("wire readers", () => {
  it("badges: well-formed ones only, a lone glyph labels itself, [] for an old server", () => {
    expect(badgesOf({ badges: [{ glyph: "🚻", label: "Bathroom Mode" }, { glyph: "📣" }, { label: "no glyph" }, null, "x"] })).toEqual([
      { glyph: "🚻", label: "Bathroom Mode" },
      { glyph: "📣", label: "📣" },
    ]);
    expect(badgesOf({})).toEqual([]);
    expect(badgesOf(null)).toEqual([]);
  });

  it("the hidden lobby and canFound read false for an old server", () => {
    const v = { lobby: "hidden", canFound: true } as unknown as GuestView;
    expect(lobbyHidden(v)).toBe(true);
    expect(canFoundOf(v)).toBe(true);
    expect(lobbyHidden({} as GuestView)).toBe(false);
    expect(canFoundOf({} as GuestView)).toBe(false);
    expect(lobbyHidden(null)).toBe(false);
  });
});

describe("NameBadges", () => {
  it("renders each glyph with its label for a screen reader and on hover", () => {
    expect(renderToStaticMarkup(<NameBadges badges={[{ glyph: "🚻", label: "Bathroom Mode" }]} />)).toBe('<span class="name-badge" title="Bathroom Mode" aria-label="Bathroom Mode" role="img">🚻</span>');
  });

  it("renders nothing with no badges", () => {
    expect(renderToStaticMarkup(<NameBadges badges={[]} />)).toBe("");
    expect(renderToStaticMarkup(<NameBadges />)).toBe("");
  });
});
