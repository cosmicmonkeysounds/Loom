//! The host lane's wave 18 rules (BOOTH-SPEC §5): the NEXT bar's second
//! line (caller · act · watch · countdown, and the order a phone drops
//! them), the armed cue's description, the Cues tab's Who's calling · NEXT ·
//! LAST boxes (then:, did:), More split in three, the escorts-waiting row,
//! and the moments lane's pop-out strip looked up by name.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cueRows } from "../../core/src/cue-sheet.ts";
import { nextBar, sheetLayout, type CueDesk } from "../src/director.tsx";
import { hostCalls } from "../src/host/api.ts";
import { HostDock, stripClass } from "../src/host/dock.tsx";
import { HostContext, type HostCtx } from "../src/host/kit.tsx";
import { barLine, hostTabs, cueDescription, cueThen, didText, hostStrip, hostWanted, moreDefaultTab, moreGroups, moreTabOf, wantedLine, wantedNeed, type WantedLike } from "../src/host/model.ts";
import { CuesTab } from "../src/host/tab-cues.tsx";
import type { HostView } from "../src/types.ts";
import { hostFixture } from "./host-fixture.ts";

function stubDesk(over: Partial<CueDesk> = {}): CueDesk {
  return { armed: null, pending: null, cooling: false, toast: null, setToast: () => {}, picking: null, value: "", setValue: () => {}, subjectName: null, tap: () => {}, pick: () => {}, closePicker: () => {}, locked: () => false, ...over };
}

const watch = [
  { label: "Marked", value: "3" },
  { label: "Results read", value: "true" },
  { label: "Cups", value: "\"7\"" },
];

describe("the NEXT bar's second line (§5.1)", () => {
  it("leads with the caller, then the act, the phase, the watch values, the countdown, the needs", () => {
    const v = hostFixture({ watch });
    const rows = cueRows(v.interactions, v.cues);
    const items = hostStrip(v, sheetLayout(rows), 60_000, 3, false, "📣 Task Manager");
    expect(items.map((i) => i.kind)).toEqual(["caller", "act", "phase", "watch", "watch", "watch", "countdown", "needs"]);
    expect(items[0]!.text).toBe("📣 Task Manager");
    expect(items.filter((i) => i.kind === "watch").map((i) => i.text)).toEqual(["Marked 3", "Results read ●", "Cups 7"]);
  });
  it("drops, on a narrower phone and in order: the phase, the 2nd watch value, the countdown; a 3rd value only wide", () => {
    const v = hostFixture({ watch });
    const items = hostStrip(v, sheetLayout(cueRows(v.interactions, v.cues)), 60_000, 0, false, "📣 You");
    const by = (k: string) => items.filter((i) => i.kind === k);
    expect(by("phase")[0]!.optional).toBe(true);
    expect(by("watch")[0]!.drop).toBeUndefined();
    expect(by("watch")[0]!.optional).toBeUndefined();
    expect(by("watch")[1]!.drop).toBe(2);
    expect(by("watch")[2]!.optional).toBe(true);
    expect(by("countdown")[0]!.drop).toBe(3);
    expect(by("caller")[0]!.optional).toBeUndefined();
    expect(by("caller")[0]!.drop).toBeUndefined();
    expect(stripClass(by("watch")[1]!)).toBe("host-strip-watch host-strip-drop2");
    expect(stripClass(by("countdown")[0]!)).toBe("host-strip-countdown host-strip-drop3");
  });
  it("no caller chip from a server with no callers", () => {
    const v = hostFixture();
    expect(hostStrip(v, sheetLayout(cueRows(v.interactions, v.cues)), 60_000, 0).some((i) => i.kind === "caller")).toBe(false);
  });
  it("reads the armed cue's description in the 4 s window; a subject cue keeps → who", () => {
    const base = { toast: null, connected: true, error: null, receivedAt: 0, now: 0, refused: null, reason: null };
    expect(barLine({ ...base, armed: true, subjectName: null, description: "Opens Truth Pong in the Cloud." })).toEqual({ kind: "armed", text: "Opens Truth Pong in the Cloud." });
    expect(barLine({ ...base, armed: true, subjectName: "Ada", description: "Gives the award." })).toEqual({ kind: "armed", text: "Tap FIRE to fire → Ada" });
    expect(barLine({ ...base, armed: true, subjectName: null, description: null })).toEqual({ kind: "armed", text: "Tap FIRE within 4 s to fire" });
    expect(barLine({ ...base, armed: false, subjectName: null, description: "x" })).toEqual({ kind: "strip" });
  });
});

describe("NEXT's description and then:", () => {
  const interactions = [
    { id: "a", label: "D · 🏓 Truth Pong", who: "admin" as const, description: "Opens Truth Pong in the Cloud." },
    { id: "b", label: "📊 The Trust Chart", who: "admin" as const },
    { id: "c", label: "🫘 Beans", who: "admin" as const },
  ];
  const rows = cueRows(interactions, { last: null, fired: [] });
  it("takes the row's description, else a cues.rows entry's", () => {
    expect(cueDescription(rows[0]!, {})).toBe("Opens Truth Pong in the Cloud.");
    expect(cueDescription(rows[1]!, { rows: [{ id: "b", description: " Every phone shows the chart. " }] })).toBe("Every phone shows the chart.");
    expect(cueDescription(rows[1]!, { rows: "nope" })).toBeNull();
    expect(cueDescription(rows[2]!, {})).toBeNull();
  });
  it("takes the server's then (null = none), else core's on-deck row", () => {
    expect(cueThen(rows, { then: "c" })?.id).toBe("c");
    expect(cueThen(rows, { then: null })).toBeNull();
    expect(cueThen(rows, {})?.id).toBe("b");
  });
});

describe("did: (this console's own last press)", () => {
  it("says what it did while LAST is that cue, staff lines first", () => {
    const press = { id: "a", said: ["Clippy: Pencils down!"], staff: ["⏱ the filing closed"], at: 1 };
    expect(didText(press, "a")).toBe("⏱ the filing closed · Clippy: Pencils down!");
    expect(didText(press, "b")).toBeNull();
    expect(didText({ ...press, said: [], staff: [] }, "a")).toBeNull();
    expect(didText(null, "a")).toBeNull();
  });
});

function cuesTab(view: HostView, ctx: Partial<HostCtx>, desk = stubDesk()): string {
  const rows = cueRows(view.interactions, view.cues);
  const layout = sheetLayout(rows);
  const bar = nextBar(rows, view.countdowns, 0, true);
  const session = { auth: { token: "t", character: "Adobe Acrobat", admin: false, host: true, eventId: "e" }, messages: new Map() } as unknown as HostCtx["session"];
  const full: HostCtx = { view, calls: hostCalls(async () => ({}), () => view.alerts.path), session, now: 0, run: async () => true, go: () => {}, openRoom: () => {}, openCard: () => {}, ...ctx };
  return renderToStaticMarkup(createElement(HostContext.Provider, { value: full }, createElement(CuesTab, { rows, layout, desk, mineLast: false, bar })));
}

describe("the Cues tab's group boxes (§5.2)", () => {
  const view = hostFixture({
    interactions: [
      { id: "summons", label: "⏳ Five-minute warning", who: "admin" },
      { id: "truth_pong", label: "D · 🏓 Truth Pong", who: "admin", description: "Opens Truth Pong in the Cloud; cups decide who may answer round 2." },
      { id: "chart", label: "📊 The Trust Chart", who: "admin" },
    ],
    cues: { last: "summons", lastBy: "director", lastName: "Recycling Bin", fired: ["summons"], presses: 1, pressed: "summons" },
  });
  it("shows Who's calling with I'll call when someone else calls", () => {
    const html = cuesTab(view, { callers: true, caller: { name: "Task Manager", at: 1 }, claim: async () => true });
    expect(html).toContain("Who&#x27;s calling");
    expect(html).toContain("📣 Task Manager is calling.");
    expect(html).toContain("📣 I&#x27;ll call");
  });
  it("offers Stop calling to the caller, and nothing from a server with no callers", () => {
    expect(cuesTab(view, { callers: true, caller: { name: "Adobe Acrobat", at: 1 }, claim: async () => true })).toContain("Stop calling");
    expect(cuesTab(view, {})).not.toContain("Who&#x27;s calling");
  });
  it("NEXT carries its description and then:, LAST its presser", () => {
    const html = cuesTab(view, {});
    expect(html).toMatch(/data-testid="host-next-box"[\s\S]*Truth Pong[\s\S]*ARM/u);
    expect(html).toContain("Opens Truth Pong in the Cloud; cups decide who may answer round 2.");
    expect(html).toMatch(/data-testid="host-then"[\s\S]*then:[\s\S]*The Trust Chart/u);
    expect(html).toMatch(/data-testid="host-last"[\s\S]*Five-minute warning[\s\S]*Recycling Bin/u);
    expect(html).not.toContain("host-did");
  });
  it("did: only for this console's own press of LAST", () => {
    const own = { id: "summons", said: [], staff: ["the summons opened", "7 not checked in"], at: 1 };
    expect(cuesTab(view, { ownPress: own })).toMatch(/data-testid="host-did"[\s\S]*the summons opened · 7 not checked in/u);
    expect(cuesTab(view, { ownPress: { ...own, id: "chart" } })).not.toContain("host-did");
  });
  it("NEXT reads FIRE while this desk is armed on it", () => {
    const html = cuesTab(view, {}, stubDesk({ armed: { id: "truth_pong", at: 0, subject: null, presses: 1 } as unknown as CueDesk["armed"] }));
    expect(html).toMatch(/host-box-next armed[\s\S]*FIRE/u);
  });
});

describe("More, split in three (§5.6)", () => {
  it("puts each section on its tab, only what the event has", () => {
    const v = hostFixture();
    expect(moreGroups(v)).toEqual({ night: ["show", "clock", "announce", "alerts"], house: ["wallet", "king", "terminals", "sound", "agents"], setup: ["codes", "parts"] });
    expect(moreGroups(hostFixture({ wallet: null, king: null, terminals: null, agents: [], parts: [] }))).toEqual({ night: ["show", "clock", "announce", "alerts"], house: ["sound"], setup: ["codes"] });
  });
  it("opens on Setup before the doors, Night after; a deep link picks its tab", () => {
    expect(moreDefaultTab(true, null)).toBe("setup");
    expect(moreDefaultTab(false, null)).toBe("night");
    expect(moreDefaultTab(true, "wallet")).toBe("house");
    expect(moreTabOf("agents-trabolta")).toBe("house");
    expect(moreTabOf("terminals")).toBe("house");
    expect(moreTabOf("alerts")).toBe("night");
  });
});

describe("escorts waiting (§5.5)", () => {
  const w = (over: Partial<WantedLike>): WantedLike => ({ id: "g1", name: "Napster", reason: null, location: "The Cloud", lastSeen: 0, markedAt: 0, claimedBy: null, captured: false, ...over });
  it("counts the loose and the unclaimed; nothing when all are caught", () => {
    expect(wantedNeed([w({}), w({ id: "g2", claimedBy: "McAfee Anti-Virus" }), w({ id: "g3", captured: true })])).toEqual({ loose: 2, nobody: 1, text: "🚨 2 marked · 1 nobody on it" });
    expect(wantedNeed([w({ captured: true })])).toBeNull();
    expect(wantedNeed([])).toBeNull();
  });
  it("feature-detects hostView.wanted", () => {
    expect(hostWanted(hostFixture())).toEqual([]);
    expect(hostWanted({ wanted: [w({}), { nope: 1 }, null] })).toHaveLength(1);
    expect(hostWanted({ wanted: "x" })).toEqual([]);
  });
  it("counts as one need on the Needs tab", () => {
    const v = { ...hostFixture({ needs: [] }), wanted: [w({})] } as HostView;
    expect(hostTabs(v, 0).find((t) => t.id === "needs")?.count).toBe(1);
    expect(hostTabs(hostFixture({ needs: [] }), 0).find((t) => t.id === "needs")?.count).toBe(0);
  });
  it("words a read-only row: place, seen, who has them", () => {
    expect(wantedLine(w({ lastSeen: 0 }), 120_000)).toBe("📍 The Cloud · seen 2 m ago · 🙋 Nobody yet");
    expect(wantedLine(w({ location: null, lastSeen: null, claimedBy: "Norton" }), 0)).toBe("📍 somewhere: not seen in a room · not seen since the server started · 🙋 Norton");
  });
});

describe("the pop-out strip in the console (§5.7)", () => {
  it("the drawer body docks the moments lane's PopOutDock first", () => {
    const src = readFileSync(join(__dirname, "../src/host/dock.tsx"), "utf8");
    expect(src).toMatch(/import \{ PopOutDock \} from "\.\.\/moments\/popout\.tsx";/u);
    expect(src).toMatch(/function DockSlot\(\) \{\s*return <PopOutDock \/>;/u);
  });
});

describe("the dock with a caller (§5.1, §5.3)", () => {
  const auth = { token: "t", character: "Adobe Acrobat", admin: false, host: true, eventId: "e" };
  const session = { auth, messages: new Map(), view: null, threads: { open: () => {} } } as unknown as Parameters<typeof HostDock>[0]["session"];
  const render = (view: HostView) =>
    renderToStaticMarkup(createElement(HostDock, { session, wide: false, openCard: () => {}, keyboardOpen: false, client: { view, receivedAt: 1_000, error: null, connected: true, refresh: () => {}, fresh: async () => {}, calls: hostCalls(async () => ({}), () => view.alerts.path) } }));
  it("shows who is calling first on line 2, and no ask until FIRE", () => {
    const html = render(hostFixture({ parts: [{ id: "Task Manager", presence: "online" }], cues: { last: null, fired: [], presses: 0, pressed: null, caller: { name: "Task Manager", at: 1 } } as HostView["cues"] }));
    const line2 = html.match(/class="host-bar-line2"[^>]*>([\s\S]*?)<\/span><\/button>/u)?.[1] ?? "";
    expect(line2).toMatch(/^(<span[^>]*host-code-narrow[^>]*>[^<]*<\/span>)?<span class="host-strip-caller">📣 Task Manager<\/span>/u);
    expect(html).not.toContain("host-fire-anyway");
    // A director at the laptop (not a part) reads as Run.
    expect(render(hostFixture({ cues: { last: null, fired: [], caller: { name: "Sam Rivera", at: 1 } } as HostView["cues"] }))).toContain('<span class="host-strip-caller">📣 Run</span>');
  });
  it("reads 📣 You for this booth's own claim, nobody when the claim is empty, nothing from an older server", () => {
    expect(render(hostFixture({ cues: { last: null, fired: [], caller: { name: "Adobe Acrobat", at: 1 } } as HostView["cues"] }))).toContain("📣 You");
    expect(render(hostFixture({ cues: { last: null, fired: [], caller: null } as HostView["cues"] }))).toContain("📣 nobody");
    expect(render(hostFixture())).not.toContain("host-strip-caller");
  });
});
