//! A reinstallation device's standing configuration — set once per tablet,
//! kept in `localStorage`, and bootstrappable from the URL so the tent
//! tablet (or a spare laptop) is provisioned by opening one link:
//!
//!   /reinstall/?code=<mod passcode>&name=Tent tablet&role=both
//!
//! The voice link (wave 19, `voice=1`) is off by default: this app runs
//! on the tent laptop, which is the tent's own terminal and takes no part
//! in it. Another device (a spare laptop playing elsewhere) turns it on.
//!
//! Like the wall terminal (`terminal/src/config.ts`), the mod passcode
//! resolves (via `/api/resolve-code`) to the event and is traded for a
//! **moderator token** (`/api/mod/login`) — what lets this device `begin` a
//! scanned program's simulation, list the VR stations, and (on the map page)
//! save the house map. The passcode itself is never stored.

import { api, ApiError } from "@loom/play/client.ts";

/** What this device does with a scanned program: plays it here, sends it
 *  to a VR headset, or offers both. */
export type DeviceRole = "both" | "player" | "station";

export interface ReinstallConfig {
  eventId: string;
  /** The event's display title (from `/api/resolve-code`). */
  title: string;
  /** Moderator capability, scoped to the event. */
  token: string;
  /** This device's name — journaled as `by` on the outcome it commits. */
  name: string;
  role: DeviceRole;
  /** The tablet camera to use for the pass scanner. */
  camera: "user" | "environment";
  /** ←/→ turn (true) or strafe (false); A/D always strafe. */
  arrowsTurn: boolean;
  /** The voice link (§2.4): this device's mic is heard on the terminals
   *  near the player, and it plays their mics. Off by default (D8). */
  voice: boolean;
  /** The intro (wave 33): the Reinstallation Process video before the
   *  begin and the controls tutorial after it. Missing = on; `intro=0`
   *  turns it off (a rehearsal device, a director's test walk). */
  intro?: boolean;
}

export const CONFIG_KEY = "loom.reinstall";
export const DEFAULT_NAME = "Tent tablet";

export function defaultConfig(partial: Partial<ReinstallConfig> & Pick<ReinstallConfig, "eventId" | "token">): ReinstallConfig {
  return {
    title: "",
    name: DEFAULT_NAME,
    role: "both",
    camera: "user",
    arrowsTurn: true,
    voice: false,
    ...partial,
  };
}

export function isRole(v: unknown): v is DeviceRole {
  return v === "both" || v === "player" || v === "station";
}

export function loadConfig(storage: Pick<Storage, "getItem"> | null = safeStorage()): ReinstallConfig | null {
  try {
    const raw = storage?.getItem(CONFIG_KEY) ?? null;
    if (raw === null) return null;
    const c = JSON.parse(raw) as Partial<ReinstallConfig>;
    if (typeof c.eventId !== "string" || typeof c.token !== "string" || c.eventId === "" || c.token === "") return null;
    const base = defaultConfig({ eventId: c.eventId, token: c.token });
    return {
      ...base,
      title: typeof c.title === "string" ? c.title : base.title,
      name: typeof c.name === "string" && c.name.trim() !== "" ? c.name : base.name,
      role: isRole(c.role) ? c.role : base.role,
      camera: c.camera === "environment" ? "environment" : "user",
      arrowsTurn: typeof c.arrowsTurn === "boolean" ? c.arrowsTurn : base.arrowsTurn,
      voice: typeof c.voice === "boolean" ? c.voice : base.voice,
      ...(typeof c.intro === "boolean" ? { intro: c.intro } : {}),
    };
  } catch {
    return null;
  }
}

export function saveConfig(c: ReinstallConfig, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {
    /* private mode: the config lives for this page only */
  }
}

export function dropConfig(storage: Pick<Storage, "removeItem"> | null = safeStorage()): void {
  try {
    storage?.removeItem(CONFIG_KEY);
  } catch {
    /* nothing stored */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Provisioning hints riding on the URL (`?code=&name=&role=&camera=&arrows=&voice=&intro=`). */
export interface UrlHints {
  code: string;
  name: string | null;
  role: DeviceRole | null;
  camera: "user" | "environment" | null;
  arrowsTurn: boolean | null;
  /** `voice=1` / `voice=0`. */
  voice: boolean | null;
  /** `intro=1` / `intro=0` (wave 33; missing from an older caller = no hint). */
  intro?: boolean | null;
}

const HINT_KEYS = ["code", "name", "role", "camera", "arrows", "voice", "intro"] as const;

export function hintsFromSearch(search: string): UrlHints {
  const p = new URLSearchParams(search);
  const role = p.get("role");
  const camera = p.get("camera");
  const arrows = p.get("arrows");
  const voice = p.get("voice");
  const intro = p.get("intro");
  return {
    code: (p.get("code") ?? "").trim(),
    name: p.get("name")?.trim() || null,
    role: isRole(role) ? role : null,
    camera: camera === "user" || camera === "environment" ? camera : null,
    arrowsTurn: arrows === "turn" ? true : arrows === "strafe" ? false : null,
    voice: voice === "1" ? true : voice === "0" ? false : null,
    intro: intro === "1" ? true : intro === "0" ? false : null,
  };
}

/** The URL with the passcode (and the other provisioning hints) scrubbed. */
export function withoutSecrets(search: string): string {
  const p = new URLSearchParams(search);
  for (const k of HINT_KEYS) p.delete(k);
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

/** Fold URL hints over a stored config (a re-provisioning link may rename). */
export function applyHints(c: ReinstallConfig, hints: Omit<UrlHints, "code">): ReinstallConfig {
  return {
    ...c,
    name: hints.name ?? c.name,
    role: hints.role ?? c.role,
    camera: hints.camera ?? c.camera,
    arrowsTurn: hints.arrowsTurn ?? c.arrowsTurn,
    voice: hints.voice ?? c.voice,
    ...(typeof hints.intro === "boolean" ? { intro: hints.intro } : {}),
  };
}

/**
 * Trade a moderator passcode for a device configuration. Throws with a
 * readable message on a wrong / non-moderator code.
 */
export async function provision(code: string, hints: Omit<UrlHints, "code">): Promise<ReinstallConfig> {
  let resolved: { eventId: string; role: string; title?: string };
  try {
    resolved = await api("/api/resolve-code", { code });
  } catch (e) {
    throw new Error(e instanceof ApiError && e.status === 404 ? "No event answers to that code." : `Couldn't reach the event server (${(e as Error).message}).`);
  }
  if (resolved.role !== "mod") throw new Error(`That is a ${resolved.role === "prime" ? "performer" : "guest"} code — this device needs the moderator passcode.`);
  const login = await api<{ token: string }>(`/e/${encodeURIComponent(resolved.eventId)}/api/mod/login`, { passcode: code });
  return applyHints(defaultConfig({ eventId: resolved.eventId, token: login.token, title: resolved.title ?? "" }), hints);
}

/** The event-scoped API base for a configured device. */
export function baseOf(c: Pick<ReinstallConfig, "eventId">): string {
  return `/e/${encodeURIComponent(c.eventId)}`;
}
