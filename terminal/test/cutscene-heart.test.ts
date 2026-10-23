import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { componentFor, sceneForRoom } from "../src/cutscene/pick.ts";
import { ACTS, SCENES, duplicateIds } from "../src/cutscene/registry.ts";
import { SCENES as HEART, bayLight, layerOf } from "../src/cutscene/scenes/heart.tsx";
import { fakeState } from "../src/cutscene/fake.ts";
import type { SceneProps } from "../src/cutscene/types.ts";
import { HEART_SCENE_MS } from "../src/heart/heart.ts";

/** The room cues the story plays (CONTRACT-w20 §2.11). */
const ROOM_CUES = ["room_heart_wake", "room_heart_sealed", "room_heart_sealed_present", "room_heart_layer_1", "room_heart_layer_2", "room_heart_layer_3", "room_heart_layer_4", "room_heart_proof", "room_heart_warn", "room_heart_eject", "room_heart_notyet", "room_heart_leave", "room_heart_shutdown"];
/** §3.8: the scenes that may cover the choice panel's docked menu. */
const COVERING = ["heart_wake", "heart_sealed", "heart_sealed_present", "heart_eject", "heart_notyet", "heart_leave", "heart_shutdown"];
/** D29: never in a scene the guest sees. */
const OUTSIDE = /\b(john|steph|jesse|party|the show|actors?|performers?|rehearsal|loom|stagehand|arduino|zigbee|laptop|grand central|sensor)\b/iu;

function render(id: string, t: number, value?: string): string {
  const def = HEART.find((d) => d.id === id)!;
  const View = componentFor(def, "wall")!;
  const state = fakeState({ now: 1_000_000 + t, target: "terminals" });
  const props: SceneProps = { t, at: 1_000_000, seq: 1, value: value ?? def.id, state, night: state.night, who: null, target: "wall", sfx: () => false, done: () => {}, reduced: false };
  return renderToStaticMarkup(createElement(View, props));
}

describe("the heart's room scenes (§3.8)", () => {
  it("are registered, with no id twice", () => {
    expect(ACTS.map((a) => a.file)).toContain("heart");
    expect(duplicateIds(SCENES)).toEqual([]);
  });

  it("answer every room cue the story plays, on the room's terminal only", () => {
    for (const cue of ROOM_CUES) {
      expect(sceneForRoom(SCENES, cue, "wall"), cue).not.toBeNull();
      expect(sceneForRoom(SCENES, cue, "tv"), cue).toBeNull();
    }
    expect(sceneForRoom(SCENES, "room_heart_layer_3", "wall")?.id).toBe("heart_layer");
    for (const d of HEART) {
      expect(d.tv, d.id).toBeUndefined();
      for (const w of d.when) expect("room" in w, d.id).toBe(true);
    }
  });

  it("cover the docked choices only where §3.8 allows", () => {
    for (const d of HEART) expect(d.covers === true, d.id).toBe(COVERING.includes(d.id));
  });

  it("play for their §3.8 lengths, with their faces", () => {
    const by = Object.fromEntries(HEART.map((d) => [d.id, d]));
    expect(by["heart_wake"]).toMatchObject({ ms: 14_000, face: "alarmed" });
    expect(by["heart_sealed"]).toMatchObject({ ms: 8_000, face: "attentive" });
    expect(by["heart_sealed_present"]).toMatchObject({ ms: 6_000, face: "attentive" });
    expect(by["heart_layer"]).toMatchObject({ ms: 3_000, over: true, face: "thinking" });
    expect(by["heart_proof"]).toMatchObject({ ms: 6_000, face: "glitch" });
    expect(by["heart_warn"]).toMatchObject({ ms: 3_000, over: true, face: "angry" });
    expect(by["heart_eject"]).toMatchObject({ ms: 8_000, face: "angry" });
    expect(by["heart_notyet"]).toMatchObject({ ms: 6_000, face: "pleased" });
    expect(by["heart_leave"]).toMatchObject({ ms: 3_000, face: "neutral" });
    expect(by["heart_shutdown"]).toMatchObject({ ms: 25_000, face: "dying", faceMs: 25_000 });
    for (const d of HEART) expect(d.ms, d.id).toBe(HEART_SCENE_MS[d.id.startsWith("heart_layer") ? "heart_layer" : (d.id as keyof typeof HEART_SCENE_MS)]);
  });

  it("draw at every second of their length without throwing", () => {
    for (const d of HEART) for (let t = 0; t <= (d.ms as number); t += 500) expect(() => render(d.id, t), `${d.id} @ ${t}`).not.toThrow();
  });

  it("say CLOSE THE DOOR on the wake and SHOW ME YOUR PASS on the seal", () => {
    expect(render("heart_wake", 13_500)).toContain("CLOSE THE DOOR");
    expect(render("heart_wake", 2_000)).toContain("HEART.SYS");
    expect(render("heart_sealed", 7_000)).toContain("SHOW ME YOUR PASS");
    expect(render("heart_sealed", 7_000)).toContain("SEALED");
    expect(render("heart_sealed_present", 5_000)).not.toContain("PASS");
    expect(render("heart_eject", 7_500)).toContain("ACCESS TO THE HEART HAS BEEN TERMINATED");
    expect(render("heart_notyet", 5_500)).toContain("NOT YET");
    expect(render("heart_notyet", 5_500)).toContain("COME BACK WHEN THE CLOCK RUNS");
    expect(render("heart_leave", 1_000)).toContain("CONNECTION CLOSED");
    expect(render("heart_shutdown", 24_000)).toContain("It is now safe to turn off your computer.");
  });

  it("read the layer off the cue", () => {
    expect(layerOf("heart_layer_3")).toBe(3);
    expect(layerOf("heart_layer_9")).toBe(4);
    expect(layerOf("heart_layer")).toBe(1);
    expect(render("heart_layer", 1_000, "heart_layer_2")).toContain("LAYER 2 / 4");
    expect(render("heart_layer", 1_000, "heart_layer_2")).toContain("WHAT I AM");
    expect(render("heart_layer", 1_000, "heart_layer_4")).toContain("THE ASK");
  });

  it("take the patch bay dark top row first", () => {
    expect(bayLight(0, 0, 0)).toBe(1);
    expect(bayLight(0, 11, 11_000)).toBe(0); // the top row is out before the bottom starts
    expect(bayLight(1, 0, 11_000)).toBe(1);
    expect(bayLight(1, 11, 25_000)).toBe(0);
  });

  it("never step outside his world (D29)", () => {
    for (const d of HEART) for (const t of [0, 2000, 5000, 9000, 13_000, 24_000]) expect(render(d.id, Math.min(t, (d.ms as number) - 1)), `${d.id} @ ${t}`).not.toMatch(OUTSIDE);
    const src = readFileSync(fileURLToPath(new URL("../src/cutscene/scenes/heart.tsx", import.meta.url)), "utf8");
    // The copy in quotes (what a guest reads) stays inside the fiction; the module notes may name the rule.
    const strings = [...src.matchAll(/"([^"\n]{3,})"/gu)].map((m) => m[1]!).filter((s) => /[A-Za-z]{3}/u.test(s) && !s.includes("/") && !s.startsWith("./"));
    for (const s of strings) expect(s, s).not.toMatch(OUTSIDE);
  });
});
