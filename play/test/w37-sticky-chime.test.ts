//! Wave 37 fix round: a sticky chimes when it arrives, even while a window
//! holds the moments layer (a booth's Door queue or board, a guest's pass).
//! Its 45 s and its read mark still wait until it is really on screen. Face
//! to face (the scanner, a card: balloons wait) it stays silent until ×
//! (principle 2), then chimes once.

import { afterEach, describe, expect, it, vi } from "vitest";
import { playChime, type Alerts } from "../src/alerts.ts";
import { MOMENTS_MEMORY, freshMemory, recallMoments, rememberMoments } from "../src/moments/memory.ts";
import { STICKY_MS } from "../src/moments/model.ts";
import { MomentsProvider, type MomentsInput } from "../src/moments/provider.tsx";
import type { ChatMessage } from "../src/types.ts";
import { mountHooks } from "./hooks-harness.ts";

vi.mock("../src/alerts.ts", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/alerts.ts")>()), playChime: vi.fn(), vibrate: vi.fn() }));

type Engine = { surfaces: { sticky: { moment: { key: string } } | null }; notif: { sign: { seen: Set<string> } }; hold: (d: number) => void };
const engineOf = (h: { output: unknown }) => (h.output as { props: { value: Engine } }).props.value;
const alerts: Alerts = { alert: null, dismiss: () => {}, raise: () => {}, onHistory: () => {}, rebase: () => {}, mark: () => -1, settle: () => {}, epoch: 0, recent: () => [], histories: () => 0 } as unknown as Alerts;
const Provider = MomentsProvider as unknown as (p: MomentsInput & { children: null }) => unknown;
const ME = "Norton";
const alarm = (seq: number): ChatMessage =>
  ({ seq, channel: `dm:${ME}`, channelKind: "dm", title: ME, from: "", kind: "narration", readout: true, moment: "major", alert: true, text: "!🚨 A made-up alarm. Get there.", ts: 0, audience: [`@${ME}`], parentSeq: null, hidden: false }) as unknown as ChatMessage;

function stubPage() {
  vi.useFakeTimers({ now: 5_000_000 });
  vi.stubGlobal("window", {
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
    setInterval: (f: () => void, ms: number) => setInterval(f, ms),
    clearInterval: (t: ReturnType<typeof setInterval>) => clearInterval(t),
  });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  MOMENTS_MEMORY.clear();
  vi.mocked(playChime).mockClear();
});

describe("wave 37 fix: a sticky chimes on arrival under a hold", () => {
  it("chimes once as it arrives under a booth window; no 45 s and no read mark until the window closes; no second chime after", () => {
    stubPage();
    const session = "w37-chime";
    rememberMoments("booth", session, { ...freshMemory(), session, epoch: 0 });
    const input: MomentsInput = { role: "booth", me: ME, session, messages: new Map(), alerts, alertLevel: "sticky", objectives: undefined, phase: "doors", clock: 0, sound: true };
    const h = mountHooks(Provider, { ...input, children: null });
    h.act(() => engineOf(h).hold(1));
    h.rerender({ ...input, messages: new Map([[1, alarm(1)]]), children: null });
    h.act(() => vi.advanceTimersByTime(3_000));
    const mem = recallMoments("booth", session);
    const stickies = () => mem.state.queue.filter((q) => q.level === "sticky").map((q) => q.moment.key);
    const key = stickies()[0];
    expect(stickies()).toEqual(["m:1"]);
    expect(engineOf(h).surfaces.sticky?.moment.key).toBe(key);
    expect(vi.mocked(playChime)).toHaveBeenCalledTimes(1);
    // Held: its clock never runs, it is not read.
    h.act(() => vi.advanceTimersByTime(STICKY_MS * 2));
    expect(stickies()).toEqual([key]);
    expect(engineOf(h).notif.sign.seen.has(key!)).toBe(false);
    expect(mem.shownAt.has(key!)).toBe(false);
    // The window closes: on screen now, with no second chime, and it leaves after 45 s, read.
    h.act(() => engineOf(h).hold(-1));
    expect(mem.shownAt.has(key!)).toBe(true);
    expect(vi.mocked(playChime)).toHaveBeenCalledTimes(1);
    h.act(() => vi.advanceTimersByTime(STICKY_MS));
    expect(stickies()).toEqual([]);
    expect(engineOf(h).notif.sign.seen.has(key!)).toBe(true);
    h.unmount();
  });

  it("face to face (balloons wait: the scanner, a card) it stays silent until ×, then chimes once", () => {
    stubPage();
    const session = "w37-chime-f2f";
    rememberMoments("booth", session, { ...freshMemory(), session, epoch: 0 });
    const input: MomentsInput = { role: "booth", me: ME, session, messages: new Map(), alerts, alertLevel: "sticky", objectives: undefined, phase: "doors", clock: 0, sound: true, balloonsWait: true };
    const h = mountHooks(Provider, { ...input, children: null });
    h.act(() => engineOf(h).hold(1));
    h.rerender({ ...input, messages: new Map([[1, alarm(1)]]), children: null });
    h.act(() => vi.advanceTimersByTime(3_000));
    expect(vi.mocked(playChime)).not.toHaveBeenCalled();
    h.rerender({ ...input, balloonsWait: false, messages: new Map([[1, alarm(1)]]), children: null });
    h.act(() => engineOf(h).hold(-1));
    expect(vi.mocked(playChime)).toHaveBeenCalledTimes(1);
    h.unmount();
  });
});
