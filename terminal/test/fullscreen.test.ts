import { describe, expect, it } from "vitest";
import { GESTURES, KioskFullscreen, type FullscreenDoc, type FullyLike, type GestureLike } from "../src/fullscreen.ts";

/** A document whose root can (or can't) go full screen. */
class FakeDoc implements FullscreenDoc {
  fullscreenElement: unknown = null;
  fullscreenEnabled = true;
  activeElement: { tagName?: string } | null = null;
  requests = 0;
  exits = 0;
  /** The next request is refused (no user activation). */
  refuse = false;
  listeners = new Map<string, Set<(e: GestureLike) => void>>();
  documentElement: FullscreenDoc["documentElement"];
  constructor(api: "standard" | "webkit" | "none" = "standard") {
    const enter = () => {
      this.requests++;
      if (this.refuse) return Promise.reject(new TypeError("not from a gesture"));
      this.fullscreenElement = this.documentElement;
      this.fire("fullscreenchange");
      return Promise.resolve();
    };
    this.documentElement =
      api === "standard"
        ? { requestFullscreen: enter }
        : api === "webkit"
          ? {
              webkitRequestFullscreen: () => {
                void enter().catch(() => {});
              },
            }
          : {};
  }
  exitFullscreen = () => {
    this.exits++;
    this.fullscreenElement = null;
    this.fire("fullscreenchange");
    return Promise.resolve();
  };
  addEventListener(type: string, l: (e: GestureLike) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(l);
  }
  removeEventListener(type: string, l: (e: GestureLike) => void) {
    this.listeners.get(type)?.delete(l);
  }
  fire(type: string, more: Partial<GestureLike> = {}) {
    for (const l of [...(this.listeners.get(type) ?? [])]) l({ type, ...more });
  }
  /** Esc / the browser leaving full screen on its own. */
  leave() {
    this.fullscreenElement = null;
    this.fire("fullscreenchange");
  }
  count(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("KioskFullscreen — full screen by default", () => {
  it("asks on a gesture, and again on every gesture after full screen was lost", async () => {
    const doc = new FakeDoc();
    const states: string[] = [];
    const fs = new KioskFullscreen(doc, null, (s) => states.push(s));
    fs.setEnabled(true);
    expect(fs.state).toBe("off");
    doc.fire("click");
    await tick();
    expect(doc.requests).toBe(1);
    expect(fs.state).toBe("on");
    doc.fire("click"); // already full screen: nothing
    await tick();
    expect(doc.requests).toBe(1);
    doc.leave(); // Esc, a reload, the browser
    expect(fs.state).toBe("off");
    doc.fire("touchend");
    await tick();
    expect(doc.requests).toBe(2);
    expect(states).toContain("on");
    expect(states[states.length - 1]).toBe("on");
  });

  it("listens in the capture phase for every activating gesture", () => {
    const doc = new FakeDoc();
    new KioskFullscreen(doc).setEnabled(true);
    for (const g of GESTURES) expect(doc.count(g), g).toBe(1);
  });

  it("a finger's pointerdown and Esc never ask; a mouse's pointerdown does", async () => {
    const doc = new FakeDoc();
    new KioskFullscreen(doc).setEnabled(true);
    doc.fire("pointerdown", { pointerType: "touch" });
    doc.fire("keydown", { key: "Escape" });
    await tick();
    expect(doc.requests).toBe(0);
    doc.fire("pointerdown", { pointerType: "mouse" });
    await tick();
    expect(doc.requests).toBe(1);
  });

  it("a refused request (no activation) is asked again on the next gesture", async () => {
    const doc = new FakeDoc();
    const fs = new KioskFullscreen(doc);
    fs.setEnabled(true);
    doc.refuse = true;
    expect(await fs.request()).toBe(false);
    doc.refuse = false;
    doc.fire("pointerup");
    await tick();
    expect(doc.requests).toBe(2);
    expect(fs.active).toBe(true);
  });

  it("leaves the keyboard alone: no request while typing in a field", async () => {
    const doc = new FakeDoc();
    const fs = new KioskFullscreen(doc);
    fs.setEnabled(true);
    doc.activeElement = { tagName: "input" };
    expect(await fs.request()).toBe(false);
    expect(doc.requests).toBe(0);
  });

  it("turned off: stops asking and leaves full screen", async () => {
    const doc = new FakeDoc();
    const fs = new KioskFullscreen(doc);
    fs.setEnabled(true);
    await fs.request();
    expect(fs.state).toBe("on");
    fs.setEnabled(false);
    expect(doc.exits).toBe(1);
    expect(fs.state).toBe("disabled");
    for (const g of GESTURES) expect(doc.count(g)).toBe(0);
    doc.fire("click");
    await tick();
    expect(doc.requests).toBe(1);
    expect(await fs.request()).toBe(false);
  });

  it("uses the webkit spelling where that is all there is", async () => {
    const doc = new FakeDoc("webkit");
    const fs = new KioskFullscreen(doc);
    fs.setEnabled(true);
    expect(fs.supported).toBe(true);
    await fs.request();
    await tick();
    expect(doc.requests).toBe(1);
    expect(fs.state).toBe("on");
  });

  it("no API (an iPhone) is unsupported and never throws", async () => {
    const doc = new FakeDoc("none");
    const fs = new KioskFullscreen(doc);
    fs.setEnabled(true);
    expect(fs.state).toBe("unsupported");
    expect(await fs.request()).toBe(false);
  });

  it("inside Fully Kiosk: hides the bars once, shows them when turned off", async () => {
    const calls: string[] = [];
    const fully: FullyLike = { hideStatusBar: () => calls.push("hideStatus"), hideNavigationBar: () => calls.push("hideNav"), showStatusBar: () => calls.push("showStatus"), showNavigationBar: () => calls.push("showNav") };
    const doc = new FakeDoc("none");
    const fs = new KioskFullscreen(doc, fully);
    fs.setEnabled(true);
    expect(fs.supported).toBe(true);
    await fs.request();
    await fs.request();
    expect(calls).toEqual(["hideStatus", "hideNav"]);
    expect(fs.state).toBe("fully");
    expect(fs.active).toBe(true);
    fs.setEnabled(false);
    expect(calls).toEqual(["hideStatus", "hideNav", "showStatus", "showNav"]);
  });

  it("an older Fully without the bar calls is no Fully", () => {
    const fs = new KioskFullscreen(new FakeDoc("none"), {});
    fs.setEnabled(true);
    expect(fs.state).toBe("unsupported");
  });

  it("a page that forbids full screen (an iframe without allow) is unsupported", () => {
    const doc = new FakeDoc();
    doc.fullscreenEnabled = false;
    expect(new KioskFullscreen(doc).supported).toBe(false);
  });
});
