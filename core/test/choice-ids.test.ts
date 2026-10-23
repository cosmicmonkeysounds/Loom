//! Menu ids (wave 20, D18): every pending menu carries the log index of
//! its `choicePrompted` event, so a client answers the one it shows
//! wherever it sits in the person's queue.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { guestView } from "../server/views.ts";
import { decisionChannelFor, menuChannelsFor } from "../server/chat.ts";

const SOURCE = `
LOCATION Server Room
LOCATION Desktop

CHARACTER Trabolta
CHARACTER Clippy

ROLE Program
  picked: text = "none"
  when tablet for program:
    -> Tablet Video
  when heart for program:
    -> Heart Talk

== Tablet Video
  setting: Desktop
  cast: Clippy
Clippy: Where is the exit?
* Up the stairs.
  set program.picked = "stairs"
* I don't know.
  set program.picked = "dunno"

== Heart Talk
  setting: Server Room
  cast: Trabolta
Trabolta: Close the door.
+ ⟦ASK⟧ Why are you here?
  set program.picked = "why"
+ ⟦LEAVE⟧ Goodbye.
  set program.picked = "bye"
Trabolta: So.
`;

const prompts = (evs: SimEvent[]) => evs.filter((e): e is Extract<SimEvent, { type: "choicePrompted" }> => e.type === "choicePrompted");

function twoMenus(): { sim: Sim; older: SimEvent[]; newer: SimEvent[] } {
  const sim = Sim.fromSources(SOURCE);
  sim.createPerson("g1", "Excel");
  const older = sim.signal("tablet", "g1");
  const newer = sim.signal("heart", "g1");
  return { sim, older, newer };
}

describe("menu ids — the sim", () => {
  it("each prompt's id is its own log index, and the menu carries its beat", () => {
    const { sim, older, newer } = twoMenus();
    const [a] = prompts(older);
    const [b] = prompts(newer);
    expect(sim.log.all()[a!.id!]).toBe(a);
    expect(sim.log.all()[b!.id!]).toBe(b);
    expect(sim.pendingChoicesFor("g1")).toEqual([
      { id: a!.id, beat: "Tablet Video", options: ["Up the stairs.", "I don't know."] },
      { id: b!.id, beat: "Heart Talk", options: ["⟦ASK⟧ Why are you here?", "⟦LEAVE⟧ Goodbye."] },
    ]);
  });

  it("answering the newer menu by id leaves the older one queued", () => {
    const { sim, older, newer } = twoMenus();
    const after = sim.choose("g1", 0, prompts(newer)[0]!.id);
    expect(sim.world.get("g1.picked")).toMatchObject({ value: "why" });
    expect(after.some((e) => e.type === "dialogue" && e.text === "So.")).toBe(true);
    expect(sim.pendingChoicesFor("g1").map((c) => c.id)).toEqual([prompts(older)[0]!.id]);
    expect(sim.pendingChoiceFor("g1")).toEqual(["Up the stairs.", "I don't know."]);
  });

  it("without an id the oldest menu answers, as before", () => {
    const { sim, newer } = twoMenus();
    sim.choose("g1", 1);
    expect(sim.world.get("g1.picked")).toMatchObject({ value: "dunno" });
    expect(sim.pendingChoicesFor("g1").map((c) => c.id)).toEqual([prompts(newer)[0]!.id]);
  });

  it("an unknown id answers nothing", () => {
    const { sim } = twoMenus();
    sim.choose("g1", 0, 99_999);
    expect(["stairs", "dunno", "why", "bye"]).not.toContain((sim.world.get("g1.picked") as { value: unknown }).value);
    expect(sim.pendingChoicesFor("g1")).toHaveLength(2);
  });

  it("ids are equal after a replay of the same commands", () => {
    const a = twoMenus().sim;
    const b = twoMenus().sim;
    expect(b.pendingChoicesFor("g1")).toEqual(a.pendingChoicesFor("g1"));
    expect([...b.pendingChoiceIds()]).toEqual([...a.pendingChoiceIds()]);
  });
});

describe("menu ids — the view", () => {
  it("menuChannelsFor docks each menu under the character who asked it", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.createPerson("g1", "Excel");
    const batch = [...sim.signal("tablet", "g1"), ...sim.signal("heart", "g1")];
    const ids = prompts(batch).map((p) => p.id!);
    expect([...menuChannelsFor(batch)]).toEqual([
      [ids[0], "dm:Clippy"],
      [ids[1], "dm:Trabolta"],
    ]);
    // The one-channel helper still answers the first prompt's.
    expect(decisionChannelFor(batch, "g1")).toBe("dm:Clippy");
  });

  it("a menu nobody spoke before docks in the lobby; a hand-built prompt has no id", () => {
    expect([...menuChannelsFor([{ type: "choicePrompted", person: "g1", promptId: "g1", options: ["a"], id: 4 }])]).toEqual([[4, "lobby"]]);
    expect(menuChannelsFor([{ type: "choicePrompted", person: "g1", promptId: "g1", options: ["a"] }]).size).toBe(0);
  });

  it("GuestView.choices lists every pending menu, oldest first, with its channel", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.createPerson("g1", "Excel");
    const batch = [...sim.signal("tablet", "g1"), ...sim.signal("heart", "g1")];
    const [a, b] = prompts(batch).map((p) => p.id!);
    const v = guestView(sim, "g1", "dm:Clippy", undefined, menuChannelsFor(batch));
    expect(v.choices).toEqual([
      { id: a, beat: "Tablet Video", channel: "dm:Clippy", options: ["Up the stairs.", "I don't know."] },
      { id: b, beat: "Heart Talk", channel: "dm:Trabolta", options: ["⟦ASK⟧ Why are you here?", "⟦LEAVE⟧ Goodbye."] },
    ]);
    // The phone's tray keeps reading the oldest.
    expect(v.pendingChoice).toEqual(["Up the stairs.", "I don't know."]);
    expect(v.decisionChannel).toBe("dm:Clippy");
    // The runtime's per-person record names the newest prompt's channel;
    // the tray still docks under the oldest menu's own.
    expect(guestView(sim, "g1", "dm:Trabolta", undefined, menuChannelsFor(batch)).decisionChannel).toBe("dm:Clippy");
    // No channel record: the lobby.
    expect(guestView(sim, "g1").choices!.map((c) => c.channel)).toEqual(["lobby", "lobby"]);
    sim.createPerson("g2", "Word");
    expect(guestView(sim, "g2").choices).toEqual([]);
  });
});
