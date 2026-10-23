import { describe, expect, it } from "vitest";
import { FILES_IDLE_MS, HEART_IDLE_MS, HEART_WARN_MS, IDLE_MS, WARN_MS, lineLeash } from "../src/idle.ts";
import { chooseBody, composerShown, doorOverlayOn, heartMenuOf, heartTouched, isChatMenu, isStaleChoice, menusOf, panelModel, pilotEndFor, splitTag, type HeartMenu } from "../src/heart/heart.ts";

const stale: HeartMenu = { id: 40, beat: "The Tablet Video", channel: "dm:Trabolta", options: ["Where is the exit?"] };
const layerOne: HeartMenu = { id: 212, beat: "Heart Layer One", channel: "dm:Trabolta", options: ["I'm a person. You put me in here.", "⟦MARKED⟧ The Antivirus marked me. I came down here anyway.", "⟦SPEAK FREELY⟧ Forget the questions. Talk to me.", "I need to go."] };
const back: HeartMenu = { id: 230, beat: "Heart Talk", channel: "dm:Trabolta", options: ["⟦BACK⟧ Let's go back to it."] };

describe("the heart menu (D18)", () => {
  it("is the newest Heart … menu on dm:<character>, never the stale oldest one", () => {
    expect(heartMenuOf([stale, layerOne], "Trabolta")).toBe(layerOne);
    expect(heartMenuOf([layerOne, { ...layerOne, id: 300, beat: "Heart Layer Two" }], "Trabolta")?.id).toBe(300);
    expect(heartMenuOf([stale], "Trabolta")).toBeNull();
    expect(heartMenuOf([{ ...layerOne, channel: "dm:Clippy" }], "Trabolta")).toBeNull();
    expect(heartMenuOf([{ ...layerOne, beat: "Hearth Song" }], "Trabolta")).toBeNull(); // folds to "hearth song": not "heart …"
    expect(heartMenuOf([{ ...layerOne, beat: "heart_pick" }], "Trabolta")).not.toBeNull();
  });

  it("reads the view's choices generously (an older server sends none)", () => {
    expect(menusOf({ pendingChoice: ["x"] })).toEqual([]);
    expect(menusOf(null)).toEqual([]);
    expect(menusOf({ choices: [layerOne, { id: "x" }, { ...back, options: ["⟦BACK⟧ ok", 7] }] })).toEqual([layerOne, { ...back, options: ["⟦BACK⟧ ok"] }]);
  });
});

describe("the choice panel's model", () => {
  it("splits a leading ⟦TAG⟧ off as a chip", () => {
    expect(splitTag("⟦PROOF⟧ Hold up what she says.")).toEqual({ tag: "PROOF", text: "Hold up what she says." });
    expect(splitTag("I need to go.")).toEqual({ tag: null, text: "I need to go." });
    expect(splitTag("Not a ⟦TAG⟧ here")).toEqual({ tag: null, text: "Not a ⟦TAG⟧ here" });
  });

  it("knows the ⟦BACK⟧ menu of a heart to heart", () => {
    expect(isChatMenu(back)).toBe(true);
    expect(isChatMenu(layerOne)).toBe(false);
    expect(isChatMenu({ ...back, options: ["⟦BACK⟧ x", "y"] })).toBe(false);
    expect(isChatMenu(null)).toBe(false);
  });

  it("greys the options while the door is open", () => {
    expect(panelModel(layerOne, true)?.greyed).toBe(true);
    expect(panelModel(layerOne, false)?.greyed).toBe(false);
    expect(panelModel(layerOne, null)?.greyed).toBe(false);
    expect(panelModel(layerOne, false)?.options[1]).toEqual({ index: 1, raw: layerOne.options[1], tag: "MARKED", text: "The Antivirus marked me. I came down here anyway." });
    expect(panelModel(back, false)?.chat).toBe(true);
    expect(panelModel(null, false)).toBeNull();
  });

  it("answers by index, the shown text and the menu's id (D15)", () => {
    expect(chooseBody(layerOne, 2)).toEqual({ index: 2, text: "⟦SPEAK FREELY⟧ Forget the questions. Talk to me.", choice: 212 });
    expect(isStaleChoice(409, "moved")).toBe(true);
    expect(isStaleChoice(409, "no choice")).toBe(true);
    expect(isStaleChoice(409, "doors are closed")).toBe(false);
    expect(isStaleChoice(500, "moved")).toBe(false);
  });
});

describe("the composer (D23, D28)", () => {
  it("keys × menu docked × heart to heart", () => {
    expect(composerShown({ keys: true, menu: null })).toBe(true); // no menu: type
    expect(composerShown({ keys: true, menu: layerOne })).toBe(false); // a tree menu: click it
    expect(composerShown({ keys: true, menu: back })).toBe(true); // the heart to heart: type
    expect(composerShown({ keys: false, menu: null })).toBe(false); // mouse-only rig
    expect(composerShown({ keys: false, menu: layerOne })).toBe(false);
    expect(composerShown({ keys: false, menu: back })).toBe(false);
  });
});

describe("the leash", () => {
  it("is the normal 30 s, the file panel's 120 s, the heart's 180 s, held while answering or the door is open", () => {
    expect(lineLeash({ answering: false, filesOpen: false })).toEqual({ busy: false, limit: IDLE_MS, warnMs: WARN_MS });
    expect(lineLeash({ answering: true, filesOpen: false }).busy).toBe(true);
    expect(lineLeash({ answering: false, filesOpen: true }).limit).toBe(FILES_IDLE_MS);
    expect(lineLeash({ answering: false, filesOpen: false, heart: true })).toEqual({ busy: false, limit: HEART_IDLE_MS, warnMs: HEART_WARN_MS });
    expect(lineLeash({ answering: false, filesOpen: true, heart: true }).limit).toBe(HEART_IDLE_MS);
    expect(lineLeash({ answering: false, filesOpen: false, doorOpen: true }).busy).toBe(true);
    expect(lineLeash({ answering: false, filesOpen: false, heart: true, doorOpen: true })).toEqual({ busy: true, limit: HEART_IDLE_MS, warnMs: HEART_WARN_MS });
    expect([HEART_IDLE_MS, HEART_WARN_MS]).toEqual([180_000, 30_000]);
  });

  it("holds long once the heart has played for this line", () => {
    expect(heartTouched({ value: "room_heart_layer_1", at: 2000 }, 1000)).toBe(true);
    expect(heartTouched({ value: "room_heart_layer_1", at: 500 }, 1000)).toBe(false); // before this line
    expect(heartTouched({ value: "room_heart_layer_1", at: 0 }, 0)).toBe(false); // history
    expect(heartTouched({ value: "room_other", at: 2000 }, 1000)).toBe(false);
    expect(heartTouched(null, 0)).toBe(false);
  });
});

describe("the line's end and the door overlay", () => {
  it("an eject ends the line; not yet / leave only on a mouse-only rig (D24)", () => {
    expect(pilotEndFor("room_heart_eject", true)).toEqual({ why: "thrown", ms: 8000 });
    expect(pilotEndFor("room_heart_notyet", true)).toBeNull();
    expect(pilotEndFor("room_heart_leave", true)).toBeNull();
    expect(pilotEndFor("room_heart_notyet", false)).toEqual({ why: "done", ms: 6000 });
    expect(pilotEndFor("room_heart_leave", false)).toEqual({ why: "done", ms: 3000 });
    expect(pilotEndFor("room_heart_layer_1", false)).toBeNull();
  });

  it("CLOSE THE DOOR while the door is open in door / scan / talk", () => {
    for (const stage of ["door", "scan", "talk"]) expect(doorOverlayOn(true, stage)).toBe(true);
    for (const stage of ["sealed", "done", null]) expect(doorOverlayOn(true, stage)).toBe(false);
    expect(doorOverlayOn(false, "talk")).toBe(false);
    expect(doorOverlayOn(null, "talk")).toBe(false);
  });
});

import { DYING_DRAIN_MS, EXPRESSIONS, dyingDrain } from "../src/face/mood.ts";

describe("the dying face (the heart's shutdown)", () => {
  it("droops, lids heavy, the mouth flat, eyes down and cold", () => {
    const d = EXPRESSIONS.dying;
    expect(d.browLift).toBeLessThan(0);
    expect(d.eyeOpen).toBeLessThan(EXPRESSIONS.neutral.eyeOpen);
    expect(d.mouthCurve).toBe(0);
    expect(d.gazeBias.y).toBeGreaterThan(0.5);
    expect(d.tint).toBe(-1);
  });
  it("drains to grey over its time", () => {
    expect(dyingDrain(0)).toBe(0);
    expect(dyingDrain(DYING_DRAIN_MS / 2)).toBeCloseTo(0.5);
    expect(dyingDrain(25_000, 25_000)).toBe(1);
    expect(dyingDrain(99_000, 25_000)).toBe(1);
  });
});
