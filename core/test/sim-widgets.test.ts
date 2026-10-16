//! `show` — widgets (a CAPTCHA, a picture, a poll) the participant app
//! renders inline. The statement lowers like any other keyword verb and the
//! sim records a `widget` event addressed like `reply` / `broadcast`.

import { describe, expect, it } from "vitest";
import { statementToDirective } from "../src/parser/statements.ts";
import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";
import { composeGuestMessages } from "../server/chat.ts";

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

describe("show — routing knobs (chat.ts)", () => {
  const SRC = `# Knobs
start: Boot

LOCATION Lobby
  label: The Lobby

GROUP Crew
  ethos: staff

CHANNEL backstage
  kind: faction
  faction: Crew
  label: # backstage

ROLE Program
  when someone joins:
    -> Deal

CHARACTER The Oracle
  listed: true

CHARACTER The Clerk
  listed: true

== Boot
  setting: Lobby
Nothing yet.

== Deal
  setting: Lobby
The Clerk: Take a ticket.
show fact "File a fact" to program with thread: The Oracle, questions: "H1: One? | H2: Two?"
broadcast "{program.name} took a card" to channel(backstage)
`;

  it("`with thread: <Character>` docks a card in that character's DM, whoever spoke last", () => {
    const sim = Sim.fromSources(SRC);
    const msgs = composeGuestMessages(sim, sim.createPerson("g1", "Minesweeper"));
    const card = msgs.find((m) => m.kind === "widget");
    expect(card?.channel).toBe("dm:The Oracle");
    expect(card?.audience).toEqual(["g1"]);
    expect(card?.widget?.params).toEqual({ thread: "The Oracle", questions: "H1: One? | H2: Two?" });
    expect(msgs.find((m) => m.kind === "line")?.channel).toBe("dm:The Clerk");
  });

  it("`broadcast … to channel(<name>)` posts only into that authored room, to its readers", () => {
    const sim = Sim.fromSources(SRC);
    const evs = sim.createPerson("g1", "Minesweeper");
    const posts = composeGuestMessages(sim, evs).filter((m) => m.kind === "signal");
    expect(posts.map((m) => [m.channel, m.text, m.audience])).toEqual([["room:backstage", "Minesweeper took a card", []]]);
    sim.join("g1", "Crew");
    const again = composeGuestMessages(sim, sim.fireBeat("Deal", "g1")).filter((m) => m.kind === "signal");
    expect(again.map((m) => m.audience)).toEqual([["g1"]]);
  });
});

// ───────────────────────── the `answer` kind (free text, keyed) ─────────────────────────

describe("show answer — a free-text card keyed to a facts.json answer", () => {
  const SRC = `# Answers
start: Boot

LOCATION Lobby
  label: The Lobby

ROLE Program
  when someone joins:
    -> Deal

CHARACTER The Oracle
  listed: true

== Boot
  setting: Lobby
Nothing yet.

== Deal
  setting: Lobby
show answer "Give me a line." to program with thread: The Oracle, question: "P1", max: 120, button: "Say it"
`;

  it('`show answer … with question: "P1"` carries the param, quoted (a bare P1 would evaluate to null); the server judges on it, never the client\'s', () => {
    const sim = Sim.fromSources(SRC);
    const w = sim.createPerson("g1", "Minesweeper").find((e): e is Extract<SimEvent, { type: "widget" }> => e.type === "widget");
    expect(w).toBeDefined();
    expect(w!.widget).toBe("answer");
    expect(w!.text).toBe("Give me a line.");
    expect(w!.params).toEqual({ thread: "The Oracle", question: "P1", max: "120", button: "Say it" });
    const card = composeGuestMessages(sim, sim.createPerson("g2", "Winamp")).find((m) => m.kind === "widget");
    expect(card?.channel).toBe("dm:The Oracle");
    expect(card?.widget?.params["question"]).toBe("P1");
  });
});
