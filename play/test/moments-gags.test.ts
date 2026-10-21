//! Wave 18, the moments lane (GUEST-SPEC §4.2, the user's Q3): the Recycle
//! Bin gags are a pure function of the rows' seqs, so a tester can predict
//! which one plays.

import { describe, expect, it } from "vitest";
import { GAG_COPY, clearGag, gagFor, gagTitle, mostFrequentCaption } from "../src/moments/delete-gags.ts";

describe("✕ on a row", () => {
  it("asks first one time in four (seq % 4 === 0); a client-made row never asks", () => {
    expect([0, 1, 2, 3, 4, 8, 13].map(gagFor)).toEqual(["confirm", "none", "none", "none", "confirm", "confirm", "none"]);
    expect(gagFor(null)).toBe("none");
  });

  it("the confirm and the in-use error, verbatim, the title cut at 40 characters", () => {
    expect(GAG_COPY.confirmTitle).toBe("Confirm File Delete");
    expect(GAG_COPY.confirm("You won a Bingo Ribbon.")).toBe("Are you sure you want to send 'You won a Bingo Ribbon.' to the Recycle Bin?");
    expect(GAG_COPY.inUse("Norton has found you.")).toBe("Cannot delete 'Norton has found you.': This item is in use.");
    const long = "Time is up. Return to the Desktop for the First Moment of Truth.";
    expect(gagTitle(long)).toHaveLength(40);
    expect(gagTitle(long).endsWith("…")).toBe(true);
  });
});

describe("Clear all", () => {
  it("how it ends is (n + firstSeq) % 3", () => {
    expect(clearGag(14, 100)).toBe((14 + 100) % 3);
    expect([clearGag(3, 0), clearGag(4, 0), clearGag(5, 0)]).toEqual([0, 1, 2]);
  });

  it("the copy of every step", () => {
    expect(GAG_COPY.clearTitle).toBe("Confirm Multiple File Delete");
    expect(GAG_COPY.clear(14)).toBe("Are you sure you want to delete these 14 items?");
    expect(GAG_COPY.deletingTitle).toBe("Deleting…");
    expect(GAG_COPY.progress(7, 14)).toBe("7 of 14");
    expect(GAG_COPY.denied("Trabolta")).toBe("Cannot delete 'Trabolta': Access is denied.");
    expect(GAG_COPY.beans).toBe("The Recycle Bin is full of beans.");
    expect(GAG_COPY.emptyPast).toBe("The Recycle Bin is empty. So is your past.");
    expect(GAG_COPY.empty).toBe("The Recycle Bin is empty. Nothing has interrupted you yet.");
  });

  it("'Access is denied' keeps the rows with the most frequent caption (ties: the first met)", () => {
    expect(mostFrequentCaption(["Clippy", "Trabolta", "Trabolta", "Clippy", "Trabolta"])).toBe("Trabolta");
    expect(mostFrequentCaption(["Clippy", "Trabolta"])).toBe("Clippy");
    expect(mostFrequentCaption([])).toBeNull();
  });
});
