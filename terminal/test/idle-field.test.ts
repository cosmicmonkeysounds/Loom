import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CALM_MAX_POPUPS, CALM_POPUP_PACE, MAX_POPUPS, QUIET_MAX_POPUPS, calmPace, popupCap, POPUP_H, POPUP_W, STORM_EVERY_MS, ask, close, closeGag, dodge, emptyField, hydra, placePopup, relayout, spawn, spawnGap, stormPlace, tick, y2kPace, type PopupField, type Rect } from "../src/idle-show/field.ts";
import { hash32, mulberry32 } from "../src/idle-show/rng.ts";
import { adPool, advance, segmentAt, type Layout } from "../src/idle-show/schedule.ts";
import type { IdleContext } from "../src/idle-show/pools.ts";

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

  it("a quiet backdrop (the tent's kiosk, T3) keeps the calm pace after the hijack too, so its one window settles", () => {
    expect(calmPace({ calm: true })).toBe(true);
    expect(calmPace({ quiet: true })).toBe(true);
    expect(calmPace({ calm: false, quiet: true })).toBe(true);
    expect(calmPace({ calm: false })).toBe(false);
    expect(calmPace({})).toBe(false);
    // Hijacked and quiet: a saver window every 9–19.5 s, not every 1.5–3.3 s.
    expect(spawnGap("saver", "malware", "wall", 0, null, calmPace({ quiet: true }))).toBe(9_000);
    expect(spawnGap("saver", "malware", "wall", 1, null, calmPace({ quiet: true }))).toBe(19_500);
    const src = readFileSync(fileURLToPath(new URL("../src/idle-show/IdleShow.tsx", import.meta.url)), "utf8");
    expect(src).toMatch(/calm: calmPace\(ctxRef\.current\), cap: popupCap\(ctxRef\.current\)/u);
  });

  it("are calm before the hijack (wave 26, T1): six times further apart, two at most, no storm of them", () => {
    for (const r of [0, 0.5, 1]) {
      expect(spawnGap("saver", "early", "wall", r, null, true)!).toBe(Math.round(spawnGap("saver", "early", "wall", r)! * CALM_POPUP_PACE));
    }
    // A saver's 3–6.5 s becomes 18–39 s.
    expect(spawnGap("saver", "early", "wall", 0, null, true)).toBe(18_000);
    expect(spawnGap("saver", "hunt", "wall", 1, null, true)).toBe(39_000);
    // Hijacked: still twice as often as the all-night rate.
    expect(spawnGap("saver", "malware", "wall", 0.5)!).toBe(Math.round(spawnGap("saver", "early", "wall", 0.5)! * 0.5));
    expect(popupCap({ calm: true })).toBe(CALM_MAX_POPUPS);
    expect(popupCap({ calm: true, quiet: true })).toBe(QUIET_MAX_POPUPS);
    expect(popupCap({})).toBe(MAX_POPUPS);
    const calm = run(emptyField(), 0, 600_000, 250, { ...env, calm: true, cap: CALM_MAX_POPUPS } as typeof env);
    expect(calm.most).toBeLessThanOrEqual(CALM_MAX_POPUPS);
    expect(calm.arrivals).toBeGreaterThan(600_000 / 39_000 - 2);
    expect(calm.arrivals).toBeLessThan(600_000 / 18_000 + 2);
    const quiet = run(emptyField(), 0, 600_000, 250, { ...env, cap: QUIET_MAX_POPUPS } as typeof env);
    expect(quiet.most).toBe(QUIET_MAX_POPUPS);
    // The hydra never passes the cap either; a storm keeps its own six.
    let f = spawn(emptyField(), 0, { seed: 1, reserve, storm: false, cap: 2 }).field;
    f = spawn(f, 1, { seed: 1, reserve, storm: false, cap: 2 }).field;
    f = spawn(f, 2, { seed: 1, reserve, storm: false, cap: 2 }).field;
    expect(f.live).toHaveLength(2);
    expect(f.live.map((p) => p.born)).toEqual([1, 2]);
    expect(hydra(f, f.live[0]!.id, 3, { seed: 1, reserve, cap: 2 }).field.live.length).toBeLessThanOrEqual(2);
    expect(closeGag(0.1, { dodged: false, storm: false }, 2, 2)).not.toBe("hydra");
    let st = emptyField();
    for (let i = 0; i < 8; i++) st = spawn(st, i, { seed: 1, reserve, storm: true, cap: 1 }).field;
    expect(st.live).toHaveLength(MAX_POPUPS);
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
      const p = placePopup(mulberry32(seed), reserve)!;
      expect(overlaps(p.x, p.y, reserve)).toBe(false);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + POPUP_W).toBeLessThanOrEqual(1);
      expect(p.y + POPUP_H).toBeLessThanOrEqual(1);
      const s = stormPlace(seed, 9, reserve)!;
      expect(overlaps(s.x, s.y, reserve)).toBe(false);
    }
  });

  it("never hides under the tent's card (wave 26, T3): no room, no window", () => {
    // The tent at 1366x768: the card spans 0.18–0.82 of the box, full height (+ the 0.02 margin).
    const card: Rect = { x: 0.161, y: -0.002, w: 0.678, h: 1.004 };
    for (let seed = 0; seed < 2_000; seed++) {
      const p = placePopup(mulberry32(seed), card);
      if (p !== null) expect(overlaps(p.x, p.y, card)).toBe(false);
      const st = stormPlace(seed, 9, card);
      if (st !== null) expect(overlaps(st.x, st.y, card)).toBe(false);
    }
    expect(placePopup(mulberry32(1), card)).toBeNull();
    // spawn adds nothing and keeps `drawn` (the next try draws the same kind).
    const f0 = emptyField(4);
    const sp = spawn(f0, 0, { seed: 1, reserve: card, storm: false, cap: 1 });
    expect(sp.popup).toBeNull();
    expect(sp.field).toBe(f0);
    expect(spawn(f0, 0, { seed: 1, reserve: card, storm: true }).popup).toBeNull();
    // An hour of the quiet backdrop: nothing ever lands, and the clock keeps trying.
    const quietRun = run(emptyField(), 0, 3_600_000, 250, { ...env, reserve: card, calm: true, cap: QUIET_MAX_POPUPS } as typeof env);
    expect(quietRun.arrivals).toBe(0);
    expect(quietRun.field.nextAt).not.toBeNull();
    // The hydra brings none; a dodge stays put.
    expect(hydra(emptyField(), -1, 0, { seed: 1, reserve: card, cap: 1 }).arrived).toEqual([]);
    const one = spawn(emptyField(), 0, { seed: 1, reserve: null, storm: false }).field;
    const before = one.live[0]!;
    const dodged = dodge(one, before.id, 10, { seed: 1, reserve: { x: 0, y: 0, w: 1, h: 1 } }).live[0]!;
    expect([dodged.x, dodged.y, dodged.dodged]).toEqual([before.x, before.y, true]);
  });

  it("finds the strip beside a reserve when random tries miss it", () => {
    // A centred card leaving only a right-hand margin a window fits.
    const card: Rect = { x: 0.1, y: 0, w: 0.5, h: 1 };
    for (let seed = 0; seed < 200; seed++) {
      const p = placePopup(mulberry32(seed), card);
      expect(p).not.toBeNull();
      expect(overlaps(p!.x, p!.y, card)).toBe(false);
      expect(p!.x + POPUP_W).toBeLessThanOrEqual(0.98 + 1e-9);
    }
  });

  it("close, dodge once, ask first, hydra — each by its rule", () => {
    const one = spawn(emptyField(), 0, { seed: 1, reserve, storm: false });
    const p = one.popup!;
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
    expect(tick(s.field, s.popup!.dies + 1, { ...env, layout: "storm" }).field.live.every((p) => p.id !== s.popup!.id)).toBe(true);
    const mixed = spawn(s.field, 1, { seed: 5, reserve, storm: false }).field;
    expect(relayout(mixed, "saver").live.map((p) => p.storm)).toEqual([false]);
    expect(relayout(mixed, "storm").live).toHaveLength(2);
  });
});

describe("the calm pace survives segment changes (wave 26, T1 fix)", () => {
  // The real loop IdleShow's step() runs: the cursor moves on, a segment
  // change re-lays the field (keeping the next arrival), then a tick.
  function calmHour(name: string, target: "tv" | "wall", face: boolean): number[] {
    const ctx: IdleContext = { pool: "early", phase: "arrivals", names: false, character: "Trabolta", target, scan: target === "wall", face, y2kLeft: null, calm: true };
    const ads = adPool(ctx);
    const seed = hash32(name);
    const lengthOf = (i: number) => segmentAt(seed, i, ctx, ads).ms;
    let cursor = { index: 0, start: 0 };
    let field = emptyField();
    const at: number[] = [];
    for (let t = 0; t <= 3_600_000; t += 250) {
      const next = advance(cursor, t, lengthOf);
      if (next.index !== cursor.index) {
        field = relayout(field, segmentAt(seed, next.index, ctx, ads).layout, segmentAt(seed, cursor.index, ctx, ads).layout);
        cursor = next;
      }
      const layout = segmentAt(seed, cursor.index, ctx, ads).layout;
      const r = tick(field, t, { seed, layout, pool: "early", target, reserve: target === "wall" ? reserve : null, calm: true, cap: CALM_MAX_POPUPS });
      field = r.field;
      if (r.arrived !== null) at.push(t);
    }
    return at;
  }

  it("keeps a calm wall's windows coming all hour, never closer than 18 s", () => {
    for (const name of ["cpu", "hall", "server-room", "door", "a"]) {
      for (const face of [false, true]) {
        const at = calmHour(name, "wall", face);
        // A window every 18–39 s (a few longer when one falls in an ad) → 60+ an hour, none stalled.
        expect(at.length).toBeGreaterThan(50);
        expect(at[at.length - 1]!).toBeGreaterThan(3_600_000 - 120_000);
        const gaps = at.slice(1).map((t, i) => t - at[i]!);
        expect(Math.min(...gaps)).toBeGreaterThanOrEqual(18_000);
        expect(Math.max(...gaps)).toBeLessThan(120_000);
      }
    }
  });

  it("keeps the TV's windows coming too, never closer than 18 s × 1.3", () => {
    for (const name of ["tv1", "TV2", "desktop-tv"]) {
      const at = calmHour(name, "tv", false);
      expect(at.length).toBeGreaterThan(40);
      expect(at[at.length - 1]!).toBeGreaterThan(3_600_000 - 150_000);
      const gaps = at.slice(1).map((t, i) => t - at[i]!);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(23_400);
    }
  });

  it("a segment change keeps the next arrival; a storm starting or ending resets it", () => {
    const f = { ...emptyField(), nextAt: 12_345 };
    expect(relayout(f, "saver", "saver").nextAt).toBe(12_345);
    expect(relayout(f, "ad", "saver").nextAt).toBe(12_345);
    expect(relayout(f, "saver").nextAt).toBe(12_345);
    expect(relayout(f, "storm", "saver").nextAt).toBeNull();
    expect(relayout(f, "saver", "storm").nextAt).toBeNull();
    const src = readFileSync(fileURLToPath(new URL("../src/idle-show/IdleShow.tsx", import.meta.url)), "utf8");
    expect(src.match(/relayout\(field\.current, [^\n]*, segOf\(c\.index\)\.layout\)/gu)).toHaveLength(2);
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
