import { describe, expect, it, vi } from "vitest";
import { CameraHub, cameraStateOfError, constraintsFor, type CameraEnv } from "../src/camera.ts";

function fakeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop };
}

function env(open: () => Promise<MediaStream>, secure = true): () => CameraEnv {
  return () => ({ secure, getUserMedia: vi.fn(open) });
}

describe("the shared camera", () => {
  it("opens one stream for every holder and stops it with the last", async () => {
    const s = fakeStream();
    const gum = vi.fn(() => Promise.resolve(s.stream));
    const hub = new CameraHub(() => ({ secure: true, getUserMedia: gum }));
    const [a, b] = await Promise.all([hub.acquire("user"), hub.acquire("user")]);
    expect(a).toBe(s.stream);
    expect(b).toBe(s.stream);
    expect(await hub.acquire("user")).toBe(s.stream);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(hub.snapshot.state).toBe("live");
    hub.release();
    hub.release();
    expect(s.stop).not.toHaveBeenCalled();
    hub.release();
    expect(s.stop).toHaveBeenCalled();
    expect(hub.snapshot.stream).toBeNull();
  });
  it("reopens for a new facing mode", async () => {
    const first = fakeStream();
    const second = fakeStream();
    const streams = [first.stream, second.stream];
    const gum = vi.fn((c: MediaStreamConstraints) => Promise.resolve(streams.shift()!));
    const hub = new CameraHub(() => ({ secure: true, getUserMedia: gum }));
    await hub.acquire("user");
    expect(await hub.acquire("environment")).toBe(second.stream);
    expect(first.stop).toHaveBeenCalled();
    expect(gum.mock.calls[1]![0]).toEqual(constraintsFor("environment"));
  });
  it("stops a stream that arrives after everyone let go", async () => {
    let resolve!: (s: MediaStream) => void;
    const s = fakeStream();
    const hub = new CameraHub(env(() => new Promise((r) => (resolve = r))));
    const p = hub.acquire("user");
    hub.release();
    resolve(s.stream);
    expect(await p).toBeNull();
    expect(s.stop).toHaveBeenCalled();
  });
  it("reuses an open in flight across a quick release + acquire", async () => {
    let resolve!: (s: MediaStream) => void;
    const s = fakeStream();
    const gum = vi.fn(() => new Promise<MediaStream>((r) => (resolve = r)));
    const hub = new CameraHub(() => ({ secure: true, getUserMedia: gum }));
    void hub.acquire("user");
    hub.release();
    const p = hub.acquire("user");
    resolve(s.stream);
    expect(await p).toBe(s.stream);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(s.stop).not.toHaveBeenCalled();
    expect(hub.snapshot.state).toBe("live");
  });
  it("says why there is no camera", async () => {
    expect(await new CameraHub(env(() => Promise.reject(new Error("x")), false)).acquire("user")).toBeNull();
    const insecure = new CameraHub(() => ({ secure: false, getUserMedia: null }));
    await insecure.acquire("user");
    expect(insecure.snapshot.state).toBe("insecure");
    const denied = new CameraHub(env(() => Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" }))));
    await denied.acquire("user");
    expect(denied.snapshot.state).toBe("denied");
    expect(cameraStateOfError({ name: "NotFoundError" })).toBe("none");
    expect(cameraStateOfError({ name: "Weird" })).toBe("error");
  });
});
