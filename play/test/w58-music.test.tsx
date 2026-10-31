// Wave 58 (`docs/loom-w58-music-contract.md`): the Desk's 🎵 Music. The first tab for Task
// Manager (wave 59), what it draws over a view, and which
// post each control makes.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DJ_LOCK_CUE, DJ_UNLOCK_CUE, djLines, musicSceneName, musicSource, type MixerMusic, type MixerView, type MusicDj } from "../../core/src/house-mixer.ts";
import { hostCalls, type HostRoute } from "../src/host/api.ts";
import { BAD_LINK, HAND_NOTE, LOAN_NOTE, NO_SOUNDTRACK, ROUTER_OFFLINE, musicCalls, musicDone, musicOpen, nowPlaying } from "../src/host/mixer-model.ts";
import { MusicBody } from "../src/host/music.tsx";

const ACT_1 = "34e328b7-92a7-4bcc-9603-ff296a8fd201";

const tidal = (over: Partial<NonNullable<MixerMusic["tidal"]>> = {}): NonNullable<MixerMusic["tidal"]> => ({
  online: true,
  playing: true,
  paused: false,
  track: "Band - Dial-up Dreams",
  problem: null,
  playlist: ACT_1,
  library: [
    { id: ACT_1, title: "TITI - Act 1", items: 19 },
    { id: "9e3a60bc-df4c-4c05-a56f-76ef3c20a8fc", title: "harvesting the grillers", items: 175 },
  ],
  ...over,
});

function music(over: Partial<MixerMusic> = {}): MixerMusic {
  return {
    scene: "act_1",
    scenes: ["act_1", "act_2", "off"],
    beds: [{ playlist: "act_1", speakers: ["l"], track: "Band - Dial-up Dreams", posS: 30, durS: 120, live: true }],
    missing: [],
    playlists: [
      { name: "act_1", tracks: 0, loop: false },
      { name: "fan_closet", tracks: 1, loop: true },
    ],
    tidal: tidal(),
    ...over,
  };
}

function view(over: Partial<MixerView> = {}): MixerView {
  return {
    mix: { seq: 1, levels: {} },
    sources: [{ id: "music", label: "Music", kind: "bus", meterOnly: false }],
    rooms: [{ id: "living", name: "Living room", speakers: [{ id: "l", name: "Living L", out: [1] }] }],
    meters: null,
    music: music(),
    dj: { locked: false, bar: 3, pals: [{ name: "Winamp", chummy: 4 }], last: { what: "skipped a song", who: "Winamp" } },
    router: { online: true, lastSeen: 1, name: "desk" },
    now: 1,
    ...over,
  };
}

const body = (v: MixerView) => renderToStaticMarkup(createElement(MusicBody, { view: v, levels: v.mix.levels, onChange: () => {}, onMusic: () => {}, onLock: () => {}, onNote: () => {}, note: null, error: null }));

function recorder() {
  const sent: Array<{ route: HostRoute; body: Record<string, unknown> }> = [];
  const calls = hostCalls(async (route, b) => {
    sent.push({ route, body: b });
    return { ok: true };
  }, () => "Night.alerts");
  return { sent, calls };
}

describe("who sees it open", () => {
  it("Task Manager, and nobody else", () => {
    expect(musicOpen("Task Manager")).toBe(true);
    expect(musicOpen("Installation Wizard")).toBe(false);
    expect(musicOpen(null)).toBe(false);
  });
});

describe("what it says", () => {
  it("names where the music comes from", () => {
    expect(musicSource(null)).toMatchObject({ tone: "idle", text: "No soundtrack reported yet" });
    expect(musicSource(music())).toMatchObject({ tone: "ok", text: "🎵 Playing from TIDAL" });
    expect(musicSource(music({ tidal: tidal({ paused: true }) }))).toMatchObject({ tone: "warn" });
    expect(musicSource(music({ tidal: tidal({ problem: "playlist x: its page never loaded" }) })).text).toContain("its page never loaded");
    expect(musicSource(music({ tidal: tidal({ online: false }) })).tone).toBe("bad");
    expect(musicSource(music({ tidal: tidal({ online: false }) })).text).toContain("tidal.ps1");
    expect(musicSource(music({ beds: [{ playlist: "ceremony", speakers: [], track: "A", posS: 0 }] })).text).toBe("📁 Playing files");
    expect(musicSource(music({ beds: [] })).text).toBe("No music playing");
  });

  it("an older router, with no app in its report, plays files", () => {
    const { tidal: _gone, ...old } = music({ beds: [{ playlist: "act_1", speakers: [], track: "A", posS: 0 }] });
    expect(musicSource(old).text).toBe("📁 Playing files");
  });

  it("an ad-hoc scene reads in words", () => {
    expect(musicSceneName("act_2")).toBe("act_2");
    expect(musicSceneName("hand_act_2")).toBe("act_2 (by hand)");
    expect(musicSceneName("hand_tidal_34e328b7")).toBe("a TIDAL playlist (by hand)");
  });

  it("calls an app bed by its title", () => {
    expect(nowPlaying(music())!.beds[0]).toMatchObject({ playlist: "act_1", name: "TITI - Act 1" });
  });

  it("Trabolta's card, in each state", () => {
    const dj: MusicDj = { locked: false, bar: 3, pals: [], last: null };
    expect(djLines(dj)).toEqual({ status: "Nobody is chummy enough yet (3 points)", pals: null, last: null });
    expect(djLines({ ...dj, pals: [{ name: "Winamp", chummy: 4 }], last: { what: "skipped a song", who: "Winamp" } })).toEqual({ status: "Will change it for 1 program", pals: "Winamp (4)", last: "Last: skipped a song for Winamp" });
    expect(djLines({ ...dj, locked: true }).status).toBe("🔒 Kept off the music");
  });
});

describe("what it draws", () => {
  it("now playing, the deck, the picks, the level and Trabolta", () => {
    const html = body(view());
    for (const t of ["🎵 Playing from TIDAL", "NOW PLAYING", "TITI - Act 1", "Band - Dial-up Dreams", "⏮", "⏸", "■ Stop music", "PLAY NOW", "▶ act_1", "Your TIDAL playlists (2)", "Paste a TIDAL playlist link", "🤖 TRABOLTA", "Winamp (4)", "Last: skipped a song for Winamp", "🔒 Keep him off the music"]) expect(html, t).toContain(t);
    // The deck's ⏭ is Skip all here: one bed on one app.
    expect(html).not.toContain("⏭ Skip all");
    expect(html).toContain('data-testid="host-music-level"');
    expect(html).toMatch(/type="range"/u);
    // The Fan Closet's loop is no music to pick.
    expect(html).not.toContain("▶ fan_closet");
    // The library waits behind its fold.
    expect(html).not.toContain("harvesting the grillers");
  });

  it("a paused app offers ▶", () => {
    const html = body(view({ music: music({ tidal: tidal({ paused: true }) }) }));
    expect(html).toContain(">▶<");
    expect(html).not.toContain(">⏸<");
  });

  it("no deck on a file bed: it has no ⏮ and no pause", () => {
    const html = body(view({ music: music({ beds: [{ playlist: "ceremony", speakers: [], track: "A", posS: 0 }] }) }));
    expect(html).not.toContain("⏮");
    expect(html).not.toContain(">⏸<");
    expect(html).toContain("⏭ Skip all");
  });

  it("after ■ Stop house sounds, with nothing playing, Follow the story is still the way back", () => {
    const stopped = body(view({ music: music({ scene: null, beds: [], hand: true, tidal: tidal({ playing: false }) }) }));
    expect(stopped).toContain("↺ Follow the story");
    expect(stopped).toContain(HAND_NOTE.replace("'", "&#x27;"));
  });

  it("a hand offers Follow the story; Trabolta's loan offers Take it back", () => {
    const hand = body(view({ music: music({ hand: true }) }));
    expect(hand).toContain(HAND_NOTE.replace("'", "&#x27;"));
    expect(hand).toContain("↺ Follow the story");
    const loan = body(view({ music: music({ hand: true, loan: true }) }));
    expect(loan).toContain(LOAN_NOTE);
    expect(loan).toContain("↺ Take it back");
    expect(loan).not.toContain("Follow the story");
  });

  it("a locked Trabolta offers the way back", () => {
    expect(body(view({ dj: { locked: true, bar: 3, pals: [], last: null } }))).toContain("🔓 Let him reach the music");
  });

  it("a story without the power has no card", () => {
    expect(body(view({ dj: null }))).not.toContain("TRABOLTA");
  });

  it("no router, and no soundtrack yet", () => {
    const html = body(view({ router: { online: false, lastSeen: null, name: null }, music: null }));
    expect(html).toContain(ROUTER_OFFLINE);
    expect(html).toContain(NO_SOUNDTRACK);
    expect(html).not.toContain("Skip all");
    expect(html).not.toContain("PLAY NOW");
  });

  it("a router with no app has no library and no link box", () => {
    const { tidal: _gone, ...old } = music();
    const html = body(view({ music: old }));
    expect(html).toContain("▶ act_1");
    expect(html).not.toContain("Your TIDAL playlists");
    expect(html).not.toContain("Paste a TIDAL");
  });
});

describe("which post each control makes", () => {
  it("the new buttons post their command", async () => {
    const { sent, calls } = recorder();
    await calls.music(musicCalls.previous());
    await calls.music(musicCalls.pause());
    await calls.music(musicCalls.resume());
    await calls.music(musicCalls.playlist("act_2"));
    await calls.music(musicCalls.tidal(ACT_1, "TITI - Act 1"));
    await calls.music(musicCalls.tidal(ACT_1));
    expect(sent.map((s) => s.body)).toEqual([{ action: "previous" }, { action: "pause" }, { action: "resume" }, { action: "playlist", playlist: "act_2" }, { action: "tidal", id: ACT_1, title: "TITI - Act 1" }, { action: "tidal", id: ACT_1 }]);
    expect(new Set(sent.map((s) => s.route))).toEqual(new Set(["/api/mod/audio/music"]));
  });

  it("the lock is the story's cue, on a route a host already has", async () => {
    const { sent, calls } = recorder();
    await calls.cue(DJ_LOCK_CUE, null, null);
    await calls.cue(DJ_UNLOCK_CUE, null, null);
    expect(sent.map((s) => s.route)).toEqual(["/api/mod/signal", "/api/mod/signal"]);
    expect(sent.map((s) => s.body["name"])).toEqual([DJ_LOCK_CUE, DJ_UNLOCK_CUE]);
  });

  it("says what it did, and that no router heard", () => {
    expect(musicDone(musicCalls.previous(), { router: true })).toBe("⏮ Back a track");
    expect(musicDone(musicCalls.pause(), { router: true })).toBe("⏸ TIDAL paused");
    expect(musicDone(musicCalls.resume(), { router: true })).toBe("▶ TIDAL playing");
    expect(musicDone(musicCalls.playlist("act_2"), { router: true })).toBe("▶ Playing act_2");
    expect(musicDone(musicCalls.tidal(ACT_1, "Mine"), { router: true })).toBe("▶ Playing Mine");
    expect(musicDone(musicCalls.tidal(ACT_1), { router: false })).toMatch(/no router is listening/u);
    expect(BAD_LINK).toContain("TIDAL");
  });
});

describe("the chunk and the stylesheet", () => {
  const css = readFileSync(new URL("../src/css/host.css", import.meta.url), "utf8");

  it("every control on it is a 44 px target", () => {
    for (const cls of ["host-music-key", "host-music-pick", "host-music-more", "host-music-input", "host-music-play", "host-music-lock"]) {
      expect(new RegExp(`\\.${cls} \\{[^}]*min-height: var\\(--tap\\)`, "u").test(css), cls).toBe(true);
    }
  });

  it("only the Desk's chunk reaches it", () => {
    const desk = readFileSync(new URL("../src/host/desk.tsx", import.meta.url), "utf8");
    expect(desk).toContain('from "./music.tsx"');
    const windows = readFileSync(new URL("../src/host/windows.tsx", import.meta.url), "utf8");
    expect(windows).not.toMatch(/from "\.\/music\.tsx"/u);
  });
});
