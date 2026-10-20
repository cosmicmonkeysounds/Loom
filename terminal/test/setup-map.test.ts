import { describe, expect, it } from "vitest";
import { TERMINAL_VIEWS, validateHouse, type HouseMap } from "@loom/house";
import showHouse from "../../core/examples/trapped-in-the-internet/house.json";
import shedHouse from "../../core/examples/trapped-in-the-internet/house.shed.json";
import { VIEWS, defaultConfig, type TerminalConfig } from "../src/config.ts";
import { UNPLACED, applyPick, followMap, groupTerminals, onlineBadge, pickOf, screenWords, urlConfig } from "../src/setup-map.ts";

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
    expect(pickOf(show, spot(show, "desktop-tv"))).toEqual({ spot: "desktop-tv", name: "TV", view: "tv", room: "" });
    expect(pickOf(show, spot(show, "server-room"))).toEqual({ spot: "server-room", name: "Server Room", view: "face", room: "The Server Room" });
    expect(pickOf(show, spot(show, "server-room-door"))).toEqual({ spot: "server-room-door", name: "Server Door", view: "chess", room: "" });
    expect(pickOf(show, spot(show, "graphics-card"))).toEqual({ spot: "graphics-card", name: "Casino", view: "casino", room: "" });
    expect(pickOf(show, spot(show, "start-bar"))).toEqual({ spot: "start-bar", name: "Start Bar", view: "auto", room: "" });
  });

  it("speaks is ignored on the TV, the board and the casino", () => {
    for (const view of ["tv", "chess", "casino"] as const) expect(pickOf(show, { ...spot(show, "server-room"), view, speaks: true }).room).toBe("");
    expect(pickOf(show, { ...spot(show, "hall"), speaks: true }).room).toBe("The Tube");
  });
});

describe("screenWords + groupTerminals", () => {
  it("names each screen in words", () => {
    expect(screenWords({ view: "tv", room: "" })).toMatch(/^TV/);
    expect(screenWords({ view: "casino", room: "" })).toBe("casino");
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
  });

  it("an old link's name / view / room win; a manual view stops following", () => {
    const given = base({ spot: "server-room", name: "Heart", view: "world", room: "" });
    const c = urlConfig(given, { spot: "server-room", name: "Heart", view: "world", room: null }, show);
    expect(c).toMatchObject({ name: "Heart", view: "world", room: "The Server Room", fromMap: false });
    const named = urlConfig(given, { spot: "server-room", name: "Heart", view: null, room: null }, show);
    expect(named).toMatchObject({ name: "Heart", view: "face", fromMap: true });
  });

  it("no map / a spot it lacks: the link as given", () => {
    const given = base({ spot: "nowhere", name: "X" });
    expect(urlConfig(given, { spot: "nowhere", name: "X", view: null, room: null }, show)).toBe(given);
    expect(urlConfig(given, { spot: "nowhere", name: "X", view: null, room: null }, null)).toBe(given);
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
