import { describe, expect, it, vi } from "vitest";
import { VOICE_TAIL_MS, mulawEncode } from "@loom/house";
import { MicHub } from "../src/voice/mic.ts";
import { VoiceLink, type StreamHandlers, type VoiceLinkDeps } from "../src/voice/link.ts";
import { VOICE_OFF, micHeartbeat, onAir, voiceStatus, voiceStatusText, type VoiceStatus } from "../src/voice/status.ts";
import { VoicePlayback } from "../src/voice/playback.ts";
import type { UplinkAnswer } from "../src/voice/uplink.ts";

const RATE = 48000;
/** 200 ms+ of a loud tone at RATE: one whole 16 kHz chunk after resampling. */
const loud = () => Float32Array.from({ length: 9700 }, (_, i) => 0.4 * Math.sin(i / 5));
const flush = () => new Promise((r) => setTimeout(r, 0));

function rig(over: Partial<VoiceLinkDeps> = {}) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const hub = new MicHub(() => ({ secure: true, getUserMedia: () => Promise.resolve(stream) }));
  let handlers: StreamHandlers | null = null;
  const closeStream = vi.fn();
  let onFrames: ((s: Float32Array) => void) | null = null;
  const stopCapture = vi.fn();
  const posts: Array<{ body: Uint8Array; seq: number }> = [];
  const answers: UplinkAnswer[] = [];
  const statuses: VoiceStatus[] = [];
  let now = 1000;
  let floor = false;
  const pushed: string[] = [];
  const playback = {
    count: 0,
    push: vi.fn((f: { from: string }) => (pushed.push(f.from), true)),
    bye: vi.fn(),
    clear: vi.fn(),
    playingUntil: vi.fn(() => 0),
  } as unknown as VoicePlayback;
  const deps: VoiceLinkDeps = {
    roles: { mic: true, voices: true },
    report: (s) => (s === "live" || s === "denied" || s === "insecure" ? s : null),
    hub,
    capture: (_s, fn) => ((onFrames = fn), { rate: RATE, stop: stopCapture }),
    openStream: (h) => ((handlers = h), closeStream),
    post: async (body, seq) => (posts.push({ body, seq }), answers.shift() ?? { status: 200, listening: true }),
    playback,
    ctxTime: () => 5,
    floorBusy: () => floor,
    ownSoundUntil: () => 0,
    now: () => now,
    seq0: 77,
    setTimer: () => 0,
    clearTimer: () => {},
    onStatus: (s) => statuses.push(s),
    ...over,
  };
  const link = new VoiceLink(deps);
  return {
    link,
    hub,
    track,
    posts,
    answers,
    statuses,
    playback,
    pushed,
    closeStream,
    stopCapture,
    h: () => handlers!,
    frames: (s = loud()) => onFrames?.(s),
    tick: (ms: number) => (now += ms),
    setFloor: (b: boolean) => (floor = b),
    last: () => statuses.at(-1)!,
  };
}

describe("the voice link on a terminal", () => {
  it("does nothing where it takes no part", () => {
    const openStream = vi.fn();
    const r = rig({ roles: { mic: false, voices: false }, openStream });
    r.link.start();
    expect(openStream).not.toHaveBeenCalled();
    expect(r.hub.count).toBe(0);
    expect(r.last().link).toBe("off");
  });
  it("sends the room only while a player can hear it", async () => {
    const r = rig();
    r.link.start();
    await flush();
    expect(r.last()).toMatchObject({ mic: "live", link: "connecting", report: "live" });
    r.frames();
    await flush();
    expect(r.posts).toHaveLength(0); // nobody listening yet
    r.h().onFrame({ type: "hello", codec: "mulaw", rate: 16000, listen: true, as: "terminal", spot: "hall" });
    expect(r.last()).toMatchObject({ link: "live", listening: true });
    expect(onAir(r.last())).toBe(true);
    r.tick(200);
    r.frames();
    await flush();
    expect(r.posts.length).toBeGreaterThan(0);
    expect(r.posts[0]!.seq).toBe(77);
    const sent = r.posts.length;
    r.h().onFrame({ type: "listen", on: false });
    r.tick(200);
    r.frames();
    await flush();
    expect(r.posts).toHaveLength(sent);
    expect(onAir(r.last())).toBe(false);
  });
  it("a POST saying nobody listens stops the sending until the stream says otherwise", async () => {
    const r = rig();
    r.answers.push({ status: 200, listening: false });
    r.link.start();
    await flush();
    r.h().onFrame({ type: "hello", codec: "mulaw", rate: 16000, listen: true, as: "terminal", spot: "hall" });
    r.frames();
    await flush();
    expect(r.last().listening).toBe(false);
    r.tick(200);
    r.frames();
    await flush();
    expect(r.posts).toHaveLength(1);
    r.h().onFrame({ type: "listen", on: true });
    r.tick(200);
    r.frames();
    await flush();
    expect(r.posts.length).toBeGreaterThan(1);
  });
  it("half-duplex: nothing goes up while this page speaks or plays a player", async () => {
    let playingUntil = 0;
    const r = rig();
    (r.playback as unknown as { playingUntil: () => number }).playingUntil = () => playingUntil;
    r.link.start();
    await flush();
    r.h().onFrame({ type: "hello", codec: "mulaw", rate: 16000, listen: true, as: "terminal", spot: "hall" });
    r.setFloor(true);
    r.frames();
    await flush();
    expect(r.posts).toHaveLength(0);
    r.setFloor(false);
    r.tick(VOICE_TAIL_MS / 2);
    r.frames();
    await flush();
    expect(r.posts).toHaveLength(0); // still inside the tail
    playingUntil = 5 + 1; // a player plays for another second of context time
    r.tick(VOICE_TAIL_MS);
    r.frames();
    await flush();
    expect(r.posts).toHaveLength(0);
    playingUntil = 0;
    r.tick(1000 + VOICE_TAIL_MS);
    r.frames();
    await flush();
    expect(r.posts.length).toBeGreaterThan(0);
  });
  it("hands players to the playback and drops them when the stream drops", async () => {
    const r = rig();
    r.link.start();
    const data = mulawEncode([0.1, 0.2]);
    r.h().onFrame({ type: "voice", from: "s:a", kind: "player", name: "Winamp", gain: 1, seq: 1, data });
    r.h().onFrame({ type: "voice", from: "t:x", kind: "terminal", name: null, gain: 1, seq: 1, data });
    expect(r.pushed).toEqual(["s:a"]);
    r.h().onFrame({ type: "bye", from: "s:a" });
    expect(r.playback.bye).toHaveBeenCalledWith("s:a");
    r.h().onConnected(false);
    expect(r.playback.clear).toHaveBeenCalled();
    expect(r.last()).toMatchObject({ link: "connecting", listening: false });
  });
  it("the TV's default: players only, no microphone asked for", () => {
    const r = rig({ roles: { mic: false, voices: true } });
    r.link.start();
    expect(r.hub.count).toBe(0);
    r.h().onFrame({ type: "hello", codec: "mulaw", rate: 16000, listen: true, as: "terminal", spot: "tv" });
    expect(r.last().listening).toBe(false);
  });
  it("a refusal stops it all and lets the microphone go", async () => {
    const r = rig();
    r.link.start();
    await flush();
    expect(r.hub.count).toBe(1);
    r.h().onGone(403);
    expect(r.last()).toMatchObject({ link: "stopped", problem: expect.stringMatching(/off at this terminal/) });
    expect(r.hub.count).toBe(0);
    expect(r.track.stop).toHaveBeenCalled();
    expect(r.stopCapture).toHaveBeenCalled();
    expect(r.closeStream).toHaveBeenCalled();
    expect(voiceStatusText(r.last())).toMatch(/stopped/);
  });
  it("refuses a stream speaking another wire", async () => {
    const r = rig();
    r.link.start();
    await flush();
    r.h().onFrame({ type: "hello", codec: "opus", rate: 48000, listen: true, as: "terminal", spot: "hall" });
    expect(r.last()).toMatchObject({ link: "stopped", problem: expect.stringMatching(/opus/) });
  });
  it("stop() closes the stream and the microphone", async () => {
    const r = rig();
    r.link.start();
    await flush();
    r.link.stop();
    expect(r.closeStream).toHaveBeenCalled();
    expect(r.hub.count).toBe(0);
  });
});

describe("the voice link's words", () => {
  const live: VoiceStatus = { ...VOICE_OFF, roles: { mic: true, voices: true }, mic: "live", link: "live", listening: true, report: "live" };
  it("says what it is doing", () => {
    expect(voiceStatusText(VOICE_OFF)).toBe("voice link off at this terminal");
    expect(voiceStatusText(live)).toMatch(/heard in the games now/);
    expect(voiceStatusText({ ...live, listening: false, hearing: 2 })).toMatch(/nobody in the games is near.*hearing 2 players/);
    expect(voiceStatusText({ ...live, mic: "denied" })).toMatch(/Enable Microphone Access/);
    expect(voiceStatusText({ ...live, mic: "insecure" })).toMatch(/https/);
    expect(voiceStatusText({ ...live, roles: { mic: false, voices: true }, mic: null })).toMatch(/microphone off/);
    expect(onAir(live)).toBe(true);
    expect(onAir({ ...live, mic: "denied" })).toBe(false);
  });
  it("the store feeds the heartbeat", () => {
    voiceStatus.set({ ...live, report: "denied" });
    expect(micHeartbeat()).toBe("denied");
    voiceStatus.set(VOICE_OFF);
    expect(micHeartbeat()).toBe("off");
  });
});
