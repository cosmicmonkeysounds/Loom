import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { BIG_LINE_MAX, EMPTY_NIGHT, IDENTIFY_MS, MISSES_OFFLINE, MOMENTS_MAX, attractOf, bigLineOf, momentsOf, type ScreenMoment, identifyOn, kingOf, missesAfter, parseScreenState, pollScreen, screenReachable, screenStateUrl, voiceOf } from "../src/screen.ts";

const config = defaultConfig({ eventId: "evt 1", token: "tok", name: "Kitchen", spot: "start-bar", view: "auto" });

const body = {
  now: 1,
  night: { screen: "screensaver", terminals: "screensaver" },
  cues: { screens: { value: "screensaver", seq: 1 }, terminals: null, tv: null, tablet: null },
  character: { id: "Trabolta", hidden: true, awake: false, online: true },
  attract: true,
  countdown: null,
  remaining: null,
  terminals: [],
};

function fakeFetch(status: number, json: unknown, seen: Array<{ url: string; init?: RequestInit }> = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return { status, ok: status >= 200 && status < 300, json: async () => json } as Response;
  }) as unknown as typeof fetch;
}

describe("screen state", () => {
  it("polls the event-scoped route with the terminal's heartbeat fields and its token", async () => {
    expect(screenStateUrl(config)).toBe("/e/evt%201/api/screen/state?name=Kitchen&spot=start-bar&view=auto&character=Trabolta");
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const out = await pollScreen(config, fakeFetch(200, body, seen));
    expect(out).toMatchObject({ kind: "state", state: { attract: true, character: { id: "Trabolta", hidden: true, awake: false } } });
    expect((seen[0]!.init!.headers as Record<string, string>)["x-loom-token"]).toBe("tok");
  });

  it("the heartbeat carries the device health (SW-SCR-21), and a poll always sends the build", async () => {
    const health = { audio: false, visible: true, battery: 17.4, charging: true, version: "ab12cd3.1016-1432" };
    expect(screenStateUrl(config, null, health)).toBe("/e/evt%201/api/screen/state?name=Kitchen&spot=start-bar&view=auto&character=Trabolta&ver=ab12cd3.1016-1432&audio=0&vis=v&bat=17c");
    // Unknown fields (no battery API on iOS) are left out, not guessed.
    expect(screenStateUrl(config, null, { audio: null, visible: null, battery: null, charging: null, version: "dev" })).toMatch(/&ver=dev$/u);
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    await pollScreen(config, fakeFetch(200, body, seen));
    expect(new URL(`http://x${seen[0]!.url}`).searchParams.get("ver")).not.toBeNull();
  });

  it("reads the King's shared health bar (wave 11); an older server has none", () => {
    expect(parseScreenState(body)?.king).toBeNull();
    expect(parseScreenState({ ...body, king: { hp: 9, max: 15, fallen: false, armed: true } })?.king).toEqual({ hp: 9, max: 15, fallen: false, armed: true });
    expect(kingOf({ hp: 0, max: 15, fallen: false, armed: false })).toEqual({ hp: 0, max: 15, fallen: true, armed: false });
    expect(kingOf({ hp: 20, max: 15, armed: null })).toEqual({ hp: 15, max: 15, fallen: false, armed: null });
    expect(kingOf({ hp: -2, max: 15, armed: "yes" })).toEqual({ hp: 0, max: 15, fallen: true, armed: null });
    expect(kingOf({ hp: "9", max: 15 })).toBeNull();
    expect(kingOf({ hp: 9, max: 0 })).toBeNull();
    expect(kingOf(null)).toBeNull();
  });

  it("reads a director's identify off the answer (absent from an older server = off)", () => {
    expect(parseScreenState({ ...body, identify: true })?.identify).toBe(true);
    expect(parseScreenState(body)?.identify).toBe(false);
    expect(parseScreenState({ ...body, identify: "yes" })?.identify).toBe(false);
  });

  it("counts an identify down on the device: a kept (stale) answer uncovers on time", () => {
    const got = parseScreenState({ ...body, identify: true, identifyLeft: 6_000 }, 1_000)!;
    expect(got.identifyLeft).toBe(6_000);
    expect(identifyOn(got, 1_000)).toBe(true);
    expect(identifyOn(got, 6_999)).toBe(true);
    expect(identifyOn(got, 7_000)).toBe(false); // the server is unreachable: the last answer is kept
    // An older server sends no time left: IDENTIFY_MS from the answer.
    const old = parseScreenState({ ...body, identify: true }, 1_000)!;
    expect(old.identifyLeft).toBeNull();
    expect(identifyOn(old, 1_000 + IDENTIFY_MS - 1)).toBe(true);
    expect(identifyOn(old, 1_000 + IDENTIFY_MS)).toBe(false);
    expect(identifyOn(parseScreenState(body, 1_000), 1_000)).toBe(false);
    expect(identifyOn(null, 0)).toBe(false);
  });

  it("a refused token is revoked; anything else that fails is a miss", async () => {
    expect(await pollScreen(config, fakeFetch(403, {}))).toEqual({ kind: "revoked" });
    expect(await pollScreen(config, fakeFetch(401, {}))).toEqual({ kind: "revoked" });
    expect(await pollScreen(config, fakeFetch(404, {}))).toEqual({ kind: "miss" });
    // The event this terminal was set up for is over (a new one launched).
    expect(await pollScreen(config, fakeFetch(404, { error: "unknown event" }))).toEqual({ kind: "ended" });
    expect(await pollScreen(config, fakeFetch(200, { nope: 1 }))).toEqual({ kind: "miss" });
    // A loom restart behind Caddy (502) or a server still booting (503
    // "starting") is a miss: the poll goes on and picks the screen back up.
    expect(await pollScreen(config, fakeFetch(502, {}))).toEqual({ kind: "miss" });
    expect(await pollScreen(config, fakeFetch(503, { error: "starting" }))).toEqual({ kind: "miss" });
    const throwing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await pollScreen(config, throwing)).toEqual({ kind: "miss" });
  });

  it("the bar's dot goes dark when the server stops answering, though the last state is kept", () => {
    const state = parseScreenState(body);
    expect(screenReachable(null, 0)).toBe(false); // never answered
    let misses = missesAfter(0, "state");
    expect(screenReachable(state, misses)).toBe(true);
    misses = missesAfter(misses, "miss"); // one dropped poll is a blip
    expect(screenReachable(state, misses)).toBe(true);
    misses = missesAfter(misses, "miss");
    expect(misses).toBe(MISSES_OFFLINE);
    expect(screenReachable(state, misses)).toBe(false); // the server is gone
    expect(screenReachable(state, missesAfter(misses, "state"))).toBe(true); // and back
  });

  it("fails closed: no answer yet is attract", () => {
    expect(attractOf(null)).toBe(true);
    expect(attractOf(parseScreenState(body))).toBe(true);
    expect(attractOf(parseScreenState({ ...body, attract: false }))).toBe(false);
  });

  it("parses defensively", () => {
    expect(parseScreenState(null)).toBeNull();
    expect(parseScreenState({ attract: "yes" })).toBeNull();
    const s = parseScreenState({ attract: false, character: { id: "Clippy" }, remaining: Number.NaN })!;
    expect(s.character).toEqual({ id: "Clippy", hidden: false, awake: true, online: false, hold: false });
    expect(parseScreenState({ attract: false, character: { id: "Trabolta", online: false, hold: true } })!.character!.hold).toBe(true);
    expect(s.remaining).toBeNull();
    expect(s.night).toEqual(EMPTY_NIGHT);
    expect(s.moments).toEqual([]);
  });

  it("reads the wave 17 night vars, each null when missing or malformed", () => {
    const s = parseScreenState({ ...body, night: { screen: "bingo", terminals: null, phase: "y2k", step: 14, bottle_pick: "Winamp", bottle_open: true, results_q: 2, award_winner: "Excel", award_value: 412, help_votes: 7, thwart_votes: "3", alerts: "dialog", ended: false, collection_complete: "yes", scenario: 9 } })!;
    expect(s.night).toEqual({ screen: "bingo", terminals: null, phase: "y2k", step: 14, bottle_pick: "Winamp", bottle_open: true, results_q: 2, award_winner: "Excel", award_value: 412, help_votes: 7, thwart_votes: null, alerts: "dialog", ended: false, collection_complete: null, scenario: null });
    expect(parseScreenState({ ...body, night: { award_value: "4 / 8", step: Number.NaN } })!.night).toMatchObject({ award_value: "4 / 8", step: null, phase: null });
    expect(parseScreenState({ ...body, night: { ended: true, collection_complete: true, scenario: 2 } })!.night).toMatchObject({ ended: true, collection_complete: true, scenario: 2 });
    expect(parseScreenState({ ...body, night: "nope" })!.night).toEqual(EMPTY_NIGHT);
  });

  it("reads the moments ring defensively, oldest first, never history", () => {
    const s = parseScreenState({
      ...body,
      moments: [
        { seq: 9, at: 5000, kind: "signal", name: "bottle landed", who: "Winamp" },
        { seq: 4, at: 4000, kind: "beat", name: "Trabolta Introduction", who: null },
        { seq: 5, at: 0, kind: "beat", name: "history" },
        { seq: 6, at: 4100, kind: "telepathy", name: "x" },
        { seq: 7, at: 4200, kind: "sfx", name: "  " },
        { seq: "8", at: 4300, kind: "sfx", name: "zip" },
        { seq: 10, at: 6000, kind: "found", name: "golden duck kept", who: "Excel" },
        { seq: 11, at: 6100, kind: "found", name: "golden duck", who: "", kept: false },
        null,
      ],
    })!;
    expect(s.moments).toEqual([
      { seq: 4, at: 4000, kind: "beat", name: "Trabolta Introduction", who: null, kept: false },
      { seq: 9, at: 5000, kind: "signal", name: "bottle landed", who: "Winamp", kept: false },
      { seq: 10, at: 6000, kind: "found", name: "golden duck kept", who: "Excel", kept: true },
      { seq: 11, at: 6100, kind: "found", name: "golden duck", who: null, kept: false },
    ]);
    expect(parseScreenState({ ...body, moments: { seq: 1 } })!.moments).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => ({ seq: i + 1, at: 1000 + i, kind: "sfx", name: "zip" }));
    const kept = parseScreenState({ ...body, moments: many })!.moments;
    expect(kept.length).toBe(MOMENTS_MAX);
    expect(kept[kept.length - 1]!.seq).toBe(40);
  });
});

describe("the TV's voice block (K-18)", () => {
  const tv = defaultConfig({ eventId: "evt", token: "tok", name: "TV", spot: "desktop-tv", view: "tv" });

  it("the TV names its room and cursor in the poll", async () => {
    expect(screenStateUrl(tv, { room: "The Desktop", after: null })).toBe("/e/evt/api/screen/state?name=TV&spot=desktop-tv&view=tv&character=Trabolta&voice=The+Desktop");
    expect(screenStateUrl(tv, { room: "The Desktop", after: 41 })).toMatch(/&voice=The\+Desktop&after=41$/u);
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    await pollScreen(tv, fakeFetch(200, body, seen), { room: "The Desktop", after: 7 });
    expect(seen[0]!.url).toContain("after=7");
  });

  it("parses the voice block; malformed lines are dropped, no block is null", () => {
    const s = parseScreenState({
      ...body,
      voice: { room: "loc:The Desktop", muted: true, head: 9, lines: [{ seq: 9, from: "Trabolta", text: "Hi.", beat: null }, { seq: "x" }, { seq: 8, from: "Sandy", text: "…", beat: "Song Ending" }] },
    });
    expect(s?.voice).toEqual({
      room: "loc:The Desktop",
      muted: true,
      head: 9,
      lines: [
        { seq: 9, from: "Trabolta", text: "Hi.", beat: null },
        { seq: 8, from: "Sandy", text: "…", beat: "Song Ending" },
      ],
    });
    expect(parseScreenState(body)?.voice).toBeNull();
    expect(voiceOf({ lines: [] })).toBeNull();
  });
});

describe("a room terminal (wave 7: the server-room terminal)", () => {
  const room = defaultConfig({ eventId: "evt", token: "tok", name: "Server Room", spot: "server-room", view: "face", room: "The Server Room" });

  it("names its room (not a voice room) and its cursor in the poll", async () => {
    expect(screenStateUrl(room, { room: "The Server Room", after: 12, as: "room" })).toBe("/e/evt/api/screen/state?name=Server+Room&spot=server-room&view=face&character=Trabolta&room=The+Server+Room&after=12");
    expect(screenStateUrl(room, { room: "The Server Room", after: null, as: "room" })).not.toMatch(/voice=|after=/u);
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    await pollScreen(room, fakeFetch(200, body, seen), { room: "The Server Room", after: 3, as: "room" });
    expect(seen[0]!.url).toMatch(/&room=The\+Server\+Room&after=3/u);
  });

  it("parses the room block; an older server (no block) keeps a room terminal asleep", () => {
    const open = parseScreenState({ ...body, attract: false, room: { id: "The Server Room", open: true } })!;
    expect(open.room).toEqual({ id: "The Server Room", open: true });
    expect(attractOf(open, true)).toBe(false);
    const closed = parseScreenState({ ...body, attract: true, room: { id: "The Server Room", open: false } })!;
    expect(attractOf(closed, true)).toBe(true);
    const old = parseScreenState({ ...body, attract: false })!;
    expect(old.room).toBeNull();
    expect(attractOf(old, true)).toBe(true); // fail closed: can't tell whether the room is open
    expect(attractOf(old)).toBe(false); // any other terminal: unchanged
    expect(parseScreenState({ ...body, room: { id: 3, open: "yes" } })!.room).toBeNull();
    expect(attractOf(null, true)).toBe(true);
  });
});

// Wave 18: a big house broadcast rides the moments ring (the core lane's
// shape, read generously).
const T0 = 9_000_000;
const big = (seq: number, at: number, name: string, who: string | null = null): ScreenMoment => ({ seq, at, kind: "big", name, who, kept: false });

describe("big house broadcasts off the wire", () => {
  it("kind big: the line from text (else name), its !! / ~ marks stripped, who kept", () => {
    const out = momentsOf([
      { seq: 3, at: T0, kind: "big", name: "!!🎀 Encarta wins a Bingo…", text: "!!🎀 Encarta wins a Bingo Ribbon! Everyone cheer!", who: "Encarta" },
      { seq: 4, at: T0, kind: "big", name: "~🏆 Excel wins Most Trusted" },
    ]);
    expect(out).toEqual([big(3, T0, "🎀 Encarta wins a Bingo Ribbon! Everyone cheer!", "Encarta"), big(4, T0, "🏆 Excel wins Most Trusted")]);
  });

  it("an unknown kind flagged moment: big or big: true is big; a wave 17 kind keeps its meaning", () => {
    const out = momentsOf([
      { seq: 1, at: T0, kind: "broadcast", moment: "big", text: "!!🎀 Winamp wins a Bingo Ribbon!" },
      { seq: 2, at: T0, kind: "line", big: true, name: "🏆 Clippy wins" },
      { seq: 3, at: T0, kind: "signal", moment: "big", name: "award_the_ribbon" },
      { seq: 4, at: T0, kind: "broadcast", name: "🎀 not flagged" },
    ]);
    expect(out.map((m) => [m.kind, m.name])).toEqual([
      ["big", "🎀 Winamp wins a Bingo Ribbon!"],
      ["big", "🏆 Clippy wins"],
      ["signal", "award_the_ribbon"],
    ]);
  });

  it("an empty or history big line drops; a long one is clipped", () => {
    expect(momentsOf([{ seq: 1, at: T0, kind: "big", name: "!! " }])).toEqual([]);
    expect(momentsOf([{ seq: 1, at: 0, kind: "big", name: "🎀 old" }])).toEqual([]);
    const long = bigLineOf(`🎀 ${"x".repeat(400)}`);
    expect(long.length).toBe(BIG_LINE_MAX);
    expect(long.endsWith("…")).toBe(true);
  });

  it("a whole answer carries them through parseScreenState", () => {
    const s = parseScreenState({ attract: false, moments: [{ seq: 9, at: T0, kind: "big", text: "!!🎀 Encarta wins a Bingo Ribbon!" }] }, T0);
    expect(s?.moments).toEqual([big(9, T0, "🎀 Encarta wins a Bingo Ribbon!")]);
  });
});
