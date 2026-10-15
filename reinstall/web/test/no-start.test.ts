import { describe, expect, it } from "vitest";
import { NO_WEBGL2, NoRenderer, whyNoStart } from "../src/game/no-start.ts";

describe("whyNoStart", () => {
  it("only a renderer that won't come up is \"no WebGL2\"", () => {
    expect(whyNoStart(new NoRenderer(new Error("Error creating WebGL context.")))).toBe(NO_WEBGL2);
  });

  it("anything else the game trips on is said as itself (a map or spawn problem isn't a browser problem)", () => {
    expect(whyNoStart(new Error('unknown room "hall"'))).toBe('This device couldn\'t start the simulation (unknown room "hall").');
    expect(whyNoStart("boom")).toBe("This device couldn't start the simulation (boom).");
  });

  it("keeps the renderer's own message", () => {
    expect(new NoRenderer(new Error("Error creating WebGL context.")).message).toBe("Error creating WebGL context.");
  });
});
