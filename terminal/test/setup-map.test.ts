import { describe, expect, it } from "vitest";
import { TERMINAL_VIEWS, validateHouse, type HouseMap } from "@loom/house";
import showHouse from "../../core/examples/trapped-in-the-internet/house.json";
import shedHouse from "../../core/examples/trapped-in-the-internet/house.shed.json";
import { TV_SPEED, VIEWS, defaultConfig, type TerminalConfig } from "../src/config.ts";
import { UNPLACED, applyPick, followMap, followVoice, groupTerminals, onlineBadge, linkConfig, pickOf, screenWords, urlConfig, withManual } from "../src/setup-map.ts";

const load = (raw: unknown): HouseMap => {
  const v = validateHouse(raw);
  expect(v.problems).toEqual([]);
  return v.house!;
};
const show = load(showHouse);
const shed = load(shedHouse);
const spot = (h: HouseMap, id: string) => h.terminals.find((t) => t.id === id)!;
const base = (over: Partial<TerminalConfig> = {}): TerminalConfig => defaultConfig({ eventId: "e1", token: "tok", ...over });

describe("the terminal's views are the house's", () => {
  it("VIEWS == TERMINAL_VIEWS", () => {
    expect([...VIEWS].sort()).toEqual([...TERMINAL_VIEWS].sort());
  });
});

describe("pickOf — a map terminal → name / view / room", () => {
  it("the show's special tablets", () => {
    expect(pickOf(show, spot(show, "desktop-tv"))).toEqual({ spot: "desktop-tv", name: "TV", view: "tv", room: "", voice: true });
    expect(pickOf(show, spot(show, "server-room"))).toEqual({ spot: "server-room", name: "Server Room", view: "face", room: "The Server Room", voice: true });
    expect(pickOf(show, spot(show, "server-room-door"))).toEqual({ spot: "server-room-door", name: "Server Door", view: "chess", room: "", voice: true });
    expect(pickOf(show, spot(show, "graphics-card"))).toEqual({ spot: "graphics-card", name: "Casino", view: "casino", room: "", voice: true });
    expect(pickOf(show, spot(show, "start-bar"))).toEqual({ spot: "start-bar", name: "Start Bar", view: "auto", room: "", voice: true });
    // Wave 18b (Q4): the tent laptop is the reinstallation station, on either variant.
    expect(pickOf(show, spot(show, "tent"))).toEqual({ spot: "tent", name: "Tent", view: "reinstall", room: "", voice: false });
    expect(pickOf(shed, spot(shed, "tent"))).toEqual({ spot: "tent", name: "Shed", view: "reinstall", room: "", voice: false });
  });

  it("speaks is ignored on the TV, the board, the casino and the reinstallation station", () => {
    for (const view of ["tv", "chess", "casino", "reinstall"] as const) expect(pickOf(show, { ...spot(show, "server-room"), view, speaks: true }).room).toBe("");
    expect(pickOf(show, { ...spot(show, "hall"), speaks: true }).room).toBe("The Tube");
  });
});

describe("screenWords + groupTerminals", () => {
  it("names each screen in words", () => {
    expect(screenWords({ view: "tv", room: "" })).toMatch(/^TV/);
    expect(screenWords({ view: "casino", room: "" })).toBe("casino");
    expect(screenWords({ view: "reinstall", room: "" })).toBe("reinstallation station");
    expect(screenWords({ view: "chess", room: "" })).toMatch(/^chess board/);
    expect(screenWords({ view: "face", room: "The Server Room" })).toBe("room terminal — The Server Room");
    expect(screenWords({ view: "auto", room: "" })).toBe("house terminal");
  });

  it("groups by floor (top first) then room, every terminal once", () => {
    const g = groupTerminals(show);
    expect(g.map((f) => f.floor)[0]).toBe("top");
    const all = g.flatMap((f) => f.rooms.flatMap((r) => r.choices.map((c) => c.pick.spot)));
    expect(all.sort()).toEqual(show.terminals.map((t) => t.id).sort());
    const server = g.flatMap((f) => f.rooms).find((r) => r.room === "server-room")!;
    expect(server.label).toContain("The Server Room");
  });
});

describe("onlineBadge", () => {
  const beats = [
    { name: "Casino", spot: "graphics-card", ago: 5_000 },
    { name: "Old", spot: "hall", ago: 60_000 },
  ];
  it("names another tablet polling from the spot", () => {
    expect(onlineBadge("graphics-card", beats, 20_000, null)).toBe("⚠ online now: Casino, seen 5 s ago");
  });
  it("not a silent one, not this tablet, not unplaced", () => {
    expect(onlineBadge("hall", beats, 20_000, null)).toBeNull();
    expect(onlineBadge("graphics-card", beats, 20_000, { name: "Casino", spot: "graphics-card" })).toBeNull();
    expect(onlineBadge("", [{ name: "x", spot: "", ago: 0 }], 20_000, null)).toBeNull();
  });
});

describe("applyPick / urlConfig / followMap", () => {
  it("a tap sets spot / name / view / room and fromMap", () => {
    const c = applyPick(base(), pickOf(show, spot(show, "server-room")));
    expect(c).toMatchObject({ spot: "server-room", name: "Server Room", view: "face", room: "The Server Room", fromMap: true });
    expect(applyPick(base(), UNPLACED)).toMatchObject({ spot: "", view: "face", fromMap: false });
  });

  it("a ?code=&spot= link takes the map terminal", () => {
    const given = base({ spot: "graphics-card", name: "Terminal" });
    expect(urlConfig(given, { spot: "graphics-card", name: null, view: null, room: null }, show)).toMatchObject({ name: "Casino", view: "casino", room: "", fromMap: true });
    // The tent laptop's link: `?code=<mod>&spot=tent` alone makes it the station.
    expect(urlConfig(base({ spot: "tent", name: "Terminal" }), { spot: "tent", name: null, view: null, room: null }, show)).toMatchObject({ name: "Tent", view: "reinstall", room: "", fromMap: true });
  });

  it("a re-opened spot-only TV link speaks at TV_SPEED (w26 I4); other views keep 1", () => {
    const tv = linkConfig(base({ spot: "desktop-tv", name: "Terminal" }), { spot: "desktop-tv", name: null, view: null, room: null }, show);
    expect(tv).toMatchObject({ view: "tv", speed: TV_SPEED });
    // urlConfig alone (the map's view arrives after provision) would leave it at 1.
    expect(urlConfig(base({ spot: "desktop-tv", name: "Terminal" }), { spot: "desktop-tv", name: null, view: null, room: null }, show).speed).toBe(1);
    expect(linkConfig(base({ spot: "graphics-card", name: "Terminal" }), { spot: "graphics-card", name: null, view: null, room: null }, show).speed).toBe(1);
    // A speed already chosen on the config (not the default 1) is kept.
    expect(linkConfig(base({ spot: "desktop-tv", speed: 1.1 }), { spot: "desktop-tv", name: null, view: null, room: null }, show).speed).toBe(1.1);
  });

  it("an old fleet link (it names a view) plays exactly as given, as before", () => {
    const given = base({ spot: "server-room", name: "Heart", view: "world", room: "" });
    const c = urlConfig(given, { spot: "server-room", name: "Heart", view: "world", room: null }, show);
    expect(c).toMatchObject({ name: "Heart", view: "world", room: "", fromMap: false });
    // The documented links agree with the map: they follow it from then on.
    const links: Array<[Partial<TerminalConfig>, string | null]> = [
      [{ spot: "server-room", name: "Server Room", view: "face", room: "The Server Room" }, "The Server Room"],
      [{ spot: "server-room-door", name: "Server Door", view: "chess", room: "" }, null],
      [{ spot: "graphics-card", name: "Casino", view: "casino", room: "" }, null],
      [{ spot: "desktop-tv", name: "TV", view: "tv", room: "" }, null],
      [{ spot: "start-bar", name: "Start Bar", view: "auto", room: "" }, null],
      [{ spot: "tent", name: "Tent", view: "reinstall", room: "" }, null],
    ];
    for (const [over, room] of links) {
      const g = base(over);
      const out = urlConfig(g, { spot: over.spot!, name: over.name!, view: over.view!, room }, show);
      expect(out).toMatchObject({ ...over, fromMap: true });
    }
  });

  it("a link's own name is never renamed back by the map", () => {
    const given = base({ spot: "server-room", name: "Heart" });
    const named = urlConfig(given, { spot: "server-room", name: "Heart", view: null, room: null }, show);
    expect(named).toMatchObject({ name: "Heart", view: "face", room: "The Server Room", fromMap: false });
    expect(followMap(named, show)).toBeNull();
  });

  it("no map read: as given, following the map from the next boot when only the spot was named", () => {
    const given = base({ spot: "graphics-card", name: "Terminal" });
    expect(urlConfig(given, { spot: "graphics-card", name: null, view: null, room: null }, null)).toMatchObject({ name: "Terminal", fromMap: true });
    expect(followMap(urlConfig(given, { spot: "graphics-card", name: null, view: null, room: null }, null), show)).toMatchObject({ name: "Casino", view: "casino" });
    expect(urlConfig(given, { spot: "graphics-card", name: "X", view: null, room: null }, null)).toBe(given);
  });

  it("a spot the map lacks / no spot: the link as given", () => {
    const given = base({ spot: "nowhere", name: "X" });
    expect(urlConfig(given, { spot: "nowhere", name: "X", view: null, room: null }, show)).toBe(given);
    expect(urlConfig(base(), { spot: null, name: "X", view: "face", room: null }, show)).toEqual(base());
  });

  it("withManual: ⚙'s screen / room win; one that agrees with the map keeps following it", () => {
    const pick = pickOf(show, spot(show, "server-room"));
    const c = applyPick(base(), pick);
    expect(withManual(c, pick, { view: "", room: "" })).toBe(c);
    expect(withManual(c, pick, { view: "world", room: "" })).toMatchObject({ view: "world", room: "The Server Room", fromMap: false });
    expect(withManual(c, pick, { view: "face", room: "The Server Room" })).toMatchObject({ fromMap: true });
    expect(withManual(applyPick(base(), UNPLACED), UNPLACED, { view: "mirror", room: "" })).toMatchObject({ view: "mirror", fromMap: false });
  });

  it("follows the map's entry at boot when set up from it", () => {
    const c = applyPick(base(), pickOf(show, spot(show, "hall")));
    expect(followMap(c, show)).toBeNull();
    const changed: HouseMap = { ...show, terminals: show.terminals.map((t) => (t.id === "hall" ? { ...t, name: "Hallway", view: "mirror" as const } : t)) };
    expect(followMap(c, changed)).toMatchObject({ name: "Hallway", view: "mirror" });
    expect(followMap({ ...c, fromMap: false }, changed)).toBeNull();
    expect(followMap(c, { ...show, terminals: [] })).toBeNull();
    // The shed variant: the same spot, the same screen.
    expect(followMap(applyPick(base(), pickOf(show, spot(show, "graphics-card"))), shed)).toBeNull();
  });
});

describe("the map's voice link (wave 19)", () => {
  it("the tent takes no part, on both variants; unplaced neither", () => {
    expect(pickOf(show, spot(show, "tent")).voice).toBe(false);
    expect(pickOf(shed, spot(shed, "tent")).voice).toBe(false);
    expect(UNPLACED.voice).toBe(false);
    const unset = { ...spot(show, "tent"), voice: undefined };
    delete unset.voice;
    // Unset in the spawn room: still off; `voice: true` turns it on.
    expect(pickOf(show, unset).voice).toBe(false);
    expect(pickOf(show, { ...unset, voice: true }).voice).toBe(true);
    expect(pickOf(show, { ...spot(show, "hall"), voice: false }).voice).toBe(false);
  });
  it("a tap / a link copies it into the config", () => {
    expect(applyPick(base(), pickOf(show, spot(show, "tent")))).toMatchObject({ spot: "tent", voiceLink: false });
    expect(applyPick(base({ voiceLink: false }), pickOf(show, spot(show, "hall")))).toMatchObject({ voiceLink: true });
    expect(applyPick(base(), UNPLACED).voiceLink).toBe(false);
    // An old fleet link (it names a view) still takes the map's link.
    expect(urlConfig(base({ spot: "tent", view: "world" }), { spot: "tent", name: "Tent", view: "world", room: null }, show).voiceLink).toBe(false);
    expect(urlConfig(base({ spot: "tent" }), { spot: "tent", name: null, view: null, room: null }, show).voiceLink).toBe(false);
  });
  it("follows a director turning a spot's link on or off", () => {
    const c = applyPick(base(), pickOf(show, spot(show, "hall")));
    const off: HouseMap = { ...show, terminals: show.terminals.map((t) => (t.id === "hall" ? { ...t, voice: false } : t)) };
    expect(followMap(c, off)).toMatchObject({ voiceLink: false, name: c.name });
    expect(followVoice(c, show)).toBeNull();
    // Not set up from the map: only the link follows.
    expect(followVoice({ ...c, fromMap: false, name: "Mine" }, off)).toMatchObject({ voiceLink: false, name: "Mine" });
    expect(followVoice({ ...c, spot: "" }, off)).toBeNull();
    expect(followVoice({ ...c, spot: "nowhere" }, off)).toBeNull();
  });
});
