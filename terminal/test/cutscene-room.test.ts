import { describe, expect, it } from "vitest";
import { MomentQueue, faceFlashFor, pickScene, roomCueName, roomSceneAt, sceneForRoom, triggerMatches } from "../src/cutscene/pick.ts";
import type { SceneDef } from "../src/cutscene/types.ts";
import { fakeState } from "../src/cutscene/fake.ts";
import type { ScreenRoomCue, ScreenState } from "../src/screen.ts";

const T0 = 9_000_000;
const C = () => null;
const WAKE = { id: "wake", when: [{ room: "heart_wake" }], ms: 14_000, wall: C, covers: true, face: "alarmed" as const } satisfies SceneDef;
const LAYER = { id: "layer", when: [{ room: "heart_layer_1" }, { room: "heart_layer_2" }], ms: 3_000, wall: C, over: true } satisfies SceneDef;
const SLIDE = { id: "slide", when: [{ slide: "heart_wake" }], ms: 5_000, wall: C, tv: C } satisfies SceneDef;
const SCENES: SceneDef[] = [SLIDE, WAKE, LAYER];

function roomState(cue: ScreenRoomCue | null, over: Partial<ScreenState> = {}): ScreenState {
  return { ...fakeState({ now: T0, target: "terminals" }), room: { id: "server-room", open: true, cue }, ...over };
}
const layers = { overlay: null, slide: null };

describe("room triggers (wave 20, D4)", () => {
  it("match the cue exactly, without its room_ prefix", () => {
    expect(roomCueName("room_heart_wake")).toBe("heart_wake");
    expect(triggerMatches({ room: "heart_wake" }, { room: "room_heart_wake" })).toBe(true);
    expect(triggerMatches({ room: "heart_wake" }, { room: "room_heart_wake_2" })).toBe(false); // exact, never a prefix
    expect(triggerMatches({ room: "Heart Wake" }, { room: "room_heart_wake" })).toBe(true); // folded
    expect(triggerMatches({ slide: "heart_wake" }, { room: "room_heart_wake" })).toBe(false);
    expect(triggerMatches({ room: "heart_wake" }, { slide: "heart_wake" })).toBe(false);
  });

  it("play on a wall (the room terminal) only, never the TV", () => {
    expect(sceneForRoom(SCENES, "room_heart_wake", "wall")).toBe(WAKE);
    expect(sceneForRoom(SCENES, "room_heart_layer_2", "wall")).toBe(LAYER);
    expect(sceneForRoom(SCENES, "room_heart_wake", "tv")).toBeNull();
    expect(sceneForRoom(SCENES, "room_nothing", "wall")).toBeNull();
  });

  it("play from the cue's own at, for their ms; never from history", () => {
    const at = T0 - 1000;
    expect(roomSceneAt({ state: roomState({ value: "room_heart_wake", seq: 1, at }), now: T0, target: "wall", scenes: SCENES })).toMatchObject({ kind: "room", start: at, value: "heart_wake" });
    expect(roomSceneAt({ state: roomState({ value: "room_heart_wake", seq: 1, at }), now: at + 14_000, target: "wall", scenes: SCENES })).toBeNull();
    expect(roomSceneAt({ state: roomState({ value: "room_heart_wake", seq: 1, at: 0 }), now: T0, target: "wall", scenes: SCENES })).toBeNull();
    expect(roomSceneAt({ state: roomState(null), now: T0, target: "wall", scenes: SCENES })).toBeNull();
    const s = roomSceneAt({ state: roomState({ value: "room_heart_wake", seq: 1, at }), now: T0, target: "wall", scenes: SCENES })!;
    expect(roomSceneAt({ state: roomState({ value: "room_heart_wake", seq: 1, at }), now: T0, target: "wall", scenes: SCENES, roomDone: (k) => k === s.key })).toBeNull();
    // A repeat is a new seq: a new scene.
    expect(roomSceneAt({ state: roomState({ value: "room_heart_wake", seq: 2, at: T0 }), now: T0, target: "wall", scenes: SCENES })?.key).not.toBe(s.key);
  });

  it("survive a bare (room) layer, a pilot included, but never an overlay", () => {
    const st = roomState({ value: "room_heart_layer_1", seq: 3, at: T0 - 500 });
    const bare = pickScene({ state: st, now: T0, layers, bare: true, target: "wall", scenes: SCENES, queue: new MomentQueue() });
    expect(bare.room?.def.id).toBe("layer");
    expect(bare.base).toBeNull();
    expect(bare.top).toBeNull();
    const covered = pickScene({ state: st, now: T0, layers: { overlay: "alarm", slide: null }, bare: true, target: "wall", scenes: SCENES, queue: new MomentQueue() });
    expect(covered.room ?? null).toBeNull();
  });

  it("flash the wall terminal's face (room scenes only)", () => {
    const st = roomState({ value: "room_heart_wake", seq: 1, at: T0 });
    const scene = roomSceneAt({ state: st, now: T0, target: "wall", scenes: SCENES })!;
    const seen = new Set<string>();
    expect(faceFlashFor(scene, "wall", seen)).toEqual({ mood: "alarmed", ms: 2500 });
    expect(faceFlashFor(scene, "wall", seen)).toBeNull(); // once
  });
});
