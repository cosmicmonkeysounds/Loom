import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { guestView, modView, primeView, titleOf } from "../server/views.ts";
import { scenarioSource } from "../examples/load.ts";

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

  it("lists only public factions as the guest's joinable sides", () => {
    const sim = Sim.fromSources(SCENARIO);
    sim.createPerson("g1", "Alice");
    const v = guestView(sim, "g1");
    // The two public sides — never the hidden TheAlgorithm / Glitchers.
    expect(v.factions).toEqual(["Mods", "Chatters"]);
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
