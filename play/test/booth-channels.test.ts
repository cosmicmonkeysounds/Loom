// Wave 13 (booth lane): a lean booth sidebar — the staff rooms pinned just
// under the pinned rooms, the Readouts room (readouts the server keeps as
// `dm:<me>` rows, so they survive a history reload), no Scanner row, no
// per-guest rows (but a guest's unread line to the character lists their
// thread under Messages), and the guests' agent threads a host stream carries kept
// out of the sidebar and the feed. The stream reopens when the booth gains
// admin or host.
import { describe, expect, it } from "vitest";

import { boothSidebar, guestAwaitsReply, guestsWaiting, primeStreamUrl } from "../src/booth/model.ts";
import { DIRECTOR, INBOX, STAFF_SPACE, buildPrimeChannels } from "../src/session/prime.ts";
import { groupBySpace } from "../src/rooms/spaces.ts";
import { roomOrder } from "../src/rooms/order.ts";
import { unreadOf } from "../src/stream/badges.ts";
import type { ChatMessage, PrimeView } from "../src/types.ts";

let seq = 0;
function msg(channel: string, audience: string[] | "all", extra: Partial<ChatMessage> = {}): ChatMessage {
  seq += 1;
  return { seq, channel, channelKind: "dm", title: channel, from: "", kind: "line", text: `m${seq}`, ts: seq * 1000, audience, parentSeq: null, hidden: false, ...extra };
}
function view(over: Partial<PrimeView> = {}): PrimeView {
  return {
    character: "Norton Anti-Virus",
    faction: "Antivirus",
    guests: [{ id: "g-1", name: "Ada", faction: null, captured: false, location: null }],
    channels: [
      { id: "room:general", kind: "open", title: "# general", spaceId: "story", member: true, canPost: true, threadable: true },
      { id: "room:hosts", kind: "faction", title: "# hosts", spaceId: "story", member: true, canPost: true, threadable: true },
      { id: "room:quarantine", kind: "faction", title: "# quarantine", spaceId: "story", member: true, canPost: true, threadable: true },
    ],
    spaces: [],
    agents: [{ id: "Trabolta", online: true }],
    codexTotal: 3,
    codex: [],
    questTotal: 1,
    quests: [],
    staffRooms: ["room:hosts", "room:quarantine"],
    ...over,
  } as PrimeView;
}
const store = (list: ChatMessage[]) => new Map(list.map((m) => [m.seq, m]));
const sorted = (list: ReturnType<typeof buildPrimeChannels>) => [...list].sort(roomOrder);

describe("a Run persona's DM (wave 59)", () => {
  const me = "Norton Anti-Virus";
  const dm = (seq: number, audience: ChatMessage["audience"], from = DIRECTOR) => msg(`dm:${me}`, audience, { seq, from, text: `line ${seq}` });
  it("has a thread of its own under no name, the booth's answer in it, and waits on a reply", () => {
    const chans = buildPrimeChannels(store([dm(1, ["p-1"]), msg(`dm:${me}`, ["p-1"], { seq: 2, from: me, text: "Yes?" })]), view());
    const thread = chans.find((c) => c.id === "guest:p-1")!;
    expect(thread).toMatchObject({ kind: "guest", title: DIRECTOR, people: [{ id: "p-1", name: DIRECTOR }] });
    expect(thread.messages.map((m) => m.text)).toEqual(["line 1", "Yes?"]);
    expect(guestAwaitsReply({ ...thread, messages: thread.messages.slice(0, 1), unread: 1 }, me)).toBe(true);
    expect(chans.filter((c) => c.kind === "guest").map((c) => c.id)).toEqual(["guest:g-1", "guest:p-1"]);
  });
  it("two personas, two threads; a line it only received, or a guest's, opens none", () => {
    const two = buildPrimeChannels(store([dm(1, ["p-1"]), dm(2, ["p-2"])]), view());
    expect(two.filter((c) => c.title === DIRECTOR).map((c) => c.id)).toEqual(["guest:p-1", "guest:p-2"]);
    const none = buildPrimeChannels(store([dm(1, ["p-1"], me), dm(2, ["g-1"], "Ada"), dm(3, [`@${me}`]), dm(4, "all")]), view());
    expect(none.filter((c) => c.kind === "guest").map((c) => c.id)).toEqual(["guest:g-1"]);
  });
  it("a director's own pane has the row, so it opens no second thread", () => {
    const chans = buildPrimeChannels(store([dm(1, ["g-1"])]), view());
    expect(chans.filter((c) => c.kind === "guest").map((c) => c.id)).toEqual(["guest:g-1"]);
  });
});

describe("the booth sidebar", () => {
  it("pins the staff rooms just under the pinned rooms, marked staff", () => {
    const chans = buildPrimeChannels(store([]), view());
    const hosts = chans.find((c) => c.id === "room:hosts")!;
    expect(hosts).toMatchObject({ spaceId: STAFF_SPACE, staff: true, subtitle: "staff only" });
    expect(chans.find((c) => c.id === "room:general")).toMatchObject({ spaceId: "story" });
    expect(chans.find((c) => c.id === "room:general")!.staff).toBeUndefined();
    const spaces = boothSidebar(groupBySpace(sorted(chans)));
    expect(spaces.map((s) => s.id)).toEqual(["pinned", "staff", "booth", "story", "cast"]);
    expect(spaces[1]!.title).toBe("Staff");
    expect(spaces[1]!.channels.map((c) => c.id)).toEqual(["room:hosts", "room:quarantine"]);
  });

  it("lists no Scanner row and no per-guest rows, though both stay reachable", () => {
    const chans = buildPrimeChannels(store([msg("dm:Norton Anti-Virus", ["g-1"])]), view());
    expect(chans.some((c) => c.id === "__scanner")).toBe(true); // a `?room=scanner` link still resolves
    expect(chans.some((c) => c.id === "guest:g-1")).toBe(true); // the card's 💬 opens it
    const rows = boothSidebar(groupBySpace(sorted(chans))).flatMap((s) => s.channels.map((c) => c.id));
    expect(rows).not.toContain("__scanner");
    expect(rows).not.toContain("guest:g-1");
    expect(rows).toContain(INBOX);
  });

  it("lists a guest's thread under Messages while it holds an unread line the guest typed to this character", () => {
    const me = "Norton Anti-Virus";
    const list = [msg(`dm:${me}`, ["g-1"], { from: me, text: "Welcome." }), msg(`dm:${me}`, ["g-1"], { from: "Ada", text: "Help, I'm stuck at the door!" })];
    const chans = buildPrimeChannels(store(list), view());
    // Unread as the threads state lays it over the channels (nothing read yet).
    const withUnread = chans.map((c) => ({ ...c, unread: c.messages.length }));
    const spaces = boothSidebar(groupBySpace(sorted(withUnread)), { character: me });
    expect(spaces.map((s) => s.id)).toEqual(["pinned", "staff", "booth", "guests", "story", "cast"]);
    const messages = spaces.find((s) => s.id === "guests")!;
    expect(messages.title).toBe("Messages");
    expect(messages.channels.map((c) => c.id)).toEqual(["guest:g-1"]);
    // Read (only the story's own line past the mark): the row folds away again …
    const read = chans.map((c) => ({ ...c, unread: 0 }));
    expect(boothSidebar(groupBySpace(sorted(read)), { character: me }).flatMap((s) => s.channels.map((c) => c.id))).not.toContain("guest:g-1");
    // … unless it is the room open now.
    expect(boothSidebar(groupBySpace(sorted(read)), { character: me, activeId: "guest:g-1" }).flatMap((s) => s.channels.map((c) => c.id))).toContain("guest:g-1");
    // A story line alone, or the guest's line to another character, never lists it.
    const story = buildPrimeChannels(store([msg(`dm:${me}`, ["g-1"], { from: me }), msg("dm:Trabolta", ["g-1"], { from: "Ada" })]), view()).map((c) => ({ ...c, unread: c.messages.length }));
    expect(boothSidebar(groupBySpace(sorted(story)), { character: me }).flatMap((s) => s.channels.map((c) => c.id))).not.toContain("guest:g-1");
  });

  it("lists the thread from the real unread rule: a guest's typed line carries the guest as its audience", () => {
    const me = "Norton Anti-Virus";
    const booth = { id: me, name: me, booth: true };
    // As the server stores it: `{channel: 'dm:<C>', from: <guest>, audience: [<guest id>]}`, no beat.
    const list = [msg(`dm:${me}`, ["g-1"], { from: me, text: "Welcome.", beat: "Clearance" }), msg(`dm:${me}`, ["g-1"], { from: "Ada", text: "Help, I'm stuck at the door!" })];
    const chans = buildPrimeChannels(store(list), view()).map((c) => ({ ...c, unread: unreadOf(c, -1, booth) }));
    expect(chans.find((c) => c.id === "guest:g-1")?.unread).toBe(1);
    const rows = boothSidebar(groupBySpace(sorted(chans)), { character: me }).flatMap((s) => s.channels.map((c) => c.id));
    expect(rows).toContain("guest:g-1");
    // The 🗂 Guests badge counts the guests waiting, not the head count.
    expect(guestsWaiting(chans, me)).toBe(1);
    expect(guestsWaiting(chans, "")).toBe(0);
    // Read past it: the row folds away.
    const read = buildPrimeChannels(store(list), view()).map((c) => ({ ...c, unread: unreadOf(c, list[1]!.seq, booth) }));
    expect(boothSidebar(groupBySpace(sorted(read)), { character: me }).flatMap((s) => s.channels.map((c) => c.id))).not.toContain("guest:g-1");
    expect(guestsWaiting(read, me)).toBe(0);
  });

  it("keeps a guest's waiting line listed when the story speaks to them after it", () => {
    const me = "Norton Anti-Virus";
    const booth = { id: me, name: me, booth: true };
    // The guest types to Norton, then the story sends the guest a lobby line
    // and Norton's own scripted line: the thread's tail is not the guest's.
    const list = [
      msg(`dm:${me}`, ["g-1"], { from: "Ada", text: "Help, I'm stuck at the door!" }),
      msg("lobby", ["g-1"], { channelKind: "lobby", from: "Narrator", kind: "narration", text: "The lights flicker.", beat: "Glitch" }),
      msg(`dm:${me}`, ["g-1"], { from: me, text: "Scanning.", beat: "Clearance" }),
    ];
    const chans = buildPrimeChannels(store(list), view()).map((c) => ({ ...c, unread: unreadOf(c, -1, booth) }));
    expect(chans.find((c) => c.id === "guest:g-1")?.unread).toBe(1);
    expect(boothSidebar(groupBySpace(sorted(chans)), { character: me }).flatMap((s) => s.channels.map((c) => c.id))).toContain("guest:g-1");
    expect(guestsWaiting(chans, me)).toBe(1);
  });

  it("keeps a guest's Trabolta thread (a host stream carries it) out of the sidebar and the feed", () => {
    const list = [msg("dm:Trabolta", ["g-1"], { from: "Ada", text: "hi" }), msg("dm:Trabolta", "all", { from: "Trabolta", text: "Speak." }), msg("lobby", "all", { text: "Doors open." })];
    const chans = buildPrimeChannels(store(list), view());
    expect(chans.find((c) => c.id === "__feed")!.messages.map((m) => m.text)).toEqual(["Doors open."]);
    // The private Cast line holds only this booth's own `@me` rows.
    expect(chans.find((c) => c.id === "cast:Trabolta")!.messages).toEqual([]);
    const rows = boothSidebar(groupBySpace(sorted(chans))).flatMap((s) => s.channels);
    expect(rows.some((c) => c.messages.some((m) => m.text === "hi"))).toBe(false);
  });
});

describe("Readouts", () => {
  it("holds the readouts the server keeps as `dm:<me>` rows, newest as its subtitle — and a history reload rebuilds them", () => {
    const me = "Norton Anti-Virus";
    const history = [
      msg(`dm:${me}`, [`@${me}`], { kind: "narration", readout: true, about: "g-1", text: "✅ Cleared Ada." }),
      msg(`dm:${me}`, [`@${me}`], { kind: "narration", readout: true, text: "📋 The late list: Bob." }),
      msg(`dm:${me}`, ["g-1"], { text: "a guest's own thread" }),
    ];
    // A reload is just the history again, into a fresh store.
    for (const s of [store(history), store([...history].reverse())]) {
      const readouts = buildPrimeChannels(s, view()).find((c) => c.id === INBOX)!;
      expect(readouts).toMatchObject({ title: "Readouts", subtitle: "📋 The late list: Bob." });
      expect(readouts.messages.map((m) => m.text)).toEqual(["✅ Cleared Ada.", "📋 The late list: Bob."]);
      expect(readouts.messages[0]!.about).toBe("g-1");
    }
  });
});

describe("the booth stream URL", () => {
  it("carries the capabilities, so gaining admin or host reopens the stream", () => {
    const base = "/e/default";
    const plain = primeStreamUrl(base, { token: "t k", admin: false });
    expect(plain).toBe("/e/default/events?role=prime&token=t%20k");
    expect(primeStreamUrl(base, { token: "t k", admin: false, host: true })).toBe(`${plain}&cap=h`);
    expect(primeStreamUrl(base, { token: "t k", admin: true, host: true })).toBe(`${plain}&cap=ah`);
    expect(primeStreamUrl(base, null)).toBeNull();
  });
});
