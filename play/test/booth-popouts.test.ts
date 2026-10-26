// Wave 18 (booth lane): the booth's pop-outs decided (BOOTH-SPEC §4) — the
// Wanted pop-out's variants and bursts, the confrontation trigger, the
// picker layout, PLAYER SELECT's steps, the door queue, Clippy's *Call it?*
// and the moments adapter's table (§4.12).
import { describe, expect, it } from "vitest";

import {
  adaptBoothMessage,
  boardOrder,
  boardStatus,
  boothSeen,
  burstOf,
  claimNote,
  confrontFor,
  coveredElsewhere,
  cueSpecs,
  doorQueue,
  doorSpec,
  leadingGlyph,
  pickLayout,
  pickReadySpec,
  replyLine,
  shieldId,
  stepWord,
  targetSpec,
  wantedSpecs,
  wizardSteps,
  type WantedCtx,
} from "../src/booth/popouts/model.ts";
import type { BoothGuest, BoothMessage, BoothObjective, CallsView, WantedEntry } from "../src/booth/wire.ts";
import type { Interaction } from "../src/types.ts";

const W = (id: string, extra: Partial<WantedEntry> = {}): WantedEntry => ({ id, name: id.toUpperCase(), reason: "named on the Bingo card", location: "Desktop", lastSeen: 1000, markedAt: 10_000, claimedBy: null, captured: false, ...extra });
const ctx = (extra: Partial<WantedCtx> = {}): WantedCtx => ({ me: "Norton", now: 200_000, wall: 200_000, placeTitle: (l) => (l === null ? null : `The ${l}`), guestOf: () => null, tried: new Set(), canRelease: false, ...extra });

describe("the Wanted pop-out (§4.1)", () => {
  it("pops a new unclaimed mark: maroon WANTED, the reason, the place, 🙋 first, no 🛡", () => {
    const r = wantedSpecs([W("mine")], {}, ctx());
    expect(r.raise).toHaveLength(1);
    const d = r.raise[0]!;
    expect(d.key).toBe("wanted:mine");
    expect(d.rev).toBe("open:10000");
    expect(d.tone).toBe("alarm");
    expect(d.priority).toBe(90);
    expect(d.sticky).toBe(true);
    expect(d.body).toEqual(["Marked for reinstallation:", "named on the Bingo card", "not hindered yet"]);
    expect(d.guest?.location).toBe("The Desktop");
    expect(d.guest?.seen).toBe("seen 3 min ago");
    expect(d.actions.map((a) => a.label)).toEqual(["🙋 I'll get them", "🗂 Open card"]);
    expect(d.actions[0]!.do).toEqual({ kind: "act", name: "claim_escort", guest: "mine" });
    expect(d.actions.some((a) => a.label.includes("🛡"))).toBe(false);
    expect(d.status).toBe("Nobody is on it yet.");
    expect(r.seen["mine"]).toEqual({ markedAt: 10_000, mode: "raised", claimed: null });
  });

  it("says where a guest in Bathroom Mode is, never 'not hindered'", () => {
    const g: BoothGuest = { id: "mine", name: "MINE", faction: null, captured: false, location: null, flags: [{ label: "Bathroom Mode", path: "x", value: "true", on: true }] };
    const d = wantedSpecs([W("mine")], {}, ctx({ guestOf: () => g })).raise[0]!;
    expect(d.guest?.seen).toBe("🚻 In Bathroom Mode: wait outside, never go in.");
    expect(d.body).not.toContain("not hindered yet");
  });

  it("turns YOURS on my claim, TAKEN (silent, 6 s) on someone else's, 'got there first' after a race", () => {
    const seen = wantedSpecs([W("mine")], {}, ctx()).seen;
    const mine = wantedSpecs([W("mine", { claimedBy: "Norton" })], seen, ctx()).raise[0]!;
    expect(mine.rev).toBe("mine:10000");
    expect(mine.title).toBe("WANTED · YOURS");
    expect(mine.actions[0]!.label).toBe("📷 Scan their pass");
    expect(mine.actions[0]!.do).toEqual({ kind: "scan", guest: "mine", name: "MINE" });
    const withRelease = wantedSpecs([W("mine", { claimedBy: "Norton" })], seen, ctx({ canRelease: true })).raise[0]!;
    expect(withRelease.actions.map((a) => a.label)).toContain("Hand it back");
    const taken = wantedSpecs([W("mine", { claimedBy: "McAfee Anti-Virus" })], seen, ctx()).raise[0]!;
    expect(taken.rev).toBe("taken:McAfee Anti-Virus");
    expect(taken.body).toEqual(["🙋 McAfee Anti-Virus is on MINE."]);
    expect(taken.sound).toBe(false);
    expect(taken.autoRetireMs).toBe(6000);
    expect(taken.priority).toBe(30);
    const raced = wantedSpecs([W("mine", { claimedBy: "McAfee Anti-Virus" })], seen, ctx({ tried: new Set(["mine"]) })).raise[0]!;
    expect(raced.body).toEqual(["🙋 McAfee Anti-Virus got there first."]);
  });

  it("never pops an entry first seen already claimed by someone else", () => {
    const r = wantedSpecs([W("mine", { claimedBy: "McAfee Anti-Virus" })], {}, ctx());
    expect(r.raise).toEqual([]);
    expect(r.seen["mine"]!.mode).toBe("skip");
    // …and stays quiet on the next snapshot too.
    expect(wantedSpecs([W("mine", { claimedBy: "McAfee Anti-Virus" })], r.seen, ctx()).raise).toEqual([]);
  });

  it("pops again (a new rev) when a claim drops back to nobody", () => {
    let seen = wantedSpecs([W("mine")], {}, ctx()).seen;
    seen = wantedSpecs([W("mine", { claimedBy: "McAfee Anti-Virus" })], seen, ctx()).seen;
    const again = wantedSpecs([W("mine")], seen, ctx()).raise[0]!;
    expect(again.rev).toBe("open:10000:again");
  });

  it("retires the pop-out when the program is caught or leaves the board", () => {
    const seen = wantedSpecs([W("mine")], {}, ctx()).seen;
    expect(wantedSpecs([W("mine", { captured: true })], seen, ctx()).retire).toContain("wanted:mine");
    expect(wantedSpecs([], seen, ctx()).retire).toContain("wanted:mine");
  });

  it("folds marks within 10 s into one burst; the individual keys stay quiet", () => {
    const list = [W("a", { markedAt: 10_000 }), W("b", { markedAt: 11_000 }), W("c", { markedAt: 60_000 })];
    expect(burstOf(list).map((g) => g.map((w) => w.id))).toEqual([["a", "b"]]);
    const r = wantedSpecs(list, {}, ctx());
    const keys = r.raise.map((d) => d.key);
    expect(keys).toContain("wanted-burst:10000");
    expect(keys).toContain("wanted:c");
    expect(keys).not.toContain("wanted:a");
    const burst = r.raise.find((d) => d.key.startsWith("wanted-burst"))!;
    expect(burst.title).toBe("2 programs marked");
    expect(burst.rows?.map((g) => g.name)).toEqual(["A", "B"]);
    expect(burst.actions[0]!.label).toBe("🚨 Open the Wanted board");
    // Six at once: four rows and "+2 more".
    const six = wantedSpecs(["a", "b", "c", "d", "e", "f"].map((id, n) => W(id, { markedAt: 1000 + n })), {}, ctx()).raise;
    expect(six).toHaveLength(1);
    expect(six[0]!.rows).toHaveLength(4);
    expect(six[0]!.body).toEqual(["+2 more on the board."]);
    // A burst member still turns YOURS once claimed.
    expect(wantedSpecs([W("a", { claimedBy: "Norton" })], r.seen, ctx()).raise[0]!.rev).toBe("mine:10000");
  });

  it("orders the board: open newest first, mine, others', caught last; counts it", () => {
    const list = [W("x", { captured: true, claimedBy: "Norton" }), W("o1", { markedAt: 1 }), W("o2", { markedAt: 2 }), W("t", { claimedBy: "McAfee" }), W("m", { claimedBy: "Norton" })];
    expect(boardOrder(list, "Norton").map((w) => w.id)).toEqual(["o2", "o1", "m", "t", "x"]);
    expect(boardStatus(list)).toBe("4 marked · 2 claimed · 1 caught");
  });

  it("reads 'seen now' / minutes / never", () => {
    expect(boothSeen(1000, 30_000)).toBe("seen now");
    expect(boothSeen(0, 125_000)).toBe("seen 2 min ago");
    expect(boothSeen(null, 0)).toBe("not seen since the server started");
    expect(boothSeen(undefined, 0)).toBeNull();
  });
});

const I = (id: string, label: string, extra: Partial<Interaction> = {}): Interaction => ({ id, label, who: "performer", description: null, ...extra });
const ints = [
  I("send to the internet", "🛡 Send to the Internet"),
  I("unmark", "🩹 Unmark"),
  I("bingo_winner", "🎱 Bingo winner"),
  I("award_the_ribbon", "🎀 Give the Bingo Ribbon"),
  I("named_at_bingo", "🎯 Named on the card: marked for reinstallation"),
  I("made", "🏓 Made"),
  I("missed", "🏓 Missed: marked for reinstallation"),
  I("truth", "🗣 Truth answered (+50)"),
  I("refused", "🙅 Truth refused: marked for reinstallation"),
];

describe("the confrontation trigger (§4.3)", () => {
  const wanted = [W("g1")];
  it("is one tap after 600 ms from the scanner, two taps from Scan again", () => {
    const r = { guest: { id: "g1" }, card: { live: ["unmark", "send to the internet"] } };
    expect(confrontFor(r, wanted, ints, "scanner")).toMatchObject({ guest: "g1", shield: "send to the internet", arm: false, deadMs: 600 });
    expect(confrontFor(r, wanted, ints, "rescan")).toMatchObject({ arm: true, deadMs: 0 });
  });
  it("is nothing for an unmarked, caught or shield-less scan, or with no board", () => {
    expect(confrontFor({ guest: { id: "zz" }, card: { live: ["send to the internet"] } }, wanted, ints, "scanner")).toBeNull();
    expect(confrontFor({ guest: { id: "g1" }, card: { live: ["send to the internet"] } }, [W("g1", { captured: true })], ints, "scanner")).toBeNull();
    expect(confrontFor({ guest: { id: "g1" }, card: { live: ["unmark"] } }, wanted, ints, "scanner")).toBeNull();
    expect(confrontFor({ guest: { id: "g1" }, card: { live: ["send to the internet"] } }, null, ints, "scanner")).toBeNull();
  });
  it("finds the shield by its glyph, else by its id", () => {
    expect(shieldId(["unmark", "x"], [...ints, I("x", "🛡 Escort to the tent")])).toBe("x");
    expect(shieldId(["send to the internet"], [])).toBe("send to the internet");
    expect(shieldId(["unmark"], ints)).toBeNull();
    expect(claimNote(null, "Norton")).toBe("nobody had claimed them");
    expect(claimNote("Norton", "Norton")).toBe("claimed by you");
    expect(claimNote("McAfee", "Norton")).toBe("McAfee's claim");
  });
});

const obj = (extra: Partial<BoothObjective>): BoothObjective => ({ id: "o", title: "Celebrate The Winners", brief: "", checklist: [], buttons: [], act: null, ...extra });

describe("pickers (§4.6–4.7)", () => {
  const celebrate = obj({
    pick: ["g1", "g2", "g3"],
    buttons: ["scan", "bingo_winner", "award_the_ribbon", "named_at_bingo"],
    checklist: [
      { label: "🎱 Who shouted BINGO?", done: false },
      { label: "🎀 Give the winner the Bingo Ribbon", done: false },
      { label: "🎯 Who did the winner name?", done: false },
      { label: "The first reinstallation", done: false },
    ],
  });
  it("Celebrate → steps in checklist order; Judge The Cup → rows; the bottle → target; none → null", () => {
    expect(pickLayout(celebrate, ints)).toBe("steps");
    expect(pickLayout(obj({ pick: ["g1"], buttons: ["made", "missed"], checklist: [{ label: "Judge every throw", done: null }] }), ints)).toBe("rows");
    expect(pickLayout(obj({ target: { id: "g1", name: "G1" }, buttons: ["truth"] }), ints)).toBe("target");
    expect(pickLayout(obj({ buttons: ["made"] }), ints)).toBeNull();
    expect(pickLayout(undefined, ints)).toBeNull();
  });
  it("orders the steps by the to-dos, pre-selects only a harmless follow-on", () => {
    const reordered = { ...celebrate, buttons: ["named_at_bingo", "award_the_ribbon", "bingo_winner"] };
    const steps = wizardSteps(reordered, ints);
    expect(steps.map((s) => s.id)).toEqual(["bingo_winner", "award_the_ribbon", "named_at_bingo"]);
    expect(steps.map((s) => s.prompt)).toEqual(["🎱 Who shouted BINGO?", "🎀 Give the winner the Bingo Ribbon", "🎯 Who did the winner name?"]);
    expect(steps.map((s) => s.preselect)).toEqual([false, true, false]);
    expect(steps.map((s) => s.destructive)).toEqual([false, false, true]);
    expect(stepWord(steps[0])).toBe("(bingo winner)");
  });
  it("auto-opens after this booth's own fire, else a quiet pop-out (rows silent)", () => {
    expect(pickReadySpec(celebrate, "steps", 1000, 5000, 900)).toBe("open");
    const d = pickReadySpec(celebrate, "steps", null, 5000, 900);
    expect(d).toMatchObject({ key: "pick:o:900", title: "PLAYER SELECT is ready", body: ["3 programs"], priority: 40, sound: true });
    expect((pickReadySpec(celebrate, "rows", null, 5000, 900) as { sound: boolean }).sound).toBe(false);
    expect(pickReadySpec(celebrate, "target", null, 0, 0)).toBeNull();
    // Nobody on the list yet: no "PLAYER SELECT is ready · 0 programs" pop-out (w21 live walk).
    expect(pickReadySpec({ ...celebrate, pick: [] }, "steps", null, 5000, 900)).toBeNull();
  });
  it("the bottle's target pop-out: the guest's live buttons, a destructive one armed, Open card", () => {
    const bottle = obj({ id: "bottle", title: "The bottle: make them answer", target: { id: "g1", name: "Minesweeper", location: "Desktop" }, buttons: ["truth", "refused"] });
    const d = targetSpec(bottle, ["truth", "refused"], ints, (l) => (l === null ? null : `The ${l}`), 42)!;
    expect(d.key).toBe("target:bottle:g1:42");
    expect(d.glyph).toBe("🗣");
    expect(d.guest).toMatchObject({ name: "Minesweeper", location: "The Desktop" });
    expect(d.actions.map((a) => [a.label, a.arm === true])).toEqual([
      ["🗣 Truth answered (+50)", false],
      ["🙅 Truth refused: marked for reinstallation · tap twice", true],
      ["🗂 Open card", false],
    ]);
    // Only the buttons live for that guest.
    expect(targetSpec(bottle, ["truth"], ints, () => null, 42)!.actions.map((a) => a.id)).toEqual(["truth", "card"]);
  });
  it("says what a press came to on the guest's phone", () => {
    expect(replyLine("ICQ", { said: [{ text: "🎱 Bingo!" }] })).toBe("→ ICQ's phone: 🎱 Bingo!");
    expect(replyLine("ICQ", {})).toBe("→ Sent. The story said nothing back.");
    // BN-F13: what reached their phone comes first.
    expect(replyLine("ICQ", { toGuest: ["🎀 You won the Bingo Ribbon."], said: [{ text: "Well done." }] })).toBe("→ ICQ's phone: 🎀 You won the Bingo Ribbon.");
    expect(replyLine("ICQ", { refused: true, staff: ["already has the ribbon"] })).toBe("Not done: already has the ribbon");
    // Wave 26 (B3, 🤐): the story's reply to the booth (Clippy's ⭐ +5) is
    // never shown as the guest's phone; the guest's own lines still win.
    expect(replyLine("Napster", { replies: ["⭐ +5"] })).toBe("→ Sent · ⭐ +5");
    expect(replyLine("Napster", { replies: ["⭐ +5"] })).not.toContain("Napster's phone");
    expect(replyLine("Napster", { replies: ["⭐ +5"], toGuest: ["🎀 You won."] })).toBe("→ Napster's phone: 🎀 You won.");
    expect(replyLine("Napster", { replies: [" "] })).toBe("→ Sent. The story said nothing back.");
    expect(leadingGlyph("🛡️ Send")).toBe("🛡️");
  });
});

const msg = (seq: number, extra: Partial<BoothMessage>): BoothMessage => ({ seq, channel: "dm:Norton", channelKind: "dm", title: "Readout", from: "", kind: "line", text: "", ts: seq * 1000, audience: ["@Norton"], parentSeq: null, hidden: false, ...extra });
const G = (id: string, flags: BoothGuest["flags"] = []): BoothGuest => ({ id, name: id, faction: null, captured: false, location: null, flags });

describe("the door queue (§4.4)", () => {
  const msgs = [msg(5, { readout: true, about: "winamp", text: "🚪 winamp is waiting at the Optical Drive", alert: true }), msg(9, { readout: true, about: "icq", text: "🚪 icq is waiting", alert: true }), msg(10, { readout: true, about: "winamp", text: "🚪 again" })];
  it("lists each waiting guest once, oldest first, minus the cleared", () => {
    expect(doorQueue(msgs, [G("winamp"), G("icq")]).map((e) => [e.id, e.since])).toEqual([["winamp", 5000], ["icq", 9000]]);
    const cleared = G("winamp", [{ label: "Cleared", path: "p", value: "true", on: true }]);
    expect(doorQueue(msgs, [cleared, G("icq")]).map((e) => e.id)).toEqual(["icq"]);
    const claimed = G("icq", [{ label: "At the door", path: "p", value: "McAfee", on: true }]);
    expect(doorQueue(msgs, [G("winamp"), claimed])[1]!.claimedBy).toBe("McAfee");
  });
  it("pops at once for a late arrival, after a minute unclaimed during Door Duty", () => {
    const q = doorQueue(msgs, [G("winamp"), G("icq")]);
    expect(doorSpec(q, 0, 30_000, true)).toBeNull();
    const d = doorSpec(q, 0, 66_000, true)!;
    expect(d).toMatchObject({ key: "door", rev: "winamp", priority: 50, sticky: false });
    expect(d.body).toEqual(["winamp is waiting at the Optical Drive.", "waiting 1:01   +1 more"]);
    expect(d.actions.map((a) => a.label)).toEqual(["🙋 I've got winamp", "🚪 Door queue (2)"]);
    expect(doorSpec(q, 1, 6000, false)!.actions[0]!.label).toBe("📷 Scan winamp's pass");
    // Claimed: the pop-out moves on to the next unclaimed guest.
    expect(doorSpec([{ ...q[0]!, claimedBy: "Norton" }, q[1]!], 1, 10_000, true)!.rev).toBe("icq");
    expect(doorSpec([], 1, 0, true)).toBeNull();
  });
});

describe("Clippy's Call it? (§4.9)", () => {
  const row = (id: string, live: boolean) => ({ id, n: 1, code: "V3", title: "⏰ Bingo time", fired: false, last: false, next: false, sequence: true, live, subject: false, act: null, description: "Close the cards and call the winners" });
  const calls = (live: boolean): CallsView => ({ rows: [row("bingo_time", live)], next: null, last: null, lastName: null, act: null, presses: 4 });
  it("pops only when a cue turns live after the first look", () => {
    expect(cueSpecs(calls(true), null, 0)).toEqual([]);
    expect(cueSpecs(calls(true), new Set(["bingo_time"]), 0)).toEqual([]);
    const [d] = cueSpecs(calls(true), new Set(), 100_000, [{ label: "Bingo time", endsAt: 90 } as never]);
    expect(d!.key).toBe("cue:bingo_time:4");
    expect(d!.body).toEqual(["V3 ⏰ Bingo time", "Bingo time is up. Call it?", "What it does: Close the cards and call the winners"]);
    expect(d!.actions.map((a) => a.label)).toEqual(["🎤 Call it", "Not yet"]);
    expect(cueSpecs(calls(true), new Set(), 0)[0]!.body[1]).toBe("It's live now. Call it?");
  });
});

describe("the moments adapter's table (§4.12)", () => {
  const actx = (open: string | null = null) => ({ wanted: [W("g1")], openGuest: () => open, guestName: (id: string) => id.toUpperCase() });
  it("covers the mark, the late list and the door elsewhere; the 🛡 one by the open screen", () => {
    expect(adaptBoothMessage(msg(1, { readout: true, alert: true, about: "g1", text: "🚨 G1 is marked" }), actx())).toBeNull();
    expect(adaptBoothMessage(msg(2, { readout: true, alert: true, about: "g1", text: "⏰ G1 is late" }), actx())).toBeNull();
    expect(adaptBoothMessage(msg(3, { readout: true, alert: true, about: "zz", text: "🚪 zz is waiting" }), actx())).toBeNull();
    expect(adaptBoothMessage(msg(4, { readout: true, alert: true, about: "g1", text: "🛡 Confront G1" }), actx("g1"))).toBeNull();
    const d = adaptBoothMessage(msg(4, { readout: true, alert: true, about: "g1", text: "🛡 Confront G1", aboutName: "Minesweeper" }), actx());
    expect(d).toMatchObject({ title: "Confrontation: Minesweeper", tone: "alarm" });
    expect((d as { actions: Array<{ do: unknown }> }).actions[0]!.do).toEqual({ kind: "card", guest: "g1", confront: "rescan" });
    expect(adaptBoothMessage(msg(5, { readout: true, alert: true, about: "zz", text: "⚠ zz did a thing" }), actx())).toBe("default");
    // The moments feed drops only what the adapter covers.
    expect(coveredElsewhere(msg(1, { readout: true, alert: true, about: "g1", text: "🚨 G1 is marked" }), actx())).toBe(true);
    expect(coveredElsewhere(msg(6, { readout: true, about: "g1", text: "plain" }), actx())).toBe(false);
  });
});

