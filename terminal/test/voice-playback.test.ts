import { describe, expect, it } from "vitest";
import { VOICE_CHUNK_BYTES, mulawEncode } from "@loom/house";
import { BYE_FADE_S, MAX_SOURCES, PLAY_TARGET_MS, VoicePlayback, fadeIn, type VoiceOut } from "../src/voice/playback.ts";
import { FakeAudioContext, FakeNode, type FakeGain, type FakeSource } from "./fake-audio.ts";

const loud = () => mulawEncode(Array.from({ length: VOICE_CHUNK_BYTES }, (_, i) => 0.5 * Math.sin(i / 3)));

function rig() {
  const ctx = new FakeAudioContext();
  ctx.sampleRate = 48000;
  const bus = new FakeNode("voices", ctx);
  bus.connect(ctx.destination);
  const timers: Array<() => void> = [];
  const play = new VoicePlayback(() => ({ ctx, out: bus }) as unknown as VoiceOut, (fn) => timers.push(fn));
  const sources = () => ctx.sources as FakeSource[];
  return { ctx, bus, play, timers, sources };
}

describe("the players' voices", () => {
  it("plays a chunk at the context's rate, a jitter buffer from now, faded in, on the voices bus", () => {
    const { ctx, play, sources } = rig();
    expect(play.push({ from: "s:a", gain: 1, data: loud() })).toBe(true);
    const buf = ctx.buffers[0]!;
    expect(buf.sampleRate).toBe(48000); // never createBuffer at 16 kHz
    expect(buf.length).toBeGreaterThan(9500);
    expect(buf.data[0]).toBe(0);
    expect(sources()[0]!.started).toBeCloseTo(10 + PLAY_TARGET_MS / 1000);
    expect(ctx.path(sources()[0]!)).toEqual(["noise", "gain", "voices", "destination"]);
    expect(play.count).toBe(1);
  });
  it("queues the next chunk right after, then cuts a backlog back to the target", () => {
    const { ctx, play, sources } = rig();
    play.push({ from: "s:a", gain: 1, data: loud() });
    const end0 = 10 + 0.25 + ctx.buffers[0]!.length / 48000;
    play.push({ from: "s:a", gain: 1, data: loud() });
    expect(sources()[1]!.started).toBeCloseTo(end0);
    expect(ctx.buffers[1]!.data[0]).not.toBe(0); // queued: no fade
    expect(play.playingUntil()).toBeCloseTo(end0 + ctx.buffers[1]!.length / 48000);
    // 650 ms queued now, more than PLAY_MAX_MS: what hasn't started is cut.
    play.push({ from: "s:a", gain: 1, data: loud() });
    expect(sources()[0]!.stopped).toBe(10);
    expect(sources()[1]!.stopped).toBe(10);
    expect(sources()[2]!.started).toBeCloseTo(10.25);
    expect(ctx.buffers[2]!.data[0]).toBe(0);
  });
  it("starts fresh after an underrun", () => {
    const { ctx, play, sources } = rig();
    play.push({ from: "s:a", gain: 1, data: loud() });
    ctx.currentTime += 2;
    play.push({ from: "s:a", gain: 1, data: loud() });
    expect(sources()[1]!.started).toBeCloseTo(12.25);
  });
  it("follows the gain the server sends, per player", () => {
    const { ctx, play } = rig();
    play.push({ from: "s:a", gain: 0.4, data: loud() });
    play.push({ from: "s:b", gain: 1, data: loud() });
    const ga = ctx.gains[0] as FakeGain;
    expect(ga.gain.value).toBe(0.4);
    play.push({ from: "s:a", gain: 0.8, data: loud() });
    expect(ga.gain.events.at(-1)?.slice(0, 2)).toEqual(["set", 0.8]);
    expect(play.count).toBe(2);
  });
  it("fades a player out on bye and lets go of them", () => {
    const { ctx, play, timers, sources } = rig();
    play.push({ from: "s:a", gain: 0.5, data: loud() });
    play.bye("s:a");
    const g = ctx.gains[0] as FakeGain;
    expect(g.gain.events.at(-1)).toEqual(["lin", 0, 10 + BYE_FADE_S]);
    expect(sources()[0]!.stopped).toBeCloseTo(10 + BYE_FADE_S);
    expect(play.count).toBe(0);
    expect(play.playingUntil()).toBeCloseTo(10 + BYE_FADE_S);
    timers.forEach((t) => t());
    expect(g.disconnected).toBe(true);
    play.bye("s:nobody"); // harmless
    play.push({ from: "s:a", gain: 1, data: loud() });
    play.push({ from: "s:b", gain: 1, data: loud() });
    play.clear();
    expect(play.count).toBe(0);
  });
  it("drops chunks while sound is locked, and past the players cap", () => {
    const { ctx, play } = rig();
    ctx.state = "suspended";
    expect(play.push({ from: "s:a", gain: 1, data: loud() })).toBe(false);
    ctx.state = "running";
    for (let i = 0; i < MAX_SOURCES; i++) expect(play.push({ from: `s:${i}`, gain: 1, data: loud() })).toBe(true);
    expect(play.push({ from: "s:late", gain: 1, data: loud() })).toBe(false);
    // A player gone quiet for long gives up its slot.
    ctx.currentTime += 10;
    expect(play.push({ from: "s:late", gain: 1, data: loud() })).toBe(true);
    expect(new VoicePlayback(() => null).push({ from: "s:a", gain: 1, data: loud() })).toBe(false);
  });
  it("fadeIn ramps the first samples", () => {
    const s = new Float32Array([1, 1, 1, 1, 1]);
    fadeIn(s, 4);
    expect([...s]).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});
