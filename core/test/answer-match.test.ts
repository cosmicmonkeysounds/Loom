//! Near-miss matching (wave 11, C6; `src/answer-match.ts`): which typed
//! answers are close enough to a key that a director should look before the
//! judge calls them a lie or a guess. Tables of near / not-near pairs.

import { describe, expect, it } from "vitest";

import { damerau, nearMatch, nearTokens } from "../src/answer-match.ts";

describe("nearMatch", () => {
  const near: Array<[string, string, string]> = [
    // [key, answer, why]
    ["Mister Pickles", "Mr. Pickles", "honorific spelled short"],
    ["Mister Pickles", "Mr Pickels", "honorific + a transposition"],
    ["Mister Pickles", "Pickles", "honorific dropped"],
    ["Mr. Pickles", "Dr Pickles", "another honorific"],
    ["Mister Pickles", "mister pickle", "plural"],
    ["Hopelessly Devoted to You", "hopelessly devoted to yu", "one deletion"],
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
    ["you are the one that I want", "you are the one that i wnat", "a transposition in a long line"],
    ["Mister Pickles", "Mister Pickles", "exact is near too"],
    ["Mr. Pickles", "mrpickles", "a missing space after the honorific"],
  ];
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
  ];
  it.each(near)("%s ≈ %s (%s)", (key, answer) => {
    expect(nearMatch(key, answer)).toBe(true);
  });
  it.each(far)("%s ≉ %s (%s)", (key, answer) => {
    expect(nearMatch(key, answer)).toBe(false);
  });
  it("is symmetric on the tables", () => {
    for (const [k, a] of near) expect(nearMatch(a, k)).toBe(true);
    for (const [k, a] of far) expect(nearMatch(a, k)).toBe(false);
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
