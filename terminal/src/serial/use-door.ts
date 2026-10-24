//! The door bridge's hook (wave 20), in the base bundle: a terminal set up
//! with a door sensor (`door=serial` / `sim`) loads the bridge's chunk
//! (`door-serial.ts`, Web Serial + the decisions) and feeds it every screen
//! state, so the reconcile runs on each poll (and the patch bay's gate, wave
//! 22, follows `night.patch_override`). With no sensor nothing loads.

import { useEffect, useRef } from "react";
import type { TerminalConfig } from "../config.ts";
import { retryable } from "../retry.ts";
import type { ScreenState } from "../screen.ts";
import type { DoorLink } from "./door-serial.ts";
import { DOOR_OFF, patchDoorStatus, setDoorStatus } from "./door-status.ts";

export const loadDoorSerial = retryable(() => import("./door-serial.ts"));

/** How long before a chunk that failed to load is asked for again (ms). */
const DOOR_RETRY_MS = 30_000;

export function useDoorLink(config: TerminalConfig | null, state: ScreenState | null): void {
  const link = useRef<DoorLink | null>(null);
  useEffect(() => {
    if (config === null || config.door === "off") {
      setDoorStatus(DOOR_OFF);
      return;
    }
    let alive = true;
    let timer = 0;
    // Configured from the first poll: until the port is open the heartbeat says so.
    setDoorStatus({ ...DOOR_OFF, configured: true, kind: config.door });
    const start = () => {
      loadDoorSerial().then(
        (m) => {
          if (!alive) return;
          link.current = m.startDoorLink(config);
        },
        () => {
          if (!alive) return;
          patchDoorStatus({ problem: "the door sensor's code didn't load — retrying" });
          timer = window.setTimeout(start, DOOR_RETRY_MS);
        },
      );
    };
    start();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      link.current?.stop();
      link.current = null;
      setDoorStatus(DOOR_OFF);
    };
  }, [config]);
  useEffect(() => {
    if (state !== null) link.current?.screen({ server_door: state.night.server_door, door_override: state.night.door_override, patch_override: state.night.patch_override });
  }, [state]);
}
