//! Sound — all synthesised with WebAudio (no assets to ship, no CSP to
//! bend): Gerald's quack (a buzzy sawtooth through a nasal formant, pitch
//! falling, two syllables), the celebration fanfare, the failure buzz,
//! the King's thud, and (wave 26) the void's jump-scare screech and the
//! disk's pickup blip. Needs one user gesture first (`resume` on the tap that
//! starts the game); without WebAudio every call is a no-op. Wave 49 adds the
//! descent's: the steps behind you, the growl, a wrong quack, a prop's mumble,
//! a breath, mains hum, a slide, a door, the Hallway's drone. The voice link
//! (`voice.ts`) plays and captures on this same context (`context()`): one
//! context to unlock, never two.
//!
//! On the tent laptop (wave 18b) the game plays inside the terminal page:
//! `createSfx(soundOutput)` borrows the terminal's context and master bus
//! (`terminal/src/sound/bus.ts`) instead of opening a context of its own,
//! and never closes what it borrowed. The tent has no voice link, only the
//! TV's sound (wave 59), which plays into this same output.

export interface Sfx {
  /** Call from a user gesture. */
  resume(): void;
  /** A quack at `volume` 0…1, panned −1 (left) … 1 (right). */
  quack(volume: number, pan?: number): void;
  /** The win: a rising arpeggio and a sparkle. */
  fanfare(): void;
  /** A soft "no" (the server said not yet). */
  buzz(): void;
  /** A hit landing on the King: a short low thump with a noise burst. */
  thud(): void;
  /** The void's jump scare (wave 26, R4): a ~1.2 s screech — a noise burst
   *  over two detuned saws falling from a shriek to a growl. */
  scare(): void;
  /** A disk picked up (wave 26, R7): a short rising blip. */
  pickup(): void;
  /** (wave 49) One heavy step, low and close, at `volume` 0…1. */
  step(volume: number, pan?: number): void;
  /** (wave 49) Something large, low, and behind you: ~3 s. */
  growl(pan?: number): void;
  /** (wave 49) A quack that rises where Gerald's falls, in two voices. */
  wrongQuack(volume: number, pan?: number): void;
  /** (wave 49) An awake prop muttering to itself, words just out of reach. */
  mumble(volume: number, pan?: number): void;
  /** (wave 49) A breath at the ear, from no direction. */
  breath(): void;
  /** (wave 49) The mains sagging: a buzz and two relays (`flicker`). */
  mains(): void;
  /** (wave 49) A low chord going sour (`tint`). */
  sour(): void;
  /** (wave 49) A slow slide down or up (`small`, `big`). */
  slide(up: boolean): void;
  /** (wave 49) A door arriving where there was none. */
  doorArrives(): void;
  /** (wave 49) The Hallway's drone, on or off. */
  drone(on: boolean): void;
  /** The shared context and the effects' master bus (made on first use),
   *  null without WebAudio or once closed. */
  context(): { ctx: AudioContext; out: AudioNode } | null;
  dispose(): void;
}

type Ctx = AudioContext;

/** Where a host's sounds go (the terminal's `soundOutput`): its context and
 *  the node to play into, or null while it has none. */
export type SfxOutput = () => { ctx: AudioContext; out: AudioNode } | null;

/** The game's master level. */
const GAME_LEVEL = 0.7;

const SILENT: Sfx = {
  resume() {},
  quack() {},
  fanfare() {},
  buzz() {},
  thud() {},
  scare() {},
  pickup() {},
  step() {},
  growl() {},
  wrongQuack() {},
  mumble() {},
  breath() {},
  mains() {},
  sour() {},
  slide() {},
  doorArrives() {},
  drone() {},
  context: () => null,
  dispose() {},
};

/** The game's sounds: on a context of their own, or (`output`) on a host's. */
export function createSfx(output?: SfxOutput): Sfx {
  if (output !== undefined) {
    // The game's own level (0.7, as on its own context) into the host's bus.
    let level: { ctx: Ctx; out: AudioNode; gain: GainNode } | null = null;
    return sfxOn(
      () => {
        try {
          const a = output();
          if (a === null || a.ctx.state === "closed") return null;
          if (level === null || level.ctx !== a.ctx || level.out !== a.out) {
            const gain = a.ctx.createGain();
            gain.gain.value = GAME_LEVEL;
            gain.connect(a.out);
            level = { ctx: a.ctx, out: a.out, gain };
          }
          return { ctx: a.ctx, out: level.gain };
        } catch {
          return null;
        }
      },
      () => {
        level?.gain.disconnect();
        level = null;
      },
    );
  }
  const Ctor: typeof AudioContext | undefined =
    typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (Ctor === undefined) return SILENT;
  let ctx: Ctx | null = null;
  let master: GainNode | null = null;
  const get = (): { ctx: Ctx; out: AudioNode } | null => {
    if (ctx === null) {
      try {
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = GAME_LEVEL;
        master.connect(ctx.destination);
      } catch {
        return null;
      }
    }
    return ctx.state === "closed" || master === null ? null : { ctx, out: master };
  };
  return sfxOn(get, () => {
    const c = ctx;
    ctx = null;
    master = null;
    void c?.close().catch(() => {});
  });
}

/** The sounds over `get` (the context + the node they play into); `close`
 *  releases what `get` owns (nothing, for a borrowed output). */
function sfxOn(get: () => { ctx: Ctx; out: AudioNode } | null, close: () => void): Sfx {
  /** The running drone's nodes, to stop. */
  let droning: { stop: () => void } | null = null;

  const syllable = (c: Ctx, out: AudioNode, at: number, f0: number, f1: number, len: number, vol: number): void => {
    const osc = c.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(f0, at);
    osc.frequency.exponentialRampToValueAtTime(f1, at + len);
    // The nasal "wa": a resonant band-pass sliding down, plus a low cut.
    const formant = c.createBiquadFilter();
    formant.type = "bandpass";
    formant.Q.value = 5;
    formant.frequency.setValueAtTime(1500, at);
    formant.frequency.exponentialRampToValueAtTime(900, at + len);
    const body = c.createBiquadFilter();
    body.type = "highpass";
    body.frequency.value = 280;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(vol, at + 0.012);
    env.gain.setValueAtTime(vol, at + len * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0001, at + len);
    osc.connect(formant).connect(body).connect(env).connect(out);
    osc.start(at);
    osc.stop(at + len + 0.02);
  };

  const tone = (c: Ctx, out: AudioNode, at: number, freq: number, len: number, vol: number, type: OscillatorType = "triangle"): void => {
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(vol, at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, at + len);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + len + 0.02);
  };

  /** A burst of white noise, `len` seconds, through a short envelope. */
  const noise = (c: Ctx, out: AudioNode, at: number, len: number, vol: number): void => {
    const frames = Math.max(1, Math.floor(c.sampleRate * len));
    const buffer = c.createBuffer(1, frames, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const env = c.createGain();
    env.gain.setValueAtTime(vol, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(env).connect(out);
    src.start(at);
    src.stop(at + len + 0.01);
  };

  /** Where a sound at `pan` plays into. */
  const panned = (a: { ctx: Ctx; out: AudioNode }, pan: number): AudioNode => {
    if (typeof a.ctx.createStereoPanner !== "function") return a.out;
    const p = a.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(a.out);
    return p;
  };

  /** White noise through a filter, swept from `f0` to `f1`, in and out over `len`. */
  const breathOf = (c: Ctx, out: AudioNode, at: number, len: number, vol: number, f0: number, f1: number, q: number, type: BiquadFilterType = "bandpass"): void => {
    const frames = Math.max(1, Math.floor(c.sampleRate * len));
    const buffer = c.createBuffer(1, frames, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, at);
    filter.frequency.exponentialRampToValueAtTime(f1, at + len);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(vol, at + len * 0.35);
    env.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(filter).connect(env).connect(out);
    src.start(at);
    src.stop(at + len + 0.01);
  };

  /** A held tone with a slow rise and fall, gliding `f0` → `f1`. */
  const glide = (c: Ctx, out: AudioNode, at: number, len: number, vol: number, f0: number, f1: number, type: OscillatorType): void => {
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, at);
    osc.frequency.exponentialRampToValueAtTime(f1, at + len);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(vol, at + len * 0.25);
    env.gain.setValueAtTime(vol, at + len * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, at + len);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + len + 0.02);
  };

  return {
    resume() {
      const a = get();
      if (a !== null && a.ctx.state === "suspended") void a.ctx.resume();
    },
    quack(volume, pan = 0) {
      const a = get();
      if (a === null || a.ctx.state !== "running") return;
      const v = Math.max(0, Math.min(1, volume)) * 0.5;
      if (v < 0.01) return;
      let out: AudioNode = a.out;
      if (typeof a.ctx.createStereoPanner === "function") {
        const p = a.ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        p.connect(a.out);
        out = p;
      }
      const t = a.ctx.currentTime + 0.01;
      const pitch = 1 + (Math.random() - 0.5) * 0.12;
      syllable(a.ctx, out, t, 520 * pitch, 380 * pitch, 0.11, v);
      syllable(a.ctx, out, t + 0.14, 470 * pitch, 300 * pitch, 0.17, v);
    },
    fanfare() {
      const a = get();
      if (a === null) return;
      const t = a.ctx.currentTime + 0.02;
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      notes.forEach((f, i) => tone(a.ctx, a.out, t + i * 0.11, f, 0.5, 0.18));
      tone(a.ctx, a.out, t + notes.length * 0.11, 1567.98, 1.2, 0.14, "sine");
      tone(a.ctx, a.out, t + notes.length * 0.11, 783.99, 1.2, 0.1, "square");
    },
    buzz() {
      const a = get();
      if (a === null) return;
      const t = a.ctx.currentTime + 0.01;
      tone(a.ctx, a.out, t, 196, 0.18, 0.12, "square");
      tone(a.ctx, a.out, t + 0.2, 147, 0.25, 0.12, "square");
    },
    thud() {
      const a = get();
      if (a === null) return;
      const t = a.ctx.currentTime + 0.005;
      // A 90 ms low square, pitch dropping, under a burst of noise.
      const osc = a.ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.09);
      const env = a.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.3, t + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      osc.connect(env).connect(a.out);
      osc.start(t);
      osc.stop(t + 0.11);
      noise(a.ctx, a.out, t, 0.06, 0.16);
    },
    scare() {
      const a = get();
      if (a === null) return;
      const t = a.ctx.currentTime + 0.005;
      const len = 1.2;
      for (const detune of [0, 37]) {
        const osc = a.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(1400 + detune, t);
        osc.frequency.exponentialRampToValueAtTime(70 + detune / 4, t + len);
        const env = a.ctx.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
        env.gain.setValueAtTime(0.32, t + len * 0.4);
        env.gain.exponentialRampToValueAtTime(0.0001, t + len);
        osc.connect(env).connect(a.out);
        osc.start(t);
        osc.stop(t + len + 0.02);
      }
      noise(a.ctx, a.out, t, 0.45, 0.4);
    },
    pickup() {
      const a = get();
      if (a === null) return;
      const t = a.ctx.currentTime + 0.01;
      tone(a.ctx, a.out, t, 660, 0.09, 0.12, "square");
      tone(a.ctx, a.out, t + 0.08, 990, 0.16, 0.12, "square");
    },
    step(volume, pan = 0) {
      const a = get();
      if (a === null) return;
      const v = Math.max(0, Math.min(1, volume));
      const out = panned(a, pan);
      const t = a.ctx.currentTime + 0.005;
      // The heel, then the boot's weight coming down on a board.
      const osc = a.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(92, t);
      osc.frequency.exponentialRampToValueAtTime(48, t + 0.13);
      const env = a.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
      osc.connect(env).connect(out);
      osc.start(t);
      osc.stop(t + 0.19);
      breathOf(a.ctx, out, t, 0.09, 0.12 * v, 620, 240, 0.8, "lowpass");
    },
    growl(pan = 0) {
      const a = get();
      if (a === null) return;
      const out = panned(a, pan);
      const t = a.ctx.currentTime + 0.01;
      const len = 3.1;
      const low = a.ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.setValueAtTime(180, t);
      low.frequency.exponentialRampToValueAtTime(520, t + len * 0.45);
      low.frequency.exponentialRampToValueAtTime(140, t + len);
      // The rattle in it: the level shaken at 26 Hz.
      const shake = a.ctx.createGain();
      shake.gain.value = 0.55;
      const lfo = a.ctx.createOscillator();
      lfo.frequency.value = 26;
      const depth = a.ctx.createGain();
      depth.gain.value = 0.45;
      lfo.connect(depth).connect(shake.gain);
      const env = a.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.5, t + len * 0.4);
      env.gain.exponentialRampToValueAtTime(0.0001, t + len);
      low.connect(shake).connect(env).connect(out);
      for (const f of [46, 69.5]) {
        const osc = a.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(f, t);
        osc.frequency.linearRampToValueAtTime(f * 1.18, t + len * 0.45);
        osc.frequency.linearRampToValueAtTime(f * 0.86, t + len);
        osc.connect(low);
        osc.start(t);
        osc.stop(t + len + 0.02);
      }
      lfo.start(t);
      lfo.stop(t + len + 0.02);
    },
    wrongQuack(volume, pan = 0) {
      const a = get();
      if (a === null) return;
      const v = Math.max(0, Math.min(1, volume)) * 0.42;
      if (v < 0.01) return;
      const out = panned(a, pan);
      const t = a.ctx.currentTime + 0.01;
      // Gerald's two syllables backwards: rising, slower, a tritone apart.
      for (const k of [1, 0.707]) {
        syllable(a.ctx, out, t, 300 * k, 430 * k, 0.24, v * (k === 1 ? 1 : 0.7));
        syllable(a.ctx, out, t + 0.31, 250 * k, 540 * k, 0.42, v * (k === 1 ? 1 : 0.7));
      }
    },
    mumble(volume, pan = 0) {
      const a = get();
      if (a === null) return;
      const v = Math.max(0, Math.min(1, volume)) * 0.5;
      if (v < 0.01) return;
      const out = panned(a, pan);
      const base = a.ctx.currentTime + 0.01;
      const grains = 4 + Math.floor(Math.random() * 4);
      let at = base;
      for (let i = 0; i < grains; i++) {
        const len = 0.07 + Math.random() * 0.11;
        const f = 105 + Math.random() * 70;
        const osc = a.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(f, at);
        osc.frequency.exponentialRampToValueAtTime(f * (0.8 + Math.random() * 0.3), at + len);
        const mouth = a.ctx.createBiquadFilter();
        mouth.type = "bandpass";
        mouth.Q.value = 4;
        mouth.frequency.value = 420 + Math.random() * 560;
        const env = a.ctx.createGain();
        env.gain.setValueAtTime(0.0001, at);
        env.gain.exponentialRampToValueAtTime(v, at + len * 0.3);
        env.gain.exponentialRampToValueAtTime(0.0001, at + len);
        osc.connect(mouth).connect(env).connect(out);
        osc.start(at);
        osc.stop(at + len + 0.01);
        at += len + 0.02 + Math.random() * 0.09;
      }
    },
    breath() {
      const a = get();
      if (a === null) return;
      const t = a.ctx.currentTime + 0.01;
      breathOf(a.ctx, a.out, t, 0.9, 0.13, 2400, 3600, 1.4);
      breathOf(a.ctx, a.out, t + 0.95, 1.2, 0.09, 3200, 1500, 1.2);
    },
    mains() {
      const a = get();
      if (a === null) return;
      const t = a.ctx.currentTime + 0.01;
      const len = 2.3;
      const band = a.ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 480;
      band.Q.value = 1.6;
      band.connect(a.out);
      glide(a.ctx, band, t, len, 0.09, 120, 96, "square");
      noise(a.ctx, a.out, t + 0.02, 0.03, 0.14);
      noise(a.ctx, a.out, t + len - 0.1, 0.03, 0.1);
    },
    sour() {
      const a = get();
      if (a === null) return;
      const t = a.ctx.currentTime + 0.01;
      for (const [f, to] of [[55, 53], [82.4, 77.8], [116.5, 110]] as const) glide(a.ctx, a.out, t, 7, 0.06, f, to, "triangle");
    },
    slide(up) {
      const a = get();
      if (a === null) return;
      const t = a.ctx.currentTime + 0.01;
      if (up) glide(a.ctx, a.out, t, 3.6, 0.07, 130, 620, "sine");
      else glide(a.ctx, a.out, t, 3.6, 0.07, 620, 95, "sine");
    },
    doorArrives() {
      const a = get();
      if (a === null) return;
      const t = a.ctx.currentTime + 0.01;
      glide(a.ctx, a.out, t, 0.9, 0.26, 62, 34, "sine");
      const band = a.ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 900;
      band.Q.value = 7;
      band.connect(a.out);
      glide(a.ctx, band, t + 0.12, 1.3, 0.05, 92, 141, "sawtooth");
    },
    drone(on) {
      if (!on) {
        droning?.stop();
        droning = null;
        return;
      }
      const a = get();
      if (a === null || droning !== null) return;
      const t = a.ctx.currentTime + 0.01;
      const bus = a.ctx.createGain();
      bus.gain.setValueAtTime(0.0001, t);
      bus.gain.exponentialRampToValueAtTime(0.13, t + 2.5);
      bus.connect(a.out);
      const low = a.ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 220;
      low.connect(bus);
      const oscs = [41.2, 43.65, 61.9].map((f) => {
        const osc = a.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = f;
        osc.connect(low);
        osc.start(t);
        return osc;
      });
      const { ctx } = a;
      droning = {
        stop() {
          const end = ctx.currentTime;
          bus.gain.cancelScheduledValues(end);
          bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), end);
          bus.gain.exponentialRampToValueAtTime(0.0001, end + 0.8);
          for (const o of oscs) o.stop(end + 0.85);
        },
      };
    },
    context: () => get(),
    dispose() {
      droning?.stop();
      droning = null;
      close();
    },
  };
}
