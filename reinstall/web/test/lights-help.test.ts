//! The help's *The house lights* says what the map page does: the numbers
//! it gives a director on site are the code's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIGHT_COLOR_STEP_MIN_MS, LIGHT_LOOP_MIN_PERIOD_MS, LIGHT_PRESENCE_HOLD_MS, LIGHT_PRESENCE_RADIUS_M, LIGHT_PRESENCE_RADIUS_MAX, LIGHT_PRESENCE_RADIUS_MIN, LIGHT_PRESENCE_REPEAT_MS, LIGHT_SAFETY_MIN, LIGHT_STEP_MIN_MS } from "@loom/house";
import { LIGHT_HEIGHT, LIGHT_SWATCHES } from "../src/map/lights.ts";
import { PAIR_SECONDS } from "../src/map/LightsPanel.tsx";

const map = readFileSync(new URL("../../../docs/help/authoring/39-house-map.md", import.meta.url), "utf8").replace(/\s+/g, " ");

describe("the house lights help", () => {
  it("gives the code's numbers", () => {
    expect(map).toContain("## The house lights");
    expect(map).toContain(`**${LIGHT_HEIGHT} m above its floor**`);
    expect(map).toContain(`**${LIGHT_STEP_MIN_MS} ms**`);
    expect(map).toContain(`**${LIGHT_COLOR_STEP_MIN_MS} ms**`);
    expect(map).toContain(`${LIGHT_SAFETY_MIN} of 254 at least`);
    expect(map).toContain(`at least ${LIGHT_LOOP_MIN_PERIOD_MS / 1000} s`);
    expect(PAIR_SECONDS).toBe(120);
    expect(map).toContain("for two minutes");
    for (const s of LIGHT_SWATCHES) expect(map.toLowerCase()).toContain(s.label.toLowerCase());
  });

  it("explains presence (wave 39) with the code's numbers", () => {
    expect(map).toContain("**Presence**");
    expect(map).toContain(`**${LIGHT_PRESENCE_RADIUS_M} m** by default`);
    expect(map).toContain(`${LIGHT_PRESENCE_RADIUS_MIN} to ${LIGHT_PRESENCE_RADIUS_MAX}`);
    expect(map).toContain(`**${LIGHT_PRESENCE_HOLD_MS / 1000} s** after they leave`);
    expect(map).toContain(`every ${LIGHT_PRESENCE_REPEAT_MS / 1000} s`);
    expect(map).toContain("A **safety light never pulses**");
  });

  it("never tells the guests about the pulse (it's a surprise)", () => {
    const play = readFileSync(new URL("../../../docs/help/play/11-reinstallation.md", import.meta.url), "utf8").toLowerCase();
    expect(play).not.toMatch(/puls|presence|real light|house light/);
  });
});
