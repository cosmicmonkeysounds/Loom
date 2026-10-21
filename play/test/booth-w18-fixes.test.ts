// Wave 18 fix round, the booth lane: pop-outs that follow the night (the
// store's held ones retired when moot and given their buttons back after a
// reload: BN-F4, NM-F7, NM-F8, NM-F13), bursts across snapshots (BN-F9),
// *Call it?* timed to its countdown (BN-F3), the host's NOW row (BN-F6),
// the TAKEN pop-out's self-retire (BN-F2) and the confrontation's clock
// (BN-F17).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { countdownRunning, cueAtEnd, cueWaitsFor, reconcilePopOuts, rememberCountdowns, wantedSpecs, type CountdownMemo, type HeldPopOut, type ReconcileCtx, type WantedCtx } from "../src/booth/popouts/model.ts";
import { boardRowCount } from "../src/booth/now-card.tsx";
import { scannedLine } from "../src/booth/confront.tsx";
import type { BoothGuest, BoothObjective, CallsView, WantedEntry } from "../src/booth/wire.ts";

const W = (id: string, extra: Partial<WantedEntry> = {}): WantedEntry => ({ id, name: id.toUpperCase(), reason: "named on the Bingo card", location: "Desktop", lastSeen: 1000, markedAt: 10_000, claimedBy: null, captured: false, ...extra });
const wctx = (extra: Partial<WantedCtx> = {}): WantedCtx => ({ me: "Norton", now: 200_000, wall: 200_000, placeTitle: (l) => l, guestOf: () => null, tried: new Set(), canRelease: false, ...extra });
const obj = (id: string, extra: Partial<BoothObjective> = {}): BoothObjective => ({ id, title: id, brief: "", checklist: [], buttons: [], act: null, ...extra }) as BoothObjective;
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, n: 1, code: null, title: id, fired: false, last: false, next: false, sequence: true, live: false, subject: false, act: null, description: null, ...extra });
const calls = (rows: ReturnType<typeof row>[], extra: Partial<CallsView> = {}): CallsView => ({ rows: rows as CallsView["rows"], next: null, last: null, lastName: null, act: null, presses: 3, ...extra });
const held = (key: string, extra: Partial<HeldPopOut["spec"]> = {}, restored = false): HeldPopOut => ({ spec: { key, title: key, glyph: "📋", body: [], tone: "info", priority: 40, at: 0, sticky: true, ...extra }, ...(restored ? { restored: true } : {}) });
const rctx = (extra: Partial<ReconcileCtx> = {}): ReconcileCtx => ({ wanted: [], objectives: [], calls: null, guestOf: () => null, wctx: wctx(), ...extra });

describe("pop-outs follow the night (BN-F4, NM-F7, NM-F8, NM-F13)", () => {
  it("a list whose objective ended goes; a live one keeps its count right", () => {
    const r = reconcilePopOuts([held("pick:The Summons:100", { body: ["6 programs"] }), held("pick:Judge The Cup:200", { body: ["6 programs"] })], rctx({ objectives: [obj("Judge The Cup", { pick: ["a", "b", "c", "d", "e"] })] }));
    expect(r.retire).toEqual(["pick:The Summons:100"]);
    expect(r.rebind).toHaveLength(1);
    expect(r.rebind[0]).toMatchObject({ key: "pick:Judge The Cup:200", body: ["5 programs"] });
    expect(r.rebind[0]!.actions[0]!.do).toEqual({ kind: "pick", objective: "Judge The Cup" });
  });

  it("a confrontation about someone caught, or no longer marked, goes", () => {
    const caught: BoothGuest = { id: "enc", name: "Encarta", faction: null, captured: true, location: null };
    const c = held("confront:44", { guest: { id: "enc", name: "Encarta" } });
    expect(reconcilePopOuts([c], rctx({ wanted: [W("enc")], guestOf: () => caught })).retire).toEqual(["confront:44"]);
    expect(reconcilePopOuts([c], rctx({ wanted: [] })).retire).toEqual(["confront:44"]);
    // Still marked and loose: it stays; restored, its button comes back.
    const r = reconcilePopOuts([{ ...c, restored: true }], rctx({ wanted: [W("enc")] }));
    expect(r.retire).toEqual([]);
    expect(r.rebind[0]!.actions[0]!.do).toEqual({ kind: "card", guest: "enc", confront: "rescan" });
  });

  it("a burst shrinks to who is still loose, and goes under two; a restored one gets its button", () => {
    const b = held("wanted-burst:10000", { rows: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }] }, true);
    const r = reconcilePopOuts([b], rctx({ wanted: [W("a"), W("b"), W("c", { captured: true })] }));
    expect(r.rebind[0]).toMatchObject({ key: "wanted-burst:10000", title: "2 programs marked" });
    expect(r.rebind[0]!.actions[0]!.do).toEqual({ kind: "board" });
    expect(reconcilePopOuts([b], rctx({ wanted: [W("a"), W("b", { claimedBy: "McAfee" })] })).retire).toEqual(["wanted-burst:10000"]);
  });

  it("a restored Wanted pop-out gets its buttons back, or goes when someone else has them", () => {
    const r = reconcilePopOuts([held("wanted:a", {}, true)], rctx({ wanted: [W("a")] }));
    expect(r.rebind[0]!.actions.map((a) => a.label)).toEqual(["🙋 I'll get them", "🗂 Open card"]);
    expect(reconcilePopOuts([held("wanted:a", {}, true)], rctx({ wanted: [W("a", { claimedBy: "McAfee" })] })).retire).toEqual(["wanted:a"]);
    expect(reconcilePopOuts([held("wanted:a")], rctx({ wanted: [] })).retire).toEqual(["wanted:a"]);
  });

  it("a *Call it?* the sheet moved past goes; a restored live one gets Call it / Not yet back", () => {
    const c = calls([row("bingo_time", { live: true })]);
    expect(reconcilePopOuts([held("cue:bingo_time:2")], rctx({ calls: c })).retire).toEqual(["cue:bingo_time:2"]);
    const r = reconcilePopOuts([held("cue:bingo_time:3", {}, true)], rctx({ calls: c }));
    expect(r.rebind[0]!.actions.map((a) => a.label)).toEqual(["🎤 Call it", "Not yet"]);
  });

  it("a restored target always goes (the driver raises the live one)", () => {
    expect(reconcilePopOuts([held("target:Bottle:g1:5", {}, true)], rctx({ objectives: [obj("Bottle", { target: { id: "g1", name: "G" } })] })).retire).toEqual(["target:Bottle:g1:5"]);
    expect(reconcilePopOuts([held("target:Bottle:g1:5")], rctx({ objectives: [obj("Bottle", { target: { id: "g2", name: "H" } })] })).retire).toEqual(["target:Bottle:g1:5"]);
    expect(reconcilePopOuts([held("target:Bottle:g1:5")], rctx({ objectives: [obj("Bottle", { target: { id: "g1", name: "G" } })] })).retire).toEqual([]);
  });
});

describe("a burst forms across snapshots (BN-F9)", () => {
  it("a mark a second after another, in a later snapshot, folds the first's single into one burst", () => {
    const first = wantedSpecs([W("enc", { markedAt: 10_000 })], {}, wctx());
    expect(first.raise.map((d) => d.key)).toEqual(["wanted:enc"]);
    const second = wantedSpecs([W("enc", { markedAt: 10_000 }), W("win", { markedAt: 11_000 })], first.seen, wctx());
    expect(second.raise.map((d) => d.key)).toEqual(["wanted-burst:10000"]);
    expect(second.raise[0]!.title).toBe("2 programs marked");
    expect(second.retire).toContain("wanted:enc");
    // A third joins it: the burst shows again (its rev is its size).
    const third = wantedSpecs([W("enc", { markedAt: 10_000 }), W("win", { markedAt: 11_000 }), W("icq", { markedAt: 12_000 })], second.seen, wctx());
    expect(third.raise[0]).toMatchObject({ key: "wanted-burst:10000", rev: "3" });
  });
});

describe("Clippy's *Call it?* waits for its countdown (BN-F3)", () => {
  it("a cue that turned live with a fresh countdown waits for it; one already running doesn't hold it", () => {
    const cds = [{ label: "Filings close", path: "Night.filing_close", endsAt: 220 }];
    expect(cueWaitsFor(cds, new Map([["Filings close", 100_000]]), 101_000)).toBe("Filings close");
    expect(cueWaitsFor(cds, new Map([["Filings close", 10_000]]), 101_000)).toBeNull();
    expect(countdownRunning(cds, "Filings close", 219_000)).toBe(true);
    expect(countdownRunning(cds, "Filings close", 221_000)).toBe(false);
  });
  it("a countdown that just ended pops Call it? for Clippy's own NEXT (Bingo time is live all night)", () => {
    const c = calls([row("bingo_time", { live: true, next: true, title: "⏰ Bingo time" })]);
    const cds = [{ label: "Bingo ends", path: "Night.bingo_end", endsAt: 1200 }];
    expect(cueAtEnd(c, cds, 1_100_000)).toBeNull();
    const d = cueAtEnd(c, cds, 1_230_000)!;
    expect(d).toMatchObject({ key: "cue:bingo_time:3", rev: "end:Bingo ends" });
    expect(d.body).toContain("Bingo ends is up. Call it?");
    expect(cueAtEnd(calls([row("bingo_time", { live: true })], { next: "introduce_trabolta" }), cds, 1_230_000)).toBeNull();
  });
  it("live, the view drops the countdown as it ends: the booth remembers it, so Call it? still pops (BN2-FA)", () => {
    const c = calls([row("bingo_time", { live: true, next: true, title: "⏰ Bingo time" })]);
    const memo = new Map<string, CountdownMemo>();
    const bingo = { label: "Bingo ends", path: "Night.bingo_end", endsAt: 1200 };
    expect(cueAtEnd(c, rememberCountdowns(memo, [bingo], 1_190_000), 1_190_000)).toBeNull();
    // The next view: no countdowns at all (ended, and the story stopped it).
    const seen = rememberCountdowns(memo, [], 1_202_000);
    expect(seen.map((x) => x.label)).toEqual(["Bingo ends"]);
    expect(cueAtEnd(c, seen, 1_203_000)?.body).toContain("Bingo ends is up. Call it?");
    // Two minutes on, forgotten.
    expect(rememberCountdowns(memo, [], 1_330_000)).toEqual([]);
    // Stopped early (a director cancelled it): not "up".
    const early = new Map<string, CountdownMemo>();
    rememberCountdowns(early, [bingo], 1_000_000);
    expect(cueAtEnd(c, rememberCountdowns(early, [], 1_010_000), 1_201_000)).toBeNull();
  });
});

describe("the host's NOW row and the small things (BN-F6, BN-F2, BN-F17)", () => {
  it("only a booth that may claim leads with the board", () => {
    expect(boardRowCount(3, true, true)).toBe(3);
    expect(boardRowCount(3, true, false)).toBeNull();
    expect(boardRowCount(3, false, true)).toBeNull();
  });
  it("the auto-retire timer never restarts on a render (its deps are the spec, never the api object)", () => {
    const src = readFileSync(new URL("../src/moments/popout.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/apiRef\.current\.retire\(spec\.key\), spec\.autoRetireMs\);\n\s+return \(\) => window\.clearTimeout\(t\);\n\s+\}, \[spec\.key, spec\.rev, spec\.autoRetireMs\]\);/u);
  });
  it("the confrontation's status bar reads the show clock when there is one", () => {
    expect(scannedLine("7:12 PM", null, "Norton")).toBe("Scanned 7:12 PM · nobody had claimed them");
  });
});
