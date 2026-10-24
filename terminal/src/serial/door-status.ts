//! The door sensor's status (wave 20), a module store in the base bundle:
//! the heartbeat's door keys (`doorHeartbeat`, `health.ts`), the heart's
//! choice panel and overlay (the local reading), and ⚙'s live line. The
//! bridge itself (`door-serial.ts`, a lazy chunk) writes it; nothing here
//! touches a port. Since wave 22 it carries the patch bay too (the same
//! board, the same port): its last `patch` line, the levels `pbcal` lines
//! report, and the heartbeat's `pb` / `pbc` / `pbx` / `pft` keys.

import { useSyncExternalStore } from "react";
import type { BayCommand, CalLine, ErrLine, HelloLine, PbcalLine } from "./door-protocol.ts";
import { doorQuery, doorReport, type SensorState } from "./door-bridge.ts";
import { patchQuery, patchReport, type PatchState } from "./patch-bridge.ts";

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
  /** This terminal's stored calibration was taken in another mode than the
   *  board runs now (the LED rewired, the firmware rebuilt): it was not
   *  re-sent, and ⚙ asks for a calibration. */
  recal: boolean;
  /** The board reads a patch bay and this terminal bridges it (wave 22:
   *  `hello` / `cfg` said `pbd > 0`, and the config's `bay` is on). Kept
   *  through a disconnect, so the heartbeat says `pb=fault`. */
  bay: boolean;
  /** The bay as last read (null: none since connect). */
  patch: PatchState | null;
  /** The last `pb` answer: the levels, or the firmware's error (⚙). */
  pbcal: PbcalLine | ErrLine | null;
  /** How many combinations this terminal has posted (⚙'s line). */
  patchPosts: number;
}

export const DOOR_OFF: DoorStatus = { configured: false, kind: null, connected: false, unsupported: false, sensor: null, board: null, cal: null, problem: null, recal: false, bay: false, patch: null, pbcal: null, patchPosts: 0 };

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

/** The heartbeat's door keys now (`door`, `dlv`, `dft`, `dwn`, and the
 *  bay's `pb`, `pbc`, `pbx`, `pft`): none when no sensor is configured,
 *  no bay keys when the board has no bay. */
export function doorHeartbeat(now: number = Date.now(), s: DoorStatus = status): Record<string, string> {
  if (!s.configured) return {};
  const q = doorQuery(doorReport({ connected: s.connected, sensor: s.sensor, now }));
  return s.bay ? { ...q, ...patchQuery(patchReport({ connected: s.connected, reading: s.patch, now })) } : q;
}

/** ⚙'s line for the patch bay (null: no bay at this terminal). */
export function patchStatusText(s: DoorStatus, now: number = Date.now()): string | null {
  if (!s.configured || !s.bay) return null;
  const r = patchReport({ connected: s.connected, reading: s.patch, now });
  const tag = s.kind === "sim" ? "simulated patch bay" : "patch bay";
  const posts = s.patchPosts > 0 ? ` · ${s.patchPosts} posted` : "";
  if (r.pb === "fault") return `${tag}: FAULT (${r.fault ?? "?"})${posts}`;
  const between = r.between !== undefined && r.between > 0 ? ` · ⚠ ${r.between} between levels` : "";
  const settling = s.patch !== null && !s.patch.stable ? " · settling…" : "";
  return `${tag}: ${r.pb} cable${r.pb === 1 ? "" : "s"}${r.complete === true ? " · COMPLETE" : ""}${between}${settling}${posts}`;
}

/** ⚙'s line for the door sensor. */
export function doorStatusText(s: DoorStatus, now: number = Date.now()): string {
  if (!s.configured) return "no door sensor at this terminal";
  if (s.unsupported) return "the door sensor needs desktop Chrome on https (Web Serial)";
  if (!s.connected) return s.problem ?? (s.kind === "sim" ? "simulated door: starting" : "door sensor not connected — press Connect door sensor");
  const r = doorReport({ connected: true, sensor: s.sensor, now });
  const tag = s.kind === "sim" ? "simulated door" : "door sensor";
  // The LED's wiring as the board runs it: `mod` is the LED pulsed on D2.
  const wiring = s.board === null ? "" : ` · ${s.board.mode === "mod" ? "pulsed" : "steady"}${s.board.auto ? " (auto)" : ""}`;
  const recal = s.recal ? " · ⚠ calibrate again: the sensor's wiring changed" : "";
  if (r.door === "fault") return `${tag}: FAULT (${r.fault ?? "?"})${r.level !== undefined ? ` · level ${r.level}` : ""}${wiring}${recal}`;
  return `${tag}: ${r.door === "open" ? "OPEN" : "SHUT"} · level ${r.level ?? 0}${r.warn !== undefined ? ` · ⚠ ${r.warn}` : ""}${wiring}${recal}`;
}

/** What ⚙ can ask of the running bridge (null: none running). */
export interface DoorActions {
  /** `cal closed` / `cal open`: the answer (or the firmware's error). */
  calibrate(which: "closed" | "open"): Promise<CalLine | ErrLine>;
  /** A `pb …` command (wave 22): the board's `pbcal` answer, or its error. */
  bay(cmd: BayCommand): Promise<PbcalLine | ErrLine>;
}

let actions: DoorActions | null = null;

export function setDoorActions(a: DoorActions | null): void {
  actions = a;
}

export function doorActions(): DoorActions | null {
  return actions;
}

const rescanners = new Set<() => void>();

/** A port was just granted (⚙): the running bridge looks for it now. */
export function doorRescan(): void {
  for (const r of [...rescanners]) r();
}

export function onDoorRescan(r: () => void): () => void {
  rescanners.add(r);
  return () => void rescanners.delete(r);
}
