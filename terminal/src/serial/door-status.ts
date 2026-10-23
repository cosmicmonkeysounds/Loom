//! The door sensor's status (wave 20), a module store in the base bundle:
//! the heartbeat's door keys (`doorHeartbeat`, `health.ts`), the heart's
//! choice panel and overlay (the local reading), and ⚙'s live line. The
//! bridge itself (`door-serial.ts`, a lazy chunk) writes it; nothing here
//! touches a port.

import { useSyncExternalStore } from "react";
import type { CalLine, ErrLine, HelloLine } from "./door-protocol.ts";
import { doorQuery, doorReport, type SensorState } from "./door-bridge.ts";

export interface DoorStatus {
  /** A sensor is configured on this terminal (`door=serial` / `sim`). */
  configured: boolean;
  /** `serial`: Web Serial; `sim`: the dev keys (O / C / F). */
  kind: "serial" | "sim" | null;
  /** The port is open and reading. */
  connected: boolean;
  /** This browser can't do Web Serial (⚙ says so). */
  unsupported: boolean;
  /** The last reading (null: none since connect). */
  sensor: SensorState | null;
  /** What the board says it runs (`hello` / `cfg`). */
  board: Omit<HelloLine, "t"> | null;
  /** The last calibration answer or error (⚙ shows it). */
  cal: CalLine | ErrLine | null;
  /** Why the port isn't open (⚙). */
  problem: string | null;
}

export const DOOR_OFF: DoorStatus = { configured: false, kind: null, connected: false, unsupported: false, sensor: null, board: null, cal: null, problem: null };

let status: DoorStatus = DOOR_OFF;
const listeners = new Set<() => void>();

export function setDoorStatus(next: DoorStatus): void {
  status = next;
  for (const l of [...listeners]) l();
}

export function patchDoorStatus(p: Partial<DoorStatus>): void {
  setDoorStatus({ ...status, ...p });
}

export function doorStatus(): DoorStatus {
  return status;
}

export function onDoorStatus(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export function useDoorStatus(): DoorStatus {
  return useSyncExternalStore(onDoorStatus, doorStatus, doorStatus);
}

/** The heartbeat's door keys now (`door`, `dlv`, `dft`, `dwn`): none when no sensor is configured. */
export function doorHeartbeat(now: number = Date.now(), s: DoorStatus = status): Record<string, string> {
  if (!s.configured) return {};
  return doorQuery(doorReport({ connected: s.connected, sensor: s.sensor, now }));
}

/** ⚙'s line for the door sensor. */
export function doorStatusText(s: DoorStatus, now: number = Date.now()): string {
  if (!s.configured) return "no door sensor at this terminal";
  if (s.unsupported) return "the door sensor needs desktop Chrome on https (Web Serial)";
  if (!s.connected) return s.problem ?? (s.kind === "sim" ? "simulated door: starting" : "door sensor not connected — press Connect door sensor");
  const r = doorReport({ connected: true, sensor: s.sensor, now });
  const tag = s.kind === "sim" ? "simulated door" : "door sensor";
  if (r.door === "fault") return `${tag}: FAULT (${r.fault ?? "?"})${r.level !== undefined ? ` · level ${r.level}` : ""}`;
  return `${tag}: ${r.door === "open" ? "OPEN" : "SHUT"} · level ${r.level ?? 0}${r.warn !== undefined ? ` · ⚠ ${r.warn}` : ""}`;
}
