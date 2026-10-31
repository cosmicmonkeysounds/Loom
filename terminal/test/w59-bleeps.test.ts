//! Wave 59: no ad sounds or bleeps on the TV, the tent and the server room.
//! The option is per terminal, on a link and in ⚙, and a saved choice wins. A
//! source walk pins that nothing makes a sound round the bus's gate.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_KEY, QUIET_SPOTS, bleepsOn, defaultConfig, hintsFromSearch, keepBleeps, loadConfig, saveConfig, withoutSecrets } from "../src/config.ts";
import { TV_ASKED_VOLUME, VIEW_VOLUME, effectsLevel, playChime, playNotes, setBleeps, setSoundContext, setSoundMuted, setSoundView, sfx, sfxGate, soundOutput, voiceNoise, voicesOut, type SoundContext } from "../src/sound/bus.ts";
import { SFX_NAMES } from "../src/sound/library.ts";
import { FakeAudioContext } from "./fake-audio.ts";

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 };
}

describe("which terminals make bleeps", () => {
  const at = (spot: string, view = "auto") => ({ spot, view: view as "auto" });
  it("none on the TV, the tent and the server room; everywhere else as ever", () => {
    expect(QUIET_SPOTS).toEqual(["desktop-tv", "tent", "server-room"]);
    for (const spot of QUIET_SPOTS) expect(bleepsOn(at(spot))).toBe(false);
    for (const spot of ["start-bar", "hall", "server-room-door", "graphics-card", ""]) expect(bleepsOn(at(spot))).toBe(true);
  });
  it("the same screens, however the tablet was placed", () => {
    expect(bleepsOn(at("", "tv"))).toBe(false);
    expect(bleepsOn(at("", "reinstall"))).toBe(false);
    expect(bleepsOn({ ...at(""), crt: true })).toBe(false);
  });
  it("a saved choice wins, both ways", () => {
    expect(bleepsOn({ ...at("tent"), bleeps: true })).toBe(true);
    expect(bleepsOn({ ...at("start-bar"), bleeps: false })).toBe(false);
  });
  it("comes off a link, is scrubbed from the bar, and survives a reload", () => {
    expect(hintsFromSearch("?bleeps=0").bleeps).toBe(false);
    expect(hintsFromSearch("?bleeps=1").bleeps).toBe(true);
    expect(hintsFromSearch("?spot=tent").bleeps).toBe(null);
    expect(withoutSecrets("?bleeps=0&x=1")).toBe("?x=1");
    const s = memory();
    saveConfig({ ...defaultConfig({ eventId: "e", token: "t", spot: "tent" }), bleeps: true }, s);
    expect(loadConfig(s)?.bleeps).toBe(true);
    saveConfig(defaultConfig({ eventId: "e", token: "t", spot: "tent" }), s);
    expect("bleeps" in loadConfig(s)!).toBe(false);
    s.setItem(CONFIG_KEY, JSON.stringify({ eventId: "e", token: "t", bleeps: "no" }));
    expect("bleeps" in loadConfig(s)!).toBe(false);
  });
  it("the terminal's own link opened again keeps ⚙'s choice", () => {
    const link = defaultConfig({ eventId: "e", token: "t2", spot: "optical-drive" });
    const saved = (bleeps?: boolean, spot = "optical-drive") => ({ ...defaultConfig({ eventId: "e", token: "t1", spot }), ...(bleeps === undefined ? {} : { bleeps }) });
    expect(keepBleeps(link, saved(false), { bleeps: null }).bleeps).toBe(false);
    expect(keepBleeps(link, saved(true), {}).bleeps).toBe(true);
    // The rest is the link's: only the choice carries over.
    expect(keepBleeps(link, saved(false), { bleeps: null }).token).toBe("t2");
  });
  it("a link that says wins, and nothing carries to another spot", () => {
    const link = defaultConfig({ eventId: "e", token: "t", spot: "tent" });
    const saved = { ...link, bleeps: false };
    expect(keepBleeps({ ...link, bleeps: true }, saved, { bleeps: true }).bleeps).toBe(true);
    expect("bleeps" in keepBleeps(link, { ...saved, spot: "start-bar" }, { bleeps: null })).toBe(false);
    expect("bleeps" in keepBleeps(link, null, { bleeps: null })).toBe(false);
    expect("bleeps" in keepBleeps(link, defaultConfig({ eventId: "e", token: "t", spot: "tent" }), { bleeps: null })).toBe(false);
  });
  it("is what the app's link goes through", () => {
    const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
    expect(app).toMatch(/keepBleeps\(linkConfig\(given, hints, house\), loadConfig\(\), hints\)/u);
  });
});

describe("the bus with no bleeps", () => {
  let ctx: FakeAudioContext;
  beforeEach(() => {
    ctx = new FakeAudioContext();
    setSoundContext(ctx as unknown as SoundContext);
    setSoundMuted(false);
    setSoundView("auto");
    setBleeps(false);
  });
  afterEach(() => {
    setBleeps(true);
    setSoundContext(undefined);
  });
  it("schedules no effect at all, not one on a silent bus", () => {
    expect(sfxGate({ running: true, muted: false, floorBusy: false, over: true, bleeps: false }).play).toBe(false);
    for (const name of SFX_NAMES) expect(sfx(name, { over: true })).toBe(false);
    playNotes([[523, 0.1]], { wave: "square", peak: 0.06, attack: 0.01 });
    expect(ctx.sources.length).toBe(0);
  });
  it("keeps what isn't one: the chime, his voice's noise, the players' bus, the game's output", () => {
    void playChime();
    expect(ctx.sources.length).toBe(4);
    expect(voiceNoise("tick")).toBe(true);
    expect(ctx.sources.length).toBeGreaterThan(4);
    expect(voicesOut()).not.toBe(null);
    expect(soundOutput()).not.toBe(null);
  });
  it("hears them again once the option is off", () => {
    setBleeps(true);
    expect(sfx("blip")).toBe(true);
  });
});

describe("the effects' level", () => {
  it("is the view's, none on the CRT or the TV", () => {
    expect(effectsLevel({ view: "auto" })).toBe(VIEW_VOLUME.other);
    expect(effectsLevel({ view: "tv" })).toBe(VIEW_VOLUME.tv);
    expect(effectsLevel({ view: "face", crt: true })).toBe(0);
  });
  it("a tick off in ⚙ is really heard, even on the TV and the CRT", () => {
    expect(effectsLevel({ view: "tv", bleeps: true })).toBe(TV_ASKED_VOLUME);
    expect(effectsLevel({ view: "face", crt: true, bleeps: true })).toBe(VIEW_VOLUME.other);
  });
});

/** Every source file under `dir`. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/u.test(f) ? [p] : [];
  });
}

describe("every sound in terminal/src", () => {
  const src = join(__dirname, "..", "src");
  const files = walk(src).map((p) => ({ p: p.slice(src.length + 1), text: readFileSync(p, "utf8") }));
  const using = (re: RegExp) => files.filter((f) => re.test(f.text)).map((f) => f.p).sort();
  it("only the bus and the two audited players touch an oscillator or a buffer source", () => {
    expect(using(/\.createOscillator\(|\.createBufferSource\(/u)).toEqual(["sound/bus.ts", "speech/engine.ts", "voice/playback.ts"]);
  });
  it("a page's own Audio or media element plays nothing else: the slide clip's sound is the story's, the rest are muted", () => {
    expect(using(/new Audio\(/u)).toEqual([]);
    expect(using(/createElement\("audio"\)|<audio/u)).toEqual([]);
    // Wave 59a: the audio ads' one element (play's `ad-player.ts`) is the one way
    // past, and it goes through `adsHere`, which asks `bleepsOn` first.
    expect(using(/ad-player/u)).toEqual(["ad-spot.ts"]);
    expect(files.find((f) => f.p === "ad-spot.ts")!.text).toMatch(/bleepsOn\(c\) &&/u);
    expect(files.find((f) => f.p === "AdSpot.tsx")!.text).toMatch(/l\.here \?/u);
    for (const f of files) {
      if (!/createElement\("video"\)/u.test(f.text)) continue;
      expect(f.text, f.p).toMatch(/\.muted = true/u);
    }
    for (const p of ["scanner.tsx", "shadow/ShadowView.tsx"]) expect(files.find((f) => f.p === p)!.text).toMatch(/<video[^>]* muted /u);
  });
  it("the casino's jingles go through `playNotes`, and the game's output stays the tent's only bypass", () => {
    expect(using(/\bplayNotes\(/u).filter((p) => p !== "sound/bus.ts")).toEqual(["casino/CasinoTerminal.tsx"]);
    expect(using(/\bsoundOutput\b/u).filter((p) => p !== "sound/bus.ts")).toEqual(["reinstall/ReinstallTerminal.tsx"]);
  });
});

describe("the hidden ⚙", () => {
  const css = readFileSync(join(__dirname, "..", "src", "styles.css"), "utf8");
  it("is invisible at rest and shows only while held, on every view", () => {
    expect(css).toMatch(/button\.gear \{[^}]*opacity: 0;/u);
    expect(css).toMatch(/button\.gear\.holding \{ opacity: 1; \}/u);
    expect(/\.screen-gear \{[^}]*\}/u.exec(css)![0]).not.toMatch(/opacity/u);
    // Nothing else draws a gear: every view uses the one `Gear`.
    const src = join(__dirname, "..", "src");
    for (const p of walk(src)) if (!p.endsWith("controls.tsx")) expect(readFileSync(p, "utf8"), p).not.toMatch(/>\s*⚙\s*</u);
  });
  it("keeps a target a finger can find, and never takes the press away", () => {
    expect(css).toMatch(/button\.gear::before \{[^}]*position: absolute;[^}]*left: -14px;/u);
    expect(/button\.gear \{[^}]*\}/u.exec(css)![0]).not.toMatch(/pointer-events|visibility|display/u);
  });
});
