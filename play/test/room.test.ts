//! SW-PLAY-20 — notification deep links: the `?room=` link, the service
//! worker's `open-room` message, and which thread each opens (only a room
//! this participant lists; a booth's own names for the feed / Scanner /
//! an agent's cast thread).

import { describe, expect, it } from "vitest";

import { OPEN_ROOM, opensHome, roomFromMessage, roomFromSearch, roomTarget, withoutRoom } from "../src/room.ts";

describe("notification deep links", () => {
  it("reads the room off a push link and strips it for reload safety", () => {
    expect(roomFromSearch("?room=dm%3ATrabolta")).toBe("dm:Trabolta");
    expect(roomFromSearch("?code=EVT1&room=loc%3AThe%20Desktop")).toBe("loc:The Desktop");
    expect(roomFromSearch("?code=EVT1")).toBeNull();
    expect(roomFromSearch("?room=")).toBeNull();
    expect(withoutRoom("?code=EVT1&room=wallet")).toBe("?code=EVT1");
    expect(withoutRoom("?room=wallet")).toBe("");
  });

  it("takes only the worker's open-room message", () => {
    expect(roomFromMessage({ type: OPEN_ROOM, room: "dm:Trabolta" })).toBe("dm:Trabolta");
    expect(roomFromMessage({ type: "other", room: "x" })).toBeNull();
    expect(roomFromMessage({ type: OPEN_ROOM, room: 4 })).toBeNull();
    expect(roomFromMessage({ type: OPEN_ROOM, room: " " })).toBeNull();
    expect(roomFromMessage("open-room")).toBeNull();
    expect(roomFromMessage(null)).toBeNull();
  });

  it("a guest opens a room it lists, and never one it doesn't", () => {
    const listed = ["lobby", "dm:Trabolta", "wallet", "loc:The Desktop"];
    expect(roomTarget("dm:Trabolta", listed, false)).toBe("dm:Trabolta");
    expect(roomTarget("wallet", listed, false)).toBe("wallet");
    expect(roomTarget("loc:Server Room", listed, false)).toBeNull(); // hidden: not opened yet
    expect(roomTarget("scanner", listed, false)).toBeNull(); // a booth's link
  });

  it("a booth maps the feed, its Scanner and an agent's thread onto its own rooms", () => {
    const listed = ["__scanner", "__feed", "room:hosts", "wallet", "cast:Trabolta", "guest:g-1"];
    expect(roomTarget("scanner", listed, true)).toBe("__scanner");
    expect(roomTarget("lobby", listed, true)).toBe("__feed");
    expect(roomTarget("room:hosts", listed, true)).toBe("room:hosts");
    expect(roomTarget("wallet", listed, true)).toBe("wallet");
    expect(roomTarget("dm:Trabolta", listed, true)).toBe("cast:Trabolta");
    expect(roomTarget("dm:Clippy", listed, true)).toBeNull();
  });

  it("a wide screen's home default waits for a pending link (both fire in one commit; home ran last and won)", () => {
    expect(opensHome(true, true, null, "lobby", false)).toBe(true);
    expect(opensHome(true, true, null, "lobby", true)).toBe(false); // ?room= still to open
    expect(opensHome(true, true, "dm:Trabolta", "lobby", false)).toBe(false); // the link opened its room
    expect(opensHome(true, false, null, "lobby", false)).toBe(false); // a phone: no default
    expect(opensHome(false, true, null, "lobby", false)).toBe(false);
    expect(opensHome(true, true, null, null, false)).toBe(false);
  });
});
