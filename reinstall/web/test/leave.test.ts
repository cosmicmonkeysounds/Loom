import { describe, expect, it } from "vitest";
import { leaveText } from "../src/game/engine.ts";

describe("why the server ended a walk", () => {
  it("says so for an unmarked program (wave 18b, R16) and for the older reasons", () => {
    expect(leaveText("unmarked")).toBe("No longer marked for reinstallation — the simulation ended.");
    expect(leaveText("replaced")).toBe("This program was started again on another device.");
    expect(leaveText("ended")).toBe("A director ended this session.");
    // A reason a newer server invents still ends the game in plain words.
    expect(leaveText("something-new")).toBe("This session is over.");
  });
});
