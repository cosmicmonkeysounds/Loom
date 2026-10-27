import { describe, expect, it } from "vitest";
import { PRESENCE_LINGER_MS } from "@loom/house";
import { PresenceLatch, linkedNow, linkedPane, roomOccupied } from "../src/world/presence.ts";

describe("terminals link to the Internet by room (wave 26, R5)", () => {
  it("roomOccupied: the server's here when sent, else the old rule", () => {
    expect(roomOccupied({ here: 0 }, true)).toBe(false);
    expect(roomOccupied({ here: 2 }, false)).toBe(true);
    expect(roomOccupied({}, true)).toBe(true); // an older server: no here
    expect(roomOccupied(null, false)).toBe(false);
    expect(roomOccupied(undefined, true)).toBe(true);
  });

  it("linkedNow: placed walls by room, spectators house-wide, the tent and the unplaced never", () => {
    for (const view of ["auto", "world", "face", "tv", "chess", "casino"]) {
      expect(linkedNow({ view, spot: "hall", here: { here: 1 }, anyone: true }), view).toBe(true);
      expect(linkedNow({ view, spot: "hall", here: { here: 0 }, anyone: true }), view).toBe(false);
      expect(linkedNow({ view, spot: "hall", here: null, anyone: true }), view).toBe(true);
      expect(linkedNow({ view, spot: "", here: { here: 3 }, anyone: true }), view).toBe(false);
    }
    expect(linkedNow({ view: "mirror", spot: "", here: { here: 0 }, anyone: true })).toBe(true);
    expect(linkedNow({ view: "shadow", spot: "hall", here: { here: 0 }, anyone: false })).toBe(false);
    expect(linkedNow({ view: "reinstall", spot: "tent", here: { here: 4 }, anyone: true })).toBe(false);
  });

  it("linkedPane: auto and world draw the simulation only while linked", () => {
    expect(linkedPane("world", true, false, false)).toBe("none");
    expect(linkedPane("world", true, true, false)).toBe("world");
    expect(linkedPane("auto", true, true, true)).toBe("shadow");
    expect(linkedPane("auto", false, true, false)).toBe("raycast");
    expect(linkedPane("auto", true, false, true)).toBe("none");
    expect(linkedPane("face", true, true, false)).toBe("none");
  });

  it("PresenceLatch: on at once, off only after the linger (a doorway never flickers)", () => {
    const l = new PresenceLatch();
    expect(PRESENCE_LINGER_MS).toBe(3000);
    expect(l.update(false, 0)).toBe(false);
    expect(l.nextChange()).toBeNull();
    expect(l.update(true, 100)).toBe(true);
    expect(l.update(false, 200)).toBe(true);
    expect(l.nextChange()).toBe(3200);
    expect(l.update(false, 3100)).toBe(true);
    expect(l.update(true, 3150)).toBe(true); // back in: the clock starts over
    expect(l.update(false, 3200)).toBe(true);
    expect(l.update(false, 6199)).toBe(true);
    expect(l.update(false, 6200)).toBe(false);
    expect(l.on).toBe(false);
    expect(l.nextChange()).toBeNull();
  });
});

describe("the preview's fake state carries R5 / T2 (wave 26)", () => {
  it("here and a live glitch", async () => {
    const { fakeState } = await import("../src/cutscene/fake.ts");
    const { screenLayers } = await import("../src/slides.ts");
    expect(fakeState({ here: 2 }).spot).toEqual({ announce: false, here: 2 });
    expect(fakeState().spot).toBeNull();
    expect(linkedNow({ view: "auto", spot: "hall", here: fakeState({ here: 0 }).spot, anyone: true })).toBe(false);
    const s = fakeState({ now: 5000, glitch: 4000 });
    expect(screenLayers(s, s.receivedAt, { piloting: false }).glitch).toEqual({ seq: 1, at: 4000, t: 1000, text: "000. 000. 000." });
    expect(fakeState().program.glitch).toBeUndefined();
  });
});
