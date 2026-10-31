//! Near-miss matching (wave 11, C6; `src/answer-match.ts`): which typed
//! answers are close enough to a key that a director should look before the
//! judge calls them a lie or a guess. Tables of near / not-near pairs.

import { describe, expect, it } from "vitest";

import { damerau, mentionsKey, nearMatch, nearTokens, spellOut } from "../src/answer-match.ts";

describe("nearMatch", () => {
  const near: Array<[string, string, string]> = [
    // [key, answer, why]
    ["Mister Pickles", "Mr. Pickles", "honorific spelled short"],
    ["Mister Pickles", "Mr Pickels", "honorific + a transposition"],
    ["Mister Pickles", "Pickles", "honorific dropped"],
    ["Mr. Pickles", "Dr Pickles", "another honorific"],
    ["Mister Pickles", "mister pickle", "plural"],
    ["Mr. Pickles", "Mr Pickels", "the task's own pair"],
    ["Mister Pickles", "Mister Pickels", "a transposition"],
    ["Tabby", "tabbby", "one insertion in a word"],
    ["Hopelessly Devoted to You", "hopelesly devotd to you", "two edits on 8+ chars"],
    ["Grok", "Grko", "a transposition"],
    ["Grok", "Groc", "a substitution"],
    ["Eleven years", "11 years", "number word to digits"],
    ["Eleven years", "11 year", "number word + plural"],
    ["11", "eleven", "digits to a number word"],
    ["1978", "nineteen seventy eight", "a year in words"],
    ["1978", "Nineteen Seventy-Eight", "a year in words, hyphenated"],
    ["1997", "one thousand nine hundred and ninety seven", "a cardinal with scales"],
    ["1997", "1,997", "a thousands separator"],
    ["1,997", "1997", "a thousands separator on the key"],
    ["1905", "nineteen oh five", "oh inside a year"],
    ["Appendix Z Loose Ends", "loose ends appendix z", "token set in another order"],
    ["ext 1978", "1978 ext", "token set with a number"],
    ["Room 101", "Rooom 101", "a spelling slip beside an exact number"],
    ["9 a.m.", "9am", "a.m. run together"],
    ["9 a.m.", "nine am", "an hour in words"],
    ["pickle jar", "picklejar", "a missing space between words"],
    ["you are the one that I want", "you are the one that i wnat", "a transposition in a long line"],
    ["Mister Pickles", "Mister Pickles", "exact is near too"],
    ["Mr. Pickles", "mrpickles", "a missing space after the honorific"],
    // Wave 11 recheck: abbreviations spell out.
    ["Eleven years", "Eleven yrs", "an abbreviation"],
    ["11 years", "11 yrs", "an abbreviation"],
    ["ext 1978", "extension 1978", "an abbreviation on the key"],
    ["9:00", "0900", "a leading-zero clock time"],
  ];
  // [key, answer, why]: the key's words said at length (one way only: a
  // shorter answer than the key is an alias, never a slip).
  const longer: Array<[string, string, string]> = [
    ["11", "11 years ago", "extra words after a number"],
    ["Eleven years", "11 years ago", "extra words after the key"],
    ["1978", "extension 1978", "a word before the number"],
    ["Mister Pickles", "Mister Pickles the cat", "extra words after a name"],
    ["pickles", "pickles was a cat", "an article inside a sentence"],
    ["9:00", "9:00 in the morning", "the hour said at length"],
    ["Grok", "I think Grok", "a lead-in"],
  ];
  const notLonger: Array<[string, string, string]> = [
    ["Grok", "not Grok", "a word that turns it around"],
    ["Grok", "Grok or Gemini", "a hedge"],
    ["front desk", "never a front desk", "a word that turns it around"],
    ["9:00", "9:00 pm", "the half of the day the key leaves open"],
    ["appendix", "Appendix A", "a lone letter is a name"],
    ["Room 101", "Room 101 b", "a lone letter is a name"],
    ["Grok", "Grok is the one who is taking Sandy to prom", "too many extra words"],
    ["9:00 a.m.", "9:00 p.m. in the morning", "p.m. against a.m."],
    ["1978", "extension 1979", "another number"],
  ];
  it.each(longer)("%s ⊂ %s (%s)", (key, answer) => {
    expect(nearMatch(key, answer)).toBe(true);
  });
  it.each(notLonger)("%s ⊄ %s (%s)", (key, answer) => {
    expect(nearMatch(key, answer)).toBe(false);
  });
  const far: Array<[string, string, string]> = [
    ["1997", "1996", "numbers match exactly only"],
    ["1997", "1998", "numbers match exactly only"],
    ["1997", "nineteen ninety six", "a year in words, one off"],
    ["9:00 a.m.", "10:00 a.m.", "a different hour"],
    ["Eleven years", "twelve years", "a different number word"],
    ["Eleven years", "years", "a number missing"],
    ["11", "111", "an extra digit"],
    ["Grok", "Gork the Great", "too far"],
    ["Mister Pickles", "Mister Whiskers", "another name"],
    ["Hopelessly Devoted to You", "hopelessly devoted", "a phrase cut short (an alias, not a slip)"],
    ["Hopelessly Devoted to You", "hopelesly devotd to yuo", "three edits"],
    ["Grok", "Grkoo", "two edits on a short answer"],
    ["ab", "ac", "too short to misspell"],
    ["Tabby", "", "empty"],
    ["Mister Pickles", "Mr", "only an honorific"],
    // Wave 11 review: a short word decides the answer, never swallowed by the
    // words around it.
    ["Appendix Z Loose Ends", "Appendix A Loose Ends", "a one-letter word changed"],
    ["appendix z", "Appendix A", "a one-letter word changed"],
    ["appendix z", "appendix y", "a one-letter word changed"],
    ["didn't understand", "did understand", "the opposite meaning"],
    ["Hopelessly Devoted to You", "hopelessly devoted to yu", "a short word must be exact"],
    ["Grok", "grk", "a short word must be exact"],
    ["Mister Pickles", "Mister Tickles", "another first letter"],
    ["Mister Pickles", "nickles", "another first letter"],
    // A digit inside a word is a number; a.m. / p.m. are exact.
    ["9am", "8am", "another hour inside a word"],
    ["9am", "9pm", "a.m. is not p.m."],
    ["9:00am", "9:00pm", "a.m. is not p.m."],
    ["9:00 a.m.", "9:00 p.m.", "a.m. is not p.m."],
    ["9:00 a.m.", "9 p.m.", "a.m. is not p.m."],
    ["9 a.m.", "nine p.m.", "a.m. is not p.m., in words"],
    ["9 a.m.", "9:00 p.m.", "an extra number and p.m."],
    ["Room 101", "Room101b", "a letter beside a number is a word"],
    ["Appendix Z", "appendixa", "a run-together word must match exactly"],
  ];
  it.each(near)("%s ≈ %s (%s)", (key, answer) => {
    expect(nearMatch(key, answer)).toBe(true);
  });
  it.each(far)("%s ≉ %s (%s)", (key, answer) => {
    expect(nearMatch(key, answer)).toBe(false);
  });
  it("is symmetric on the tables, except a key said at length", () => {
    for (const [k, a] of near) expect(nearMatch(a, k)).toBe(true);
    // A phrase cut short is the one far row whose answer the key holds whole:
    // read the other way round it is the key said at length (`longer`).
    for (const [k, a, why] of far) if (!why.includes("cut short")) expect(nearMatch(a, k)).toBe(false);
    for (const [k, a] of longer) expect(nearMatch(a, k)).toBe(false);
  });
});

describe("nearTokens", () => {
  it("folds, converts number words, joins thousands, singularises and drops honorifics", () => {
    expect(nearTokens("Mr. Pickles!")).toEqual(["pickle"]);
    expect(nearTokens("Nineteen ninety-seven")).toEqual(["1997"]);
    expect(nearTokens("one hundred and five boxes")).toEqual(["105", "box"]);
    expect(nearTokens("1,997 flies")).toEqual(["1997", "fly"]);
    expect(nearTokens("1997 123")).toEqual(["1997", "123"]); // a 4-digit number takes no group
    expect(nearTokens("oh no")).toEqual(["oh", "no"]); // "oh" starts no number
    expect(nearTokens("the virus")).toEqual(["virus"]);
    expect(nearTokens("Mister")).toEqual(["mister"]); // nothing left without it → kept
    expect(nearTokens("9:00am")).toEqual(["9", "00", "am"]); // a digit run is its own token
    expect(nearTokens("9:00 p.m.")).toEqual(["9", "00", "pm"]); // p.m. reads as one word
  });
});

describe("spellOut", () => {
  it("spells out abbreviations and splits a leading-zero clock time; other words and numbers stay", () => {
    expect(spellOut("mr pickles")).toBe("mister pickles");
    expect(spellOut("11 yrs")).toBe("11 years");
    expect(spellOut("ext 1978")).toBe("extension 1978");
    expect(spellOut("0900")).toBe("9 00");
    expect(spellOut("1978")).toBe("1978");
    expect(spellOut("mrs pickles")).toBe("missus pickles"); // never Mister
    expect(spellOut("")).toBe("");
  });
});

describe("damerau", () => {
  it("counts a transposition as one edit", () => {
    expect(damerau("pickles", "pickels")).toBe(1);
    expect(damerau("grok", "grko")).toBe(1);
    expect(damerau("", "abc")).toBe(3);
    expect(damerau("kitten", "sitting")).toBe(3);
  });
});

describe("mentionsKey — a key form named anywhere in a text (the answer-secrecy guard)", () => {
  it("finds the form as a run of words, under the judge's folding and slips", () => {
    expect(mentionsKey("Somebody said Mr. Pickels was first.", "Mister Pickles")).toBe(true);
    expect(mentionsKey("the film came out in nineteen seventy-eight", "1978")).toBe(true);
    expect(mentionsKey("Dial ext. 1978 now", "ext 1978")).toBe(true);
    expect(mentionsKey("Sorry, you didn't answer that.", "you didn't answer that")).toBe(true);
    expect(mentionsKey("GROK'S prom ticket", "Grok")).toBe(true);
    expect(mentionsKey("hopelesly devoted, on repeat", "hopelessly devoted")).toBe(true);
  });
  it("is word-bounded, keeps numbers exact, and gives a short lone word no slip", () => {
    expect(mentionsKey("1979 was the year", "1978")).toBe(false);
    expect(mentionsKey("item 119 in the list", "11")).toBe(false);
    expect(mentionsKey("QUESTIONS TO GROW", "Grok")).toBe(false);
    expect(mentionsKey("a grog at the bar", "Grok")).toBe(false);
    expect(mentionsKey("groks", "Grok")).toBe(true); // a plural (or a possessive) is the word
    expect(mentionsKey("the appendix of the binder", "appendix z")).toBe(false);
    expect(mentionsKey("", "Grok")).toBe(false);
  });
});
