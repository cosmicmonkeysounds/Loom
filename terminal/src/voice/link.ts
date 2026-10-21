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
//! `VoiceLink` is the testable core (every effect injected); `startPageLink`
//! wires it to the browser, loaded as its own chunk by `hook.ts`
//! `useVoiceLink`. Its status goes to `status.ts`'s store: ⚙'s status line,
//! the 🎤 corner cue and the heartbeat's `mic=` read it.

import { baseOf } from "../config.ts";
import { audioContext, voiceFloor } from "../speech/engine.ts";
import { setVoicesDucked, soundPlayingUntil, voicesOut } from "../sound/bus.ts";
import { MicPipeline, startCapture, type CaptureContext } from "./capture.ts";
import { mic as pageMic, type MicHub, type MicState } from "./mic.ts";
import { VoicePlayback } from "./playback.ts";
import type { MicReport, VoiceRoles } from "./roles.ts";
import { openVoiceStream, speaksOurWire, type VoiceFrame } from "./stream.ts";
import { VOICE_OFF, voiceStatus, type VoiceStatus } from "./status.ts";
import { Uplink, uplinkProblem, type UplinkAnswer } from "./uplink.ts";

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

/** Where and as what the page's link runs. */
export interface PageLink {
  eventId: string;
  token: string;
  spot: string;
  roles: VoiceRoles;
  report: (state: MicState | null) => MicReport | null;
  hub?: MicHub;
}

/**
 * Start the page's link on the browser (the lazy half of `hook.ts`
 * `useVoiceLink`): the microphone, the page's context, `fetch` and an
 * `EventSource`. Returns the stopper.
 */
export function startPageLink(o: PageLink): () => void {
  const { eventId, token, spot, roles } = o;
  const base = baseOf({ eventId });
  const q = `spot=${encodeURIComponent(spot)}`;
  const streamUrl = `${base}/api/spatial/voice/stream?token=${encodeURIComponent(token)}&${q}`;
  const playback = roles.voices ? new VoicePlayback(voicesOut) : null;
  const link = new VoiceLink({
    roles,
    report: o.report,
    hub: o.hub ?? pageMic,
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
  };
}
