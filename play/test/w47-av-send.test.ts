// Wave 47: an Antivirus can send any program to the Internet once the Bingo
// round is over (wave 46 made 🛡 live on every card then), so every scan
// offers it. A player's card face is otherwise only what an objective
// names, at most three: after Bingo the Antivirus' patrol names 👁 and
// scan, so 🛡 never showed on an unmarked program's card (seen in Chrome).

import { describe, expect, it } from "vitest";
import { FACE_MAX, cardButtons, faceGroups } from "../src/booth/model.ts";
import type { GuestCardView, Interaction, ObjectiveView } from "../src/types.ts";

const NORTON = "Norton Anti-Virus";
const AV = ["Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software"];
const i = (id: string, label: string, extra: Partial<Interaction> = {}): Interaction => ({ id, label, who: "performer", description: null, ...extra });
const list: Interaction[] = [
  i("send to the internet", "🛡 Send to the Internet", { actors: AV, only: true, arm: true }),
  i("accuse", "👁 Put on the watchlist", { actors: AV }),
  i("broker_deal", "🤝 Brokered a deal", { actors: ["McAfee Anti-Virus"] }),
  i("pay_truthcoin", "🪙 Pay", { actors: AV }),
  i("charge_truthcoin", "🪙 Charge", { actors: AV }),
  i("unmark_for_reinstallation", "🩹 Unmark: not going to the Internet", { actors: AV }),
  i("bingo_winner", "🎱 Bingo winner", { actors: ["Clippy"], only: true }),
];
const obj = (id: string, buttons: string[]): ObjectiveView => ({ id, title: id, brief: "", checklist: [], buttons, act: null });
const card = (live: string[]): GuestCardView => ({ guest: { id: "g-1", name: "Ada", faction: null, captured: false, location: null }, live, guestScoped: [], readouts: [] });
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
  it("only a booth's own capture: never Clippy's card, never a host's, never a non-capture", () => {
    expect(face([obj("Celebrate", ["bingo_winner"])], ["bingo_winner", "send to the internet"], "Clippy")).toEqual(["bingo_winner"]);
    expect(face([obj("Host job", [])], ["send to the internet"], "Task Manager", true)).toEqual([]);
    expect(face([patrol], ["accuse", "unmark_for_reinstallation"])).toEqual(["accuse"]);
  });
});
