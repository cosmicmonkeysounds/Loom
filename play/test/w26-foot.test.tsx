//! Wave 26 (P1): the fact card and a story menu never squish the chat. One
//! answer surface at a time: a docked menu opens first and the composer
//! folds to a 48 px "⌨ Message …" bar; typing folds the menu; an open card
//! folds the menu. The thread keeps ≥ 96 px, the footer ≤ 62 %, the card's
//! body ≤ 34 dvh, the menu's options ≤ 36 dvh, every footer button ≥ 48 px.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChannelView, DecisionTray, footLayout } from "../src/stream/channel-view.tsx";
import { CardTray } from "../src/stream/card-tray.tsx";
import { Composer } from "../src/stream/composer.tsx";
import type { Channel, ChatMessage, Decision } from "../src/types.ts";
import { readBundledCss } from "./css.ts";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
let seq = 100;
const m = (extra: Partial<ChatMessage>): ChatMessage => ({ seq: seq++, channel: "dm:Trabolta", channelKind: "dm", title: "Trabolta", from: "Trabolta", kind: "line", text: "Well?", ts: 0, audience: ["g1"], parentSeq: null, hidden: false, ...extra }) as ChatMessage;
const menu: Decision = { title: "What do you say?", options: [{ label: "The truth", onClick: () => {} }, { label: "A lie", onClick: () => {} }, { label: "Nothing", onClick: () => {} }] } as Decision;
const room = (extra: Partial<Channel>): Channel => ({ id: "dm:Trabolta", kind: "dm", title: "Trabolta", spaceId: "story", messages: [m({})], unread: 0, decision: null, lastTs: 0, ...extra }) as Channel;
const widgets = { answer: () => {}, answered: new Map(), viewer: { id: "g1", name: "Ada" } };
const fact = () => m({ kind: "widget", text: "", widget: { kind: "poll", text: "📝 File a fact", params: { options: "A | B" } } } as Partial<ChatMessage>);
const view = (c: Channel) => renderToStaticMarkup(createElement(ChannelView, { channel: c, onBack: () => {}, onSend: () => {}, widgets }));

describe("footLayout: one answer surface at a time", () => {
  const L = (decision: boolean, trayOpen: boolean, typing: boolean, composer = true) => footLayout({ decision, trayOpen, typing, composer });
  it("no menu: the composer is open, whatever the tray", () => {
    expect(L(false, false, false)).toEqual({ decision: null, composer: "open" });
    expect(L(false, true, false)).toEqual({ decision: null, composer: "open" });
    expect(L(false, true, true)).toEqual({ decision: null, composer: "open" });
  });
  it("a docked menu opens; the composer folds to its button", () => {
    expect(L(true, false, false)).toEqual({ decision: "open", composer: "button" });
  });
  it("typing folds the menu and opens the composer", () => {
    expect(L(true, false, true)).toEqual({ decision: "folded", composer: "open" });
    expect(L(true, true, true)).toEqual({ decision: "folded", composer: "open" });
  });
  it("an open card folds the menu (and the composer stays a button)", () => {
    expect(L(true, true, false)).toEqual({ decision: "folded", composer: "button" });
  });
  it("a room you can't post in has no composer either way", () => {
    expect(L(true, false, false, false)).toEqual({ decision: "open", composer: null });
    expect(L(false, false, false, false)).toEqual({ decision: null, composer: null });
  });
});

describe("the room's footer", () => {
  it("a docked menu shows its options; the composer is the one-line ⌨ bar", () => {
    const html = view(room({ decision: menu }));
    expect(html).toContain("The truth");
    expect(html).toContain("composer-open");
    expect(html).toContain("⌨ Message Trabolta…");
    expect(html).not.toContain("composer-input");
    // The folded composer still wears .composer: the balloon's :has(.composer) lift holds.
    expect(html).toMatch(/class="composer composer-folded"/u);
  });
  it("no menu: the usual composer", () => {
    const html = view(room({}));
    expect(html).toContain("composer-input");
    expect(html).not.toContain("composer-open");
  });
  it("a menu and a new 📝 card: the menu opens first, the card waits folded", () => {
    const html = view(room({ decision: menu, messages: [m({}), fact()] }));
    expect(html).toContain("The truth");
    expect(html).toMatch(/class="stream-tray "/u); // folded (no " open")
    expect(html).not.toContain("stream-tray-body");
  });
  it("without a menu a new card opens as before", () => {
    const html = view(room({ messages: [m({}), fact()] }));
    expect(html).toContain("stream-tray open");
  });
  it("the folded menu is one loud bar that names it", () => {
    const html = renderToStaticMarkup(createElement(DecisionTray, { decision: menu, folded: true, onUnfold: () => {} }));
    expect(html).toContain("dlg-folded");
    expect(html).toContain("▴ Your move: What do you say?");
    expect(html).not.toContain("dlg-choice");
  });
});

describe("the card tray when crowded", () => {
  it("a new card starts folded while a menu is docked, open when a Mission jump asked for it", () => {
    const c = fact();
    expect(renderToStaticMarkup(createElement(CardTray, { cards: [c], widgets, focus: null, onFocus: () => {}, crowded: true }))).not.toContain("stream-tray open");
    expect(renderToStaticMarkup(createElement(CardTray, { cards: [c], widgets, focus: c.seq, onFocus: () => {}, crowded: true }))).toContain("stream-tray open");
  });
});

describe("the composer keeps a half-typed line", () => {
  it("starts from the draft it is given and reports every change", () => {
    const html = renderToStaticMarkup(createElement(Composer, { onSend: () => {}, initial: "I was in the kit", onText: () => {} }));
    expect(html).toContain(">I was in the kit</textarea>");
  });
  it("the room holds the draft per room and shows it on the folded bar; the unfold tap mounts the box focused (flushSync)", () => {
    const cv = src("stream/channel-view.tsx");
    expect(cv).toMatch(/if \(draft\.current\.room !== channel\.id\) draft\.current = \{ room: channel\.id, text: "" \};/u);
    expect(cv).toMatch(/onClick=\{\(\) => flushSync\(\(\) => setTyping\(true\)\)\}/u);
    expect(cv).toMatch(/initial=\{draft\.current\.text\} onText=\{onText\} autoFocus=\{typing\}/u);
    expect(src("stream/composer.tsx")).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(autoFocus === true\) ref\.current\?\.focus\(\);/u);
  });
});

describe("the height budget (CSS)", () => {
  const css = readBundledCss().replace(/\/\*[\s\S]*?\*\//gu, "");
  it("the thread keeps 96 px; the footer ≤ 62 % and scrolls itself", () => {
    expect(css).toMatch(/\.stream-room > \.thread \{ min-height: 96px; \}/u);
    expect(css).toMatch(/\.stream-room > \.stream-foot \{ flex: 0 1 auto; min-height: 0; max-height: 62%; overflow-y: auto;/u);
  });
  it("the card body ≤ 34 dvh, the options ≤ 36 dvh (vh first, for old browsers)", () => {
    expect(css).toMatch(/\.stream-foot \.stream-tray-body \{ max-height: 34vh; max-height: 34dvh; \}/u);
    expect(css).toMatch(/\.stream-foot \.dlg-options \{ max-height: 36vh; max-height: 36dvh; overflow-y: auto;/u);
  });
  it("every footer button is ≥ 48 px; the key hint goes on a phone", () => {
    expect(css).toMatch(/\.stream-foot \.dlg-choice, \.stream-foot \.fact-questions \.choice \{ min-height: 48px; \}/u);
    expect(css).toMatch(/\.stream-foot \.stream-tray-title, \.stream-foot \.stream-tray-step \{ min-height: 48px; \}/u);
    expect(css).toMatch(/\.stream-foot \.composer \.composer-send, \.stream-foot \.composer \.composer-scan \{ height: 48px; min-height: 48px; \}/u);
    expect(css).toMatch(/\.stream-foot \.tray\.dialogue\.dlg-folded \{[^}]*min-height: 48px;/u);
    expect(css).toMatch(/\.stream-foot \.composer-folded \.composer-open \{[^}]*min-height: 48px;/u);
    expect(css).toMatch(/@media \(pointer: coarse\) \{ \.stream-foot \.dlg-hint \{ display: none; \} \}/u);
  });
});
