//! Wave 18b (R12, D18): `lobby: hidden` takes the 📜 Chat log row off a
//! guest's phone. The lobby still carries a guest's own readouts, house
//! broadcasts and "all" notices, so every lobby line a guest can receive
//! must still reach them as a moment or a Notifications row — proven here
//! over the lines core's own `composeGuestMessages` writes — and a link to
//! the lobby opens Notifications.

import { describe, expect, it } from "vitest";

import { Sim } from "../../core/src/runtime/sim/index.ts";
import { composeGuestMessages } from "../../core/server/chat.ts";
import { guestView } from "../../core/server/views.ts";
import { lobbyHidden } from "../src/guest/wire.ts";
import { planGo } from "../src/guest/nav.ts";
import { lobbyNav, navFromRoom, navFromSearch, navOfTarget } from "../src/moments/exits.ts";
import { momentOf, type Viewer } from "../src/moments/model.ts";
import { notificationGroups, unreadOf } from "../src/moments/notifications-count.ts";
import { chatSections, chatsDot, guestDot } from "../src/rooms/chats.ts";
import type { Channel, ChatMessage, GuestView } from "../src/types.ts";

const SOURCE = `# The Lobby Test
lobby: hidden
start: Boot

LOCATION Hall
  label: The Hall
  hidden: true

ROLE Guest
  when ping for guest:
    reply 📍 Your own readout.
  when loud for guest:
    reply !Your loud readout.

when bulletin:
  broadcast "The bar is open." to everyone
when siren:
  broadcast "!Come to the Hall." to everyone
when ribbon:
  broadcast "~🎀 Someone won a ribbon." to everyone
when shrug:
  reply The house has nothing to say.
when unveil:
  reveal Hall
when flicker:
  -> Nowhere
when greet:
  Clippy: Welcome to the house!

CHARACTER Clippy

== Boot
The lights come up on the house.

== Nowhere
The lights flicker.
`;

/** Every lobby line the guest receives, as the phone sees it. */
function lobbyLines(): ChatMessage[] {
  const sim = Sim.fromSources(SOURCE);
  sim.createPerson("g1", "Ada");
  let seq = 1;
  const out: ChatMessage[] = [];
  const take = (events: Parameters<typeof composeGuestMessages>[1]) => {
    for (const d of composeGuestMessages(sim, events)) {
      const m = { ...d, seq: seq++, hidden: false } as ChatMessage;
      if (m.channel !== "lobby") continue;
      if (m.audience !== "all" && !m.audience.includes("g1")) continue;
      out.push(m);
    }
  };
  take(sim.fireBeat("Boot"));
  take(sim.signal("ping", "g1"));
  take(sim.signal("loud", "g1"));
  for (const e of ["bulletin", "siren", "ribbon", "shrug", "unveil", "flicker", "greet"]) take(sim.signal(e));
  return out;
}

const viewer: Viewer = { role: "guest", me: "g1", lobbyHidden: true };

describe("the lobby hidden from guests", () => {
  it("the view says so, and the wire reads it", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.createPerson("g1", "Ada");
    const v = guestView(sim, "g1") as unknown as GuestView;
    expect(v.lobby).toBe("hidden");
    expect(lobbyHidden(v)).toBe(true);
  });

  it("every lobby line a guest can receive still reaches them, as a moment or a Notifications row", () => {
    const lines = lobbyLines();
    const texts = lines.map((m) => m.text);
    // Every kind is in the sample: narration with no setting, both
    // readouts, a plain and a `!` broadcast, a `~` notice, an unaddressed
    // reply, a house "open now" notice.
    for (const want of [/lights come up/u, /Your own readout/u, /Your loud readout/u, /bar is open/u, /Come to the Hall/u, /won a ribbon/u, /nothing to say/u, /open now/u, /lights flicker/u, /Welcome to the house/u]) {
      expect(texts.some((t) => want.test(t)), String(want)).toBe(true);
    }
    const groups = notificationGroups(lines, viewer, null, new Set());
    const rowed = new Set(groups.flatMap((g) => g.members));
    for (const m of lines) {
      const reached = momentOf(m, viewer, null) !== null || rowed.has(m.seq);
      expect(reached, m.text).toBe(true);
    }
    // Without the flag (a story that keeps its lobby), the plain lines stay
    // in the Chat log only, as before.
    const kept = notificationGroups(lines, { role: "guest", me: "g1" }, null, new Set());
    expect(kept.length).toBeLessThan(groups.length);
  });

  it("typed chat in the lobby (a booth's, another guest's) is never a Notifications row", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.createPerson("g1", "Ada");
    sim.createPerson("g2", "Bob");
    let seq = 1;
    const lines = composeGuestMessages(sim, sim.say("g2", "lobby", "anyone seen the bar?"))
      .map((d) => ({ ...d, seq: seq++, hidden: false }) as ChatMessage)
      .filter((m) => m.channel === "lobby");
    expect(lines.length).toBe(1);
    expect(notificationGroups(lines, viewer, null, new Set())).toEqual([]);
  });

  it("the lobby's lines never ring the bell; its moments still do", () => {
    const lines = lobbyLines();
    const groups = notificationGroups(lines, viewer, null, new Set());
    const quiet = groups.filter((g) => g.quiet === true);
    expect(quiet.length).toBeGreaterThan(0);
    expect(unreadOf(quiet, new Set(), 0)).toBe(0);
    expect(unreadOf(groups, new Set(), 0)).toBe(groups.length - quiet.length);
  });

  it("no 📜 Chat log row in Chats, and the lobby's unread never badges", () => {
    const lobby = { id: "lobby", kind: "lobby", title: "Chat log", messages: [], unread: 5 } as unknown as Channel;
    const room = { id: "loc:Hall", kind: "location", title: "The Hall", messages: [], unread: 0, here: true } as unknown as Channel;
    const hidden = chatSections([lobby, room], { now: 0, cardRooms: new Set(), lobbyHidden: true });
    expect([...hidden.sections.flatMap((s) => s.channels), ...hidden.other].map((c) => c.id)).toEqual(["loc:Hall"]);
    expect(chatsDot(hidden)).toBe(false);
    expect(guestDot(lobby)).toBe(false);
    const shown = chatSections([lobby, room], { now: 0, cardRooms: new Set() });
    expect(shown.other.map((c) => c.id)).toEqual(["lobby"]);
  });

  it("a push, an exit or a link naming the lobby opens Notifications (Mission while the lobby is shown)", () => {
    expect(lobbyNav(true)).toEqual({ to: "notifications" });
    expect(lobbyNav(false)).toEqual({ to: "mission" });
    expect(navFromRoom("lobby", ["lobby"], true)).toEqual({ to: "notifications" });
    expect(navFromRoom("lobby", ["lobby"])).toEqual({ to: "mission" });
    expect(navFromSearch("?room=lobby", ["lobby"], true)).toEqual({ to: "notifications" });
    expect(navOfTarget({ kind: "room", id: "lobby" } as never, { listed: new Set(["lobby"]), actions: new Set(), sides: false, lobbyHidden: true })).toEqual({ to: "notifications" });
    const ctx = { listed: new Set(["lobby"]), window: "mission" as const, actions: new Set<string>(), questRoots: new Map<string, number>() };
    expect(planGo({ to: "room", id: "lobby" }, { ...ctx, lobbyHidden: true })).toEqual({ window: "notifications", room: null });
    expect(planGo({ to: "room", id: "lobby" }, ctx)).toEqual({ window: "mission", room: null });
    // A card a rule dealt into the hidden lobby stays answerable from its own nav.
    expect(planGo({ to: "room", id: "lobby", focusSeq: 7 }, { ...ctx, lobbyHidden: true })).toEqual({ window: "mission", room: { id: "lobby", focusSeq: 7 } });
  });
});
