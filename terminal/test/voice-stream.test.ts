import { afterEach, describe, expect, it, vi } from "vitest";
import { mulawEncode } from "@loom/house";
import { bytesOf, decodeVoiceFrame, openVoiceStream, speaksOurWire, voiceGone, type VoiceFrame } from "../src/voice/stream.ts";
import type { FeedSource } from "../src/world/stream.ts";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

class FakeES implements FeedSource {
  readyState = 0;
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  listeners = new Map<string, (e: Event) => void>();
  closed = false;
  constructor(readonly url: string) {}
  addEventListener(type: string, fn: (e: Event) => void) {
    this.listeners.set(type, fn);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: typeof data === "string" ? data : JSON.stringify(data) } as MessageEvent);
  }
}

describe("voice stream frames", () => {
  it("decodes the four frames", () => {
    expect(decodeVoiceFrame("hello", JSON.stringify({ codec: "mulaw", rate: 16000, chunkMs: 200, as: "terminal", spot: "hall", listen: true }))).toEqual({ type: "hello", codec: "mulaw", rate: 16000, listen: true, as: "terminal", spot: "hall" });
    expect(decodeVoiceFrame("listen", '{"on":false}')).toEqual({ type: "listen", on: false });
    const data = mulawEncode([0, 0.5, -0.5]);
    expect(decodeVoiceFrame("voice", JSON.stringify({ from: "s:abc", kind: "player", session: "abc", name: "Winamp", gain: 0.42, seq: 7, data: b64(data) }))).toEqual({ type: "voice", from: "s:abc", kind: "player", name: "Winamp", gain: 0.42, seq: 7, data });
    expect(decodeVoiceFrame("bye", '{"from":"s:abc"}')).toEqual({ type: "bye", from: "s:abc" });
  });
  it("drops anything malformed or unknown, clamps a gain", () => {
    expect(decodeVoiceFrame("voice", "not json")).toBeNull();
    expect(decodeVoiceFrame("voice", JSON.stringify({ from: "s:a", gain: 1, seq: 1, data: "@@@" }))).toBeNull();
    expect(decodeVoiceFrame("voice", JSON.stringify({ from: "s:a", gain: 1, seq: 1, data: "" }))).toBeNull();
    expect(decodeVoiceFrame("voice", JSON.stringify({ from: "", gain: 1, seq: 1, data: "AAAA" }))).toBeNull();
    expect(decodeVoiceFrame("voice", JSON.stringify({ from: "s:a", gain: 3, seq: 1, data: "AAAA" }))).toMatchObject({ gain: 1, name: null, kind: "player" });
    expect(decodeVoiceFrame("listen", '{"on":"yes"}')).toBeNull();
    expect(decodeVoiceFrame("bye", "{}")).toBeNull();
    expect(decodeVoiceFrame("poses", "{}")).toBeNull();
    expect(bytesOf("AAE=")).toEqual(new Uint8Array([0, 1]));
  });
  it("checks the wire and the refusals", () => {
    expect(speaksOurWire({ type: "hello", codec: "mulaw", rate: 16000, listen: false, as: "terminal", spot: null })).toBe(true);
    expect(speaksOurWire({ type: "hello", codec: "opus", rate: 16000, listen: false, as: "terminal", spot: null })).toBe(false);
    expect([401, 403, 404, 410].every(voiceGone)).toBe(true);
    expect(voiceGone(502)).toBe(false);
    expect(voiceGone(null)).toBe(false);
  });
});

describe("openVoiceStream", () => {
  afterEach(() => vi.useRealTimers());
  function open(probe: () => Promise<number | null>) {
    const made: FakeES[] = [];
    const frames: VoiceFrame[] = [];
    const connected: boolean[] = [];
    const gone: number[] = [];
    const close = openVoiceStream({ url: "/e/x/api/spatial/voice/stream?token=t&spot=hall", probe, onFrame: (f) => frames.push(f), onConnected: (c) => connected.push(c), onGone: (s) => gone.push(s), source: (u) => (made.push(new FakeES(u)), made.at(-1)!) });
    return { made, frames, connected, gone, close };
  }
  it("passes frames on and reports the connection", () => {
    const h = open(async () => 200);
    const es = h.made[0]!;
    expect(es.url).toContain("/api/spatial/voice/stream?token=t&spot=hall");
    es.onopen?.({} as Event);
    es.emit("listen", { on: true });
    es.emit("bye", { from: "s:a" });
    expect(h.frames).toEqual([{ type: "listen", on: true }, { type: "bye", from: "s:a" }]);
    // A drop the browser retries: reported, no new source.
    es.onerror?.({} as Event);
    expect(h.connected).toEqual([true, false]);
    expect(h.made).toHaveLength(1);
    h.close();
    expect(es.closed).toBe(true);
    es.emit("listen", { on: true });
    expect(h.frames).toHaveLength(2);
  });
  it("retries a refusal with backoff, and stops for good on 403", async () => {
    vi.useFakeTimers();
    const codes: Array<number | null> = [502, 403];
    const h = open(async () => codes.shift() ?? null);
    h.made[0]!.readyState = 2;
    h.made[0]!.onerror?.({} as Event);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.made).toHaveLength(2);
    h.made[1]!.readyState = 2;
    h.made[1]!.onerror?.({} as Event);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.gone).toEqual([403]);
    expect(h.made).toHaveLength(2);
  });
});
