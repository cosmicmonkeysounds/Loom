//! Wave 18 (GUEST-SPEC §4, DECISIONS G3, Q3): the Notifications bin — the
//! bell's count, the rows with their exits (never the lobby), ✕ and its
//! gags, Clear all's plan, in use, and the empty bin.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BellButton, bellLabel } from "../src/guest/frame.tsx";
import type { ExitContext } from "../src/guest/moments-bridge.ts";
import { BIG_IN_USE_MS, clearPlan, gagTitle, inUse, notificationsOf, unreadCount, type NotificationRow } from "../src/guest/notification-rows.ts";
import { EMPTY_BIN, NotificationsWindow } from "../src/guest/notifications.tsx";
import { deletedKey, readKey, topSeq, unreadNotes } from "../src/guest/notifications-state.ts";
import { rowClockOf } from "../src/guest/show-time.ts";
import type { ChatMessage } from "../src/types.ts";

const me = { id: "g-1", name: "Winamp" };
const msg = (seq: number, o: Partial<ChatMessage>): ChatMessage => ({ seq, channel: "lobby", channelKind: "lobby", title: "T", from: "", kind: "signal", text: "", ts: seq * 1000, audience: "all", parentSeq: null, hidden: false, ...o });
const row = (seq: number, o: Partial<NotificationRow> = {}): NotificationRow => ({ key: `m:${seq}`, seq, glyph: "📣", title: `Row ${seq}`, caption: "Clippy", rest: "", at: seq * 1000, big: false, moment: null, ...o });

const ctx = (): ExitContext => ({
  listed: new Set(["lobby", "loc:The Desktop", "dm:Trabolta"]),
  titles: new Map([["loc:The Desktop", "The Desktop"]]),
  open: null,
  window: "mission",
  cards: [],
  dms: [],
  actions: new Set(),
  sides: false,
});

describe("the bell (§1.1)", () => {
  it("counts rows past the read mark without building them", () => {
    const list = [
      msg(1, { alert: true, moment: "major", text: "📣 Time is up." }),
      msg(2, { notice: "🎀", text: "🎀 Encarta won.", phase: "bingo" }),
      msg(3, { notice: "🎀", text: "🎀 Excel won.", phase: "bingo" }),
      msg(4, { notice: "📂", text: "📂 The CPU is open now.", audience: ["g-1"], channel: "loc:x" }),
      msg(5, { text: "plain chat" }),
    ];
    expect(unreadNotes(list, me, -1)).toBe(3);
    expect(unreadNotes(list, me, 3)).toBe(1);
    expect(unreadNotes(list, me, 5)).toBe(0);
    expect(topSeq(list)).toBe(5);
    // the same count the window's rows give
    expect(unreadCount(notificationsOf(list, me, "bingo"), -1)).toBe(3);
  });
  it("an empty bin at 0, paper and a count past it, 9+ above nine", () => {
    expect(renderToStaticMarkup(createElement(BellButton, { unread: 0, onOpen: () => {} }))).toContain("ico-bin-empty");
    const two = renderToStaticMarkup(createElement(BellButton, { unread: 2, onOpen: () => {} }));
    expect(two).toContain("ico-bin-full");
    expect(two).toContain(">2<");
    expect(two).toContain('aria-label="Notifications, 2 new"');
    expect(renderToStaticMarkup(createElement(BellButton, { unread: 12, onOpen: () => {} }))).toContain(">9+<");
    expect(bellLabel(0)).toBe("Notifications");
  });
  it("its marks are kept per sign-in", () => {
    expect(readKey("tok")).toBe("loom.notif.read.tok");
    expect(deletedKey("tok")).toBe("loom.notif.deleted.tok");
  });
});

describe("the window (§4.1)", () => {
  const messages = new Map<number, ChatMessage>([
    [1, msg(1, { alert: true, moment: "major", text: "📣 Time is up. Return to the Desktop.", go: [{ kind: "room", id: "loc:The Desktop", label: "" }] } as Partial<ChatMessage>)],
    [2, msg(2, { alert: true, moment: "major", text: "📣 ALL PROGRAMS: stand by." })],
  ]);
  const render = (m: ReadonlyMap<number, ChatMessage>, mark = -1) =>
    renderToStaticMarkup(
      createElement(NotificationsWindow, { messages: m, me, phase: null, deleted: new Set(), mark, now: 10_000, exitContext: ctx, onGo: () => {}, remove: () => {}, markRead: () => {}, view: {} }),
    );

  it("newest first, an unread dot, each row's exits (never the lobby) and ✕", () => {
    const out = render(messages);
    expect(out.indexOf("ALL PROGRAMS")).toBeLessThan(out.indexOf("Time is up."));
    expect(out).toContain("2 items");
    expect(out).toContain("Go to The Desktop ›");
    expect(out).not.toMatch(/Open (Lobby|Trapped)/u);
    expect((out.match(/aria-label="Delete /gu) ?? []).length).toBe(2);
    expect((out.match(/notif unread/gu) ?? []).length).toBe(2);
    expect((render(messages, 5).match(/notif unread/gu) ?? []).length).toBe(0);
  });

  it("the empty bin", () => {
    expect(render(new Map())).toContain(EMPTY_BIN);
  });

  it("a row's time on the show clock", () => {
    const clock = rowClockOf({ clock: 600_000, showClock: { minutes: 1150, running: true } });
    expect(clock(600_000)).toBe("7:10 PM");
    expect(clock(0)).toBe("7:00 PM");
    expect(rowClockOf({})(5)).toBe("");
  });
});

describe("the gags (§4.2)", () => {
  it("an unacknowledged big row is in use for 15 story-minutes", () => {
    const big = row(10, { big: true, at: 1000 });
    expect(inUse(big, -1, 1000 + BIG_IN_USE_MS - 1)).toBe(true);
    expect(inUse(big, -1, 1000 + BIG_IN_USE_MS + 1)).toBe(false);
    expect(inUse(big, 10, 1000)).toBe(false);
    expect(inUse(row(10), -1, 1000)).toBe(false);
  });

  it("Clear all skips what is in use; its outcome is (n + firstSeq) % 3", () => {
    const rows = [row(9), row(8), row(7, { big: true })];
    const used = (r: NotificationRow) => r.big;
    const plan = clearPlan(rows, used);
    expect(plan.targets.map((r) => r.seq)).toEqual([9, 8]);
    expect(plan.outcome).toBe((2 + 9) % 3);
  });

  it("access denied keeps the most frequent caption's rows", () => {
    // n = 3, first = 7 → (3 + 7) % 3 = 1
    const rows = [row(7, { caption: "Clippy" }), row(6, { caption: "Trabolta" }), row(5, { caption: "Clippy" })];
    const plan = clearPlan(rows, () => false);
    expect(plan.outcome).toBe(1);
    expect(plan.caption).toBe("Clippy");
    expect(plan.remove).toEqual(["m:6"]);
  });

  it("all gone and full of beans remove everything they target", () => {
    const zero = clearPlan([row(3), row(2), row(1)], () => false); // (3 + 3) % 3 = 0
    expect(zero.outcome).toBe(0);
    expect(zero.remove).toHaveLength(3);
    const beans = clearPlan([row(4), row(3), row(2)], () => false); // (3 + 4) % 3 = 1 → use 5
    const beans2 = clearPlan([row(5), row(4), row(3)], () => false); // (3 + 5) % 3 = 2
    expect(beans.outcome).toBe(1);
    expect(beans2.outcome).toBe(2);
    expect(beans2.remove).toHaveLength(3);
  });

  it("a title in a dialog is cut at 40 characters", () => {
    expect(gagTitle("x".repeat(41))).toHaveLength(40);
    expect(gagTitle("short")).toBe("short");
  });
});
