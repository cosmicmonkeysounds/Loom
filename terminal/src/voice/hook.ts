//! The voice link's mount (wave 19): `useVoiceLink` decides — off the view,
//! ⚙ and the event's live map (`roles.ts`) — whether this page takes part,
//! and only then loads the link itself (`link.ts`, its own chunk: the codec,
//! the uplink, the stream, the playback), so a terminal that takes no part
//! (the mirror, the tent, an unplaced tablet) never fetches it.
//!
//! The map is read once per spot before anything opens, so the tent never
//! asks for its microphone; the stored `voiceLink` stands in when the map
//! can't be read (the server refuses the tent's uploads either way).

import { useEffect, useMemo, useState } from "react";
import type { HouseMap } from "@loom/house";
import type { TerminalConfig } from "../config.ts";
import { retryable } from "../retry.ts";
import { fetchHouse } from "../world/stream.ts";
import type { MicState } from "./mic.ts";
import { NO_VOICE, micReport, voiceRoles, type VoiceRoles } from "./roles.ts";
import { VOICE_OFF, voiceStatus } from "./status.ts";

const loadLink = retryable(() => import("./link.ts"));
/** After the link's chunk failed to load, try again this much later (ms). */
const LINK_RETRY_MS = 30_000;

type VoiceMap = Pick<HouseMap, "terminals" | "spawn">;

/**
 * Run this terminal's voice link while `active` (set up: never on the
 * setup screen). Returns the map it read for the spot (null: none yet, no
 * spot, or unreadable) — the caller keeps the stored `voiceLink` in step.
 */
export function useVoiceLink(config: TerminalConfig | null, active: boolean): VoiceMap | null {
  const eventId = config?.eventId ?? "";
  const token = config?.token ?? "";
  const spot = config?.spot.trim() ?? "";
  const placed = active && config !== null && spot !== "";
  // The map, once per spot: undefined = still reading, null = unreadable.
  const [house, setHouse] = useState<{ key: string; map: VoiceMap | null } | undefined>(undefined);
  const key = `${eventId}|${token}|${spot}`;
  useEffect(() => {
    if (!placed) return;
    let alive = true;
    void fetchHouse({ eventId, token }).then(
      (h) => alive && setHouse({ key, map: h.house }),
      () => alive && setHouse({ key, map: null }),
    );
    return () => {
      alive = false;
    };
  }, [placed, eventId, token, key]);
  const map = house !== undefined && house.key === key ? house.map : undefined;
  const ready = placed && map !== undefined;
  const r = config === null || !ready ? NO_VOICE : voiceRoles(config, map);
  // Kept by value: a name / character change never restarts the link.
  const roles = useMemo<VoiceRoles>(() => ({ mic: r.mic, voices: r.voices }), [r.mic, r.voices]);
  const view = config?.view;
  const micFlag = config?.mic;
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const reportOf = (state: MicState | null) => (config === null || !active ? null : micReport(config, map ?? null, state));
    if (!ready || config === null || (!roles.mic && !roles.voices)) {
      voiceStatus.set({ ...VOICE_OFF, report: reportOf(null) ?? "off" });
      return;
    }
    let alive = true;
    let stop: (() => void) | null = null;
    let retry = 0;
    void loadLink().then(
      (m) => {
        if (alive) stop = m.startPageLink({ eventId, token, spot, roles, report: reportOf });
      },
      () => {
        if (!alive) return;
        voiceStatus.set({ ...VOICE_OFF, roles, link: "stopped", problem: "the voice link's code didn't load — retrying", report: null });
        retry = window.setTimeout(() => setAttempt((n) => n + 1), LINK_RETRY_MS);
      },
    );
    return () => {
      alive = false;
      window.clearTimeout(retry);
      stop?.();
      voiceStatus.set(VOICE_OFF);
    };
  }, [ready, active, roles, eventId, token, spot, view, micFlag, map, attempt]);
  return map ?? null;
}
