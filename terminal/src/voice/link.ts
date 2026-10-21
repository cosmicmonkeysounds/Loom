//! The voice link on a terminal (wave 19 — the user's ask: *"people in the
//! real world can be heard on the virtual terminals in the games through
//! the terminal mics, and the guests in the reinstallation games can be
//! heard on the terminals"*). One controller per page, mounted at App level
//! while the terminal is set up (never on the setup screen):
//!
//!   microphone (`mic.ts`) → `capture.ts` → `uplink.ts` → POST /api/spatial/voice
//!   GET /api/spatial/voice/stream (`stream.ts`) → `playback.ts` → the voices bus
//!
//! Which halves run is `roles.ts` (D9, the map's `voice`); the server routes
//! (it knows every player's pose and every spot) and says over the stream
//! whether anyone hears this room — the uplink sends only then (D4). The
//! half-duplex hold covers everything this page plays: the players, the
//! character's speech (`voiceFloor.busy`), effects, jingles and the chime.
//!
//! `VoiceLink` is the testable core (every effect injected); `useVoiceLink`
//! wires it to the browser. Its status is a module store: ⚙'s status line,
//! the 🎤 corner cue and the heartbeat's `mic=` read it.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { HouseMap } from "@loom/house";
import { baseOf, type TerminalConfig } from "../config.ts";
import { audioContext, voiceFloor } from "../speech/engine.ts";
import { setVoicesDucked, soundPlayingUntil, voicesOut } from "../sound/bus.ts";
import { fetchHouse } from "../world/stream.ts";
import { MicPipeline, startCapture, type CaptureContext } from "./capture.ts";
import { mic as pageMic, type MicHub, type MicState } from "./mic.ts";
import { VoicePlayback } from "./playback.ts";
import { NO_VOICE, micReport, voiceRoles, type MicReport, type VoiceRoles } from "./roles.ts";
import { openVoiceStream, speaksOurWire, type VoiceFrame } from "./stream.ts";
import { Uplink, uplinkProblem, type UplinkAnswer, type UplinkStatus } from "./uplink.ts";

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

// --- the controller -------------------------------------------------------------

export interface StreamHandlers {
  onFrame: (f: VoiceFrame) => void;
  onConnected: (on: boolean) => void;
  onGone: (status: number) => void;
}

export interface VoiceLinkDeps {
  roles: VoiceRoles;
  /** The heartbeat's `mic=` for a microphone state. */
  report: (state: MicState | null) => MicReport | null;
  hub: Pick<MicHub, "acquire" | "release" | "subscribe" | "snapshot">;
  /** Tap the microphone on the page's context (null: no audio here). */
  capture: (stream: MediaStream, onFrames: (samples: Float32Array) => void) => { rate: number; stop: () => void } | null;
  openStream: (h: StreamHandlers) => () => void;
  post: (body: Uint8Array, seq: number) => Promise<UplinkAnswer>;
  /** Null when this terminal plays no players. */
  playback: VoicePlayback | null;
  /** The page's context time (s), null without one. */
  ctxTime: () => number | null;
  /** The voice floor is busy (the character / an announcement speaking). */
  floorBusy: () => boolean;
  /** Context seconds when this page's own effects / jingles / chime stop. */
  ownSoundUntil: () => number;
  now: () => number;
  seq0: number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  onStatus: (s: VoiceStatus) => void;
}

export class VoiceLink {
  private status: VoiceStatus;
  private uplink: Uplink | null = null;
  private pipeline: MicPipeline | null = null;
  private stopCapture: (() => void) | null = null;
  private tapped: MediaStream | null = null;
  private closeStream: (() => void) | null = null;
  private unwatch: (() => void) | null = null;
  private holdingMic = false;
  private alive = false;

  constructor(private readonly d: VoiceLinkDeps) {
    this.status = { ...VOICE_OFF, roles: d.roles, report: d.report(null) };
  }

  get snapshot(): VoiceStatus {
    return this.status;
  }

  private set(next: Partial<VoiceStatus>): void {
    this.status = { ...this.status, ...next };
    this.d.onStatus(this.status);
  }

  start(): void {
    const { roles } = this.d;
    if (!roles.mic && !roles.voices) {
      this.d.onStatus(this.status);
      return;
    }
    this.alive = true;
    this.set({ link: "connecting" });
    this.closeStream = this.d.openStream({
      onFrame: (f) => this.frame(f),
      onConnected: (on) => this.connected(on),
      onGone: (status) => this.gone(status),
    });
    if (roles.mic) this.openMic();
  }

  stop(): void {
    this.alive = false;
    this.closeStream?.();
    this.closeStream = null;
    this.dropMic();
    this.d.playback?.clear();
  }

  private openMic(): void {
    this.uplink = new Uplink({
      post: this.d.post,
      seq0: this.d.seq0,
      now: this.d.now,
      setTimer: this.d.setTimer,
      clearTimer: this.d.clearTimer,
      onStatus: (s) => this.alive && this.set({ uplink: s }),
      onListening: (on) => this.alive && this.listen(on),
    });
    this.holdingMic = true;
    this.unwatch = this.d.hub.subscribe(() => {
      if (!this.alive) return;
      const state = this.d.hub.snapshot.state;
      if (state !== this.status.mic) this.set({ mic: state, report: this.d.report(state) });
      // The hub reopened a microphone whose track ended: tap the new stream.
      const stream = this.d.hub.snapshot.stream;
      if (stream !== null && stream !== this.tapped) this.tap(stream);
    });
    void this.d.hub.acquire().then((stream) => {
      if (!this.alive) return;
      const state = this.d.hub.snapshot.state;
      this.set({ mic: state, report: this.d.report(state) });
      if (stream !== null) this.tap(stream);
    });
  }

  private tap(stream: MediaStream): void {
    this.stopCapture?.();
    this.stopCapture = null;
    this.tapped = stream;
    let cap: { rate: number; stop: () => void } | null = null;
    try {
      cap = this.d.capture(stream, (samples) => this.frames(samples));
    } catch {
      cap = null;
    }
    if (cap === null) {
      this.set({ problem: "this device can't capture audio" });
      return;
    }
    this.pipeline = new MicPipeline(cap.rate);
    this.stopCapture = cap.stop;
  }

  private dropMic(): void {
    this.stopCapture?.();
    this.stopCapture = null;
    this.tapped = null;
    this.unwatch?.();
    this.unwatch = null;
    this.uplink?.stop();
    this.uplink = null;
    this.pipeline = null;
    if (this.holdingMic) this.d.hub.release();
    this.holdingMic = false;
  }

  /** One capture buffer: the half-duplex hold, the gate, then up if heard. */
  private frames(samples: Float32Array): void {
    const p = this.pipeline;
    if (!this.alive || p === null) return;
    const now = this.d.now();
    if (this.d.floorBusy()) p.quietUntil(now);
    const t = this.d.ctxTime();
    if (t !== null) {
      const until = Math.max(this.d.playback?.playingUntil() ?? 0, this.d.ownSoundUntil());
      if (until > t) p.quietUntil(now + (until - t) * 1000);
    }
    const chunks = p.push(samples, now);
    if (!this.status.listening || this.uplink === null) return;
    for (const c of chunks) this.uplink.send(c);
  }

  private listen(on: boolean): void {
    if (on === this.status.listening) return;
    if (!on) this.uplink?.drop();
    this.set({ listening: on });
  }

  private frame(f: VoiceFrame): void {
    if (!this.alive) return;
    switch (f.type) {
      case "hello":
        if (!speaksOurWire(f)) {
          this.gone(0, `the server speaks ${f.codec || "another codec"} at ${f.rate} Hz, not this terminal's μ-law at 16 kHz — reload the page`);
          return;
        }
        this.set({ link: "live" });
        this.listen(f.listen && this.d.roles.mic);
        return;
      case "listen":
        this.listen(f.on && this.d.roles.mic);
        return;
      case "voice":
        if (this.d.playback === null || f.kind !== "player") return;
        this.d.playback.push(f);
        if (this.d.playback.count !== this.status.hearing) this.set({ hearing: this.d.playback.count });
        return;
      case "bye":
        if (this.d.playback === null) return;
        this.d.playback.bye(f.from);
        if (this.d.playback.count !== this.status.hearing) this.set({ hearing: this.d.playback.count });
        return;
    }
  }

  private connected(on: boolean): void {
    if (!this.alive) return;
    if (on) {
      if (this.status.link !== "live") this.set({ link: "live" });
      return;
    }
    this.listen(false);
    this.d.playback?.clear();
    this.set({ link: "connecting", hearing: 0 });
  }

  private gone(status: number, problem = uplinkProblem(status)): void {
    this.stop();
    this.set({ link: "stopped", listening: false, hearing: 0, problem, mic: null, report: this.d.report(null) });
  }
}

// --- the page's link ------------------------------------------------------------

/** How often the voices bus re-checks the voice floor for its duck (ms). */
const DUCK_POLL_MS = 150;

/** GET the stream once for its refusal status (then abort the body). */
function probeOnce(url: string): Promise<number | null> {
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(
    (r) => {
      ctrl?.abort();
      return r.status;
    },
    () => null,
  );
}

/**
 * Run this terminal's voice link while `active` (set up, not on the setup
 * screen). Reads the event's map once per spot so the tent never opens its
 * microphone (`voiceRoles` with the live map; the stored `voiceLink` when the
 * map can't be read). Returns the map it read (null: none yet / no spot).
 */
export function useVoiceLink(config: TerminalConfig | null, active: boolean, hub: MicHub = pageMic): Pick<HouseMap, "terminals" | "spawn"> | null {
  const eventId = config?.eventId ?? "";
  const token = config?.token ?? "";
  const spot = config?.spot.trim() ?? "";
  const placed = active && config !== null && spot !== "";
  // The map, once per spot: undefined = still reading, null = unreadable.
  const [house, setHouse] = useState<{ key: string; map: Pick<HouseMap, "terminals" | "spawn"> | null } | undefined>(undefined);
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

  useEffect(() => {
    const reportOf = (state: MicState | null) => (config === null || !active ? null : micReport(config, map ?? null, state));
    if (!ready || config === null || (!roles.mic && !roles.voices)) {
      voiceStatus.set({ ...VOICE_OFF, report: reportOf(null) ?? "off" });
      return;
    }
    const base = baseOf({ eventId });
    const q = `spot=${encodeURIComponent(spot)}`;
    const streamUrl = `${base}/api/spatial/voice/stream?token=${encodeURIComponent(token)}&${q}`;
    const playback = roles.voices ? new VoicePlayback(voicesOut) : null;
    const link = new VoiceLink({
      roles,
      report: reportOf,
      hub,
      capture: (stream, onFrames) => {
        const ctx = audioContext();
        if (ctx === null || typeof ctx.createScriptProcessor !== "function") return null;
        return { rate: ctx.sampleRate, stop: startCapture(ctx as CaptureContext, stream, onFrames) };
      },
      openStream: (h) => openVoiceStream({ url: streamUrl, probe: () => probeOnce(streamUrl), ...h }),
      post: (body, seq) =>
        fetch(`${base}/api/spatial/voice?seq=${seq}&${q}`, { method: "POST", headers: { "content-type": "application/octet-stream", "x-loom-token": token }, body }).then(
          async (r) => {
            const b = (await r.json().catch(() => null)) as { listening?: unknown } | null;
            return { status: r.status, ...(typeof b?.listening === "boolean" ? { listening: b.listening } : {}) };
          },
          () => ({ status: null }),
        ),
      playback,
      ctxTime: () => audioContext()?.currentTime ?? null,
      floorBusy: () => voiceFloor.busy,
      ownSoundUntil: soundPlayingUntil,
      now: () => performance.now(),
      seq0: Date.now(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (t) => window.clearTimeout(t as number),
      onStatus: (s) => voiceStatus.set(s),
    });
    link.start();
    // The players duck under the character's voice (never the other way round).
    const duck = playback === null ? 0 : window.setInterval(() => setVoicesDucked(voiceFloor.busy), DUCK_POLL_MS);
    return () => {
      window.clearInterval(duck);
      link.stop();
      setVoicesDucked(false);
      voiceStatus.set(VOICE_OFF);
    };
  }, [ready, active, roles, eventId, token, spot, view, micFlag, map, hub]);
  return map ?? null;
}

