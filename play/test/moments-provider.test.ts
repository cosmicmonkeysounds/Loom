//! Wave 13, the moments lane: the provider's own rules, as the pure
//! functions it runs — which readouts are news (a booth's own answers never
//! pop up; a guest's quiet-toast echo is dropped; the card afterglow), the
//! loud objective announced once per sign-in (persisted), the done list a
//! reload picks up, and the memory that carries the queue across a remount
//! (the guest app's cutscene ⇄ main switch).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Alerts } from "../src/alerts.ts";
import type { SessionStorage } from "../src/host.ts";
import { MEMORY_MAX, MOMENTS_MEMORY, announceLoud, freshMemory, loadDone, memoryKey, recallMoments, rememberMoments, saveDoneList } from "../src/moments/memory.ts";
import { CARD_AFTERGLOW_MS, ECHO_MS, EMPTY_MOMENTS, READOUT_WAIT_MS, afterWait, momentsReducer, sortArrivals, type Moment, type ToastSeen } from "../src/moments/model.ts";
import { MomentsLayer, MomentsProvider, type MomentsInput } from "../src/moments/provider.tsx";
import type { ObjectiveView } from "../src/types.ts";

function moment(seq: number, over: Partial<Moment> = {}): Moment {
  return { key: `m:${seq}`, seq, severity: "minor", kind: "readout", caption: "Norton", text: `readout ${seq}`, channel: "dm:Norton", at: seq * 1000, phase: null, ...over };
}

const T = 1_000_000;
const ctx = (over: Partial<Parameters<typeof sortArrivals>[1]> = {}): Parameters<typeof sortArrivals>[1] => ({
  role: "booth",
  held: false,
  sinceHoldEnd: Number.POSITIVE_INFINITY,
  about: () => false,
  recent: [],
  now: T,
  ...over,
});
const toast = (text: string, quiet: boolean, at = T - 100): ToastSeen => ({ text, quiet, at });

describe("a booth's readouts", () => {
  it("the answer to its own scan / press never pops up (no unsolicited raise came before it)", () => {
    expect(sortArrivals([moment(1, { text: "✅ Cleared: Winamp" })], ctx())).toEqual({ now: [], later: [] });
  });

  it("a readout the session raised as news (the late list, a warning) shows at once", () => {
    const late = moment(2, { text: "⏰ Winamp is late" });
    expect(sortArrivals([late], ctx({ recent: [toast("⏰ Winamp is late", false)] })).now).toEqual([late]);
    // Too long ago, or a quiet one: not that readout's mark.
    expect(sortArrivals([late], ctx({ recent: [toast("⏰ Winamp is late", false, T - ECHO_MS - 1)] })).now).toEqual([]);
    expect(sortArrivals([late], ctx({ recent: [toast("⏰ Winamp is late", true)] })).now).toEqual([]);
  });

  it("a major readout (`reply !…`) always shows; any other moment is untouched", () => {
    const alarm = moment(3, { severity: "major", text: "🚨 The door is open" });
    const card = moment(4, { kind: "card" });
    expect(sortArrivals([alarm, card], ctx()).now).toEqual([alarm, card]);
  });

  it("one about a guest while the card is open, or just after, was shown on the card", () => {
    const about = moment(5, { severity: "major" });
    const c = { about: (seq: number | null) => seq === 5 };
    expect(sortArrivals([about], ctx({ ...c, held: true })).now).toEqual([]);
    expect(sortArrivals([about], ctx({ ...c, sinceHoldEnd: CARD_AFTERGLOW_MS - 1 })).now).toEqual([]);
    expect(sortArrivals([about], ctx({ ...c, sinceHoldEnd: CARD_AFTERGLOW_MS })).now).toEqual([about]);
  });
});

describe("a guest's readouts", () => {
  it("a minor readout waits for the quiet toast of the guest's own press, then drops the echo", () => {
    const done = moment(6, { text: "Bathroom Mode engaged.", channel: "lobby" });
    const r = sortArrivals([done], ctx({ role: "guest" }));
    expect(r).toEqual({ now: [], later: [done] });
    expect(afterWait(r.later, [toast("✔ Done. Bathroom Mode engaged.", true, T + 200)], T + READOUT_WAIT_MS)).toEqual([]);
    // No toast said it: it is news.
    expect(afterWait(r.later, [toast("✔ Done.", true)], T + READOUT_WAIT_MS)).toEqual([done]);
    // A loud toast is never a guest's echo.
    expect(afterWait(r.later, [toast("Bathroom Mode engaged.", false)], T + READOUT_WAIT_MS)).toEqual([done]);
  });
});

function memStorage(): SessionStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    load: <T,>(k: string) => (data.has(k) ? (JSON.parse(JSON.stringify(data.get(k))) as T) : null),
    save: (k, v) => void data.set(k, v),
    drop: (k) => void data.delete(k),
  };
}

describe("the loud objective, once per sign-in", () => {
  const o = (id: string, over: Partial<ObjectiveView> = {}): ObjectiveView => ({ id, title: `Do ${id}`, brief: "", checklist: [], buttons: [], act: null, loud: true, ...over });

  it("announced once, persisted for the sign-in; a new sign-in hears it again", () => {
    const st = memStorage();
    expect(announceLoud(st, "guest", "tok", [o("pass")], 0, null).map((m) => m.key)).toEqual(["o:pass"]);
    expect(announceLoud(st, "guest", "tok", [o("pass")], 0, null)).toEqual([]); // a reload of the same sign-in
    expect(announceLoud(st, "guest", "tok", [o("pass"), o("hunt")], 0, null).map((m) => m.key)).toEqual(["o:hunt"]);
    expect(st.data.get("loom.moments.loud.guest")).toEqual({ session: "tok", ids: ["pass", "hunt"] });
    expect(announceLoud(st, "guest", "new", [o("pass")], 0, null)).toHaveLength(1);
    // A booth keeps its own list.
    expect(announceLoud(st, "booth", "tok", [o("pass")], 0, null)).toHaveLength(1);
  });

  it("blocked storage: it still announces (at worst again after a reload)", () => {
    const st: SessionStorage = { load: () => null, save: () => { throw new Error("blocked"); }, drop: () => {} };
    expect(announceLoud(st, "guest", "tok", [o("pass")], 0, null)).toHaveLength(1);
  });
});

describe("the done list a reload picks up", () => {
  it("only this sign-in's, only above the mark", () => {
    const st = memStorage();
    saveDoneList(st, "guest", "tok", [8, 15, 20]);
    const mem = freshMemory();
    loadDone(st, "guest", "tok", 10, mem);
    expect([...mem.processed]).toEqual([15, 20]);
    expect(mem.savedDone).toBe("8,15,20");
    const other = freshMemory();
    loadDone(st, "guest", "someone-else", -1, other);
    expect(other.processed.size).toBe(0);
  });
});

describe("the memory across a remount (the cutscene ⇄ main switch)", () => {
  const alerts: Alerts = { alert: null, dismiss: () => {}, raise: () => {}, onHistory: () => {}, rebase: () => {}, mark: () => -1, settle: () => {}, epoch: 0, recent: () => [] };
  const input = (session: string): MomentsInput => ({ role: "guest", me: "g1", session, messages: new Map(), alerts, alertLevel: "dialog", objectives: [], phase: null, clock: 0, openRoom: () => {}, sound: false });
  const dialog: Moment = { key: "m:7", seq: 7, severity: "major", kind: "alert", caption: "Clippy", text: "Everyone to the Desktop", channel: "lobby", at: 0, phase: null };

  it("a provider mounting for the same sign-in carries on with the queue; another sign-in starts empty", () => {
    MOMENTS_MEMORY.clear();
    const mem = { ...freshMemory(), session: "tok", epoch: 0 };
    mem.state = momentsReducer(EMPTY_MOMENTS, { type: "arrive", moments: [dialog], visible: true, level: "dialog", role: "guest", now: 0, phase: null, batch: false });
    rememberMoments("guest", "tok", mem);
    expect(recallMoments("guest", "tok")).toBe(mem);
    const html = renderToStaticMarkup(createElement(MomentsProvider, { ...input("tok"), children: createElement(MomentsLayer) }));
    expect(html).toContain("Everyone to the Desktop");
    expect(html).toContain('role="dialog"');
    expect(renderToStaticMarkup(createElement(MomentsProvider, { ...input("other"), children: createElement(MomentsLayer) }))).toBe("");
    expect(recallMoments("booth", "tok")).not.toBe(mem);
    MOMENTS_MEMORY.clear();
  });

  it("keeps the newest sign-ins only (Run → Players mounts many); signed out keeps nothing", () => {
    MOMENTS_MEMORY.clear();
    for (let i = 0; i < MEMORY_MAX + 3; i++) rememberMoments("guest", `t${i}`, { ...freshMemory(), session: `t${i}` });
    expect(MOMENTS_MEMORY.size).toBe(MEMORY_MAX);
    expect(MOMENTS_MEMORY.has(memoryKey("guest", "t0"))).toBe(false);
    expect(MOMENTS_MEMORY.has(memoryKey("guest", `t${MEMORY_MAX + 2}`))).toBe(true);
    rememberMoments("guest", null, freshMemory());
    expect(MOMENTS_MEMORY.size).toBe(MEMORY_MAX);
    MOMENTS_MEMORY.clear();
  });
});
