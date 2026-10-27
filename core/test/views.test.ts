import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { boardFor, guestView, modView, pressRefused, primeView, staffRoomIds, titleOf, type InteractionSummary } from "../server/views.ts";
import { scenarioSource } from "../examples/load.ts";
import { heldCharacters } from "../server/identity.ts";
import { cueSheetView, type CueInteraction } from "../src/cue-sheet.ts";

const SCENARIO = scenarioSource("escape-the-internet");

describe("server views", () => {
  it("projects a guest's self-view with a masked hidden faction", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    sim.join("g1", "TheAlgorithm"); // a secret allegiance
    const v = guestView(sim, "g1");
    expect(v.name).toBe("Alice");
    expect(v.role).toBe("Guest");
    expect(v.faction).toBeNull(); // hidden faction reads null to the app
    expect(v.score).toBe(0);
    expect(v.captured).toBe(false);
  });

  it("surfaces a pending choice in the guest view", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    sim.scan("Recruiter", "g1");
    expect(guestView(sim, "g1").pendingChoice).toEqual(["Join the Chatters", "Stay loyal"]);
  });

  it("gives the moderator the true god-view including hidden allegiances", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    sim.join("g1", "Mods");
    sim.createPerson("g2", "Bob");
    sim.join("g2", "Chatters");
    const v = modView(sim, "open", "escape-the-internet");
    expect(v.phase).toBe("open");
    expect(v.roster).toHaveLength(2);
    expect(v.roster.find((r) => r.id === "g1")!.faction).toBe("Mods");
    const mods = v.factions.find((f) => f.id === "Mods")!;
    expect(mods.members).toEqual(["g1"]);
    const algo = v.factions.find((f) => f.id === "TheAlgorithm")!;
    expect(algo.hidden).toBe(true);
    expect(algo.revealed).toBe(false);
    expect(v.locations.find((l) => l.id === "Internet")!.prison).toBe(true);
    expect(v.characters).toContain("Moderator_Prime");
  });

  it("marks mod-spawned personas with their puppeteer from presence", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("p-1", "Ivo");
    sim.createPerson("g-1", "Alice");
    const v = modView(sim, "open", "x", {
      guests: new Set(["g-1"]),
      primes: new Set(),
      mods: 1,
      directors: ["Ada"],
      owners: new Map([["p-1", "Ada"]]),
    });
    expect(v.roster.find((r) => r.id === "p-1")!.owner).toBe("Ada");
    expect(v.roster.find((r) => r.id === "g-1")!.owner).toBeNull();
    expect(v.roster.find((r) => r.id === "g-1")!.online).toBe(true);
    // Without presence (the local sim) the field is simply absent.
    expect("owner" in modView(sim, "open", "x").roster[0]!).toBe(false);
  });

  it("gives a performer their part and the scannable guests", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    const v = primeView(sim, "Moderator_Prime");
    expect(v.character).toBe("Moderator_Prime");
    expect(v.faction).toBe("Mods");
    expect(v.guests.map((g) => g.id)).toEqual(["g1"]);
    expect(v.guests[0]).toHaveProperty("location");
  });

  it("enumerates operator rooms, the cast, and the beat picker", () => {
    const sim = Sim.fromSources(SCENARIO);
    const v = modView(sim, "open", "escape-the-internet");
    // The lobby plus one derived broadcast channel per faction.
    expect(v.channels.find((c) => c.id === "lobby")).toBeDefined();
    expect(v.channels.some((c) => c.id === "faction:Mods")).toBe(true);
    // The cast carries each character's faction, for the "speak/fire as" picker.
    const admin = v.cast.find((c) => c.id === "Moderator_Prime");
    expect(admin).toBeDefined();
    expect(admin!.faction).toBe("Mods");
    // Every named beat is offered to the "fire beat" picker.
    expect(v.beats.length).toBeGreaterThan(0);
  });

  it("returns empty views when no scenario is loaded", () => {
    const v = modView(null, "idle", null);
    expect(v.roster).toEqual([]);
    expect(v.characters).toEqual([]);
    expect(v.cast).toEqual([]);
    expect(v.channels).toEqual([]);
    expect(v.beats).toEqual([]);
    expect(primeView(null, "X").guests).toEqual([]);
  });

  it("carries the declared cast when no scenario is loaded yet (doors shut)", () => {
    const v = modView(null, "idle", "demo", undefined, ["Clippy", "Alexa"]);
    expect(v.characters).toEqual(["Clippy", "Alexa"]);
    expect(v.cast).toEqual([]);
  });

  it("carries the story's LOCATIONs, empty, before the doors (the map editor's room check: LA-3)", () => {
    const declared = Sim.fromSources(SCENARIO);
    const v = modView(null, "idle", "demo", undefined, [], declared);
    expect(v.locations.map((l) => l.id)).toEqual([...declared.model.locations.keys()]);
    expect(v.locations.length).toBeGreaterThan(0);
    expect(v.locations.every((l) => l.occupants.length === 0)).toBe(true);
  });

  it("stamps the story clock on guest + prime views (the alert window's \"now\")", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    sim.tick(90_000);
    expect(guestView(sim, "g1").clock).toBe(sim.elapsed());
    expect(primeView(sim, "Moderator_Prime").clock).toBe(sim.elapsed());
    expect(modView(sim, "open", "x").clock).toBe(sim.elapsed()); // Run's wallet countdowns read it
    expect(sim.elapsed()).toBeGreaterThanOrEqual(90_000);
  });

  it("lists only public factions as the guest's joinable sides", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    const v = guestView(sim, "g1");
    // The two public sides — never the hidden TheAlgorithm / Glitchers.
    expect(v.factions).toEqual(["Mods", "Chatters"]);
  });

  it("offers a hidden faction as a side once the story reveals it", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    expect(guestView(sim, "g1").factions).not.toContain("Glitchers");
    sim.reveal("Glitchers");
    expect(guestView(sim, "g1").factions).toContain("Glitchers");
  });
});

describe("a cutscene place is a room only while you stand in it", () => {
  it("drops the login room from a guest's list once the story moves them on", () => {
    const sim = Sim.fromSources(`# Rails

LOCATION The Mud Room
  cutscene: true

LOCATION The Desktop

INTERACTION done
  who: admin

ROLE Guest
  when someone joins:
    move guest to The Mud Room

when done for guest:
  move guest to The Desktop
`);
    sim.createPerson("g1", "Ada");
    const rooms = () => guestView(sim, "g1").channels.map((c) => c.id);
    expect(rooms()).toContain("loc:The Mud Room");
    sim.signal("done", "g1");
    expect(rooms()).not.toContain("loc:The Mud Room");
    expect(rooms()).toContain("loc:The Desktop");
    // Performers still run every room.
    expect(primeView(sim, "Nobody").channels.map((c) => c.id)).toContain("loc:The Mud Room");
  });
});

describe("titleOf — the authored display title", () => {
  it("reads the first `# Title` heading", () => {
    expect(titleOf("# Trapped in the Internet\n#\n# prose comment\n\nentry: start\n")).toBe("Trapped in the Internet");
  });

  it("skips the `# ── path ──` separators multi-file concatenation inserts", () => {
    const src = `# ── main.loom ${"─".repeat(46)}\n# Escape the Internet\n\n== start\n`;
    expect(titleOf(src)).toBe("Escape the Internet");
    // The real concatenated example resolves to its authored heading too.
    expect(titleOf(SCENARIO)).toBe("Escape the Internet");
  });

  it("falls back to a `title:` header property", () => {
    expect(titleOf("entry: start\ntitle: The Masquerade\n\n== start\n")).toBe("The Masquerade");
    expect(titleOf("TITLE: The Masquerade\n")).toBe("The Masquerade");
  });

  it("is null when the source names nothing", () => {
    expect(titleOf("== start\nHello.\n")).toBeNull();
    expect(titleOf("")).toBeNull();
  });
});

describe("cue sheet state (K-21)", () => {
  const CUES = `# Cue Test

INTERACTION ring_the_bell
  label: C1 · 📣 Call everyone
  who: admin

INTERACTION hunt_time_up
  label: C2 · ⏰ Hunt over (auto)
  who: admin

INTERACTION accuse
  who: performer

when ring_the_bell:
  set Night.phase = "desktop"
  fire hunt_time_up

when hunt_time_up:
  set Night.phase = "truth"
`;

  it("starts empty and marks the last admin cue, director- or story-fired", async () => {
    const { cueState } = await import("../server/views.ts");
    const sim = Sim.fromSources(CUES);
    expect(cueState(sim)).toEqual({ last: null, lastBy: null, fired: [], presses: 0, pressed: null });
    sim.signal("accuse"); // not an admin cue
    expect(cueState(sim).last).toBeNull();
    sim.signal("ring the bell"); // folds to `ring_the_bell`
    const s = cueState(sim);
    // the hook's own `fire hunt_time_up` lands after the director's signal
    expect(s.fired).toEqual(["ring_the_bell", "hunt_time_up"]);
    expect(s.last).toBe("hunt_time_up");
    expect(s.lastBy).toBe("story");
    sim.signal("ring_the_bell");
    expect(cueState(sim).fired).toEqual(["ring_the_bell", "hunt_time_up"]);
    expect(modView(sim, "open", "x").cues?.last).toBe("hunt_time_up");
  });

  it("ticks an off-sequence cue (`sequence: false`) without moving LAST", async () => {
    const { cueState } = await import("../server/views.ts");
    const sim = Sim.fromSources(`${CUES}
INTERACTION the golden duck
  label: Reinstallation: the golden duck (server)
  who: admin
  sequence: false
`);
    sim.signal("ring_the_bell");
    sim.signal("the golden duck");
    const s = cueState(sim);
    expect(s.last).toBe("hunt_time_up");
    expect(s.fired).toEqual(["ring_the_bell", "hunt_time_up", "the golden duck"]);
    const duck = (modView(sim, "open", "x").interactions ?? []).find((i) => i.id === "the golden duck");
    expect(duck?.sequence).toBe(false);
    expect((modView(sim, "open", "x").interactions ?? []).find((i) => i.id === "ring_the_bell")).not.toHaveProperty("sequence");
  });

  it("a repeat of an earlier cue never moves LAST back; a press the story refused counts for nothing (T7-01, T1-02)", async () => {
    const { cueState } = await import("../server/views.ts");
    const sim = Sim.fromSources(`${CUES}
INTERACTION read_out
  label: C3 · 📋 Read out
  who: admin

INTERACTION too_early
  label: C4 · 🤖 Too early
  who: admin

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

when read_out:
  set Night.reads += 1

when too_early:
  if Night.phase == "finale":
    set Night.phase = "end"
  else:
    broadcast "🤖 Too early." to channel(hosts)
`);
    sim.signal("ring_the_bell");
    sim.signal("read_out");
    expect(cueState(sim).last).toBe("read_out");
    // A repeat of ring_the_bell (row 1) leaves LAST on read_out (row 3).
    sim.signal("ring_the_bell");
    expect(cueState(sim)).toMatchObject({ last: "read_out", lastBy: "director" });
    // A repeat of LAST itself keeps it.
    sim.signal("read_out");
    expect(cueState(sim).last).toBe("read_out");
    // Refused: only a `# hosts` line — neither LAST nor ticked.
    sim.signal("too_early");
    expect(cueState(sim)).toMatchObject({ last: "read_out", fired: ["ring_the_bell", "hunt_time_up", "read_out"] });
    // The same cue in its phase fires.
    sim.world.set("Night.phase", { kind: "string", value: "finale" });
    sim.signal("too_early");
    expect(cueState(sim)).toMatchObject({ last: "too_early", fired: ["ring_the_bell", "hunt_time_up", "read_out", "too_early"] });
  });

  it("judges a refused press by its own events, so a restart replays the same LAST (T7-01 review)", async () => {
    const { cueState, notePress } = await import("../server/views.ts");
    const SRC = `${CUES}
INTERACTION too_early
  label: C3 · 🤖 Too early
  who: admin

INTERACTION quiet
  label: C4 · 🤫 Quiet guard
  who: admin

INTERACTION lights_only
  label: C5 · 💡 Only stagehand hears this
  who: admin

INTERACTION to_the_floor
  label: C6 · 📣 Tell the floor
  who: admin

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

CHANNEL exchange
  kind: open

when too_early:
  if Night.phase == "finale":
    set Night.phase = "end"
  else:
    broadcast "🤖 Too early." to channel(hosts)

when quiet:
  if Night.phase == "finale":
    set Night.phase = "end"

when to_the_floor:
  broadcast "📣 Prices are up." to channel(exchange)
`;
    // The runtime notes each journaled signal live (commit) and on replay
    // (restore); the console's snapshot may or may not land between inputs.
    const night = (snapshots: boolean) => {
      const sim = Sim.fromSources(SRC);
      sim.createPerson("g1", "Ada");
      const press = (name: string) => {
        notePress(sim, sim.signal(name));
        if (snapshots) cueState(sim);
      };
      press("ring_the_bell");
      press("too_early"); // refused: a # hosts line
      sim.setVar("g1.score", "5"); // a mod `set` / a wallet sweep — not a press
      press("quiet"); // refused silently
      sim.join("g1", "Hosts");
      return cueState(sim);
    };
    const live = night(true);
    expect(live).toEqual({ last: "hunt_time_up", lastBy: "story", fired: ["ring_the_bell", "hunt_time_up"], presses: 2, pressed: "hunt_time_up" });
    expect(night(false)).toEqual(live);

    // A cue no rule hears (stagehand's) and a line to a guest room both count.
    const sim = Sim.fromSources(SRC);
    notePress(sim, sim.signal("lights_only"));
    expect(cueState(sim).last).toBe("lights_only");
    notePress(sim, sim.signal("to_the_floor"));
    expect(cueState(sim)).toMatchObject({ last: "to_the_floor", fired: ["lights_only", "to_the_floor"] });
  });

  it("a `_`-leaf world write is bookkeeping: an ask that only notes when it asked is refused; a real write still fires (C3)", async () => {
    const { cueState, notePress, pressRefused } = await import("../server/views.ts");
    const sim = Sim.fromSources(`${CUES}
INTERACTION resurrect
  label: G11 · 🎃 Resurrection
  who: admin

INTERACTION reset_room
  label: S1 · 🔄 Reset the room
  who: admin

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

when resurrect:
  if Night._ask_at == 0 or Time.elapsed > Night._ask_at + 30:
    set Night._ask_at = Time.elapsed + 1
    broadcast "🎃 Press again to end the show." to channel(hosts)
  else:
    set Night.resurrected = true

when reset_room:
  set Night.resets += 1
  broadcast "🔄 Reset." to channel(hosts)
`);
    const press = (name: string): boolean => {
      const batch = sim.signal(name);
      notePress(sim, batch);
      return pressRefused(sim, batch);
    };
    sim.setVar("Night._ask_at", "0"); // the story's seed
    expect(press("ring_the_bell")).toBe(false);
    // The first G11 press only asks: refused, not LAST, not ticked.
    expect(press("resurrect")).toBe(true);
    expect(cueState(sim)).toMatchObject({ last: "hunt_time_up", fired: ["ring_the_bell", "hunt_time_up"] });
    // The second press inside the window ends it: fired, LAST.
    expect(press("resurrect")).toBe(false);
    expect(cueState(sim)).toMatchObject({ last: "resurrect", fired: ["ring_the_bell", "hunt_time_up", "resurrect"] });
    // A plain (non-`_`) write next to a staff line still counts.
    expect(press("reset_room")).toBe(false);
    expect(cueState(sim).fired).toContain("reset_room");
  });

  it("reads only new log entries on each snapshot, and returns a fresh copy", async () => {
    const { cueState } = await import("../server/views.ts");
    const sim = Sim.fromSources(CUES);
    const a = cueState(sim);
    sim.signal("ring_the_bell");
    const b = cueState(sim);
    expect(a.fired).toEqual([]); // the earlier snapshot is not mutated
    expect(b.fired).toEqual(["ring_the_bell", "hunt_time_up"]);
    expect(cueState(sim)).toEqual(b);
  });
});

describe("the show's cue sheet (K-21)", () => {
  it("declares the admin cues in running order, coded C1/V1 → V6", () => {
    const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    const admin = (modView(sim, "open", "x").interactions ?? []).filter((i) => i.who === "admin");
    const codes = admin.map((i) => i.label.split(" · ")[0]);
    expect(admin[0]!.id).toBe("call_to_the_desktop");
    for (const c of ["C1/V1", "V2", "V3", "Clippy 2/X", "V4/V5", "C2", "V6"]) expect(codes).toContain(c);
    expect(codes.indexOf("V2")).toBeLessThan(codes.indexOf("V6"));
    sim.signal("call_to_the_desktop");
    expect(modView(sim, "open", "x").cues?.last).toBe("call_to_the_desktop");
  });

  it("keeps the machine-fired cues off LAST / NEXT (the duck game, door reed, printer, patch bay)", () => {
    const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    const admin = (modView(sim, "open", "x").interactions ?? []).filter((i) => i.who === "admin");
    const off = admin.filter((i) => i.sequence === false).map((i) => i.id);
    for (const id of ["the simulation completed", "the golden duck", "server_door_opened", "printer_button_pressed", "printer_opened", "patch_combo_a", "patch_combo_b", "patch_rejected", "chess_won"]) expect(off).toContain(id);
    for (const id of ["call_to_the_desktop", "bingo_time", "start_the_ceremony"]) expect(off).not.toContain(id);
    sim.signal("bingo_time");
    sim.signal("the golden duck");
    expect(modView(sim, "open", "x").cues?.last).toBe("bingo_time");
    expect(modView(sim, "open", "x").cues?.fired).toContain("the golden duck");
  });

  it("a cue the story refuses leaves LAST / NEXT alone: an early 🤖, an early 📋, a forced majority before the vote (T1-02, T7-01)", async () => {
    const { cueRows } = await import("../src/cue-sheet.ts");
    const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    const sheet = () => {
      const v = modView(sim, "open", "x");
      const rows = cueRows(v.interactions ?? [], v.cues!);
      return { last: v.cues!.last, next: rows.find((r) => r.next)?.id ?? null, fired: v.cues!.fired };
    };
    sim.signal("call_to_the_desktop");
    for (const early of ["introduce_trabolta", "read_the_results", "force_majority_stay"]) {
      sim.signal(early);
      expect(sheet()).toEqual({ last: "call_to_the_desktop", next: "start_the_bingo", fired: ["call_to_the_desktop"] });
    }
    // Only the repeatable cues may carry `repeat: true` (the story marks them).
    const repeat = (modView(sim, "open", "x").interactions ?? []).filter((i) => i.repeat === true).map((i) => i.id);
    // Wave 26 (B2): ⏰ may fire again after ↩ Not a Bingo. Wave 32: ⚡ ad_burst, any number of times in a talk scene.
    expect(repeat.every((id) => ["read_the_results", "spin_the_bottle", "zip_everyone_out", "bingo_time", "ad_burst"].includes(id))).toBe(true);
  });

  it("marks the performer parts and which are held, streaming or not (T7-04)", () => {
    const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    const presence = { guests: new Set<string>(), primes: new Set(["Norton Anti-Virus"]), mods: 1, directors: [], held: heldCharacters([["t1", { character: "Clippy" }], ["t2", { character: "Norton Anti-Virus" }], ["t3", { character: null }]]) };
    const cast = modView(sim, "open", "x", presence).cast;
    const parts = cast.filter((c) => c.part === true).map((c) => c.id).sort();
    expect(parts).toEqual(["Adobe Acrobat", "CRA Agent Software", "Clippy", "McAfee Anti-Virus", "Norton Anti-Virus", "Password Manager", "Recycling Bin", "Task Manager"]);
    for (const id of ["Trabolta", "Kernel", "Microsoft Excel", "Sandy"]) expect(cast.find((c) => c.id === id)).not.toHaveProperty("part");
    expect(cast.find((c) => c.id === "Clippy")).toMatchObject({ part: true, held: true, online: false });
    expect(cast.find((c) => c.id === "Norton Anti-Virus")).toMatchObject({ part: true, held: true, online: true });
    expect(cast.find((c) => c.id === "McAfee Anti-Virus")).toMatchObject({ part: true, held: false, online: false });
    expect(cast.find((c) => c.id === "Kernel")).not.toHaveProperty("held");
    // No connection tracking (a local sim): parts still marked, no `held`.
    // Wave 21: Clippy is a player, out of GROUP Hosts.
    expect(modView(sim, "open", "x").cast.find((c) => c.id === "Clippy")).toEqual({ id: "Clippy", faction: null, part: true, player: true });
    expect(modView(sim, "open", "x").cast.find((c) => c.id === "Task Manager")).toEqual({ id: "Task Manager", faction: "Hosts", part: true, player: false });
  });

  it("flags the cues that need a person: the ceremony's awards ask for the winner (K-25)", () => {
    const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    const admin = (modView(sim, "open", "x").interactions ?? []).filter((i) => i.who === "admin");
    const needs = admin.filter((i) => i.subject === true).map((i) => i.id);
    // ♟ names the winner too: the door code goes to whoever mated the King (wave 7).
    for (const a of ["award_most_trusted", "award_best_liar", "award_quest_completionist", "chess_won"]) expect(needs).toContain(a);
    // Global cues stay one click, including the ceremony's own start.
    for (const a of ["call_to_the_desktop", "start_the_ceremony", "server_door_opened", "reset_server_room"]) expect(needs).not.toContain(a);
    // Wave 21: the staff awards name their own winner (no subject).
    for (const a of ["award_staff_trusted", "award_staff_points", "award_staff_mole"]) expect(needs).not.toContain(a);
    expect(admin.find((i) => i.id === "call_to_the_desktop")).not.toHaveProperty("subject");
  });
});

describe("the performer view's own quest log + codex totals (wave 4, lane D)", () => {
  it("carries `quests`, `questTotal`, `codexTotal` (empty on a story with none; zeros with no scenario)", () => {
    const sim = Sim.fromSources(SCENARIO);
    const v = primeView(sim, "Moderator_Prime");
    expect(v.quests).toEqual([]);
    expect(v.questTotal).toBe(sim.model.quests.size);
    expect(v.codexTotal).toBe(sim.model.codex.size);
    expect(v.answered).toBeUndefined(); // the runtime fills it
    const none = primeView(null, "Moderator_Prime");
    expect(none).toMatchObject({ codex: [], codexTotal: 0, quests: [], questTotal: 0 });
  });
});

describe("`restricted` on every view (wave 4, lane E)", () => {
  it("is false by default on the guest / booth guest / roster row, true after `restrict`, and empties the guest's buttons", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    expect(guestView(sim, "g1").restricted).toBe(false);
    expect(primeView(sim, "Moderator_Prime").guests[0]!.restricted).toBe(false);
    expect(modView(sim, "open", "escape-the-internet").roster[0]!.restricted).toBe(false);
    sim.restrict("g1");
    expect(guestView(sim, "g1")).toMatchObject({ restricted: true, interactions: [] });
    expect(primeView(sim, "Moderator_Prime").guests[0]!.restricted).toBe(true);
    expect(modView(sim, "open", "escape-the-internet").roster[0]!.restricted).toBe(true);
    expect(guestView(sim, "g1").channels.every((c) => c.canPost === false)).toBe(true);
  });

  it("keeps a `restricted: allow` button (wave 5, fact-M20)", () => {
    const sim = Sim.fromSources(
      "# B\n\nINTERACTION go to the bathroom\n  who: guest\n  restricted: allow\n\nINTERACTION knock\n  who: guest\n",
    );
    sim.createPerson("g1", "Alice");
    expect(guestView(sim, "g1").interactions.map((i) => i.id)).toEqual(["go to the bathroom", "knock"]);
    sim.restrict("g1");
    expect(guestView(sim, "g1").interactions.map((i) => i.id)).toEqual(["go to the bathroom"]);
  });
});

describe("the wallet on the views (wave 4, lane C)", () => {
  it("GuestView carries no wallet when the header declares no currency — the runtime fills it, the pure projection never does", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    expect(sim.model.currency).toBeNull();
    expect(guestView(sim, "g1").wallet).toBeUndefined();
    expect(primeView(sim, "Moderator_Prime").wallet).toBeUndefined();
    expect(modView(sim, "open", "escape-the-internet").wallet).toBeUndefined();
    // Even with a currency the pure projection is wallet-free: the book lives on the server.
    const coin = Sim.fromSources("# Coin\ncurrency: score as Coin\n\nCHARACTER Auditor\n  wallet: approver\n");
    coin.createPerson("g1", "Alice");
    expect(coin.model.currency?.name).toBe("Coin");
    expect(guestView(coin, "g1").wallet).toBeUndefined();
    expect(coin.canPost("g1", "wallet")).toBe(false);
  });
});

describe("the Director page's board and acts (wave 10, lane A)", () => {
  const BOARD = `# Board
start: Doors
watch: Night.clock as Clock, Kernel.door_code as Door code, program.cleared as Cleared, Floor.mood, Ivo Marsh
watch: Night.round as Round, while Night.step >= 2
watch: Night.bad as Bad, while Night.nope(
countdown: Night.y2k_end as Midnight, Night.old_end as Gone, while Night.final == true
countdown: Night.dance_at as Dance

GROUP Hosts
  joinable: false

GROUP Crowd

CHANNEL hosts
  kind: faction
  faction: Hosts

CHANNEL chatter
  kind: open

LOCATION Floor

CHARACTER Kernel
  playable: false
  secret: true
  door_code: text? = none

CHARACTER Ivo Marsh

ROLE Program
  cleared: bool = false

INTERACTION open_doors
  who: admin
  act: A · Doors

INTERACTION read_out
  who: admin

INTERACTION wave
  who: performer
  act: Not a cue

INTERACTION last_call
  who: admin
  act: B · Close

when last_call:
  if Night.step == 9:
    set Night.step = 10
  else:
    broadcast "Not yet" to channel(hosts)

== Doors
Hello.
`;

  it("act only on admin interactions (absent from PrimeView)", () => {
    const sim = Sim.fromSources(BOARD);
    const ix = modView(sim, "open", "x").interactions ?? [];
    expect(ix.find((i) => i.id === "open_doors")?.act).toBe("A · Doors");
    expect(ix.find((i) => i.id === "read_out")).not.toHaveProperty("act");
    expect(ix.find((i) => i.id === "last_call")?.act).toBe("B · Close");
    expect(ix.find((i) => i.id === "wave")).not.toHaveProperty("act");
    // wave 13: admin cues never reach a booth's PrimeView at all.
    const prime = primeView(sim, "Ivo Marsh").interactions;
    expect(prime.map((i) => i.id)).not.toContain("open_doors");
    expect(prime.every((i) => i.who === "performer" && !("act" in i))).toBe(true);
  });

  it("resolves each watch item's scope: character, role, global, person", () => {
    const sim = Sim.fromSources(BOARD);
    expect(boardFor(sim).watch).toEqual([
      { label: "Clock", path: "Night.clock", person: null, scope: "global" },
      { label: "Door code", path: "Kernel.door_code", person: null, scope: "character", secret: true },
      { label: "Cleared", path: "Program.cleared", person: null, scope: "role" },
      { label: "Mood", path: "Floor.mood", person: null, scope: "global" },
      { label: "Ivo Marsh", path: null, person: "Ivo Marsh", scope: "person" },
    ]);
    // A head spelled loosely still names the declared character.
    const loose = Sim.fromSources(BOARD.replace("Kernel.door_code as Door code", "kernel.door_code as Door code"));
    expect(boardFor(loose).watch[1]).toEqual({ label: "Door code", path: "Kernel.door_code", person: null, scope: "character", secret: true });
  });

  it("`secret` comes from a `secret: true` CHARACTER only", () => {
    const sim = Sim.fromSources(BOARD.replace("  secret: true\n", ""));
    expect(boardFor(sim).watch.find((w) => w.label === "Door code")).not.toHaveProperty("secret");
    expect(boardFor(Sim.fromSources(BOARD)).watch.filter((w) => w.secret === true).map((w) => w.label)).toEqual(["Door code"]);
  });

  it("the mod view's cast marks a `secret: true` CHARACTER, watched or not", () => {
    const cast = modView(Sim.fromSources(BOARD), "open", "board").cast;
    expect(cast.filter((c) => c.secret === true).map((c) => c.id)).toEqual(["Kernel"]);
    expect(cast.find((c) => c.id === "Ivo Marsh")).not.toHaveProperty("secret");
  });

  it("a `while`-false line is omitted until it holds", () => {
    const sim = Sim.fromSources(BOARD);
    expect(boardFor(sim).watch.map((w) => w.label)).not.toContain("Round");
    sim.setVar("Night.step", "2");
    expect(boardFor(sim).watch.map((w) => w.label)).toContain("Round");
    expect(modView(sim, "open", "x").watch?.map((w) => w.label)).toContain("Round");
  });

  it("a throwing condition is omitted, and the rest of the board stands", () => {
    const sim = Sim.fromSources(BOARD);
    sim.setVar("Night.step", "2");
    const labels = boardFor(sim).watch.map((w) => w.label);
    expect(labels).not.toContain("Bad");
    expect(labels).toEqual(["Clock", "Door code", "Cleared", "Mood", "Ivo Marsh", "Round"]);
  });

  it("countdowns: only on a live line, only while the deadline is ahead", () => {
    const sim = Sim.fromSources(BOARD);
    expect(boardFor(sim).countdowns).toEqual([]);
    expect(modView(sim, "open", "x")).not.toHaveProperty("countdowns");
    sim.tick(100_000); // 100 s in
    sim.setVar("Night.dance_at", "110");
    sim.setVar("Night.y2k_end", "3700");
    sim.setVar("Night.old_end", "50"); // already past
    expect(boardFor(sim).countdowns).toEqual([{ label: "Dance", path: "Night.dance_at", endsAt: 110 }]);
    sim.setVar("Night.final", "true");
    expect(boardFor(sim).countdowns).toEqual([
      { label: "Midnight", path: "Night.y2k_end", endsAt: 3700 },
      { label: "Dance", path: "Night.dance_at", endsAt: 110 },
    ]);
    sim.tick(10_000); // the dance deadline is now, not ahead
    expect(modView(sim, "open", "x").countdowns).toEqual([{ label: "Midnight", path: "Night.y2k_end", endsAt: 3700 }]);
  });

  it("a countdown on a `secret: true` CHARACTER never leaves the server", () => {
    const src = BOARD.replace("countdown: Night.dance_at as Dance", "countdown: Night.dance_at as Dance, Kernel.deadline as Lock");
    const sim = Sim.fromSources(src);
    sim.tick(100_000);
    sim.setVar("Night.dance_at", "110");
    sim.setVar("Kernel.deadline", "4242");
    expect(boardFor(sim).countdowns).toEqual([{ label: "Dance", path: "Night.dance_at", endsAt: 110 }]);
    const view = modView(sim, "open", "x");
    expect(view.countdowns).toEqual([{ label: "Dance", path: "Night.dance_at", endsAt: 110 }]);
    const lean = cueSheetView(view);
    expect(lean.countdowns).toEqual([{ label: "Dance", endsAt: 110 }]);
    expect(JSON.stringify(view)).not.toContain('"Lock"');
    expect(JSON.stringify(lean)).not.toContain("4242");
    // The same deadline on a CHARACTER that is not secret counts down.
    const open = Sim.fromSources(src.replace("  secret: true\n", ""));
    open.tick(100_000);
    open.setVar("Kernel.deadline", "4242");
    expect(boardFor(open).countdowns).toEqual([{ label: "Lock", path: "Kernel.deadline", endsAt: 4242 }]);
  });

  it("no board lines: no `watch` / `countdowns` on the view", () => {
    const sim = Sim.fromSources(SCENARIO);
    const v = modView(sim, "open", "x");
    expect(v).not.toHaveProperty("watch");
    expect(v).not.toHaveProperty("countdowns");
    expect(boardFor(sim)).toEqual({ watch: [], countdowns: [] });
  });

  it("`staff` on the staff channel only", () => {
    const sim = Sim.fromSources(BOARD);
    const ch = modView(sim, "open", "x").channels;
    expect(ch.filter((c) => c.staff === true).map((c) => c.id)).toEqual(["room:hosts"]);
    expect(ch.find((c) => c.id === "room:chatter")).not.toHaveProperty("staff");
    expect(ch.find((c) => c.id === "faction:Hosts")).not.toHaveProperty("staff");
    expect([...staffRoomIds(sim.model)]).toEqual(["hosts"]);
  });

  it("`staffRoomIds` is the rule `refusedPress` judges by: a `# hosts`-only answer is a refusal", () => {
    const sim = Sim.fromSources(BOARD);
    expect(pressRefused(sim, sim.signal("last_call"))).toBe(true);
    expect(modView(sim, "open", "x").cues).toEqual({ last: null, lastBy: null, fired: [], presses: 0, pressed: null });
    sim.setVar("Night.step", "9");
    expect(pressRefused(sim, sim.signal("last_call"))).toBe(false);
    expect(modView(sim, "open", "x").cues?.last).toBe("last_call");
    // The show's staff rooms: `# hosts` and the Antivirus' `# quarantine`.
    const show = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    expect([...staffRoomIds(show.model)].sort()).toEqual(["hosts", "quarantine"]);
    expect(modView(show, "open", "x").channels.filter((c) => c.staff === true).map((c) => c.id).sort()).toEqual(["room:hosts", "room:quarantine"]);
  });
});

describe("wave 11 (lane server-a): guest countdowns, armed buttons, the roster's flags", () => {
  const SRC = `# Night
start: Doors
countdown: Night.summons_end as Summons for guests
countdown: Night.hunt_end as Hunt, while Night.phase == "hunt", for guests
countdown: Night.y2k_end as Midnight
countdown: Kernel.deadline as Lock, for guests

CHARACTER Kernel
  playable: false
  secret: true

CHARACTER Microsoft Excel
  reserved: true

CHARACTER Calculator

INTERACTION confess
  who: guest
  arm: true

INTERACTION wave
  who: guest

INTERACTION verdict
  who: performer
  arm: TRUE

INTERACTION blackout
  who: admin
  arm: true

== Doors
Hello.
`;

  it("a guest sees only the `for guests` lines, never a secret head, only while live and ahead", () => {
    const sim = Sim.fromSources(SRC);
    sim.createPerson("g1", "Ada");
    expect(guestView(sim, "g1")).not.toHaveProperty("countdowns");
    sim.tick(100_000);
    sim.setVar("Night.summons_end", "160");
    sim.setVar("Night.hunt_end", "400");
    sim.setVar("Night.y2k_end", "3700");
    sim.setVar("Kernel.deadline", "4242");
    expect(guestView(sim, "g1").countdowns).toEqual([{ label: "Summons", path: "Night.summons_end", endsAt: 160 }]);
    sim.setVar("Night.phase", "hunt");
    expect(guestView(sim, "g1").countdowns).toEqual([
      { label: "Summons", path: "Night.summons_end", endsAt: 160 },
      { label: "Hunt", path: "Night.hunt_end", endsAt: 400 },
    ]);
    // The director still sees every line (and still never the Kernel's).
    expect(modView(sim, "open", "x").countdowns?.map((c) => c.label)).toEqual(["Summons", "Hunt", "Midnight"]);
    const json = JSON.stringify(guestView(sim, "g1"));
    expect(json).not.toContain("Midnight");
    expect(json).not.toContain("4242");
    sim.tick(60_000); // the summons deadline is now, not ahead
    expect(guestView(sim, "g1").countdowns?.map((c) => c.label)).toEqual(["Hunt"]);
  });

  it("a story with no `for guests` line puts nothing on a guest", () => {
    const sim = Sim.fromSources(SRC.replace(/, for guests|for guests/gu, ""));
    sim.createPerson("g1", "Ada");
    sim.tick(100_000);
    sim.setVar("Night.summons_end", "160");
    expect(guestView(sim, "g1")).not.toHaveProperty("countdowns");
    expect(modView(sim, "open", "x").countdowns?.map((c) => c.label)).toEqual(["Summons"]);
  });

  it("`arm: true` rides every view that lists the button (and the lean cue sheet)", () => {
    const sim = Sim.fromSources(SRC);
    sim.createPerson("g1", "Ada");
    const guest = guestView(sim, "g1").interactions;
    expect(guest.find((i) => i.id === "confess")?.arm).toBe(true);
    expect(guest.find((i) => i.id === "wave")).not.toHaveProperty("arm");
    expect(primeView(sim, "Calculator").interactions.find((i) => i.id === "verdict")?.arm).toBe(true);
    const mod = modView(sim, "open", "x");
    expect(mod.interactions?.filter((i) => i.arm === true).map((i) => i.id)).toEqual(["confess", "verdict", "blackout"]);
    expect(cueSheetView(mod).interactions.find((i) => i.id === "blackout")?.arm).toBe(true);
    expect(sim.model.interactions.get("wave")!.arm).toBe(false);
    // C5 types it `arm?: boolean` (only ever sent when true): a mirrored
    // summary that carries `arm: false` must still type-check.
    const off: InteractionSummary = { ...guest.find((i) => i.id === "wave")!, arm: false };
    const cue: CueInteraction = { ...cueSheetView(mod).interactions[0]!, arm: false };
    expect([off.arm, cue.arm]).toEqual([false, false]);
  });

  it("the roster marks gone guests and personas off the world; the cast marks reserved programs", () => {
    const sim = Sim.fromSources(SRC);
    sim.createPerson("g1", "Ada");
    sim.createPerson("p-1", "Rehearsal");
    sim.setVar("p-1.persona", "true");
    expect(modView(sim, "open", "x").roster.map((r) => [r.id, r.gone ?? false, r.persona ?? false])).toEqual([
      ["g1", false, false],
      ["p-1", false, true],
    ]);
    sim.setVar("g1.gone", "true");
    expect(modView(sim, "open", "x").roster.find((r) => r.id === "g1")?.gone).toBe(true);
    sim.setVar("g1.gone", "false");
    expect(modView(sim, "open", "x").roster.find((r) => r.id === "g1")).not.toHaveProperty("gone");
    const cast = modView(sim, "open", "x", { guests: new Set(), primes: new Set(), mods: 0, directors: [], unlocks: new Map([["Microsoft Excel", 1234]]) }).cast;
    expect(cast.find((c) => c.id === "Microsoft Excel")).toMatchObject({ reserved: true, unlockedUntil: 1234 });
    expect(cast.find((c) => c.id === "Calculator")).not.toHaveProperty("reserved");
    expect(sim.model.characters.get("Calculator")!.reserved).toBe(false);
  });

  it("`lastSeen` comes from presence; null when never heard from", () => {
    const sim = Sim.fromSources(SRC);
    sim.createPerson("g1", "Ada");
    sim.createPerson("g2", "Bo");
    const v = modView(sim, "open", "x", { guests: new Set(), primes: new Set(), mods: 0, directors: [], lastSeen: new Map([["g1", 99]]) });
    expect(v.roster.map((r) => [r.id, r.lastSeen])).toEqual([
      ["g1", 99],
      ["g2", null],
    ]);
    expect(modView(sim, "open", "x").roster[0]).not.toHaveProperty("lastSeen");
  });
});
