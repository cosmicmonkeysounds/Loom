import { describe, expect, it } from "vitest";

import { defectTargets, requiredDecision } from "../src/session.ts";
import { channelHead, prettyName, withThe } from "../src/threads.ts";
import type { GuestView } from "../src/types.ts";

describe("names on the phone", () => {
  it("keeps a name the story wrote in mixed case, recases raw ids", () => {
    expect(prettyName("WebMD")).toBe("WebMD");
    expect(prettyName("MS Paint")).toBe("MS Paint");
    expect(prettyName("Norton Anti-Virus")).toBe("Norton Anti-Virus");
    expect(channelHead("dm:WebMD").title).toBe("WebMD");
    expect(channelHead("loc:The Optical Drive").title).toBe("The Optical Drive");
    expect(prettyName("MODERATOR_PRIME")).toBe("Moderator Prime");
    expect(prettyName("recruiter")).toBe("Recruiter");
    expect(prettyName("cast_Member")).toBe("Cast Member");
  });

  it("a group named The … never reads 'the The'", () => {
    expect(withThe("The Way Out")).toBe("The Way Out");
    expect(withThe("Unlimited Power")).toBe("the Unlimited Power");
  });

  it("wave 18: no client-made side chooser; a lobby choice and the escape dock on Mission", () => {
    const acts = { choose: () => {}, escape: () => {} };
    const view = { faction: null, captured: false, factions: ["Unlimited Power", "The Way Out"], pendingChoice: null } as unknown as GuestView;
    expect(requiredDecision(view, acts)).toBeNull();
    expect(requiredDecision({ ...view, pendingChoice: ["Yes"], decisionChannel: "lobby" }, acts)?.channel).toBe("mission");
    expect(requiredDecision({ ...view, pendingChoice: ["Yes"], decisionChannel: null }, acts)?.channel).toBe("mission");
    expect(requiredDecision({ ...view, pendingChoice: ["Yes"], decisionChannel: "dm:Clippy" }, acts)?.channel).toBe("dm:Clippy");
    expect(requiredDecision({ ...view, captured: true }, acts)?.channel).toBe("mission");
    expect(requiredDecision({ ...view, captured: true, canEscape: false }, acts)).toBeNull();
  });

  it("a restricted (marked) program gets no defect buttons (T4-07)", () => {
    const acts = { choose: () => {}, escape: () => {} };
    const factions = ["Unlimited Power", "The Way Out"];
    const unaligned = { faction: null, captured: false, factions, pendingChoice: null, restricted: true } as unknown as GuestView;
    expect(requiredDecision(unaligned, acts)).toBeNull();
    const sided = { faction: "Unlimited Power", captured: false, factions, pendingChoice: null } as unknown as GuestView;
    expect(defectTargets(sided)).toEqual(["The Way Out"]);
    expect(defectTargets({ ...sided, restricted: true })).toEqual([]);
    // A story choice still docks: only the side buttons are off.
    expect(requiredDecision({ ...unaligned, pendingChoice: ["Yes"] }, acts)?.decision.title).toBe("Your move…");
  });
});
