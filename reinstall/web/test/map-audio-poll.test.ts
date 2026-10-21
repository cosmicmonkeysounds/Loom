import { describe, expect, it } from "vitest";
import { defaultAudio } from "@loom/house";
import type { AudioFetch, AudioView } from "../src/map/audio-api.ts";
import { runAudioPoll } from "../src/map/audio-poll.ts";

const view = (version: string, tests: AudioView["tests"] = []): AudioView => ({ audio: defaultAudio(), version, source: "director", sounds: [], locations: [], tests, problems: [], warnings: [] });

/**
 * A server that answers like the real one: a GET with `after` equal to its
 * version waits (here: the poll ends the test), one with a different
 * `after` answers at once.
 */
function server(versions: () => string) {
  const asks: { after?: string; tests?: number; wait?: number }[] = [];
  const fetch = async (q: { after?: string; tests?: number; wait?: number }): Promise<AudioFetch> => {
    asks.push(q);
    return { kind: "ok", view: view(versions()) };
  };
  return { asks, fetch };
}

describe("the speaker long poll", () => {
  it("asks after the newest version the server reported, even when the page declined it (no spin)", async () => {
    let v = "v1";
    const s = server(() => v);
    const sleeps: number[] = [];
    let held = "";
    await runAudioPoll({
      fetch: async (q) => {
        // The real server holds a poll whose `after` is current: stop there.
        if (q.after !== undefined && q.after === v) {
          s.asks.push(q);
          return { kind: "error", status: 401, error: "held (test end)" };
        }
        return s.fetch(q);
      },
      onView: (x) => {
        // The page adopts v1, then has speaker edits when v2 (another director's save) lands.
        if (held === "") {
          held = x.version;
          v = "v2";
          return true;
        }
        return false;
      },
      onMissing: () => {},
      onError: () => {},
      testSeq: () => 0,
      stopped: () => s.asks.length > 10,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(held).toBe("v1");
    expect(s.asks.map((q) => q.after ?? null)).toEqual([null, "v1", "v2"]);
    // The answer the page declined waited before the next ask.
    expect(sleeps).toEqual([1000]);
  });

  it("pauses after an answer that changed nothing, never after one it took", async () => {
    let n = 0;
    const sleeps: number[] = [];
    await runAudioPoll({
      fetch: async () => {
        n++;
        return { kind: "ok", view: view("v1", n === 3 ? [{ seq: 1, at: 0, speaker: "a", out: null }] : []) };
      },
      onView: (x) => x.tests.length > 0 || n === 1,
      onMissing: () => {},
      onError: () => {},
      testSeq: () => 0,
      stopped: () => n >= 5,
      sleep: async (ms) => void sleeps.push(ms),
      idleMs: 750,
    });
    // n=1 took (the load), n=2 changed nothing, n=3 took a test, n=4 changed nothing (n=5 stops).
    expect(sleeps).toEqual([750, 750]);
  });

  it("sends the tests seq and wait on every long poll; backs off when away; ends on a refusal or no routes", async () => {
    const asks: unknown[] = [];
    const sleeps: number[] = [];
    let n = 0;
    let missing = false;
    await runAudioPoll({
      fetch: async (q) => {
        asks.push(q);
        n++;
        if (n === 1) return { kind: "ok", view: view("v1") };
        if (n <= 3) return { kind: "error", status: null, error: "offline" };
        return { kind: "missing" };
      },
      onView: () => true,
      onMissing: () => {
        missing = true;
      },
      onError: () => {},
      testSeq: () => 7,
      stopped: () => false,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(asks).toEqual([{}, { after: "v1", tests: 7, wait: 25 }, { after: "v1", tests: 7, wait: 25 }, { after: "v1", tests: 7, wait: 25 }]);
    expect(sleeps).toEqual([1000, 2000]);
    expect(missing).toBe(true);
    let calls = 0;
    await runAudioPoll({
      fetch: async () => {
        calls++;
        return { kind: "error", status: 403, error: "no" };
      },
      onView: () => true,
      onMissing: () => {},
      onError: () => {},
      testSeq: () => 0,
      stopped: () => false,
      sleep: async () => {},
    });
    expect(calls).toBe(1);
  });
});
