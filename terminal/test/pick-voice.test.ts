import { describe, expect, it } from "vitest";
import { ANNOUNCE_VOICE, CHARACTER_VOICE, pickVoice, rankVoices, scoreVoice, voiceGender, type VoiceLike } from "../src/speech/pick-voice.ts";

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
  it("on the house Mac's Chrome (view=tv): a good macOS English voice, never a novelty one", () => {
    const mac = [
      v("Albert"),
      v("Bad News"),
      v("Bells"),
      v("Fred"),
      v("Samantha", "en-US", { default: true }),
      v("Daniel", "en-GB"),
      v("Karen", "en-AU"),
      v("Moira", "en-IE"),
      v("Thomas", "fr-FR"),
      v("Google US English", "en-US", { localService: false }),
      v("Google UK English Male", "en-GB", { localService: false }),
    ];
    expect(pickVoice(mac, null)?.name).toBe("Samantha");
    const ranked = rankVoices(mac).map((x) => x.name);
    for (const novelty of ["Albert", "Bad News", "Bells", "Fred", "Thomas"]) expect(ranked).not.toContain(novelty);
    // A downloaded Premium / Enhanced voice beats the stock one.
    expect(pickVoice([...mac, v("Ava (Premium)")], null)?.name).toBe("Ava (Premium)");
    expect(pickVoice([...mac, v("Evan (Enhanced)")], null)?.name).toBe("Evan (Enhanced)");
  });
  it("the character and the announcements never share a voice on the house Mac (Trabolta ≠ the house)", () => {
    const mac = [
      v("Samantha", "en-US", { default: true }),
      v("Daniel", "en-GB"),
      v("Fred"),
      v("Albert"),
      v("Karen", "en-AU"),
      v("Moira", "en-IE"),
      v("Rishi", "en-IN"),
      v("Tessa", "en-ZA"),
      v("Google US English", "en-US", { localService: false }),
      v("Google UK English Male", "en-GB", { localService: false }),
    ];
    const trabolta = pickVoice(mac, null, CHARACTER_VOICE)!;
    const house = pickVoice(mac, null, ANNOUNCE_VOICE)!;
    expect(trabolta.name).toBe("Daniel");
    expect(house.name).toBe("Samantha"); // the house Mac's own `say_voice`
    expect(voiceGender(trabolta)).toBe("male");
    // A US male voice, when installed, beats the British one; a premium female one never wins for him.
    expect(pickVoice([...mac, v("Evan (Enhanced)")], null, CHARACTER_VOICE)?.name).toBe("Evan (Enhanced)");
    expect(pickVoice([...mac, v("Ava (Premium)")], null, CHARACTER_VOICE)?.name).toBe("Daniel");
    expect(pickVoice([...mac, v("Ava (Premium)")], null, ANNOUNCE_VOICE)?.name).toBe("Ava (Premium)");
    // A lean ranks; it never drops a voice nor lets a novelty one in.
    expect(rankVoices(mac, CHARACTER_VOICE).map((x) => x.name)).toContain("Samantha");
    expect(rankVoices(mac, CHARACTER_VOICE).map((x) => x.name)).not.toContain("Fred");
    // An explicit pick still wins.
    expect(pickVoice(mac, "Samantha", CHARACTER_VOICE)?.name).toBe("Samantha");
  });
  it("reads a voice's lean off its name", () => {
    expect(voiceGender(v("Google UK English Male"))).toBe("male");
    expect(voiceGender(v("Google UK English Female"))).toBe("female");
    expect(voiceGender(v("Google US English"))).toBe("female");
    expect(voiceGender(v("Microsoft Guy Online (Natural) - English (United States)"))).toBe("male");
    expect(voiceGender(v("Microsoft Aria Online (Natural) - English (United States)"))).toBe("female");
    expect(voiceGender(v("en-us-x-sfg-local"))).toBeNull();
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
  it("on Windows Chrome (the TV on John's Desktop): Microsoft David for him, Microsoft Zira for the house", () => {
    const win = [
      v("Microsoft David - English (United States)", "en-US", { default: true }),
      v("Microsoft Mark - English (United States)"),
      v("Microsoft Zira - English (United States)"),
      v("Google US English", "en-US", { localService: false }),
      v("Google UK English Female", "en-GB", { localService: false }),
      v("Google UK English Male", "en-GB", { localService: false }),
      v("Google français", "fr-FR", { localService: false }),
    ];
    const trabolta = pickVoice(win, null, CHARACTER_VOICE)!;
    const house = pickVoice(win, null, ANNOUNCE_VOICE)!;
    expect(trabolta.name).toBe("Microsoft David - English (United States)");
    expect(house.name).toBe("Microsoft Zira - English (United States)"); // local, ahead of the streamed Google voice
    expect(voiceGender(house)).toBe("female");
    expect(voiceGender(v("Microsoft Mark - English (United States)"))).toBe("male");
    // Without David, Mark; the local voices before any streamed one, both ways.
    expect(pickVoice(win.slice(1), null, CHARACTER_VOICE)?.name).toBe("Microsoft Mark - English (United States)");
    expect(rankVoices(win, CHARACTER_VOICE).slice(0, 2).every((x) => x.localService)).toBe(true);
    // A British desktop: Hazel is female, George male.
    expect(voiceGender(v("Microsoft Hazel - English (United Kingdom)", "en-GB"))).toBe("female");
    expect(voiceGender(v("Microsoft George - English (United Kingdom)", "en-GB"))).toBe("male");
  });
  it("in Edge on Windows: the Natural voices win, Guy for him and Aria / Jenny for the house", () => {
    const edge = [
      v("Microsoft David - English (United States)", "en-US", { default: true }),
      v("Microsoft Zira - English (United States)"),
      v("Microsoft Guy Online (Natural) - English (United States)", "en-US", { localService: false }),
      v("Microsoft Aria Online (Natural) - English (United States)", "en-US", { localService: false }),
      v("Microsoft Jenny Online (Natural) - English (United States)", "en-US", { localService: false }),
    ];
    expect(pickVoice(edge, null, CHARACTER_VOICE)?.name).toContain("Guy");
    expect(pickVoice(edge, null, ANNOUNCE_VOICE)?.name).toMatch(/Aria|Jenny/);
  });
});
