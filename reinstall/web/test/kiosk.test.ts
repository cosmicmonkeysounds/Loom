import { describe, expect, it } from "vitest";
import { HOLD_MS, LongPress, type Timers } from "../src/kiosk.ts";

/** Manual timers: `advance(ms)` runs whatever came due. */
class FakeTimers implements Timers {
  private now = 0;
  private next = 1;
  private readonly due = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.due.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.due.delete(handle as number);
  }
  advance(ms: number): void {
    this.now += ms;
    for (const [id, t] of [...this.due]) {
      if (t.at <= this.now) {
        this.due.delete(id);
        t.fn();
      }
    }
  }
}

describe("LongPress — the tent tablet's ⚙ Setup / 🗺 House map need a 2 s hold (W-15)", () => {
  it("holds for 2 s by default", () => {
    expect(HOLD_MS).toBe(2000);
  });

  it("a short tap does nothing", () => {
    const t = new FakeTimers();
    let fired = 0;
    const p = new LongPress(() => fired++, HOLD_MS, t);
    p.down();
    t.advance(300);
    p.cancel();
    t.advance(5000);
    expect(fired).toBe(0);
    expect(p.holding).toBe(false);
  });

  it("released at 1.99 s does nothing; held to 2 s fires once", () => {
    const t = new FakeTimers();
    let fired = 0;
    const p = new LongPress(() => fired++, HOLD_MS, t);
    p.down();
    t.advance(1990);
    p.cancel();
    expect(fired).toBe(0);
    p.down();
    expect(p.holding).toBe(true);
    t.advance(2000);
    expect(fired).toBe(1);
    expect(p.holding).toBe(false);
    p.cancel();
    t.advance(5000);
    expect(fired).toBe(1);
  });

  it("a second finger down restarts the hold", () => {
    const t = new FakeTimers();
    let fired = 0;
    const p = new LongPress(() => fired++, HOLD_MS, t);
    p.down();
    t.advance(1500);
    p.down();
    t.advance(1500);
    expect(fired).toBe(0);
    t.advance(500);
    expect(fired).toBe(1);
  });
});
