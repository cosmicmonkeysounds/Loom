//! Wave 18b (R11): Clippy's tour never names the story ("Trapped In The
//! Internet"). Done in wave 18 (30ef8aa); this pins it.

import { describe, expect, it } from "vitest";
import { tutorialSteps } from "../src/tutorial.tsx";

describe("the tour never says the story's title", () => {
  it("in no step's title or text, whatever the options", () => {
    const title = "Trapped In The Internet";
    for (const bathroom of [undefined, null, "", "🚻 Bathroom Mode pauses your phone while you're away."]) {
      for (const flags of [false, true]) {
        const steps = tutorialSteps({ title, hasCodex: flags, hasQuests: flags, hasWallet: flags, hasPeople: flags, hasActions: flags, hasObjectives: flags, bathroom });
        expect(steps.length).toBeGreaterThan(0);
        for (const s of steps) {
          expect(`${s.title} ${s.text}`.toLowerCase(), s.id).not.toContain(title.toLowerCase());
          expect(`${s.title} ${s.text}`, s.id).not.toMatch(/trapped|the internet/iu);
        }
      }
    }
  });
});
