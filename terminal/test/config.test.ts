import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIG_KEY, DEFAULT_TV_ROOM, adoptCharacter, announceChoiceValue, announceFromChoice, storedAnnounce, canonicalCharacter, castCheckKey, characterProblem, defaultConfig, hintsFromSearch, loadConfig, pickCharacter, provision, roomOf, saveConfig, savedCharacter, tvRoomOf, voiceChoiceOf, withoutSecrets } from "../src/config.ts";
import { CAST_LOOKUP_MS, characterIdOf, fetchCharacters } from "../src/pilot.ts";

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
}

describe("terminal config", () => {
  it("round-trips, filling defaults for older stored shapes", () => {
    const s = memory();
    saveConfig(defaultConfig({ eventId: "evt", token: "t", name: "Kitchen" }), s);
    const back = loadConfig(s);
    expect(back).toMatchObject({ eventId: "evt", token: "t", name: "Kitchen", character: "Trabolta", engine: "browser", camera: "user", speed: 1, spot: "", view: "auto", announce: null });
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t" }));
    expect(loadConfig(s)).toMatchObject({ character: "Trabolta", spot: "", view: "auto" });
  });
  it("is full screen by default; a stored off stays off", () => {
    const s = memory();
    saveConfig(defaultConfig({ eventId: "evt", token: "t" }), s);
    expect(loadConfig(s)?.fullscreen).toBe(true);
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t" }));
    expect(loadConfig(s)?.fullscreen).toBe(true); // an older stored shape
    saveConfig(defaultConfig({ eventId: "evt", token: "t", fullscreen: false }), s);
    expect(loadConfig(s)?.fullscreen).toBe(false);
  });
  it("keeps a placed spot and view, and repairs junk ones", () => {
    const s = memory();
    saveConfig(defaultConfig({ eventId: "evt", token: "t", spot: "start-bar", view: "mirror" }), s);
    expect(loadConfig(s)).toMatchObject({ spot: "start-bar", view: "mirror" });
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", spot: 7, view: "hologram" }));
    expect(loadConfig(s)).toMatchObject({ spot: "", view: "auto" });
  });
  it("keeps the TV's view and room; a blank room is the Desktop", () => {
    const s = memory();
    saveConfig(defaultConfig({ eventId: "evt", token: "t", view: "tv", room: "The Kitchen" }), s);
    expect(loadConfig(s)).toMatchObject({ view: "tv", room: "The Kitchen" });
    expect(tvRoomOf(loadConfig(s)!)).toBe("The Kitchen");
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", view: "tv", room: 3 }));
    expect(tvRoomOf(loadConfig(s)!)).toBe(DEFAULT_TV_ROOM);
    expect(DEFAULT_TV_ROOM).toBe("The Desktop");
  });
  it("a room on any other view is the LOCATION the terminal belongs to (wave 7); the TV's room is only its voice", () => {
    const s = memory();
    saveConfig(defaultConfig({ eventId: "evt", token: "t", view: "face", spot: "server-room", room: "The Server Room" }), s);
    const back = loadConfig(s)!;
    expect(back).toMatchObject({ view: "face", room: "The Server Room" });
    expect(roomOf(back)).toBe("The Server Room");
    expect(roomOf({ view: "auto", room: "  The Server Room " })).toBe("The Server Room");
    expect(roomOf({ view: "mirror", room: "The Server Room" })).toBe("The Server Room");
    expect(roomOf({ view: "face", room: " " })).toBeNull();
    expect(roomOf({ view: "tv", room: "The Desktop" })).toBeNull();
    // The tent laptop (wave 18b) belongs to no room either: the Internet's lines are per-guest DMs.
    expect(roomOf({ view: "reinstall", room: "The Internet" })).toBeNull();
    expect(hintsFromSearch("?code=M&spot=tent&view=reinstall").view).toBe("reinstall");
    // Provisioning keeps the room hint for a non-TV view.
    const h = hintsFromSearch("?code=M&name=Server%20Room&character=Trabolta&spot=server-room&view=face&room=The%20Server%20Room");
    expect(h).toMatchObject({ name: "Server Room", spot: "server-room", view: "face", room: "The Server Room" });
    expect(withoutSecrets("?code=M&room=The%20Server%20Room&view=face")).toBe("");
  });
  it("keeps the chess view (wave 11): it belongs to no room, whatever room it was given", () => {
    const s = memory();
    saveConfig(defaultConfig({ eventId: "evt", token: "t", view: "chess", spot: "server-room-door", room: "The Server Room" }), s);
    const back = loadConfig(s)!;
    expect(back).toMatchObject({ view: "chess", spot: "server-room-door" });
    expect(roomOf(back)).toBeNull();
    const h = hintsFromSearch("?code=M&name=Server%20Door&spot=server-room-door&view=chess");
    expect(h).toMatchObject({ name: "Server Door", spot: "server-room-door", view: "chess", character: null, room: null });
    expect(withoutSecrets("?code=M&name=Server%20Door&spot=server-room-door&view=chess")).toBe("");
  });
  it("refuses a config with no event or token, or junk", () => {
    const s = memory();
    expect(loadConfig(s)).toBeNull();
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt" }));
    expect(loadConfig(s)).toBeNull();
    s.setItem(CONFIG_KEY, "{not json");
    expect(loadConfig(s)).toBeNull();
  });
  it("reads provisioning hints off the URL and scrubs them back out", () => {
    const h = hintsFromSearch("?code=MOD111&name=Kitchen&character=Trabolta&camera=environment&engine=browser&spot=start-bar&view=world&keep=1");
    expect(h).toEqual({ code: "MOD111", name: "Kitchen", character: "Trabolta", camera: "environment", engine: "browser", spot: "start-bar", view: "world", room: null, announce: null, camFeed: null, mic: null, voices: null, door: null, keys: null, bay: null });
    expect(withoutSecrets("?code=MOD111&name=Kitchen&spot=start-bar&view=mirror&keep=1")).toBe("?keep=1");
    expect(withoutSecrets("?code=MOD111")).toBe("");
    // The TV (K-18): view=tv + the room it speaks for.
    expect(hintsFromSearch("?code=M&name=TV&spot=desktop-tv&view=tv&room=The%20Desktop")).toMatchObject({ view: "tv", room: "The Desktop", spot: "desktop-tv" });
    expect(withoutSecrets("?view=tv&room=The%20Desktop&keep=1")).toBe("?keep=1");
    expect(hintsFromSearch("?camera=sideways&engine=loud&view=hologram&spot=%20")).toMatchObject({ camera: null, engine: null, code: "", view: null, spot: null });
  });
  it("the device's own voice is the default; the old `auto` reads as it, `server` stays an opt-in", () => {
    const s = memory();
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", engine: "auto" }));
    expect(loadConfig(s)?.engine).toBe("browser");
    for (const engine of ["server", "fully", "silent", "browser"] as const) {
      s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", engine }));
      expect(loadConfig(s)?.engine).toBe(engine);
    }
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", engine: "kokoro" }));
    expect(loadConfig(s)?.engine).toBe("browser");
    expect(voiceChoiceOf(undefined)).toBe("browser");
    expect(hintsFromSearch("?engine=auto").engine).toBe("browser");
    expect(hintsFromSearch("?engine=fully").engine).toBe("fully");
    expect(hintsFromSearch("?engine=server").engine).toBe("server");
    expect(hintsFromSearch("").engine).toBeNull();
  });
  it("announcements follow the house setting unless provisioned always / never (N-09, wave 18b Q8)", () => {
    const s = memory();
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t" }));
    expect(loadConfig(s)?.announce).toBeNull();
    saveConfig(defaultConfig({ eventId: "evt", token: "t", announce: true }), s);
    expect(loadConfig(s)?.announce).toBe(true);
    // Never, saved now, stays never.
    saveConfig(defaultConfig({ eventId: "evt", token: "t", announce: false }), s);
    expect(loadConfig(s)?.announce).toBe(false);
    saveConfig(defaultConfig({ eventId: "evt", token: "t", announce: null }), s);
    expect(loadConfig(s)?.announce).toBeNull();
    // A false stored before wave 18b (no `announceMode`) was the old default: the house setting.
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", announce: false }));
    expect(loadConfig(s)?.announce).toBeNull();
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", announce: true }));
    expect(loadConfig(s)?.announce).toBe(true);
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", announce: "yes", announceMode: "never" }));
    expect(loadConfig(s)?.announce).toBeNull();
    // An earlier draft's `v` marker means nothing: false without the mode is the house setting.
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", announce: false, v: 2 }));
    expect(loadConfig(s)?.announce).toBeNull();
    // Neither marker leaks into the config.
    expect(loadConfig(s)).not.toHaveProperty("v");
    expect(loadConfig(s)).not.toHaveProperty("announceMode");
    expect(storedAnnounce(false, undefined)).toBeNull();
    expect(storedAnnounce(false, "house")).toBeNull();
    expect(storedAnnounce(false, "never")).toBe(false);
    expect(storedAnnounce(true, "house")).toBe(true);
  });

  it("a rollback's re-save never turns the house setting into Never (wave 18b Q8)", () => {
    const s = memory();
    saveConfig(defaultConfig({ eventId: "evt", token: "t", announce: null }), s);
    // A pre-18b build loads `announce: c.announce === true` over a spread of the
    // stored fields, then saves the whole config back.
    const stored = JSON.parse(s.getItem(CONFIG_KEY)!) as Record<string, unknown>;
    s.setItem(CONFIG_KEY, JSON.stringify({ ...stored, announce: stored["announce"] === true }));
    // Re-shipped: still the house setting.
    expect(loadConfig(s)?.announce).toBeNull();
    // Never, saved by this build and re-saved by the old one, stays Never.
    saveConfig(defaultConfig({ eventId: "evt", token: "t", announce: false }), s);
    const never = JSON.parse(s.getItem(CONFIG_KEY)!) as Record<string, unknown>;
    s.setItem(CONFIG_KEY, JSON.stringify({ ...never, announce: never["announce"] === true }));
    expect(loadConfig(s)?.announce).toBe(false);
  });

  it("the announce choice maps both ways", () => {
    expect(announceChoiceValue(null)).toBe("house");
    expect(announceChoiceValue(true)).toBe("always");
    expect(announceChoiceValue(false)).toBe("never");
    for (const v of [true, false, null]) expect(announceFromChoice(announceChoiceValue(v))).toBe(v);
    expect(announceFromChoice("bogus")).toBeNull();
    expect(hintsFromSearch("?announce=1").announce).toBe(true);
    expect(hintsFromSearch("?announce=on").announce).toBe(true);
    expect(hintsFromSearch("?announce=0").announce).toBe(false);
    expect(hintsFromSearch("?announce=maybe").announce).toBeNull();
    expect(withoutSecrets("?announce=1&keep=1")).toBe("?keep=1");
  });
});

describe("the provisioned character is the story's own name (B19)", () => {
  const cast = ["Trabolta", "Clippy", "Task Manager"];
  const hints = { name: "Lower", character: null, camera: null, engine: null, spot: null, view: null, room: null, announce: null };
  afterEach(() => vi.unstubAllGlobals());
  /** A fake event server answering resolve-code + mod login. */
  function server(characters: string[]) {
    vi.stubGlobal("fetch", async (url: string) => {
      const body = url === "/api/resolve-code" ? { eventId: "evt", role: "mod", title: "T", characters } : { token: "mod-token" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
  }

  it("folds a typed name onto the cast: case, spaces, _ and - don't count", () => {
    expect(canonicalCharacter("trabolta", cast)).toBe("Trabolta");
    expect(canonicalCharacter("TASK_MANAGER", cast)).toBe("Task Manager");
    expect(canonicalCharacter("task-manager", cast)).toBe("Task Manager");
    expect(canonicalCharacter("Trabolta", cast)).toBe("Trabolta");
    expect(canonicalCharacter("nobody", cast)).toBeNull();
  });
  it("a name the story lacks is an error naming the cast; no list keeps it as typed", () => {
    expect(() => pickCharacter("Trabolt", cast)).toThrow(/no character called "Trabolt".*Trabolta, Clippy/);
    expect(pickCharacter("trabolta", [])).toBe("trabolta");
    expect(pickCharacter(null, cast)).toBe("Trabolta");
    expect(pickCharacter(" ", ["Clippy"])).toBe("Clippy");
  });
  it("provision stores the canonical name, and refuses one the story doesn't have", async () => {
    server(cast);
    const c = await provision("MOD7324", { ...hints, character: "trabolta" });
    expect(c.character).toBe("Trabolta");
    await expect(provision("MOD7324", { ...hints, character: "nobody" })).rejects.toThrow(/no character called "nobody"/);
    // A room terminal's room rides through provisioning.
    expect(await provision("MOD7324", { ...hints, view: "face", spot: "server-room", room: "The Server Room" })).toMatchObject({ view: "face", spot: "server-room", room: "The Server Room" });
    // A mod code resolves the declared cast before the doors open too
    // (`EventRuntime.declaredCharacters`), so only a server with no cast to
    // give (no story loaded, or one that won't compile) lists nobody: kept as
    // typed, adopted later.
    server([]);
    expect((await provision("MOD7324", { ...hints, character: "trabolta" })).character).toBe("trabolta");
  });
  it("a stored variant adopts the screen state's id; a different name is left alone", () => {
    const c = defaultConfig({ eventId: "evt", token: "t", character: "trabolta" });
    expect(adoptCharacter(c, "Trabolta")?.character).toBe("Trabolta");
    expect(adoptCharacter({ ...c, character: "Trabolta" }, "Trabolta")).toBeNull();
    expect(adoptCharacter(c, "Clippy")).toBeNull();
    expect(adoptCharacter(c, null)).toBeNull();
  });
  it("the pilot's thread is dm:<the guest view's own id>", () => {
    const people = [
      { id: "Pong", name: "Pong", kind: "guest" as const, faction: null, known: [], location: null },
      { id: "Trabolta", name: "Trabolta", kind: "character" as const, faction: null, known: [], location: null },
    ];
    expect(characterIdOf("trabolta", { people })).toBe("Trabolta");
    expect(characterIdOf("trabolta", null)).toBe("trabolta");
    expect(characterIdOf("Trabolta", { people: [] })).toBe("Trabolta");
  });
});

describe("the ⚙ save never waits on a stalled server", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const cast = ["Trabolta", "Clippy"];

  it("an unchanged character saves with no lookup at all", async () => {
    const lookup = vi.fn(async () => cast);
    expect(await savedCharacter("", "trabolta", lookup)).toBe("trabolta");
    expect(await savedCharacter(" trabolta ", "trabolta", lookup)).toBe("trabolta");
    expect(lookup).not.toHaveBeenCalled();
  });
  it("a new name is checked against the cast; a failed lookup keeps it as typed", async () => {
    expect(await savedCharacter("clippy", "Trabolta", async () => cast)).toBe("Clippy");
    await expect(savedCharacter("Clipy", "Trabolta", async () => cast)).rejects.toThrow(/no character called "Clipy"/);
    expect(await savedCharacter("clippy", "Trabolta", async () => Promise.reject(new Error("timed out")))).toBe("clippy");
  });
  it("the cast lookup gives up after CAST_LOOKUP_MS on a server that never answers", async () => {
    vi.useFakeTimers();
    let aborted = false;
    // Reachable but silent: the request only ends when it is aborted.
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => ((aborted = true), reject(new Error("aborted"))))));
    const c = defaultConfig({ eventId: "evt", token: "t", character: "Trabolta" });
    const saved = savedCharacter("clippy", "Trabolta", () => fetchCharacters(c));
    await vi.advanceTimersByTimeAsync(CAST_LOOKUP_MS);
    expect(await saved).toBe("clippy");
    expect(aborted).toBe(true);
    expect(CAST_LOOKUP_MS).toBeLessThanOrEqual(3_000);
  });
});

describe("a misspelt character stored unchecked is reported by the cast check (B19)", () => {
  const cast = ["Trabolta", "Clippy"];
  const c = defaultConfig({ eventId: "evt", token: "t", character: "Trabolt" });
  const poll = (character: unknown, announceEpoch: string | null) => ({ character, announceEpoch });

  it("the screen state naming no character asks the cast once per event × character × sim", () => {
    // Before the doors: no sim, so the screen state names no character —
    // asked, and the cast read answers with the declared cast.
    const before = castCheckKey(c, poll(null, "boot.0"));
    expect(before).not.toBeNull();
    // The doors open: a new sim, a new key, so the cast is asked again.
    const after = castCheckKey(c, poll(null, "boot.1"));
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(castCheckKey(c, poll(null, "boot.1"))).toBe(after);
    expect(castCheckKey({ ...c, character: "Clippy" }, poll(null, "boot.1"))).not.toBe(after);
    // The story knows the character, or nothing polled yet: nothing to ask.
    expect(castCheckKey(c, poll({ id: "Trabolta" }, "boot.1"))).toBeNull();
    expect(castCheckKey(c, null)).toBeNull();
    expect(castCheckKey({ ...c, character: "" }, poll(null, "boot.1"))).toBeNull();
  });
  it("an empty cast is no error (nothing to check against); a name the story lacks is, naming the cast", () => {
    expect(characterProblem("Trabolt", [])).toBeNull();
    expect(characterProblem("Trabolt", cast)).toBe('The story has no character called "Trabolt" (it has: Trabolta, Clippy).');
    expect(characterProblem("trabolta", cast)).toBeNull();
    expect(() => pickCharacter("Trabolt", cast)).toThrow(characterProblem("Trabolt", cast)!);
  });
});

import { VIEWS, VIEW_INFO, roomChoices, spotChoices, spotProblem } from "../src/config.ts";
import { twoRooms } from "./world-fixture.ts";

describe("wave 14 config", () => {
  it("knows the shadow view and describes every view", () => {
    expect(VIEWS).toContain("shadow");
    expect(VIEWS).toContain("reinstall");
    for (const v of VIEWS) expect(VIEW_INFO[v].length).toBeGreaterThan(3);
    expect(hintsFromSearch("?code=X&view=shadow").view).toBe("shadow");
  });
  it("keeps the camera feed on unless told otherwise", () => {
    const s = memory();
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "e", token: "t" }));
    expect(loadConfig(s)?.camFeed).toBe(true);
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "e", token: "t", camFeed: false }));
    expect(loadConfig(s)?.camFeed).toBe(false);
    expect(hintsFromSearch("?code=X&cam=0").camFeed).toBe(false);
    expect(hintsFromSearch("?code=X").camFeed).toBeNull();
    expect(withoutSecrets("?code=X&cam=1&keep=1")).toBe("?keep=1");
  });
  it("lists the map's spots and rooms, and warns of an unknown spot", () => {
    const h = twoRooms();
    const house = { ...h, rooms: h.rooms.map((r, i) => ({ ...r, location: i === 0 ? "The Kitchen" : "the kitchen" })) };
    expect(spotChoices(house)).toEqual([{ value: "ta", label: "ta — A (The Kitchen)" }]);
    expect(roomChoices(house)).toEqual([{ value: "The Kitchen", label: "The Kitchen" }]);
    expect(spotChoices(null)).toEqual([]);
    expect(spotProblem("ta", house)).toBeNull();
    expect(spotProblem("", house)).toBeNull();
    expect(spotProblem("nope", house)).toContain('"nope"');
  });
});

describe("wave 19 config: the voice link", () => {
  it("keeps the players' voices on and the microphone at the view's default unless told otherwise", () => {
    const s = memory();
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "e", token: "t" }));
    const c = loadConfig(s)!;
    expect(c.voices).toBe(true);
    expect(c.voiceLink).toBe(true);
    expect("mic" in c).toBe(false);
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "e", token: "t", mic: false, voices: false, voiceLink: false }));
    expect(loadConfig(s)).toMatchObject({ mic: false, voices: false, voiceLink: false });
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "e", token: "t", mic: "yes" }));
    expect("mic" in loadConfig(s)!).toBe(false);
    saveConfig(defaultConfig({ eventId: "e", token: "t", view: "tv", mic: true }), s);
    expect(loadConfig(s)?.mic).toBe(true);
  });
  it("reads mic= / voices= off the URL and scrubs them", () => {
    expect(hintsFromSearch("?code=X&mic=0&voices=off")).toMatchObject({ mic: false, voices: false });
    expect(hintsFromSearch("?code=X&mic=1").mic).toBe(true);
    expect(hintsFromSearch("?code=X")).toMatchObject({ mic: null, voices: null });
    expect(withoutSecrets("?code=X&mic=1&voices=0&keep=1")).toBe("?keep=1");
  });
  it("provisions the URL's switches, leaving the microphone to the view when not given", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const body = url.endsWith("/api/resolve-code") ? { eventId: "evt", role: "mod", title: "T", characters: [] } : { token: "tok" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const none = await provision("MOD", { ...hintsFromSearch("?code=MOD"), name: null });
      expect("mic" in none).toBe(false);
      expect(none.voices).toBe(true);
      const tv = await provision("MOD", hintsFromSearch("?code=MOD&view=tv&mic=1&voices=0"));
      expect(tv).toMatchObject({ view: "tv", mic: true, voices: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
