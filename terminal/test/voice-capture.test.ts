import { describe, expect, it } from "vitest";
import { VOICE_CHUNK_BYTES, VOICE_HANG_MS, VOICE_TAIL_MS, mulawDecode } from "@loom/house";
import { CAPTURE_FRAMES, MicPipeline, startCapture, type CaptureContext } from "../src/voice/capture.ts";
import { FakeAudioContext, type FakeGain } from "./fake-audio.ts";

const RATE = 48000;
/** `ms` of a 440 Hz tone (amplitude `a`) at `RATE`. */
function tone(ms: number, a = 0.3, rate = RATE): Float32Array {
  const n = Math.round((rate * ms) / 1000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a * Math.sin((2 * Math.PI * 440 * i) / rate);
  return out;
}
const hush = (ms: number) => new Float32Array(Math.round((RATE * ms) / 1000));

describe("MicPipeline: resample → 200 ms chunks → gate → μ-law", () => {
  it("sends whole 16 kHz chunks of a voice, as μ-law", () => {
    const p = new MicPipeline(RATE);
    expect(p.push(tone(100), 0)).toEqual([]); // half a chunk so far
    const out = p.push(tone(150), 100);
    expect(out).toHaveLength(1);
    expect(out[0]!.length).toBe(VOICE_CHUNK_BYTES);
    const back = mulawDecode(out[0]!);
    expect(Math.max(...back)).toBeGreaterThan(0.25);
  });
  it("closes on silence after the hang, keeping one quiet chunk of pre-roll", () => {
    const p = new MicPipeline(RATE);
    expect(p.push(hush(200), 0)).toEqual([]); // quiet: the pre-roll
    const open = p.push(tone(200), 200);
    expect(open).toHaveLength(2); // pre-roll + the loud chunk
    expect(p.push(hush(200), 400)).toHaveLength(1); // inside the hang
    expect(p.push(hush(200), 400 + VOICE_HANG_MS + 1)).toEqual([]);
  });
  it("holds while this page makes a sound, and for the tail after", () => {
    const p = new MicPipeline(RATE);
    p.quietUntil(1000);
    expect(p.holding(1000 + VOICE_TAIL_MS - 1)).toBe(true);
    expect(p.push(tone(200), 1200)).toEqual([]);
    expect(p.push(tone(200), 1000 + VOICE_TAIL_MS + 10)).toHaveLength(1); // no pre-roll: the hold forgot it
    p.quietUntil(Number.NaN); // ignored
    expect(p.holding(5000)).toBe(false);
  });
  it("starts clean after a reset", () => {
    const p = new MicPipeline(RATE);
    p.push(tone(150), 0);
    p.reset();
    expect(p.push(tone(150), 1000)).toEqual([]);
  });
});

describe("startCapture: a script processor through a zero gain", () => {
  it("taps the stream and hands each buffer on, copied", () => {
    const ctx = new FakeAudioContext();
    const got: Float32Array[] = [];
    const stop = startCapture(ctx as unknown as CaptureContext, {} as MediaStream, (s) => got.push(s));
    const proc = ctx.processors[0]!;
    expect(proc.frames).toBe(CAPTURE_FRAMES);
    expect(ctx.path(ctx.streams[0]!)).toEqual(["mic", "processor", "gain", "destination"]);
    const zero = proc.out[0] as FakeGain;
    expect(zero.gain.value).toBe(0);
    const buf = new Float32Array([0.1, 0.2]);
    proc.fire(buf);
    expect(got[0]).toEqual(buf);
    expect(got[0]).not.toBe(buf);
    stop();
    expect(proc.onaudioprocess).toBeNull();
    expect(ctx.streams[0]!.disconnected && proc.disconnected && zero.disconnected).toBe(true);
    proc.fire(buf);
    expect(got).toHaveLength(1);
  });
});
