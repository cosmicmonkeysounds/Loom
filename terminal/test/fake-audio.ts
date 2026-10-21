// A minimal stand-in for an AudioContext: records the nodes the sound bus
// makes, what they connect to and when they start, so the tests can check
// what would have played without a browser.

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
  connect(n: FakeNode) {
    this.out.push(n);
    return n;
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
  createBuffer(_ch: number, len: number) {
    const data = new Float32Array(len);
    return { getChannelData: () => data, length: len };
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
