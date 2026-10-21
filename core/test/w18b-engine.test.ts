//! Wave 18b — the engine lane's smaller additions: the `names()` builtin,
//! the `badge:` header, `lobby: hidden`, the approver's `as` / `audit`
//! clauses and conditional avatars.

import { describe, expect, it } from "vitest";
import { Sim, joinNames } from "../src/runtime/sim/sim.ts";

describe("names() (wave 18b)", () => {
  const SRC = `# Roll Call
CHARACTER Night
  said: text? = none
  none: text? = none

ROLE Program
  problem: text? = none

when roll_call:
  set Night.said = names([p for p in Persons where p.problem == "slow"])
  set Night.none = names([p for p in Persons where p.problem == "nobody"])
`;

  it("joins display names for speech, and is empty for an empty list", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A and B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
    const sim = Sim.fromSources(SRC);
    sim.createPerson("g1", "Winamp");
    sim.createPerson("g2", "Clippy Two");
    sim.createPerson("g3", "Excel");
    sim.setVar("g1.problem", "slow");
    sim.setVar("g3.problem", "slow");
    sim.signal("roll_call");
    expect(sim.world.get("Night.said")).toEqual({ kind: "string", value: "Winamp and Excel" });
    expect(sim.world.get("Night.none")).toEqual({ kind: "string", value: "" });
  });
});

import { Workspace } from "../src/lsp/index.ts";
import { badgesOf, parseBadgeLine } from "../src/runtime/sim/badges.ts";
import { guestView, modView, primeView, rosterRow } from "../server/views.ts";

const BADGES = `# Badges
badge: program.afk as 🚻 Bathroom Mode
badge: program.virus as 🦠 Virus
badge: Kernel.armed as 🔒 Armed
badge: Clippy.busy as ⏳ Busy, while Night.step >= 2
badge: program.loud as 📣
lobby: hidden
directory: everyone

CHARACTER Night
  step: 0 to 99 = 0

CHARACTER Kernel
  secret: true
  armed: bool = false

CHARACTER Clippy
  listed: true
  busy: bool = false

ROLE Program
  afk: bool = false
  virus: bool = false
  loud: bool = false
  secret: virus
`;

function codesOf(source: string, code: string): Array<{ message: string; error: boolean }> {
  const ws = new Workspace();
  ws.open("file:///main.loom", source);
  return (ws.diagnosticsFor("file:///main.loom")?.diagnostics ?? []).filter((d) => d.code === code).map((d) => ({ message: d.message, error: d.severity === 1 }));
}

describe("badge: (wave 18b)", () => {
  it("parses a path, a glyph and a label, with an optional while", () => {
    expect(parseBadgeLine("program.afk as 🚻 Bathroom Mode")).toMatchObject({ head: "program", rest: "afk", glyph: "🚻", label: "Bathroom Mode", while: null });
    expect(parseBadgeLine("program.afk as 🚻")).toMatchObject({ glyph: "🚻", label: "🚻" });
    expect(parseBadgeLine("Clippy.busy as ⏳ Busy, while Night.step >= 2")).toMatchObject({ head: "Clippy", glyph: "⏳", while: "Night.step >= 2" });
    expect(parseBadgeLine("program.afk")).toBeNull(); // no `as`
    expect(parseBadgeLine("Microsoft Excel as 🚻 x")).toBeNull(); // not a path
    expect(parseBadgeLine("program.afk as 🚻 A, program.b as B")).toBeNull(); // one item only
  });

  it("puts only true, non-secret badges on every people list", () => {
    const sim = Sim.fromSources(BADGES);
    sim.createPerson("g1", "Ada");
    sim.createPerson("g2", "Bob");
    expect(sim.model.badges).toHaveLength(5);
    expect(badgesOf(sim, "g1")).toEqual([]);
    expect(guestView(sim, "g2").people.find((p) => p.id === "g1")).not.toHaveProperty("badges");
    sim.setVar("g1.afk", "true");
    sim.setVar("g1.virus", "true"); // a ROLE secret: never shown
    sim.setVar("Kernel.armed", "true"); // a secret CHARACTER: never shown
    expect(badgesOf(sim, "g1")).toEqual([{ glyph: "🚻", label: "Bathroom Mode" }]);
    expect(guestView(sim, "g2").people.find((p) => p.id === "g1")?.badges).toEqual([{ glyph: "🚻", label: "Bathroom Mode" }]);
    expect(guestView(sim, "g1").badges).toEqual([{ glyph: "🚻", label: "Bathroom Mode" }]);
    expect(guestView(sim, "g2")).not.toHaveProperty("badges");
    expect(rosterRow(sim, "g1")?.badges).toEqual([{ glyph: "🚻", label: "Bathroom Mode" }]);
    expect(modView(sim, "open", null).roster.find((r) => r.id === "g1")?.badges).toEqual([{ glyph: "🚻", label: "Bathroom Mode" }]);
    expect(primeView(sim, "Clippy").guests.find((g) => g.id === "g1")?.badges).toEqual([{ glyph: "🚻", label: "Bathroom Mode" }]);
    sim.setVar("g1.loud", "true");
    expect(badgesOf(sim, "g1").map((b) => b.glyph)).toEqual(["🚻", "📣"]);
    sim.setVar("g1.afk", "false");
    expect(badgesOf(sim, "g1")).toEqual([{ glyph: "📣", label: "📣" }]);
  });

  it("a CHARACTER head reads the character's own path, gated by its while", () => {
    const sim = Sim.fromSources(BADGES);
    sim.createPerson("g1", "Ada");
    sim.setVar("Clippy.busy", "true");
    expect(guestView(sim, "g1").people.find((p) => p.id === "Clippy")).not.toHaveProperty("badges");
    sim.setVar("Night.step", "2");
    expect(guestView(sim, "g1").people.find((p) => p.id === "Clippy")?.badges).toEqual([{ glyph: "⏳", label: "Busy" }]);
  });

  it("L1219: an unparseable line, an unknown head, and a secret (an error)", () => {
    expect(codesOf(BADGES.replace("badge: program.loud as 📣\n", ""), "L1219").filter((d) => d.error)).toHaveLength(2);
    const src = `${BADGES}`.replace("lobby: hidden", "lobby: hidden\nbadge: program.afk\nbadge: Nobody.here as 👻 Ghost");
    const all = codesOf(src, "L1219");
    expect(all.filter((d) => d.error).map((d) => d.message.split("`")[1])).toEqual(["badge: program.virus as 🦠 Virus", "badge: Kernel.armed as 🔒 Armed"]);
    expect(all.filter((d) => !d.error).map((d) => d.message)).toEqual([
      expect.stringContaining("does not parse"),
      expect.stringContaining("names no ROLE"),
    ]);
  });
});

describe("lobby: hidden (wave 18b)", () => {
  it("flags the guest view and keeps the lobby channel", () => {
    const sim = Sim.fromSources(BADGES);
    sim.createPerson("g1", "Ada");
    expect(sim.model.lobbyHidden).toBe(true);
    expect(guestView(sim, "g1").lobby).toBe("hidden");
    const plain = Sim.fromSources("# Plain\nROLE Guest\n");
    plain.createPerson("g1", "Ada");
    expect(plain.model.lobbyHidden).toBe(false);
    expect(guestView(plain, "g1")).not.toHaveProperty("lobby");
  });
});

import { walletRoleOf } from "../src/runtime/sim/model.ts";
import { composeGuestMessages } from "../server/chat.ts";
import type { SimEvent, WalletCard } from "../src/runtime/sim/event.ts";

describe("the approver's as / audit clauses (wave 18b)", () => {
  it("parse in any order, quotes optional, a comma inside quotes kept", () => {
    expect(walletRoleOf('approver, every 3, window 60s, as MyCRA, audit "a CRA audit"')).toEqual({ role: "approver", every: 3, windowMs: 60_000, as: "MyCRA", audit: "a CRA audit" });
    expect(walletRoleOf("approver, audit a spot check, as The Bank")).toEqual({ role: "approver", every: 3, windowMs: 60_000, as: "The Bank", audit: "a spot check" });
    expect(walletRoleOf('approver, audit "an audit, sorry"')).toMatchObject({ audit: "an audit, sorry" });
    expect(walletRoleOf("approver, every 3")).toEqual({ role: "approver", every: 3, windowMs: 60_000 });
    expect(walletRoleOf('approver, as ""')).toBeNull();
    expect(walletRoleOf("minter, as MyCRA")).toBeNull(); // the minter has no `as`
  });

  it("reach the currency's approver", () => {
    const sim = Sim.fromSources(`# Coin
currency: score as Truthcoin

CHARACTER CRA Agent Software
  wallet: approver, every 3, window 60s, as MyCRA, audit "a CRA audit"
`);
    expect(sim.model.currency?.approver).toEqual({ id: "CRA Agent Software", every: 3, windowMs: 60_000, as: "MyCRA", audit: "a CRA audit" });
  });

  it("a held or flagged transfer card is a minor moment; a settled one is not", () => {
    const sim = Sim.fromSources("# Coin\ncurrency: score as Truthcoin\nROLE Guest\n");
    sim.createPerson("g1", "Ada");
    const card = (step: WalletCard["step"]): SimEvent => ({
      type: "wallet",
      to: "g1",
      root: true,
      card: { kind: "transfer", id: "t1", step, from: "g2", fromName: "Bob", to: "g1", toName: "Ada", amount: 5, unit: "Truthcoin", approver: "MyCRA", audit: "a CRA audit" },
    });
    const moments = (["held", "flagged", "settled"] as const).map((s) => composeGuestMessages(sim, [card(s)])[0]?.moment);
    expect(moments).toEqual(["minor", "minor", undefined]);
  });
});
