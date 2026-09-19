import { describe, expect, it } from "vitest";
import { revealOffsets, speakable, splitSentences } from "../src/speech/split.ts";

describe("speakable", () => {
  it("strips markdown, stage directions, links and emoji", () => {
    expect(speakable("*static crackles* I have been **expecting** you, `program`.")).toBe("static crackles I have been expecting you, program.");
    expect(speakable("Read this: https://example.com/x?y=1 now")).toBe("Read this: link now");
    expect(speakable("Well… I wonder... 🤖")).toBe("Well, I wonder");
    expect(speakable("WHAT!!! Really??")).toBe("WHAT! Really?");
  });
});

describe("splitSentences", () => {
  it("splits at sentence ends and line breaks", () => {
    expect(splitSentences("Hello, program. I have been expecting you! Sit down.\nWe have work.")).toEqual([
      "Hello, program.",
      "I have been expecting you!",
      "Sit down.",
      "We have work.",
    ]);
  });
  it("merges tiny fragments into a neighbour so the voice doesn't stutter", () => {
    expect(splitSentences("Hm. Yes. That is a very interesting proposition indeed.")).toEqual(["Hm. Yes.", "That is a very interesting proposition indeed."]);
  });
  it("re-splits an over-long sentence at a clause", () => {
    const long = `${"word ".repeat(30)}and then, ${"more ".repeat(30)}finally end`;
    const parts = splitSentences(long, 120);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(121);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long.replace(/\s+/g, " ").trim());
  });
  it("is empty for nothing to say", () => {
    expect(splitSentences("   ")).toEqual([]);
    expect(splitSentences("🤖 ✨")).toEqual([]);
  });
});

describe("revealOffsets", () => {
  it("maps each chunk's end to an offset in the original text", () => {
    const text = "Hello, program. I have been *expecting* you! Sit down.";
    const chunks = splitSentences(text);
    expect(chunks).toEqual(["Hello, program.", "I have been expecting you!", "Sit down."]);
    const offs = revealOffsets(text, chunks);
    expect(text.slice(0, offs[0])).toBe("Hello, program.");
    expect(text.slice(0, offs[1])).toBe("Hello, program. I have been *expecting* you!");
    expect(offs[2]).toBe(text.length);
  });
  it("always ends at the full text, even when a chunk can't be located", () => {
    const text = "🤖🤖🤖 and so on";
    const offs = revealOffsets(text, ["zzz", "and so on"]);
    expect(offs[offs.length - 1]).toBe(text.length);
    expect(offs.length).toBe(2);
  });
});
