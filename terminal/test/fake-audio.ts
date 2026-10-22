// A minimal stand-in for an AudioContext: records the nodes the sound bus
// makes, what they connect to and when they start, so the tests can check
// what would have played without a browser. Wave 19 adds the capture nodes
// (a media stream source, a script processor that tests fire by hand) and
// disconnect / onended for the voice link's playback.

export class FakeParam {
  value = 0;
  events: Array<[string, number, number]> = [];
  setValueAtTime(v: number, t: number) {
    this.events.push(["set", v, t]);
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (!(v > 0)) throw new RangeError("exponential ramp to a non-positive value");
    this.events.push(["exp", v, t]);
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(["lin", v, t]);
    return this;
  }
}

export class FakeNode {
  out: FakeNode[] = [];
  constructor(
    readonly kind: string,
    readonly ctx: FakeAudioContext,
  ) {}
  disconnected = false;
  connect(n: FakeNode) {
    this.out.push(n);
    return n;
  }
  disconnect() {
    this.out = [];
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam();
}
export class FakeOsc extends FakeNode {
  type = "sine";
  frequency = new FakeParam();
  detune = new FakeParam();
  started: number | null = null;
  stopped: number | null = null;
  start(t: number) {
    this.started = t;
    this.ctx.sources.push(this);
  }
  stop(t: number) {
    this.stopped = t;
  }
}
export class FakeSource extends FakeOsc {
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
}
/** A script processor: `fire(samples)` is one `onaudioprocess`. */
export class FakeProcessor extends FakeNode {
  onaudioprocess: ((e: { inputBuffer: { getChannelData: (ch: number) => Float32Array } }) => void) | null = null;
  constructor(
    ctx: FakeAudioContext,
    readonly frames: number,
  ) {
    super("processor", ctx);
  }
  fire(samples: Float32Array) {
    this.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } });
  }
}
export class FakeFilter extends FakeNode {
  type = "lowpass";
  frequency = new FakeParam();
  Q = new FakeParam();
}
export class FakeCompressor extends FakeNode {
  threshold = new FakeParam();
  ratio = new FakeParam();
}

export class FakeAudioContext {
  state: "running" | "suspended" = "running";
  currentTime = 10;
  sampleRate = 8000;
  destination = new FakeNode("destination", this);
  sources: FakeOsc[] = [];
  gains: FakeGain[] = [];
  buffers: Array<{ length: number; sampleRate: number; data: Float32Array }> = [];
  processors: FakeProcessor[] = [];
  streams: FakeNode[] = [];
  createMediaStreamSource(_stream: unknown) {
    const n = new FakeNode("mic", this);
    this.streams.push(n);
    return n;
  }
  createScriptProcessor(frames: number) {
    const p = new FakeProcessor(this, frames);
    this.processors.push(p);
    return p;
  }
  createGain() {
    const g = new FakeGain("gain", this);
    this.gains.push(g);
    return g;
  }
  createOscillator() {
    return new FakeOsc("osc", this);
  }
  createBufferSource() {
    return new FakeSource("noise", this);
  }
  createBiquadFilter() {
    return new FakeFilter("filter", this);
  }
  createDynamicsCompressor() {
    return new FakeCompressor("compressor", this);
  }
  createBuffer(_ch: number, len: number, sampleRate = this.sampleRate) {
    const data = new Float32Array(len);
    this.buffers.push({ length: len, sampleRate, data });
    return { getChannelData: () => data, length: len, sampleRate, duration: len / sampleRate };
  }
  /** Does `n` reach the destination, and through which gains? */
  path(n: FakeNode): string[] {
    const walk = (x: FakeNode, seen: string[]): string[] | null => {
      if (x === this.destination) return seen;
      for (const o of x.out) {
        const r = walk(o, [...seen, o.kind]);
        if (r !== null) return r;
      }
      return null;
    };
    return walk(n, [n.kind]) ?? [];
  }
}
