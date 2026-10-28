// Wave 37, lane A (scan-flow): × means done. A scan, a card or a
// confrontation closes in one tap, back where it was opened (C1, C2); only
// door work gets 📷 Next guest, and the caption draws one camera (C3); a
// player's own press of the NOW target's button opens PLAYER SELECT at
// once (C14); the ad takeover never swallows a face-to-face tap (C13).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { backFor, closeTo, closedGate, scanTitle, type Layer, type OpenLayer } from "../src/booth/model.ts";
import { CLOSED_PASS_MS, Scanner, ScannerScreen } from "../src/booth/scanner.tsx";
import { GuestCardBody } from "../src/booth/card.tsx";
import { ConfrontScreen } from "../src/booth/confront.tsx";
import { ownFireFor } from "../src/booth/app.tsx";
import type { BoothObjective } from "../src/booth/wire.ts";
import type { PrimeSession } from "../src/session/prime.ts";
import type { Interaction } from "../src/types.ts";
import { elements, mountHooks } from "./hooks-harness.ts";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

const NORTON = "Norton Anti-Virus";
const SHIELD: Interaction = { id: "send", label: "🛡 Send to the Internet", who: "performer" } as Interaction;

/** A booth session whose scans answer at once (made-up guests, not the show's). */
function session(o: { wanted?: boolean; responses?: string[] } = {}): PrimeSession {
  const view = {
    character: NORTON,
    guests: [{ id: "g-1", name: "Ada", faction: null, captured: false, location: null }],
    channels: [],
    spaces: [],
    interactions: [SHIELD],
    objectives: [],
    ...(o.wanted === true ? { wanted: [{ id: "g-1", name: "Ada", reason: "a test", location: null, lastSeen: null, markedAt: 0, claimedBy: null, captured: false }] } : {}),
  };
  const card = { guest: { id: "g-1", name: "Ada", faction: null, captured: false, location: null }, live: ["send"], guestScoped: [], readouts: [] };
  return {
    auth: { token: "t", character: NORTON, admin: false, eventId: "default" },
    view,
    card: () => Promise.resolve(card),
    act: () => new Promise(() => {}),
    scan: (id: string) => Promise.resolve({ guest: { id, name: "Ada" }, card, responses: o.responses ?? ["✅ Cleared Ada."] }),
  } as unknown as PrimeSession;
}

/** The scanner through the hooks harness, after one scan of `g-1`. */
async function scanned(o: { wanted?: boolean; queue?: boolean } = {}) {
  let closed = 0;
  const gate = closedGate(CLOSED_PASS_MS);
  const h = mountHooks(ScannerScreen, { session: session(o), admin: false, gate, queue: o.queue === true, onClose: () => (closed += 1), onOpenThread: () => {} });
  await (elements(h.output).find((e) => e.type === Scanner)!.props as { onScan: (id: string) => Promise<boolean> }).onScan("g-1");
  h.act(() => {});
  const find = <P,>(type: unknown) => elements(h.output).find((e) => e.type === type)?.props as P | undefined;
  return {
    h,
    gate,
    closed: () => closed,
    x: () => (h.output as { props: { onClose: () => void } }).props.onClose(),
    body: () => find<{ onNext?: () => void; onLeave?: () => void }>(GuestCardBody),
    confront: () => find<{ onNotNow: () => void; onNext?: () => void }>(ConfrontScreen),
  };
}

describe("C1: × means done", () => {
  it("the card's × leaves the scanner in one tap and gates that pass", async () => {
    const s = await scanned();
    expect(s.body()).toBeDefined();
    s.x();
    expect(s.closed()).toBe(1);
    expect(s.gate.allows("g-1")).toBe(false);
  });

  it("the confrontation's Not now leaves, and its × (CORRUPTION DETECTED or CAPTURED) leaves", async () => {
    const s = await scanned({ wanted: true });
    expect(s.confront()).toBeDefined();
    s.confront()!.onNotNow();
    expect(s.closed()).toBe(1);
    expect(s.gate.allows("g-1")).toBe(false);
    const t = await scanned({ wanted: true });
    t.x();
    expect(t.closed()).toBe(1);
  });

  it("a card scanned inside the scanner hands it the scanner's leave (a re-scan's confrontation Not now leaves too)", async () => {
    const s = await scanned();
    s.body()!.onLeave!();
    expect(s.closed()).toBe(1);
  });

  it("scannerClose is gone (never deprecated): the pure rule is closeTo", () => {
    expect(src("booth/model.ts")).not.toContain("scannerClose");
    expect(src("booth/scanner.tsx")).not.toContain("scannerClose");
  });
});

describe("C2: back to where the scan started", () => {
  const board: OpenLayer = { kind: "wanted", fresh: ["g-3"] };
  const door: OpenLayer = { kind: "door" };
  const guests: OpenLayer = { kind: "guests" };
  const pick: OpenLayer = { kind: "pick", objective: "o", opened: { id: "o" } as BoothObjective };
  const scan: OpenLayer = { kind: "scan" };
  const card: OpenLayer = { kind: "card", id: "g-1" };

  it("backFor keeps the board, the Door queue, 🗂 Guests and a rows window; never a scan, a card or 🔔 Waiting", () => {
    expect(backFor(board)).toEqual(board);
    expect(backFor(door)).toEqual(door);
    expect(backFor(guests)).toEqual(guests);
    expect(backFor(pick, true)).toEqual(pick);
    // PLAYER SELECT's steps are not a list to come back to.
    expect(backFor(pick, false)).toBeUndefined();
    expect(backFor(scan)).toBeUndefined();
    expect(backFor(card)).toBeUndefined();
    expect(backFor({ kind: "waiting" })).toBeUndefined();
    expect(backFor(null)).toBeUndefined();
  });

  it("closeTo: board → scan → back to the board (with its fresh); door → card → the door; null → null", () => {
    const fromBoard: Layer = { kind: "scan", guest: "g-3", caption: "Scan Ada's pass", back: backFor(board)! };
    expect(closeTo(fromBoard)).toEqual({ kind: "wanted", fresh: ["g-3"] });
    const fromDoor: Layer = { kind: "card", id: "g-1", back: backFor(door)! };
    expect(closeTo(fromDoor)).toEqual(door);
    expect(closeTo({ kind: "scan" })).toBeNull();
    expect(closeTo(null)).toBeNull();
  });

  it("depth one: a card from a scan never nests, and a window comes back without a back of its own", () => {
    const fromScan: Layer = { kind: "card", id: "g-1", ...(backFor(scan) !== undefined ? { back: backFor(scan)! } : {}) };
    expect(closeTo(fromScan)).toBeNull();
    const nested = { kind: "guests", back: door } as OpenLayer;
    expect(backFor(nested)).toEqual({ kind: "guests" });
  });

  it("every layer's close and the phone's Back go through closeTo", () => {
    const app = src("booth/app.tsx");
    expect(app).toContain("const closeLayer = () => setLayer((l) => closeTo(l));");
    expect(app).toContain("if (layer !== null) setLayer((l) => closeTo(l));");
    expect(app).not.toMatch(/onClose=\{\(\) => setLayer\(null\)\}/u);
    expect(app).not.toMatch(/onLater=\{\(\) => setLayer\(null\)\}/u);
    // openScan / openCard read the layer they open over.
    expect(app).toMatch(/const openScan = [^\n]*setLayer\(\(l\) => \(\{ kind: "scan"[^\n]*\.\.\.backOf\(l\)/u);
    expect(app).toMatch(/setLayer\(\(l\) => \(\{ kind: "card"[^\n]*\.\.\.backOf\(l\)/u);
    // The caption leaving after a scan keeps where it goes back to.
    expect(app).toContain('{ kind: "scan", ...(l.back !== undefined ? { back: l.back } : {}) }');
  });
});

describe("C3: Next guest only for door work; one camera glyph", () => {
  it("a non-door booth's card and confrontation have no Next guest", async () => {
    const card = await scanned({ queue: false });
    expect(card.body()!.onNext).toBeUndefined();
    const c = await scanned({ wanted: true, queue: false });
    expect(c.confront()!.onNext).toBeUndefined();
  });

  it("a door worker's do, and Next guest brings the camera back without leaving", async () => {
    const s = await scanned({ queue: true });
    expect(s.body()!.onNext).toBeTypeOf("function");
    s.body()!.onNext!();
    s.h.act(() => {});
    expect(s.body()).toBeUndefined();
    expect(s.closed()).toBe(0);
    const c = await scanned({ wanted: true, queue: true });
    expect(c.confront()!.onNext).toBeTypeOf("function");
  });

  it("the confrontation renders no Next guest without onNext", () => {
    const c = { guest: "g-1", name: "Ada", reason: null, shield: "send", arm: false, deadMs: 0, claimedBy: null };
    const html = renderToStaticMarkup(<ConfrontScreen c={c} me={NORTON} press={() => new Promise(() => {})} onNotNow={() => {}} />);
    expect(html).toContain("Not now");
    expect(html).not.toContain("Next guest");
  });

  it("the caption draws one camera: the title bar's icon, never a 📷 in the words", () => {
    expect(scanTitle("📷 Scan Ada's pass")).toBe("Scan Ada's pass");
    expect(scanTitle("📷 Scan a program to send them to the Internet")).toBe("Scan a program to send them to the Internet");
    expect(scanTitle(undefined)).toBe("Scan a pass");
    expect(scanTitle("Scan Ada's pass")).toBe("Scan Ada's pass");
    const html = renderToStaticMarkup(<ScannerScreen session={session()} admin={false} caption="📷 Scan Ada's pass" onClose={() => {}} onOpenThread={() => {}} />);
    expect(html).not.toContain("📷");
    expect(html.match(/ico-scan/gu)?.length).toBe(1);
    expect(src("booth/app.tsx")).toContain("caption: `Scan ${name}'s pass`");
  });

  it("app.tsx passes queue: claim_door, or a scan opened from the Door queue", () => {
    expect(src("booth/app.tsx")).toContain('queue={mayPress(s.view?.interactions, "claim_door", character) || layer.back?.kind === "door"}');
  });
});

describe("C13: the takeover never swallows a face-to-face tap", () => {
  it("a player's takeover is light over the scanner or a card", () => {
    expect(src("booth/app.tsx")).toContain('takeover: player && layer?.kind !== "scan" && layer?.kind !== "card" ? "full" : "light",');
  });
});

describe("C14: Clippy's 🎱 opens PLAYER SELECT directly", () => {
  const ints: Interaction[] = [
    { id: "bingo_call", label: "🎱 BINGO!", who: "performer" } as Interaction,
    { id: "other", label: "🍸 Something", who: "performer" } as Interaction,
  ];
  const target = { id: "check", title: "Check the Bingo", brief: "", checklist: [], buttons: ["bingo_call"], act: null, target: { id: "g-1", name: "Ada" } } as unknown as BoothObjective;
  const rows = { id: "judge", title: "Judge", brief: "", checklist: [], buttons: ["bingo_call"], act: null, pick: ["g-1"] } as unknown as BoothObjective;

  it("ownFireFor: a player pressing the NOW target objective's button", () => {
    expect(ownFireFor(true, target, "bingo_call", ints)).toBe(true);
    expect(ownFireFor(true, target, "other", ints)).toBe(false);
    expect(ownFireFor(false, target, "bingo_call", ints)).toBe(false);
    expect(ownFireFor(true, rows, "bingo_call", ints)).toBe(false);
    expect(ownFireFor(true, undefined, "bingo_call", ints)).toBe(false);
  });

  it("the pop-out's act and the card's face press both note the fire on the wall clock pickReadySpec reads", () => {
    const app = src("booth/app.tsx");
    expect(app).toMatch(/ownFireFor\(player, \(s\.view\?\.objectives \?\? \[\]\)\[0\][^\n]*\) ownFire\.current = Date\.now\(\);/u);
    expect(app).toMatch(/act: \(n, g\) => \{\s*noteOwnFire\(n\);/u);
    expect(app).toContain("onPress={noteOwnFire}");
    expect(src("booth/card.tsx")).toMatch(/onPress\?\.\(i\.id\);\s*session\.act\(i\.id, guestId\)/u);
    // CueBar stamps its own fire with Date.now() too: one clock.
    expect(src("booth/cue-bar.tsx")).toContain("onFired?.(Date.now());");
  });
});
