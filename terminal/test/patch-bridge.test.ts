import { describe, expect, it } from "vitest";
import type { PostOutcome } from "../src/serial/door-bridge.ts";
import type { PatchLine } from "../src/serial/door-protocol.ts";
import { PATCH_RETRY_MS, PATCH_STALE_MS, PatchBridge, pairsOf, patchQuery, patchReport, patchSummary } from "../src/serial/patch-bridge.ts";

// Pair lists made up for the tests: none is a combination the story knows
// (the bridge never knows them either).
const FOUR = "V1-D2,V3-D1,V5-D4,V8-D6";
const OTHER = "V2-D7,V4-D3,V6-D5,V7-D1";

/** The decode a pair list implies (seven inputs). */
function srcOf(pairs: string): number[] {
  const src = new Array<number>(7).fill(0);
  if (pairs !== "") for (const p of pairs.split(",")) src[Number(p.split("-D")[1]) - 1] = Number(p.slice(1, p.indexOf("-")));
  return src;
}

/** A bridge on a fake clock, its posts answered by `answer` (async, like fetch). */
function rig(answer: (combo: string) => PostOutcome = () => "ok") {
  let now = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; off: boolean }> = [];
  const posts: string[] = [];
  const bridge = new PatchBridge({
    now: () => now,
    post: async (combo) => {
      posts.push(combo);
      return answer(combo);
    },
    later: (fn, ms) => {
      const t = { at: now + ms, fn, off: false };
      timers.push(t);
      return () => void (t.off = true);
    },
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const advance = async (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => !x.off && x.at <= now)) {
      t.off = true;
      t.fn();
    }
    await flush();
  };
  let seq = 0;
  const line = (pairs: string, extra: Partial<PatchLine> = {}) => {
    const src = srcOf(pairs);
    const count = src.filter((k) => k > 0).length;
    bridge.line({ t: "patch", seq: seq++, pairs, count, complete: count === 4, raw: src.map((k) => (k > 0 ? 400 * k : 2)), src, stable: true, ...extra });
  };
  return { bridge, posts, advance, flush, line, now: () => now };
}

const LIVE = { server_door: "closed" as const, patch_override: false };

describe("the patch bay bridge (wave 22)", () => {
  it("posts a new complete set of four once, and never its periodic line", async () => {
    const r = rig();
    r.bridge.screen(LIVE);
    r.line("");
    r.line("V1-D2");
    r.line("V1-D2,V3-D1,V5-D4");
    r.line(FOUR);
    r.line(FOUR); // a second later, nothing moved
    r.line(FOUR);
    await r.flush();
    expect(r.posts).toEqual([FOUR]);
  });

  it("pulling a cable and pushing it back is not a second combination", async () => {
    const r = rig();
    r.bridge.screen(LIVE);
    r.line("");
    r.line(FOUR);
    await r.flush();
    r.line("V1-D2,V3-D1,V8-D6");
    r.line(FOUR);
    await r.flush();
    expect(r.posts).toEqual([FOUR]);
    // A different set does count, and then the first one again too.
    r.line(OTHER);
    await r.flush();
    r.line(FOUR);
    await r.flush();
    expect(r.posts).toEqual([FOUR, OTHER, FOUR]);
  });

  it("an incomplete bay is never posted: three, five, or four with an input between levels", async () => {
    const r = rig();
    r.bridge.screen(LIVE);
    r.line("");
    r.line("V1-D2,V3-D1,V5-D4");
    r.line("V1-D2,V2-D7,V3-D1,V5-D4,V8-D6");
    r.line(FOUR, { complete: false, src: [3, 1, 0, 5, -1, 8, 0] });
    r.line(FOUR, { complete: true, count: 3 }); // a count that disagrees: not four
    await r.flush();
    expect(r.posts).toEqual([]);
  });

  it("posts nothing before Power On, and lets go of a bay that settled meanwhile", async () => {
    const r = rig();
    r.line("");
    r.line(FOUR); // no screen poll yet
    r.bridge.screen({ server_door: null, patch_override: null });
    r.line(OTHER); // Power On not played
    r.bridge.screen(LIVE);
    r.line(OTHER); // the periodic line once the gate opens: not a change
    await r.flush();
    expect(r.posts).toEqual([]);
    r.line("V2-D7");
    r.line(OTHER);
    await r.flush();
    expect(r.posts).toEqual([OTHER]);
  });

  it("follows the 🔌 buttons while the story says so, and never replays what came meanwhile", async () => {
    const r = rig();
    r.bridge.screen({ ...LIVE, patch_override: true });
    r.line("");
    r.line(FOUR);
    await r.flush();
    expect(r.posts).toEqual([]);
    r.bridge.screen(LIVE); // 🔌 Trust the patch bay
    r.line(FOUR);
    await r.flush();
    expect(r.posts).toEqual([]);
    r.line(OTHER);
    await r.flush();
    expect(r.posts).toEqual([OTHER]);
  });

  it("the bay as it is when the port (re)connects is only looked at", async () => {
    const r = rig();
    r.bridge.screen(LIVE);
    r.line(FOUR); // the first line since connect: cables already in
    await r.flush();
    expect(r.posts).toEqual([]);
    r.line("");
    r.line(OTHER);
    await r.flush();
    r.bridge.disconnected();
    r.line(FOUR); // a replug with different cables in: still only a look
    await r.flush();
    expect(r.posts).toEqual([OTHER]);
    r.bridge.disconnected();
    r.line("");
    r.line(OTHER); // what it posted before the replug: never twice
    await r.flush();
    expect(r.posts).toEqual([OTHER]);
  });

  it("retries a post lost to the network while the bay holds, never a refused one", async () => {
    let fail = true;
    const r = rig(() => (fail ? "network" : "ok"));
    r.bridge.screen(LIVE);
    r.line("");
    r.line(FOUR);
    await r.flush();
    await r.advance(PATCH_RETRY_MS[0]!);
    expect(r.posts).toEqual([FOUR, FOUR]);
    fail = false;
    await r.advance(PATCH_RETRY_MS[1]!);
    expect(r.posts).toEqual([FOUR, FOUR, FOUR]);
    await r.advance(10_000);
    expect(r.posts).toHaveLength(3);
    r.line(FOUR);
    await r.flush();
    expect(r.posts).toHaveLength(3); // taken: never again

    const refused = rig(() => "refused");
    refused.bridge.screen(LIVE);
    refused.line("");
    refused.line(FOUR);
    await refused.flush();
    await refused.advance(10_000);
    expect(refused.posts).toEqual([FOUR]);
    // The server said no (paused, say): the same cables plugged again count.
    refused.line("V1-D2");
    refused.line(FOUR);
    await refused.flush();
    expect(refused.posts).toEqual([FOUR, FOUR]);
  });

  it("a change while a retry waits cancels it; the new set posts at once", async () => {
    const r = rig((c) => (c === FOUR ? "network" : "ok"));
    r.bridge.screen(LIVE);
    r.line("");
    r.line(FOUR);
    await r.flush();
    r.line("V1-D2,V3-D1,V5-D4"); // a cable out before the retry
    await r.advance(10_000);
    expect(r.posts).toEqual([FOUR]);
    r.line(OTHER);
    await r.flush();
    expect(r.posts).toEqual([FOUR, OTHER]);
    // FOUR never reached the story: plugged again, it is tried again.
    r.line("");
    r.line(FOUR);
    await r.flush();
    expect(r.posts).toEqual([FOUR, OTHER, FOUR]);
  });

  it("gives up after the last retry, and the same cables plugged again are tried again", async () => {
    const r = rig(() => "network");
    r.bridge.screen(LIVE);
    r.line("");
    r.line(FOUR);
    await r.flush();
    for (const ms of PATCH_RETRY_MS) await r.advance(ms);
    await r.advance(10_000);
    expect(r.posts).toHaveLength(1 + PATCH_RETRY_MS.length);
    r.line("");
    r.line(FOUR);
    await r.flush();
    expect(r.posts).toHaveLength(2 + PATCH_RETRY_MS.length);
  });

  it("a set that settles while a post is in flight goes out when it lands", async () => {
    let release: (o: PostOutcome) => void = () => {};
    const posts: string[] = [];
    const bridge = new PatchBridge({
      now: () => 0,
      post: (combo) => {
        posts.push(combo);
        return new Promise((res) => (release = res));
      },
      later: () => () => {},
    });
    const line = (pairs: string) => {
      const src = srcOf(pairs);
      bridge.line({ t: "patch", seq: 0, pairs, count: src.filter((k) => k > 0).length, complete: src.filter((k) => k > 0).length === 4, raw: src, src, stable: true });
    };
    bridge.screen(LIVE);
    line("");
    line(FOUR);
    line("V1-D2");
    line(OTHER);
    expect(posts).toEqual([FOUR]);
    release("ok");
    await new Promise((r) => setTimeout(r, 0));
    expect(posts).toEqual([FOUR, OTHER]);
  });

  it("the heartbeat carries counts only, never the pairs", () => {
    const at = 1000;
    const reading = (pairs: string, src = srcOf(pairs)) => ({ pairs, count: src.filter((k) => k > 0).length, complete: src.filter((k) => k > 0).length === 4, raw: src, src, stable: true, at });
    expect(patchQuery(patchReport({ connected: false, reading: null, now: at }))).toEqual({ pb: "fault", pft: "no_port" });
    expect(patchQuery(patchReport({ connected: true, reading: null, now: at }))).toEqual({ pb: "fault", pft: "stale" });
    expect(patchQuery(patchReport({ connected: true, reading: reading(FOUR), now: at + PATCH_STALE_MS + 1 }))).toEqual({ pb: "fault", pft: "stale" });
    expect(patchQuery(patchReport({ connected: true, reading: reading(""), now: at }))).toEqual({ pb: "0", pbc: "0", pbx: "0" });
    const four = patchQuery(patchReport({ connected: true, reading: reading(FOUR), now: at }));
    expect(four).toEqual({ pb: "4", pbc: "1", pbx: "0" });
    expect(Object.values(four).join(" ")).not.toMatch(/V\d|D\d/u);
    expect(patchQuery(patchReport({ connected: true, reading: { ...reading("V1-D2"), src: [0, 1, -1, 0, 0, 0, 0] }, now: at }))).toEqual({ pb: "1", pbc: "0", pbx: "1" });
    expect(patchQuery(patchReport({ connected: true, reading: { ...reading("V1-D2"), src: [1, 1, 0, 0, 0, 0, 0] }, now: at }))).toEqual({ pb: "fault", pbx: "0", pft: "dup" });
    expect(patchQuery(null)).toEqual({});
  });

  it("names the firmware's canonical pairs and counts a decode", () => {
    expect(pairsOf([3, 1, 0, 5, 0, 8, 0])).toBe(FOUR);
    expect(pairsOf([0, 0, 0, 0, 0, 0, 0])).toBe("");
    expect(pairsOf([2, 0, 2])).toBe("V2-D1,V2-D3");
    expect(patchSummary([3, 1, -1, 5, 0, 1, 0])).toEqual({ count: 4, between: 1, dup: true });
  });
});
