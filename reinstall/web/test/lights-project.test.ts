import { describe, expect, it } from "vitest";
import { lightsProjectPlan, switchLightsOffer } from "../src/map/project.ts";

const base = { dirty: false, saveable: true, project: true, director: false };

describe("the project bar covers the lights", () => {
  it("Save to project writes lights.json when the lights in force are a director's save, saving page edits first", () => {
    expect(lightsProjectPlan(undefined)).toEqual({ step: "none", skipped: null });
    expect(lightsProjectPlan({ ...base, project: false, director: true })).toEqual({ step: "none", skipped: null });
    expect(lightsProjectPlan(base)).toEqual({ step: "none", skipped: null });
    expect(lightsProjectPlan({ ...base, director: true })).toEqual({ step: "project", skipped: null });
    expect(lightsProjectPlan({ ...base, dirty: true })).toEqual({ step: "save", skipped: null });
    const bad = lightsProjectPlan({ ...base, dirty: true, saveable: false, director: true });
    expect(bad.step).toBe("project");
    expect(bad.skipped).toMatch(/left out/);
    expect(lightsProjectPlan({ ...base, dirty: true, saveable: false }).step).toBe("none");
  });

  it("a variant switch offers to save unsaved light edits first, only when they can be saved", () => {
    expect(switchLightsOffer(base)).toBeNull();
    expect(switchLightsOffer({ ...base, dirty: true })).toMatch(/unsaved light edits/);
    expect(switchLightsOffer({ ...base, dirty: true, saveable: false })).toBeNull();
    expect(switchLightsOffer({ ...base, dirty: true, project: false })).toBeNull();
  });
});
