import { describe, expect, it } from "vitest";
import { effectiveView, probeWebGL2, type CanvasMaker } from "../src/webgl.ts";

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

describe("effectiveView", () => {
  it("keeps every view with WebGL2", () => {
    for (const v of ["auto", "world", "face", "mirror", "tv"] as const) expect(effectiveView(v, true)).toBe(v);
  });

  it("forces the face pane without WebGL2 (never the retry loop)", () => {
    expect(effectiveView("auto", false)).toBe("face");
    expect(effectiveView("world", false)).toBe("face");
    expect(effectiveView("face", false)).toBe("face");
    expect(effectiveView("mirror", false)).toBe("mirror");
    expect(effectiveView("tv", false)).toBe("tv"); // the TV keeps its face, just no world pane
  });
});
