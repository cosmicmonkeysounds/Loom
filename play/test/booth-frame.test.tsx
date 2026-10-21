// Wave 18 (booth lane): the booth frame (BOOTH-SPEC §3–4.5) — the NOW card's
// one extra row (the board, a target, a picker, global buttons), the tray's
// 🚨 LED and 🔔, a pop-out's buttons bound to the booth, the moments feed
// dropping what a pop-out covers, Readouts' Open card / ✓ done.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { NowCard, nowRow, pinnedChecks } from "../src/booth/now-card.tsx";
import { BoothTray, ledDigits } from "../src/booth/tray.tsx";
import { bindDraft } from "../src/booth/popouts/use-booth-popouts.ts";
import { boothMomentFeed } from "../src/booth/moments-feed.ts";
import { ReadoutsView } from "../src/booth/readouts.tsx";
import { mayPress } from "../src/booth/wire.ts";
import type { Draft } from "../src/booth/popouts/model.ts";
import type { BoothObjective } from "../src/booth/wire.ts";
import type { ChatMessage, Interaction } from "../src/types.ts";

const I = (id: string, label: string, extra: Partial<Interaction> = {}): Interaction => ({ id, label, who: "performer", description: null, ...extra });
const ints = [I("bingo_winner", "🎱 Bingo winner"), I("award", "🎀 Give the ribbon"), I("truth", "🗣 Truth answered"), I("open_bar", "🍸 Open the bar"), I("made", "🏓 Made")];
const o = (extra: Partial<BoothObjective>): BoothObjective => ({ id: "o", title: "The Objective", brief: "", checklist: [], buttons: [], act: null, ...extra });
const opts = (extra: Partial<Parameters<typeof nowRow>[1]> = {}) => ({ wanted: null, interactions: ints, globals: [], placeTitle: (l: string | null) => (l === null ? null : `The ${l}`), ...extra });

describe("the NOW card's extra row (§4.5)", () => {
  it("first match wins: the board, a target, a picker, global buttons", () => {
    const steps = o({ pick: ["a", "b"], buttons: ["bingo_winner", "award"], checklist: [{ label: "🎱 who", done: false }, { label: "🎀 give", done: false }] });
    expect(nowRow(steps, opts({ wanted: 2 }))).toEqual({ kind: "board", n: 2 });
    expect(nowRow(undefined, opts({ wanted: 1 }))).toEqual({ kind: "board", n: 1 });
    expect(nowRow(o({ target: { id: "g1", name: "Minesweeper", location: "Desktop" }, buttons: ["truth"] }), opts({ wanted: 0 }))).toEqual({ kind: "target", target: { id: "g1", name: "Minesweeper", location: "Desktop" }, place: "The Desktop" });
    expect(nowRow(steps, opts())).toEqual({ kind: "pick", layout: "steps", n: 2, title: "The Objective" });
    expect(nowRow(o({ pick: ["a"], buttons: ["made"] }), opts())).toMatchObject({ kind: "pick", layout: "rows", n: 1 });
    expect(nowRow(o({ buttons: ["open_bar", "made"] }), opts({ globals: ["open_bar"] }))).toEqual({ kind: "global", buttons: [ints[3]] });
    expect(nowRow(o({ buttons: ["made"] }), opts())).toBeNull();
  });
  it("renders the row and the 🚨 chip; pins two to-dos while the row shows", () => {
    const obj = o({ checklist: ["a", "b", "c", "d"].map((label) => ({ label, done: false })) });
    expect(pinnedChecks(obj, 2).shown).toEqual([0, 1]);
    const html = renderToStaticMarkup(<NowCard objectives={[obj]} interactions={ints} character="Norton" pill={null} closeKey={null} row={{ kind: "board", n: 2 }} />);
    expect(html).toContain("🚨 Wanted board (2)");
    expect(html).toContain("booth-now-chip");
    expect(html).toContain(">a<");
    expect(html).toContain(">b<");
    expect(html).not.toContain(">c<");
    const pick = renderToStaticMarkup(<NowCard objectives={[obj]} interactions={ints} character="Clippy" pill={null} closeKey={null} row={{ kind: "pick", layout: "steps", n: 12, title: "x" }} />);
    expect(pick).toContain("🎮 PLAYER SELECT (12)");
    const rows = renderToStaticMarkup(<NowCard objectives={[obj]} interactions={ints} character="Adobe" pill={null} closeKey={null} row={{ kind: "pick", layout: "rows", n: 9, title: "Truth Pong: judge the cup" }} />);
    expect(rows).toContain("📋 Truth Pong: judge the cup (9)");
    const target = renderToStaticMarkup(<NowCard objectives={[obj]} interactions={ints} character="Clippy" pill={null} closeKey={null} row={{ kind: "target", target: { id: "g", name: "Minesweeper" }, place: "The Desktop" }} />);
    expect(target).toContain("Minesweeper · 📍 The Desktop");
    const global = renderToStaticMarkup(<NowCard objectives={[obj]} interactions={ints} character="TM" pill={null} closeKey={null} row={{ kind: "global", buttons: [ints[3]!] }} />);
    expect(global).toContain("🍸 Open the bar");
    // No objective: the board row still shows under the character's bar.
    expect(renderToStaticMarkup(<NowCard objectives={[]} interactions={ints} character="Norton" pill={null} closeKey={null} row={{ kind: "board", n: 1 }} />)).toContain("🚨 Wanted board (1)");
  });
});

describe("the booth tray (§3)", () => {
  it("the LED reads three digits, the bell counts what waits; both hide at 0", () => {
    expect(ledDigits(3)).toBe("003");
    expect(ledDigits(1234)).toBe("999");
    const html = renderToStaticMarkup(<BoothTray view={null} onWallet={() => {}} loose={3} waiting={2} />);
    expect(html).toContain("003");
    expect(html).toContain("Marked and loose: 3");
    expect(html).toContain("🔔 2");
    expect(html).toContain("2 waiting for you");
    const none = renderToStaticMarkup(<BoothTray view={null} onWallet={() => {}} loose={0} waiting={0} />);
    expect(none).not.toContain("led");
    expect(none).not.toContain("🔔");
    expect(renderToStaticMarkup(<BoothTray view={null} onWallet={() => {}} loose={null} />)).not.toContain("Marked and loose");
  });
});

describe("a pop-out's buttons, bound (§4)", () => {
  const draft = (actions: Draft["actions"]): Draft => ({ key: "k", glyph: "🚨", title: "t", body: "", actions, tone: "alarm", sticky: true, priority: 1, at: 0 });
  it("claims (and remembers the try), opens the card / scanner / board, defers on Not yet", async () => {
    const open = { act: vi.fn(() => Promise.resolve({})), card: vi.fn(), scan: vi.fn(), board: vi.fn(), door: vi.fn(), pick: vi.fn(), cue: vi.fn(), tried: vi.fn() };
    const defer = vi.fn();
    const spec = bindDraft(
      draft([
        { id: "claim", label: "", do: { kind: "act", name: "claim_escort", guest: "g1" } },
        { id: "card", label: "", do: { kind: "card", guest: "g1", confront: "rescan" } },
        { id: "scan", label: "", do: { kind: "scan", guest: "g1", name: "ICQ" } },
        { id: "door", label: "", do: { kind: "claimDoor", guest: "g2", name: "Winamp" } },
        { id: "later", label: "", do: { kind: "later" } },
        { id: "cue", label: "", do: { kind: "cue", id: "bingo_time" } },
      ]),
      open,
      defer,
    );
    await spec.actions[0]!.run();
    expect(open.tried).toHaveBeenCalledWith("g1");
    expect(open.act).toHaveBeenCalledWith("claim_escort", "g1");
    void spec.actions[1]!.run();
    expect(open.card).toHaveBeenCalledWith("g1", "rescan");
    void spec.actions[2]!.run();
    expect(open.scan).toHaveBeenCalledWith("g1", "ICQ");
    await spec.actions[3]!.run();
    expect(open.act).toHaveBeenCalledWith("claim_door", "g2");
    expect(open.scan).toHaveBeenCalledWith("g2", "Winamp");
    void spec.actions[4]!.run();
    expect(defer).toHaveBeenCalledWith("k");
    void spec.actions[5]!.run();
    expect(open.cue).toHaveBeenCalledWith("bingo_time");
  });
  it("may press only its own `by:` button", () => {
    const list = [I("claim_escort", "🙋", { actors: ["Norton Anti-Virus", "McAfee"], only: true }), I("free", "x")];
    expect(mayPress(list, "claim_escort", "norton anti-virus")).toBe(true);
    expect(mayPress(list, "claim_escort", "Task Manager")).toBe(false);
    expect(mayPress(list, "free", "Task Manager")).toBe(true);
    expect(mayPress(list, "nope", "Norton")).toBe(false);
  });
});

const m = (seq: number, extra: Partial<ChatMessage>): ChatMessage => ({ seq, channel: "dm:Norton", channelKind: "dm", title: "Norton", from: "", kind: "narration", text: "x", ts: seq * 10_000, audience: ["@Norton"], parentSeq: null, hidden: false, ...extra });

describe("what the moments layer sees (§4.12)", () => {
  it("hides what a pop-out covers; the rest is untouched", () => {
    const msgs = new Map([m(1, { readout: true, alert: true, about: "g1", text: "🚨 G1 is marked" }), m(2, { readout: true, text: "plain" })].map((x) => [x.seq, x]));
    const out = boothMomentFeed(msgs, { character: "Norton", staffRooms: new Set(), guestName: () => null, names: [], covered: (x) => x.seq === 1 });
    expect(out.get(1)!.hidden).toBe(true);
    expect(out.get(2)!.hidden).toBe(false);
  });
});

describe("Readouts (§7.1)", () => {
  it("a readout about a guest opens their card; about a caught one reads ✓ done", () => {
    const ch = { id: "__inbox", kind: "dm" as const, title: "Readouts", spaceId: "booth", messages: [m(1, { readout: true, about: "g1", text: "🚨 marked" }), m(2, { readout: true, about: "g2", text: "🛡 sent" })], unread: 0, decision: null, lastTs: 0 };
    const guests = [{ id: "g1", name: "ICQ", faction: null, captured: false, location: null }, { id: "g2", name: "Napster", faction: null, captured: true, location: null }];
    const html = renderToStaticMarkup(<ReadoutsView channel={ch} wide={false} onBack={() => {}} guests={guests} onGuest={() => {}} />);
    expect(html).toContain("🗂 Open card");
    expect(html).toContain("Open ICQ&#x27;s card");
    expect(html).toContain("✓ done");
  });
});

