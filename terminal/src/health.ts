//! The device health a terminal reports on every screen-state poll
//! (SW-SCR-21): is its sound unlocked, is the page visible, its battery, and
//! whether it is full screen, which build it runs, whether it says the house
//! announcements (wave 18b, `ann`: its own setting or the house list's) — so on install day (and on the night) the director's
//! Run → Terminals card shows a tablet nobody has touched (🔇), one whose
//! screen went off (💤), one running flat, or one still on a cached old build.
//! Wave 19 adds the voice link's microphone (`mic=live|muted|denied|insecure|off`,
//! `voice/roles.ts` `micReport`): a tablet whose microphone was refused or
//! needs https shows before the doors. Wave 20 adds the server-room door
//! sensor this terminal bridges (`door=open|closed|fault`, `dlv=` its level,
//! `dft=` a blocking fault, `dwn=` a warning; `serial/door-status.ts`).
//!
//! The poll is the heartbeat: a throw here would stop it and turn the tablet
//! red, so every read is guarded and `deviceHealth()` never throws. Chrome 87
//! has `navigator.getBattery`; iOS / Safari don't (no `bat=` is sent).

import { fullscreenFlag } from "./fullscreen.ts";
import { audioUnlocked } from "./speech/engine.ts";
import type { MicReport } from "./voice/roles.ts";
import { micHeartbeat } from "./voice/status.ts";
import { doorHeartbeat } from "./serial/door-status.ts";

declare const __BUILD__: string | undefined;

/** This build's stamp (`vite.config.ts` defines it: git short sha + build time). */
export const BUILD: string = typeof __BUILD__ === "string" && __BUILD__ !== "" ? __BUILD__ : "dev";

export interface DeviceHealth {
  audio: boolean | null;
  visible: boolean | null;
  /** 0–100, null = no battery API. */
  battery: number | null;
  charging: boolean | null;
  version: string;
  /** Full screen right now (wave 17); null / absent = can't be, or not asked. */
  fullscreen?: boolean | null;
  /** Says the house announcements (wave 18b, Q8: `announceSetting`); null / absent = not asked. */
  announce?: boolean | null;
  /** The voice link's microphone (wave 19); null / absent = nothing to say yet. */
  mic?: MicReport | null;
  /** The door sensor this terminal bridges (wave 20): its `door` / `dlv` /
   *  `dft` / `dwn` keys, absent when none is configured. */
  door?: Record<string, string>;
}

/** The poll's query fields: `audio=1|0`, `vis=v|h`, `bat=<0-100>[c]`, `fs=1|0`, `ann=1|0`, `mic=<state>`, `ver=<build>`. */
export function deviceQuery(h: DeviceHealth): Record<string, string> {
  const q: Record<string, string> = { ver: h.version };
  if (h.audio !== null) q["audio"] = h.audio ? "1" : "0";
  if (h.visible !== null) q["vis"] = h.visible ? "v" : "h";
  if (h.fullscreen !== undefined && h.fullscreen !== null) q["fs"] = h.fullscreen ? "1" : "0";
  if (h.announce !== undefined && h.announce !== null) q["ann"] = h.announce ? "1" : "0";
  if (h.mic !== undefined && h.mic !== null) q["mic"] = h.mic;
  if (h.door !== undefined) for (const k of ["door", "dlv", "dft", "dwn"]) if (h.door[k] !== undefined) q[k] = h.door[k]!;
  if (h.battery !== null && Number.isFinite(h.battery)) q["bat"] = `${Math.max(0, Math.min(100, Math.round(h.battery)))}${h.charging === true ? "c" : ""}`;
  return q;
}

interface BatteryLike {
  level: number;
  charging: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
}

/** The last battery reading (null until `getBattery` answers, or never). */
export interface BatteryWatch {
  read(): { level: number; charging: boolean } | null;
}

/** Ask `getBattery` once and keep its reading fresh off the battery's
 *  events. Absent, refused or throwing: always null. */
export function watchBattery(nav: unknown): BatteryWatch {
  let last: { level: number; charging: boolean } | null = null;
  try {
    const get = (nav as { getBattery?: () => Promise<BatteryLike> } | null)?.getBattery;
    if (typeof get === "function") {
      get.call(nav).then(
        (b) => {
          const update = () => {
            if (typeof b.level === "number" && Number.isFinite(b.level)) last = { level: Math.round(b.level * 100), charging: b.charging === true };
          };
          update();
          try {
            b.addEventListener?.("levelchange", update);
            b.addEventListener?.("chargingchange", update);
          } catch {
            /* a reading without updates is still a reading */
          }
        },
        () => {},
      );
    }
  } catch {
    /* no battery API */
  }
  return { read: () => last };
}

let battery: BatteryWatch | null = null;

/** This device's health right now (`announce`: whether it says the house
 *  announcements, which the caller knows). Never throws. */
export function deviceHealth(announce: boolean | null = null): DeviceHealth {
  const safe = <T>(f: () => T, fallback: T): T => {
    try {
      return f();
    } catch {
      return fallback;
    }
  };
  battery ??= safe(() => watchBattery(typeof navigator === "undefined" ? null : navigator), { read: () => null });
  const b = safe(() => battery!.read(), null);
  return {
    audio: safe(() => audioUnlocked(), null),
    visible: safe(() => (typeof document === "undefined" ? null : document.visibilityState === "visible"), null),
    battery: b?.level ?? null,
    charging: b?.charging ?? null,
    version: BUILD,
    fullscreen: safe(() => fullscreenFlag(), null),
    announce,
    mic: safe(() => micHeartbeat(), null),
    door: safe(() => doorHeartbeat(), {}),
  };
}
