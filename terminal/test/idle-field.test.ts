import { describe, expect, it } from "vitest";
import { MAX_POPUPS, POPUP_H, POPUP_W, STORM_EVERY_MS, ask, close, closeGag, dodge, emptyField, hydra, placePopup, relayout, spawn, spawnGap, stormPlace, tick, y2kPace, type PopupField, type Rect } from "../src/idle-show/field.ts";
import { mulberry32 } from "../src/idle-show/rng.ts";
import type { Layout } from "../src/idle-show/schedule.ts";

const reserve: Rect = { x: 0.66, y: 0.56, w: 0.34, h: 0.44 };
const env: { seed: number; layout: Layout; pool: "early"; target: "wall"; reserve: Rect } = { seed: 42, layout: "saver", pool: "early", target: "wall", reserve };

function run(f: PopupField, from: number, to: number, step: number, o = env): { field: PopupField; arrivals: number; most: number } {
  let field = f;
  let arrivals = 0;
  let most = 0;
  for (let t = from; t <= to; t += step) {
    const r = tick(field, t, o);
    field = r.field;
    if (r.arrived !== null) arrivals += 1;
    most = Math.max(most, field.live.length);
  }
  return { field, arrivals, most };
}

const overlaps = (x: number, y: number, r: Rect) => x < r.x + r.w && r.x < x + POPUP_W && y < r.y + r.h && r.y < y + POPUP_H;

describe("the popups' lives", () => {
  it("arrive on the layout's rhythm and pile up — never past six", () => {
    const r = run(emptyField(), 0, 120_000, 250);
    expect(r.arrivals).toBeGreaterThan(10);
    expect(r.most).toBeLessThanOrEqual(MAX_POPUPS);
    expect(r.most).toBeGreaterThan(1);
    const storm = run(emptyField(), 0, 8_000, 40, { ...env, layout: "storm" });
    expect(storm.most).toBe(MAX_POPUPS);
    expect(storm.arrivals).toBeGreaterThan(8_000 / STORM_EVERY_MS - 3);
    const face = run(emptyField(), 0, 60_000, 250, { ...env, layout: "face" });
    expect(face.arrivals).toBe(0);
  });

  it("come twice as often while the ads are hijacked, a little calmer on the TV", () => {
    expect(spawnGap("saver", "malware", "wall", 0.5)!).toBeLessThan(spawnGap("saver", "early", "wall", 0.5)!);
    expect(spawnGap("saver", "early", "tv", 0.5)!).toBeGreaterThan(spawnGap("saver", "early", "wall", 0.5)!);
    expect(spawnGap("face", "early", "wall", 0.5)).toBeNull();
  });

  it("pile up faster as midnight nears in the Y2K hour", () => {
    const at = (left: number | null) => spawnGap("saver", "y2k", "wall", 0.5, left)!;
    expect(at(null)).toBe(at(3_000));
    expect(at(300)).toBeLessThan(at(301));
    expect(at(60)).toBeLessThan(at(300));
    expect(y2kPace(0)).toBe(0.3);
    // Only the Y2K pool hears the clock.
    expect(spawnGap("saver", "early", "wall", 0.5, 10)).toBe(spawnGap("saver", "early", "wall", 0.5));
    // tick carries it through.
    const run = (left: number | null) => {
      let f = emptyField();
      let n = 0;
      for (let t = 0; t < 120_000; t += 250) {
        const r = tick(f, t, { seed: 7, layout: "saver", pool: "y2k", target: "wall", reserve: null, y2kLeft: left });
        f = { ...r.field, live: [] };
        if (r.arrived !== null) n++;
      }
      return n;
    };
    expect(run(30)).toBeGreaterThan(run(null));
  });

  it("each slot draws one window at a time", () => {
    let f = emptyField();
    for (let i = 0; i < 40; i++) {
      f = spawn(f, i * 10, { seed: 3, reserve, storm: false }).field;
      const slots = f.live.map((p) => p.slot);
      expect(new Set(slots).size).toBe(slots.length);
      for (const s of slots) expect(s >= 0 && s < MAX_POPUPS).toBe(true);
    }
    expect(f.live).toHaveLength(MAX_POPUPS);
    expect(f.drawn).toBe(40);
  });

  it("never lands on the scan box", () => {
    for (let seed = 0; seed < 400; seed++) {
      const p = placePopup(mulberry32(seed), reserve);
      expect(overlaps(p.x, p.y, reserve)).toBe(false);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + POPUP_W).toBeLessThanOrEqual(1);
      expect(p.y + POPUP_H).toBeLessThanOrEqual(1);
      const s = stormPlace(seed, 9, reserve);
      expect(overlaps(s.x, s.y, reserve)).toBe(false);
    }
  });

  it("close, dodge once, ask first, hydra — each by its rule", () => {
    const one = spawn(emptyField(), 0, { seed: 1, reserve, storm: false });
    const p = one.popup;
    expect(closeGag(0.1, p, 1)).toBe("hydra");
    expect(closeGag(0.1, p, MAX_POPUPS)).not.toBe("hydra");
    expect(closeGag(0.25, p, 1)).toBe("dodge");
    expect(closeGag(0.25, { ...p, dodged: true }, 1)).toBe("close");
    expect(closeGag(0.1, { ...p, storm: true }, 1)).toBe("close");
    expect(closeGag(0.9, p, 1)).toBe("close");
    expect(close(one.field, p.id).live).toHaveLength(0);
    const d = dodge(one.field, p.id, 100, { seed: 1, reserve });
    expect(d.live[0]!.dodged).toBe(true);
    expect(d.live[0]!.x !== p.x || d.live[0]!.y !== p.y).toBe(true);
    expect(ask(one.field, p.id, 100).live[0]!.asking).toBe(true);
    const h = hydra(one.field, p.id, 100, { seed: 1, reserve });
    expect(h.arrived).toHaveLength(2);
    expect(h.field.live).toHaveLength(2);
    let full = emptyField();
    for (let i = 0; i < MAX_POPUPS; i++) full = spawn(full, i, { seed: 1, reserve, storm: false }).field;
    expect(hydra(full, full.live[0]!.id, 100, { seed: 1, reserve }).field.live.length).toBeLessThanOrEqual(MAX_POPUPS);
  });

  it("windows close at the end of their life, and a storm's go with the storm", () => {
    const s = spawn(emptyField(), 0, { seed: 5, reserve, storm: true });
    expect(tick(s.field, s.popup.dies + 1, { ...env, layout: "storm" }).field.live.every((p) => p.id !== s.popup.id)).toBe(true);
    const mixed = spawn(s.field, 1, { seed: 5, reserve, storm: false }).field;
    expect(relayout(mixed, "saver").live.map((p) => p.storm)).toEqual([false]);
    expect(relayout(mixed, "storm").live).toHaveLength(2);
  });
});

describe("the storm's trail", () => {
  it("bounces inside its room, a pure function of time", async () => {
    const { stormPath } = await import("../src/idle-show/storm.ts");
    for (let t = 0; t < 60_000; t += 333) {
      const p = stormPath(t, 1000, 600, 7);
      expect(p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 600).toBe(true);
      expect(stormPath(t, 1000, 600, 7)).toEqual(p);
    }
    expect(stormPath(0, 0, 0, 7)).toEqual({ x: 0, y: 0 });
  });
});
