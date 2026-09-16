//! `show` — widgets (a CAPTCHA, a picture, a poll) the participant app
//! renders inline. The statement lowers like any other keyword verb and the
//! sim records a `widget` event addressed like `reply` / `broadcast`.

import { describe, expect, it } from "vitest";
import { statementToDirective } from "../src/parser/statements.ts";
import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";

const SOURCE = `# Widgets
start: Boot

LOCATION Lobby
  label: The Lobby

GROUP Reds
  ethos: red

ROLE Program
  humanity: 0 to 100 = 0
  when someone joins:
    -> Login
  when captcha answered for program:
    if passed:
      set program.humanity += 10
      reply Humans are not permitted.
    else:
      reply Correct.

CHARACTER The Uploader
  listed: true

== Login
  setting: Lobby
  cast: The Uploader
The Uploader: SECURITY CHECK.
show captcha "Select every square that contains a traffic light" to program with target: "traffic light"

== Boot
  setting: Lobby
show image "https://example.test/poster.png" to everyone with caption: "Tonight"

== Rally
show poll "Ready?" to group(Reds)
`;

const widgets = (evs: SimEvent[]) => evs.filter((e): e is Extract<SimEvent, { type: "widget" }> => e.type === "widget");

describe("show — statement lowering", () => {
  it("lowers the widget forms and leaves prose alone", () => {
    expect(statementToDirective("show captcha to program")).toBe("show: captcha to program");
    expect(statementToDirective('show image "https://x/y.png" to everyone with caption: "Hi"')).toBe(
      'show: image "https://x/y.png" to everyone with caption: "Hi"',
    );
    expect(statementToDirective("show captcha")).toBe("show: captcha");
    expect(statementToDirective("show me the way")).toBeNull(); // prose
    expect(statementToDirective("show Bob the door")).toBeNull(); // prose
  });
});

describe("show — the sim", () => {
  it("addresses a widget to the bound subject with its text, params, and room", () => {
    const sim = Sim.fromSources(SOURCE);
    const evs = sim.createPerson("g1", "Minesweeper");
    const [w] = widgets(evs);
    expect(w).toBeDefined();
    expect(w!.widget).toBe("captcha");
    expect(w!.text).toBe("Select every square that contains a traffic light");
    expect(w!.params).toEqual({ target: "traffic light" });
    expect(w!.audience).toEqual(["g1"]);
    expect(w!.scope).toBe("program");
    expect(w!.setting).toBe("Lobby");
    expect(w!.beat).toBe("Login");
  });

  it("`to everyone` is a global widget; a group scope narrows it", () => {
    const sim = Sim.fromSources(SOURCE);
    const boot = widgets(sim.fireBeat("Boot"));
    expect(boot).toHaveLength(1);
    expect(boot[0]!.widget).toBe("image");
    expect(boot[0]!.audience).toEqual([]);
    expect(boot[0]!.scope).toBe("everyone");
    expect(boot[0]!.params).toEqual({ caption: "Tonight" });
    sim.createPerson("g1", "A");
    sim.createPerson("g2", "B");
    sim.join("g1", "Reds");
    const rally = widgets(sim.fireBeat("Rally"));
    expect(rally[0]!.audience).toEqual(["g1"]);
    expect(rally[0]!.text).toBe("Ready?");
  });

  it("a widget's answer is an ordinary named event with arguments", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.createPerson("g1", "Minesweeper");
    const failed = sim.signal("captcha answered", "g1", { passed: false });
    expect(failed.some((e) => e.type === "respond" && e.text === "Correct.")).toBe(true);
    const passed = sim.signal("captcha answered", "g1", { passed: true });
    expect(passed.some((e) => e.type === "respond" && e.text === "Humans are not permitted.")).toBe(true);
    expect((sim.world.get("g1.humanity") as { value: number }).value).toBe(10);
  });
});
