//! Sound — all synthesised with WebAudio (no assets to ship, no CSP to
//! bend): Gerald's quack (a buzzy sawtooth through a nasal formant, pitch
//! falling, two syllables), the celebration fanfare, and
//! the failure buzz. Needs one user gesture first (`resume` on the tap that
//! starts the game); without WebAudio every call is a no-op.

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
  /** A chess piece landing: a short click. */
  clack(): void;
  dispose(): void;
}

type Ctx = AudioContext;

export function createSfx(): Sfx {
  const Ctor: typeof AudioContext | undefined =
    typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (Ctor === undefined) return { resume() {}, quack() {}, fanfare() {}, buzz() {}, thud() {}, clack() {}, dispose() {} };
  let ctx: Ctx | null = null;
  let master: GainNode | null = null;
  const get = (): { ctx: Ctx; out: GainNode } | null => {
    if (ctx === null) {
      try {
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = 0.7;
        master.connect(ctx.destination);
      } catch {
        return null;
      }
    }
    return ctx.state === "closed" || master === null ? null : { ctx, out: master };
  };

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
    clack() {
      const a = get();
      if (a === null) return;
      const t = a.ctx.currentTime + 0.005;
      tone(a.ctx, a.out, t, 1800, 0.03, 0.08, "square");
      noise(a.ctx, a.out, t, 0.02, 0.1);
    },
    dispose() {
      const c = ctx;
      ctx = null;
      master = null;
      void c?.close().catch(() => {});
    },
  };
}
