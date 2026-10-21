import { describe, expect, it } from "vitest";
import { MYSTIFY_TRAIL, mystifyInit, mystifyStep } from "../src/attract.ts";
import { FACE_TIPS, IDLE_ADS } from "../src/idle-show/ads.ts";
import { ATTENTION_EVERY_MS, ATTENTION_IDLE_MS, ATTENTION_SHOW_MS, THANKS, adGag, attentionOn, duckLane, gagText, ringsAt } from "../src/idle-show/gags.ts";
import { PHASE_POOLS, eligible, fillCopy, idleContextOf, phasePool, y2kLeftAt, type IdleContext, type PhasePool } from "../src/idle-show/pools.ts";
import { screenLayers } from "../src/slides.ts";
import { CONFIRM_TEXT, DODGED_TITLE, POPUP_KINDS } from "../src/idle-show/popups.ts";
import { drawAt, hash32, permutation, mulberry32 } from "../src/idle-show/rng.ts";
import { AD_FOCUS_EVERY, LAYOUT_MS, PATTERN, POPUP_FOCUS_EVERY, SEGMENT_MAX_MS, adAt, adPool, drawFocused, popupAt, advance, loadCursor, popupPool, resumeCursor, saveCursor, segmentAt, startIndex, type Segment } from "../src/idle-show/schedule.ts";
import { SAVERS, SAVER_IDS } from "../src/idle-show/savers/index.ts";
import { LOGO_SUB, LOGO_TEXT } from "../src/idle-show/savers/fun.ts";
import { SCAN_COPY } from "../src/idle-show/scan-copy.ts";
import type { ScreenState } from "../src/screen.ts";
import { parseScreenState } from "../src/screen.ts";

const FORBIDDEN = /trabolta|alexa|kernel/iu;

function ctxOf(pool: PhasePool, o: Partial<IdleContext> = {}): IdleContext {
  return { pool, phase: "", names: false, character: "Trabolta", target: "wall", scan: true, face: true, y2kLeft: 600, ...o };
}

/** Every context a screen that may not name him can be in. */
function quietContexts(): IdleContext[] {
  const out: IdleContext[] = [];
  for (const pool of PHASE_POOLS)
    for (const target of ["tv", "wall"] as const)
      for (const scan of [true, false])
        for (const phase of ["", "bingo", "trust_chart", "beans", "truth_pong", "overshare", "majority"]) out.push(ctxOf(pool, { target, scan, phase }));
  return out;
}

function state(over: Partial<ScreenState> & { phase?: string } = {}): ScreenState {
  const s = parseScreenState({ attract: false, now: 1, character: { id: "Trabolta", hidden: false, awake: true }, night: { phase: over.phase ?? "hunt_1" } }, 1)!;
  return { ...s, ...over };
}

describe("the idle show's copy", () => {
  it("has the volume: 30+ ads all night, 25+ popup kinds, 8+ screensavers", () => {
    expect(IDLE_ADS.filter((a) => a.pools === undefined && a.names !== true).length).toBeGreaterThanOrEqual(30);
    expect(POPUP_KINDS.length).toBeGreaterThanOrEqual(25);
    expect(SAVERS.length).toBeGreaterThanOrEqual(8);
    expect(SAVER_IDS).toContain("mystify");
    expect(SAVERS.map((s) => s.id)).toEqual(SAVER_IDS);
    for (const pool of PHASE_POOLS) expect(adPool(ctxOf(pool)).length).toBeGreaterThanOrEqual(30);
  });

  it("never names the character on a screen that may not (every asleep-pool string, filled)", () => {
    for (const ctx of quietContexts()) {
      for (const a of adPool(ctx)) for (const t of [a.id, a.kicker ?? "", a.title, a.body, a.button]) expect(fillCopy(t, ctx)).not.toMatch(FORBIDDEN);
      for (const p of popupPool(ctx)) for (const t of [p.id, p.title, p.text, ...p.buttons.map((b) => b.label)]) expect(fillCopy(t, ctx)).not.toMatch(FORBIDDEN);
    }
    // And nothing anywhere names him outright: his own copy says {character}.
    for (const a of IDLE_ADS) expect(`${a.id} ${a.kicker ?? ""} ${a.title} ${a.body} ${a.button}`).not.toMatch(FORBIDDEN);
    for (const p of POPUP_KINDS) expect(`${p.id} ${p.title} ${p.text} ${p.buttons.map((b) => b.label).join(" ")}`).not.toMatch(FORBIDDEN);
    for (const t of [...FACE_TIPS, LOGO_TEXT, LOGO_SUB, CONFIRM_TEXT, DODGED_TITLE, ...THANKS, ...SAVERS.map((s) => s.name), ...Object.values(SCAN_COPY)]) expect(t).not.toMatch(FORBIDDEN);
    for (const g of ["loading", "shake", "won", "popup", "coin", "error"] as const) expect(gagText(g) ?? "").not.toMatch(FORBIDDEN);
  });

  it("puts {character} only in his own copy, which plays only where it may", () => {
    for (const item of [...IDLE_ADS.map((a) => ({ names: a.names, text: `${a.kicker ?? ""} ${a.title} ${a.body} ${a.button}` })), ...POPUP_KINDS.map((p) => ({ names: p.names, text: `${p.title} ${p.text}` }))]) {
      expect(item.text.includes("{character}")).toBe(item.names === true);
    }
    for (const ctx of quietContexts()) {
      expect(adPool(ctx).some((a) => a.names === true)).toBe(false);
      expect(popupPool(ctx).some((p) => p.names === true)).toBe(false);
    }
    const awake = ctxOf("hunt", { names: true });
    expect(adPool(awake).some((a) => a.names === true)).toBe(true);
    expect(popupPool(awake).some((p) => p.names === true)).toBe(true);
    expect(fillCopy("{character} wants to be your friend.", awake)).toBe("Trabolta wants to be your friend.");
    expect(fillCopy("{character}.EXE IS RUNNING", awake)).toBe("TRABOLTA.EXE IS RUNNING");
  });

  it("keeps ids unique, buttons 1–3 and copy short enough to fit a tablet", () => {
    const ids = [...IDLE_ADS.map((a) => a.id), ...POPUP_KINDS.map((p) => p.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of IDLE_ADS) {
      expect(a.title.length).toBeLessThanOrEqual(48);
      expect(a.body.length).toBeLessThanOrEqual(170);
      expect(a.button.length).toBeLessThanOrEqual(16);
    }
    for (const p of POPUP_KINDS) {
      expect(p.buttons.length).toBeGreaterThanOrEqual(1);
      expect(p.buttons.length).toBeLessThanOrEqual(3);
      expect(p.text.length).toBeLessThanOrEqual(110);
    }
  });

  it("points at the scan box only where there is one; asks for taps only on a wall", () => {
    const tv = ctxOf("early", { target: "tv", scan: false });
    expect(popupPool(tv).some((p) => p.scan === true || p.wall === true)).toBe(false);
    expect(adPool(tv).some((a) => a.scan === true || a.wall === true)).toBe(false);
    expect(popupPool(ctxOf("early")).some((p) => p.scan === true)).toBe(true);
  });

  it("follows the night: the hijack's ads and popups only while the ads are hijacked, Y2K's in its hour", () => {
    const ids = (pool: PhasePool) => adPool(ctxOf(pool)).map((a) => a.id);
    expect(ids("malware")).toContain("ad-hijack-offer");
    for (const p of PHASE_POOLS.filter((x) => x !== "malware")) expect(ids(p)).not.toContain("ad-hijack-offer");
    expect(ids("y2k")).toContain("ad-y2k-kit");
    expect(ids("early")).not.toContain("ad-y2k-kit");
    expect(popupPool(ctxOf("y2k")).map((p) => p.id)).toContain("pop-y2k-countdown");
    expect(fillCopy("{y2k} until midnight", ctxOf("y2k", { y2kLeft: 3723 }))).toBe("1:02:03 until midnight");
    expect(fillCopy("{y2k} until midnight", ctxOf("y2k", { y2kLeft: null }))).toBe("not long until midnight");
    expect(adPool(ctxOf("late", { phase: "trust_chart" })).map((a) => a.id)).toContain("ad-trust-chart");
    expect(adPool(ctxOf("late", { phase: "beans" })).map((a) => a.id)).not.toContain("ad-trust-chart");
  });
});

describe("the pools", () => {
  it("folds Night.phase into six pools (no phase: the doors)", () => {
    expect(phasePool(null)).toBe("early");
    expect(phasePool("bingo")).toBe("early");
    expect(phasePool("hunt_1")).toBe("hunt");
    expect(phasePool("malware")).toBe("malware");
    expect(phasePool("summons")).toBe("malware");
    expect(phasePool("trust_chart")).toBe("late");
    expect(phasePool("y2k")).toBe("y2k");
    expect(phasePool("finale_hand_jive")).toBe("finale");
    expect(phasePool("something new")).toBe("early");
  });

  it("names him only awake, introduced, not on attract — and never with no answer yet", () => {
    const base = { character: "Trabolta", target: "wall" as const, scan: true };
    expect(idleContextOf({ ...base, state: null, asleep: true }).names).toBe(false);
    expect(idleContextOf({ ...base, state: state(), asleep: false }).names).toBe(true);
    expect(idleContextOf({ ...base, state: state(), asleep: true }).names).toBe(false);
    expect(idleContextOf({ ...base, state: state({ character: { id: "Trabolta", hidden: true, awake: true, online: false, hold: false } }), asleep: false }).names).toBe(false);
    expect(idleContextOf({ ...base, state: state({ attract: true }), asleep: false }).names).toBe(false);
    expect(idleContextOf({ ...base, state: state({ phase: "malware" }), asleep: false }).pool).toBe("malware");
    expect(idleContextOf({ ...base, state: state({ countdown: "y2k", remaining: 99 }), asleep: false, now: 1 }).y2kLeft).toBe(99);
  });

  it("keeps the Y2K pool through a side's majority, while the clock runs (never over a finale)", () => {
    expect(phasePool("majority")).toBe("y2k");
    const base = { character: "Trabolta", target: "wall" as const, scan: true, asleep: false, now: 1 };
    const majority = idleContextOf({ ...base, state: state({ phase: "majority", countdown: "y2k", remaining: 1200 }) });
    expect(majority.pool).toBe("y2k");
    const ids = popupPool(majority).map((p) => p.id);
    expect(ids).toContain("pop-y2k-countdown");
    expect(ids).toContain("pop-majority");
    expect(ids).not.toContain("pop-load-beans");
    expect(adPool(majority).map((a) => a.id)).toContain("ad-y2k-kit");
    expect(POPUP_KINDS.find((p) => p.id === "pop-load-beans")!.phases).not.toContain("majority");
    // The Y2K clock running is the Y2K hour, whatever beat the phase names…
    expect(idleContextOf({ ...base, state: state({ phase: "overshare", countdown: "y2k", remaining: 99 }) }).pool).toBe("y2k");
    // …but a finale is a finale.
    expect(idleContextOf({ ...base, state: state({ phase: "final_reveal", countdown: "y2k", remaining: 99 }) }).pool).toBe("finale");
    expect(idleContextOf({ ...base, state: state({ phase: "beans" }) }).pool).toBe("late");
  });

  it("counts the Y2K popup down off the answer's arrival, as the slide and the corner do", () => {
    const s = state({ phase: "y2k", countdown: "y2k", remaining: 600, receivedAt: 10_000 });
    for (const now of [10_000, 10_999, 11_000, 12_500, 70_000, 700_000, 5_000]) {
      expect(y2kLeftAt(s, now)).toBe(screenLayers(s, now, { piloting: false }).y2k);
      expect(idleContextOf({ state: s, asleep: false, character: "Trabolta", target: "wall", scan: true, now }).y2kLeft).toBe(screenLayers(s, now, { piloting: false }).y2k);
    }
    expect(y2kLeftAt(s, 13_000)).toBe(597); // a stalled poll still ticks
    expect(y2kLeftAt(state({ countdown: "hunt", remaining: 60 }), 0)).toBe(null);
    expect(y2kLeftAt(null, 0)).toBe(null);
  });

  it("lets the face show through only where the face is under the show", () => {
    const base = { state: state(), asleep: false, character: "Trabolta", scan: true };
    expect(idleContextOf({ ...base, target: "wall" }).face).toBe(true);
    expect(idleContextOf({ ...base, target: "wall", region: "pane" }).face).toBe(false);
    expect(idleContextOf({ ...base, target: "tv" }).face).toBe(false);
  });

  it("filters an item on every tag at once", () => {
    expect(eligible({ pools: ["late"], phases: ["beans"] }, ctxOf("late", { phase: "beans" }))).toBe(true);
    expect(eligible({ pools: ["late"], phases: ["beans"] }, ctxOf("late", { phase: "trust_chart" }))).toBe(false);
    expect(eligible({ names: true }, ctxOf("late"))).toBe(false);
    expect(eligible({ wall: true }, ctxOf("late", { target: "tv" }))).toBe(false);
  });
});

describe("the seeded draws", () => {
  it("are the same for the same seed, and a cycle is every item once", () => {
    expect(permutation(9, mulberry32(5))).toEqual(permutation(9, mulberry32(5)));
    for (const n of [6, 9, 31]) {
      for (let c = 0; c < 6; c++) {
        const cycle = Array.from({ length: n }, (_, k) => drawAt(n, c * n + k, 77));
        expect(new Set(cycle).size).toBe(n);
      }
    }
    expect(hash32("Kitchen")).not.toBe(hash32("Hallway"));
  });

  it("never repeat a neighbour, nor one up to three back, across cycle boundaries", () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      for (const n of [6, 9, 30, 54]) {
        const seq = Array.from({ length: n * 12 }, (_, k) => drawAt(n, k, seed));
        for (let k = 1; k < seq.length; k++) expect(seq[k]).not.toBe(seq[k - 1]);
        for (let k = 2; k < seq.length; k++) expect(seq[k]).not.toBe(seq[k - 2]);
        if (n >= 9) for (let k = 3; k < seq.length; k++) expect(seq[k]).not.toBe(seq[k - 3]);
      }
    }
  });
});

describe("the schedule", () => {
  const seed = hash32("Kitchen");
  const walk = (ctx: IdleContext, from: number, n: number): Segment[] => {
    const pool = adPool(ctx);
    return Array.from({ length: n }, (_, i) => segmentAt(seed, from + i, ctx, pool));
  };

  it("is deterministic: the same seed and slot draw the same segment", () => {
    const ctx = ctxOf("hunt");
    expect(segmentAt(seed, 4321, ctx)).toEqual(segmentAt(seed, 4321, ctx));
    expect(new Set(walk(ctx, 0, 16).map((s) => s.layout)).size).toBeGreaterThan(3);
    // Another terminal is somewhere else in its own line.
    expect(walk(ctx, 0, 24).map((s) => s.ads.map((a) => a.id).join())).not.toEqual(Array.from({ length: 24 }, (_, i) => segmentAt(hash32("Hallway"), i, ctx).ads.map((a) => a.id).join()));
  });

  it("never holds one thing longer than 18 s", () => {
    for (const [lo, hi] of Object.values(LAYOUT_MS)) expect(lo <= hi && hi <= SEGMENT_MAX_MS).toBe(true);
    for (const s of walk(ctxOf("malware", { names: true }), 0, 800)) {
      expect(s.ms).toBeLessThanOrEqual(SEGMENT_MAX_MS);
      expect(s.ms).toBeGreaterThanOrEqual(7_000);
    }
  });

  it("never shows the same ad twice running, nor the same screensaver", () => {
    for (const pool of PHASE_POOLS) {
      for (const names of [false, true]) {
        const segs = walk(ctxOf(pool, { names }), 0, 1600);
        const shown = segs.flatMap((s) => s.ads.map((a) => a.id));
        for (let k = 1; k < shown.length; k++) expect(shown[k]).not.toBe(shown[k - 1]);
        for (let k = 1; k < segs.length; k++) expect(segs[k]!.saver).not.toBe(segs[k - 1]!.saver);
        for (const s of segs.filter((x) => x.layout === "side")) expect(s.ads[0]!.id).not.toBe(s.ads[1]!.id);
      }
    }
  });

  it("varies its layouts, with an occasional storm (every cycle while hijacked)", () => {
    const early = walk(ctxOf("early"), 0, PATTERN.length * 40);
    for (const l of ["saver", "ad", "banner", "side", "storm"] as const) expect(early.some((s) => s.layout === l)).toBe(true);
    const storms = early.filter((s) => s.layout === "storm").length;
    expect(storms).toBeGreaterThan(0);
    expect(storms).toBeLessThan(40);
    expect(walk(ctxOf("malware"), 0, PATTERN.length * 20).filter((s) => s.layout === "storm").length).toBe(20);
    expect(early.some((s) => s.layout === "face")).toBe(false);
  });

  it("shows his face only on an awake wall terminal after the introduction", () => {
    expect(walk(ctxOf("hunt", { names: true }), 0, 200).some((s) => s.layout === "face")).toBe(true);
    expect(walk(ctxOf("hunt", { names: true, target: "tv" }), 0, 200).some((s) => s.layout === "face")).toBe(false);
    expect(walk(ctxOf("hunt", { names: false }), 0, 200).some((s) => s.layout === "face")).toBe(false);
    for (const s of walk(ctxOf("hunt", { names: false }), 0, 400)) for (const a of s.ads) expect(a.names).not.toBe(true);
  });

  it("lets the night's own windows and ads be felt: every third window, every fourth ad", () => {
    const seed = hash32("Landing");
    for (const pool of PHASE_POOLS) {
      const ctx = ctxOf(pool, { phase: pool === "y2k" ? "majority" : "" });
      const pops = popupPool(ctx);
      const ownPops = pops.filter((p) => p.pools?.includes(pool));
      const drawn = Array.from({ length: 60 }, (_, n) => popupAt(seed, n, pops, pool)!);
      expect(drawn.every((p) => pops.includes(p))).toBe(true);
      if (ownPops.length > 0) expect(drawn.filter((p) => ownPops.includes(p)).length).toBeGreaterThanOrEqual(60 / POPUP_FOCUS_EVERY);
      const ads = adPool(ctx);
      const ownAds = ads.filter((a) => a.pools?.includes(pool));
      const shown = Array.from({ length: 60 }, (_, k) => adAt(seed, k, ads, pool)!);
      if (ownAds.length > 0) expect(shown.filter((a) => ownAds.includes(a)).length).toBeGreaterThanOrEqual(60 / AD_FOCUS_EVERY);
      // The all-night ones still come round.
      expect(new Set(drawn).size).toBeGreaterThan(ownPops.length + 5);
    }
    // The Y2K hour: the countdown window comes within the first dozen windows.
    const y2k = popupPool(ctxOf("y2k", { phase: "majority" }));
    expect(Array.from({ length: 12 }, (_, n) => popupAt(seed, n, y2k, "y2k")!.id).some((id) => id === "pop-y2k-countdown" || id === "pop-y2k-save")).toBe(true);
    // No focus (or nothing tagged): a plain draw.
    const two: { id: number; pools?: readonly PhasePool[] }[] = [{ id: 1 }, { id: 2 }];
    expect(drawFocused(1, 5, two, "y2k", 3)).not.toBeNull();
    expect(drawFocused(1, 0, [], "y2k", 3)).toBeNull();
  });

  it("never picks the face layout beside the world view (the face pane shows the world)", () => {
    expect(walk(ctxOf("hunt", { names: true, face: false }), 0, 400).some((s) => s.layout === "face")).toBe(false);
  });

  it("plays the phase's pool: hijack ads while hijacked, never before", () => {
    const ids = (pool: PhasePool) => new Set(walk(ctxOf(pool), 0, 400).flatMap((s) => s.ads.map((a) => a.id)));
    expect(ids("malware").has("ad-hijack-free")).toBe(true);
    expect(ids("early").has("ad-hijack-free")).toBe(false);
    expect(ids("early").has("ad-bingo")).toBe(true);
  });
});

describe("the cursor", () => {
  const len = (i: number) => 10_000 + (i % 3) * 1_000;

  it("starts off the name and the wall clock, never at segment 0 for everyone", () => {
    const t = 1_700_000_000_000;
    expect(resumeCursor(null, "Kitchen", t, len)).toEqual({ index: startIndex("Kitchen", t), start: t });
    expect(startIndex("Kitchen", t)).not.toBe(startIndex("Hallway", t));
    expect(startIndex("Kitchen", t + 60_000)).toBe(startIndex("Kitchen", t) + 1);
  });

  it("resumes a remount mid-segment, and moves on from one that ended", () => {
    const c = { index: 40, start: 1000 };
    expect(resumeCursor(c, "Kitchen", 5000, len)).toEqual(c);
    expect(resumeCursor(c, "Kitchen", 1000 + len(40) + 10, len)).toEqual({ index: 41, start: 1000 + len(40) });
    expect(advance(c, 1000 + len(40) + len(41) + 1, len).index).toBe(42);
    // Long gone, or a clock moved back: the next segment, now.
    expect(advance(c, 1000 + 10_000_000, len)).toEqual({ index: 41 + 64, start: 1000 + 10_000_000 });
    expect(advance(c, 500, len)).toEqual({ index: 41, start: 500 });
  });

  it("keeps its place in sessionStorage per terminal name", () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(loadCursor("Kitchen", s)).toBeNull();
    saveCursor("Kitchen", { index: 7, start: 99 }, s);
    expect(loadCursor("Kitchen", s)).toEqual({ index: 7, start: 99 });
    expect(loadCursor("Hallway", s)).toBeNull();
    store.set("loom-terminal:idle:Kitchen", "{bad json");
    expect(loadCursor("Kitchen", s)).toBeNull();
    store.set("loom-terminal:idle:Kitchen", JSON.stringify({ index: -3, start: 1 }));
    expect(loadCursor("Kitchen", s)).toBeNull();
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadCursor("Kitchen", throwing)).toBeNull();
    expect(() => saveCursor("Kitchen", { index: 1, start: 1 }, throwing)).not.toThrow();
  });
});

describe("the gags", () => {
  it("each tap on an ad's button is the next gag", () => {
    const seen = new Set(Array.from({ length: 6 }, (_, i) => adGag("ad-more-ram", i)));
    expect(seen.size).toBe(6);
    expect(adGag("ad-more-ram", 3)).toBe(adGag("ad-more-ram", 3));
    expect(gagText("loading")).toBe("ERROR: too much fun");
  });

  it("asks for a touch after 30 s alone, for 8 s every 30 s; never on the TV", () => {
    expect(attentionOn(0, ATTENTION_IDLE_MS - 1, "wall")).toBe(false);
    expect(attentionOn(0, ATTENTION_IDLE_MS, "wall")).toBe(true);
    expect(attentionOn(0, ATTENTION_IDLE_MS + ATTENTION_SHOW_MS, "wall")).toBe(false);
    expect(attentionOn(0, ATTENTION_IDLE_MS + ATTENTION_EVERY_MS + 1, "wall")).toBe(true);
    expect(attentionOn(0, ATTENTION_IDLE_MS + 1, "tv")).toBe(false);
  });

  it("rings arrivals sparingly (the TV more so) and moves the duck along its lane", () => {
    expect(ringsAt(null, 0, "wall")).toBe(true);
    expect(ringsAt(0, 2_000, "wall")).toBe(false);
    expect(ringsAt(0, 2_600, "wall")).toBe(true);
    expect(ringsAt(0, 5_000, "tv")).toBe(false);
    expect(duckLane(0)).toBe(0);
    expect(duckLane(1_300)).toBeCloseTo(1);
    for (let t = 0; t < 10_000; t += 137) expect(duckLane(t)).toBeGreaterThanOrEqual(0);
  });
});

describe("mystify", () => {
  it("keeps every corner inside the screen and a bounded trail", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const shapes = mystifyInit(320, 200, rand);
    expect(shapes).toHaveLength(2);
    for (let i = 0; i < 2000; i++) mystifyStep(shapes, 320, 200);
    for (const s of shapes) {
      expect(s.trail).toHaveLength(MYSTIFY_TRAIL);
      for (const p of s.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(320);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(200);
      }
    }
  });
});
