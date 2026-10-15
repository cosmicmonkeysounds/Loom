// An INTERACTION's `by:` (whose button it is) and `while:` (when it is on
// offer): a guest's pass only lists the buttons that would do something
// for them now, and a performer's guest card can lead with its own.
import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { guestView, interactionActors, primeView } from "../server/views.ts";

const STORY = `# Offer Test

GROUP Hosts
  joinable: false

ROLE Program
  afk: bool = false

TRAIT Host
  faction: Hosts

  when vouch for program:
    reply Vouched.

CHARACTER Clippy is Host
CHARACTER Task Manager is Host
CHARACTER Norton

INTERACTION vouch
  label: 🤝 Vouch
  who: performer

INTERACTION bingo_winner
  label: 🎱 Bingo winner
  who: performer
  by: Clippy
  while: Night.phase == "bingo_results"

INTERACTION judge
  label: ✅ Accurate
  who: performer
  by: Hosts

INTERACTION shout
  label: 📣 Anyone
  who: performer

INTERACTION go to the bathroom
  label: 🚻 Bathroom Mode
  who: guest
  while: program.afk != true

INTERACTION back from the bathroom
  label: Back
  who: guest
  while: program.afk == true

INTERACTION wave
  label: 👋 Wave
  who: guest

when go to the bathroom for program:
  set program.afk = true

when back from the bathroom for program:
  set program.afk = false
`;

describe("INTERACTION by: / while:", () => {
  it("parses both onto the model", () => {
    const sim = Sim.fromSources(STORY);
    const i = sim.model.interactions.get("bingo_winner")!;
    expect(i.by).toEqual(["Clippy"]);
    expect(i.while).toBe('Night.phase == "bingo_results"');
    expect(sim.model.interactions.get("shout")!.by).toEqual([]);
    expect(sim.model.interactions.get("shout")!.while).toBeNull();
  });

  it("names the actors: `by:` characters, a GROUP's members, and owners of a hook", () => {
    const sim = Sim.fromSources(STORY);
    const actors = interactionActors(sim);
    expect(actors.get("bingo_winner")).toEqual(["Clippy"]);
    expect(new Set(actors.get("judge"))).toEqual(new Set(["Clippy", "Task Manager"]));
    // The Host trait's `when vouch for program:` makes every host an actor.
    expect(new Set(actors.get("vouch"))).toEqual(new Set(["Clippy", "Task Manager"]));
    expect(actors.has("shout")).toBe(false);
  });

  it("marks a performer's out-of-phase button live: false (never hidden)", () => {
    const sim = Sim.fromSources(STORY);
    const off = primeView(sim, "Clippy").interactions.find((i) => i.id === "bingo_winner")!;
    expect(off.live).toBe(false);
    expect(off.actors).toEqual(["Clippy"]);
    // Still listed: a booth finds it under More.
    expect(primeView(sim, "Norton").interactions.map((i) => i.id)).toContain("bingo_winner");
  });

  it("evaluates `while:` for the world the performer sees", () => {
    const sim = Sim.fromSources(`${STORY}
INTERACTION open_bingo
  who: admin

when open_bingo:
  set Night.phase = "bingo_results"
`);
    expect(primeView(sim, "Clippy").interactions.find((i) => i.id === "bingo_winner")!.live).toBe(false);
    sim.signal("open_bingo");
    expect(primeView(sim, "Clippy").interactions.find((i) => i.id === "bingo_winner")!.live).toBeUndefined();
  });

  it("only offers a guest the buttons that would do something now", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g1", "Winamp");
    const labels = () => guestView(sim, "g1").interactions.map((i) => i.id);
    expect(labels()).toEqual(["go to the bathroom", "wave"]);
    sim.signal("go to the bathroom", "g1");
    expect(labels()).toEqual(["back from the bathroom", "wave"]);
    sim.signal("back from the bathroom", "g1");
    expect(labels()).toEqual(["go to the bathroom", "wave"]);
  });

  it("reads a condition that cannot evaluate as false, and writes nothing", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g1", "Winamp");
    expect(sim.holds("program.afk != true", "g1")).toBe(true);
    expect(sim.holds("((( nonsense", "g1")).toBe(false);
    expect(sim.holds("Night.phase == \"bingo_results\"", null, "Clippy")).toBe(false);
  });
});
