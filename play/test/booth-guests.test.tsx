// Wave 18 (booth lane): 🗂 Guests' tabs, its one status tag and place-first
// rows (BOOTH-SPEC §4.11); the rooms list's "Chats" header and the lobby
// demoted to the far-away 📜 Chat log (§3, G2).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CHAT_LOG_TITLE, defaultGuestTab, defaultHere, guestSort, guestTab, hasMissingTab, loudLine, placeLine, statusTag, withChatLog, type GuestListCtx } from "../src/booth/model.ts";
import { GuestsSheet, summonsPick } from "../src/booth/guests.tsx";
import { boothHome } from "../src/booth/app.tsx";
import { CHATS_TITLE, INBOX, buildPrimeChannels } from "../src/session/prime.ts";
import { groupBySpace } from "../src/rooms/spaces.ts";
import { foldRooms, roomOrder } from "../src/rooms/order.ts";
import type { Channel, PrimeGuest, PrimeView } from "../src/types.ts";

const g = (id: string, extra: Partial<PrimeGuest> & { lastSeen?: number | null } = {}): PrimeGuest => ({ id, name: id, faction: null, captured: false, location: "Desktop", ...extra });
const wanted = [
  { id: "enc", captured: false, claimedBy: "Norton", reason: "refused the truth", lastSeen: 0 },
  { id: "nap", captured: false, claimedBy: null, reason: "filed a guess", lastSeen: 0 },
  { id: "icq", captured: false, claimedBy: "McAfee", reason: null, lastSeen: 0 },
  { id: "gone", captured: true, claimedBy: "Norton", reason: null, lastSeen: 0 },
];
const ctx = (extra: Partial<GuestListCtx> = {}): GuestListCtx => ({ wanted, me: "Norton", now: 30 * 60_000, wall: 30 * 60_000, summons: null, ...extra });

describe("🗂 Guests (§4.11)", () => {
  const list = [g("winamp"), g("enc"), g("nap", { location: "Cloud" }), g("icq"), g("gone", { captured: true, location: "Internet" }), g("bath", { flags: [{ label: "Bathroom Mode", path: "p", value: "true", on: true }] })];
  it("tabs: Here (the room), Marked (loose), Internet (caught), All", () => {
    const c = ctx();
    expect(list.filter((x) => guestTab(x, "here", c, "Desktop")).map((x) => x.id)).toEqual(["winamp", "enc", "icq", "bath"]);
    expect(list.filter((x) => guestTab(x, "marked", c, null)).map((x) => x.id)).toEqual(["enc", "nap", "icq"]);
    expect(list.filter((x) => guestTab(x, "internet", c, null)).map((x) => x.id)).toEqual(["gone"]);
    expect(list.filter((x) => guestTab(x, "all", c, null))).toHaveLength(list.length);
  });
  it("Missing: the summons' pick while it runs, else ten minutes unseen (A1); no tab without either", () => {
    expect(list.filter((x) => guestTab(x, "missing", ctx({ summons: ["winamp"] }), null)).map((x) => x.id)).toEqual(["winamp"]);
    const seen = [g("a", { lastSeen: 29 * 60_000 }), g("b", { lastSeen: 5 * 60_000 }), g("c", { lastSeen: null })];
    expect(seen.filter((x) => guestTab(x, "missing", ctx({ wanted: null }), null)).map((x) => x.id)).toEqual(["b", "c"]);
    expect(hasMissingTab(list, ctx({ wanted: null }))).toBe(false);
    expect(hasMissingTab(seen, ctx())).toBe(true);
    expect(hasMissingTab(list, ctx({ summons: [] }))).toBe(true);
  });
  it("lastSeen is wall-clock ms: compared with the wall clock, never story ms (BN-F5 / A2 / M1)", () => {
    const wall = 1_792_563_218_449; // a real epoch stamp off the server
    const real = ctx({ now: 1_192_000, wall, wanted: null });
    const idle = g("nav", { lastSeen: wall - 17 * 60_000 });
    expect(placeLine(idle, "The Desktop", real)).toBe("📍 The Desktop · seen 17 min ago");
    expect(guestTab(idle, "missing", real, null)).toBe(true);
    expect(guestTab(g("fresh", { lastSeen: wall - 30_000 }), "missing", real, null)).toBe(false);
  });
  it("one status tag: MARKED, INTERNET, 🚻, ⛔ RESTRICTED (a director's only)", () => {
    expect(statusTag(g("enc"), ctx())?.text).toBe("MARKED");
    expect(statusTag(g("gone", { captured: true }), ctx())?.text).toBe("INTERNET");
    expect(statusTag(list[5]!, ctx())?.text).toBe("🚻");
    expect(statusTag(g("r", { restricted: true }), ctx())?.text).toBe("⛔ RESTRICTED");
    expect(statusTag(g("winamp"), ctx())).toBeNull();
    // An older server sends no board: the story's Marked flag stands in.
    expect(statusTag(g("m", { flags: [{ label: "Marked", path: "p", value: "true", on: true }] }), ctx({ wanted: null }))?.text).toBe("MARKED");
  });
  it("puts the place first on line 2, every row; two loud facts on line 3", () => {
    expect(placeLine(g("enc"), "The Desktop", ctx())).toBe("📍 The Desktop · seen 30 min ago");
    expect(placeLine(g("w", { flags: [{ label: "Cleared", path: "p", value: "true", on: true }] }), "The Desktop", ctx())).toBe("📍 The Desktop · ✓ Cleared");
    expect(placeLine(g("w", { lastSeen: 30 * 60_000 - 10_000 }), null, ctx())).toBe("📍 not in a room · seen now");
    expect(loudLine(g("enc"), ctx())).toEqual(["refused the truth", "🙋 You"]);
    expect(loudLine(g("nap"), ctx())).toEqual(["filed a guess", "🙋 Nobody yet"]);
    expect(loudLine(g("icq"), ctx())).toEqual(["🙋 McAfee"]);
    expect(loudLine(g("w", { flags: [{ label: "Cleared", path: "p", value: "false", on: false }] }), ctx())).toEqual(["✗ Not cleared"]);
  });
  it("sorts marked-unclaimed, mine, others', then by name", () => {
    expect(guestSort(list, ctx()).map((x) => x.id)).toEqual(["nap", "enc", "icq", "bath", "gone", "winamp"]);
  });
  it("defaults Here to where the NOW pick stands most, else the fullest room; opens on Marked when any", () => {
    expect(defaultHere(list, ["nap"], ["Cloud", "Desktop"])).toBe("Cloud");
    expect(defaultHere(list, null, ["Cloud", "Desktop"])).toBe("Desktop");
    expect(defaultHere([], null, ["The Cloud", "The Desktop"])).toBe("The Desktop");
    expect(defaultGuestTab(list, ctx())).toBe("marked");
    expect(defaultGuestTab([g("winamp")], ctx())).toBe("here");
    expect(defaultGuestTab(list, ctx({ wanted: null }))).toBe("here");
  });
  it("renders the tabs with counts, the Here picker and tagged rows", () => {
    const view = { guests: list, channels: [{ id: "loc:Desktop", title: "The Desktop (living room)" }, { id: "loc:Cloud", title: "The Cloud" }], wanted: [{ ...wanted[0], name: "enc", location: null, markedAt: 1 }], objectives: [] } as unknown as PrimeView;
    const html = renderToStaticMarkup(<GuestsSheet view={view} me="Norton" now={0} onPick={() => {}} onClose={() => {}} />);
    expect(html).toContain("Marked 1");
    expect(html).toContain("All 6");
    expect(html).toContain("booth-tag marked");
    expect(html).toContain("📍 The Desktop (living room)");
    // Marked is the default tab here: only the marked one is listed.
    expect(html).not.toContain(">winamp<");
    expect(summonsPick({ objectives: [{ id: "summons_door", title: "Summons", pick: ["a"] }] } as unknown as PrimeView)).toEqual(["a"]);
  });
});

describe("the booth rooms list (§3, G2)", () => {
  const view = { character: "Norton", title: "Trapped in the Internet", guests: [], channels: [{ id: "room:general", kind: "open", title: "# general", spaceId: "story", member: true, canPost: true }], spaces: [] } as unknown as PrimeView;
  it("reads Chats, never the story title, and puts the lobby last as the Chat log", () => {
    const chans = buildPrimeChannels(new Map(), view);
    expect(chans.find((c) => c.id === "__feed")!.spaceTitle).toBe(CHATS_TITLE);
    expect(chans.find((c) => c.id === "room:general")!.spaceTitle).toBe(CHATS_TITLE);
    const spaces = withChatLog(groupBySpace([...chans].sort(roomOrder)), null);
    const flat = spaces.flatMap((s) => s.channels);
    const last = flat[flat.length - 1]!;
    expect(last.id).toBe("__feed");
    expect(last.title).toBe(CHAT_LOG_TITLE);
    expect(last.unread).toBe(0);
    // Quiet: it folds into Other rooms with the empty rooms.
    expect(foldRooms(flat as Channel[], null, 1).folded.map((c) => c.id)).toContain("__feed");
    // Open, it stays where it is.
    expect(withChatLog(groupBySpace([...chans].sort(roomOrder)), "__feed").flatMap((s) => s.channels).find((c) => c.id === "__feed")!.title).toBe("Chat log"); // never the story's title (NM-F6)
  });
  it("lands a wide booth on Readouts, never the lobby", () => {
    expect(boothHome(buildPrimeChannels(new Map(), view))).toBe(INBOX);
  });
});
