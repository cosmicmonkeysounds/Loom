import { describe, expect, it, vi } from "vitest";
import { constraintsFor } from "../src/camera.ts";
import { MIC_CONSTRAINTS, MicHub } from "../src/voice/mic.ts";

function fakeStream() {
  const stop = vi.fn();
  const ended: Array<() => void> = [];
  const track = { stop, addEventListener: (k: string, fn: () => void) => k === "ended" && ended.push(fn) };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  return { stream, stop, end: () => ended.forEach((f) => f()) };
}

describe("the shared microphone", () => {
  it("asks for audio only, never touching the camera's constraints", () => {
    expect(MIC_CONSTRAINTS.video).toBe(false);
    expect(MIC_CONSTRAINTS.audio).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    expect(constraintsFor("user").audio).toBe(false);
  });
  it("opens one stream for every holder and stops it with the last", async () => {
    const s = fakeStream();
    const gum = vi.fn(() => Promise.resolve(s.stream));
    const hub = new MicHub(() => ({ secure: true, getUserMedia: gum }));
    const [a, b] = await Promise.all([hub.acquire(), hub.acquire()]);
    expect(a).toBe(s.stream);
    expect(b).toBe(s.stream);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(gum.mock.calls[0]).toEqual([MIC_CONSTRAINTS]);
    expect(hub.snapshot.state).toBe("live");
    hub.release();
    expect(s.stop).not.toHaveBeenCalled();
    hub.release();
    expect(s.stop).toHaveBeenCalled();
    expect(hub.snapshot.stream).toBeNull();
  });
  it("stops a stream that lands after everyone let go", async () => {
    let resolve!: (s: MediaStream) => void;
    const s = fakeStream();
    const hub = new MicHub(() => ({ secure: true, getUserMedia: () => new Promise((r) => (resolve = r)) }));
    const p = hub.acquire();
    hub.release();
    resolve(s.stream);
    expect(await p).toBeNull();
    expect(s.stop).toHaveBeenCalled();
  });
  it("says why it can't run", async () => {
    const insecure = new MicHub(() => ({ secure: false, getUserMedia: null }));
    expect(await insecure.acquire()).toBeNull();
    expect(insecure.snapshot.state).toBe("insecure");
    const none = new MicHub(() => ({ secure: true, getUserMedia: null }));
    await none.acquire();
    expect(none.snapshot.state).toBe("none");
    const denied = new MicHub(() => ({ secure: true, getUserMedia: () => Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" })) }));
    await denied.acquire();
    expect(denied.snapshot.state).toBe("denied");
    const missing = new MicHub(() => ({ secure: true, getUserMedia: () => Promise.reject(Object.assign(new Error("no"), { name: "NotFoundError" })) }));
    await missing.acquire();
    expect(missing.snapshot.state).toBe("none");
  });
  it("opens it again when the track ends under a holder", async () => {
    const first = fakeStream();
    const second = fakeStream();
    const streams = [first.stream, second.stream];
    const gum = vi.fn(() => Promise.resolve(streams.shift()!));
    const hub = new MicHub(() => ({ secure: true, getUserMedia: gum }));
    await hub.acquire();
    const seen: string[] = [];
    hub.subscribe(() => seen.push(hub.snapshot.state));
    first.end();
    await new Promise((r) => setTimeout(r, 0));
    expect(gum).toHaveBeenCalledTimes(2);
    expect(hub.snapshot.stream).toBe(second.stream);
    expect(seen).toContain("live");
  });
});
