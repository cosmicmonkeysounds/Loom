//! Wave 13 Stage A: `createCrawl` moved out of `host.ts` into `crawl.ts`
//! and grew the v2 seams. Until the stream lane implements them, it must
//! behave exactly like the old one — the reference below is the
//! pre-wave-13 body, verbatim — and the new methods must do nothing.

import { describe, expect, it } from "vitest";
import { createCrawl } from "../src/crawl.ts";
import { createCrawl as fromHost } from "../src/host.ts";
import type { ChatMessage } from "../src/types.ts";

function legacyCrawl() {
  let baseline = Number.MAX_SAFE_INTEGER;
  const done = new Set<number>();
  let active: number | null = null;
  let queue: Array<{ seq: number; go: () => void }> = [];
  const pump = () => {
    if (active !== null || queue.length === 0) return;
    queue.sort((a, b) => a.seq - b.seq);
    const next = queue.shift()!;
    active = next.seq;
    next.go();
  };
  return {
    reset() {
      baseline = Number.MAX_SAFE_INTEGER;
      done.clear();
      active = null;
      queue = [];
    },
    loaded(maxSeq: number) {
      baseline = maxSeq;
    },
    claim(seq: number) {
      if (seq <= baseline || done.has(seq)) return false;
      done.add(seq);
      return true;
    },
    start(seq: number, go: () => void) {
      queue.push({ seq, go });
      pump();
    },
    finish(seq: number) {
      if (active === seq) active = null;
      else queue = queue.filter((q) => q.seq !== seq);
      pump();
    },
  };
}

type Step = ["reset"] | ["loaded", number] | ["claim", number] | ["start", number] | ["finish", number];

/** Run a script against a crawl; the trace is every claim answer and every `go`. */
function trace(c: ReturnType<typeof legacyCrawl>, steps: Step[]): string[] {
  const out: string[] = [];
  for (const s of steps) {
    if (s[0] === "reset") c.reset();
    else if (s[0] === "loaded") c.loaded(s[1]);
    else if (s[0] === "claim") out.push(`claim ${s[1]} ${c.claim(s[1])}`);
    else if (s[0] === "start") {
      const seq = s[1];
      c.start(seq, () => out.push(`go ${seq}`));
    } else c.finish(s[1]);
  }
  return out;
}

/** A deterministic pseudo-random script (no Math.random: reproducible). */
function script(seed: number, n: number): Step[] {
  let x = seed;
  const next = () => (x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const steps: Step[] = [];
  for (let i = 0; i < n; i++) {
    const r = next();
    const seq = Math.floor(next() * 12);
    if (r < 0.04) steps.push(["reset"]);
    else if (r < 0.1) steps.push(["loaded", seq]);
    else if (r < 0.45) steps.push(["claim", seq]);
    else if (r < 0.75) steps.push(["start", seq]);
    else steps.push(["finish", seq]);
  }
  return steps;
}

describe("the crawl, moved", () => {
  it("is the one host.ts re-exports", () => {
    expect(fromHost).toBe(createCrawl);
  });

  it("claims, queues and releases exactly as before", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const steps = script(seed, 120);
      expect(trace(createCrawl(), steps), `seed ${seed}`).toEqual(trace(legacyCrawl(), steps));
    }
  });

  it("the backlog never crawls; a line crawls once; lines go one at a time in seq order", () => {
    const steps: Step[] = [["loaded", 5], ["claim", 5], ["claim", 6], ["claim", 6], ["start", 8], ["start", 7], ["finish", 8], ["finish", 7]];
    expect(trace(createCrawl(), steps)).toEqual(["claim 5 false", "claim 6 true", "claim 6 false", "go 8", "go 7"]);
  });

  it("the v2 seams do nothing yet; tierOf reads what claim would answer", () => {
    const c = createCrawl({ watchVisibility: true });
    const m = { seq: 9, channel: "lobby" } as ChatMessage;
    c.loaded(5);
    c.setOpen("lobby");
    c.arrived(m, { id: "g1", name: "Ada" });
    c.flush();
    c.flush("lobby");
    const off = c.subscribe(() => {
      throw new Error("never notified in Stage A");
    });
    off();
    expect(c.tierOf(4)).toBe("none");
    expect(c.tierOf(9)).toBe("fast");
    expect(c.tierOf(9)).toBe("fast"); // a pure read: nothing claimed
    expect(c.claim(9)).toBe(true);
    expect(c.tierOf(9)).toBe("none");
    c.setOpen(null);
  });
});
