//! Which half of the voice link a terminal takes part in (wave 19, D9) —
//! pure, so the page, ⚙ and the heartbeat agree:
//!
//! | view                                   | mic (heard in the games) | voices (players heard here) |
//! |----------------------------------------|--------------------------|-----------------------------|
//! | auto · world · shadow · face · chess · casino | on                | on                          |
//! | tv                                     | off (⚙ / `mic=1` turns it on) | on, under the TV mute  |
//! | mirror · reinstall (the tent laptop)   | never                    | never                       |
//!
//! Never on an unplaced terminal (no spot: nowhere in the games to be
//! heard), and never on a spot the map's voice link turns off (`voiceOn`:
//! the tent, where the reinstallation laptop sits beside the headsets).
//! The setup screen takes no part either — the caller passes `active`.

// The subpath, not the barrel: the codec stays in the lazy link chunk.
import { voiceOn } from "@loom/house/voice-on";
import type { HouseMap } from "@loom/house";
import type { TerminalConfig, TerminalView } from "../config.ts";

export interface VoiceRoles {
  /** Capture this room and send it to the games. */
  mic: boolean;
  /** Play the players this terminal can hear. */
  voices: boolean;
}

export const NO_VOICE: VoiceRoles = { mic: false, voices: false };

/** The microphone's default for a view (⚙'s `mic` absent). */
export function micDefault(view: TerminalView): boolean {
  return view !== "tv" && view !== "mirror" && view !== "reinstall";
}

/**
 * ⚙'s microphone box. Untouched (`mic` absent) it follows the screen the
 * terminal ends up on — which a tap on the map picks and saves at once — so
 * it shows the default for the view known now but reads as "follows"
 * (indeterminate), never as a promise about a spot not yet tapped.
 */
export function micBox(mic: boolean | undefined, view: TerminalView): { checked: boolean; follows: boolean } {
  return mic === undefined ? { checked: micDefault(view), follows: true } : { checked: mic, follows: false };
}

type RoleConfig = Pick<TerminalConfig, "view" | "spot" | "voices" | "voiceLink"> & { mic?: boolean };

/**
 * A terminal's voice roles. `house` = the event's map when known: its
 * `voiceOn` for this spot wins over the stored `voiceLink` (a spot it lacks
 * is no part of the link).
 */
export function voiceRoles(c: RoleConfig, house?: Pick<HouseMap, "terminals" | "spawn"> | null): VoiceRoles {
  const spot = c.spot.trim();
  // The tent laptop (wave 18b `reinstall`) is the reinstallation station
  // beside the headsets: never part of the link, wherever it is placed.
  if (spot === "" || c.view === "mirror" || c.view === "reinstall") return NO_VOICE;
  const linked = house ? voiceOn(house as HouseMap, spot) : c.voiceLink !== false;
  if (!linked) return NO_VOICE;
  const mic = c.view === "tv" ? c.mic === true : c.mic !== false;
  return { mic, voices: c.voices !== false };
}

/** What the heartbeat says about this terminal's microphone (`mic=`). */
export type MicReport = "live" | "muted" | "denied" | "insecure" | "locked" | "off";

/**
 * The heartbeat's `mic=`: `off` — this terminal takes no part (its view, no
 * spot, the map, the TV's default); `muted` — it would, but ⚙ turned its
 * microphone off; else the microphone's own state (`live`, `denied`,
 * `insecure`; `locked` — open, but the page's audio waits for a touch). Null = nothing to report yet (opening, no microphone, a
 * failure: the ⚙ status line says which).
 */
export function micReport(c: RoleConfig, house: Pick<HouseMap, "terminals" | "spawn"> | null | undefined, state: string | null): MicReport | null {
  if (!voiceRoles(c, house).mic) return voiceRoles({ ...c, mic: true }, house).mic && c.mic === false ? "muted" : "off";
  if (state === "live" || state === "denied" || state === "insecure" || state === "locked") return state;
  return null;
}
