//! Wave 26: a multi-word named event bound with `for` may carry a built-in
//! verb word past its first word. `when simulation escape attempt for
//! program:` is that INTERACTION (C9), not the builtin `escape`; a builtin
//! verb still names the trigger as the phrase's first word, and every
//! phrase without a `for` binding reads as before.

import { describe, expect, it } from "vitest";

import { parseTrigger } from "../src/runtime/sim/model.ts";
import { Sim } from "../src/runtime/sim/index.ts";

describe("parseTrigger: built-in verb words inside a named event", () => {
  it("a for-bound phrase keeps a builtin verb only as its first word", () => {
    expect(parseTrigger("simulation escape attempt for program")).toEqual({ verb: "simulation escape attempt", param: "program", filter: null });
    expect(parseTrigger("simulation heart reached for program")).toEqual({ verb: "simulation heart reached", param: "program", filter: null });
    expect(parseTrigger("captured for program")).toEqual({ verb: "captured", param: "program", filter: null });
    expect(parseTrigger("released for program")).toEqual({ verb: "released", param: "program", filter: null });
    expect(parseTrigger("restricted for guest")).toEqual({ verb: "restricted", param: "guest", filter: null });
    // No `for`: unchanged (`guest escapes` is the builtin).
    expect(parseTrigger("guest escapes")).toEqual({ verb: "escape", param: "guest", filter: null });
    expect(parseTrigger("scanned by a guest")).toEqual({ verb: "scan", param: "guest", filter: null });
  });

  it("the hook hears its own INTERACTION", () => {
    const sim = Sim.fromSources(`# T

ROLE Program
  escapes: 0 to 99 = 0

INTERACTION simulation escape attempt
  who: admin

when simulation escape attempt for program:
  set program.escapes += 1
`);
    sim.createPerson("g-1", "Bugdom", "Program");
    sim.signal("simulation escape attempt", "g-1");
    expect(sim.world.get("g-1.escapes")).toMatchObject({ kind: "number", value: 1 });
  });
});
