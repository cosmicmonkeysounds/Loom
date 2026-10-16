//! The story clock survives a restart (wave 5, story-clock-restart-lag):
//! idle ticks coalesce in memory up to 15 s, so `dispose` and the server's
//! SIGTERM / SIGINT handler (`flushClock`) journal what is pending.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";

const CODES = { event: "EVT333", prime: "PRM333", mod: "MOD333" };
const SOURCE = "# Clock\nstart: Hall\n\nLOCATION Hall\n\n== Hall\n  setting: Hall\nNarrator: The hall.\n";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const at = (d: string) => new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "clock", scenarioSource: SOURCE, joinBase: () => "http://localhost" });
const ticks = (d: string) => new Store(d).readJournal().filter((l) => l.m === "tick").map((l) => l.a[0]);

describe("flushing the story clock", () => {
  it("dispose journals the idle ticks, so a restore's elapsed matches", () => {
    const d = mkdtempSync(join(tmpdir(), "loom-clock-"));
    dirs.push(d);
    const rt = at(d);
    rt.openDoors();
    for (let i = 0; i < 5; i++) rt.tickOnce(1000);
    const live = rt.liveSim!.elapsed();
    expect(ticks(d)).toEqual([]); // still coalescing
    rt.dispose();
    expect(ticks(d)).toEqual([5000]);
    const again = at(d);
    expect(again.restore()).not.toBeNull();
    expect(again.liveSim!.elapsed()).toBe(live);
    again.dispose();
    expect(ticks(d)).toEqual([5000]); // nothing pending: no extra line
  });

  it("flushClock is flush-only and idempotent: the event stays open, no `ended`", () => {
    const d = mkdtempSync(join(tmpdir(), "loom-clock-"));
    dirs.push(d);
    const rt = at(d);
    rt.openDoors();
    for (let i = 0; i < 3; i++) rt.tickOnce(1000);
    rt.flushClock();
    rt.flushClock();
    expect(ticks(d)).toEqual([3000]);
    expect(rt.currentPhase).toBe("open");
    rt.tickOnce(1000);
    rt.dispose();
    expect(ticks(d)).toEqual([3000, 1000]);
  });
});
