// Wave 48 (C1): the Password Manager's filter, pure.
import { describe, expect, it } from "vitest";
import { FILTER_STEMS, filterHits, hitList, maskText } from "../src/language-filter.ts";

const words = (text: string) => filterHits(text).map((h) => h.word);

describe("filterHits", () => {
  it("flags a stem anywhere inside a word (the user's examples)", () => {
    expect(words("my password is rump")).toEqual(["password", "rump"]);
    expect(words("Hello! Check the button on Saturday")).toEqual(["hello", "check", "button", "saturday"]);
    expect(words("a trumpet and a cocktail")).toEqual(["trumpet", "cocktail"]);
  });

  it("leaves a clean line alone", () => {
    expect(filterHits("Where is Trabolta? I scanned the QR in the kitchen.")).toEqual([]);
    expect(filterHits("")).toEqual([]);
    expect(filterHits("🎉 1234 $100 *** ...")).toEqual([]);
  });

  it("folds case and reads the look-alikes", () => {
    expect(words("SHIT")).toEqual(["shit"]);
    expect(words("a$$ and @ss")).toEqual(["a$$", "@ss"]);
    expect(words("sh1t h3ll0 he11")).toEqual(["sh1t", "h3ll0", "he11"]);
  });

  it("catches a self-censored word, but a * never starts or ends a stem", () => {
    expect(words("what the f*ck, f**k, sh*t")).toEqual(["f*ck", "f**k", "sh*t"]);
    expect(words("**text** and *uck")).toEqual([]);
  });

  it("counts a word once, with every stem inside it merged where they touch", () => {
    const [h] = filterHits("assass");
    expect(h!.stems).toEqual([{ start: 0, end: 6 }]);
    expect(filterHits("bullshitass")[0]!.stems).toEqual([{ start: 4, end: 11 }]);
    expect(filterHits("shitbutass")[0]!.stems).toEqual([
      { start: 0, end: 4 },
      { start: 7, end: 10 },
    ]);
  });

  it("gives offsets into the line as typed", () => {
    const text = "Hi, my Password!";
    const [h] = filterHits(text);
    expect(text.slice(h!.start, h!.end)).toBe("Password");
    expect(text.slice(h!.stems[0]!.start, h!.stems[0]!.end)).toBe("ass");
  });

  it("keeps an inner apostrophe and drops the outer ones", () => {
    const [h] = filterHits("'hell's'");
    expect(h!.word).toBe("hell's");
    expect(h!.start).toBe(1);
  });

  it("reads other scripts' letters as words", () => {
    expect(words("café crème")).toEqual([]);
    expect(words("Привет hello")).toEqual(["hello"]);
  });
});

describe("maskText", () => {
  it("turns each stem's characters into *", () => {
    const text = "my password, hello and Saturday";
    expect(maskText(text, filterHits(text))).toBe("my p***word, ****o and Sa****ay");
  });

  it("leaves the line alone with no hits", () => {
    expect(maskText("all clean", [])).toBe("all clean");
  });
});

describe("hitList", () => {
  it("reads the words as the story's list", () => {
    expect(hitList(filterHits("Hello, Password"))).toBe("hello, password");
  });
});

describe("FILTER_STEMS", () => {
  it("is lower case, unique and has the user's examples", () => {
    expect(new Set(FILTER_STEMS).size).toBe(FILTER_STEMS.length);
    for (const s of FILTER_STEMS) expect(s).toBe(s.toLowerCase());
    expect(FILTER_STEMS).toContain("ass");
    expect(FILTER_STEMS).toContain("rump");
  });
});
