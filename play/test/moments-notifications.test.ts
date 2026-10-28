//! Wave 18, the moments lane (GUEST-SPEC §4.1, the user's Q3): the
//! Notifications rows — every moment, every personal `~` notice, the house
//! notices folded per glyph + phase, newest first; unread, in use, deleted.

import { describe, expect, it } from "vitest";
import type { Viewer } from "../src/moments/model.ts";
import { NOTIFICATIONS_MAX, bellCount, deleteKeys, isUnread, notificationsOf, unreadOf } from "../src/moments/notifications.ts";
import type { ChatMessage } from "../src/types.ts";

const guest: Viewer = { role: "guest", me: "g1" };
function msg(seq: number, over: Partial<ChatMessage> & Record<string, unknown> = {}): ChatMessage {
  return { seq, channel: "lobby", channelKind: "lobby", title: "Trapped in the Internet", from: "", kind: "signal", text: `moment ${seq}`, ts: seq * 1000, audience: "all", parentSeq: null, hidden: false, ...over } as ChatMessage;
}
const none = new Set<string>();

describe("the rows", () => {
  it("every moment for this guest and every personal `~` notice, newest first; plain lines are not rows", () => {
    const list = [
      msg(1, { alert: true, moment: "major", text: "📣 Report to the Desktop. A game is about to begin." }),
      msg(2, { kind: "line", text: "Hello there." }),
      msg(3, { notice: "📂", text: "📂 The Start Bar is open now.", audience: ["g1"] }),
      msg(4, { moment: "big", readout: true, channel: "dm:Clippy", from: "Clippy", text: "🎀 You won a Bingo Ribbon. Take a bow.", audience: ["g1"] }),
      msg(5, { notice: "📂", text: "📂 Someone else's.", audience: ["g2"] }),
    ];
    const rows = notificationsOf(list, guest, null, none, none);
    expect(rows.map((r) => r.key)).toEqual(["m:4", "m:3", "m:1"]);
    expect(rows[0]).toMatchObject({ glyph: "🎀", title: "You won a Bingo Ribbon.", rest: "Take a bow.", caption: "Clippy", big: true, inUse: true });
    expect(rows[2]).toMatchObject({ title: "Report to the Desktop.", rest: "A game is about to begin.", caption: "Announcement", house: true, big: false });
  });

  it("house `~` notices fold into one row per glyph + phase; a lone one stays itself", () => {
    const list = [
      msg(1, { notice: "🎀", text: "🎀 Encarta won a ribbon.", phase: "bingo" }),
      msg(2, { notice: "🎀", text: "🎀 ICQ won a ribbon.", phase: "bingo" }),
      msg(3, { notice: "🎀", text: "🎀 Winamp won a ribbon.", phase: "hunt" }),
      msg(4, { notice: "✅", text: "✅ Netscape was cleared.", phase: "bingo" }),
    ];
    const rows = notificationsOf(list, guest, null, none, none);
    const fold = rows.find((r) => r.folded !== undefined)!;
    expect([fold.key, fold.title, fold.members, fold.glyph]).toEqual(["n:🎀:bingo", "2 updates about others", [1, 2], "🎀"]);
    expect(rows.filter((r) => r.folded === undefined).map((r) => r.key).sort()).toEqual(["m:3", "m:4"]);
  });

  it("deleted rows (and a fold's deleted members) leave; a later member brings the fold back", () => {
    const list = [msg(1, { notice: "🎀", text: "🎀 a" }), msg(2, { notice: "🎀", text: "🎀 b" }), msg(3, { alert: true, moment: "major" })];
    const rows = notificationsOf(list, guest, null, none, none);
    const deleted = new Set(rows.flatMap((r) => deleteKeys(r)));
    expect(notificationsOf(list, guest, null, deleted, none)).toEqual([]);
    const later = [...list, msg(4, { notice: "🎀", text: "🎀 c" })];
    expect(notificationsOf(later, guest, null, deleted, none).map((r) => r.key)).toEqual(["m:4"]);
  });

  it("an acknowledged big is no longer in use; the client-made moments (a loud objective) are rows too", () => {
    const list = [msg(1, { moment: "big", readout: true, audience: ["g1"] })];
    expect(notificationsOf(list, guest, null, none, new Set(["m:1"]))[0]?.inUse).toBe(false);
    const extra = [{ key: "o:pass", seq: null, severity: "major" as const, kind: "objective" as const, caption: "New objective", text: "Show your pass", channel: null, at: 5_000, phase: null }];
    expect(notificationsOf(list, guest, null, none, none, extra).map((r) => r.key)).toEqual(["o:pass", "m:1"]);
  });

  it("capped at the newest 200", () => {
    const list = Array.from({ length: NOTIFICATIONS_MAX + 20 }, (_, i) => msg(i + 1, { alert: true, moment: "major", text: `📣 ${i}` }));
    const rows = notificationsOf(list, guest, null, none, none);
    expect(rows).toHaveLength(NOTIFICATIONS_MAX);
    expect(rows[0]?.seq).toBe(NOTIFICATIONS_MAX + 20);
  });
});

describe("unread and the bell", () => {
  it("unread = never seen on screen, and newer than the window's last read", () => {
    const rows = notificationsOf([msg(1, { alert: true, moment: "major" }), msg(2, { alert: true, moment: "major" }), msg(3, { alert: true, moment: "major" })], guest, null, none, none);
    expect(unreadOf(rows, none, -1)).toBe(3);
    expect(unreadOf(rows, new Set(["m:3"]), -1)).toBe(2);
    expect(unreadOf(rows, none, 2)).toBe(1);
    expect(isUnread({ key: "o:x", members: [] }, none, 99)).toBe(true);
    expect(isUnread({ key: "o:x", members: [] }, new Set(["o:x"]), 99)).toBe(false);
  });

  it("the bell reads nothing at 0 and 9+ above nine", () => {
    expect([bellCount(0), bellCount(3), bellCount(9), bellCount(10)]).toEqual(["", "3", "9", "9+"]);
  });
});
