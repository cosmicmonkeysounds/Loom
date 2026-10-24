import { describe, expect, it } from "vitest";
import { nightOf, parseScreenState, roomCueOf } from "../src/screen.ts";

describe("the screen state's wave 20 fields", () => {
  it("reads the room's picture cue", () => {
    const s = parseScreenState({ attract: false, room: { id: "server-room", open: true, cue: { value: "room_heart_wake", seq: 3, at: 1700 } } });
    expect(s?.room).toEqual({ id: "server-room", open: true, cue: { value: "room_heart_wake", seq: 3, at: 1700 } });
    expect(parseScreenState({ attract: false, room: { id: "x", open: false } })?.room?.cue).toBeNull(); // an older server
    expect(roomCueOf({ value: "room_heart_wake", seq: 1, at: 0 })).toEqual({ value: "room_heart_wake", seq: 1, at: 0 }); // history
    expect(roomCueOf({ value: "heart_wake", seq: 1, at: 5 })).toBeNull();
    expect(roomCueOf({ value: "room_", seq: 1, at: 5 })).toBeNull();
    expect(roomCueOf({ value: "room_x", seq: "1", at: 5 })).toBeNull();
    expect(roomCueOf({ value: "room_x", seq: 1, at: -4 })).toEqual({ value: "room_x", seq: 1, at: 0 });
  });

  it("reads the heart's night vars", () => {
    expect(nightOf({ server_door: "open", heart_stage: "talk", heart_look: "heart_argue", alarm_on: false, door_override: true })).toMatchObject({ server_door: "open", heart_stage: "talk", heart_look: "heart_argue", alarm_on: false, door_override: true });
    expect(nightOf({ patch_override: true })).toMatchObject({ patch_override: true });
    expect(nightOf({ patch_override: "yes" })).toMatchObject({ patch_override: null });
    expect(nightOf({ server_door: "ajar", heart_look: "none" })).toMatchObject({ server_door: null, heart_stage: null, heart_look: null, alarm_on: null, door_override: null });
  });
});
