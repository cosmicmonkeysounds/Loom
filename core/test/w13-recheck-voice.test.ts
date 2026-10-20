//! Wave 13 recheck, lane ccore — item 8: the TV-voice mute (and identify)
//! drop the host panel's cached build, so the toggle's re-poll right after
//! the write reads the new state inside the 2 s coalescing window.

import { afterAll, describe, expect, it } from "vitest";
import { cleanup, freshDir, mod, runtime } from "./w13-fix-harness.ts";
import { STORY, hostRead } from "./w13-recheck-story.ts";

afterAll(cleanup);

describe("8: the TV-voice mute on the host panel", () => {
  it("the next poll after the write reads the new state, inside the coalescing window", async () => {
    const realNow = Date.now;
    const now = 9_000_000;
    Date.now = () => now; // the 2 s window never runs out
    try {
      const rt = runtime({}, freshDir(), STORY);
      rt.openDoors();
      expect((await hostRead(rt)).terminals?.voiceMuted).toBe(false);
      const r = await mod(rt, "/api/mod/screen/voice", { muted: true });
      expect(r.json).toEqual({ muted: true });
      expect((await hostRead(rt)).terminals?.voiceMuted).toBe(true);
      await mod(rt, "/api/mod/screen/voice", { muted: false });
      expect((await hostRead(rt)).terminals?.voiceMuted).toBe(false);
      rt.dispose();
    } finally {
      Date.now = realNow;
    }
  });
});
