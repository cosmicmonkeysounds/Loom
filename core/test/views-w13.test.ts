//! Wave 13 view additions (CONTRACTS §2.4): where the night is, the alert
//! level, the booth's per-guest flags and scan card, staff-room channel
//! ids, the voiced characters and the codex view's category / aboutKind.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { ChatStore, composeGuestMessages } from "../server/chat.ts";
import { alertLevelNow, guestCardView, guestFlags, guestView, modView, nightView, primeView, staffRoomChannels } from "../server/views.ts";

const SRC = `# Night
start: opening
alerts: Night.level
watch: program.cleared as Cleared, program.marked as Marked, program.score as Score, program.door_digits as Digits
watch: program.late as Late, while Night.step >= 3

ROLE Program
  cleared: bool = false
  marked: bool = false
  late: bool = false
  score: 0 to 100 = 0
  secret: door_digits

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

CHANNEL chatter
  kind: open

LOCATION Hall

CHARACTER Norton
  when scanned by program:
    reply Clean: {program.name}.

CHARACTER Clippy
  faction: Hosts
  when greet for program:
    Clippy: Hi.

CHARACTER Trabolta
  mind: external

CHARACTER Truther Download
  playable: false

CHARACTER Calculator

INTERACTION open the doors
  who: admin
  act: A · Doors

INTERACTION last call
  who: admin
  act: B · Close

INTERACTION mark
  who: performer
  while: program.marked != true

INTERACTION greet
  who: performer
  by: Clippy

INTERACTION sweep
  who: performer
  while: Night.step >= 2

CODEX Ivo File
  about: Clippy
  category: People
  text: x

CODEX Hall Plan
  about: Hall
  text: y

when open the doors:
  set Night.step = 1

== opening
Hi.
`;

function fresh() {
  const sim = Sim.fromSources(SRC);
  sim.createPerson("g1", "Ada");
  sim.createPerson("g2", "Bo");
  return sim;
}

describe("nightView", () => {
  it("reads the focus act, Night.phase (quotes stripped) and Night.step", () => {
    const sim = fresh();
    expect(nightView(sim)).toEqual({ act: { code: "A", title: "Doors" }, phase: null, step: null });
    sim.signal("open the doors");
    sim.setVar("Night.phase", '"bingo"');
    sim.tick(1000);
    expect(nightView(sim)).toEqual({ act: { code: "B", title: "Close" }, phase: "bingo", step: 1 });
  });

  it("is null for the act when no admin cue declares one", () => {
    const sim = Sim.fromSources("# A\n\nINTERACTION go\n  who: admin\n\n== a\nhi\n");
    expect(nightView(sim).act).toBeNull();
  });

  it("is memoised per round and refreshed when the log grows", () => {
    const sim = fresh();
    const a = nightView(sim);
    expect(nightView(sim)).toBe(a);
    sim.setVar("Night.step", "4");
    expect(nightView(sim)).not.toBe(a);
    expect(nightView(sim).step).toBe(4);
  });
});

describe("alertLevelNow / ModView.alerts", () => {
  it("reads the header's path; a bare word written by /api/mod/var counts", () => {
    const sim = fresh();
    expect(alertLevelNow(sim)).toBe("sticky");
    sim.setVar("Night.level", "dialog");
    expect(alertLevelNow(sim)).toBe("dialog");
    sim.setVar("Night.level", '"BSOD"');
    expect(alertLevelNow(sim)).toBe("bsod");
    expect(modView(sim, "open", "x").alerts).toEqual({ path: "Night.level", level: "bsod" });
    sim.setVar("Night.level", "nonsense");
    expect(guestView(sim, "g1").alertLevel).toBe("sticky");
  });
});

describe("guestFlags", () => {
  it("lists booleans always (false included), non-booleans only when truthy, never a secret slot", () => {
    const sim = fresh();
    expect(guestFlags(sim, "g1")).toEqual([
      { label: "Cleared", path: "Program.cleared", value: "false", on: false },
      { label: "Marked", path: "Program.marked", value: "false", on: false },
    ]);
    sim.setVar("g1.cleared", "true");
    sim.setVar("g1.score", "3");
    sim.setVar("g1.door_digits", "2");
    expect(guestFlags(sim, "g1")).toEqual([
      { label: "Cleared", path: "Program.cleared", value: "true", on: true },
      { label: "Marked", path: "Program.marked", value: "false", on: false },
      { label: "Score", path: "Program.score", value: "3", on: true },
    ]);
  });

  it("a line's while gates its items", () => {
    const sim = fresh();
    expect(guestFlags(sim, "g1").map((f) => f.label)).not.toContain("Late");
    sim.setVar("Night.step", "3");
    expect(guestFlags(sim, "g1").map((f) => f.label)).toContain("Late");
  });

  it("rides PrimeGuest.flags", () => {
    const sim = fresh();
    const p = primeView(sim, "Norton");
    // A snapshot keeps what is on and a failed gate (contract C3): "Not cleared", never "Not marked".
    expect(p.guests.find((g) => g.id === "g1")!.flags!.map((f) => f.label)).toEqual(["Cleared"]);
  });
});

describe("guestCardView", () => {
  it("lists live performer buttons for this guest, which are guest-scoped, and the readouts about them", () => {
    const sim = fresh();
    const chat = new ChatStore();
    chat.append(composeGuestMessages(sim, sim.scan("Norton", "g1")));
    chat.append(composeGuestMessages(sim, sim.scan("Norton", "g2")));
    const card = guestCardView(sim, chat.all(), "Norton", "g1", false)!;
    expect(card.guest).toMatchObject({ id: "g1", name: "Ada" });
    expect(card.live).toEqual(["mark"]);
    expect(card.guestScoped).toEqual(["mark"]);
    expect(card.readouts.map((r) => r.text)).toEqual(["Clean: Ada."]);
    sim.setVar("g1.marked", "true");
    sim.setVar("Night.step", "2");
    expect(guestCardView(sim, chat.all(), "Norton", "g1", false)!.live).toEqual(["sweep"]);
    expect(guestCardView(sim, chat.all(), "Norton", "g1", false)!.guestScoped).toEqual([]);
  });

  it("drops another character's by: button, a host's too when only its actors' hooks hear it; null for an unknown guest", () => {
    const sim = fresh();
    expect(guestCardView(sim, [], "Clippy", "g1", false)!.live).toEqual(["mark", "greet"]);
    expect(guestCardView(sim, [], "Norton", "g1", false)!.live).toEqual(["mark"]);
    // `greet` is heard only by Clippy's own hook: Norton's press (as a host) would do nothing.
    expect(guestCardView(sim, [], "Norton", "g1", true)!.live).toEqual(["mark"]);
    expect(guestCardView(sim, [], "Norton", "nobody", false)).toBeNull();
  });

  it("keeps at most the last five readouts, oldest first", () => {
    const sim = fresh();
    const chat = new ChatStore();
    for (let k = 0; k < 7; k++) chat.append(composeGuestMessages(sim, sim.scan("Norton", "g1")));
    const card = guestCardView(sim, chat.all(), "Norton", "g1", false)!;
    expect(card.readouts).toHaveLength(5);
    expect(card.readouts[0]!.seq).toBeLessThan(card.readouts[4]!.seq);
  });
});

describe("PrimeView / GuestView wave 13 fields", () => {
  it("staffRooms are the authored channel ids; countdowns and voiced", () => {
    const sim = fresh();
    expect(staffRoomChannels(sim.model)).toEqual(["room:hosts"]);
    const p = primeView(sim, "Norton");
    expect(p.staffRooms).toEqual(["room:hosts"]);
    expect(p.interactions.every((i) => i.who === "performer")).toBe(true);
    expect(primeView(null, "Norton")).toMatchObject({ objectives: [], night: { act: null, phase: null, step: null }, alertLevel: "sticky", staffRooms: [] });
    expect(guestView(sim, "g1").voiced).toEqual(["Norton", "Clippy", "Trabolta"]);
  });

  it("codex entries carry category and aboutKind", () => {
    const sim = fresh();
    sim.unlock("g1", "Ivo File");
    sim.unlock("g1", "Hall Plan");
    expect(guestView(sim, "g1").codex.map((e) => [e.id, e.category, e.aboutKind])).toEqual([
      ["Ivo File", "People", "character"],
      ["Hall Plan", undefined, "location"],
    ]);
  });
});
