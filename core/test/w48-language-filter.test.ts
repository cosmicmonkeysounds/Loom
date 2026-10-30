// Wave 48 (C1) and 48b (C7, C9, C10): the Password Manager's filter, pure.
// No slur is written here: the slur cases read `FILTER_SLURS`.
import { describe, expect, it } from "vitest";
import {
  BURIED_STEMS,
  FILTER_BANDS,
  FILTER_MULTS,
  FILTER_SLURS,
  FILTER_START_LEVEL,
  UNSAID_WORD,
  atLevel,
  decodeHits,
  encodeHits,
  filterHits,
  heatAfter,
  hitList,
  hitPoints,
  isFilterLevel,
  linePoints,
  maskText,
  maskUnsaid,
  multAt,
  starsFor,
} from "../src/language-filter.ts";

const words = (text: string, level = 100) => filterHits(text, level).map((h) => h.word);
const tiers = (text: string, level = 100) => filterHits(text, level).map((h) => `${h.word}@${h.tier}`);

describe("filterHits at 100 (wave 48's over-eager filter)", () => {
  it("flags a stem anywhere inside a word (the user's examples)", () => {
    expect(words("my password is rump")).toEqual(["password", "rump"]);
    expect(words("Hello! Check the button on Saturday")).toEqual(["hello", "check", "button", "saturday"]);
    expect(words("a trumpet and a cocktail")).toEqual(["trumpet", "cocktail"]);
    expect(words("Password Manager")).toEqual(["password"]);
  });

  it("starts at 100", () => {
    expect(FILTER_START_LEVEL).toBe(100);
    expect(words("hello")).toEqual(["hello"]);
  });

  it("leaves a clean line alone", () => {
    expect(filterHits("Where is Trabolta? I scanned the QR in the kitchen.")).toEqual([]);
    expect(filterHits("")).toEqual([]);
    expect(filterHits("🎉 1234 $100 *** ...")).toEqual([]);
    expect(filterHits("but why")).toEqual([]);
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

  it("counts a word once, with every stem inside it merged where they overlap", () => {
    expect(filterHits("bullshit")[0]!.stems).toEqual([{ start: 4, end: 8, tier: 25 }]);
    expect(filterHits("shitbutass")[0]!.stems.map((s) => [s.start, s.end])).toEqual([
      [0, 4],
      [7, 10],
    ]);
  });

  it("gives offsets into the line as typed", () => {
    const text = "Hi, my Password!";
    const [h] = filterHits(text);
    expect(text.slice(h!.start, h!.end)).toBe("Password");
    expect(text.slice(h!.stems[0]!.start, h!.stems[0]!.end)).toBe("ass");
    const emoji = "😀 hello";
    expect(emoji.slice(filterHits(emoji)[0]!.start)).toBe("hello");
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

describe("the bands (48b, C7)", () => {
  it("gives each word its band", () => {
    expect(tiers("fuck cunt")).toEqual(["fuck@10", "cunt@10"]);
    expect(tiers("shit asshole")).toEqual(["shit@25", "asshole@25"]);
    expect(tiers("crap balls butt")).toEqual(["crap@50", "balls@50", "butt@50"]);
    expect(tiers("hell heck fart")).toEqual(["hell@60", "heck@60", "fart@60"]);
    expect(tiers("Scunthorpe cocktail Dickens")).toEqual(["scunthorpe@75", "cocktail@75", "dickens@75"]);
    expect(tiers("password class button title Saturday document")).toEqual(["password@90", "class@90", "button@90", "title@90", "saturday@90", "document@90"]);
    expect(tiers("hello check shell trumpet")).toEqual(["hello@100", "check@100", "shell@100", "trumpet@100"]);
  });

  it("catches at a strength what that band and every lower one do (the user's examples)", () => {
    const line = "fuck shit crap hell password hello";
    expect(words(line, 0)).toEqual([]);
    expect(words(line, 10)).toEqual(["fuck"]);
    expect(words(line, 25)).toEqual(["fuck", "shit"]);
    expect(words(line, 40)).toEqual(["fuck", "shit"]);
    expect(words(line, 50)).toEqual(["fuck", "shit", "crap"]);
    expect(words(line, 60)).toEqual(["fuck", "shit", "crap", "hell"]);
    expect(words(line, 90)).toEqual(["fuck", "shit", "crap", "hell", "password"]);
    expect(words(line, 100)).toEqual(["fuck", "shit", "crap", "hell", "password", "hello"]);
  });

  it("sees through the dodges a whole word makes (obscenity)", () => {
    expect(tiers("fuuuuck", 10)).toEqual(["fuuuuck@10"]);
    expect(tiers("sh!t happens", 25)).toEqual(["sh!t@25"]);
    expect(tiers("ｆｕｃｋ", 10)).toEqual(["ｆｕｃｋ@10"]);
    expect(tiers("you're an a$$hole", 25)).toEqual(["a$$hole@25"]);
    expect(tiers("Shiiiit", 25)).toEqual(["shiiiit@25"]);
    expect(tiers("bullshit motherfucker", 25)).toEqual(["bullshit@25", "motherfucker@10"]);
    expect(tiers("f*ck sh*t a**hole", 25)).toEqual(["f*ck@10", "sh*t@25", "a**hole@25"]);
  });

  it("never takes an innocent whole word below 75", () => {
    expect(words("Scunthorpe, class, assume, cocktail, hello, but", 60)).toEqual([]);
  });

  it("lists every band once, lowest first, with fewer points as it softens", () => {
    expect(FILTER_BANDS.map((b) => b.tier)).toEqual([0, 10, 25, 50, 60, 75, 90, 100]);
    for (let i = 1; i < FILTER_BANDS.length; i++) expect(FILTER_BANDS[i]!.points).toBeLessThanOrEqual(FILTER_BANDS[i - 1]!.points);
    for (const stems of Object.values(BURIED_STEMS)) for (const s of stems) expect(s).toBe(s.toLowerCase());
    expect(BURIED_STEMS[90]).toContain("ass");
    expect(BURIED_STEMS[100]).toContain("rump");
  });

  it("knows a strength the slider can hold", () => {
    for (const ok of [0, 5, 25, 100]) expect(isFilterLevel(ok)).toBe(true);
    for (const bad of [-5, 3, 105, 2.5, "50", null]) expect(isFilterLevel(bad)).toBe(false);
  });
});

describe("slurs (48b, C9)", () => {
  const a = FILTER_SLURS[9]!;
  const b = FILTER_SLURS[8]!;

  it("catches a slur at every strength, as [slur], never as itself", () => {
    for (const level of [0, 50, 100]) {
      const hits = filterHits(`you ${a} there`, level);
      expect(hits).toHaveLength(1);
      expect(hits[0]!.unsaid).toBe(true);
      expect(hits[0]!.tier).toBe(0);
      expect(hits[0]!.word).toBe(UNSAID_WORD);
    }
    expect(hitList(filterHits(`${a} and hello`))).toBe(`${UNSAID_WORD}, hello`);
  });

  it("sees through a look-alike and a plural", () => {
    const dodged = `${b.replace("a", "4")}s`;
    const hits = filterHits(`and ${dodged}!`, 0);
    expect(hits.map((h) => h.unsaid)).toEqual([true]);
  });

  it("stars a slur's whole word and nothing else (maskUnsaid)", () => {
    const text = `hello ${a}s, password`;
    const masked = maskUnsaid(text, filterHits(text));
    expect(masked).toBe(`hello ${"*".repeat(a.length + 1)}, password`);
    expect(masked).not.toContain(a);
  });

  it("are all lower case and unique", () => {
    expect(new Set(FILTER_SLURS).size).toBe(FILTER_SLURS.length);
    for (const s of FILTER_SLURS) expect(s).toBe(s.toLowerCase());
  });
});

describe("maskText", () => {
  it("turns each stem's characters into *", () => {
    const text = "my password, hello and Saturday";
    expect(maskText(text, filterHits(text))).toBe("my p***word, ****o and Sa****ay");
  });

  it("masks only what a strength catches", () => {
    const text = "hello shit";
    expect(maskText(text, filterHits(text, 25))).toBe("hello ****");
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

describe("atLevel", () => {
  it("re-reads stored hits at a lower strength, and back", () => {
    const hits = filterHits("hello shithead password");
    expect(atLevel(hits, 25).map((h) => h.word)).toEqual(["shithead"]);
    expect(atLevel(hits, 0)).toEqual([]);
    expect(atLevel(atLevel(hits, 90), 100).map((h) => h.word)).toEqual(["shithead", "password"]);
  });
});

describe("the journal form (C8)", () => {
  it("round-trips, slurs included", () => {
    const text = `Password Manager says fuck to the ${FILTER_SLURS[0]}`;
    const hits = filterHits(text);
    const stored = maskUnsaid(text, hits);
    const back = decodeHits(stored, encodeHits(hits));
    expect(back).toEqual(hits);
    expect(back.some((h) => h.word === UNSAID_WORD)).toBe(true);
  });

  it("skips what does not fit the line", () => {
    expect(decodeHits("short", "0-99:0-3.90")).toEqual([]);
    expect(decodeHits("hello", "nonsense;0-5:0-4.7")).toEqual([]);
    expect(decodeHits("hello", "")).toEqual([]);
  });
});

describe("the ⭐ mini-game (C10)", () => {
  it("pays each word its band's points", () => {
    expect(filterHits("fuck shit crap hell password hello").map(hitPoints)).toEqual([8, 5, 3, 2, 1, 1]);
    expect(hitPoints(filterHits(FILTER_SLURS[0]!)[0]!)).toBe(12);
    expect(linePoints(filterHits("shit and hell"))).toBe(7);
  });

  it("cools a notch every 20 s, and the multiplier follows its notch", () => {
    expect(multAt(0)).toBe(3);
    expect(multAt(0.4)).toBe(2);
    expect(multAt(1)).toBe(2);
    expect(multAt(2.5)).toBe(1);
    expect(multAt(99)).toBe(FILTER_MULTS[FILTER_MULTS.length - 1]);
    expect(heatAfter(3, 20_000)).toBe(2);
    expect(heatAfter(1, 60_000)).toBe(0);
    expect(heatAfter(2, -5)).toBe(2);
  });

  it("pays floor(points × mult): a spammed hello pays nothing", () => {
    expect(starsFor(5, 1.5)).toBe(7);
    expect(starsFor(1, 0.25)).toBe(0);
    expect(starsFor(8, 3)).toBe(24);
  });
});
