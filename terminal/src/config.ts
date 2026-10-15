//! A terminal's standing configuration — set once per tablet, kept in
//! `localStorage`, and bootstrappable from the URL so a fleet is provisioned
//! by opening one link on each:
//!
//!   /terminal/?code=<mod passcode>&name=Kitchen&character=Trabolta&spot=kitchen&view=auto
//!
//! The TV (the house Mac, Chrome full screen over the long HDMI — K-18):
//!
//!   /terminal/?code=<mod passcode>&name=TV&character=Trabolta&spot=desktop-tv&view=tv
//!
//! A tablet that should also say the house announcements (N-09 — the
//! "Alexa" lines, `do announce "…"`) adds `&announce=1`; off by default.
//!
//! The mod passcode resolves (via `/api/resolve-code`) to the event and is
//! traded for a **moderator token** (`/api/mod/login`) — that is what lets
//! a terminal pilot a scanned guest through `/api/mod/impersonate`, and
//! what gates the (opt-in) server voice. The passcode itself is never stored.

import { api, ApiError } from "@loom/play/client.ts";
import type { VoiceChoice } from "./speech/engine.ts";

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
  /** Pace, 0.5 – 2. */
  speed: number;
  /** The tablet camera to use for the scanner. */
  camera: "user" | "environment";
  /** Where this screen hangs: a `house.terminals[].id` of the event's house
   *  map (`docs/loom-reinstall.md` §4), or "" — unplaced. */
  spot: string;
  /** What the attract screen shows: `auto` (the world view while a program
   *  is in the reinstallation simulation, else the face), `world` (always
   *  the world view), `face` (never), `mirror` (a full-screen spectator —
   *  no scanner, no chat), `tv` (the room voice, K-18: the face full screen
   *  speaking the character's lines in `room`, the world pane while someone
   *  is in the simulation — no scanner). */
  view: TerminalView;
  /** `view: tv` — the LOCATION whose lines it speaks ("" = `DEFAULT_TV_ROOM`). */
  room: string;
  /** Say the house announcements (N-09: a chime + `do announce "…"` in the
   *  device's voice). Off by default — the TV's room already hears the
   *  house speakers, and most tablets hang where the speakers reach. */
  announce: boolean;
}

export type TerminalView = "auto" | "world" | "face" | "mirror" | "tv";
export const VIEWS: readonly TerminalView[] = ["auto", "world", "face", "mirror", "tv"];

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

export const CONFIG_KEY = "loom.terminal";
export const DEFAULT_CHARACTER = "Trabolta";
/** The room the TV hangs in — *Trapped in the Internet*'s living room. */
export const DEFAULT_TV_ROOM = "The Desktop";

/** The room a `view: tv` screen speaks for. */
export function tvRoomOf(c: Pick<TerminalConfig, "room">): string {
  return c.room.trim() || DEFAULT_TV_ROOM;
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
    camera: "user",
    spot: "",
    view: "auto",
    room: "",
    announce: false,
    ...partial,
  };
}

export function loadConfig(storage: Pick<Storage, "getItem"> = localStorage): TerminalConfig | null {
  try {
    const raw = storage.getItem(CONFIG_KEY);
    if (raw === null) return null;
    const c = JSON.parse(raw) as Partial<TerminalConfig>;
    if (typeof c.eventId !== "string" || typeof c.token !== "string" || c.eventId === "" || c.token === "") return null;
    const spot = typeof c.spot === "string" ? c.spot : "";
    const view = isView(c.view) ? c.view : "auto";
    const room = typeof c.room === "string" ? c.room : "";
    return defaultConfig({ ...c, eventId: c.eventId, token: c.token, spot, view, room, engine: voiceChoiceOf(c.engine), announce: c.announce === true });
  } catch {
    return null;
  }
}

export function saveConfig(c: TerminalConfig, storage: Pick<Storage, "setItem"> = localStorage): void {
  storage.setItem(CONFIG_KEY, JSON.stringify(c));
}

export function dropConfig(storage: Pick<Storage, "removeItem"> = localStorage): void {
  storage.removeItem(CONFIG_KEY);
}

/** Provisioning hints riding on the URL (`?code=&name=&character=&camera=&engine=&spot=&view=&room=&announce=`). */
export interface UrlHints {
  code: string;
  name: string | null;
  character: string | null;
  camera: "user" | "environment" | null;
  engine: TerminalConfig["engine"] | null;
  spot: string | null;
  view: TerminalView | null;
  room: string | null;
  /** `announce=1` / `0`; null = not given (provisioning keeps the default: off). */
  announce: boolean | null;
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
    announce: announce === "1" || announce === "true" || announce === "on" ? true : announce === "0" || announce === "false" || announce === "off" ? false : null,
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
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

/**
 * Trade a moderator passcode for a terminal configuration. Throws with a
 * readable message on a wrong / non-moderator code.
 */
export async function provision(code: string, hints: Omit<UrlHints, "code">): Promise<TerminalConfig> {
  let resolved: { eventId: string; role: string; title?: string; characters?: string[] };
  try {
    resolved = await api("/api/resolve-code", { code });
  } catch (e) {
    throw new Error(e instanceof ApiError && e.status === 404 ? "No event answers to that code." : `Couldn't reach the event server (${(e as Error).message}).`);
  }
  if (resolved.role !== "mod") throw new Error(`That is a ${resolved.role === "prime" ? "performer" : "guest"} code — a terminal needs the moderator passcode.`);
  const login = await api<{ token: string }>(`/e/${encodeURIComponent(resolved.eventId)}/api/mod/login`, { passcode: code });
  const character = hints.character ?? (resolved.characters?.includes(DEFAULT_CHARACTER) ? DEFAULT_CHARACTER : (resolved.characters?.[0] ?? DEFAULT_CHARACTER));
  return defaultConfig({
    eventId: resolved.eventId,
    token: login.token,
    title: resolved.title ?? "",
    name: hints.name ?? "Terminal",
    character,
    camera: hints.camera ?? "user",
    engine: hints.engine ?? "browser",
    spot: hints.spot ?? "",
    view: hints.view ?? "auto",
    room: hints.room ?? "",
    announce: hints.announce ?? false,
  });
}

/** The event-scoped API base for a configured terminal. */
export function baseOf(c: Pick<TerminalConfig, "eventId">): string {
  return `/e/${encodeURIComponent(c.eventId)}`;
}
