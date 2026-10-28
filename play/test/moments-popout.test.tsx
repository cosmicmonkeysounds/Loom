//! Wave 18, the moments lane (BOOTH-SPEC §2, CONTRACTS C9, the user's
//! "pop outs are your friend here"): the booth pop-out rung's rules — one on
//! screen, never replaced; priority then age; handled `{key, rev}`; Later →
//! the tray; never over the open card's guest; storage across a reload; the
//! generic pop-out for a `!` readout; the free functions. Wave 37: the quiet
//! scope (C4), the alarm that takes the screen from an info one (C9),
//! autoLaterMs (C9) and the 🔔 Waiting row's text (C8).

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playTone, type Alerts } from "../src/alerts.ts";
import { MomentsProvider, type MomentsInput } from "../src/moments/provider.tsx";
import { PopOut, PopOutDock, PopOutHost, PopOutQuiet, PopOutScope, PopOutTrayList, popOutWaiting, resetPopOutStores, usePopOuts, type PopOutsApi } from "../src/moments/popout.tsx";
import { mountHooks } from "./hooks-harness.ts";
import { offerPopOut, popOutCandidate, raisePopOut, registerPopSink, retirePopOut } from "../src/moments/popout-registry.ts";
import { readBundledCss } from "./css.ts";
import {
  EMPTY_POPOUTS,
  HANDLED_MAX,
  PREEMPT_GRACE_MS,
  currentOf,
  defaultPopOut,
  deferredText,
  pagerOf,
  paragraphs,
  parseStored,
  popReducer,
  preemptDueAt,
  queuedOf,
  storedOf,
  stripText,
  trayLine,
  type PopOp,
  type PopOutSpec,
  type PopState,
} from "../src/moments/popout-model.ts";
import type { MomentMessage } from "../src/moments/model.ts";

vi.mock("../src/alerts.ts", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/alerts.ts")>()), playTone: vi.fn() }));

function spec(key: string, over: Partial<PopOutSpec> = {}): PopOutSpec {
  return { key, glyph: "🚨", title: "Wanted", body: "Named on the Bingo card.", actions: [{ id: "claim", label: "🙋 I'll get them", kind: "primary", run: () => {} }], tone: "alarm", sticky: true, priority: 90, at: 1000, ...over };
}
const run = (ops: PopOp[], from: PopState = EMPTY_POPOUTS) => ops.reduce(popReducer, from);
const raise = (s: PopOutSpec): PopOp => ({ type: "raise", spec: s });
/** Settle what the provider would: the one on screen holds. */
const show = (s: PopState, blocked: string | null = null) => popReducer(s, { type: "show", key: currentOf(s, blocked)?.spec.key ?? null });

describe("one on screen (rule 1) in queue order (rule 2)", () => {
  it("priority desc, then the older cause first", () => {
    const s = run([raise(spec("a", { priority: 50, at: 1 })), raise(spec("b", { priority: 90, at: 5 })), raise(spec("c", { priority: 90, at: 2 }))]);
    expect(currentOf(s)?.spec.key).toBe("c");
    expect(queuedOf(s, currentOf(s))).toBe(2);
    expect(pagerOf(2)).toBe("1 of 3");
    expect(pagerOf(0)).toBeNull();
  });

  it("the one shown is never replaced while unhandled by a higher priority of its own tone (an alarm over info: wave 37 below)", () => {
    let s = show(run([raise(spec("a", { priority: 50 }))]));
    s = show(run([raise(spec("b", { priority: 99 }))], s));
    expect(currentOf(s)?.spec.key).toBe("a");
    s = show(popReducer(s, { type: "retire", key: "a" }));
    expect(currentOf(s)?.spec.key).toBe("b");
  });

  it("idempotent by key: a raise of a live key updates it in place (buttons back after a reload)", () => {
    let s = run([raise(spec("a", { title: "Wanted" })), raise(spec("a", { title: "Taken" }))]);
    expect(s.live).toHaveLength(1);
    expect(s.live[0]?.spec.title).toBe("Taken");
    // Never more than four buttons.
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, label: `${i}`, run: () => {} }));
    s = run([raise(spec("m", { actions: many }))]);
    expect(s.live[0]?.spec.actions).toHaveLength(4);
  });
});

describe("handled (rule 3)", () => {
  it("a handled {key, rev} is a no-op to raise again; a new rev shows again", () => {
    let s = run([raise(spec("wanted:g1", { rev: "1" })), { type: "retire", key: "wanted:g1" }]);
    expect(s.handled).toEqual([{ key: "wanted:g1", rev: "1" }]);
    expect(run([raise(spec("wanted:g1", { rev: "1" }))], s).live).toEqual([]);
    s = run([raise(spec("wanted:g1", { rev: "2" }))], s);
    expect(s.live.map((e) => e.spec.key)).toEqual(["wanted:g1"]);
    expect(s.handled).toEqual([]);
  });

  it("remembers the newest 300", () => {
    let s = EMPTY_POPOUTS;
    for (let i = 0; i < HANDLED_MAX + 5; i++) s = popReducer(s, { type: "retire", key: `k${i}` });
    expect(s.handled).toHaveLength(HANDLED_MAX);
    expect(s.handled[0]?.key).toBe("k5");
  });
});

describe("Later → the tray (rule 4)", () => {
  it("defer moves it to the tray (newest first); restore brings it to the front and shows it", () => {
    let s = show(run([raise(spec("a", { at: 1 })), raise(spec("b", { at: 2 }))]));
    s = popReducer(s, { type: "defer", key: "a", at: 10_000 });
    s = show(s);
    expect(currentOf(s)?.spec.key).toBe("b");
    s = popReducer(s, { type: "defer", key: "b", at: 20_000 });
    expect(s.tray.map((e) => e.spec.key)).toEqual(["b", "a"]);
    expect(currentOf(s)).toBeNull();
    s = popReducer(s, { type: "restore", key: "a" });
    expect(currentOf(s)?.spec.key).toBe("a");
    expect(s.tray.map((e) => e.spec.key)).toEqual(["b"]);
    expect(deferredText(0, 3 * 60_000 + 5)).toBe("deferred 3 min ago");
    expect(deferredText(0, 20_000)).toBe("deferred just now");
  });

  it("a deferred one re-raised with the same rev stays in the tray (updated); a new rev comes back on screen", () => {
    let s = run([raise(spec("a", { rev: "1" })), { type: "defer", key: "a", at: 5 }]);
    s = run([raise(spec("a", { rev: "1", title: "Wanted (2)" }))], s);
    expect([s.tray[0]?.spec.title, s.live.length]).toEqual(["Wanted (2)", 0]);
    s = run([raise(spec("a", { rev: "2" }))], s);
    expect([s.tray.length, currentOf(s)?.spec.key]).toEqual([0, "a"]);
  });

  it("retire moots it wherever it waits (screen, queue, tray)", () => {
    let s = show(run([raise(spec("a")), raise(spec("b")), { type: "defer", key: "b", at: 1 }]));
    s = run([{ type: "retire", key: "a" }, { type: "retire", key: "b" }], s);
    expect([s.live, s.tray, s.shown]).toEqual([[], [], null]);
  });
});

describe("never over the open card's guest (rule 7)", () => {
  it("one about the guest whose card is open waits; another shows instead", () => {
    const s = run([raise(spec("a", { priority: 99, guest: { id: "g1", name: "Winamp" } })), raise(spec("b", { priority: 10, guest: { id: "g2", name: "ICQ" } }))]);
    expect(currentOf(s, "g1")?.spec.key).toBe("b");
    expect(currentOf(s, null)?.spec.key).toBe("a");
    expect(currentOf(run([raise(spec("a", { guest: { id: "g1", name: "Winamp" } }))]), "g1")).toBeNull();
  });
});

describe("across a reload", () => {
  it("persists the handled pairs, the sticky live ones and the tray — never the handlers", () => {
    let s = run([raise(spec("sticky")), raise(spec("loose", { sticky: false })), raise(spec("later")), { type: "defer", key: "later", at: 77 }, { type: "retire", key: "gone" }]);
    const stored = JSON.parse(JSON.stringify(storedOf(s)));
    expect(stored.handled).toEqual([{ key: "gone", rev: "" }]);
    expect(stored.kept.map((k: { spec: { key: string }; deferredAt?: number }) => [k.spec.key, k.deferredAt])).toEqual([
      ["sticky", undefined],
      ["later", 77],
    ]);
    expect(JSON.stringify(stored)).not.toContain("run");
    // A fresh page: back, without their buttons until the booth re-raises them.
    s = popReducer(EMPTY_POPOUTS, { type: "hydrate", stored: parseStored(stored) });
    expect(s.live.map((e) => [e.spec.key, e.restored, e.spec.actions.length])).toEqual([["sticky", true, 0]]);
    expect(s.tray.map((e) => e.spec.key)).toEqual(["later"]);
    s = run([raise(spec("sticky"))], s);
    expect([s.live[0]?.restored, s.live[0]?.spec.actions.length]).toEqual([undefined, 1]);
    // A handled one is never hydrated back.
    expect(popReducer(EMPTY_POPOUTS, { type: "hydrate", stored: { handled: [{ key: "x", rev: "" }], kept: [{ spec: { ...spec("x"), actions: undefined } as never }] } }).live).toEqual([]);
  });

  it("a hand-edited or older stored shape reads as nothing", () => {
    expect(parseStored(null)).toEqual({ handled: [], kept: [] });
    expect(parseStored({ handled: [{ nope: 1 }], kept: [{ spec: { key: 3 } }] })).toEqual({ handled: [], kept: [] });
  });
});

describe("the booth's messages (§2.3)", () => {
  const m = (over: Partial<MomentMessage> = {}): MomentMessage =>
    ({ seq: 42, channel: "dm:Norton", channelKind: "dm", title: "Norton", from: "Clippy", kind: "line", text: "🚨 Minesweeper is marked.", ts: 9_000, audience: ["@Norton"], parentSeq: null, hidden: false, readout: true, alert: true, about: "g7", aboutName: "Minesweeper", aboutAvatar: "av1", ...over }) as MomentMessage;

  it("a big moment, or a `!` readout about a guest, goes to the adapter; nothing else", () => {
    expect(popOutCandidate(m(), "major")).toBe(true);
    expect(popOutCandidate(m({ about: undefined }), "big")).toBe(true);
    expect(popOutCandidate(m({ about: undefined }), "major")).toBe(false);
    expect(popOutCandidate(m({ alert: false }), "major")).toBe(false);
  });

  it("the generic pop-out: msg:<seq>, the glyph, the guest from about*, 🗂 Open card, alarm for big, sticky, 80 / 60", () => {
    const opened: string[] = [];
    const d = defaultPopOut(m(), { openCard: (g) => opened.push(g) });
    expect(d).toMatchObject({ key: "msg:42", glyph: "🚨", title: "Readout", body: "Minesweeper is marked.", guest: { id: "g7", name: "Minesweeper", avatar: "av1" }, tone: "info", sticky: true, priority: 60, at: 9_000 });
    expect(d.actions.map((a) => a.label)).toEqual(["🗂 Open card"]);
    void d.actions[0]!.run();
    expect(opened).toEqual(["g7"]);
    const bigOne = defaultPopOut(m({ moment: "big", about: undefined, text: "No glyph." }), { openRoom: () => {} });
    expect([bigOne.tone, bigOne.priority, bigOne.glyph, bigOne.actions[0]?.label]).toEqual(["alarm", 80, "ℹ", "Open the room ›"]);
    // The lobby is never its room.
    expect(defaultPopOut(m({ about: undefined, channel: "lobby" }), { openRoom: () => {} }).actions).toEqual([]);
  });

  it("the docked strip's words and the body's paragraphs", () => {
    expect(stripText(spec("a", { guest: { id: "g", name: "Minesweeper", location: "The CPU" } }))).toBe("🚨 Wanted: Minesweeper · 📍 The CPU");
    expect(stripText(spec("a"))).toBe("🚨 Wanted");
    expect(paragraphs(["One.", " ", "Two."])).toEqual(["One.", "Two."]);
  });
});

describe("the store (one per booth sign-in) through the provider", () => {
  const alerts = { alert: null, dismiss: () => {}, raise: () => {}, onHistory: () => {}, rebase: () => {}, mark: () => -1, settle: () => {}, epoch: 0, recent: () => [] } as unknown as Alerts;
  const booth = (session: string, child: ReturnType<typeof createElement>, over: Partial<MomentsInput> = {}) =>
    renderToStaticMarkup(createElement(MomentsProvider, { role: "booth", me: "Norton", session, messages: new Map(), alerts, alertLevel: "sticky", objectives: [], phase: null, clock: 0, sound: false, ...over, children: child }));

  it("an offered message (a spec, or the generic one) floats in its own booth only", () => {
    resetPopOutStores();
    const m = { seq: 3, channel: "dm:Norton", channelKind: "dm", title: "Norton", from: "Clippy", kind: "line", text: "🚨 Minesweeper is marked.", ts: 1, audience: ["@Norton"], parentSeq: null, hidden: false, readout: true, alert: true, about: "g7", aboutName: "Minesweeper" } as unknown as MomentMessage;
    offerPopOut("tok-a", m, "default", { openCard: () => {} });
    const a = booth("tok-a", createElement(PopOutHost));
    expect(a).toContain("popout-host");
    expect(a).toContain("Minesweeper");
    expect(a).toContain("🗂 Open card");
    expect(booth("tok-b", createElement(PopOutHost))).toBe("");
    // A guest never has pop-outs.
    expect(booth("tok-a", createElement(PopOutHost), { role: "guest" })).toBe("");
  });

  it("never over the open card's guest: while that card is open nothing floats about them", () => {
    resetPopOutStores();
    raisePopOut(spec("wanted:g1", { guest: { id: "g1", name: "Winamp" } }));
    // (With no booth store yet, a free raise has nowhere to go; the offer names its sign-in.)
    offerPopOut("tok-c", { seq: 1, text: "x", ts: 0 } as unknown as MomentMessage, spec("wanted:g1", { guest: { id: "g1", name: "Winamp" } }), {});
    expect(booth("tok-c", createElement(PopOutHost))).toContain("Winamp");
    expect(booth("tok-c", createElement(PopOutHost), { cardGuest: () => "g1" })).toBe("");
  });

  it("a dock outside a mount renders nothing; usePopOuts outside a booth is inert", () => {
    resetPopOutStores();
    function Probe() {
      const p = usePopOuts();
      return createElement("i", null, `${p.current?.key ?? "none"} ${p.queued}`);
    }
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<i>none 0</i>");
    expect(booth("tok-d", createElement(PopOutDock))).toBe("");
  });
});

describe("the free functions", () => {
  it("reach the registered sink; calls before any sink are kept and flushed", () => {
    registerPopSink(null);
    const got: string[] = [];
    raisePopOut(spec("early"));
    retirePopOut("old");
    registerPopSink({ offer: () => got.push("offer"), raise: (_s, sp) => got.push(`raise ${sp.key}`), retire: (_s, k) => got.push(`retire ${k}`) });
    raisePopOut(spec("now"));
    expect(got).toEqual(["raise early", "retire old", "raise now"]);
  });
});

describe("the window (popout.tsx)", () => {
  const api = (over: Record<string, unknown> = {}) => ({ current: null, entry: null, queued: 2, tray: [], trayEntries: [], defer: () => {}, restore: () => {}, raise: () => {}, retire: () => {}, dock: () => ({ id: 1, off: () => {} }), activeDock: null, ...over });

  it("a non-modal Win95 window: the caption's glyph and title, the pager, the guest, the buttons, Later", () => {
    const s = spec("wanted:g1", { guest: { id: "g1", name: "Minesweeper", location: "The CPU", seen: "seen 2 min ago" }, actions: [{ id: "claim", label: "🙋 I'll get them", kind: "primary", run: () => {} }, { id: "card", label: "🗂 Open card", run: () => {} }], status: "Norton is on it" });
    const html = renderToStaticMarkup(createElement(PopOut, { entry: { spec: s }, api: api() as never }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="false"');
    expect(html).toContain("tone-alarm");
    expect(html).toContain("1 of 3");
    expect(html).toContain("Minesweeper");
    expect(html).toContain("📍 The CPU · seen 2 min ago");
    expect(html).toContain("🙋 I&#x27;ll get them");
    expect(html).toContain("🗂 Open card");
    expect(html).toContain(">Later<");
    expect(html).toContain('aria-label="Later"');
    expect(html).toContain("Norton is on it");
    expect(html).not.toContain('aria-label="Close"'); // no × and no scrim
  });

  it("a button with a dead time starts disabled; noLater drops Later; a restored one without buttons offers OK", () => {
    const dead = renderToStaticMarkup(createElement(PopOut, { entry: { spec: spec("c", { noLater: true, actions: [{ id: "shield", label: "🛡", kind: "primary", deadMs: 600, run: () => {} }] }) }, api: api({ queued: 0 }) as never }));
    expect(dead).toContain('disabled=""');
    expect(dead).not.toContain("Later");
    expect(dead).not.toContain("1 of");
    const restored = renderToStaticMarkup(createElement(PopOut, { entry: { spec: spec("r", { actions: [] }), restored: true }, api: api() as never }));
    expect(restored).toContain(">OK<");
  });

  it("docked: at most three buttons (then Later)", () => {
    const actions = ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase(), run: () => {} }));
    const html = renderToStaticMarkup(createElement(PopOut, { entry: { spec: spec("d", { actions }) }, api: api() as never, docked: true }));
    expect(html).toContain(">C<");
    expect(html).not.toContain(">D<");
    expect(html).toContain("docked");
  });

  it("outside a booth's provider nothing floats, and the tray says nothing waits", () => {
    expect(renderToStaticMarkup(createElement(PopOutHost))).toBe("");
    expect(renderToStaticMarkup(createElement(PopOutTrayList, {}))).toContain("Nothing waiting. You&#x27;re on top of it.");
    // The bell counts what the 🔔 window lists, never the queue behind the one on screen (BN2-FD).
    expect(popOutWaiting({ tray: [spec("a")] })).toBe(1);
    expect(popOutWaiting({ tray: [] })).toBe(0);
  });

  it("the stylesheet: docked over the stream above the dock, over the balloons and stickies (41, BN-F8), a 56 px primary, the flash only with motion", () => {
    const css = readBundledCss();
    expect(css).toMatch(/--z-popout: 41;/u);
    expect(css).toMatch(/\.popout-host \{[^}]*z-index: var\(--z-popout\)/u);
    expect(css).toMatch(/\.popout-host > \.popout \{[^}]*max-height: 70vh/u);
    expect(css).toMatch(/\.popout-btn\.primary \{[^}]*min-height: 56px/u);
    expect(css).toMatch(/\.popout-strip \{[^}]*min-height: 56px/u);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.popout\.tone-alarm \.popout-caption\.flash/u);
  });
});


describe("wave 37 (C9): an alarm takes the screen from an info pop-out", () => {
  const info = (key: string, priority: number) => spec(key, { tone: "info", priority, sticky: false });
  const shownAt = (s: PopState, at: number) => popReducer(s, { type: "show", key: currentOf(s, null, at)?.spec.key ?? null, at });

  it("an alarm 90 pre-empts an info 85 once it has been up 2 s, not before; the info one stays and shows again", () => {
    let s = shownAt(run([raise(info("yours", 85))]), 1_000);
    expect(s.shownAt).toBe(1_000);
    s = run([raise(spec("wanted:new", { priority: 90 }))], s);
    expect(currentOf(s, null, 1_000 + PREEMPT_GRACE_MS - 1)?.spec.key).toBe("yours");
    expect(preemptDueAt(s, null, 1_500)).toBe(1_000 + PREEMPT_GRACE_MS);
    expect(currentOf(s, null, 1_000 + PREEMPT_GRACE_MS)?.spec.key).toBe("wanted:new");
    expect(preemptDueAt(s, null, 1_000 + PREEMPT_GRACE_MS)).toBeNull();
    s = shownAt(s, 3_000);
    expect([s.shown, s.shownAt]).toEqual(["wanted:new", 3_000]);
    expect(s.live.map((e) => e.spec.key)).toContain("yours");
    s = popReducer(s, { type: "retire", key: "wanted:new" });
    expect([s.shown, s.shownAt]).toEqual([null, null]);
    expect(currentOf(s, null, 4_000)?.spec.key).toBe("yours");
  });

  it("info never pre-empts info; an alarm is never pre-empted by an alarm; a lower alarm waits", () => {
    const later = 60_000;
    expect(currentOf(run([raise(info("big", 99))], shownAt(run([raise(info("door", 50))]), 0)), null, later)?.spec.key).toBe("door");
    expect(currentOf(run([raise(spec("b", { priority: 99 }))], shownAt(run([raise(spec("a", { priority: 50 }))]), 0)), null, later)?.spec.key).toBe("a");
    const low = run([raise(spec("game", { priority: 55 }))], shownAt(run([raise(info("target", 60))]), 0));
    expect(currentOf(low, null, later)?.spec.key).toBe("target");
    expect(preemptDueAt(low, null, 0)).toBeNull();
  });

  it("a game that yields (an alarm 55) gives way after 2 s to the target (info 60) and a big readout (alarm 80), and shows again after them", () => {
    const game = spec("game:1", { priority: 55, yields: true, sticky: false });
    let s = shownAt(run([raise(game)]), 1_000);
    s = run([raise(info("target:bingo", 60))], s);
    expect(currentOf(s, null, 1_000 + PREEMPT_GRACE_MS - 1)?.spec.key).toBe("game:1");
    expect(preemptDueAt(s, null, 1_500)).toBe(1_000 + PREEMPT_GRACE_MS);
    expect(currentOf(s, null, 1_000 + PREEMPT_GRACE_MS)?.spec.key).toBe("target:bingo");
    s = popReducer(s, { type: "retire", key: "target:bingo" });
    expect(currentOf(s, null, 5_000)?.spec.key).toBe("game:1");
    const big = run([raise(spec("msg:7", { priority: 80, sticky: false }))], shownAt(run([raise(game)]), 0));
    expect(currentOf(big, null, PREEMPT_GRACE_MS)?.spec.key).toBe("msg:7");
    // Something below it (the door, 50) still waits; a stored one keeps the flag.
    expect(currentOf(run([raise(info("door", 50))], shownAt(run([raise(game)]), 0)), null, 60_000)?.spec.key).toBe("game:1");
    expect(parseStored(storedOf(popReducer(run([raise(game)]), { type: "defer", key: "game:1", at: 1 }))).kept[0]?.spec.yields).toBe(true);
  });

  it("a pre-emption about the open card's guest waits like any other", () => {
    const s = run([raise(spec("wanted:g1", { priority: 90, guest: { id: "g1", name: "Winamp" } }))], shownAt(run([raise(info("door", 50))]), 0));
    expect(currentOf(s, "g1", 10_000)?.spec.key).toBe("door");
    expect(currentOf(s, null, 10_000)?.spec.key).toBe("wanted:g1");
  });

  it("the one shown changing its rev in place (WANTED → YOURS) starts the grace again: a queued alarm still waits 2 s", () => {
    let s = shownAt(run([raise(spec("wanted:a", { rev: "open:1", priority: 90 })), raise(spec("wanted:b", { rev: "open:2", priority: 90, at: 2_000 }))]), 0);
    expect(s.shown).toBe("wanted:a");
    s = popReducer(s, { type: "raise", spec: info("wanted:a", 85), at: 10_000 });
    expect(s.shownAt).toBe(10_000);
    expect(currentOf(s, null, 11_000)?.spec.key).toBe("wanted:a");
    expect(preemptDueAt(s, null, 11_000)).toBe(10_000 + PREEMPT_GRACE_MS);
    expect(currentOf(s, null, 10_000 + PREEMPT_GRACE_MS)?.spec.key).toBe("wanted:b");
    // The same rev re-raised (a re-bind after a reload) keeps the grace where it was.
    const again = popReducer(s, { type: "raise", spec: info("wanted:a", 85), at: 11_500 });
    expect(again.shownAt).toBe(10_000);
    // A rev change on one that is not on screen touches nothing.
    expect(popReducer(s, { type: "raise", spec: spec("wanted:b", { rev: "taken:x", priority: 90, at: 2_000 }), at: 11_500 }).shownAt).toBe(10_000);
  });

  it("the host swaps the window when the grace ends, by its own timer, and chimes the alarm", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    resetPopOutStores();
    vi.mocked(playTone).mockClear();
    const ctx = ((mountHooks(PopOutScope, { session: null, children: null }).output as ReactElement).type as unknown as { _context: { _currentValue: unknown } })._context;
    ctx._currentValue = { session: "tok-grace" };
    try {
      const rung = () => mountHooks(usePopOuts, undefined as never).output as PopOutsApi;
      const keyOf = (out: unknown) => ((out as ReactElement | null)?.props as { children?: ReactElement<{ entry: { spec: PopOutSpec } }> } | undefined)?.children?.props.entry.spec.key ?? null;
      rung().raise(info("yours", 85));
      const host = mountHooks(PopOutHost, {});
      expect(keyOf(host.output)).toBe("yours");
      vi.advanceTimersByTime(500);
      rung().raise(spec("wanted:new", { priority: 90 }));
      host.rerender({});
      expect(keyOf(host.output)).toBe("yours");
      expect(vi.mocked(playTone).mock.calls.map((c) => c[0])).toEqual(["info"]);
      host.act(() => vi.advanceTimersByTime(1_600));
      expect(keyOf(host.output)).toBe("wanted:new");
      expect(vi.mocked(playTone).mock.calls.map((c) => c[0])).toEqual(["info", "alarm"]);
      // It holds now (shown is the alarm): a higher alarm raised later waits behind it.
      rung().raise(spec("wanted:big", { priority: 95 }));
      vi.advanceTimersByTime(10_000);
      host.rerender({});
      expect(keyOf(host.output)).toBe("wanted:new");
      host.unmount();
    } finally {
      ctx._currentValue = null;
      vi.useRealTimers();
    }
  });

  it("restore starts the grace; hydrate and reset keep the shape", () => {
    let s = run([raise(info("door", 50)), { type: "defer", key: "door", at: 0 }, raise(spec("w", { priority: 90 }))]);
    s = popReducer(s, { type: "restore", key: "door", at: 5_000 });
    expect(currentOf(s, null, 6_000)?.spec.key).toBe("door");
    expect(currentOf(s, null, 7_000)?.spec.key).toBe("w");
    expect(popReducer(s, { type: "hydrate", stored: { handled: [], kept: [] } }).shownAt).toBe(5_000);
    expect(popReducer(s, { type: "reset" })).toEqual({ live: [], tray: [], handled: [], shown: null, shownAt: null });
  });
});

describe("wave 37 (C9): autoLaterMs and the 🔔 Waiting row (C8)", () => {
  it("a deferred door re-raised with the same rev stays in Waiting; the next guest at the front of the queue (a new rev) comes back", () => {
    const door = (rev: string, wait: string) => spec("door", { rev, tone: "info", priority: 50, sticky: false, autoLaterMs: 45_000, body: ["Winamp is waiting at the Optical Drive.", wait] });
    let s = run([raise(door("winamp", "waiting 0:10")), { type: "defer", key: "door", at: 1 }]);
    s = run([raise(door("winamp", "waiting 0:55"))], s);
    expect([s.live.length, s.tray.length, paragraphs(s.tray[0]!.spec.body)[1]]).toEqual([0, 1, "waiting 0:55"]);
    s = run([raise(door("icq", "waiting 0:01"))], s);
    expect([s.live.length, s.tray.length]).toEqual([1, 0]);
  });

  it("the window defers itself after autoLaterMs on screen (and never before)", () => {
    vi.useFakeTimers();
    try {
      const deferred: string[] = [];
      const api = { queued: 0, defer: (k: string) => deferred.push(k), retire: () => {} } as unknown as PopOutsApi;
      const h = mountHooks(PopOut, { entry: { spec: spec("door", { tone: "info", autoLaterMs: 45_000 }) }, api });
      vi.advanceTimersByTime(44_999);
      expect(deferred).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(deferred).toEqual(["door"]);
      h.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a Waiting row reads the body's first paragraph, cut to 60 characters", () => {
    expect(trayLine(["Computer Bingo, 20 minutes.", "two"])).toBe("Computer Bingo, 20 minutes.");
    const long = trayLine("Computer Bingo, 20 minutes. Fill the Desktop with noise; winners come to you.")!;
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("…")).toBe(true);
    expect(trayLine([])).toBeNull();
  });

  it("a Waiting row is cut on code points: an emoji astride the cut stays whole", () => {
    const body = `${"x".repeat(58)}🎱 and the rest of the line, well past sixty.`;
    expect(body.charCodeAt(58)).toBeGreaterThanOrEqual(0xd800);
    const line = trayLine(body)!;
    expect(line).toBe(`${"x".repeat(58)}🎱…`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(line)).toBe(false);
    expect(Array.from(line)).toHaveLength(60);
  });
});

describe("wave 37 (C4): face to face, nothing floats (PopOutQuiet)", () => {
  /** The scope's context, as the hooks harness reads it (`_currentValue`). */
  const scopeCtx = (mountHooks(PopOutScope, { session: null, children: null }).output as ReactElement).type as unknown as { _context: { _currentValue: unknown } };
  // Straight into the scope's store (an earlier test registers its own sink for the free functions).
  const offer = (_session: string, s: PopOutSpec) => (mountHooks(usePopOuts, undefined as never).output as PopOutsApi).raise(s);
  const keyOf = (out: unknown) => ((out as ReactElement | null)?.props as { children?: ReactElement<{ entry: { spec: PopOutSpec } }> } | undefined)?.children?.props.entry.spec.key ?? null;
  beforeEach(() => {
    resetPopOutStores();
    vi.mocked(playTone).mockClear();
    scopeCtx._context._currentValue = { session: "tok-quiet" };
  });
  afterEach(() => {
    scopeCtx._context._currentValue = null;
  });

  it("while one is mounted: the host renders nothing, nothing is marked shown, no tone; after, the best one floats and chimes once", () => {
    offer("tok-quiet", spec("a", { tone: "info", priority: 50 }));
    const q = mountHooks(PopOutQuiet, {});
    expect(q.output).toBeNull();
    const host = mountHooks(PopOutHost, {});
    expect(host.output).toBeNull();
    // Nothing was held: a better one raised now is the one that shows after.
    offer("tok-quiet", spec("b", { tone: "info", priority: 70 }));
    host.rerender({});
    expect(host.output).toBeNull();
    expect(vi.mocked(playTone)).not.toHaveBeenCalled();
    q.unmount();
    host.rerender({});
    expect(keyOf(host.output)).toBe("b");
    expect(vi.mocked(playTone)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(playTone).mock.calls[0]![0]).toBe("info");
    host.rerender({});
    expect(vi.mocked(playTone)).toHaveBeenCalledTimes(1);
  });

  it("a card opened for the shown one's guest, its quiet later in the tree in the same commit: no swap, no tone", () => {
    let card: string | null = null;
    scopeCtx._context._currentValue = { session: "tok-quiet", cardGuest: () => card };
    offer("tok-quiet", spec("a", { priority: 90, guest: { id: "g1", name: "Winamp" } }));
    offer("tok-quiet", spec("b", { priority: 80, guest: { id: "g2", name: "ICQ" } }));
    // The booth's frame: the host first, the card's PopOutQuiet after it (the harness
    // commits every layout effect before any passive one, as React does).
    const Frame = ({ quiet }: { quiet: boolean }) => {
      const out = PopOutHost();
      if (quiet) PopOutQuiet();
      return out;
    };
    const f = mountHooks(Frame, { quiet: false });
    expect(keyOf(f.output)).toBe("a");
    expect(vi.mocked(playTone)).toHaveBeenCalledTimes(1);
    vi.mocked(playTone).mockClear();
    card = "g1";
    f.rerender({ quiet: true });
    expect(vi.mocked(playTone)).not.toHaveBeenCalled();
    f.rerender({ quiet: true });
    expect(f.output).toBeNull();
    expect(vi.mocked(playTone)).not.toHaveBeenCalled();
    f.unmount();
    // The card closed: "a" was still the one held (state.shown never moved to "b").
    card = null;
    const api = mountHooks(usePopOuts, undefined as never).output as PopOutsApi;
    expect([api.current?.key, api.quieted, api.quietNow()]).toEqual(["a", false, false]);
  });

  it("a dock renders nothing while quiet; two quiets need both gone", () => {
    offer("tok-quiet", spec("a", { tone: "info", priority: 50 }));
    const q1 = mountHooks(PopOutQuiet, {});
    const q2 = mountHooks(PopOutQuiet, {});
    const dock = mountHooks(PopOutDock, {});
    expect(dock.output).toBeNull();
    q1.unmount();
    dock.rerender({});
    expect(dock.output).toBeNull();
    q2.unmount();
    dock.rerender({});
    expect(dock.output).not.toBeNull();
    dock.unmount();
  });

  it("the 🔔 Waiting row shows the body's line under the title", () => {
    offer("tok-quiet", spec("game:9", { glyph: "🎱", title: "YOUR GAME IS ON", tone: "alarm", body: ["Computer Bingo, 20 minutes."] }));
    (mountHooks(usePopOuts, undefined as never).output as PopOutsApi).defer("game:9");
    const list = mountHooks(PopOutTrayList, {});
    const html = renderToStaticMarkup(list.output as ReactElement);
    expect(html).toContain("YOUR GAME IS ON");
    expect(html).toContain('<span class="popout-tray-when">Computer Bingo, 20 minutes.</span>');
    expect(html).toContain("deferred just now");
  });
});
