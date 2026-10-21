//! The voice link on a terminal (wave 19 — the user's ask: *"people in the
//! real world can be heard on the virtual terminals in the games through
//! the terminal mics, and the guests in the reinstallation games can be
//! heard on the terminals"*). One controller per page, mounted at App level
//! while the terminal is set up (never on the setup screen):
//!
//!   microphone (`mic.ts`) → `capture.ts` → `uplink.ts` → POST /api/spatial/voice
//!   GET /api/spatial/voice/stream (`stream.ts`) → `playback.ts` → the voices bus
//!
//! Which halves run is `roles.ts` (D9, the map's `voice`); the stream says
//! which work right now (`?mic=` / `?hear=`: a refused or locked mic, a
//! speaker under the TV mute or not yet unlocked — re-opened when they
//! change), so the server never routes a player to a device that can't hear
//! them nor counts a dead mic among a player's ears. The server routes (it
//! knows every player's pose and every spot) and says over the stream
//! whether anyone hears this room — the uplink sends only then (D4); the
//! stream is the only authority for that. The half-duplex hold covers
//! everything this page plays: the players, the character's speech
//! (`voiceFloor.busy`), effects, jingles and the chime — extended by the
//! chunk's span and the device's latency, since a chunk is judged when its
//! capture buffer ends, not when its samples were taken. The terminals keep
//! this hard hold (their speaker is beside their mic); the games raise their
//! gate instead (D5b, the barge-in), so a player speaking up is heard here,
//! and this hold then pauses the room for them.
//!
//! `VoiceLink` is the testable core (every effect injected); `startPageLink`
//! wires it to the browser, loaded as its own chunk by `hook.ts`
//! `useVoiceLink`. Its status goes to `status.ts`'s store: ⚙'s status line,
//! the 🎤 corner cue and the heartbeat's `mic=` read it.

import { VOICE_CHUNK_MS } from "@loom/house";
import { baseOf } from "../config.ts";
import { audioContext, audioUnlocked, voiceFloor } from "../speech/engine.ts";
import { setVoicesDucked, soundMuted, soundPlayingUntil, voicesOut } from "../sound/bus.ts";
import { CAPTURE_FRAMES, MicPipeline, startCapture, type CaptureContext } from "./capture.ts";
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

/** What the stream tells the server this device can do right now. */
export interface StreamFlags {
  /** Its room can be heard (a mic that isn't refused, missing or locked). */
  mic: boolean;
  /** It plays what it hears (not muted, not locked). */
  hear: boolean;
}

/** Microphone states that will never send anything. */
const DEAD_MIC = new Set<string>(["denied", "insecure", "none", "error"]);

export interface VoiceLinkDeps {
  roles: VoiceRoles;
  /** The heartbeat's `mic=` for a microphone state. */
  report: (state: MicState | "locked" | null) => MicReport | null;
  hub: Pick<MicHub, "acquire" | "release" | "subscribe" | "snapshot">;
  /** Tap the microphone on the page's context (null: no audio here). */
  capture: (stream: MediaStream, onFrames: (samples: Float32Array) => void) => { rate: number; stop: () => void } | null;
  openStream: (h: StreamHandlers, flags: StreamFlags) => () => void;
  post: (body: Uint8Array, seq: number) => Promise<UplinkAnswer>;
  /** Null when this terminal plays no players. */
  playback: VoicePlayback | null;
  /** The page's context time (s), null without one. */
  ctxTime: () => number | null;
  /** The voice floor is busy (the character / an announcement speaking). */
  floorBusy: () => boolean;
  /** Context seconds when this page's own effects / jingles / chime stop. */
  ownSoundUntil: () => number;
  /** How much later than a capture buffer's end its first sample may have
   *  been taken, plus how late this page's sound reaches the room (ms): the
   *  hold is extended by it. Default 0. */
  latencyMs?: () => number;
  /** The page's audio runs (false: locked until a tap). Default true. */
  audioRunning?: () => boolean;
  /** The page's sounds are muted (the TV's director mute). Default false. */
  soundMuted?: () => boolean;
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
  private flags: StreamFlags | null = null;

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
    this.set({ link: "connecting", locked: this.locked() });
    this.openStream();
    if (roles.mic) this.openMic();
  }

  stop(): void {
    this.alive = false;
    this.closeStream?.();
    this.closeStream = null;
    this.flags = null;
    this.dropMic();
    this.d.playback?.clear();
  }

  /**
   * Re-read what can change under the link (the page's audio unlocking on a
   * tap, the TV mute): the status's `locked` + the heartbeat's `mic=`, and
   * the stream re-opened when what it told the server no longer holds.
   * The page calls it every ~150 ms.
   */
  refresh(): void {
    if (!this.alive) return;
    const locked = this.locked();
    if (locked !== this.status.locked) this.set({ locked, report: this.report(this.status.mic) });
    const f = this.wantFlags();
    if (this.flags !== null && (f.mic !== this.flags.mic || f.hear !== this.flags.hear)) {
      this.closeStream?.();
      this.listen(false);
      this.d.playback?.clear();
      this.set({ link: "connecting", hearing: 0 });
      this.openStream();
    }
  }

  private locked(): boolean {
    return this.d.audioRunning !== undefined && !this.d.audioRunning();
  }

  private report(state: MicState | null): MicReport | null {
    return this.d.report(state === "live" && this.locked() ? "locked" : state);
  }

  private wantFlags(): StreamFlags {
    const locked = this.locked();
    const micDead = this.status.mic !== null && DEAD_MIC.has(this.status.mic);
    return {
      mic: this.d.roles.mic && !locked && !micDead,
      hear: this.d.roles.voices && !locked && !(this.d.soundMuted?.() ?? false),
    };
  }

  private openStream(): void {
    const flags = this.wantFlags();
    this.flags = flags;
    this.closeStream = this.d.openStream(
      {
        onFrame: (f) => this.frame(f),
        onConnected: (on) => this.connected(on),
        onGone: (status) => this.gone(status),
      },
      flags,
    );
  }

  private makeUplink(): Uplink {
    return new Uplink({
      post: this.d.post,
      seq0: Math.max(this.d.seq0, this.uplink?.nextSeq ?? 0),
      now: this.d.now,
      setTimer: this.d.setTimer,
      clearTimer: this.d.clearTimer,
      onStatus: (s) => this.alive && this.set({ uplink: s }),
      // The stream is the authority on `listening` (an answer can arrive
      // after a newer `listen {on}`); a "no" only empties the queue.
      onListening: (on) => {
        if (this.alive && !on) this.uplink?.drop();
      },
    });
  }

  private openMic(): void {
    this.uplink = this.makeUplink();
    this.holdingMic = true;
    this.unwatch = this.d.hub.subscribe(() => {
      if (!this.alive) return;
      const state = this.d.hub.snapshot.state;
      if (state !== this.status.mic) {
        this.set({ mic: state, report: this.report(state) });
        this.refresh();
      }
      // The hub reopened a microphone whose track ended: tap the new stream.
      const stream = this.d.hub.snapshot.stream;
      if (stream !== null && stream !== this.tapped) this.tap(stream);
    });
    void this.d.hub.acquire().then((stream) => {
      if (!this.alive) return;
      const state = this.d.hub.snapshot.state;
      this.set({ mic: state, report: this.report(state) });
      this.refresh();
      if (stream !== null) this.tap(stream);
    });
  }

  /** The stream says the spot is fine again (a hello, a `listen {on}`):
   *  an uplink a 403 / 404 stopped mid-night (a map edit) starts over. */
  private reviveUplink(): void {
    if (!this.d.roles.mic || this.uplink === null || !this.uplink.stopped) return;
    this.uplink = this.makeUplink();
    this.set({ uplink: { kind: "idle" } });
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
    const late = this.d.latencyMs?.() ?? 0;
    if (this.d.floorBusy()) p.quietUntil(now + late);
    const t = this.d.ctxTime();
    if (t !== null) {
      const until = Math.max(this.d.playback?.playingUntil() ?? 0, this.d.ownSoundUntil());
      if (until > t) p.quietUntil(now + (until - t) * 1000 + late);
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
        if (f.listen) this.reviveUplink();
        this.listen(f.listen && this.d.roles.mic);
        return;
      case "listen":
        if (f.on) this.reviveUplink();
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
/** An output latency to assume when the browser reports none (s). */
const DEFAULT_OUTPUT_LATENCY_S = 0.1;

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
  report: (state: MicState | "locked" | null) => MicReport | null;
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
    openStream: (h, f) => {
      const url = `${streamUrl}&mic=${f.mic ? 1 : 0}&hear=${f.hear ? 1 : 0}`;
      return openVoiceStream({ url, probe: () => probeOnce(url), ...h });
    },
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
    latencyMs: () => {
      const ctx = audioContext();
      if (ctx === null) return VOICE_CHUNK_MS;
      const out = (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? ctx.baseLatency ?? DEFAULT_OUTPUT_LATENCY_S;
      return VOICE_CHUNK_MS + (CAPTURE_FRAMES / ctx.sampleRate) * 1000 + (Number.isFinite(out) ? out : DEFAULT_OUTPUT_LATENCY_S) * 1000;
    },
    audioRunning: audioUnlocked,
    soundMuted,
    now: () => performance.now(),
    seq0: Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (t) => window.clearTimeout(t as number),
    onStatus: (s) => voiceStatus.set(s),
  });
  link.start();
  // The players duck under the character's voice (never the other way round);
  // the link re-reads the audio lock and the TV mute on the same beat.
  const duck = window.setInterval(() => {
    if (playback !== null) setVoicesDucked(voiceFloor.busy);
    link.refresh();
  }, DUCK_POLL_MS);
  return () => {
    window.clearInterval(duck);
    link.stop();
    setVoicesDucked(false);
  };
}
