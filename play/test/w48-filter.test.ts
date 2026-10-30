// Wave 48 (C5, docs/loom-w48-contract.md): the Password Manager's filter,
// the pure rules (`booth/filter/model.ts`): which lines wait, which one
// pops (once, one at a time), the memory, the highlight, the pop-out's
// draft, a ✂ refusal — and a whole run of snapshots through the real
// pop-out reducer, the way the booth's driver feeds it.
import { describe, expect, it } from "vitest";

import { memoryStore, type SessionStorage } from "../src/host.ts";
import { EMPTY_POPOUTS, currentOf, popReducer, type PopOutSpec, type PopState } from "../src/moments/popout-model.ts";
import {
  EMPTY_FILTER_MEMORY,
  FILTER_COPY,
  FILTER_MEMORY_MAX,
  FILTER_PRIORITY,
  agoText,
  capSeqs,
  censorRefusal,
  clipLine,
  filterDraft,
  filterHeader,
  filterOf,
  filterPlan,
  filterPopKey,
  filterPopSeq,
  filterStoreKey,
  tierRanges,
  loadFilterMemory,
  markSegments,
  parseFilterMemory,
  pruneDropped,
  remember,
  saveFilterMemory,
  waitingLines,
  whereLine,
  type FilterMemory,
} from "../src/booth/filter/model.ts";
import type { FilterLine, FilterView, PrimeView } from "../src/types.ts";

/** A flagged line: "my password is hello" flags "ass" and "hell". */
const L = (seq: number, extra: Partial<FilterLine> = {}): FilterLine => ({
  seq,
  guest: `g-${seq}`,
  name: `Program ${seq}`,
  where: "# lobby",
  text: "my password is hello",
  hits: [
    { start: 4, end: 7 },
    { start: 15, end: 19 },
  ],
  words: ["password", "hello"],
  ts: seq * 1000,
  ...extra,
});
const V = (lines: FilterLine[], extra: Partial<FilterView> = {}): FilterView => ({ flagged: lines.length * 2, censored: 0, lines, ...extra });
const marked = (parts: Array<{ text: string; mark?: boolean }>) => parts.filter((p) => p.mark === true).map((p) => p.text);

describe("which lines wait on this phone", () => {
  it("every line in filter.lines, oldest first, unique; not those let go here, nor those censored here (dropped)", () => {
    const view = V([L(3), L(1), L(2), L(1)]);
    expect(waitingLines(view, EMPTY_FILTER_MEMORY).map((l) => l.seq)).toEqual([1, 2, 3]);
    expect(waitingLines(view, { seen: [1, 2, 3], let: [2] }).map((l) => l.seq)).toEqual([1, 3]);
    expect(waitingLines(view, EMPTY_FILTER_MEMORY, new Set([3])).map((l) => l.seq)).toEqual([1, 2]);
    expect(waitingLines(null, EMPTY_FILTER_MEMORY)).toEqual([]);
  });

  it("filterOf reads PrimeView.filter, and nothing from an older server or a broken shape", () => {
    expect(filterOf({ filter: V([L(1)]) } as unknown as PrimeView)?.lines.length).toBe(1);
    expect(filterOf({} as PrimeView)).toBeNull();
    expect(filterOf(null)).toBeNull();
    expect(filterOf({ filter: { flagged: 1, censored: 0 } } as unknown as PrimeView)).toBeNull();
  });

  it("a local drop is forgotten once the view no longer lists the line", () => {
    const dropped = new Set([1, 2]);
    pruneDropped(dropped, [L(2), L(3)]);
    expect([...dropped]).toEqual([2]);
  });

  it("the count and the header", () => {
    expect(filterHeader({ flagged: 12, censored: 3 })).toBe("Censored 3 of 12 flagged words");
    expect(filterHeader({ flagged: 1, censored: 0 })).toBe("Censored 0 of 1 flagged word");
    expect(filterHeader(null)).toBe("Censored 0 of 0 flagged words");
  });
});

describe("what pops (filterPlan)", () => {
  it("a new line pops once: the next snapshot with it seen raises nothing", () => {
    const first = filterPlan([L(1)], [], []);
    expect(first.raise?.seq).toBe(1);
    expect(first.seen).toEqual([1]);
    const again = filterPlan([L(1)], first.seen, []);
    expect(again.raise).toBeNull();
    expect(again.seen).toEqual([]);
  });

  it("nothing pops while a filter pop-out is up or held: the new lines only count (seen), the held one refreshes", () => {
    const p = filterPlan([L(1), L(2), L(3)], [1], [filterPopKey(1)]);
    expect(p.raise).toBeNull();
    expect(p.seen).toEqual([2, 3]);
    expect(p.refresh.map((l) => l.seq)).toEqual([1]);
    expect(p.retire).toEqual([]);
    // Once it is handled, a line that came meanwhile never pops: only a newer one.
    expect(filterPlan([L(2), L(3)], [1, 2, 3], []).raise).toBeNull();
    expect(filterPlan([L(2), L(3), L(4)], [1, 2, 3], []).raise?.seq).toBe(4);
  });

  it("one put off with Later never blocks: a new line pops and retires it (Waiting keeps one 🔑 at most)", () => {
    const later = new Set([filterPopKey(1)]);
    const p = filterPlan([L(1), L(2)], [1], [filterPopKey(1)], { deferred: later });
    expect(p.raise?.seq).toBe(2);
    expect(p.retire).toEqual(["filter:1"]);
    expect(p.refresh).toEqual([]);
    // With nothing new, the one in Waiting just refreshes.
    const q = filterPlan([L(1), L(2)], [1, 2], [filterPopKey(1)], { deferred: later });
    expect(q.raise).toBeNull();
    expect(q.refresh.map((l) => l.seq)).toEqual([1]);
    expect(q.retire).toEqual([]);
  });

  it("of several new lines at once, the newest pops; every one is seen", () => {
    const p = filterPlan([L(1), L(2), L(3)], [], []);
    expect(p.raise?.seq).toBe(3);
    expect(p.seen).toEqual([1, 2, 3]);
  });

  it("a held pop-out whose line left the list retires, and a new line may pop in the same pass", () => {
    const p = filterPlan([L(2)], [1], [filterPopKey(1), "wanted:g-1"]);
    expect(p.retire).toEqual(["filter:1"]);
    expect(p.raise?.seq).toBe(2);
  });

  it("the open window owns every line: held pop-outs retire, new lines only count", () => {
    const p = filterPlan([L(1), L(2)], [1], [filterPopKey(1)], { windowOpen: true });
    expect(p.retire).toEqual(["filter:1"]);
    expect(p.refresh).toEqual([]);
    expect(p.raise).toBeNull();
    expect(p.seen).toEqual([2]);
  });

  it("keys: filter:<seq>, and nothing else reads as one", () => {
    expect(filterPopKey(42)).toBe("filter:42");
    expect(filterPopSeq("filter:42")).toBe(42);
    expect(filterPopSeq("wanted:g-1")).toBeNull();
    expect(filterPopSeq("filter:x")).toBeNull();
  });
});

describe("this phone's memory (loom.booth.filter.<token>)", () => {
  it("lives under the token's key, round-trips, and a blocked store never throws", () => {
    expect(filterStoreKey("tok")).toBe("loom.booth.filter.tok");
    const store = memoryStore();
    const m: FilterMemory = { seen: [1, 2], let: [2] };
    saveFilterMemory(store, "tok", m);
    expect(store.load(filterStoreKey("tok"))).toEqual(m);
    expect(loadFilterMemory(store, "tok")).toEqual(m);
    expect(loadFilterMemory(store, "other")).toEqual(EMPTY_FILTER_MEMORY);
    const blocked: SessionStorage = {
      load: () => {
        throw new Error("blocked");
      },
      save: () => {
        throw new Error("blocked");
      },
      drop: () => {},
    };
    expect(loadFilterMemory(blocked, "tok")).toEqual(EMPTY_FILTER_MEMORY);
    expect(() => saveFilterMemory(blocked, "tok", m)).not.toThrow();
  });

  it("parses defensively: junk becomes empty sets, non-integers drop", () => {
    expect(parseFilterMemory(null)).toEqual(EMPTY_FILTER_MEMORY);
    expect(parseFilterMemory("x")).toEqual(EMPTY_FILTER_MEMORY);
    expect(parseFilterMemory({ seen: [1, "2", 3.5, null, 4], let: "no" })).toEqual({ seen: [1, 4], let: [] });
  });

  it("remember adds once and keeps the same object when nothing is new", () => {
    const m = remember(EMPTY_FILTER_MEMORY, "seen", [1, 2]);
    expect(m.seen).toEqual([1, 2]);
    expect(remember(m, "seen", [2, 1])).toBe(m);
    expect(remember(m, "let", [2])).toEqual({ seen: [1, 2], let: [2] });
  });

  it("each set is capped (newest kept), so it cannot grow all night", () => {
    const many = Array.from({ length: FILTER_MEMORY_MAX + 50 }, (_, i) => i + 1);
    const capped = capSeqs(many);
    expect(capped.length).toBe(FILTER_MEMORY_MAX);
    expect(capped[0]).toBe(51);
    expect(capped[capped.length - 1]).toBe(FILTER_MEMORY_MAX + 50);
    let m = EMPTY_FILTER_MEMORY;
    for (const n of many) m = remember(m, "let", [n]);
    expect(m.let.length).toBe(FILTER_MEMORY_MAX);
    expect(parseFilterMemory({ seen: many, let: [] }).seen.length).toBe(FILTER_MEMORY_MAX);
    expect(capSeqs([1, 2, 1, 3])).toEqual([2, 1, 3]);
  });
});

describe("the highlight (markSegments)", () => {
  const join = (parts: Array<{ text: string }>) => parts.map((p) => p.text).join("");

  it("marks each stem, keeps every character", () => {
    const parts = markSegments("my password is hello", L(1).hits);
    expect(marked(parts)).toEqual(["ass", "hell"]);
    expect(join(parts)).toBe("my password is hello");
    expect(markSegments("", [{ start: 0, end: 1 }])).toEqual([]);
    expect(markSegments("clean", [])).toEqual([{ text: "clean" }]);
  });

  it("overlapping, touching and duplicate ranges merge into one mark", () => {
    expect(marked(markSegments("asshell", [{ start: 0, end: 3 }, { start: 3, end: 7 }]))).toEqual(["asshell"]);
    expect(marked(markSegments("bastard", [{ start: 1, end: 3 }, { start: 0, end: 4 }, { start: 1, end: 3 }]))).toEqual(["bast"]);
    expect(tierRanges("abcdefgh", [{ start: 5, end: 7 }, { start: 1, end: 3 }, { start: 2, end: 6 }])).toEqual([{ start: 1, end: 7, tier: null }]);
  });

  it("bad offsets never throw and never lose text: clamped, dropped when empty or junk", () => {
    const text = "heck";
    const bad = [{ start: -5, end: 2 }, { start: 3, end: 99 }, { start: 3, end: 1 }, { start: Number.NaN, end: 2 }, { start: 1 }, null, "x", { start: Infinity, end: 4 }];
    const parts = markSegments(text, bad);
    expect(join(parts)).toBe(text);
    // [-5, 2) clamps to "he", [3, 99) to "k"; the rest are junk.
    expect(marked(parts)).toEqual(["he", "k"]);
    // A fractional offset widens to whole characters.
    expect(marked(markSegments(text, [{ start: 1.2, end: 1.8 }]))).toEqual(["e"]);
    expect(markSegments(text, "not an array")).toEqual([{ text }]);
    expect(markSegments(text, [{ start: 10, end: 20 }])).toEqual([{ text }]);
  });

  it("never splits an emoji (a surrogate pair) at a bad offset", () => {
    const text = "a😀ss";
    // 😀 is two UTF-16 units at 1..3; offsets inside it widen to the whole character.
    const parts = markSegments(text, [{ start: 2, end: 4 }]);
    expect(join(parts)).toBe(text);
    expect(marked(parts)).toEqual(["😀s"]);
  });

  it("a long line is cut around its first stem, with … where cut, its marks moved with it", () => {
    const pad = "x".repeat(400);
    const text = `${pad} you donkey's ass ${pad}`;
    const at = text.indexOf("ass");
    const clip = clipLine(text, [{ start: at, end: at + 3 }], 120);
    expect(clip.text.length).toBeLessThanOrEqual(122);
    expect(clip.text.startsWith("…")).toBe(true);
    expect(clip.text.endsWith("…")).toBe(true);
    expect(marked(markSegments(clip.text, clip.hits))).toEqual(["ass"]);
    // Short lines stay whole.
    expect(clipLine("hello", [{ start: 0, end: 4 }], 120)).toEqual({ text: "hello", hits: [{ start: 0, end: 4 }] });
  });
});

describe("the 🔑 LANGUAGE pop-out (filterDraft)", () => {
  it("picture + name, where, the line with each stem marked, ✂ Censor arms, Let it go, Later by the shell", () => {
    const d = filterDraft(L(7, { name: "Napster", where: "# lobby", avatar: "napster" }), 1);
    expect(d.key).toBe("filter:7");
    expect(d.glyph).toBe("🔑");
    expect(d.title).toBe("LANGUAGE");
    expect(d.guest).toEqual({ id: "g-7", name: "Napster", avatar: "napster", seen: "in # lobby" });
    expect(marked(d.quote ?? [])).toEqual(["ass", "hell"]);
    expect(d.actions.map((a) => a.label)).toEqual(["✂ Censor", "Let it go"]);
    expect(d.actions[0]).toMatchObject({ kind: "primary", arm: true, do: { kind: "censor", seq: 7 } });
    expect(d.actions[1]!.do).toEqual({ kind: "letGo", seq: 7 });
    expect(d.noLater).toBeUndefined();
    expect(d.status).toBe(FILTER_COPY.hint);
  });

  it("🔑 All flagged (n) only when more wait", () => {
    const d = filterDraft(L(7), 5);
    expect(d.actions.map((a) => a.label)).toEqual(["✂ Censor", "Let it go", "🔑 All flagged (5)"]);
    expect(d.actions[2]!.do).toEqual({ kind: "filter" });
  });

  it("calm: info, below the rest, gives way to anything that outranks it, not kept across a reload", () => {
    const d = filterDraft(L(1), 1);
    expect(d.tone).toBe("info");
    expect(d.priority).toBe(FILTER_PRIORITY);
    expect(d.priority).toBeLessThan(40);
    expect(d.yields).toBe(true);
    expect(d.sticky).toBe(false);
  });

  it("a refusal stands on its status line; a nameless program reads as its id", () => {
    expect(filterDraft(L(1), 1, "Not censored: the doors are closed.").status).toBe("Not censored: the doors are closed.");
    expect(filterDraft(L(1, { name: " " }), 1).guest?.name).toBe("g-1");
  });

  it("where reads as said: in a room, to someone, a DM", () => {
    expect(whereLine("# lobby")).toBe("in # lobby");
    expect(whereLine("The Desktop")).toBe("in The Desktop");
    expect(whereLine("DM to Trabolta")).toBe("DM to Trabolta");
    expect(whereLine("to Microsoft Excel")).toBe("to Microsoft Excel");
    expect(whereLine("")).toBeNull();
    expect(agoText(1000, 30_000)).toBe("just now");
    expect(agoText(0, 4 * 60_000 + 5)).toBe("4 min ago");
  });
});

describe("a ✂ refusal (censorRefusal)", () => {
  const err = (status: number, message: string) => Object.assign(new Error(message), { name: "ApiError", status });
  it("409 already censored drops quietly; every other refusal is said in plain words", () => {
    expect(censorRefusal(err(409, "already censored"))).toEqual({ kind: "gone" });
    expect(censorRefusal(err(409, "doors are closed"))).toEqual({ kind: "refused", text: "Not censored: the doors are closed." });
    expect(censorRefusal(err(404, "not flagged"))).toEqual({ kind: "refused", text: "Not censored: that line isn't flagged any more." });
    expect(censorRefusal(err(403, "not the censor"))).toEqual({ kind: "refused", text: "Not censored: this part isn't the censor tonight." });
    expect(censorRefusal(Object.assign(new Error("no answer in 15s"), { name: "RequestTimeout" }))).toEqual({ kind: "refused", text: "No answer. Try again." });
    expect(censorRefusal(new TypeError("Failed to fetch"))).toEqual({ kind: "refused", text: "No connection. Try again." });
    expect(censorRefusal(err(500, "boom"))).toEqual({ kind: "refused", text: "Not censored: boom" });
    expect(censorRefusal(err(502, ""))).toEqual({ kind: "refused", text: "Not censored: HTTP 502" });
  });
});

/**
 * The driver's loop without React: each snapshot runs `filterPlan` against
 * the store's held keys and raises / retires through the real reducer,
 * exactly as `use-booth-popouts.ts` does.
 */
function simulate() {
  let state: PopState = EMPTY_POPOUTS;
  let memory: FilterMemory = EMPTY_FILTER_MEMORY;
  const dropped = new Set<number>();
  const raise = (spec: PopOutSpec) => (state = popReducer(state, { type: "raise", spec, at: 0 }));
  const bound = (d: ReturnType<typeof filterDraft>): PopOutSpec => ({ ...d, actions: d.actions.map((a) => ({ ...a, run: () => {} })) });
  return {
    snapshot(lines: FilterLine[], windowOpen = false) {
      const view = V(lines);
      pruneDropped(dropped, view.lines);
      const waiting = waitingLines(view, memory, dropped);
      const held = [...state.live, ...state.tray].map((e) => e.spec.key);
      const plan = filterPlan(waiting, memory.seen, held, { windowOpen });
      memory = remember(memory, "seen", plan.seen);
      for (const k of plan.retire) state = popReducer(state, { type: "retire", key: k });
      for (const l of plan.refresh) raise(bound(filterDraft(l, waiting.length)));
      if (plan.raise !== null) raise(bound(filterDraft(plan.raise, waiting.length)));
      return waiting.length;
    },
    later: (key: string) => (state = popReducer(state, { type: "defer", key, at: 0 })),
    handled: (key: string) => (state = popReducer(state, { type: "retire", key })),
    letGo: (seq: number) => (memory = remember(remember(memory, "seen", [seq]), "let", [seq])),
    censored: (seq: number) => dropped.add(seq),
    get onScreen() {
      return currentOf(state)?.spec ?? null;
    },
    get tray() {
      return state.tray.map((e) => e.spec.key);
    },
    get keys() {
      return [...state.live, ...state.tray].map((e) => e.spec.key);
    },
  };
}

describe("a flood, snapshot by snapshot (the driver's loop over the real reducer)", () => {
  it("one pop-out at a time; the rest count; Later holds the next back; judged lines retire it", () => {
    const d = simulate();
    expect(d.snapshot([L(1)])).toBe(1);
    expect(d.onScreen?.key).toBe("filter:1");
    expect(d.onScreen?.actions.map((a) => a.label)).toEqual(["✂ Censor", "Let it go"]);

    // Two more while it is up: nothing new pops; its button counts them.
    expect(d.snapshot([L(1), L(2), L(3)])).toBe(3);
    expect(d.keys).toEqual(["filter:1"]);
    expect(d.onScreen?.actions.map((a) => a.label)).toContain("🔑 All flagged (3)");

    // Later: it waits in 🔔 Waiting, and still holds the next one back.
    d.later("filter:1");
    expect(d.onScreen).toBeNull();
    d.snapshot([L(1), L(2), L(3), L(4)]);
    expect(d.keys).toEqual(["filter:1"]);
    expect(d.tray).toEqual(["filter:1"]);

    // Let it go (from the window): its pop-out retires, and nothing that came meanwhile pops.
    d.letGo(1);
    expect(d.snapshot([L(1), L(2), L(3), L(4)])).toBe(3);
    expect(d.keys).toEqual([]);

    // A newer line pops again.
    d.snapshot([L(1), L(2), L(3), L(4), L(5)]);
    expect(d.onScreen?.key).toBe("filter:5");

    // ✂ answered 200: the line leaves at once (dropped) and its pop-out retires, before the view catches up.
    d.handled("filter:5");
    d.censored(5);
    expect(d.snapshot([L(1), L(2), L(3), L(4), L(5)])).toBe(3);
    expect(d.keys).toEqual([]);
    // The view caught up (5 censored, gone): nothing pops again for it.
    expect(d.snapshot([L(1), L(2), L(3), L(4)])).toBe(3);
    expect(d.keys).toEqual([]);
  });

  it("the window open: held ones retire, new lines only count, and nothing pops after it closes for them", () => {
    const d = simulate();
    d.snapshot([L(1)]);
    d.snapshot([L(1), L(2)], true);
    expect(d.keys).toEqual([]);
    d.snapshot([L(1), L(2)]);
    expect(d.keys).toEqual([]);
    d.snapshot([L(1), L(2), L(3)]);
    expect(d.onScreen?.key).toBe("filter:3");
  });
});
