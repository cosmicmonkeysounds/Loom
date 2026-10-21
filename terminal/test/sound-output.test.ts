//! The master bus as an output for the reinstallation game (wave 18b): the
//! tent laptop's game sounds ride the page's own context and master gain.

import { afterEach, describe, expect, it } from "vitest";
import { setSoundContext, soundOutput, type SoundContext } from "../src/sound/bus.ts";
import { FakeAudioContext } from "./fake-audio.ts";

afterEach(() => setSoundContext(undefined));

describe("soundOutput", () => {
  it("is the page's context and the master gain, the same node every call", () => {
    const ctx = new FakeAudioContext();
    setSoundContext(ctx as unknown as SoundContext);
    const a = soundOutput();
    expect(a).not.toBeNull();
    expect(a!.ctx).toBe(ctx);
    expect(soundOutput()!.out).toBe(a!.out);
  });

  it("is null with no context", () => {
    setSoundContext(null);
    expect(soundOutput()).toBeNull();
  });
});
