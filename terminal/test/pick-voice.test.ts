import { describe, expect, it } from "vitest";
import { pickVoice, rankVoices, scoreVoice, type VoiceLike } from "../src/speech/pick-voice.ts";

const v = (name: string, lang = "en-US", extra: Partial<VoiceLike> = {}): VoiceLike => ({ name, lang, localService: true, default: false, voiceURI: name, ...extra });

describe("voice ranking", () => {
  it("prefers the neural / premium voices, then the good classics, and drops novelty voices", () => {
    const voices = [v("Fred"), v("Samantha"), v("Microsoft Aria Online (Natural) - English (United States)", "en-US", { localService: false }), v("Zarvox"), v("Daniel (Enhanced)", "en-GB"), v("Google US English")];
    const ranked = rankVoices(voices).map((x) => x.name);
    expect(ranked[0]).toContain("Aria");
    expect(ranked).not.toContain("Zarvox");
    expect(ranked.indexOf("Samantha")).toBeLessThan(ranked.indexOf("Fred") === -1 ? Infinity : ranked.indexOf("Fred"));
    expect(ranked.indexOf("Daniel (Enhanced)")).toBeLessThan(ranked.indexOf("Google US English"));
  });
  it("never picks another language", () => {
    expect(scoreVoice(v("Amélie", "fr-CA"))).toBe(-1);
    expect(rankVoices([v("Amélie", "fr-CA"), v("Thomas", "fr-FR")])).toEqual([]);
    expect(scoreVoice(v("Daniel", "en-GB"))).toBeGreaterThan(0);
  });
  it("an explicit choice wins while it exists, else the best", () => {
    const voices = [v("Samantha"), v("Fred", "en-US", { voiceURI: "com.apple.fred" })];
    expect(pickVoice(voices, "com.apple.fred")?.name).toBe("Fred");
    expect(pickVoice(voices, "Fred")?.name).toBe("Fred");
    expect(pickVoice(voices, "Gone")?.name).toBe("Samantha");
    expect(pickVoice(voices, null)?.name).toBe("Samantha");
    expect(pickVoice([], null)).toBeNull();
  });
});
