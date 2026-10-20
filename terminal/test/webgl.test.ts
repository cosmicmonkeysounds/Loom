import { describe, expect, it } from "vitest";
import { fullScreenSim, paneSimulation, probeWebGL2, simRenderer, type CanvasMaker } from "../src/webgl.ts";

const maker = (ctx: () => unknown): CanvasMaker => ({ createElement: () => ({ getContext: ctx }) });

describe("probeWebGL2", () => {
  it("is true when a webgl2 context comes back, and releases it", () => {
    let lost = false;
    const gl = { getExtension: (n: string) => (n === "WEBGL_lose_context" ? { loseContext: () => (lost = true) } : null) };
    expect(probeWebGL2(maker(() => gl))).toBe(true);
    expect(lost).toBe(true);
  });

  it("is true without the lose-context extension", () => {
    expect(probeWebGL2(maker(() => ({ getExtension: () => null })))).toBe(true);
  });

  it("is false when the context is null (a GLES2-only GPU)", () => {
    expect(probeWebGL2(maker(() => null))).toBe(false);
  });

  it("is false when getContext throws, or there is no document", () => {
    expect(
      probeWebGL2(
        maker(() => {
          throw new Error("blocked");
        }),
      ),
    ).toBe(false);
    expect(probeWebGL2(undefined)).toBe(false);
  });
});

describe("simRenderer", () => {
  it("draws the world with WebGL2, the live plan without it", () => {
    expect(simRenderer(true)).toBe("world");
    expect(simRenderer(false)).toBe("plan");
  });
});

describe("paneSimulation", () => {
  it("keeps the WebGL2 behaviour: world / auto while playing / the shadow with a live camera", () => {
    expect(paneSimulation("world", true, false, false)).toBe("world");
    expect(paneSimulation("auto", true, false, false)).toBe("none");
    expect(paneSimulation("auto", true, true, false)).toBe("world");
    expect(paneSimulation("auto", true, true, true)).toBe("shadow");
    expect(paneSimulation("world", true, true, true)).toBe("world");
  });

  it("draws the live plan without WebGL2 where the world would be (never the face, never the shadow)", () => {
    expect(paneSimulation("world", false, false, false)).toBe("plan");
    expect(paneSimulation("auto", false, false, false)).toBe("none"); // nobody playing: the face, as before
    expect(paneSimulation("auto", false, true, false)).toBe("plan");
    expect(paneSimulation("auto", false, true, true)).toBe("plan");
  });

  it("face and the other views show nothing over the face", () => {
    for (const v of ["face", "tv", "chess", "casino", "mirror", "shadow"] as const) expect(paneSimulation(v, false, true, true)).toBe("none");
  });
});

describe("fullScreenSim", () => {
  it("a mirror / shadow draws the world or the shadow, else the plan", () => {
    expect(fullScreenSim("mirror", true)).toBe("world");
    expect(fullScreenSim("shadow", true)).toBe("shadow");
    expect(fullScreenSim("mirror", false)).toBe("plan");
    expect(fullScreenSim("shadow", false)).toBe("plan");
  });
});
