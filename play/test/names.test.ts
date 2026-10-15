import { describe, expect, it } from "vitest";

import { requiredDecision } from "../src/session.ts";
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
    const view = { faction: null, captured: false, factions: ["Unlimited Power", "The Way Out"], pendingChoice: null } as unknown as GuestView;
    const d = requiredDecision(view, { choose: () => {}, join: () => {}, escape: () => {} });
    expect(d?.decision.options.map((o) => o.label)).toEqual(["Side with the Unlimited Power", "Side with The Way Out"]);
  });
});
