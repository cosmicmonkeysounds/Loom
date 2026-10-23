//! Wave 20 (D15 / D18): a phone pick names the menu it was drawn on, so a tap
//! racing a new menu (a heart layer answered at the terminal) is refused by
//! the server (409), never applied to the next menu's option at that index.

import { describe, expect, it } from "vitest";
import { chooseBody, requiredDecision, type ChoiceRef } from "../src/session/guest.ts";
import type { GuestView } from "../src/types.ts";

const base = { id: "g-1", name: "Winamp", title: "T", role: null, faction: null, score: 0, location: null, captured: false, decisionChannel: "dm:Trabolta" } as unknown as GuestView;

describe("the phone's pick", () => {
  it("carries the docked menu's id and the option's text", () => {
    const picks: Array<[number, ChoiceRef | undefined]> = [];
    const view = { ...base, pendingChoice: ["A", "B"], choices: [{ id: 388, options: ["A", "B"], channel: "dm:Trabolta" }] };
    const dock = requiredDecision(view, { choose: (i, m) => picks.push([i, m]), escape: () => {} });
    dock!.decision.options[1]!.onClick();
    expect(picks).toEqual([[1, { id: 388, text: "B" }]]);
    expect(chooseBody(1, picks[0]![1])).toEqual({ index: 1, choice: 388, text: "B" });
  });

  it("an older server's view (no choices) sends the index alone", () => {
    const picks: Array<[number, ChoiceRef | undefined]> = [];
    const dock = requiredDecision({ ...base, pendingChoice: ["A"] }, { choose: (i, m) => picks.push([i, m]), escape: () => {} });
    dock!.decision.options[0]!.onClick();
    expect(picks).toEqual([[0, undefined]]);
    expect(chooseBody(0)).toEqual({ index: 0 });
  });
});
