import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserEngine, CANCEL_SETTLE_MS, DeviceEngine, FRAG_START_MS, START_TIMEOUT_MS, SpeechQueue, VoiceFloor, alternateCount, alternateVoices, withPlan, type Prepared, type SpeechEngine } from "../src/speech/engine.ts";
import { HIS_PITCH, paceRate, type VoiceFrag, type VoicePlan } from "../src/speech/glitch.ts";

type Handler = ((e?: { error: string }) => void) | null;
class FakeUtterance {
  voice: unknown = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: Handler = null;
  onboundary: Handler = null;
  onend: Handler = null;
  onerror: Handler = null;
  constructor(readonly text: string) {}
}

const VOICES = [
  { name: "Microsoft Zira", lang: "en-US", voiceURI: "zira", default: false, localService: true },
  { name: "Microsoft David", lang: "en-US", voiceURI: "david", default: true, localService: true },
  { name: "Microsoft Mark", lang: "en-US", voiceURI: "mark", default: false, localService: true },
  { name: "Google UK English Male", lang: "en-GB", voiceURI: "google", default: false, localService: false },
  { name: "Microsoft Hortense", lang: "fr-FR", voiceURI: "hortense", default: false, localService: true },
];

/** A speechSynthesis that starts each utterance after `startMs`, ends it
 *  after `speakMs`, and answers `cancel` with `onerror`, as Chrome does.
 *  `drop(text)` makes `speak` swallow one (a stub, or a post-cancel loss). */
function fakeSynth(o: { startMs?: number; speakMs?: number; drop?: (text: string) => boolean } = {}) {
  vi.useFakeTimers({ now: 0 });
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  const said: Array<{ u: FakeUtterance; at: number; endedAt: number | null; cut: boolean }> = [];
  let live: { u: FakeUtterance; timers: Array<ReturnType<typeof setTimeout>> } | null = null;
  const synth = {
    paused: false,
    resume: vi.fn(),
    getVoices: () => VOICES,
    speak(u: FakeUtterance) {
      const row = { u, at: Date.now(), endedAt: null as number | null, cut: false };
      said.push(row);
      if (o.drop?.(u.text) === true) return;
      const timers: Array<ReturnType<typeof setTimeout>> = [];
      live = { u, timers };
      timers.push(setTimeout(() => u.onstart?.(), o.startMs ?? 50));
      timers.push(
        setTimeout(() => {
          row.endedAt = Date.now();
          live = null;
          u.onend?.();
        }, (o.startMs ?? 50) + (o.speakMs ?? 400)),
      );
    },
    cancel() {
      const cur = live;
      live = null;
      if (cur === null) return;
      for (const t of cur.timers) clearTimeout(t);
      const row = said[said.length - 1]!;
      row.endedAt = Date.now();
      row.cut = true;
      cur.u.onerror?.({ error: "interrupted" });
    },
  };
  vi.stubGlobal("speechSynthesis", synth);
  return { synth, said };
}

const frag = (text: string, o: Partial<VoiceFrag> = {}): VoiceFrag => ({ text, pace: 0, pitch: HIS_PITCH, volume: 1, gapMs: 0, ...o });
const plan = (...frags: VoiceFrag[]): VoicePlan => ({ flavours: ["skip"], frags });
const browser = (p: VoicePlan): Prepared => ({ kind: "browser", text: "the plain text", plan: p });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a broken sentence on the browser voice", () => {
  it("says each fragment as its own utterance, in order, with its pace, pitch and volume", async () => {
    const { said } = fakeSynth();
    const engine = new BrowserEngine({ voice: "", speed: 0.92 });
    const done = engine.play(browser(plan(frag("one", { pace: 3, pitch: 1.5 }), frag("two", { pace: -2, pitch: 0.3, volume: 0.5 }), frag("three"))), () => {});
    await vi.runAllTimersAsync();
    await done;
    expect(said.map((s) => s.u.text)).toEqual(["one", "two", "three"]);
    expect(said[0]!.u.rate).toBeCloseTo(paceRate(3, 0.92));
    expect(said[0]!.u.pitch).toBeCloseTo(1.5);
    expect(said[1]!.u.pitch).toBeCloseTo(0.3);
    expect(said[1]!.u.volume).toBe(0.5);
    expect(said[2]!.u.rate).toBeCloseTo(0.92); // pace 0: the terminal's own
  });

  it("reports the start once, when the first fragment is heard", async () => {
    fakeSynth({ startMs: 120 });
    const engine = new BrowserEngine({ voice: "", speed: 1 });
    const onStart = vi.fn();
    const done = engine.play(browser(plan(frag("one"), frag("two"))), () => {}, onStart);
    await vi.advanceTimersByTimeAsync(119);
    expect(onStart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onStart).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    await done;
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("waits out a gap", async () => {
    const { said } = fakeSynth({ startMs: 0, speakMs: 100 });
    const engine = new BrowserEngine({ voice: "", speed: 1 });
    const done = engine.play(browser(plan(frag("one", { gapMs: 900 }), frag("two"))), () => {});
    await vi.runAllTimersAsync();
    await done;
    expect(said[1]!.at).toBe(1000);
  });

  it("cuts a word off for real, counted from when it is heard, then lets the engine settle", async () => {
    const { said } = fakeSynth({ startMs: 300, speakMs: 2000 });
    const engine = new BrowserEngine({ voice: "", speed: 1 });
    const done = engine.play(browser(plan(frag("program", { cutMs: 120 }), frag("program"))), () => {});
    await vi.runAllTimersAsync();
    await done;
    expect(said[0]!.cut).toBe(true);
    expect(said[0]!.endedAt).toBe(420);
    expect(said[1]!.at).toBe(420 + CANCEL_SETTLE_MS);
    expect(said[1]!.cut).toBe(false);
  });

  it("skips a later fragment an engine drops, and doesn't write the engine off", async () => {
    const { said } = fakeSynth({ drop: (t) => t === "two" });
    const engine = new BrowserEngine({ voice: "", speed: 1 });
    const done = engine.play(browser(plan(frag("one"), frag("two"), frag("three"))), () => {});
    await vi.advanceTimersByTimeAsync(450 + FRAG_START_MS);
    await vi.runAllTimersAsync();
    await done;
    expect(said.map((s) => s.u.text)).toEqual(["one", "two", "three"]);
    expect(engine.dead).toBe(false);
  });

  it("writes the engine off when the first fragment never starts, and the ladder says it plainly", async () => {
    const { said } = fakeSynth({ drop: () => true });
    const device = new DeviceEngine({ voice: "", speed: 1 });
    const done = device.play(browser(plan(frag("one"), frag("two"))), () => {});
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
    await vi.runAllTimersAsync();
    await done;
    expect(device.browser.dead).toBe(true);
    expect(said.map((s) => s.u.text)).toEqual(["one"]); // the rest of the plan isn't tried
  });

  it("stop() ends it now: mid-fragment, and in a gap", async () => {
    const mid = fakeSynth({ startMs: 0, speakMs: 5000 });
    const engine = new BrowserEngine({ voice: "", speed: 1 });
    const done = engine.play(browser(plan(frag("one"), frag("two"))), () => {});
    await vi.advanceTimersByTimeAsync(100);
    engine.stop();
    await vi.runAllTimersAsync();
    await done;
    expect(mid.said.map((s) => s.u.text)).toEqual(["one"]);

    const gap = new BrowserEngine({ voice: "", speed: 1 });
    const at = Date.now();
    const quiet = gap.play(browser(plan(frag("one", { gapMs: 60_000 }), frag("two"))), () => {});
    await vi.advanceTimersByTimeAsync(5100);
    gap.stop();
    await quiet;
    expect(Date.now() - at).toBeLessThan(6000);
    expect(mid.said.filter((s) => s.u.text === "two")).toHaveLength(0);
  });

  it("closes the mouth between fragments", async () => {
    fakeSynth({ startMs: 0, speakMs: 400 });
    const levels: number[] = [];
    vi.stubGlobal("performance", { now: () => Date.now() });
    vi.stubGlobal("requestAnimationFrame", (f: () => void) => setTimeout(f, 16));
    vi.stubGlobal("cancelAnimationFrame", (t: ReturnType<typeof setTimeout>) => clearTimeout(t));
    const engine = new BrowserEngine({ voice: "", speed: 1 });
    const done = engine.play(browser(plan(frag("one", { gapMs: 200 }), frag("two"))), (v) => levels.push(v));
    await vi.runAllTimersAsync();
    await done;
    expect(levels.some((v) => v > 0)).toBe(true);
    expect(levels.filter((v) => v === 0).length).toBeGreaterThan(5);
    expect(levels[levels.length - 1]).toBe(0);
  });

  it("plays its noise after the fragment, through the injected player", async () => {
    fakeSynth();
    const noise = vi.fn();
    const engine = new BrowserEngine({ voice: "", speed: 1, noise });
    const done = engine.play(browser(plan(frag("one", { noise: "tick" }), frag("two"))), () => {});
    await vi.runAllTimersAsync();
    await done;
    expect(noise).toHaveBeenCalledTimes(1);
    expect(noise).toHaveBeenCalledWith("tick");
  });
});

describe("the other voices", () => {
  it("are the device's own English ones, never a stream, in a stable order, not his", () => {
    const own = VOICES[1]!;
    expect(alternateVoices(VOICES, own).map((v) => v.name)).toEqual(["Microsoft Mark", "Microsoft Zira"]);
    expect(alternateVoices([...VOICES].reverse(), own).map((v) => v.name)).toEqual(["Microsoft Mark", "Microsoft Zira"]);
  });
  it("hop as the plan says, and a fragment without one stays his", async () => {
    const { said } = fakeSynth();
    const engine = new BrowserEngine({ voice: "david", speed: 1 });
    const done = engine.play(browser(plan(frag("mine"), frag("one", { voice: 0 }), frag("two", { voice: 1 }), frag("wrapped", { voice: 2 }))), () => {});
    await vi.runAllTimersAsync();
    await done;
    expect(said.map((s) => (s.u.voice as { name: string }).name)).toEqual(["Microsoft David", "Microsoft Mark", "Microsoft Zira", "Microsoft Mark"]);
  });
  it("are counted for the planner", () => {
    fakeSynth();
    expect(alternateCount()).toBe(2);
    vi.unstubAllGlobals();
    expect(alternateCount()).toBe(0);
  });
});

describe("a plan on the other engines", () => {
  const p = plan(frag("the", { pace: 3 }), frag("the", { pace: 3 }), frag("program"));
  it("gives a browser voice the plan", () => {
    expect(withPlan({ kind: "browser", text: "x" }, p)).toEqual({ kind: "browser", text: "x", plan: p });
  });
  it("gives Fully Kiosk only the words", () => {
    expect(withPlan({ kind: "fully", text: "x" }, p)).toEqual({ kind: "fully", text: "the the program" });
  });
  it("leaves a silent engine's reading pace alone", () => {
    expect(withPlan({ kind: "silent", text: "x" }, p)).toEqual({ kind: "silent", text: "x" });
  });
});

describe("the queue", () => {
  function recorder(kind: "browser" | "fully" = "browser") {
    const played: Prepared[] = [];
    const engine: SpeechEngine = {
      kind,
      prepare: async (text) => ({ kind, text }),
      play: async (p, _level, onStart) => {
        played.push(p);
        onStart?.();
      },
      stop: () => {},
    };
    return { engine, played };
  }
  const on = () => ({ level: () => {}, chunk: vi.fn(), done: vi.fn(), idle: vi.fn() });
  const brokenPlan = plan(frag("broken"));

  it("asks the shaper for each sentence, as it is pronounced, at the last moment", async () => {
    const { engine, played } = recorder();
    const shape = vi.fn(() => brokenPlan);
    const events = on();
    new SpeechQueue({ primary: engine, fallback: null }, events, new VoiceFloor(), { chunk: 0, line: 0 }, shape).say({ id: 7, chunks: ["Antivirus lives.", "Yes it does."] });
    await vi.waitFor(() => expect(events.idle).toHaveBeenCalled());
    expect(shape.mock.calls).toEqual([
      ["Anti Virus lives.", 7, 0],
      ["Yes it does.", 7, 1],
    ]);
    expect(played.every((p) => p.kind === "browser" && p.plan === brokenPlan)).toBe(true);
  });

  it("still sees one chunk per sentence, whatever the plan", async () => {
    const { engine } = recorder();
    const events = on();
    new SpeechQueue({ primary: engine, fallback: null }, events, new VoiceFloor(), { chunk: 0, line: 0 }, () => plan(frag("a"), frag("b"), frag("c"))).say({ id: 1, chunks: ["One.", "Two."] });
    await vi.waitFor(() => expect(events.idle).toHaveBeenCalled());
    expect(events.chunk.mock.calls).toEqual([
      [1, 0],
      [1, 1],
    ]);
    expect(events.done).toHaveBeenCalledTimes(1);
  });

  it("leaves a clean line alone", async () => {
    const { engine, played } = recorder();
    const shape = vi.fn(() => brokenPlan);
    const events = on();
    new SpeechQueue({ primary: engine, fallback: null }, events, new VoiceFloor(), { chunk: 0, line: 0 }, shape).say({ id: 1, chunks: ["Thank you."], clean: true });
    await vi.waitFor(() => expect(events.idle).toHaveBeenCalled());
    expect(shape).not.toHaveBeenCalled();
    expect(played[0]).toEqual({ kind: "browser", text: "Thank you." });
  });

  it("says a line plainly when the shaper throws: a glitch never costs a line", async () => {
    const { engine, played } = recorder();
    const events = on();
    new SpeechQueue({ primary: engine, fallback: null }, events, new VoiceFloor(), { chunk: 0, line: 0 }, () => {
      throw new Error("bad plan");
    }).say({ id: 1, chunks: ["Still said."] });
    await vi.waitFor(() => expect(events.idle).toHaveBeenCalled());
    expect(played[0]).toEqual({ kind: "browser", text: "Still said." });
  });

  it("with no shaper (announcements, TEST VOICE) nothing changes", async () => {
    const { engine, played } = recorder();
    const events = on();
    new SpeechQueue({ primary: engine, fallback: null }, events, new VoiceFloor(), { chunk: 0, line: 0 }).say({ id: 1, chunks: ["Doors open."] });
    await vi.waitFor(() => expect(events.idle).toHaveBeenCalled());
    expect(played[0]).toEqual({ kind: "browser", text: "Doors open." });
  });
});
