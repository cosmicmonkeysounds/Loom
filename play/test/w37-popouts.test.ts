// Wave 37, lane B (pop-outs): a performer's phone is about their job (C6:
// the booth's moments feed), NEW MISSION said once (C7: reconcile), one
// game pop-out at a time (C8), no stale 🚨 readout pop-out (C10) and the
// Wanted board's Open tab that keeps a claimed poster in place (C11).
import { describe, expect, it } from "vitest";

import { boothMine, boothMomentFeed, offDuty, type BoothFeedOptions } from "../src/booth/moments-feed.ts";
import { MISSION_GAME_MS, missionHeadline, openTabIds, reconcilePopOuts, type HeldPopOut, type ReconcileCtx } from "../src/booth/popouts/model.ts";
import type { BoothObjective, WantedEntry } from "../src/booth/wire.ts";
import type { ChatMessage } from "../src/types.ts";

const ME = "Norton Anti-Virus";
let seq = 1;
const m = (extra: Partial<ChatMessage>): ChatMessage => ({ seq: seq++, channel: `dm:${ME}`, channelKind: "dm", title: ME, from: "", kind: "narration", text: "x", ts: 10_000, audience: [`@${ME}`], parentSeq: null, hidden: false, ...extra }) as ChatMessage;
const feed = (list: ChatMessage[], extra: Partial<BoothFeedOptions> = {}) => boothMomentFeed(new Map(list.map((x) => [x.seq, x])), { character: ME, staffRooms: new Set(), guestName: (id) => ({ "g-1": "WinZip", "g-2": "GarageBand", "g-3": "LimeWire" })[id] ?? null, names: ["WinZip", "GarageBand", "LimeWire"], ...extra });
const shown = (out: ReadonlyMap<number, ChatMessage>) => [...out.values()].filter((x) => !x.hidden);

describe("C6: the booth's moments feed is about the booth's job", () => {
  it("a line to everyone never reaches a booth's layer (player or host); it is still in the map", () => {
    const lobby = m({ channel: "lobby", channelKind: "lobby", audience: "all", alert: true, text: "📣 Everyone to the Desktop!" });
    for (const player of [true, false]) {
      const out = feed([lobby], { player });
      expect(out.get(lobby.seq)!.hidden).toBe(true);
      expect(out.get(lobby.seq)!.text).toBe(lobby.text);
    }
    expect(offDuty(lobby, { character: ME })).toBe(true);
  });

  it("a quest is no moment on a player's booth; a host's booth keeps it", () => {
    const quest = m({ quest: { id: "q1", title: "Per the agenda" } as never, text: "New quest" });
    expect(feed([quest], { player: true }).get(quest.seq)!.hidden).toBe(true);
    expect(feed([quest], { player: false }).get(quest.seq)!.hidden).toBe(false);
    expect(feed([quest]).get(quest.seq)!.hidden).toBe(false);
  });

  it("boothMine: my claims and door claims only (wave 37b: not every loose mark — a readout lands before the view that ends the mark)", () => {
    const board = [W("g-1"), W("g-2", { claimedBy: "McAfee Anti-Virus" }), W("g-3", { claimedBy: ME }), W("g-4", { captured: true })];
    const door = (id: string) => (id === "g-9" ? ME : null);
    const mine = boothMine(board, door, ME);
    expect(["g-1", "g-2", "g-3", "g-4", "g-9", "g-0"].map(mine)).toEqual([false, false, true, false, true, false]);
    // Through the feed: "Off the escort list" about an unclaimed mark another booth caught is not a moment.
    const off = m({ readout: true, about: "g-1", moment: "minor" as never, text: "✅ A made-up program: sent on. Off the escort list." });
    expect(feed([off], { mine }).get(off.seq)!.hidden).toBe(true);
  });

  it("a minor readout about someone else's guest only badges Readouts; about mine it is a moment", () => {
    const off = m({ readout: true, about: "g-1", text: "✅ WinZip: in the Internet. Off the escort list." });
    const mine = (id: string) => id === "g-2";
    expect(feed([off], { mine }).get(off.seq)!.hidden).toBe(true);
    const yours = m({ readout: true, about: "g-2", text: "✅ GarageBand: in the Internet. Off the escort list." });
    expect(feed([yours], { mine }).get(yours.seq)!.hidden).toBe(false);
    // Without `mine` the booth behaves as before.
    expect(feed([off]).get(off.seq)!.hidden).toBe(false);
  });

  it("a `!` readout about a guest, a big one, and one about nobody stay moments", () => {
    const mine = () => false;
    const alert = m({ readout: true, alert: true, about: "g-1", text: "⚠ WinZip pulled the plug" });
    const big = m({ readout: true, moment: "big" as never, about: "g-1", text: "💥 WinZip" });
    const own = m({ readout: true, text: "⭐ +10" });
    const out = feed([alert, big, own], { mine });
    expect([out.get(alert.seq)!.hidden, out.get(big.seq)!.hidden, out.get(own.seq)!.hidden]).toEqual([false, false, false]);
  });

  it("the late burst still folds; off-duty readouts are not counted in it", () => {
    const late = (name: string, about: string, ts: number) => m({ readout: true, alert: true, about, ts, text: `⏰ ${name} is late for the Second Moment of Truth. Go get them.` });
    const quiet = m({ readout: true, about: "g-3", ts: 50_002, text: "⏰ LimeWire is late for the Second Moment of Truth. Go get them." });
    const out = feed([late("WinZip", "g-1", 50_000), late("GarageBand", "g-2", 50_001), quiet], { mine: () => false });
    expect(shown(out).map((x) => x.text)).toEqual(["⏰ WinZip and GarageBand are late for the Second Moment of Truth — see Readouts."]);
  });

  it("a map with nothing to change is handed back as it is (an already hidden line to everyone too)", () => {
    const quiet = new Map([[1, m({ seq: 1, channel: "loc:The Desktop", audience: "all", hidden: true })]]);
    expect(boothMomentFeed(quiet, { character: ME, staffRooms: new Set(), guestName: () => null, names: [] })).toBe(quiet);
  });
});

const obj = (id: string, extra: Partial<BoothObjective> = {}): BoothObjective => ({ id, title: id, brief: "", checklist: [], buttons: [], act: null, ...extra }) as BoothObjective;
const held = (key: string, extra: Partial<HeldPopOut["spec"]> = {}, restored = false): HeldPopOut => ({ spec: { key, title: key, glyph: "▣", body: [], tone: "info", priority: 35, at: 0, sticky: false, ...extra }, ...(restored ? { restored: true } : {}) });
const W = (id: string, extra: Partial<WantedEntry> = {}): WantedEntry => ({ id, name: id, reason: null, location: null, lastSeen: 0, markedAt: 1, claimedBy: null, captured: false, ...extra });
const rctx = (extra: Partial<ReconcileCtx> = {}): ReconcileCtx => ({ wanted: [], objectives: [], calls: null, guestOf: () => null, wctx: { me: ME, now: 0, placeTitle: () => null, guestOf: () => null, tried: new Set(), canRelease: false }, ...extra });

describe("C7 / C8: reconcile NEW MISSION and the game pop-outs", () => {
  it("the headline is the first live objective, never an evergreen one", () => {
    expect(missionHeadline([obj("a"), obj("b")])?.id).toBe("a");
    expect(missionHeadline([obj("e", { evergreen: true }), obj("b")])).toBeNull();
    expect(missionHeadline([])).toBeNull();
  });

  it("a NEW MISSION whose objective is live but no longer the headline goes", () => {
    const h = held("mission:b", { at: 1_000 });
    expect(reconcilePopOuts([h], rctx({ objectives: [obj("b")] })).retire).toEqual([]);
    expect(reconcilePopOuts([h], rctx({ objectives: [obj("c"), obj("b")] })).retire).toEqual(["mission:b"]);
    expect(reconcilePopOuts([h], rctx({ objectives: [obj("e", { evergreen: true }), obj("b")] })).retire).toEqual(["mission:b"]);
    // A restored one gets ▣ Go back and its 20 s.
    const r = reconcilePopOuts([{ ...h, restored: true }], rctx({ objectives: [obj("b")] }));
    expect(r.rebind[0]).toMatchObject({ key: "mission:b", autoRetireMs: 20_000 });
  });

  it("a NEW MISSION within 10 s of a held game is the same cue: the mission goes, the game stays", () => {
    const mission = held("mission:bingo", { at: 100_000 });
    const game = held("game:42", { at: 100_000 + MISSION_GAME_MS, tone: "alarm", priority: 55 });
    expect(reconcilePopOuts([mission, game], rctx({ objectives: [obj("bingo")] })).retire).toEqual(["mission:bingo"]);
    const far = held("game:42", { at: 100_000 + MISSION_GAME_MS + 1, tone: "alarm", priority: 55 });
    expect(reconcilePopOuts([mission, far], rctx({ objectives: [obj("bingo")] })).retire).toEqual([]);
  });

  it("an older game goes once a newer one is held; a restored game gets ▣ Go to Mission back", () => {
    const old = held("game:10", { at: 10_000, tone: "alarm" });
    const next = held("game:90", { at: 90_000, tone: "alarm" });
    expect(reconcilePopOuts([next, old], rctx()).retire).toEqual(["game:10"]);
    const r = reconcilePopOuts([{ ...next, restored: true }], rctx());
    expect(r.rebind[0]!.actions).toEqual([{ id: "go", label: "▣ Go to Mission", kind: "primary", do: { kind: "mission" } }]);
    expect(r.rebind[0]!.autoRetireMs).toBe(60_000);
  });

  it("a game held quiet never comes back stale: it goes at its minute, or once its cue's headline moved on", () => {
    const game = held("game:42", { at: 100_000, tone: "alarm", priority: 55 });
    const at = (now: number, headlineAt: number | null = null) => rctx({ wctx: { ...rctx().wctx, now }, headlineAt });
    expect(reconcilePopOuts([game], at(159_999)).retire).toEqual([]);
    expect(reconcilePopOuts([game], at(160_000)).retire).toEqual(["game:42"]);
    // The headline that came with it (the DM lands first) keeps it ...
    expect(reconcilePopOuts([game], at(105_000, 100_000 + MISSION_GAME_MS)).retire).toEqual([]);
    // ... a later one ("The Bingo is over") means its moment is over.
    expect(reconcilePopOuts([game], at(130_000, 125_000)).retire).toEqual(["game:42"]);
  });
});

describe("C10: no stale 🚨 readout pop-out", () => {
  const mark = held("msg:77", { glyph: "🚨", title: "Readout", guest: { id: "winzip", name: "WinZip" }, tone: "alarm", priority: 80 }, true);
  it("a held 🚨 msg pop-out goes once its guest is caught or off the board; stays while loose", () => {
    expect(reconcilePopOuts([mark], rctx({ wanted: [W("winzip")] })).retire).toEqual([]);
    expect(reconcilePopOuts([mark], rctx({ wanted: [W("winzip", { captured: true })] })).retire).toEqual(["msg:77"]);
    expect(reconcilePopOuts([mark], rctx({ wanted: [] })).retire).toEqual(["msg:77"]);
    // No board for this booth: nothing to judge by.
    expect(reconcilePopOuts([mark], rctx({ wanted: null })).retire).toEqual([]);
    // Any other readout pop-out is left alone.
    expect(reconcilePopOuts([held("msg:78", { glyph: "⚠", guest: { id: "winzip", name: "WinZip" } })], rctx({ wanted: [] })).retire).toEqual([]);
  });
});

describe("C11: the Open tab keeps a shown poster in place", () => {
  it("kept ids stay in first-shown order, claimed or not, until caught; new open ones follow", () => {
    const first = [W("a", { markedAt: 1 }), W("b", { markedAt: 2 }), W("c", { markedAt: 3 })];
    const shownIds = openTabIds(first, [], "N");
    expect(shownIds).toEqual(["c", "b", "a"]);
    const kept = new Set(shownIds);
    const later = [W("a", { markedAt: 1 }), W("b", { markedAt: 2, claimedBy: "N" }), W("c", { markedAt: 3, claimedBy: "McAfee" }), W("d", { markedAt: 4 })];
    expect(openTabIds(later, kept, "N")).toEqual(["c", "b", "a", "d"]);
    expect(openTabIds([...later.slice(0, 2), W("c", { markedAt: 3, captured: true })], kept, "N")).toEqual(["b", "a"]);
    // Never shown and claimed: not on Open.
    expect(openTabIds([W("x", { claimedBy: "N" })], [], "N")).toEqual([]);
  });
});
