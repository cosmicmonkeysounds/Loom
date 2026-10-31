//! A terminal's standing configuration — set once per tablet, kept in
//! `localStorage`, and bootstrappable from the URL so a fleet is provisioned
//! by opening one link on each:
//!
//!   /terminal/?code=<mod passcode>&name=Kitchen&character=Trabolta&spot=start-bar&view=auto
//!
//! The TV (the house Mac, Chrome full screen over the long HDMI — K-18):
//!
//!   /terminal/?code=<mod passcode>&name=TV&character=Trabolta&spot=desktop-tv&view=tv
//!
//! Saying the house announcements (N-09 — the house system's lines, `do
//! announce "…"`) follows the house list by default (wave 18b, Q8: `audio.json`
//! `announce.terminals`, which the screen state answers as `spot.announce`);
//! `&announce=1` says them always, `&announce=0` never.
//!
//! A terminal that belongs to a room (wave 7 — the server-room terminal) adds
//! `&room=<LOCATION>` to any view but the TV:
//!
//!   /terminal/?code=<mod passcode>&name=Server Room&character=Trabolta&spot=server-room&view=face&room=The Server Room
//!
//! It sleeps (attract) until that LOCATION is open to everyone, speaks the
//! character's lines said in that room (the TV's voice path; the TV mute
//! never reaches it), shows no story slides or countdown corner (overlays
//! still cover it), and tells the story when a pass opens and closes a line
//! there (`terminal opened` / `terminal closed`, `pilot.ts`).
//!
//! The King's chess board outside the server-room door (wave 11, `view=chess`,
//! `chess/ChessTerminal.tsx`): awake all night, a pass scan deals one game
//! against the King at the strength his shared health bar sets, and the
//! result goes to the story as `chess won` / `lost` / `drawn`. It belongs to
//! no room and speaks for no character (`character` is only the poll's):
//!
//!   /terminal/?code=<mod passcode>&name=Server Door&spot=server-room-door&view=chess
//!
//! The casino in the upstairs bedroom (wave 15, `view=casino`,
//! `casino/CasinoTerminal.tsx`): awake all night like the board, a pass scan
//! seats a program to bet its own Truthcoin on the coin, under / over 7 and
//! the one-armed bandit — the server rolls every bet into their wallet:
//!
//!   /terminal/?code=<mod passcode>&name=Casino&spot=graphics-card&view=casino
//!
//! The tent laptop (wave 18b, `view=reinstall`, `reinstall/ReinstallTerminal.tsx`):
//! the reinstallation station — the idle show like any wall terminal, and a
//! marked pass plays the reinstallation game right here (or is sent to a
//! headset). Awake all night, no room, no line. The map's `tent` spot sets
//! the view and the name (the shed variant renames it *Shed*), so the link
//! never adds `&view=reinstall` (`docs/trapped/kiosk.md`):
//!
//!   /terminal/?code=<mod passcode>&spot=tent&announce=1
//!
//! Ad sounds and bleeps (wave 59, `bleepsOn`): the TV, the tent and the server
//! room make none by default; `&bleeps=1` / `&bleeps=0` or ⚙'s
//! `🔇 No ad sounds or bleeps` choose for one tablet, and the choice stays.
//!
//! The voice link (wave 19, `voice/`): a placed terminal's microphone is
//! heard in the reinstallation games at its screen, and the players near it
//! are heard out of its speaker. `&mic=0` / `&voices=0` turn either half off
//! for one tablet; the TV's microphone is off unless `&mic=1`, the mirror
//! takes no part, and neither does a spot the map's `voice` turns off (the
//! tent).
//!
//! The server-room terminal (wave 20) bridges the door sensor on the Grand
//! Central M4 plugged into its laptop (`&door=serial`, Web Serial: ⚙'s
//! *Connect door sensor* grants the port once) and has a keyboard; a
//! mouse-only rig adds `&keys=0` (no composer). `&door=sim` is the dev rig: the
//! keys O / C toggle a pretend door and F a fault. The same board reads the
//! patch bay (wave 22) and the terminal posts its combinations; `&bay=0`
//! turns that off (the door alone), and the sim fakes cables on Shift+digits.
//!
//!   /terminal/?code=<mod passcode>&spot=server-room&door=serial
//!
//! Wave 52: the server room has no mouse or keyboard on the night. A USB
//! webcam is its camera and microphone (`&webcam=C310`, part of its name), a
//! GameCube controller drives it (`&pad=1`) and spoken answers run through
//! whisper.cpp on the laptop (`&whisper=1`). Its screen is an old 4:3 CRT
//! (`&crt=1`, wave 52b: `crt/`):
//!
//!   /terminal/?code=<mod passcode>&spot=server-room&door=serial&camera=user&webcam=C310&pad=1&whisper=1&crt=1
//!
//! The mod passcode resolves (via `/api/resolve-code`) to the event and is
//! traded for a **moderator token** (`/api/mod/login`) — that is what lets
//! a terminal pilot a scanned guest through `/api/mod/impersonate`, and
//! what gates the (opt-in) server voice. The passcode itself is never stored.

import { api, ApiError } from "@loom/play/client.ts";
import { pauseOf, type VoiceChoice } from "./speech/engine.ts";

export interface TerminalConfig {
  eventId: string;
  /** The event's display title (from `/api/resolve-code`). */
  title: string;
  /** Moderator capability, scoped to the event. */
  token: string;
  /** This screen's name — journaled as `by` on everything piloted here. */
  name: string;
  /** The agent-voiced character this is a line to. */
  character: string;
  /** Speech (`speech/engine.ts`): `browser` — this device's own voice, the
   *  default (speechSynthesis → Fully Kiosk's TTS → text only); `fully` —
   *  Fully Kiosk's voice first; `silent` — text only; `server` — opt-in, the
   *  event server's `/api/mod/tts`, latching to the device voice when the
   *  server has none. */
  engine: VoiceChoice;
  /** A voice name for the server engine (empty = the server's default). */
  serverVoice: string;
  /** A voice URI / name for the browser engine (empty = best available). */
  browserVoice: string;
  /** Pace, 0.5 – 2. A newly provisioned TV starts at `TV_SPEED` (wave 26, V2). */
  speed: number;
  /** (wave 26, V2) The pauses in his speech, a multiplier 0 – 3 of the
   *  0.3 s between sentences and 0.7 s between lines (`speech/engine.ts`
   *  `gapsFor`); 1 by default, `pause=` on a link, a slider in ⚙. */
  pause: number;
  /** The tablet camera to use for the scanner. */
  camera: "user" | "environment";
  /** Where this screen hangs: a `house.terminals[].id` of the event's house
   *  map (`docs/loom-reinstall.md` §4), or "" — unplaced. */
  spot: string;
  /** What the attract screen shows (`reinstall`, wave 18b: the tent laptop's
   *  reinstallation station — the idle show, a marked pass plays the game
   *  here): `auto` (the world view while a program
   *  is in the reinstallation simulation, else the face), `world` (always
   *  the world view), `face` (never), `mirror` (a full-screen spectator —
   *  no scanner, no chat), `tv` (the room voice, K-18: the face full screen
   *  speaking the character's lines in `room`, the world pane while someone
   *  is in the simulation — no scanner), `chess` (the King's board at the
   *  server-room door: scan a pass, play him — no line, no room), `casino`
   *  (wave 15: scan a pass, bet Truthcoin on three games — no line, no
   *  room), `shadow`
   *  (wave 14: this tablet's own camera full screen with the reinstallation
   *  players drawn over it as ghosts — the room's shadow dimension; no
   *  scanner). `auto` shows the shadow instead of the world view while the
   *  camera is live. */
  view: TerminalView;
  /** Send this terminal's camera to the games (wave 14, `camfeed.ts`): only
   *  a placed terminal (`spot` set) sends; on by default. */
  camFeed: boolean;
  /** `view: tv` — the LOCATION whose lines it speaks ("" = `DEFAULT_TV_ROOM`).
   *  Any other view — the LOCATION this terminal belongs to ("" = none; see
   *  `roomOf`): asleep until it is open, speaking its lines. */
  room: string;
  /** Say the house announcements (N-09: a chime + `do announce "…"` in the
   *  device's voice): `true` always, `false` never, `null` the house setting
   *  (wave 18b, the default — the house list in `audio.json`, which the
   *  screen state answers as `spot.announce`; off when it doesn't say). A
   *  stored `false` is Never only beside `announceMode: "never"`
   *  (`storedAnnounce`), so a config from before wave 18b, or one a rolled-back
   *  build re-saved, reads as the house setting. */
  announce: boolean | null;
  /** The voice link's microphone (wave 19, `voice/roles.ts`): absent = the
   *  view's default (on, the TV's off); false turns it off for this tablet,
   *  true turns the TV's on. */
  mic?: boolean;
  /** Play the reinstallation players this terminal can hear (wave 19): on
   *  by default; false keeps this tablet's speaker for its own voice. */
  voices: boolean;
  /** The map's voice link for this terminal's spot (`@loom/house`
   *  `voiceOn`): copied from the map at setup and followed with it (off on
   *  the tent). True until a map says otherwise; the server refuses an
   *  upload from a spot it turns off whatever this says. */
  voiceLink: boolean;
  /** Full screen on every tap while not (wave 17, `fullscreen.ts`): on by
   *  default; ⚙ turns it off. Stored only — no URL hint. */
  fullscreen: boolean;
  /** The door sensor this terminal bridges (wave 20, `serial/`): `serial` —
   *  the Grand Central M4 over Web Serial; `sim` — the dev keys O / C / F;
   *  `off` — none (the default). */
  door: DoorConfig;
  /** A keyboard is here (wave 20, D23): the composer shows (default true).
   *  False: a mouse-only rig, no composer — the heart's choices only. */
  keys: boolean;
  /** Bridge the patch bay the door's board reads (wave 22, `serial/patch-bridge.ts`):
   *  on by default (only a board whose `hello` says it has a bay is read);
   *  `&bay=0` / ⚙ turns it off. */
  bay: boolean;
  /** The USB webcam this terminal sees and hears through (wave 52,
   *  `devices.ts`): a piece of its name ("C310"), for the scanner, the camera
   *  feed and the microphone. "" = the browser's default devices. */
  webcam: string;
  /** A GameCube controller drives this terminal (wave 52, `gamepad/`). */
  pad: boolean;
  /** Spoken answers through whisper.cpp on this computer (wave 52,
   *  `whisper/`): the composer listens instead of taking typing. */
  whisper: boolean;
  /** This screen is an old 4:3 CRT (wave 52b, `crt/`): big plain text and a
   *  waveform for the face, the pipes for the idle show, no sound effects,
   *  glitches or dream, and nothing cuts him off. */
  crt: boolean;
  /** (wave 59) This page's own ad sounds and bleeps (`sound/bus.ts`
   *  `setBleeps`): true they play, false they don't; absent = this spot's
   *  default (`bleepsOn`). `bleeps=` on a link, `🔇` in ⚙. */
  bleeps?: boolean;
  /** Set up by tapping a terminal of the event's house map: at boot the
   *  name / view / room follow that map entry (`setup-map.ts` `followMap`).
   *  A manual view / room in ⚙'s advanced section clears it. */
  fromMap?: boolean;
}

export type DoorConfig = "serial" | "sim" | "off";
export const DOOR_CONFIGS: readonly DoorConfig[] = ["off", "serial", "sim"];

export function doorConfigOf(v: unknown): DoorConfig {
  return v === "serial" || v === "sim" ? v : "off";
}

export type TerminalView = "auto" | "world" | "face" | "mirror" | "tv" | "chess" | "shadow" | "casino" | "reinstall";
export const VIEWS: readonly TerminalView[] = ["auto", "world", "face", "mirror", "tv", "chess", "shadow", "casino", "reinstall"];

/** ⚙'s one line per view. */
export const VIEW_INFO: Readonly<Record<TerminalView, string>> = {
  auto: "face — the simulation (or its shadow, camera on) while someone plays",
  world: "the simulation, always (face while piloting)",
  face: "face only",
  mirror: "mirror — full-screen simulation, no scanner",
  tv: "TV — the face speaks the room's lines, no scanner",
  chess: "chess — the King at the server-room door, no hints",
  casino: "casino — scan a pass, bet Truthcoin on the coin, the dice and the slots",
  shadow: "shadow — this camera full screen, the players as ghosts in it, no scanner",
  reinstall: "reinstallation station — idle show; a marked pass plays the game here",
};

export const VOICE_CHOICES: readonly VoiceChoice[] = ["browser", "fully", "silent", "server"];

/** A stored / URL voice choice. `auto` was the old default ("server, the
 *  tablet's as fallback") — the native voice is the default now, so it
 *  reads as `browser`; anything unknown does too. */
export function voiceChoiceOf(v: unknown): VoiceChoice {
  return typeof v === "string" && (VOICE_CHOICES as readonly string[]).includes(v) ? (v as VoiceChoice) : "browser";
}

function isView(v: unknown): v is TerminalView {
  return typeof v === "string" && (VIEWS as readonly string[]).includes(v);
}

/** ⚙'s three-way announcement choice (wave 18b, Q8) ⇄ the config's `announce`. */
export type AnnounceChoice = "house" | "always" | "never";

export function announceChoiceValue(v: boolean | null): AnnounceChoice {
  return v === true ? "always" : v === false ? "never" : "house";
}

export function announceFromChoice(v: string): boolean | null {
  return v === "always" ? true : v === "never" ? false : null;
}

export const CONFIG_KEY = "loom.terminal";

/**
 * A stored `announce` (wave 18b, Q8). The three-way choice is stored in its
 * own field, `announceMode`, because a build from before wave 18b (a
 * rollback) re-saves `announce` as a plain `false` for anything not Always
 * but keeps fields it doesn't know. So `true` is Always; `false` is Never
 * only when `announceMode` says so; anything else — a pre-18b default, or a
 * rolled-back build's re-save of the house setting — is the house setting.
 */
export function storedAnnounce(v: unknown, mode: unknown): boolean | null {
  if (v === true) return true;
  if (v === false && mode === "never") return false;
  return null;
}
export const DEFAULT_CHARACTER = "Trabolta";
/** The room the TV hangs in — *Trapped in the Internet*'s living room. */
export const DEFAULT_TV_ROOM = "The Desktop";

/** The room a `view: tv` screen speaks for. */
export function tvRoomOf(c: Pick<TerminalConfig, "room">): string {
  return c.room.trim() || DEFAULT_TV_ROOM;
}

/** The LOCATION a wall terminal belongs to (the server-room terminal), or
 *  null: no room, the TV (whose `room` is only the room it speaks for) or the
 *  chess board, the casino or the reinstallation station (awake all night,
 *  whatever room they were given). */
export function roomOf(c: Pick<TerminalConfig, "room" | "view">): string | null {
  if (c.view === "tv" || c.view === "chess" || c.view === "casino" || c.view === "reinstall") return null;
  const room = c.room.trim();
  return room === "" ? null : room;
}

/** (wave 59) The spots whose sound is someone listening to him or to a game:
 *  no ad sounds or bleeps here unless ⚙ asks for them. */
export const QUIET_SPOTS: readonly string[] = ["desktop-tv", "tent", "server-room"];

/** Does this terminal make its ad sounds and bleeps? A choice stored in ⚙ or
 *  on a link wins; else no on `QUIET_SPOTS` (and on the screens they carry,
 *  however a tablet was placed), yes everywhere else. */
export function bleepsOn(c: Pick<TerminalConfig, "spot" | "view"> & { bleeps?: boolean; crt?: boolean }): boolean {
  if (typeof c.bleeps === "boolean") return c.bleeps;
  return !(QUIET_SPOTS.includes(c.spot.trim()) || c.view === "tv" || c.view === "reinstall" || c.crt === true);
}

export function defaultConfig(partial: Partial<TerminalConfig> & Pick<TerminalConfig, "eventId" | "token">): TerminalConfig {
  return {
    title: "",
    name: "Terminal",
    character: DEFAULT_CHARACTER,
    engine: "browser",
    serverVoice: "",
    browserVoice: "",
    speed: 1,
    pause: 1,
    camera: "user",
    spot: "",
    view: "auto",
    room: "",
    announce: null,
    camFeed: true,
    voices: true,
    voiceLink: true,
    fullscreen: true,
    door: "off",
    keys: true,
    bay: true,
    webcam: "",
    pad: false,
    whisper: false,
    crt: false,
    ...partial,
  };
}

export function loadConfig(storage: Pick<Storage, "getItem"> = localStorage): TerminalConfig | null {
  try {
    const raw = storage.getItem(CONFIG_KEY);
    if (raw === null) return null;
    const c = JSON.parse(raw) as Partial<TerminalConfig> & { v?: unknown; announceMode?: unknown };
    if (typeof c.eventId !== "string" || typeof c.token !== "string" || c.eventId === "" || c.token === "") return null;
    const spot = typeof c.spot === "string" ? c.spot : "";
    const view = isView(c.view) ? c.view : "auto";
    const room = typeof c.room === "string" ? c.room : "";
    // `v` was an earlier wave 18b draft's marker: dropped, never trusted.
    const { v: _version, announceMode, ...stored } = c;
    const loaded = defaultConfig({ ...stored, eventId: c.eventId, token: c.token, spot, view, room, speed: speedOf(c.speed), pause: pauseOf(c.pause), engine: voiceChoiceOf(c.engine), announce: storedAnnounce(c.announce, announceMode), camFeed: c.camFeed !== false, voices: c.voices !== false, voiceLink: c.voiceLink !== false, fullscreen: c.fullscreen !== false, fromMap: c.fromMap === true, door: doorConfigOf(c.door), keys: c.keys !== false, bay: c.bay !== false, webcam: typeof c.webcam === "string" ? c.webcam : "", pad: c.pad === true, whisper: c.whisper === true, crt: c.crt === true });
    if (typeof c.mic === "boolean") loaded.mic = c.mic;
    else delete loaded.mic;
    if (typeof c.bleeps === "boolean") loaded.bleeps = c.bleeps;
    else delete loaded.bleeps;
    return loaded;
  } catch {
    return null;
  }
}

export function saveConfig(c: TerminalConfig, storage: Pick<Storage, "setItem"> = localStorage): void {
  storage.setItem(CONFIG_KEY, JSON.stringify({ ...c, announceMode: announceChoiceValue(c.announce) }));
}

export function dropConfig(storage: Pick<Storage, "removeItem"> = localStorage): void {
  storage.removeItem(CONFIG_KEY);
}

/** (wave 26, V2) A newly provisioned TV's voice pace: a touch slower than
 *  the walls'. Only a default: ⚙ still sets it, and a TV already set up
 *  keeps its saved `speed` (`loadConfig`). */
export const TV_SPEED = 0.92;

/** A stored pace: 0.5 – 2, anything unreadable is 1. */
export function speedOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(2, Math.max(0.5, v)) : 1;
}

/** `pause=` off a link: a number 0 – 3, null when absent or unreadable. */
function pauseHint(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? pauseOf(n) : null;
}

/**
 * (wave 26, V2) A just-provisioned config's view defaults: a TV that the
 * link or the map made `view=tv` starts at `TV_SPEED` unless a pace was
 * already chosen (`speed` other than the default 1). Pure; the provisioning
 * paths call it once, never `loadConfig` (a TV already set up keeps its own).
 */
export function withViewDefaults(c: TerminalConfig): TerminalConfig {
  return c.view === "tv" && c.speed === 1 ? { ...c, speed: TV_SPEED } : c;
}

/** Provisioning hints riding on the URL (`?code=&name=&character=&camera=&engine=&spot=&view=&room=&announce=&cam=&mic=&voices=&door=&keys=&bay=&pause=&webcam=&pad=&whisper=&crt=&bleeps=`). */
export interface UrlHints {
  code: string;
  name: string | null;
  character: string | null;
  camera: "user" | "environment" | null;
  engine: TerminalConfig["engine"] | null;
  spot: string | null;
  view: TerminalView | null;
  room: string | null;
  /** `announce=1` (always) / `0` (never); null = not given (the house setting). */
  announce: boolean | null;
  /** `cam=0` / `1`: the camera feed (null = not given: on). */
  camFeed?: boolean | null;
  /** `mic=0` / `1`: the voice link's microphone (null = the view's default). */
  mic?: boolean | null;
  /** `voices=0` / `1`: play the players' voices (null = not given: on). */
  voices?: boolean | null;
  /** `door=serial|sim|off`: the door sensor (null = not given: off). */
  door?: DoorConfig | null;
  /** `keys=0` / `1`: a keyboard is here (null = not given: yes). */
  keys?: boolean | null;
  /** `bay=0` / `1`: bridge the patch bay (null = not given: yes). */
  bay?: boolean | null;
  /** (wave 26) `pause=<0–3>`: the pause multiplier (null = not given: 1). */
  pause?: number | null;
  /** (wave 52) `webcam=<part of its name>` (null = not given: the default devices). */
  webcam?: string | null;
  /** (wave 52) `pad=0` / `1`: a GameCube controller (null = not given: no). */
  pad?: boolean | null;
  /** (wave 52) `whisper=0` / `1`: spoken answers (null = not given: no). */
  whisper?: boolean | null;
  /** (wave 52b) `crt=0` / `1`: an old 4:3 CRT (null = not given: no). */
  crt?: boolean | null;
  /** (wave 59) `bleeps=0` / `1`: this page's ad sounds and bleeps (null = not given: the spot's default). */
  bleeps?: boolean | null;
}

/** A URL on/off switch: true / false, null = not given or unreadable. */
function flagOf(v: string | null): boolean | null {
  return v === "1" || v === "true" || v === "on" ? true : v === "0" || v === "false" || v === "off" ? false : null;
}

export function hintsFromSearch(search: string): UrlHints {
  const p = new URLSearchParams(search);
  const camera = p.get("camera");
  const engine = p.get("engine");
  const view = p.get("view");
  const announce = p.get("announce");
  return {
    code: (p.get("code") ?? "").trim(),
    name: p.get("name")?.trim() || null,
    character: p.get("character")?.trim() || null,
    camera: camera === "user" || camera === "environment" ? camera : null,
    engine: engine === null ? null : engine === "auto" ? "browser" : (VOICE_CHOICES as readonly string[]).includes(engine) ? (engine as VoiceChoice) : null,
    spot: p.get("spot")?.trim() || null,
    view: isView(view) ? view : null,
    room: p.get("room")?.trim() || null,
    announce: flagOf(announce),
    camFeed: flagOf(p.get("cam")),
    mic: flagOf(p.get("mic")),
    voices: flagOf(p.get("voices")),
    door: ((v) => (v === "serial" || v === "sim" || v === "off" ? v : null))(p.get("door")),
    keys: flagOf(p.get("keys")),
    bay: flagOf(p.get("bay")),
    pause: pauseHint(p.get("pause")),
    webcam: p.get("webcam")?.trim() || null,
    pad: flagOf(p.get("pad")),
    whisper: flagOf(p.get("whisper")),
    crt: flagOf(p.get("crt")),
    bleeps: flagOf(p.get("bleeps")),
  };
}

/** The URL with the passcode scrubbed (a wall tablet must not show it in the bar). */
export function withoutSecrets(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("code");
  p.delete("name");
  p.delete("character");
  p.delete("camera");
  p.delete("engine");
  p.delete("spot");
  p.delete("view");
  p.delete("room");
  p.delete("announce");
  p.delete("cam");
  p.delete("mic");
  p.delete("voices");
  p.delete("door");
  p.delete("keys");
  p.delete("bay");
  p.delete("pause");
  p.delete("webcam");
  p.delete("pad");
  p.delete("whisper");
  p.delete("crt");
  p.delete("bleeps");
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

/**
 * Trade a moderator passcode for a terminal configuration. Throws with a
 * readable message on a wrong / non-moderator code.
 */
export async function provision(code: string, hints: Omit<UrlHints, "code">): Promise<TerminalConfig> {
  const c = await connect(code);
  const given = defaultConfig({
    eventId: c.eventId,
    token: c.token,
    title: c.title,
    name: hints.name ?? "Terminal",
    character: pickCharacter(hints.character, c.characters),
    camera: hints.camera ?? "user",
    engine: hints.engine ?? "browser",
    spot: hints.spot ?? "",
    view: hints.view ?? "auto",
    room: hints.room ?? "",
    announce: hints.announce ?? null,
    camFeed: hints.camFeed ?? true,
    voices: hints.voices ?? true,
    door: hints.door ?? "off",
    keys: hints.keys ?? true,
    bay: hints.bay ?? true,
    pause: hints.pause ?? 1,
    webcam: hints.webcam ?? "",
    pad: hints.pad ?? false,
    whisper: hints.whisper ?? false,
    crt: hints.crt ?? false,
  });
  if (typeof hints.mic === "boolean") given.mic = hints.mic;
  if (typeof hints.bleeps === "boolean") given.bleeps = hints.bleeps;
  return withViewDefaults(given);
}

/** A moderator passcode traded for the event's access (setup's CONNECT
 *  step) — nothing about which terminal this is yet. */
export interface Connection {
  eventId: string;
  token: string;
  title: string;
  /** The story's declared cast (may be empty: no story loaded). */
  characters: string[];
}

export async function connect(code: string): Promise<Connection> {
  let resolved: { eventId: string; role: string; title?: string; characters?: string[] };
  try {
    resolved = await api("/api/resolve-code", { code });
  } catch (e) {
    throw new Error(e instanceof ApiError && e.status === 404 ? "No event answers to that code." : `Couldn't reach the event server (${(e as Error).message}).`);
  }
  if (resolved.role !== "mod") throw new Error(`That is a ${resolved.role === "prime" ? "performer" : "guest"} code — a terminal needs the moderator passcode.`);
  const login = await api<{ token: string }>(`/e/${encodeURIComponent(resolved.eventId)}/api/mod/login`, { passcode: code });
  return { eventId: resolved.eventId, token: login.token, title: resolved.title ?? "", characters: resolved.characters ?? [] };
}

/** A name folded the way the story matches names (core's `foldName`:
 *  case, `_` / `-` and runs of spaces don't count). */
export function foldName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The story's own spelling of a typed character name (`trabolta` →
 *  `Trabolta`), or null when the story declares nobody by that name. The
 *  terminal's thread is `dm:<this>`, so a typed variant must never reach it:
 *  the server would keep the line in a thread no agent hears (B19). */
export function canonicalCharacter(typed: string, characters: readonly string[]): string | null {
  if (characters.includes(typed)) return typed;
  const want = foldName(typed);
  return characters.find((c) => foldName(c) === want) ?? null;
}

/** The character a terminal is set up for: the typed one in the story's
 *  spelling, else the default. A mod code resolves the story's declared cast
 *  before the doors open too (`EventRuntime.declaredCharacters`), so a typo
 *  is refused at setup, doors open or not. An empty list (no story loaded, or
 *  one that won't compile: nothing to check against) keeps the typed name;
 *  the screen state's `character.id` corrects it later (`adoptCharacter`).
 *  Throws when the story declares no such character. */
export function pickCharacter(typed: string | null, characters: readonly string[]): string {
  if (typed === null || typed.trim() === "") return characters.includes(DEFAULT_CHARACTER) ? DEFAULT_CHARACTER : (characters[0] ?? DEFAULT_CHARACTER);
  if (characters.length === 0) return typed.trim();
  const found = canonicalCharacter(typed.trim(), characters);
  if (found === null) throw new Error(characterProblem(typed.trim(), characters) ?? "");
  return found;
}

/** What is wrong with a terminal's character against the story's cast, or
 *  null when nothing is (the story has it, or no cast to check: no story
 *  loaded, or one that won't compile — the declared cast is there before
 *  the doors open). */
export function characterProblem(configured: string, characters: readonly string[]): string | null {
  if (characters.length === 0 || canonicalCharacter(configured.trim(), characters) !== null) return null;
  return `The story has no character called "${configured.trim()}" (it has: ${characters.join(", ")}).`;
}

/**
 * When the story should be asked whether this terminal's character exists
 * (B19): the screen state answers but names no character for it — either the
 * doors aren't open (no sim yet; the cast read still answers with the story's
 * declared cast, `EventRuntime.declaredCharacters`, so a typo shows before
 * the doors) or the name is one the story lacks (a typo stored by an older
 * server or a failed ⚙ lookup, or a story edited since). One check per
 * event × character × sim (`announceEpoch` changes when the doors open or
 * the story restarts), so the key is what the caller dedupes on; null =
 * nothing to check.
 */
export function castCheckKey(c: Pick<TerminalConfig, "eventId" | "character">, state: { character: unknown; announceEpoch: string | null } | null): string | null {
  if (state === null || state.character !== null || c.character.trim() === "") return null;
  return `${c.eventId}|${c.character}|${state.announceEpoch ?? ""}`;
}

/** The character a ⚙ save (no passcode) stores. An unchanged field keeps
 *  the stored name with no lookup at all — a voice / view change saves at
 *  once, whatever the server is doing, and the screen state corrects the
 *  spelling (`adoptCharacter`). A new name is checked against the cast; a
 *  failed (or timed-out) lookup keeps it as typed. */
export async function savedCharacter(typed: string, current: string, lookup: () => Promise<readonly string[]>): Promise<string> {
  const want = typed.trim() || current;
  if (want === current) return current;
  const cast = await lookup().catch(() => [] as readonly string[]);
  return pickCharacter(want, cast);
}

/** A stored config whose character the screen state names differently only
 *  by spelling (`trabolta` vs `Trabolta`): the same config in the story's
 *  spelling. Null = nothing to change (already exact, or a different name). */
export function adoptCharacter(c: TerminalConfig, screenId: string | null | undefined): TerminalConfig | null {
  if (typeof screenId !== "string" || screenId === "" || screenId === c.character) return null;
  return foldName(screenId) === foldName(c.character) ? { ...c, character: screenId } : null;
}

/** The event-scoped API base for a configured terminal. */
export function baseOf(c: Pick<TerminalConfig, "eventId">): string {
  return `/e/${encodeURIComponent(c.eventId)}`;
}

/** A spot / room choice for ⚙, off the event's house map. */
export interface MapChoice {
  value: string;
  label: string;
}

interface MapLike {
  terminals: readonly { id: string; name: string; room: string }[];
  rooms: readonly { id: string; label: string; location?: string }[];
}

/** ⚙'s spot list: "id — name (room)" for every terminal on the map. */
export function spotChoices(house: MapLike | null): MapChoice[] {
  if (house === null) return [];
  return house.terminals.map((t) => {
    const room = house.rooms.find((r) => r.id === t.room);
    return { value: t.id, label: `${t.id} — ${t.name} (${room?.location ?? room?.label ?? t.room})` };
  });
}

/** ⚙'s room list: every LOCATION the map's rooms name, once each, sorted. */
export function roomChoices(house: MapLike | null): MapChoice[] {
  if (house === null) return [];
  const seen = new Set<string>();
  const out: MapChoice[] = [];
  for (const r of house.rooms) {
    const loc = r.location?.trim();
    if (!loc || seen.has(foldName(loc))) continue;
    seen.add(foldName(loc));
    out.push({ value: loc, label: loc });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** What is wrong with a terminal's spot against the map, or null (unplaced, or on it). */
export function spotProblem(spot: string, house: MapLike | null): string | null {
  const id = spot.trim();
  if (id === "" || house === null || house.terminals.some((t) => t.id === id)) return null;
  return `The house map has no terminal spot "${id}" — this screen is no window into the games until it is set right.`;
}
