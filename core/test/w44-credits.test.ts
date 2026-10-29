// Wave 44 (C4): the credits file's parser and the roll the clients draw.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDITS_MAX, creditsProblems, creditsRollMs, creditsRows, creditsView, parseCredits } from "../src/credits.ts";

const SHOW = new URL("../examples/trapped-in-the-internet/credits.json", import.meta.url);

describe("parseCredits", () => {
  it("reads the show's credits.json with no problems", () => {
    const text = readFileSync(SHOW, "utf8");
    expect(creditsProblems(text)).toEqual([]);
    const { file } = parseCredits(text);
    expect(file?.title).toBe("Trapped in the Internet");
    expect(file?.sections.some((s) => s.programs === true)).toBe(true);
  });

  it("refuses what it can't use, with where", () => {
    expect(parseCredits("{").file).toBeNull();
    expect(parseCredits("[]").problems).toEqual(["credits.json must be an object"]);
    expect(parseCredits(`{"sections": []}`).problems).toContain("title: a non-empty string is required");
    expect(parseCredits(`{"title": "T"}`).problems).toContain("sections: a list is required");
  });

  it("skips a bad row and says so", () => {
    const { file, problems } = parseCredits(JSON.stringify({ title: "T", sections: [{ heading: "Cast", people: [{ role: "Clippy" }, { role: "Bin", name: "Jesse" }] }, { nope: 1 }] }));
    expect(file?.sections).toHaveLength(1);
    expect(file?.sections[0]!.people).toEqual([{ role: "Bin", name: "Jesse" }]);
    expect(problems).toEqual([`sections[0].people[0]: needs "role" and "name" strings`, `sections[1]: needs a "heading" string`]);
  });
});

describe("creditsView", () => {
  const file = {
    title: " T ",
    subtitle: "",
    sections: [
      { heading: "Cast", people: [{ role: "Clippy", name: "Brooke" }, { role: "McAfee", name: "  " }] },
      { heading: "Empty", people: [{ role: "Nobody", name: "" }] },
      { heading: "Programs", programs: true },
      { heading: "Thanks", lines: ["You.", " "] },
    ],
    end: ["Thank you.", ""],
  };

  it("drops blank names and empty sections, and fills the programs", () => {
    const v = creditsView(file, ["Zune", "aol", "Zune ", "", "AOL"], 2);
    expect(v.title).toBe("T");
    expect(v.subtitle).toBeNull();
    expect(v.roll).toBe(2);
    expect(v.sections.map((s) => s.heading)).toEqual(["Cast", "Programs", "Thanks"]);
    expect(v.sections[0]!.people).toEqual([{ role: "Clippy", name: "Brooke" }]);
    expect(v.sections[1]).toEqual({ heading: "Programs", people: [], lines: ["aol", "Zune"], programs: true });
    expect(v.end).toEqual(["Thank you."]);
  });

  it("drops a programs section on a night with nobody", () => {
    expect(creditsView(file, []).sections.map((s) => s.heading)).toEqual(["Cast", "Thanks"]);
  });

  it("caps what a phone is handed", () => {
    const many = Array.from({ length: CREDITS_MAX.programs + 50 }, (_, i) => `Program ${String(i).padStart(4, "0")}`);
    const v = creditsView({ title: "x".repeat(500), sections: [{ heading: "P", programs: true }] }, many);
    expect(v.title).toHaveLength(CREDITS_MAX.title);
    expect(v.sections[0]!.lines).toHaveLength(CREDITS_MAX.programs);
  });
});

describe("creditsRows / creditsRollMs", () => {
  it("lays the roll out title first, a gap before each section", () => {
    const v = creditsView({ title: "T", subtitle: "S", sections: [{ heading: "Cast", people: [{ role: "Clippy", name: "Brooke" }], lines: ["and you"] }] }, []);
    expect(creditsRows(v)).toEqual([
      { kind: "title", text: "T" },
      { kind: "subtitle", text: "S" },
      { kind: "gap" },
      { kind: "heading", text: "Cast" },
      { kind: "person", role: "Clippy", name: "Brooke" },
      { kind: "line", text: "and you" },
    ]);
  });

  it("paces the roll within its floor and ceiling", () => {
    expect(creditsRollMs(1)).toBe(20_000);
    expect(creditsRollMs(100)).toBe(110_000);
    expect(creditsRollMs(10_000)).toBe(360_000);
  });
});
