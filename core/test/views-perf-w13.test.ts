//! Wave 13 fix round (fperf): the booth flags off a per-model plan, the
//! snapshot's lean flags (contract C3), the scan card's single-guest flags
//! and readout index, the directory's codex index, the award gate (G10 is
//! MS Paint's), the guest view's act-free night, and the static cache rule.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { ChatStore, composeGuestMessages } from "../server/chat.ts";
import { allSnapshotFlags, awardOnly, guestCardView, guestFlags, guestFlagsNow, guestView, nightView, primeView, snapshotFlags } from "../server/views.ts";
import { appCacheControl, IMMUTABLE } from "../server/static-cache.ts";

const SRC = `# Night
start: opening
directory: everyone
watch: program.cleared as Cleared, program.marked as Marked, program.afk as Bathroom Mode, program.score as Score
watch: program.late as Late, while Night.step >= 3

ROLE Program
  cleared: bool = false
  marked: bool = false
  afk: bool = false
  late: bool = false
  score: 0 to 100 = 0
  featured: text = "none"
  when award_painting for program:
    if Night.ceremony != true:
      broadcast "Start the ceremony first." to channel(hosts)
    else if program.featured != "mspaint":
      broadcast "{program.name} is not MS Paint. Nothing was awarded." to channel(hosts)
    else:
      set Night.award = "painting"
  when award_any for program:
    if program.score > 3:
      set Night.award = "any"

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

LOCATION Hall

CHARACTER Norton
  when scanned by program:
    reply Clean: {program.name}.

CHARACTER Clippy
  listed: true

INTERACTION open the doors
  who: admin
  act: A · Doors

INTERACTION award_painting
  who: admin

INTERACTION award_any
  who: admin

CODEX Clippy File
  about: Clippy
  code: C1
  text: x

CODEX Ada Notes
  about: Ada
  code: A1
  text: y

CODEX Ada By Id
  about: g1
  code: A2
  text: z

== opening
Hi.
`;

function fresh() {
  const sim = Sim.fromSources(SRC);
  sim.createPerson("g1", "Ada");
  sim.createPerson("g2", "Bo");
  return sim;
}

describe("snapshot flags (C3)", () => {
  it("a snapshot keeps the flags that are on and the failed gates; the card keeps them all", () => {
    const sim = fresh();
    sim.setVar("g1.score", "4");
    const full = guestFlags(sim, "g1").map((f) => f.label);
    expect(full).toEqual(["Cleared", "Marked", "Bathroom Mode", "Score"]);
    expect(snapshotFlags(guestFlags(sim, "g1")).map((f) => f.label)).toEqual(["Cleared", "Score"]);
    expect(primeView(sim, "Norton").guests.find((g) => g.id === "g1")!.flags!.map((f) => f.label)).toEqual(["Cleared", "Score"]);
    // The card is the full list, from the same objects.
    expect(guestCardView(sim, [], "Norton", "g1", false)!.guest.flags!.map((f) => f.label)).toEqual(full);
    // Cleared and in the bathroom: the gate passed, the mode on.
    sim.setVar("g2.cleared", "true");
    sim.setVar("g2.afk", "true");
    expect(allSnapshotFlags(sim).get("g2")!.map((f) => [f.label, f.on])).toEqual([
      ["Cleared", true],
      ["Bathroom Mode", true],
    ]);
  });

  it("a guest with nothing on and no failed gate carries no flags in a snapshot", () => {
    const sim = Sim.fromSources(SRC.replace("program.cleared as Cleared, ", ""));
    sim.createPerson("g1", "Ada");
    expect(guestFlags(sim, "g1").length).toBeGreaterThan(0);
    expect(primeView(sim, "Norton").guests[0]!.flags).toBeUndefined();
  });
});

describe("the flags round", () => {
  it("is not rebuilt by the story clock alone, unless a line's while reads it", () => {
    const sim = fresh();
    const a = allSnapshotFlags(sim);
    sim.tick(2500);
    expect(allSnapshotFlags(sim)).toBe(a);
    const clocked = Sim.fromSources(SRC.replace("while Night.step >= 3", "while Time.elapsed >= 2"));
    clocked.createPerson("g1", "Ada");
    expect(guestFlags(clocked, "g1").map((f) => f.label)).not.toContain("Late");
    clocked.tick(3000);
    expect(guestFlags(clocked, "g1").map((f) => f.label)).toContain("Late");
  });

  it("one guest's flags read fresh after a commit agree with everyone's", () => {
    const sim = fresh();
    guestFlags(sim, "g1");
    sim.setVar("g1.marked", "true");
    const now = guestFlagsNow(sim, "g1");
    expect(now.find((f) => f.label === "Marked")!.on).toBe(true);
    expect(guestFlags(sim, "g1")).toEqual(now);
    expect(guestFlagsNow(sim, "nobody")).toEqual([]);
  });
});

describe("the scan card's readouts", () => {
  it("follow a growing timeline and skip a hidden readout", () => {
    const sim = fresh();
    const chat = new ChatStore();
    chat.append(composeGuestMessages(sim, sim.scan("Norton", "g1")));
    expect(guestCardView(sim, chat.all(), "Norton", "g1", false)!.readouts).toHaveLength(1);
    for (let k = 0; k < 6; k++) chat.append(composeGuestMessages(sim, sim.scan("Norton", k % 2 === 0 ? "g1" : "g2")));
    const card = guestCardView(sim, chat.all(), "Norton", "g1", false)!;
    expect(card.readouts).toHaveLength(4);
    chat.setHidden(card.readouts[3]!.seq, true);
    const after = guestCardView(sim, chat.all(), "Norton", "g1", false)!.readouts;
    expect(after.map((r) => r.seq)).toEqual(card.readouts.slice(0, 3).map((r) => r.seq));
    // A cleared timeline starts the index over.
    chat.clear();
    expect(guestCardView(sim, chat.all(), "Norton", "g1", false)!.readouts).toEqual([]);
  });
});

describe("the directory's codex index", () => {
  it("finds an entry about a person by id or by folded name, in codex order, once each", () => {
    const sim = fresh();
    for (const code of ["C1", "A1", "A2"]) sim.redeem("g2", code);
    const people = guestView(sim, "g2").people;
    expect(people.find((p) => p.id === "g1")!.known.map((e) => e.title)).toEqual(["Ada Notes", "Ada By Id"]);
    expect(people.find((p) => p.id === "Clippy")!.known.map((e) => e.title)).toEqual(["Clippy File"]);
    expect(guestView(sim, "g1").people.find((p) => p.id === "g2")!.known).toEqual([]);
  });
});

describe("awardOnly", () => {
  it("names the one program a cue's story gate lets take it; none when nobody or several fit", () => {
    const sim = fresh();
    expect(awardOnly(sim)).toEqual({});
    sim.setVar("g2.featured", '"mspaint"');
    expect(awardOnly(sim)).toEqual({ award_painting: { id: "g2", name: "Bo" } });
    sim.setVar("g1.featured", '"mspaint"');
    expect(awardOnly(sim)).toEqual({});
  });
});


describe("GuestView.night", () => {
  it("never carries the cue sheet's act to a guest; a booth keeps it", () => {
    const sim = fresh();
    expect(nightView(sim).act).toEqual({ code: "A", title: "Doors" });
    expect(guestView(sim, "g1").night!.act).toBeNull();
    expect(primeView(sim, "Norton").night!.act).toEqual({ code: "A", title: "Doors" });
  });
});

describe("appCacheControl", () => {
  it("a hashed Vite asset is immutable; HTML and the PWA files revalidate; anything else gets none", () => {
    expect(appCacheControl("assets/index-n38yYZk7.js")).toBe(IMMUTABLE);
    expect(appCacheControl("assets/index-DbZ_x-1q.css")).toBe(IMMUTABLE);
    expect(appCacheControl("assets/ChessTerminal-AbCdEfGh.js")).toBe(IMMUTABLE);
    expect(appCacheControl("index.html")).toBe("no-cache");
    expect(appCacheControl("index.html", false)).toBe("no-cache");
    expect(appCacheControl("sw.js", true)).toBe("no-cache");
    expect(appCacheControl("assets/index-n38yYZk7.js", true)).toBe("no-cache");
    expect(appCacheControl("favicon.ico")).toBeNull();
    expect(appCacheControl("slides/truth_or_dare.png")).toBeNull();
    expect(appCacheControl("assets/logo.svg")).toBeNull();
  });
});
