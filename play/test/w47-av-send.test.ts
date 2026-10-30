// Wave 47: an Antivirus can send any program to the Internet once the Bingo
// round is over (wave 46 made 🛡 live on every card then), so every scan
// offers it. A player's card face is otherwise only what an objective
// names, at most three: after Bingo the Antivirus' patrol names 👁 and
// scan, so 🛡 never showed on an unmarked program's card (seen in Chrome).
// The hosts send programs to the Internet too (the story's `by: Antivirus,
// Hosts`, TRAIT Host's hook), so a host's card offers it the same way.

import { describe, expect, it } from "vitest";
import { FACE_MAX, cardButtons, faceGroups } from "../src/booth/model.ts";
import type { GuestCardView, Interaction, ObjectiveView } from "../src/types.ts";

const NORTON = "Norton Anti-Virus";
const AV = ["Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software"];
const HOSTS = ["Task Manager", "Adobe Acrobat", "Recycling Bin"];
const i = (id: string, label: string, extra: Partial<Interaction> = {}): Interaction => ({ id, label, who: "performer", description: null, ...extra });
const list: Interaction[] = [
  i("send to the internet", "🛡 Send to the Internet", { actors: [...AV, ...HOSTS], only: true, hostHeard: false, arm: true }),
  i("accuse", "👁 Put on the watchlist", { actors: AV }),
  i("broker_deal", "🤝 Brokered a deal", { actors: ["McAfee Anti-Virus"] }),
  i("pay_truthcoin", "🪙 Pay", { actors: AV }),
  i("charge_truthcoin", "🪙 Charge", { actors: AV }),
  i("unmark_for_reinstallation", "🩹 Unmark: not going to the Internet", { actors: AV }),
  i("bingo_winner", "🎱 Bingo winner", { actors: ["Clippy"], only: true }),
  i("radio_crew_door", "🔧 Crew door", { actors: AV, only: true }),
  i("radio_combo_a", "🔌 Patch: Combo A is in", { actors: AV, only: true }),
  i("radio_wrong_patch", "❌ Wrong patch", { actors: AV, only: true }),
];
const obj = (id: string, buttons: string[]): ObjectiveView => ({ id, title: id, brief: "", checklist: [], buttons, act: null });
const card = (live: string[], guestScoped: string[] = []): GuestCardView => ({ guest: { id: "g-1", name: "Ada", faction: null, captured: false, location: null }, live, guestScoped, readouts: [] });
const patrol = obj("Patrol The Computer", ["scan", "accuse"]);
const face = (objectives: ObjectiveView[], live: string[], who = NORTON, admin = false) => cardButtons(list, objectives, card(live), who, admin, { player: !admin }).face.map((b) => b.interaction.id);

describe("🛡 on every Antivirus card after the Bingo round (wave 47)", () => {
  it("live for this guest (after Bingo): on the face, though the patrol never names it", () => {
    expect(face([patrol], ["accuse", "send to the internet"])).toEqual(["accuse", "send to the internet"]);
  });
  it("not live (before Bingo, an unmarked program): not on the face", () => {
    expect(face([patrol], ["accuse"])).toEqual(["accuse"]);
  });
  it("past the three when the act's job fills the face (McAfee's exchange)", () => {
    const exchange = obj("The Exchange", ["broker_deal", "pay_truthcoin", "charge_truthcoin"]);
    const f = face([exchange, patrol], ["broker_deal", "pay_truthcoin", "charge_truthcoin", "accuse", "send to the internet"], "McAfee Anti-Virus");
    expect(f.slice(0, FACE_MAX)).toEqual(["broker_deal", "pay_truthcoin", "charge_truthcoin"]);
    expect(f).toContain("send to the internet");
    expect(f).toHaveLength(FACE_MAX + 1);
  });
  it("once, when an objective already names it (Escort The Marked)", () => {
    expect(face([obj("Escort The Marked", ["send to the internet"]), patrol], ["send to the internet", "accuse"])).toEqual(["send to the internet", "accuse"]);
  });
  it("in the card's warning group, so it still arms (tap twice)", () => {
    const b = cardButtons(list, [patrol], card(["accuse", "send to the internet"]), NORTON, false, { player: true }).face;
    expect(faceGroups(b).harm.map((x) => x.interaction.id)).toContain("send to the internet");
  });
  it("only a booth's own capture: never Clippy's card, never a non-capture", () => {
    expect(face([obj("Celebrate", ["bingo_winner"])], ["bingo_winner", "send to the internet"], "Clippy")).toEqual(["bingo_winner"]);
    expect(face([patrol], ["accuse", "unmark_for_reinstallation"])).toEqual(["accuse"]);
  });
});

describe("🛡 on a host's card too", () => {
  it("live for this guest: on a host's face, though no host objective names it", () => {
    for (const host of HOSTS) expect(face([obj("Host job", [])], ["send to the internet"], host, true), host).toEqual(["send to the internet"]);
  });
  it("past the three when the guest's own buttons fill a host's face (the patch-bay alarm)", () => {
    const live = ["radio_crew_door", "radio_combo_a", "radio_wrong_patch", "send to the internet"];
    const b = cardButtons(list, [obj("Host job", [])], card(live, ["radio_crew_door", "radio_combo_a", "radio_wrong_patch"]), "Task Manager", true);
    expect(b.face.map((x) => x.interaction.id)).toEqual([...live.slice(0, FACE_MAX), "send to the internet"]);
    expect(faceGroups(b.face).harm.map((x) => x.interaction.id)).toContain("send to the internet");
  });
  it("never takes one of the three from the guest's own buttons (🩹 stays on a marked program's card)", () => {
    // The guest-scoped list is in story order: 🛡 before 🩹.
    const scoped = ["send to the internet", "radio_crew_door", "radio_combo_a", "unmark_for_reinstallation"];
    const b = cardButtons(list, [obj("Host job", ["radio_crew_door"])], card(scoped, scoped), "Task Manager", true);
    expect(b.face.map((x) => x.interaction.id)).toEqual(["radio_crew_door", "radio_combo_a", "unmark_for_reinstallation", "send to the internet"]);
  });
  it("not live (an unmarked program before Bingo): not on a host's face", () => {
    expect(face([obj("Host job", [])], [], "Task Manager", true)).toEqual([]);
  });
});
