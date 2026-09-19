//! A terminal's standing configuration — set once per tablet, kept in
//! `localStorage`, and bootstrappable from the URL so a fleet is provisioned
//! by opening one link on each:
//!
//!   /terminal/?code=<mod passcode>&name=Kitchen&character=Trabolta
//!
//! The mod passcode resolves (via `/api/resolve-code`) to the event and is
//! traded for a **moderator token** (`/api/mod/login`) — that is what lets
//! a terminal pilot a scanned guest through `/api/mod/impersonate`, and
//! what gates the server voice. The passcode itself is never stored.

import { api, ApiError } from "@loom/play/client.ts";

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
  /** Speech: `server` (the laptop's neural voice via `/api/mod/tts`),
   *  `browser` (the tablet's own), or `auto` (server when available). */
  engine: "auto" | "server" | "browser";
  /** A voice name for the server engine (empty = the server's default). */
  serverVoice: string;
  /** A voice URI / name for the browser engine (empty = best available). */
  browserVoice: string;
  /** Pace, 0.5 – 2. */
  speed: number;
  /** The tablet camera to use for the scanner. */
  camera: "user" | "environment";
}

export const CONFIG_KEY = "loom.terminal";
export const DEFAULT_CHARACTER = "Trabolta";

export function defaultConfig(partial: Partial<TerminalConfig> & Pick<TerminalConfig, "eventId" | "token">): TerminalConfig {
  return {
    title: "",
    name: "Terminal",
    character: DEFAULT_CHARACTER,
    engine: "auto",
    serverVoice: "",
    browserVoice: "",
    speed: 1,
    camera: "user",
    ...partial,
  };
}

export function loadConfig(storage: Pick<Storage, "getItem"> = localStorage): TerminalConfig | null {
  try {
    const raw = storage.getItem(CONFIG_KEY);
    if (raw === null) return null;
    const c = JSON.parse(raw) as Partial<TerminalConfig>;
    if (typeof c.eventId !== "string" || typeof c.token !== "string" || c.eventId === "" || c.token === "") return null;
    return defaultConfig({ ...c, eventId: c.eventId, token: c.token });
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

/** Provisioning hints riding on the URL (`?code=&name=&character=&camera=&engine=`). */
export interface UrlHints {
  code: string;
  name: string | null;
  character: string | null;
  camera: "user" | "environment" | null;
  engine: TerminalConfig["engine"] | null;
}

export function hintsFromSearch(search: string): UrlHints {
  const p = new URLSearchParams(search);
  const camera = p.get("camera");
  const engine = p.get("engine");
  return {
    code: (p.get("code") ?? "").trim(),
    name: p.get("name")?.trim() || null,
    character: p.get("character")?.trim() || null,
    camera: camera === "user" || camera === "environment" ? camera : null,
    engine: engine === "auto" || engine === "server" || engine === "browser" ? engine : null,
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
    engine: hints.engine ?? "auto",
  });
}

/** The event-scoped API base for a configured terminal. */
export function baseOf(c: TerminalConfig): string {
  return `/e/${encodeURIComponent(c.eventId)}`;
}
