//! Wave 18, the moments lane (GUEST-SPEC §6.4, the user's "when you click
//! on the buttons to take you to where the notification is, it just takes
//! you to the 'Trapped in the Internet' chat"): a push tap lands on its own
//! place through the exit type — never the lobby. The booth's mapping is
//! unchanged.

import { describe, expect, it } from "vitest";
import { OPEN_ROOM, navFromMessage, navFromSearch, roomTarget } from "../src/room.ts";

const listed = ["lobby", "codex", "quests", "wallet", "dm:Trabolta", "loc:The Desktop"];

describe("a guest's push tap", () => {
  it("a fresh window's ?room=", () => {
    expect(navFromSearch("?code=ABC&room=lobby", listed)).toEqual({ to: "mission" });
    expect(navFromSearch("?room=dm%3ATrabolta", listed)).toEqual({ to: "room", id: "dm:Trabolta" });
    expect(navFromSearch("?room=wallet", listed)).toEqual({ to: "wallet" });
    expect(navFromSearch("?room=loc%3AThe%20Server%20Room", listed)).toEqual({ to: "mission" });
  });

  it("an open window's service-worker message", () => {
    expect(navFromMessage({ type: OPEN_ROOM, room: "lobby" }, listed)).toEqual({ to: "mission" });
    expect(navFromMessage({ type: OPEN_ROOM, room: "loc:The Desktop" }, listed)).toEqual({ to: "room", id: "loc:The Desktop" });
    expect(navFromMessage({ type: OPEN_ROOM, room: "quests" }, listed)).toEqual({ to: "quests" });
    expect(navFromMessage({ type: "other", room: "codex" }, listed)).toBeNull();
    expect(navFromMessage(null, listed)).toBeNull();
  });

  it("the booth keeps its own mapping", () => {
    expect(roomTarget("lobby", ["__feed"], true)).toBe("__feed");
    expect(roomTarget("dm:Trabolta", ["cast:Trabolta"], true)).toBe("cast:Trabolta");
  });
});
