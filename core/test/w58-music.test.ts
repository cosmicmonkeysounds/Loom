//! Wave 58 (`docs/loom-w58-music-contract.md` C1, C5, C7): the music commands, a
//! TIDAL link, the router's report of the app, and the Music card's view. The
//! story's half is `trapped-w58-music.test.ts`.

import { describe, expect, it } from "vitest";
import { MUSIC_LIBRARY_MAX, MUSIC_PALS_MAX, musicCommandOf, tidalPlaylistId } from "../src/house-mixer.ts";
import { audioMusicOf, musicDjOf } from "../server/audio.ts";
import { warmthOf } from "../src/runtime/sim/model.ts";

const ID = "34e328b7-92a7-4bcc-9603-ff296a8fd201";

describe("wave 58: the commands", () => {
  it("takes the new transport and the two ways to pick a playlist", () => {
    expect(musicCommandOf({ action: "previous" })).toEqual({ action: "previous" });
    expect(musicCommandOf({ action: "pause" })).toEqual({ action: "pause" });
    expect(musicCommandOf({ action: "resume" })).toEqual({ action: "resume" });
    expect(musicCommandOf({ action: "playlist", playlist: "act_2" })).toEqual({ action: "playlist", playlist: "act_2" });
    expect(musicCommandOf({ action: "tidal", id: ID })).toEqual({ action: "tidal", id: ID });
    expect(musicCommandOf({ action: "tidal", id: ID, title: "  TITI - Act 1 " })).toEqual({ action: "tidal", id: ID, title: "TITI - Act 1" });
  });

  it("refuses a bad name or id, and still lists every action", () => {
    expect(musicCommandOf({ action: "playlist" })).toBe("playlist must be a playlist name");
    expect(musicCommandOf({ action: "playlist", playlist: "a b" })).toBe("playlist must be a playlist name");
    expect(musicCommandOf({ action: "tidal", id: "not-an-id" })).toBe("id must be a TIDAL playlist id");
    expect(musicCommandOf({ action: "dance" })).toMatch(/previous, pause, resume, playlist or tidal/u);
  });

  it("the old commands are unchanged", () => {
    expect(musicCommandOf({ action: "next", playlist: "act_1" })).toEqual({ action: "next", playlist: "act_1" });
    expect(musicCommandOf({ action: "scene", scene: "act_2" })).toEqual({ action: "scene", scene: "act_2" });
    expect(musicCommandOf({ action: "stop" })).toEqual({ action: "stop" });
    expect(musicCommandOf({ action: "story" })).toEqual({ action: "story" });
  });

  it("reads a playlist id out of a share link, and nothing out of an album's", () => {
    expect(tidalPlaylistId(`https://tidal.com/browse/playlist/${ID}?u`)).toBe(ID);
    expect(tidalPlaylistId(`  ${ID.toUpperCase()} `)).toBe(ID);
    expect(tidalPlaylistId("https://tidal.com/browse/album/12345678")).toBeNull();
    expect(tidalPlaylistId("")).toBeNull();
  });
});

describe("wave 58: the app in a report", () => {
  const report = (tidal: unknown) => audioMusicOf({ scene: "act_1", beds: [{ playlist: "act_1", speakers: ["l"], track: "A - B", posS: 3, live: true }], missing: [], tidal, loan: true });

  it("keeps a sound report", () => {
    const m = report({ online: true, playing: true, paused: false, track: "A - B", problem: null, playlist: ID, library: [{ id: ID, title: "TITI - Act 1", items: 19 }] })!;
    expect(m.tidal).toEqual({ online: true, playing: true, paused: false, track: "A - B", problem: null, playlist: ID, library: [{ id: ID, title: "TITI - Act 1", items: 19 }] });
    expect(m.beds[0]!.live).toBe(true);
    expect(m.loan).toBe(true);
  });

  it("drops a malformed app alone, and skips a malformed library row", () => {
    expect(report("nope")!.tidal).toBeUndefined();
    expect(report({ playing: true })!.tidal).toBeUndefined();
    const m = report({ online: true, library: [{ id: "x", title: "bad id" }, { id: ID }, 7, { id: ID, title: "good" }] })!;
    expect(m.tidal!.library).toEqual([{ id: ID, title: "good" }]);
    expect(m.tidal!.playing).toBe(false);
  });

  it("caps the library", () => {
    const m = report({ online: true, library: Array.from({ length: MUSIC_LIBRARY_MAX + 9 }, (_, i) => ({ id: ID, title: `p${i}` })) })!;
    expect(m.tidal!.library).toHaveLength(MUSIC_LIBRARY_MAX);
  });

  it("an older router's report has none of it", () => {
    const m = audioMusicOf({ scene: "act_1", beds: [{ playlist: "act_1", speakers: [], track: null, posS: 0 }], missing: [] })!;
    expect(m.tidal).toBeUndefined();
    expect(m.loan).toBeUndefined();
    expect(m.beds[0]).not.toHaveProperty("live");
  });
});

describe("wave 58: Trabolta's card", () => {
  const night = [
    { path: "Night.dj_locked", value: "false" },
    { path: "Night.dj_bar", value: "3" },
    { path: "Night.dj_last", value: "skipped a song" },
    { path: "Night.dj_for", value: "Winamp" },
  ];
  const guests = [
    { id: "g1", name: "Winamp" },
    { id: "g2", name: "Calculator" },
    { id: "g3", name: "Notepad" },
    { id: "g4", name: "Paint" },
  ];

  it("names the programs at the bar, chummiest first", () => {
    const dj = musicDjOf([...night, { path: "g1.chummy", value: "3" }, { path: "g2.chummy", value: "2" }, { path: "g3.chummy", value: "7" }, { path: "g4.chummy", value: "3" }], guests)!;
    expect(dj.pals).toEqual([
      { name: "Notepad", chummy: 7 },
      { name: "Paint", chummy: 3 },
      { name: "Winamp", chummy: 3 },
    ]);
    expect(dj).toMatchObject({ locked: false, bar: 3, last: { what: "skipped a song", who: "Winamp" } });
  });

  it("reads the lock and the bar a director moved, and no last move at the start", () => {
    const dj = musicDjOf([{ path: "Night.dj_locked", value: "true" }, { path: "Night.dj_bar", value: "1" }, { path: "Night.dj_last", value: "none" }, { path: "g2.chummy", value: "1" }], guests)!;
    expect(dj).toEqual({ locked: true, bar: 1, pals: [{ name: "Calculator", chummy: 1 }], last: null });
  });

  it("caps the pals", () => {
    const many = Array.from({ length: MUSIC_PALS_MAX + 5 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    expect(musicDjOf([...night, ...many.map((g) => ({ path: `${g.id}.chummy`, value: "5" }))], many)!.pals).toHaveLength(MUSIC_PALS_MAX);
  });

  it("a story without the power has no card", () => {
    expect(musicDjOf([{ path: "Night.step", value: "3" }], guests)).toBeNull();
  });
});

describe("wave 58: the warmth header", () => {
  it("reads a slot and its range", () => {
    expect(warmthOf("chummy -5 to 10")).toEqual({ slot: "chummy", min: -5, max: 10 });
  });

  it("anything else is no warmth at all", () => {
    expect(warmthOf(null)).toBeNull();
    expect(warmthOf("chummy")).toBeNull();
    expect(warmthOf("chummy 10 to -5")).toBeNull();
    expect(warmthOf("two words -1 to 1")).toBeNull();
  });
});
