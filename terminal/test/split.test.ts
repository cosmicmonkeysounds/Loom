import { describe, expect, it } from "vitest";
import { revealOffsets, speakable, splitSentences } from "../src/speech/split.ts";

describe("a title's stop ends no sentence (wave 58)", () => {
  it("keeps Jr. and Sr. inside their sentence", () => {
    expect(splitSentences("Mayor Randy Barkmore Jr. could proceed with the data centre. Then it fell.")).toEqual(["Mayor Randy Barkmore Jr. could proceed with the data centre.", "Then it fell."]);
    expect(splitSentences("In Grade Six, Randy Jr. defeated her.")).toEqual(["In Grade Six, Randy Jr. defeated her."]);
  });
});

describe("speakable", () => {
  it("strips markdown, stage directions, links and emoji", () => {
    expect(speakable("*static crackles* I have been **expecting** you, `program`.")).toBe("static crackles I have been expecting you, program.");
    expect(speakable("Read this: https://example.com/x?y=1 now")).toBe("Read this: link now");
    expect(speakable("Well… I wonder... 🤖")).toBe("Well, I wonder");
    expect(speakable("WHAT!!! Really??")).toBe("WHAT! Really?");
  });
  it("speaks a spaced em or en dash as a pause (wave 26, V2), never a hyphen", () => {
    expect(speakable("Beans. Those are — those are symptoms.")).toBe("Beans. Those are, those are symptoms.");
    expect(speakable("Wait – no.")).toBe("Wait, no.");
    expect(speakable("Norton Anti-Virus, 1999—2001")).toBe("Norton Anti-Virus, 1999—2001");
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
  it("still reveals up to the original's dash text (wave 26, V2)", () => {
    const text = "I wanted omnipotence — for Sandy. Nothing else has worked.";
    const chunks = splitSentences(text);
    expect(chunks).toEqual(["I wanted omnipotence, for Sandy.", "Nothing else has worked."]);
    const offs = revealOffsets(text, chunks);
    expect(text.slice(0, offs[0])).toBe("I wanted omnipotence — for Sandy.");
    expect(offs[1]).toBe(text.length);
  });
  it("always ends at the full text, even when a chunk can't be located", () => {
    const text = "🤖🤖🤖 and so on";
    const offs = revealOffsets(text, ["zzz", "and so on"]);
    expect(offs[offs.length - 1]).toBe(text.length);
    expect(offs.length).toBe(2);
  });
});

describe("old Safari (OB-1)", () => {
  it("no source file uses a regex lookbehind (Safari before 16.4 throws on one when it runs)", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = fileURLToPath(new URL("../src", import.meta.url));
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.(ts|tsx)$/u.test(f) ? [join(d, f)] : []));
    const hits = walk(root).filter((f) => /\(\?<[=!]/u.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
