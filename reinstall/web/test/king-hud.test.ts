//! The King on the play screen's HUD (wave 26, R3): the help card offers
//! Space / ⚔ only while he stands, and the top centre of the HUD clears
//! while a standing King is in view, so the bar over his head — his only
//! display — is never covered.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { kingStands } from "../src/game/hud.ts";

const play = readFileSync(new URL("../src/game/Play.tsx", import.meta.url), "utf8");

describe("the help card's King line", () => {
  it("kingStands: on the map and not fallen", () => {
    expect(kingStands(null)).toBe(false);
    expect(kingStands(undefined)).toBe(false);
    expect(kingStands({ fallen: true })).toBe(false);
    expect(kingStands({ fallen: false })).toBe(true);
  });

  it("both help-card branches (keyboard and sticks) offer the hit only while he stands", () => {
    const card = play.slice(play.indexOf('className="help-card'), play.indexOf("help-goal"));
    expect(card).toContain("Space</b> hits the King");
    expect(card).toContain("⚔</b> by the King");
    expect(card.match(/\{kingStands\(hud\?\.king\) && \(/gu)).toHaveLength(2);
    expect(card).not.toMatch(/hud\?\.king !== null/u);
  });
});
