import { describe, expect, it } from "vitest";
import { HOLD_MS, LongPress, ScreenWake, type Timers, type VisibilitySource, type WakeLockApi, type WakeSentinel } from "../src/kiosk.ts";

class FakeDoc implements VisibilitySource {
  visibilityState = "visible";
  private listeners = new Set<() => void>();
  addEventListener(_: "visibilitychange", l: () => void): void {
    this.listeners.add(l);
  }
  removeEventListener(_: "visibilitychange", l: () => void): void {
    this.listeners.delete(l);
  }
  set(state: "visible" | "hidden"): void {
    this.visibilityState = state;
    for (const l of this.listeners) l();
  }
  get listening(): number {
    return this.listeners.size;
  }
}

class FakeSentinel implements WakeSentinel {
  released = false;
  private onRelease: (() => void)[] = [];
  async release(): Promise<void> {
    this.drop();
  }
  addEventListener(_: "release", l: () => void): void {
    this.onRelease.push(l);
  }
  /** What the browser does when the page is hidden. */
  drop(): void {
    if (this.released) return;
    this.released = true;
    for (const l of this.onRelease) l();
  }
}

class FakeWakeLock implements WakeLockApi {
  requests = 0;
  refuse = false;
  last: FakeSentinel | null = null;
  async request(): Promise<WakeSentinel> {
    this.requests++;
    if (this.refuse) throw new DOMException("no", "NotAllowedError");
    this.last = new FakeSentinel();
    return this.last;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ScreenWake — the screen stays on", () => {
  it("takes the lock when asked, once", async () => {
    const api = new FakeWakeLock();
    const w = new ScreenWake(api, new FakeDoc());
    expect(await w.keepOn()).toBe(true);
    expect(w.held).toBe(true);
    expect(await w.keepOn()).toBe(true);
    expect(api.requests).toBe(1);
  });

  it("concurrent asks share one request", async () => {
    const api = new FakeWakeLock();
    const w = new ScreenWake(api, new FakeDoc());
    const [a, b] = await Promise.all([w.keepOn(), w.keepOn()]);
    expect([a, b]).toEqual([true, true]);
    expect(api.requests).toBe(1);
  });

  it("re-takes the lock when the page comes back into view", async () => {
    const api = new FakeWakeLock();
    const doc = new FakeDoc();
    const w = new ScreenWake(api, doc);
    await w.keepOn();
    doc.set("hidden");
    api.last!.drop(); // the browser releases a hidden page's lock
    expect(w.held).toBe(false);
    await tick();
    expect(api.requests).toBe(1); // not while hidden
    doc.set("visible");
    await tick();
    expect(api.requests).toBe(2);
    expect(w.held).toBe(true);
  });

  it("asked while hidden, it waits for visible", async () => {
    const api = new FakeWakeLock();
    const doc = new FakeDoc();
    doc.visibilityState = "hidden";
    const w = new ScreenWake(api, doc);
    expect(await w.keepOn()).toBe(false);
    expect(api.requests).toBe(0);
    doc.set("visible");
    await tick();
    expect(w.held).toBe(true);
  });

  it("never asked, a visibility change takes nothing", async () => {
    const api = new FakeWakeLock();
    const doc = new FakeDoc();
    new ScreenWake(api, doc);
    doc.set("hidden");
    doc.set("visible");
    await tick();
    expect(api.requests).toBe(0);
  });

  it("a refusal reports false and the next visibility change retries", async () => {
    const api = new FakeWakeLock();
    api.refuse = true;
    const doc = new FakeDoc();
    const w = new ScreenWake(api, doc);
    expect(await w.keepOn()).toBe(false);
    api.refuse = false;
    doc.set("hidden");
    doc.set("visible");
    await tick();
    expect(w.held).toBe(true);
  });

  it("without the API (old Chrome) it reports unsupported and false", async () => {
    const w = new ScreenWake(null, new FakeDoc());
    expect(w.supported).toBe(false);
    expect(await w.keepOn()).toBe(false);
  });

  it("reports every take and loss", async () => {
    const api = new FakeWakeLock();
    const doc = new FakeDoc();
    const seen: boolean[] = [];
    const w = new ScreenWake(api, doc, (held) => seen.push(held));
    await w.keepOn();
    api.last!.drop();
    doc.set("visible");
    await tick();
    await w.dispose();
    expect(seen).toEqual([true, false, true, false]);
  });

  it("dispose releases and stops listening", async () => {
    const api = new FakeWakeLock();
    const doc = new FakeDoc();
    const w = new ScreenWake(api, doc);
    await w.keepOn();
    await w.dispose();
    expect(api.last!.released).toBe(true);
    expect(doc.listening).toBe(0);
  });
});

class FakeTimers implements Timers {
  now = 0;
  private next = 1;
  private due = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.due.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.due.delete(h as number);
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

describe("LongPress — the ⚙ needs a 2 s hold", () => {
  it("holds for 2 s by default", () => {
    expect(HOLD_MS).toBe(2000);
  });

  it("a short tap does nothing", () => {
    const t = new FakeTimers();
    let fired = 0;
    const p = new LongPress(() => fired++, HOLD_MS, t);
    p.down();
    t.advance(300);
    p.cancel(); // finger up
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
    p.cancel(); // the finger lifting after it fired
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
