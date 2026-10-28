//! (wave 39) The map page's Presence block: `lights.json` `presence` as the
//! LightsPanel edits it (`setLightPresence`), and renames / deletes that
//! keep its targets right.
import { describe, expect, it } from "vitest";
import { presenceFixtures, presenceSettings, validateHouse, validateLights } from "@loom/house";
import type { HouseMap, LightsConfig } from "@loom/house";
import lightsHouseRaw from "../../../house/test/fixtures/lights-house.json";
import lightsBasic from "../../../house/test/fixtures/lights-basic.json";
import { normalizeLights, removeLight, removeLightZone, renameLight, renameLightZone, setLightPresence } from "../src/map/lights.ts";

const house = validateHouse(lightsHouseRaw).house as HouseMap;
const basic = (): LightsConfig => normalizeLights(lightsBasic);

describe("setLightPresence", () => {
  it("writes only what differs from the defaults, and drops the block at the defaults", () => {
    const l = basic();
    expect(l.presence).toBeUndefined();
    const off = setLightPresence(l, { enabled: false });
    expect(off.presence).toEqual({ enabled: false });
    expect(presenceFixtures(off, house)).toEqual([]);
    expect(setLightPresence(off, { enabled: true }).presence).toBeUndefined();
    const up = setLightPresence(l, { to: ["upstairs"], radius: 2.25, effect: "okay" });
    expect(up.presence).toEqual({ to: ["upstairs"], radius: 2.25, effect: "okay" });
    expect(presenceSettings(up)).toEqual({ enabled: true, to: ["upstairs"], radius: 2.25, effect: "okay" });
    expect(validateLights(up, house).problems).toEqual([]);
    expect(setLightPresence(up, { to: ["everywhere"], radius: null, effect: "breathe" }).presence).toBeUndefined();
  });

  it("clamps the radius, and is a no-op (same object) when nothing changes", () => {
    const l = basic();
    expect(setLightPresence(l, { radius: 99 }).presence?.radius).toBe(5);
    expect(setLightPresence(l, { radius: 0.1 }).presence?.radius).toBe(0.5);
    expect(setLightPresence(l, { radius: Number.NaN })).toBe(l);
    expect(setLightPresence(l, { effect: "breathe" })).toBe(l);
    expect(l.presence).toBeUndefined();
  });

  it("an empty target list pulses nothing (not everywhere)", () => {
    const none = setLightPresence(basic(), { to: [] });
    expect(none.presence).toEqual({ to: [] });
    expect(presenceFixtures(none, house)).toEqual([]);
  });

  it("never pulses a safety light, whatever the targets", () => {
    const heart = setLightPresence(basic(), { to: ["heart", "desk-lamp"] });
    expect(presenceFixtures(heart, house).map((f) => f.id)).toEqual(["desk-lamp"]);
    expect(validateLights(heart, house).warnings.some((w) => w.includes("safety"))).toBe(true);
  });
});

describe("renames and deletes keep presence.to right", () => {
  it("follows a fixture's new id and a zone's new name, and drops a deleted one", () => {
    let l = setLightPresence(basic(), { to: ["desk-lamp", "Up Stairs", "attic-bulb"] });
    l = renameLight(l, "desk-lamp", "desk");
    expect(l.presence?.to).toEqual(["desk", "Up Stairs", "attic-bulb"]);
    l = renameLightZone(l, "upstairs", "Upper floor");
    expect(l.presence?.to).toEqual(["desk", "upstairs", "attic-bulb"]);
    l = removeLight(l, "attic-bulb");
    expect(l.presence?.to).toEqual(["desk", "upstairs"]);
    l = removeLightZone(l, "upstairs");
    expect(l.presence?.to).toEqual(["desk"]);
  });
});
