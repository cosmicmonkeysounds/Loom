//! Wave 18 recheck fixes (recheck/fixes.md), the show's side.

import { describe, expect, it, vi } from "vitest";
import { scenarioFiles } from "../examples/load.ts";
import { W18, booth, call, freshDir, guest, guestStream, post, primeStream, rt18, runtime } from "./w18-harness.ts";
import type { PrimeView } from "../server/views.ts";
import { EventRuntime } from "../server/event-runtime.ts";

const FILES = scenarioFiles("trapped-in-the-internet");

describe("N9: a house banner that sends everyone to the Desktop carries the way there", () => {
  it("every such broadcast has `with go: The Desktop`", () => {
    const lines = FILES.flatMap((f) => f.source.split("\n").filter((l) => /^\s*broadcast "!/u.test(l) && /to the Desktop\b/iu.test(l)));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const l of lines) expect(l, l).toMatch(/with go: The Desktop/u);
  });
});

describe("BN2-FC: a caught poster leaves an open Wanted board after its minute", () => {
  it("the booths get a fresh view when the poster lapses, with no other change", async () => {
    const rt = rt18();
    rt.openDoors();
    const ada = await guest(rt, "Ada");
    const norton = (await booth(rt, "Norton")).json.token as string;
    const mcafee = (await booth(rt, "McAfee")).json.token as string;
    await post(rt, "/api/prime/act", { token: norton, name: "mark_program", guest: ada.id });
    await post(rt, "/api/prime/act", { token: norton, name: "send_to_internet", guest: ada.id });
    const s = primeStream(rt, mcafee);
    await s.open;
    const boards = () => (s.res.frames("snapshot") as Array<{ wanted?: Array<{ id: string }> }>).map((v) => (v.wanted ?? []).map((w) => w.id));
    expect(boards().at(-1)).toEqual([ada.id]);
    for (let i = 0; i < 62; i++) rt.tickOnce(1000);
    expect(boards().at(-1)).toEqual([]);
  });
});

describe("BN2-FH: a phone whose stream stays open is not missing", () => {
  it("the keepalive re-stamps lastSeen (coarsely) while the stream is open", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let t = 1_000_000;
      const rt = runtime({ now: () => t }, freshDir(), W18);
      rt.openDoors();
      const ada = await guest(rt, "Ada");
      const s = guestStream(rt, ada.token);
      await s.open;
      const seen = async () => ((await call(rt, "GET", "/api/state?role=prime&as=Norton", {}, { moderator: true })).json as unknown as PrimeView).guests.find((g) => g.id === ada.id)?.lastSeen;
      const opened = await seen();
      t += 12 * 60_000;
      vi.advanceTimersByTime(25_000);
      expect(await seen()).toBe(t);
      expect(t - (opened ?? 0)).toBeGreaterThan(EventRuntime.STREAM_SEEN_EVERY_MS);
      // Coarse: a minute later the next ping leaves it be.
      const at = t;
      t += 60_000;
      vi.advanceTimersByTime(25_000);
      expect(await seen()).toBe(at);
    } finally {
      vi.useRealTimers();
    }
  });
});
