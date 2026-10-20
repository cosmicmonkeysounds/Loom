// Wave 13 (booth lane): a lean booth sidebar — the staff rooms pinned just
// under the pinned rooms, the Readouts room (readouts the server keeps as
// `dm:<me>` rows, so they survive a history reload), no Scanner row, no
// per-guest rows, and the guests' agent threads a host stream carries kept
// out of the sidebar and the feed. The stream reopens when the booth gains
// admin or host.
import { describe, expect, it } from "vitest";

import { boothSidebar, primeStreamUrl } from "../src/booth/model.ts";
import { INBOX, STAFF_SPACE, buildPrimeChannels } from "../src/session/prime.ts";
import { groupBySpace } from "../src/rooms/spaces.ts";
import { roomOrder } from "../src/rooms/order.ts";
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

describe("the booth sidebar", () => {
  it("pins the staff rooms just under the pinned rooms, marked staff", () => {
    const chans = buildPrimeChannels(store([]), view());
    const hosts = chans.find((c) => c.id === "room:hosts")!;
    expect(hosts).toMatchObject({ spaceId: STAFF_SPACE, staff: true });
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
