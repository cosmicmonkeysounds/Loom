//! The King on the play screen's HUD (wave 26, R3): the help card offers
//! Space / ⚔ only while he stands, and the top centre of the HUD clears
//! while a standing King is in view, so the bar over his head — his only
//! display — is never covered.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Prop, Vec3 } from "@loom/house";
import { KING_VIEW_DEG, KING_VIEW_M, kingClearsHud, kingInView, kingStands } from "../src/game/hud.ts";
import { THREE_FLOOR } from "./houses.ts";

const play = readFileSync(new URL("../src/game/Play.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

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

describe("the HUD clears for the bar over his head", () => {
  const house = THREE_FLOOR();
  const prop = house.props.find((p) => p.kind === "king") as Prop;
  const at = (dx: number, dz = 0): Vec3 => [prop.pos[0] + dx, prop.pos[1], prop.pos[2] + dz];
  const WEST = 90; // faces −x: towards him from +x

  it("kingInView: his floor, within 4.5 m on the plan, within 40° of the facing", () => {
    expect(KING_VIEW_M).toBe(4.5);
    expect(KING_VIEW_DEG).toBe(40);
    for (const d of [0.55, 0.75, 1.25, 2, 3, 4, 4.5]) expect(kingInView(house, at(d), WEST, prop), `${d} m`).toBe(true);
    expect(kingInView(house, at(4.6), WEST, prop)).toBe(false);
    expect(kingInView(house, at(2), WEST + 35, prop)).toBe(true);
    expect(kingInView(house, at(2), WEST + 45, prop)).toBe(false);
    expect(kingInView(house, at(2), WEST + 180, prop)).toBe(false);
    // Another floor, right above him: not in view.
    expect(kingInView(house, [prop.pos[0] + 1, prop.pos[1] + 30, prop.pos[2]], WEST, prop)).toBe(false);
  });

  it("kingClearsHud: only a standing King in view; fallen or out of view keeps the compass and the heat line", () => {
    expect(kingClearsHud(null)).toBe(false);
    expect(kingClearsHud(undefined)).toBe(false);
    expect(kingClearsHud({ fallen: false, inView: true })).toBe(true);
    expect(kingClearsHud({ fallen: true, inView: true })).toBe(false);
    expect(kingClearsHud({ fallen: false, inView: false })).toBe(false);
  });

  it("Play marks the screen king-in-view off kingClearsHud, and the CSS hides the compass and the heat line then", () => {
    expect(play).toMatch(/\$\{kingClearsHud\(hud\?\.king\) \? " king-in-view" : ""\}/u);
    expect(css).toMatch(/\.play\.king-in-view \.compass, \.play\.king-in-view \.hud-heat \{ visibility: hidden; \}/u);
    // Hidden, not unmounted: the HUD keeps its layout (the top grid's middle column).
    expect(play).toMatch(/<Compass yaw=\{hud\.yaw\} pip=\{hud\.pip\} \/>/u);
  });
});
