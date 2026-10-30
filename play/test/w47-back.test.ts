// Wave 47: the phone's Back never leaves the app mid-show, and never moves
// the view under a moment. Seen in Chrome: an Antivirus in a chat room
// pressed Back and the page left the app; a guest under CORRUPTION DETECTED
// pressed Back and the room behind the big closed.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boothAway, boothBackStep, type BoothOpen } from "../src/booth/app.tsx";
import { guestBackStep, type GuestOpen } from "../src/guest/nav.ts";

const home: BoothOpen = { layer: null, sheet: null, people: null, help: false };

describe("a booth's Back (wave 47)", () => {
  it("is the browser's at home only", () => {
    expect(boothBackStep(home)).toBe(null);
    expect(boothAway(home)).toBe(false);
  });
  it("closes a room on a phone, then the window that isn't home", () => {
    expect(boothBackStep({ ...home, room: true })).toBe("room");
    expect(boothBackStep({ ...home, room: true, window: true })).toBe("room");
    expect(boothBackStep({ ...home, window: true })).toBe("window");
    expect(boothAway({ ...home, room: true })).toBe(true);
    expect(boothAway({ ...home, window: true })).toBe(true);
  });
  it("closes the top layer before the room under it (× lands where the scan started)", () => {
    expect(boothBackStep({ ...home, layer: { kind: "card", id: "g1" }, room: true })).toBe("layer");
    expect(boothBackStep({ ...home, sheet: "knows", room: true })).toBe("sheet");
    expect(boothBackStep({ ...home, peopleOpen: true, window: true })).toBe("peopleOpen");
  });
  it("a floating pop-out goes to Later before anything under it", () => {
    expect(boothBackStep({ ...home, popout: "later", room: true })).toBe("popout");
    expect(boothBackStep({ ...home, popout: "stays" })).toBe("popout");
    expect(boothBackStep({ ...home, popout: null })).toBe(null);
  });
  it("the booth passes its room and window to the Back", () => {
    const src = readFileSync(new URL("../src/booth/app.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/room: !wide && activeId !== null/u);
    expect(src).toMatch(/window: \(player1 && pwin !== "mission"\) \|\| \(hostWins1 && hwin !== "show"\)/u);
  });
});

const ghome: GuestOpen = { moment: null, sheet: false, overlay: false, credits: false, rails: false, room: false, window: false };

describe("a guest's Back (wave 47)", () => {
  it("is the browser's on Mission with nothing open", () => {
    expect(guestBackStep(ghome)).toBe(null);
  });
  it("a moment keeps Back first: the room behind CORRUPTION DETECTED stays open", () => {
    expect(guestBackStep({ ...ghome, moment: "swallow", room: true })).toBe("moment");
    expect(guestBackStep({ ...ghome, moment: "dismiss", room: true })).toBe("moment");
  });
  it("on the stage or the lock screen Back stays in the app (the pass still closes)", () => {
    expect(guestBackStep({ ...ghome, rails: true })).toBe("rails");
    expect(guestBackStep({ ...ghome, rails: true, room: true })).toBe("rails");
    expect(guestBackStep({ ...ghome, rails: true, overlay: true })).toBe("overlay");
  });
  it("a sheet, then the overlay, then the room, then the window", () => {
    expect(guestBackStep({ ...ghome, sheet: true, overlay: true, room: true })).toBe("sheet");
    expect(guestBackStep({ ...ghome, overlay: true, room: true })).toBe("overlay");
    expect(guestBackStep({ ...ghome, credits: true, room: true })).toBe("credits");
    expect(guestBackStep({ ...ghome, room: true, window: true })).toBe("room");
    expect(guestBackStep({ ...ghome, window: true })).toBe("window");
  });
  it("the guest app's Back sits inside the moments provider, in every branch", () => {
    const src = readFileSync(new URL("../src/guest/app.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/<MomentsProvider \{\.\.\.moments\}>\s*<GuestBack enabled=\{host\.ownsPage\}/u);
    expect(src).toMatch(/rails: cut\.showing \|\| s\.locked/u);
  });
});
