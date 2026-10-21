//! Wave 18, the moments lane (BOOTH-SPEC §2, CONTRACTS C9, the user's
//! "pop outs are your friend here"): the booth pop-out rung's rules — one on
//! screen, never replaced; priority then age; handled `{key, rev}`; Later →
//! the tray; never over the open card's guest; storage across a reload; the
//! generic pop-out for a `!` readout; the free functions.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Alerts } from "../src/alerts.ts";
import { MomentsProvider, type MomentsInput } from "../src/moments/provider.tsx";
import { PopOut, PopOutDock, PopOutHost, PopOutTrayList, popOutWaiting, resetPopOutStores, usePopOuts } from "../src/moments/popout.tsx";
import { offerPopOut, popOutCandidate, raisePopOut, registerPopSink, retirePopOut } from "../src/moments/popout-registry.ts";
import { readBundledCss } from "./css.ts";
import {
  EMPTY_POPOUTS,
  HANDLED_MAX,
  currentOf,
  defaultPopOut,
  deferredText,
  pagerOf,
  paragraphs,
  parseStored,
  popReducer,
  queuedOf,
  storedOf,
  stripText,
  type PopOp,
  type PopOutSpec,
  type PopState,
} from "../src/moments/popout-model.ts";
import type { MomentMessage } from "../src/moments/model.ts";

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

  it("the one shown is never replaced while unhandled, not even by a higher priority", () => {
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
