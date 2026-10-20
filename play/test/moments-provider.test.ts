//! Wave 13, the moments lane: the provider's own rules, as the pure
//! functions it runs — which readouts are news (a booth's own answers never
//! pop up; a guest's quiet-toast echo is dropped; the card afterglow).

import { describe, expect, it } from "vitest";
import { CARD_AFTERGLOW_MS, ECHO_MS, READOUT_WAIT_MS, afterWait, sortArrivals, type Moment, type ToastSeen } from "../src/moments/model.ts";

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
