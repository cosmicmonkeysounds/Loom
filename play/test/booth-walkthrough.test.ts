// From the Oct 31 browser walkthrough (split out of walkthrough.test.ts in
// wave 13, block unchanged): the performer's own buttons first.
import { describe, expect, it } from "vitest";

import { splitInteractions } from "../src/performer.tsx";
import type { Interaction } from "../src/types.ts";

describe("a performer's card leads with their own buttons", () => {
  const list: Interaction[] = [
    { id: "send", label: "🛡 Send", who: "performer", description: null, actors: ["Norton Anti-Virus", "McAfee Anti-Virus"] },
    { id: "bingo", label: "🎱 Bingo", who: "performer", description: null, actors: ["Clippy"], live: false },
    { id: "judge", label: "✅ Q1", who: "performer", description: null, actors: ["Clippy"] },
    { id: "check", label: "📍 Check in", who: "performer", description: null },
    { id: "cue", label: "📣 Cue", who: "admin", description: null },
  ];
  it("folds another character's, the out-of-phase and (for an admin) the director's under More", () => {
    const norton = splitInteractions(list, "Norton Anti-Virus", false);
    expect(norton.mine.map((i) => i.id)).toEqual(["send", "check"]);
    expect(norton.more.map((i) => i.id)).toEqual(["bingo", "judge"]);
    const clippy = splitInteractions(list, "clippy", true);
    expect(clippy.mine.map((i) => i.id)).toEqual(["judge", "check"]);
    expect(clippy.more.map((i) => i.id)).toEqual(["send", "bingo", "cue"]);
  });

  it("leaves out another character's `by:` button (the server refuses it); an admin's booth keeps it under More", () => {
    const only: Interaction[] = list.map((i) => (i.id === "judge" ? { ...i, only: true } : i));
    expect(splitInteractions(only, "Norton Anti-Virus", false).more.map((i) => i.id)).toEqual(["bingo"]);
    expect(splitInteractions(only, "Norton Anti-Virus", true).more.map((i) => i.id)).toEqual(["bingo", "judge", "cue"]);
    expect(splitInteractions(only, "Clippy", false).mine.map((i) => i.id)).toEqual(["judge", "check"]);
  });

  it("a host or admin booth leaves out one only its actors' own hooks hear (`hostHeard: false`): the server refuses it", () => {
    const deaf: Interaction[] = list.map((i) => (i.id === "send" ? { ...i, only: true, hostHeard: false } : i));
    expect(splitInteractions(deaf, "Clippy", true).more.map((i) => i.id)).toEqual(["bingo", "cue"]);
    expect(splitInteractions(deaf, "Clippy", false).more.map((i) => i.id)).toEqual(["bingo"]);
    // Its own actors keep it.
    expect(splitInteractions(deaf, "McAfee Anti-Virus", true).mine.map((i) => i.id)).toContain("send");
  });
});
