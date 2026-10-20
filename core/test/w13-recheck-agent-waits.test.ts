//! Wave 13 recheck, lane ccore — item 4: a host's `waiting[].since` is the
//! live value after a restart — two lines in one story second keep their own
//! wall times, and a restart inside a pause keeps the whole pause out once
//! it resumes (the hub's `shift`), as it would have live.

import { afterAll, describe, expect, it } from "vitest";
import type { EventRuntime } from "../server/event-runtime.ts";
import { cleanup, freshDir, guest, mod, post, runtime } from "./w13-fix-harness.ts";
import { STORY, waitingOf } from "./w13-recheck-story.ts";

afterAll(cleanup);

describe("4: waiting since, exact across a restart and a pause", () => {
  it("two lines in one story second keep their own wall times; a restart inside a pause keeps the whole pause out", async () => {
    const t0 = 7_000_000;
    let wall = t0;
    const d = freshDir();
    const rt = runtime({ now: () => wall, hostViewMs: 0 }, d, STORY);
    rt.openDoors();
    const a = await guest(rt, "Calculator");
    const b = await guest(rt, "GarageBand");
    expect((await post(rt, "/api/guest/say", { token: a.token, channel: "dm:Trabolta", text: "one" })).status).toBe(200);
    wall = t0 + 400; // the same story second (no tick)
    expect((await post(rt, "/api/guest/say", { token: b.token, channel: "dm:Trabolta", text: "two" })).status).toBe(200);
    const sinceOf = async (r: EventRuntime) => Object.fromEntries((await waitingOf(r)).map((w) => [w.name, w.since]));
    expect(await sinceOf(rt)).toEqual({ Calculator: t0, GarageBand: t0 + 400 });
    wall = t0 + 1_000;
    expect((await mod(rt, "/api/mod/stop")).status).toBe(200);
    rt.dispose();
    // The restart, inside the pause.
    wall = t0 + 8_000;
    const rt2 = runtime({ now: () => wall, hostViewMs: 0 }, d, STORY);
    rt2.restore();
    expect(await sinceOf(rt2)).toEqual({ Calculator: t0, GarageBand: t0 + 400 });
    // The resume shifts the whole pause (t0+1 s → t0+20 s), as it does live.
    wall = t0 + 20_000;
    expect((await mod(rt2, "/api/mod/start")).status).toBe(200);
    expect(await sinceOf(rt2)).toEqual({ Calculator: t0 + 19_000, GarageBand: t0 + 19_400 });
    rt2.dispose();
    // And a running restart after it keeps the shifted waits.
    wall = t0 + 30_000;
    const rt3 = runtime({ now: () => wall, hostViewMs: 0 }, d, STORY);
    rt3.restore();
    expect(await sinceOf(rt3)).toEqual({ Calculator: t0 + 19_000, GarageBand: t0 + 19_400 });
    rt3.dispose();
  });
});
