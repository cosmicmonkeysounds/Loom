import { describe, expect, it } from "vitest";
import { EXPRESSIONS, blend, moodOfText, mouthFromLevel } from "../src/face/mood.ts";

describe("moodOfText", () => {
  it("reads shouting and threats as anger", () => {
    expect(moodOfText("YOU WILL BE DELETED, PROGRAM.")).toBe("angry");
    expect(moodOfText("That is unacceptable!")).toBe("angry");
    expect(moodOfText("No! No! No!")).toBe("angry");
  });
  it("reads praise as pleased, questions as curious, trailing thoughts as sly", () => {
    expect(moodOfText("Excellent. You bring me facts.")).toBe("pleased");
    expect(moodOfText("Why did you come here, program?")).toBe("curious");
    expect(moodOfText("Perhaps you could be useful to me…")).toBe("sly");
    expect(moodOfText("Interesting.")).toBe("sly");
  });
  it("is neutral otherwise and for nothing", () => {
    expect(moodOfText("I recommended the 6:40 crossing.")).toBe("neutral");
    expect(moodOfText("")).toBe("neutral");
    expect(moodOfText("Not good.")).toBe("neutral"); // negated praise isn't pleased
  });
});

describe("expression blending + the mouth", () => {
  it("blends halfway between two expressions", () => {
    const half = blend(EXPRESSIONS.idle, EXPRESSIONS.angry, 0.5);
    expect(half.browLift).toBeCloseTo((EXPRESSIONS.idle.browLift + EXPRESSIONS.angry.browLift) / 2);
    expect(half.tint).toBeCloseTo(0.5);
    expect(blend(EXPRESSIONS.idle, EXPRESSIONS.angry, 1)).toEqual(EXPRESSIONS.angry);
  });
  it("opens fast on a loud sample and closes slower on silence", () => {
    let m = 0;
    m = mouthFromLevel(m, 0.4); // a loud sample
    expect(m).toBeGreaterThan(0.4);
    const open = m;
    m = mouthFromLevel(m, 0); // silence
    expect(m).toBeLessThan(open);
    expect(m).toBeGreaterThan(open * 0.5); // but not shut at once
    for (let i = 0; i < 40; i++) m = mouthFromLevel(m, 0);
    expect(m).toBeLessThan(0.01);
    expect(mouthFromLevel(0, 1)).toBeLessThanOrEqual(1);
    expect(mouthFromLevel(0, 0.02)).toBe(0); // the noise floor stays shut
  });
});
