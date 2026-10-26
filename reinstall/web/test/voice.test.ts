import { describe, expect, it } from "vitest";
import { forward, mulawEncode, styleOf, VOICE_CHUNK_BYTES, VOICE_RATE, VOICE_TAIL_MS } from "@loom/house";
import type { HouseMap } from "@loom/house";
import type { SpatialSource } from "../src/spatial.ts";
import { earsFor, earsLine, fadeIn, fromBase64, listenerAxes, screenPose, VOICE_UP_QUEUE, VoiceLink, voiceGone, type MicSource, type ScreenPose, type VoiceChannel, type VoiceSink } from "../src/game/voice.ts";
import { TWO_ROOMS } from "./houses.ts";

class FakeSource implements SpatialSource {
  readyState = 0;
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  closed = false;
  readonly listeners = new Map<string, (e: Event) => void>();
  constructor(readonly url: string) {}
  addEventListener(type: string, fn: (e: Event) => void): void {
    this.listeners.set(type, fn);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  refuse(): void {
    this.readyState = 2;
    this.onerror?.(new Event("error"));
  }
  emit(name: string, data: unknown): void {
    this.listeners.get(name)?.({ data: JSON.stringify(data) } as MessageEvent<string> as unknown as Event);
  }
}

interface FakeChannel extends VoiceChannel {
  pose: ScreenPose | null;
  gain: number;
  plays: Array<{ at: number; n: number; first: number }>;
  cuts: number[];
  closed: boolean;
}

/** A sink at 48 kHz with a hand-wound audio clock. */
function fakeSink() {
  let t = 10;
  const channels: FakeChannel[] = [];
  const listener: Array<{ eye: number[]; fwd: number[]; up: number[] }> = [];
  const sink: VoiceSink = {
    rate: 48000,
    time: () => t,
    listener: (eye, fwd, up) => listener.push({ eye, fwd, up }),
    channel() {
      const c: FakeChannel = {
        pose: null,
        gain: -1,
        plays: [],
        cuts: [],
        closed: false,
        place: (p) => (c.pose = p),
        volume: (g) => (c.gain = g),
        play: (s, at) => c.plays.push({ at, n: s.length, first: s[0] ?? 0 }),
        cut: (at) => c.cuts.push(at),
        close: () => (c.closed = true),
      };
      channels.push(c);
      return c;
    },
  };
  return { sink, channels, listener, advance: (s: number) => (t += s) };
}

function fakeMic(rate = VOICE_RATE) {
  const m = {
    rate,
    onSamples: null as ((s: Float32Array) => void) | null,
    onEnded: null as (() => void) | null,
    enabled: [] as boolean[],
    stopped: false,
    setEnabled(on: boolean) {
      m.enabled.push(on);
    },
    stop() {
      m.stopped = true;
    },
  };
  return m;
}

/** A house with the fixture's terminal `t` (room b) plus one in the spawn room (`tent`: voice off by default). */
function house(): HouseMap {
  const h = TWO_ROOMS();
  h.terminals.push({ id: "tent", name: "Tent", room: h.spawn.room, pos: [0.05, 1.4, 1.5], yaw: -90 });
  return h;
}

const LOUD = (n: number) => Float32Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 0.3 : -0.3));
const QUIET = (n: number) => new Float32Array(n);
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const chunk = (n = VOICE_CHUNK_BYTES) => b64(mulawEncode(LOUD(n)));

function rig(opts: { post?: (seq: number) => Response | Promise<Response>; probe?: () => Response; withMic?: boolean; micRate?: number } = {}) {
  const map = house();
  const s = fakeSink();
  const sources: FakeSource[] = [];
  const posts: Array<{ url: string; bytes: number; token: string | null; keepalive: unknown }> = [];
  const probes: string[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  let now = 1000;
  let changes = 0;
  const mic = fakeMic(opts.micRate);
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const seq = Number(new URL(url, "http://x").searchParams.get("seq"));
      const headers = new Headers(init.headers);
      posts.push({ url, bytes: (init.body as Uint8Array).length, token: headers.get("x-loom-token"), keepalive: init.keepalive });
      return opts.post ? opts.post(seq) : Response.json({ ok: true, listening: true });
    }
    probes.push(url);
    return opts.probe ? opts.probe() : new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  const link = new VoiceLink({
    base: "/e/evt",
    token: "tok",
    house: () => map,
    sink: s.sink,
    mic: opts.withMic === false ? null : Promise.resolve(mic as MicSource),
    onChange: () => (changes += 1),
    fetcher,
    source: (url) => {
      const src = new FakeSource(url);
      sources.push(src);
      return src;
    },
    now: () => now,
    later: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return () => timers.splice(timers.indexOf(t), 1);
    },
  });
  const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { link, map, sink: s, sources, posts, probes, timers, mic, settle, changes: () => changes, tick: (ms: number) => (now += ms), last: () => sources[sources.length - 1]! };
}

/** Start a link: active, the stream open and its hello said. */
async function started(r: ReturnType<typeof rig>, listen = true) {
  r.link.setActive(true);
  await r.settle();
  r.last().open();
  r.last().emit("hello", { codec: "mulaw", rate: 16000, chunkMs: 200, as: "player", session: "s1", listen });
}

describe("placement", () => {
  it("hangs a voice at its terminal's screen: the spot pushed out of the wall along its yaw", () => {
    const h = house();
    const spot = h.terminals.find((t) => t.id === "t")!;
    const p = screenPose(h, spot);
    const out = styleOf(h).wallThickness / 2 + 0.035;
    const f = forward(90, 0);
    expect(p.fwd).toEqual(f);
    expect(p.pos[0]).toBeCloseTo(7 + f[0] * out, 9);
    expect(p.pos[1]).toBeCloseTo(1.4, 9);
    expect(p.pos[2]).toBeCloseTo(1.5 + f[2] * out, 9);
    // yaw 90 faces west (−x): into room b, off the east wall.
    expect(p.pos[0]).toBeLessThan(7);
  });

  it("a pitched screen moves up or down with its tilt", () => {
    const h = house();
    const p = screenPose(h, { id: "x", name: "x", room: "a", pos: [1, 2, 1], yaw: 0, pitch: -30 });
    expect(p.pos[1]).toBeLessThan(2);
  });

  it("the listener's up is square to its forward", () => {
    for (const [yaw, pitch] of [[0, 0], [90, -20], [200, 45]] as const) {
      const { fwd, up } = listenerAxes(yaw, pitch);
      expect(fwd[0] * up[0] + fwd[1] * up[1] + fwd[2] * up[2]).toBeCloseTo(0, 9);
      expect(up[1]).toBeGreaterThan(0);
    }
    expect(listenerAxes(0, 0)).toEqual({ fwd: forward(0, 0), up: forward(0, 90) });
  });

  it("counts the voice-on terminals that would hear a player (never the tent's)", () => {
    const h = house();
    // In room b beside `t`: it hears you; the tent's (room a, the spawn) never does.
    expect(earsFor(h, "s1", [{ session: "s1", p: [6, 0, 1.5] }])).toBe(1);
    // In room a, 6.5 m from `t`: no longer heard through the wall (wave 26: same room only).
    expect(earsFor(h, "s1", [{ session: "s1", p: [0.5, 0, 1.5] }])).toBe(0);
    // … unless the room the server counts them in is b (the doorway hysteresis).
    expect(earsFor(h, "s1", [{ session: "s1", p: [3.6, 0, 1.5], room: "b" }])).toBe(1);
    expect(earsFor(h, "s1", [{ session: "s2", p: [6, 0, 1.5] }])).toBe(0);
  });

  it("the status line says who hears you only while someone does and the mic is live", () => {
    expect(earsLine({ mic: "live", listening: true, hearing: 0, heardBy: null, ears: 1 })).toBe("🎤 a terminal can hear you");
    expect(earsLine({ mic: "live", listening: true, hearing: 0, heardBy: null, ears: 2 })).toBe("🎤 2 terminals can hear you");
    expect(earsLine({ mic: "muted", listening: true, hearing: 0, heardBy: null, ears: 2 })).toBeNull();
    expect(earsLine({ mic: "live", listening: false, hearing: 0, heardBy: null, ears: 0 })).toBeNull();
  });

  it("fades a chunk's head in, and reads base64", () => {
    const s = fadeIn(new Float32Array(1000).fill(1), 48000, 8);
    expect(s[0]).toBe(0);
    expect(s[383]).toBeLessThan(1);
    expect(s[384]).toBe(1);
    expect([...fromBase64(btoa("\x00\xff\x10"))]).toEqual([0, 255, 16]);
  });

  it("voiceGone: the session over, refused or no route", () => {
    expect([401, 403, 404, 410].every(voiceGone)).toBe(true);
    expect([200, 502, 503, null].some(voiceGone)).toBe(false);
  });
});

describe("VoiceLink — the stream", () => {
  it("opens the player's stream with the session token while active, and closes it when not", async () => {
    const r = rig();
    await started(r);
    expect(r.sources).toHaveLength(1);
    expect(r.last().url).toBe("/e/evt/api/spatial/voice/stream?token=tok");
    expect(r.link.hud).toEqual({ mic: "live", listening: true, hearing: 0, heardBy: null });
    r.link.setActive(false);
    expect(r.last().closed).toBe(true);
    expect(r.link.hud.listening).toBe(false);
  });

  it("plays a terminal's chunk at its screen with the server's gain, after the jitter target", async () => {
    const r = rig();
    await started(r);
    r.last().emit("voice", { from: "t:t", kind: "terminal", spot: "t", gain: 0.42, seq: 1, data: chunk() });
    const c = r.sink.channels[0]!;
    expect(c.gain).toBe(0.42);
    expect(c.pose).toEqual(screenPose(r.map, r.map.terminals[0]!));
    // 200 ms of 16 kHz upsampled to 48 kHz, starting 200 ms from now, faded in.
    expect(c.plays).toHaveLength(1);
    expect(c.plays[0]!.at).toBeCloseTo(10.2, 9);
    expect(c.plays[0]!.n).toBeGreaterThan(9500);
    expect(c.plays[0]!.first).toBe(0);
    expect(r.link.hud.hearing).toBe(1);
    // The next chunk queues right behind it.
    r.last().emit("voice", { from: "t:t", kind: "terminal", spot: "t", gain: 0.42, seq: 2, data: chunk() });
    expect(c.plays[1]!.at).toBeCloseTo(10.2 + c.plays[0]!.n / 48000, 9);
    // A stale or repeated seq is dropped.
    r.last().emit("voice", { from: "t:t", kind: "terminal", spot: "t", gain: 0.42, seq: 2, data: chunk() });
    expect(c.plays).toHaveLength(2);
  });

  it("skips ahead past 400 ms queued, and restarts after an underrun", async () => {
    const r = rig();
    await started(r);
    const say = (seq: number) => r.last().emit("voice", { from: "t:t", kind: "terminal", spot: "t", gain: 1, seq, data: chunk() });
    say(1);
    say(2); // 200 + 200 queued
    say(3); // 600 queued > 400: drop it, play this one at the target
    const c = r.sink.channels[0]!;
    // Only what is queued past the target is cut (with a fade), not all of it.
    expect(c.cuts).toHaveLength(1);
    expect(c.cuts[0]).toBeCloseTo(10.2, 9);
    expect(c.plays[2]!.at).toBeCloseTo(10.2, 9);
    r.sink.advance(5); // long silence
    say(4);
    expect(c.plays[3]!.at).toBeCloseTo(15.2, 9);
    expect(c.cuts).toHaveLength(1);
  });

  it("ignores players, unknown spots and the tent's terminal; bye lets a voice go", async () => {
    const r = rig();
    await started(r);
    r.last().emit("voice", { from: "s:s2", kind: "player", session: "s2", gain: 1, seq: 1, data: chunk() });
    r.last().emit("voice", { from: "t:gone", kind: "terminal", spot: "gone", gain: 1, seq: 1, data: chunk() });
    r.last().emit("voice", { from: "t:tent", kind: "terminal", spot: "tent", gain: 1, seq: 1, data: chunk() });
    expect(r.sink.channels).toHaveLength(0);
    r.last().emit("voice", { from: "t:t", kind: "terminal", spot: "t", gain: 1, seq: 1, data: chunk() });
    r.last().emit("bye", { from: "t:t" });
    expect(r.sink.channels[0]!.closed).toBe(true);
    expect(r.link.hud.hearing).toBe(0);
  });

  it("a reconnect's hello starts over: every voice it had is let go", async () => {
    const r = rig();
    await started(r);
    r.last().emit("voice", { from: "t:t", kind: "terminal", spot: "t", gain: 1, seq: 7, data: chunk() });
    r.last().emit("hello", { codec: "mulaw", rate: 16000, chunkMs: 200, as: "player", session: "s1", listen: false });
    expect(r.sink.channels[0]!.closed).toBe(true);
    expect(r.link.hud).toMatchObject({ hearing: 0, listening: false });
    // The terminal's seq counter carries on from wherever it is.
    r.last().emit("voice", { from: "t:t", kind: "terminal", spot: "t", gain: 1, seq: 1, data: chunk() });
    expect(r.sink.channels).toHaveLength(2);
  });

  it("a remap drops a voice whose terminal left the map, re-hangs the rest", async () => {
    const r = rig();
    await started(r);
    r.last().emit("voice", { from: "t:t", kind: "terminal", spot: "t", gain: 1, seq: 1, data: chunk() });
    r.map.terminals[0]!.pos = [6.9, 1.4, 2];
    r.link.remap();
    expect(r.sink.channels[0]!.pose!.pos[2]).toBeCloseTo(2, 9);
    r.map.terminals.splice(0, 1);
    r.link.remap();
    expect(r.sink.channels[0]!.closed).toBe(true);
  });

  it("sets the listener at the eye every frame while active", async () => {
    const r = rig();
    r.link.listen([1, 1.6, 2], 0, 0);
    expect(r.sink.listener).toHaveLength(0);
    await started(r);
    r.link.listen([1, 1.6, 2], 90, 10);
    expect(r.sink.listener[0]).toEqual({ eye: [1, 1.6, 2], ...listenerAxes(90, 10) });
  });

  it("a refused stream probes itself: a dead session stops the link, a 502 reopens on the backoff", async () => {
    const r = rig({ probe: () => new Response("", { status: 502 }) });
    await started(r);
    r.last().refuse();
    await r.settle();
    expect(r.probes).toEqual(["/e/evt/api/spatial/voice/stream?token=tok"]);
    expect(r.timers).toHaveLength(1);
    r.timers[0]!.fn();
    expect(r.sources).toHaveLength(2);

    const gone = rig({ probe: () => new Response("", { status: 410 }) });
    await started(gone);
    gone.last().refuse();
    await gone.settle();
    expect(gone.timers).toHaveLength(0);
    expect(gone.mic.stopped).toBe(true);
    expect(gone.link.hud.mic).toBe("none"); // the HUD says NO MIC, not LIVE
    gone.link.setActive(false);
    gone.link.setActive(true);
    expect(gone.sources).toHaveLength(1); // stopped for good
  });

  it("a hello on a wire it can't play stops the link", async () => {
    const r = rig();
    r.link.setActive(true);
    await r.settle();
    r.last().emit("hello", { codec: "opus", rate: 48000, listen: true });
    expect(r.mic.stopped).toBe(true);
  });
});

describe("VoiceLink — the mic", () => {
  /** Feed `ms` of a signal through the mic at its rate. */
  const speak = (r: ReturnType<typeof rig>, ms: number, loud = true) => {
    const n = Math.round((r.mic.rate * ms) / 1000);
    r.mic.onSamples!(loud ? LOUD(n) : QUIET(n));
  };

  it("sends gated 200 ms chunks only while somebody listens, one POST at a time, raw, never keepalive", async () => {
    const r = rig();
    await started(r, false);
    speak(r, 400);
    await r.settle();
    expect(r.posts).toHaveLength(0); // nobody can hear: nothing goes up
    r.last().emit("listen", { on: true });
    speak(r, 400);
    await r.settle();
    expect(r.posts.map((p) => p.url)).toEqual(["/e/evt/api/spatial/voice?seq=0", "/e/evt/api/spatial/voice?seq=1"]);
    expect(r.posts.every((p) => p.bytes === VOICE_CHUNK_BYTES && p.token === "tok" && p.keepalive === undefined)).toBe(true);
    // Quiet past the hang: the gate shuts.
    r.tick(1000);
    speak(r, 400, false);
    await r.settle();
    expect(r.posts).toHaveLength(2);
  });

  it("resamples a 48 kHz mic down to 16 kHz chunks", async () => {
    const r = rig({ micRate: 48000 });
    await started(r);
    speak(r, 200);
    speak(r, 10);
    await r.settle();
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]!.bytes).toBe(VOICE_CHUNK_BYTES);
  });

  /** `ms` of a steady tone at `dbfs` (RMS) through the mic. */
  const say = (r: ReturnType<typeof rig>, ms: number, dbfs: number) => {
    const n = Math.round((r.mic.rate * ms) / 1000);
    const a = Math.SQRT2 * 10 ** (dbfs / 20);
    r.mic.onSamples!(Float32Array.from({ length: n }, (_, i) => a * Math.sin(i / 3)));
  };

  it("the barge-in (D5b): while a terminal's voice plays here (+ the tail) the echo stays home, a player speaking up goes", async () => {
    const r = rig();
    await started(r);
    r.last().emit("voice", { from: "t:t", kind: "terminal", spot: "t", gain: 1, seq: 1, data: chunk() });
    // The voice plays from +200 ms for 200 ms: raised until +400 + the tail.
    // Its echo (-35 dBFS, over the plain gate) is not sent…
    say(r, 400, -35);
    await r.settle();
    expect(r.posts).toHaveLength(0);
    r.tick(400 + VOICE_TAIL_MS - 1);
    say(r, 200, -35);
    await r.settle();
    expect(r.posts).toHaveLength(0);
    // … but the player speaking up (-20) is, at once, with no echo pre-roll.
    say(r, 200, -20);
    await r.settle();
    expect(r.posts).toHaveLength(1);
    // Past the raise the plain gate is back: -35 goes up.
    r.tick(2 + 1000);
    say(r, 400, -35);
    await r.settle();
    expect(r.posts.length).toBeGreaterThan(1);
  });

  it("a faint, far terminal (gain under 0.2) raises nothing", async () => {
    const r = rig();
    await started(r);
    r.last().emit("voice", { from: "t:t", kind: "terminal", spot: "t", gain: 0.1, seq: 1, data: chunk() });
    say(r, 400, -35);
    await r.settle();
    expect(r.posts.length).toBeGreaterThan(0);
  });

  it("the server's count of who hears this player (listen.ears) is the HUD's", async () => {
    const r = rig();
    await started(r, false);
    expect(r.link.hud.heardBy).toBeNull();
    r.last().emit("listen", { on: true, ears: 2 });
    expect(r.link.hud).toMatchObject({ listening: true, heardBy: 2 });
    r.last().emit("listen", { on: true, ears: 1 });
    expect(r.link.hud.heardBy).toBe(1);
    r.last().emit("listen", { on: false, ears: 0 });
    expect(r.link.hud).toMatchObject({ listening: false, heardBy: 0 });
  });

  it("a track the OS ends (an unplugged headset) reads NO MIC and sends nothing", async () => {
    const r = rig();
    await started(r);
    expect(r.link.hud.mic).toBe("live");
    r.mic.onEnded!();
    expect(r.link.hud.mic).toBe("none");
    expect(r.mic.stopped).toBe(true);
    expect(r.mic.onSamples).toBeNull();
    expect(earsLine({ ...r.link.hud, listening: true, ears: 1 })).toBeNull();
  });

  it("a muted player sends nothing; the mic's track follows mute and the active gate", async () => {
    const r = rig();
    await started(r);
    expect(r.mic.enabled.at(-1)).toBe(true);
    r.link.toggleMute();
    expect(r.link.hud.mic).toBe("muted");
    expect(r.mic.enabled.at(-1)).toBe(false);
    speak(r, 400);
    await r.settle();
    expect(r.posts).toHaveLength(0);
    r.link.toggleMute();
    expect(r.link.hud.mic).toBe("live");
    r.link.setActive(false);
    expect(r.mic.enabled.at(-1)).toBe(false);
  });

  it("keeps at most a few chunks waiting behind a slow POST", async () => {
    let release: () => void = () => {};
    const r = rig({ post: () => new Promise((res) => (release = () => res(Response.json({ ok: true, listening: true })))) });
    await started(r);
    speak(r, 200); // in flight
    speak(r, 200 * (VOICE_UP_QUEUE + 4)); // only the newest few wait
    await r.settle();
    expect(r.posts).toHaveLength(1);
    release();
    await r.settle();
    release();
    await r.settle();
    release();
    await r.settle();
    release();
    await r.settle();
    expect(r.posts).toHaveLength(1 + VOICE_UP_QUEUE);
  });

  it("the POST's own listening answer is taken; a 404 / 403 stops only the uplink", async () => {
    const r = rig({ post: (seq) => (seq === 0 ? Response.json({ ok: true, listening: false, dropped: true }) : Response.json({ ok: true, listening: true })) });
    await started(r);
    speak(r, 200);
    await r.settle();
    expect(r.link.hud.listening).toBe(false);

    const old = rig({ post: () => new Response("{}", { status: 404 }) });
    await started(old);
    speak(old, 200);
    await old.settle();
    speak(old, 200);
    await old.settle();
    expect(old.posts).toHaveLength(1);
    expect(old.mic.stopped).toBe(false);
    old.last().emit("voice", { from: "t:t", kind: "terminal", spot: "t", gain: 1, seq: 1, data: chunk() });
    expect(old.sink.channels).toHaveLength(1); // still hears the house
  });

  it("a 401 / 410 on a POST stops everything, mic tracks included", async () => {
    const r = rig({ post: () => new Response("{}", { status: 410 }) });
    await started(r);
    speak(r, 200);
    await r.settle();
    expect(r.mic.stopped).toBe(true);
    expect(r.last().closed).toBe(true);
  });

  it("stop() closes the stream, lets every voice go and stops the tracks; a mic that opens late is stopped at once", async () => {
    const r = rig();
    await started(r);
    r.last().emit("voice", { from: "t:t", kind: "terminal", spot: "t", gain: 1, seq: 1, data: chunk() });
    r.link.stop();
    expect(r.last().closed).toBe(true);
    expect(r.sink.channels[0]!.closed).toBe(true);
    expect(r.mic.stopped).toBe(true);

    let open: (m: MicSource | null) => void = () => {};
    const late = fakeMic();
    const s = fakeSink();
    const link = new VoiceLink({ base: "/e/x", token: "t", house, sink: s.sink, mic: new Promise((res) => (open = res)), source: (u) => new FakeSource(u) });
    expect(link.hud.mic).toBe("starting");
    link.stop();
    open(late as MicSource);
    await new Promise((res) => setTimeout(res, 0));
    expect(late.stopped).toBe(true);
  });

  it("no mic (refused / insecure): hears, sends nothing, says NO MIC", async () => {
    const r = rig({ withMic: false });
    await started(r);
    expect(r.link.hud.mic).toBe("none");
    r.link.toggleMute();
    expect(r.link.hud.mic).toBe("none");
  });
});
