// Wave 21 (P1): a player's whole booth, rendered — the ▣ MISSION title bar,
// Mission as the window, the taskbar Mission · Chats · Scan, no NOW card,
// no Guests, no host dock, no cue bar. A host's booth keeps its frame.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Channel, PrimeView } from "../src/types.ts";

let current: unknown = null;
vi.mock("../src/session/prime.ts", async (orig) => ({ ...(await orig<typeof import("../src/session/prime.ts")>()), usePrimeSession: () => current }));

const { PerformerApp } = await import("../src/booth/app.tsx");
const { buildPrimeChannels } = await import("../src/session/prime.ts");

function session(view: PrimeView, auth: Record<string, unknown> = {}) {
  const list: Channel[] = buildPrimeChannels(new Map(), view);
  return {
    auth: { token: "t", character: view.character, admin: false, eventId: "e", title: "Show", ...auth },
    ready: true,
    view,
    messages: new Map(),
    threads: { list, spaces: [], activeId: null, active: null, open: () => {}, back: () => {}, activeThreadRoot: null, openThread: () => {}, closeThread: () => {}, markRead: () => {} },
    alerts: { raise: () => {}, alert: null, dismiss: () => {} },
    notice: null,
    roomLinkPending: false,
    connected: true,
    widgetAnswers: new Map(),
  };
}

const base = (over: Partial<PrimeView>): PrimeView =>
  ({
    character: "Clippy",
    faction: null,
    guests: [],
    channels: [],
    spaces: [],
    interactions: [{ id: "winner", label: "🎱 Bingo winner", who: "performer", description: null }],
    objectives: [{ id: "bingo", title: "🎱 Computer Bingo", brief: "Find the winner.", checklist: [], buttons: ["winner"], act: null, pick: ["g1"] }],
    stats: [{ glyph: "⭐", label: "Points", value: "40" }],
    calls: { rows: [], next: null, last: null, lastName: null, act: null, presses: 0 },
    ...over,
  }) as PrimeView;

describe("the booth frame (P1)", () => {
  it("a player's booth is the guest frame: ▣ MISSION, Mission, Mission · Chats · Scan", () => {
    current = session(base({ player: true }));
    const html = renderToStaticMarkup(<PerformerApp onLeave={() => {}} />);
    expect(html).toContain("▣ MISSION");
    expect(html).toContain("Computer Bingo");
    expect(html).toContain("🎱 Bingo winner");
    expect(html).toContain("desk-tile score");
    expect(html).toContain("⭐ 40");
    expect(html).toContain('data-tour="mission"');
    expect(html).toContain('data-tour="chats"');
    expect(html).not.toContain('data-tour="guests"');
    expect(html).not.toContain("booth-now-bar");
    expect(html).not.toContain("cue-bar");
  });
  it("a plain performer keeps the NOW card, Scan and Guests", () => {
    current = session(base({ player: false, calls: undefined }));
    const html = renderToStaticMarkup(<PerformerApp onLeave={() => {}} />);
    expect(html).toContain("booth-now");
    expect(html).toContain('data-tour="guests"');
    expect(html).not.toContain("▣ MISSION");
  });
});
