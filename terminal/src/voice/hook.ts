//! The voice link's mount (wave 19): `useVoiceLink` decides — off the view,
//! ⚙ and the event's live map (`roles.ts`) — whether this page takes part,
//! and only then loads the link itself (`link.ts`, its own chunk: the codec,
//! the uplink, the stream, the playback), so a terminal that takes no part
//! (the mirror, the tent, an unplaced tablet) never fetches it.
//!
//! The map is read before anything opens, so the tent never asks for its
//! microphone: a failed read is retried (5 s, doubling to 60 s), and until
//! one lands the stored `voiceLink` stands in only when a map once set it (a
//! config from before wave 19 has none: no link until the map is read). The
//! map is re-read every minute after, so a director turning a spot's link on
//! or off takes effect without a reload (the link restarts only when that
//! spot's answer changes).

import { useEffect, useMemo, useState } from "react";
import type { HouseMap } from "@loom/house";
import { voiceOn } from "@loom/house/voice-on";
import type { TerminalConfig } from "../config.ts";
import { retryable } from "../retry.ts";
import { fetchHouse } from "../world/stream.ts";
import type { MicState } from "./mic.ts";
import { NO_VOICE, micReport, voiceRoles, type VoiceRoles } from "./roles.ts";
import { VOICE_OFF, voiceStatus } from "./status.ts";

const loadLink = retryable(() => import("./link.ts"));
/** After the link's chunk failed to load, try again this much later (ms). */
const LINK_RETRY_MS = 30_000;
/** A failed map read is tried again after this, doubling (ms)… */
export const MAP_RETRY_MS = 5_000;
/** … up to this. */
export const MAP_RETRY_MAX_MS = 60_000;
/** A read map is read again this often (ms). */
export const MAP_REREAD_MS = 60_000;

type VoiceMap = Pick<HouseMap, "terminals" | "spawn">;

/** What of a map the link depends on for `spot`: whether it has the spot,
 *  and its voice link there. A re-read map with the same key changes nothing. */
export function mapVoiceKey(map: VoiceMap | null, spot: string): string {
  if (map === null) return "unread";
  return map.terminals.some((t) => t.id === spot) ? (voiceOn(map as HouseMap, spot) ? "on" : "off") : "absent";
}

/** The roles before / without a readable map: the stored flag stands in only
 *  when a map once set it. */
export function rolesWithoutMap(config: TerminalConfig): VoiceRoles {
  return config.voiceLink === undefined ? NO_VOICE : voiceRoles(config, null);
}

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
    let timer = 0;
    let wait = MAP_RETRY_MS;
    const read = (): void => {
      void fetchHouse({ eventId, token }).then(
        (h) => {
          if (!alive) return;
          wait = MAP_RETRY_MS;
          setHouse((now) => (now !== undefined && now.key === key && now.map !== null && mapVoiceKey(now.map, spot) === mapVoiceKey(h.house, spot) ? now : { key, map: h.house }));
          timer = window.setTimeout(read, MAP_REREAD_MS);
        },
        () => {
          if (!alive) return;
          // Keep a map already read (a blip); else say it is unreadable for now.
          setHouse((now) => (now !== undefined && now.key === key && now.map !== null ? now : { key, map: null }));
          timer = window.setTimeout(read, wait);
          wait = Math.min(MAP_RETRY_MAX_MS, wait * 2);
        },
      );
    };
    read();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [placed, eventId, token, key, spot]);
  const map = house !== undefined && house.key === key ? house.map : undefined;
  const ready = placed && map !== undefined;
  const r = config === null || !ready ? NO_VOICE : map === null ? rolesWithoutMap(config) : voiceRoles(config, map);
  // Kept by value: a name / character change never restarts the link.
  const roles = useMemo<VoiceRoles>(() => ({ mic: r.mic, voices: r.voices }), [r.mic, r.voices]);
  const view = config?.view;
  const micFlag = config?.mic;
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const reportOf = (state: MicState | "locked" | null) => (config === null || !active ? null : micReport(config, map ?? null, state));
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
