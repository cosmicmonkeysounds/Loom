//! Post-choice frame context — a resumed continuation must carry the
//! whole frame, not just its cursor.
//!
//! `choose()` rebuilds the executor stack from `PendingChoice.
//! continuation`. It used to copy only `items` / `index` / `bindings`,
//! so everything a frame carries *about* those items was lost the
//! moment a participant answered: a line inside a dialogue block came
//! back as speakerless narration, and `setting` / `beat` came back
//! null — which in a live event routes the line to the lobby instead
//! of the room it happens in, and breaks its story-map link.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";

/** A choice nested inside a dialogue block, so options resume under a speaker. */
const SPOKEN = `
LOCATION Lighthouse
  label: The Lighthouse

CHARACTER Wren
  faction: Keepers

== opening
  cast: Wren
  setting: Lighthouse

WREN
  The lamp's been dark for hours.
  * Ask about the lamp.
    I keep it lit. Usually.
  * Leave her to it.
    Suit yourself.
`;

/** A beat-level choice whose option narrates — no speaker, but a room. */
const NARRATED = `
LOCATION LampRoom
  label: The Lamp Room

== climb
  setting: LampRoom

The stair turns twice.

* Keep climbing.
  The glass is still warm.
`;

function dialogue(events: SimEvent[]): Array<Extract<SimEvent, { type: "dialogue" }>> {
  return events.filter((e): e is Extract<SimEvent, { type: "dialogue" }> => e.type === "dialogue");
}

function action(events: SimEvent[]): Array<Extract<SimEvent, { type: "action" }>> {
  return events.filter((e): e is Extract<SimEvent, { type: "action" }> => e.type === "action");
}

describe("choose() preserves frame context", () => {
  it("a line in a chosen option is still spoken by the enclosing speaker", () => {
    const sim = Sim.fromSources(SPOKEN);
    sim.fireBeat("opening");
    const after = sim.choose("__global", 0);

    // Before the fix this arrived as `{type:"action"}` — the speaker was
    // dropped, so the dialogue silently became narration.
    expect(dialogue(after)).toEqual([
      {
        type: "dialogue",
        speaker: "WREN",
        text: "I keep it lit. Usually.",
        audience: [],
        setting: "Lighthouse",
        beat: "opening",
      },
    ]);
    expect(action(after)).toEqual([]);
  });

  it("the second option resumes under the same speaker as the first", () => {
    const sim = Sim.fromSources(SPOKEN);
    sim.fireBeat("opening");
    const after = sim.choose("__global", 1);
    expect(dialogue(after).map((e) => [e.speaker, e.text])).toEqual([
      ["WREN", "Suit yourself."],
    ]);
  });

  it("narration in a chosen option keeps its setting and beat", () => {
    const sim = Sim.fromSources(NARRATED);
    sim.fireBeat("climb");
    const after = sim.choose("__global", 0);

    // `setting` is what routes a line to its location room, and `beat`
    // is the story-map backlink — both were null before the fix.
    expect(action(after)).toEqual([
      { type: "action", text: "The glass is still warm.", setting: "LampRoom", beat: "climb" },
    ]);
  });

  it("lines after the menu — the saved continuation — keep context too", () => {
    // The option body runs first, then the frame the menu was in
    // resumes. Both paths go through the rebuilt stack.
    const sim = Sim.fromSources(`
LOCATION Hall

== gather
  setting: Hall

* Step forward.
  You step forward.

The doors close behind everyone.
`);
    sim.fireBeat("gather");
    const after = sim.choose("__global", 0);
    expect(action(after).map((e) => [e.text, e.setting, e.beat])).toEqual([
      ["You step forward.", "Hall", "gather"],
      ["The doors close behind everyone.", "Hall", "gather"],
    ]);
  });
});
