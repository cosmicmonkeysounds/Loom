//! Wave 13: one open room — the header as the window's menu row, the
//! ticker, the card tray, the composer only where someone reads it, the
//! thread affordance on typed chat only, the manner after the name.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildGuestChannels, isVoiced } from "../src/session/channels.ts";
import { ChannelView, MessageThread } from "../src/stream/channel-view.tsx";
import { CardTray, trayCardKey, trayIndex, trayShown } from "../src/stream/card-tray.tsx";
import { PlayHostContext, browserHost, createCrawl } from "../src/host.ts";
import { NOBODY_READS_NOTE, cantPostNote } from "../src/stream/composer.tsx";
import { AmbientTicker } from "../src/stream/ticker.tsx";
import type { Channel, ChatMessage, GuestView } from "../src/types.ts";
import { readBundledCss } from "./css.ts";

let seq = 1;
const m = (extra: Partial<ChatMessage>): ChatMessage => ({
  seq: seq++, channel: "lobby", channelKind: "lobby", title: "Lobby", from: "Clippy", kind: "line", text: "Hello, programs.", ts: 0, audience: "all", parentSeq: null, hidden: false, ...extra,
});
const room = (extra: Partial<Channel>): Channel => ({ id: "lobby", kind: "lobby", title: "Trapped in the Internet", spaceId: "story", messages: [], unread: 0, decision: null, lastTs: 0, ...extra });
const widgets = { answer: () => {}, answered: new Map(), viewer: { id: "g1", name: "Ada" } };
const view = (c: Channel, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ChannelView, { channel: c, onBack: () => {}, onSend: () => {}, onOpenThread: () => {}, widgets, ...extra }));

describe("the room header", () => {
  it("a 44 px back button, the title on its own line (never cut to one), 👥 n", () => {
    const html = view(room({ id: "loc:The Desktop", kind: "location", title: "The Desktop (living room)", here: true, people: [{ id: "g1", name: "Ada", kind: "guest", group: null }] }), { onPeople: () => {}, meId: "g1" });
    expect(html).toContain('class="back stream-back"');
    expect(html).toContain('aria-label="Back to your rooms"');
    expect(html).toContain('<strong class="stream-room-title">The Desktop (living room)</strong>');
    expect(html).toContain("you are here");
    expect(html).toMatch(/👥 <\/span>1 · you/u);
    expect(html).not.toContain("presence-stack"); // no avatar strip squeezing the title
  });

  it("wide: no back button", () => {
    expect(view(room({}), { wide: true })).not.toContain("stream-back");
  });
});

describe("the stream", () => {
  it("the 💬 affordance shows on typed chat, not on scripted lines", () => {
    const html = view(room({ messages: [m({ beat: "Bingo", text: "Scripted." }), m({ from: "Bo", text: "typed" })] }));
    expect(html.match(/class="replies/gu)?.length).toBe(1);
  });

  it("the manner rides after the name; effect text carries its look", () => {
    const html = view(room({ messages: [m({ from: "Truther Download", manner: "glitch", fx: true, beat: "B", text: "TRUTH" })] }));
    expect(html).toContain('<span class="stream-manner">glitch</span>');
    expect(html).toContain("stream-fx");
  });

  it("barks go to the ticker, not the stream", () => {
    const html = view(room({ messages: [m({ kind: "narration", from: "", ambient: true, text: "A fan spins up somewhere in the walls." })] }));
    expect(html).toContain("stream-ticker");
    expect(html).toContain("Nothing here yet."); // the stream itself is empty
  });

  it("a live card docks in the tray and leaves a receipt", () => {
    const card = m({ channel: "dm:Trabolta", kind: "widget", from: "Trabolta", text: "", audience: ["g1"], widget: { kind: "poll", text: "Truth or dare?", params: { options: "Truth | Dare" } } });
    const html = view(room({ id: "dm:Trabolta", kind: "dm", title: "Trabolta", messages: [card] }));
    expect(html).toContain("stream-tray");
    expect(html).toContain("📊 Truth or dare? · Trabolta asks · answer it below");
    expect(html.match(/Truth \| Dare|>Truth</gu)?.length).toBe(1); // the options once, in the tray
  });

  it("an answered card is one line; the pass settles in a room", () => {
    const poll = m({ kind: "widget", widget: { kind: "poll", text: "Truth or dare?", params: {} } });
    const pass = m({ kind: "widget", widget: { kind: "pass", text: "Hold this up.", params: {} } });
    const html = view(room({ messages: [poll, pass] }), { widgets: { ...widgets, answered: new Map([[poll.seq, { choice: "Truth" }]]) } });
    expect(html).toContain("📊 Truth or dare? · you chose Truth");
    expect(html).toContain("🎟️ Your pass · tap to show it");
    expect(html).not.toContain("<img"); // no QR in the room
    expect(html).not.toContain("stream-tray");
  });

  it("a run of notices folds into one line", () => {
    const html = view(room({ messages: [m({ kind: "signal", notice: "✅", text: "✅ A ok" }), m({ kind: "signal", notice: "✅", text: "✅ B ok" }), m({ kind: "signal", notice: "🤷", text: "🤷 C guessed" })] }));
    expect(html).toContain("✅ 2 · 🤷 1");
    expect(html).not.toContain("A ok");
  });
});

describe("the composer only where someone reads it", () => {
  const gv = (voiced?: string[]) => ({ id: "g1", name: "Ada", people: [], roster: [], channels: [], spaces: [], voiced }) as unknown as GuestView;
  it("a DM nobody voices has no composer and says so", () => {
    const msgs = new Map([[1, m({ seq: 1, channel: "dm:The Uploader", channelKind: "dm", from: "The Uploader", audience: ["g1"] })], [2, m({ seq: 2, channel: "dm:Trabolta", channelKind: "dm", from: "Trabolta", audience: ["g1"] })]]);
    const chans = buildGuestChannels(msgs, null, gv(["Trabolta", "Clippy"]));
    const uploader = chans.find((c) => c.id === "dm:The Uploader")!;
    const trabolta = chans.find((c) => c.id === "dm:Trabolta")!;
    expect(uploader.canPost).toBe(false);
    expect(trabolta.canPost).toBeUndefined();
    const html = view(uploader);
    expect(html).toContain(NOBODY_READS_NOTE.replace("'", "&#x27;"));
    expect(html).not.toContain("composer-input");
    expect(cantPostNote({ kind: "dm" })).toBe(NOBODY_READS_NOTE);
  });

  it("an older server without `voiced` keeps every composer", () => {
    expect(isVoiced(gv(undefined), "The Uploader")).toBe(true);
    expect(isVoiced(gv(["task_manager"]), "Task Manager")).toBe(true); // folded
    expect(isVoiced(null, "X")).toBe(true);
  });
});

describe("the ticker and the tray on their own", () => {
  it("the ticker shows the newest bark, nothing when there is none", () => {
    const html = renderToStaticMarkup(createElement(AmbientTicker, { messages: [m({ ambient: true, text: "old" }), m({ ambient: true, text: "An LED goes amber." })] }));
    expect(html).toContain("An LED goes amber.");
    expect(html).not.toContain(">old<");
    expect(renderToStaticMarkup(createElement(AmbientTicker, { messages: [m({})] }))).toBe("");
  });

  it("the tray pages through several cards, newest first", () => {
    const a = m({ kind: "widget", widget: { kind: "poll", text: "First?", params: {} } });
    const b = m({ kind: "widget", widget: { kind: "answer", text: "Second?", params: {} } });
    const html = renderToStaticMarkup(createElement(CardTray, { cards: [a, b], widgets, focus: null, onFocus: () => {} }));
    expect(html).toContain("2 of 2");
    expect(html).toContain("Second?");
    expect(html).toContain('aria-label="Previous card"');
    expect(renderToStaticMarkup(createElement(CardTray, { cards: [], widgets, focus: null, onFocus: () => {} }))).toBe("");
  });
});

describe("the footers above the taskbar", () => {
  it("only the room's and the thread's footers drop the bottom safe area; the cutscene's keeps it", () => {
    const css = readBundledCss();
    expect(css).toContain(".app-frame .stream-foot { padding-bottom: 8px; }");
    expect(css).not.toMatch(/\.app-frame footer\b/u);
    expect(css).toMatch(/\.cut-foot \{[^}]*env\(safe-area-inset-bottom\)/u);
    const root = m({ text: "Root" });
    const thread = renderToStaticMarkup(createElement(MessageThread, { channel: room({ messages: [root] }), rootSeq: root.seq, onClose: () => {}, onSend: () => {} }));
    expect(thread).toContain('<footer class="stream-foot">');
    expect(view(room({}))).toContain('<footer class="stream-foot">');
  });
});

describe("the card tray never takes the room over", () => {
  const fact = (extra: Partial<ChatMessage> = {}) =>
    m({ channel: "dm:Trabolta", kind: "widget", widget: { kind: "fact", text: "📝 File a fact", params: { questions: "Q1: Who?" } }, ...extra });
  const tray = (cards: ChatMessage[], host = { ...browserHost, crawl: createCrawl() }) =>
    renderToStaticMarkup(createElement(PlayHostContext.Provider, { value: host }, createElement(CardTray, { cards, widgets, focus: null, onFocus: () => {} })));

  it("a re-dealt fact card is the same card; any other card is its own", () => {
    expect(trayCardKey(fact())).toBe(trayCardKey(fact()));
    const poll = () => m({ kind: "widget", widget: { kind: "poll", text: "?", params: {} } });
    expect(trayCardKey(poll())).not.toBe(trayCardKey(poll()));
  });

  it("opens for a card not seen yet, comes back folded on one you have", () => {
    const host = { ...browserHost, crawl: createCrawl() };
    expect(tray([fact()], host)).toContain("stream-tray-body");
    trayShown(host.crawl).add(trayCardKey(fact()));
    const again = tray([fact()], host); // a later visit, the card re-dealt
    expect(again).not.toContain("stream-tray-body");
    expect(again).toContain('aria-expanded="false"');
    // Another pane (its own host) has seen nothing.
    expect(tray([fact()])).toContain("stream-tray-body");
  });

  it("a focused card that left the tray falls back to the newest, never the oldest", () => {
    const cards = [m({}), m({}), m({})];
    expect(trayIndex(cards, null)).toBe(2);
    expect(trayIndex(cards, cards[0]!.seq)).toBe(0);
    expect(trayIndex(cards, 9999)).toBe(2);
    expect(trayIndex([], null)).toBe(0);
  });

  it("the body is capped at 35vh and the submit row stays out of its scroll", () => {
    const css = readBundledCss();
    expect(css).toMatch(/\.stream-tray-body \{ max-height: 35vh;/u);
    expect(css).toMatch(/\.stream-tray-body \.widget-foot \{ position: sticky; bottom: 0;/u);
  });
});
