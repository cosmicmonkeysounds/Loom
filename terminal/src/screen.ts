//! The lean screen state (OCT31 K-16): every 2 s the terminal asks the
//! event server `GET /api/screen/state` (~1 KB, `core/server/routes/screen.ts`)
//! what the house's screens should be doing — the story's screen cues, the
//! running countdown, and whether this terminal's character is hidden or
//! asleep. While it is, the terminal is on **attract** (screensaver + ads):
//! no scanner, never "ONLINE", never a pilot into the character's thread.
//!
//! The poll is also the terminal's heartbeat — the server remembers each
//! terminal's last poll by name (K-29 reads it).
//!
//! The TV (`view: tv`, K-18) also names its `voice` room and the last chat
//! seq it handled (`after`); the answer's `voice` block carries the
//! characters' new lines in that room, the room's head seq and the
//! director's mute. It polls every second so a line is heard within 3 s.
//!
//! The answer also carries the latest house announcement (`announce`, N-09);
//! a terminal set to say announcements speaks a new one (`announce.ts`).
//!
//! Fail closed: until the first answer arrives the terminal stays on
//! attract, and an unreachable server keeps the last answer it gave — a
//! dropped poll never flips a hidden character onto the wall.

import { useEffect, useRef, useState } from "react";
import { announceOf, type Announcement } from "./announce.ts";
import { baseOf, type TerminalConfig } from "./config.ts";

/** How often the terminal polls (ms). */
export const SCREEN_POLL_MS = 2000;
/** How often the TV polls (ms): a line must be heard within 3 s. */
export const TV_POLL_MS = 1000;

export type ScreenCueFamily = "screens" | "terminals" | "tv" | "tablet";

export interface ScreenCue {
  value: string;
  seq: number;
}

/** Who a cue is for — the server picks the poller's from its `view`. */
export type ScreenTarget = "tv" | "terminals";

/** One screen cue as the server's fold saw it (`at` = server epoch ms, 0 = history). */
export interface ScreenShot {
  value: string;
  cue: string;
  seq: number;
  at: number;
}

/** What to layer over the base view (K-17 + N-03; `slides.ts` applies the precedence). */
export interface ScreenProgram {
  slide: (ScreenShot & { kind: "slide" | "base"; persist: boolean }) | null;
  overlay: ScreenShot | null;
  blackout: ScreenShot | null;
  flicker: ScreenShot | null;
}

/** A character's line in the voice room (`beat` null = a director's typed `say`). */
export interface VoiceLine {
  seq: number;
  from: string;
  text: string;
  beat: string | null;
}

/** The TV's voice block (K-18). */
export interface ScreenVoice {
  room: string;
  muted: boolean;
  head: number;
  lines: VoiceLine[];
}

/** The server's answer (a subset is all the terminal reads today). */
export interface ScreenState {
  now: number;
  /** Local `Date.now()` when this answer arrived (not from the server). */
  receivedAt: number;
  night: { screen: string | null; terminals: string | null };
  cues: Partial<Record<ScreenCueFamily, ScreenCue | null>>;
  /** `hold` — the character has a `hold:` line (it always answers): show no presence. */
  character: { id: string; hidden: boolean; awake: boolean; online: boolean; hold: boolean } | null;
  attract: boolean;
  countdown: string | null;
  remaining: number | null;
  target: ScreenTarget;
  program: ScreenProgram;
  /** Only on a poll that named a voice room. */
  voice: ScreenVoice | null;
  /** The latest house announcement (N-09, `announce.ts`), null before the first. */
  announce: Announcement | null;
}

/** What a TV adds to its poll: the room it speaks for + its chat cursor. */
export interface VoiceQuery {
  room: string;
  after: number | null;
}

/** The poll URL for this terminal (its name/spot/view ride along as the heartbeat). */
export function screenStateUrl(c: Pick<TerminalConfig, "eventId" | "name" | "spot" | "view" | "character">, voice: VoiceQuery | null = null): string {
  const q = new URLSearchParams({ name: c.name, spot: c.spot, view: c.view, character: c.character });
  if (voice !== null) {
    q.set("voice", voice.room);
    if (voice.after !== null) q.set("after", String(voice.after));
  }
  return `${baseOf(c)}/api/screen/state?${q.toString()}`;
}

/** A voice block off the wire; malformed lines are dropped, a malformed block is null. */
export function voiceOf(raw: unknown): ScreenVoice | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["head"] !== "number" || !Number.isFinite(r["head"])) return null;
  const lines: VoiceLine[] = [];
  for (const l of Array.isArray(r["lines"]) ? r["lines"] : []) {
    if (typeof l !== "object" || l === null) continue;
    const x = l as Record<string, unknown>;
    if (typeof x["seq"] !== "number" || typeof x["from"] !== "string" || typeof x["text"] !== "string") continue;
    lines.push({ seq: x["seq"], from: x["from"], text: x["text"], beat: typeof x["beat"] === "string" ? x["beat"] : null });
  }
  return { room: typeof r["room"] === "string" ? r["room"] : "", muted: r["muted"] === true, head: r["head"], lines };
}

function shotOf(v: unknown): ScreenShot | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r["value"] !== "string" || typeof r["cue"] !== "string") return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return { value: r["value"], cue: r["cue"], seq: n(r["seq"]), at: n(r["at"]) };
}

/** A program off the wire; anything malformed reads as "nothing to layer". */
export function programOf(raw: unknown): ScreenProgram {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const slideShot = shotOf(r["slide"]);
  const slideRaw = (r["slide"] ?? {}) as Record<string, unknown>;
  return {
    slide: slideShot === null ? null : { ...slideShot, kind: slideRaw["kind"] === "base" ? "base" : "slide", persist: slideRaw["persist"] === true },
    overlay: shotOf(r["overlay"]),
    blackout: shotOf(r["blackout"]),
    flicker: shotOf(r["flicker"]),
  };
}

/** Accept a body only if it has the shape the terminal relies on. */
export function parseScreenState(raw: unknown, receivedAt: number = Date.now()): ScreenState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["attract"] !== "boolean") return null;
  const ch = r["character"];
  const character =
    typeof ch === "object" && ch !== null && typeof (ch as Record<string, unknown>)["id"] === "string"
      ? {
          id: String((ch as Record<string, unknown>)["id"]),
          hidden: (ch as Record<string, unknown>)["hidden"] === true,
          awake: (ch as Record<string, unknown>)["awake"] !== false,
          online: (ch as Record<string, unknown>)["online"] === true,
          hold: (ch as Record<string, unknown>)["hold"] === true,
        }
      : null;
  const night = (typeof r["night"] === "object" && r["night"] !== null ? r["night"] : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    now: num(r["now"]) ?? 0,
    receivedAt,
    night: { screen: str(night["screen"]), terminals: str(night["terminals"]) },
    cues: (typeof r["cues"] === "object" && r["cues"] !== null ? r["cues"] : {}) as ScreenState["cues"],
    character,
    attract: r["attract"] as boolean,
    countdown: str(r["countdown"]),
    remaining: num(r["remaining"]),
    target: r["target"] === "tv" ? "tv" : "terminals",
    program: programOf(r["program"]),
    voice: voiceOf(r["voice"]),
    announce: announceOf(r["announce"]),
  };
}

/** Attract or not: no answer yet is attract (fail closed). */
export function attractOf(state: ScreenState | null): boolean {
  return state === null ? true : state.attract;
}

export type PollOutcome = { kind: "state"; state: ScreenState } | { kind: "revoked" } | { kind: "ended" } | { kind: "miss" };

/** One poll. A 401/403 is a revoked token; a 404 "unknown event" means the
 *  event this terminal was set up for is over (a new one was launched); anything
 *  else that fails is a miss (keep the last answer). */
export async function pollScreen(c: TerminalConfig, fetchFn: typeof fetch = fetch, voice: VoiceQuery | null = null): Promise<PollOutcome> {
  try {
    const res = await fetchFn(screenStateUrl(c, voice), { headers: { "x-loom-token": c.token }, cache: "no-store" });
    if (res.status === 401 || res.status === 403) return { kind: "revoked" };
    if (res.status === 404) {
      const err = await res.json().then((j: unknown) => (typeof j === "object" && j !== null ? (j as Record<string, unknown>)["error"] : null)).catch(() => null);
      return err === "unknown event" ? { kind: "ended" } : { kind: "miss" };
    }
    if (!res.ok) return { kind: "miss" };
    const state = parseScreenState(await res.json());
    return state === null ? { kind: "miss" } : { kind: "state", state };
  } catch {
    return { kind: "miss" };
  }
}

/** Polls in a row that may miss before the bar's dot goes dark: one
 *  dropped 2 s poll is a blip, two is the server gone. */
export const MISSES_OFFLINE = 2;

/** Missed polls in a row after this outcome (an answer resets it). */
export function missesAfter(misses: number, out: PollOutcome["kind"]): number {
  return out === "state" ? 0 : misses + 1;
}

/** Is the server answering? The last good state is kept on a miss (so the
 *  screen doesn't flicker), so its presence alone can't say. */
export function screenReachable(state: ScreenState | null, misses: number): boolean {
  return state !== null && misses < MISSES_OFFLINE;
}

/**
 * Poll the screen state every `SCREEN_POLL_MS` (the TV: `TV_POLL_MS`) while a
 * config is present. Returns the last good answer (null until the first),
 * whether the server is answering right now (`reachable`), whether the server
 * refused this terminal's token, and whether its event is gone. `voice` (the TV) is read
 * fresh on every poll, so the cursor can move without restarting the loop.
 */
export function useScreenState(
  config: TerminalConfig | null,
  voice: (() => VoiceQuery) | null = null,
): { state: ScreenState | null; reachable: boolean; revoked: boolean; ended: boolean } {
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const [state, setState] = useState<ScreenState | null>(null);
  const [misses, setMisses] = useState(0);
  const [revoked, setRevoked] = useState(false);
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    setState(null);
    setMisses(0);
    setRevoked(false);
    setEnded(false);
    if (config === null) return;
    let alive = true;
    let timer = 0;
    const every = config.view === "tv" ? TV_POLL_MS : SCREEN_POLL_MS;
    const tick = async () => {
      const out = await pollScreen(config, fetch, voiceRef.current?.() ?? null);
      if (!alive) return;
      setMisses((m) => missesAfter(m, out.kind));
      if (out.kind === "state") setState(out.state);
      else if (out.kind === "revoked") {
        setRevoked(true);
        return; // stop polling: setup takes over
      } else if (out.kind === "ended") {
        setEnded(true);
        return; // stop polling: setup asks for the next event's passcode
      }
      timer = window.setTimeout(() => void tick(), every);
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [config]);
  return { state, reachable: screenReachable(state, misses), revoked, ended };
}
