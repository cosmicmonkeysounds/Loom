//! Wave 18, the moments lane (GUEST-SPEC §6, acceptance 14, the user's
//! "navigation from alerts and popups should be rock solid"): through the
//! provider, every surface — balloon, sticky, dialog, blue screen, big,
//! a Notifications row — renders the exits `exitsOf` gives it for the
//! guest's context; the lobby is never one; with no `go` the old room /
//! pass exits stand (the cutscene: none). A big renders its card inside.

import { createElement, type ReactElement } from "react";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import type { Alerts } from "../src/alerts.ts";
import type { ExitContext, Nav } from "../src/moments/exits.ts";
import { MOMENTS_MEMORY, freshMemory, memoryKey } from "../src/moments/memory.ts";
import { EMPTY_MOMENTS, type Moment, type Queued, type Rung } from "../src/moments/model.ts";
import { NotificationsWindow, useNotifications } from "../src/moments/notifications.tsx";
import { BellButton, MomentsLayer, MomentsProvider, type MomentsInput } from "../src/moments/provider.tsx";
import type { ChatMessage } from "../src/types.ts";

const alerts: Alerts = { alert: null, dismiss: () => {}, raise: () => {}, onHistory: () => {}, rebase: () => {}, mark: () => -1, settle: () => {}, epoch: 0, recent: () => [] } as unknown as Alerts;

const ctx: ExitContext = {
  listed: new Set(["lobby", "loc:The Desktop", "loc:The Internet", "dm:Trabolta", "codex", "quests", "wallet"]),
  titles: new Map([
    ["loc:The Desktop", "The Desktop (living room)"],
    ["loc:The Internet", "The Internet (the tent)"],
    ["dm:Trabolta", "Trabolta"],
  ]),
  open: null,
  window: "chats",
  cards: [],
  dms: [{ id: "dm:Trabolta", title: "Trabolta", last: 5 }],
  actions: new Set(),
  sides: false,
};

function msg(seq: number, over: Partial<ChatMessage> & Record<string, unknown> = {}): ChatMessage {
  return { seq, channel: "lobby", channelKind: "lobby", title: "Trapped in the Internet", from: "", kind: "signal", text: `📣 moment ${seq}.`, ts: seq * 1000, audience: "all", parentSeq: null, hidden: false, ...over } as ChatMessage;
}
function moment(seq: number, over: Partial<Moment> = {}): Moment {
  return { key: `m:${seq}`, seq, severity: "major", kind: "alert", caption: "Clippy", text: `📣 moment ${seq}.`, channel: "lobby", at: seq * 1000, phase: null, house: true, ...over };
}

function render(queue: Array<[Moment, Rung]>, over: Partial<MomentsInput> = {}, child: ReactElement = createElement(MomentsLayer)): string {
  const mem = freshMemory();
  mem.session = "tok";
  mem.epoch = 0;
  mem.state = { ...EMPTY_MOMENTS, queue: queue.map(([moment, level]): Queued => ({ moment, level, queuedAt: 0 })) };
  MOMENTS_MEMORY.set(memoryKey(over.role ?? "guest", "tok"), mem);
  const input: MomentsInput = { role: "guest", me: "g1", session: "tok", messages: new Map(), alerts, alertLevel: "sticky", objectives: [], phase: null, clock: 0, sound: false, go: () => {}, exitContext: () => ctx, ...over };
  return renderToStaticMarkup(createElement(MomentsProvider, { ...input, children: child }));
}

afterEach(() => MOMENTS_MEMORY.clear());

/** Render and wait for every lazy part (the big window is its own chunk). */
function renderAll(el: ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    let html = "";
    const sink = new Writable({
      write(chunk, _enc, done) {
        html += String(chunk);
        done();
      },
      final(done) {
        resolve(html.replace(/<!--[^>]*-->/gu, ""));
        done();
      },
    });
    const s = renderToPipeableStream(el, { onAllReady: () => s.pipe(sink), onError: reject });
  });
}
function renderBig(queue: Array<[Moment, Rung]>, over: Partial<MomentsInput> = {}): Promise<string> {
  render([], over); // seeds the memory the same way
  const mem = MOMENTS_MEMORY.get(memoryKey(over.role ?? "guest", "tok"))!;
  mem.state = { ...EMPTY_MOMENTS, queue: queue.map(([moment, level]): Queued => ({ moment, level, queuedAt: 0 })) };
  const input: MomentsInput = { role: "guest", me: "g1", session: "tok", messages: new Map(), alerts, alertLevel: "sticky", objectives: [], phase: null, clock: 0, sound: false, go: () => {}, exitContext: () => ctx, ...over };
  return renderAll(createElement(MomentsProvider, { ...input, children: createElement(MomentsLayer) }));
}

describe("every surface renders exitsOf's exits", () => {
  const go: Nav[] = [];
  const surfaces: Array<[Rung, string]> = [
    ["balloon", "moments-balloon"],
    ["sticky", "moments-sticky"],
    ["dialog", "w95-dialog"],
    ["bsod", "moments-bsod"],
    ["big", "moments-big"],
  ];
  for (const [rung, cls] of surfaces) {
    it(`${rung}: a lobby broadcast offers Mission, never the lobby; a room broadcast its room`, async () => {
      const house = rung === "big" ? await renderBig([[moment(1), rung]]) : render([[moment(1), rung]], { go: (n) => go.push(n) });
      expect(house).toContain(cls);
      expect(house).toContain("What do I do?");
      expect(house).not.toContain("Take me there");
      expect(house).not.toContain("Trapped in the Internet");
      const room = rung === "big" ? await renderBig([[moment(2, { channel: "loc:The Desktop" }), rung]]) : render([[moment(2, { channel: "loc:The Desktop" }), rung]]);
      expect(room).toContain("Go to The Desktop ›");
    });
  }

  it("a story `go:` wins (the capture: Go to The Internet, Show my pass)", async () => {
    const m = moment(3, { severity: "big", kind: "readout", house: false, channel: "dm:Trabolta", text: "🌐 Sent to the Internet. Go to the tent.", go: [{ kind: "room", id: "loc:The Internet", label: "📍 Go to The Internet ›" }, { kind: "pass", label: "🎟 Show my pass" }] });
    const html = await renderBig([[m, "big"]]);
    expect(html).toContain("⛔ QUARANTINED");
    expect(html).toContain("📍 Go to The Internet ›");
    expect(html).toContain("🎟 Show my pass");
  });

  it("no `go` (on rails, or an older app): the room exit via openRoom, the pass via openPass; none without them", () => {
    const legacy = render([[moment(4, { channel: "loc:The Desktop" }), "sticky"]], { go: undefined, exitContext: undefined, openRoom: () => {} });
    expect(legacy).toContain("Go there ›");
    const lobby = render([[moment(5), "sticky"]], { go: undefined, exitContext: undefined, openRoom: () => {} });
    expect(lobby).not.toContain("moments-go");
    const cut = render([[moment(6, { channel: "loc:The Desktop" }), "sticky"]], { go: undefined, exitContext: undefined });
    expect(cut).not.toContain("moments-go");
    const pass = render([[moment(7, { kind: "objective", key: "o:pass", seq: null, channel: null, pass: true }), "sticky"]], { go: undefined, exitContext: undefined, openPass: () => {} });
    expect(pass).toContain("Show my pass");
  });
});

describe("a big moment with its card", () => {
  it("renders the poll inside it, answered there (C1, §5.3)", async () => {
    const card = msg(8, { kind: "widget", channel: "dm:Trabolta", channelKind: "dm", title: "Trabolta", from: "Trabolta", moment: "big", audience: ["g1"], widget: { kind: "poll", text: "🍾 Truth or dare?", params: { options: "🗣 Truth|🎩 Dare" } } });
    const m = moment(8, { severity: "big", kind: "card", house: false, channel: "dm:Trabolta", caption: "Trabolta", text: "🍾 The bottle landed on you. Truth or dare?", card: { seq: 8, kind: "poll", glyph: "🍾" } });
    const html = await renderBig([[m, "big"]], { messages: new Map([[8, card]]), widgets: { answer: () => {}, answered: new Map() } });
    expect(html).toContain("⚡ YOUR MOVE");
    expect(html).toContain("moments-big-card");
    expect(html).toContain("Answer to continue.");
    expect(html).not.toContain("Answer ›"); // the card is inside, not an exit
  });

  it("a fact card (not inline) is an exit: 'Open the card ›'", async () => {
    const card = msg(9, { kind: "widget", channel: "dm:Trabolta", channelKind: "dm", title: "Trabolta", moment: "big", audience: ["g1"], widget: { kind: "fact", text: "📝 File a fact", params: {} } });
    const m = moment(9, { severity: "big", kind: "card", house: false, channel: "dm:Trabolta", text: "📝 File a fact.", card: { seq: 9, kind: "fact", glyph: "📝" } });
    const html = await renderBig([[m, "big"]], { messages: new Map([[9, card]]), widgets: { answer: () => {}, answered: new Map() } });
    expect(html).toContain("📝 Open the card ›");
  });
});

describe("the Notifications window and the bell", () => {
  const messages = new Map<number, ChatMessage>([
    [1, msg(1, { alert: true, moment: "major", text: "📣 Time is up. Return to the Desktop." })],
    [2, msg(2, { moment: "big", readout: true, channel: "dm:Trabolta", channelKind: "dm", from: "Trabolta", audience: ["g1"], text: "🎀 You won a Bingo Ribbon. Take a bow." })],
    [3, msg(3, { notice: "📂", audience: ["g1"], text: "📂 The Start Bar is open now." })],
  ]);

  it("rows newest first, each with ≤ 2 exits and a ✕, never the lobby; the big one IN USE", () => {
    const html = render([], { messages }, createElement(NotificationsWindow));
    expect(html).toContain("🗑 Clear all");
    expect(html).toContain("3 items");
    expect(html.indexOf("You won a Bingo Ribbon.")).toBeLessThan(html.indexOf("Time is up."));
    expect(html).toContain("● IN USE");
    expect(html).toContain("Open Trabolta ›");
    expect(html).toContain("What do I do?");
    expect(html.match(/moments-notif-x/gu)).toHaveLength(3);
    expect(html).not.toContain("Trapped in the Internet");
  });

  it("empty: the Recycle Bin is empty", () => {
    expect(render([], {}, createElement(NotificationsWindow))).toContain("The Recycle Bin is empty. Nothing has interrupted you yet.");
  });

  it("the bell counts the unread rows (a full bin), 'Notifications, n new'", () => {
    const html = render([], { messages }, createElement(BellButton));
    expect(html).toContain('aria-label="Notifications, 3 new"');
    expect(html).toContain("moments-bin-paper");
    expect(html).toContain(">3<");
    expect(render([], {}, createElement(BellButton))).not.toContain("moments-bell-count");
  });

  it("useNotifications exposes the rows' exits", () => {
    function Probe() {
      const n = useNotifications();
      return createElement("i", null, n.rows.map((r) => n.exits(r).map((e) => e.nav.to).join("+")).join("|"));
    }
    expect(render([], { messages }, createElement(Probe))).toBe("<i>mission|room+mission|mission</i>");
  });
});
