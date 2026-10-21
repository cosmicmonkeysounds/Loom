//! The voice link's status (wave 19), a module store the page reads: ⚙'s
//! status line, the 🎤 corner cue (`onAir`) and the heartbeat's `mic=`
//! (`micHeartbeat`, `health.ts`). Kept apart from `link.ts` so the
//! heartbeat pulls in nothing of the link itself.

import { useSyncExternalStore } from "react";
import type { MicState } from "./mic.ts";
import { NO_VOICE, type MicReport, type VoiceRoles } from "./roles.ts";
import type { UplinkStatus } from "./uplink.ts";

export interface VoiceStatus {
  roles: VoiceRoles;
  /** The microphone's state (null: not asked for). */
  mic: MicState | null;
  /** The voice stream. */
  link: "off" | "connecting" | "live" | "stopped";
  /** Someone in the games can hear this room right now. */
  listening: boolean;
  /** Players heard here right now. */
  hearing: number;
  uplink: UplinkStatus;
  /** Why it stopped / can't run. */
  problem: string | null;
  /** The heartbeat's `mic=`. */
  report: MicReport | null;
}

export const VOICE_OFF: VoiceStatus = { roles: NO_VOICE, mic: null, link: "off", listening: false, hearing: 0, uplink: { kind: "idle" }, problem: null, report: "off" };

/** ⚙'s line for the voice link. */
export function voiceStatusText(s: VoiceStatus): string {
  if (!s.roles.mic && !s.roles.voices) return "voice link off at this terminal";
  if (s.link === "stopped") return `voice link stopped: ${s.problem ?? "refused"}`;
  const parts: string[] = [];
  if (s.roles.mic) {
    const m =
      s.mic === "live"
        ? s.listening
          ? s.uplink.kind === "retrying"
            ? `microphone heard in the games — retrying (${s.uplink.problem})`
            : "microphone heard in the games now"
          : "microphone ready — nobody in the games is near"
        : s.mic === "insecure"
          ? "microphone needs https (or localhost)"
          : s.mic === "denied"
            ? "microphone refused — allow it for this site (Fully Kiosk: Enable Microphone Access)"
            : s.mic === "none"
              ? "no microphone on this device"
              : s.mic === "error"
                ? "the microphone failed to open"
                : "microphone opening";
    parts.push(m);
  } else parts.push("microphone off");
  if (s.roles.voices) parts.push(s.hearing > 0 ? `hearing ${s.hearing} player${s.hearing === 1 ? "" : "s"}` : "players' voices on");
  else parts.push("players' voices off");
  if (s.link === "connecting") parts.push("connecting…");
  if (s.problem !== null) parts.push(s.problem);
  return `voice link: ${parts.join(" · ")}`;
}

/** Whether to show the 🎤 corner cue: a player in the games hears this room now. */
export function onAir(s: VoiceStatus): boolean {
  return s.roles.mic && s.mic === "live" && s.link === "live" && s.listening;
}

class VoiceStatusStore {
  snapshot: VoiceStatus = VOICE_OFF;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  set(s: VoiceStatus): void {
    this.snapshot = s;
    for (const fn of this.listeners) fn();
  }
}

/** The page's voice link status. */
export const voiceStatus = new VoiceStatusStore();

export function useVoiceStatus(): VoiceStatus {
  return useSyncExternalStore(voiceStatus.subscribe, () => voiceStatus.snapshot);
}

/** The heartbeat's `mic=` right now (null: nothing to say yet). */
export function micHeartbeat(): MicReport | null {
  return voiceStatus.snapshot.report;
}
