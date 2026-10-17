import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { guestView, modView, primeView, titleOf } from "../server/views.ts";
import { scenarioSource } from "../examples/load.ts";
import { heldCharacters } from "../server/identity.ts";

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
    expect(cueState(sim)).toEqual({ last: null, lastBy: null, fired: [] });
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

CHANNEL hosts
  kind: open

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
    for (const id of ["the simulation completed", "the golden duck", "server_door_opened", "printer_button_pressed", "printer_opened", "patch_combo_a", "patch_combo_b", "patch_rejected", "chess_won", "spin_the_bottle"]) expect(off).toContain(id);
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
    // Only the two repeatable cues may carry `repeat: true` (the story marks them).
    const repeat = (modView(sim, "open", "x").interactions ?? []).filter((i) => i.repeat === true).map((i) => i.id);
    expect(repeat.every((id) => ["read_the_results", "zip_everyone_out"].includes(id))).toBe(true);
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
    expect(modView(sim, "open", "x").cast.find((c) => c.id === "Clippy")).toEqual({ id: "Clippy", faction: "Hosts", part: true });
  });

  it("flags the cues that need a person: the ceremony's awards ask for the winner (K-25)", () => {
    const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    const admin = (modView(sim, "open", "x").interactions ?? []).filter((i) => i.who === "admin");
    const needs = admin.filter((i) => i.subject === true).map((i) => i.id);
    // ♟ names the winner too: the door code goes to whoever mated the King (wave 7).
    for (const a of ["award_most_trusted", "award_best_liar", "award_quest_completionist", "chess_won"]) expect(needs).toContain(a);
    // Global cues stay one click, including the ceremony's own start.
    for (const a of ["call_to_the_desktop", "start_the_ceremony", "server_door_opened", "reset_server_room"]) expect(needs).not.toContain(a);
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
