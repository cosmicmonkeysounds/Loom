import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRONOUNCE, pronounce } from "../src/speech/lexicon.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COPIES = ["terminal/src/speech/pronounce.json", "stagehand/src/stagehand/pronounce.json", "reinstall/vr/config/pronounce.json"];

describe("pronounce (wave 26, V3; C10)", () => {
  it("says Antivirus as Anti Virus, in every case, the text unchanged around it", () => {
    expect(pronounce("Antivirus, you know what to do.")).toBe("Anti Virus, you know what to do.");
    expect(pronounce("the antivirus")).toBe("the Anti Virus");
    expect(pronounce("ANTIVIRUS!")).toBe("Anti Virus!");
    expect(pronounce("Everyone to the Internet. Antivirus too.")).toBe("Everyone to the Internet. Anti Virus too.");
  });
  it("the longest word wins: Antiviruses", () => {
    expect(pronounce("Antiviruses, march.")).toBe("Anti Viruses, march.");
    expect(pronounce("antiviruses")).toBe("Anti Viruses");
  });
  it("a whole word only: the boundary is anything but [A-Za-z0-9]", () => {
    expect(pronounce("the Antivirus' booth")).toBe("the Anti Virus' booth"); // the possessive
    expect(pronounce("(Antivirus)")).toBe("(Anti Virus)");
    expect(pronounce("éAntivirus")).toBe("éAnti Virus"); // é is not [A-Za-z0-9]
    expect(pronounce("Antivirus2")).toBe("Antivirus2");
    expect(pronounce("NotAntivirus")).toBe("NotAntivirus");
    expect(pronounce("Antivirusy")).toBe("Antivirusy");
    expect(pronounce("Antiviruss")).toBe("Antiviruss");
  });
  it("never touches the program names: Anti-Virus has a hyphen", () => {
    expect(pronounce("Norton Anti-Virus")).toBe("Norton Anti-Virus");
    expect(pronounce("McAfee Anti-Virus and the Antivirus")).toBe("McAfee Anti-Virus and the Anti Virus");
  });
  it("is idempotent and leaves anything else alone", () => {
    expect(pronounce(pronounce("Antivirus"))).toBe("Anti Virus");
    expect(pronounce("")).toBe("");
    expect(pronounce("HELLO, PROGRAMS.")).toBe("HELLO, PROGRAMS.");
  });
  it("reads its table (an empty one changes nothing)", () => {
    expect(pronounce("Antivirus", { version: 1, words: [] })).toBe("Antivirus");
    expect(pronounce("Truthcoin", { version: 1, words: [{ word: "Truthcoin", say: "Truth coin" }] })).toBe("Truth coin");
  });
});

describe("the three copies of pronounce.json (C10)", () => {
  it("are byte for byte the same", () => {
    const [first, ...rest] = COPIES.map((p) => readFileSync(join(root, p)));
    for (const [i, b] of rest.entries()) expect(b.equals(first!), COPIES[i + 1]).toBe(true);
  });
  it("hold the contract's table", () => {
    expect(PRONOUNCE.version).toBe(1);
    expect(PRONOUNCE.words).toEqual([
      { word: "Antiviruses", say: "Anti Viruses" },
      { word: "Antivirus", say: "Anti Virus" },
    ]);
    expect(JSON.parse(readFileSync(join(root, COPIES[0]!), "utf8"))).toEqual(PRONOUNCE);
  });
});
