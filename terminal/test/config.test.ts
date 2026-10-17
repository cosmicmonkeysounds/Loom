import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIG_KEY, DEFAULT_TV_ROOM, adoptCharacter, canonicalCharacter, defaultConfig, hintsFromSearch, loadConfig, pickCharacter, provision, saveConfig, savedCharacter, tvRoomOf, voiceChoiceOf, withoutSecrets } from "../src/config.ts";
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
    expect(back).toMatchObject({ eventId: "evt", token: "t", name: "Kitchen", character: "Trabolta", engine: "browser", camera: "user", speed: 1, spot: "", view: "auto", announce: false });
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t" }));
    expect(loadConfig(s)).toMatchObject({ character: "Trabolta", spot: "", view: "auto" });
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
    expect(h).toEqual({ code: "MOD111", name: "Kitchen", character: "Trabolta", camera: "environment", engine: "browser", spot: "start-bar", view: "world", room: null, announce: null });
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
  it("announcements are off unless provisioned on (N-09)", () => {
    const s = memory();
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t" }));
    expect(loadConfig(s)?.announce).toBe(false);
    saveConfig(defaultConfig({ eventId: "evt", token: "t", announce: true }), s);
    expect(loadConfig(s)?.announce).toBe(true);
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "evt", token: "t", announce: "yes" }));
    expect(loadConfig(s)?.announce).toBe(false);
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
    // Before the doors open the server lists nobody: kept as typed, adopted later.
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
