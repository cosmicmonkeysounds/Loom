import { describe, expect, it } from "vitest";
import { GESTURES, KioskFullscreen, browserFullscreen, fullscreenFlagOf, type FullscreenDoc, type FullscreenView, type FullyLike, type GestureLike } from "../src/fullscreen.ts";

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

describe("the health flag (fs)", () => {
  it("sends 1 when full, 0 when asked but not full, nothing when off by choice or impossible", () => {
    expect(fullscreenFlagOf("on")).toBe(true);
    expect(fullscreenFlagOf("fully")).toBe(true);
    expect(fullscreenFlagOf("off")).toBe(false);
    expect(fullscreenFlagOf("disabled")).toBeNull(); // a director turned it off: not a fault
    expect(fullscreenFlagOf("unsupported")).toBeNull();
  });
});

/** A window: its display mode and size, and its resize listeners. */
class FakeView implements FullscreenView {
  modes = new Set<string>();
  innerWidth = 1280;
  innerHeight = 700;
  screen = { width: 1280, height: 800 };
  resizes = new Set<() => void>();
  matchMedia = (q: string) => ({ matches: this.modes.has(q) });
  addEventListener(type: string, l: () => void) {
    if (type === "resize") this.resizes.add(l);
  }
  removeEventListener(type: string, l: () => void) {
    if (type === "resize") this.resizes.delete(l);
  }
  resize(w: number, h: number) {
    this.innerWidth = w;
    this.innerHeight = h;
    for (const l of [...this.resizes]) l();
  }
}

describe("browser-level full screen (--kiosk, F11, a Home Screen app)", () => {
  it("the TV's Chrome --kiosk reports on with no tap and no fullscreen element", () => {
    const doc = new FakeDoc();
    const view = new FakeView();
    view.modes.add("(display-mode: fullscreen)");
    const fs = new KioskFullscreen(doc, null, () => {}, view);
    fs.setEnabled(true);
    expect(doc.fullscreenElement).toBeNull();
    expect(fs.state).toBe("on");
    expect(fullscreenFlagOf(fs.state)).toBe(true);
  });

  it("a tap in kiosk asks the API for nothing (no 'Press Esc' toast each touch)", async () => {
    const doc = new FakeDoc();
    const view = new FakeView();
    view.modes.add("(display-mode: fullscreen)");
    const fs = new KioskFullscreen(doc, null, () => {}, view);
    fs.setEnabled(true);
    doc.fire("click");
    await tick();
    expect(doc.requests).toBe(0);
    expect(await fs.request()).toBe(true);
  });

  it("a Home Screen web app (standalone) counts, even where the API is missing", () => {
    const view = new FakeView();
    view.modes.add("(display-mode: standalone)");
    const fs = new KioskFullscreen(new FakeDoc("none"), null, () => {}, view);
    fs.setEnabled(true);
    expect(fs.state).toBe("on");
  });

  it("an old WebView without the media query: the window filling the screen counts, either orientation", () => {
    const view = new FakeView();
    view.matchMedia = undefined as unknown as FakeView["matchMedia"];
    expect(browserFullscreen(view)).toBe(false); // 1280×700 under bars
    view.resize(1280, 800);
    expect(browserFullscreen(view)).toBe(true);
    view.resize(800, 1280); // rotated, the screen size kept portrait
    expect(browserFullscreen(view)).toBe(true);
    view.resize(1279, 799);
    expect(browserFullscreen(view)).toBe(true); // rounding slack
    expect(browserFullscreen(null)).toBe(false);
  });

  it("F11 in and out is noticed on resize, and the next tap asks the API again", async () => {
    const doc = new FakeDoc();
    doc.refuse = true;
    const view = new FakeView();
    const states: string[] = [];
    const fs = new KioskFullscreen(doc, null, (s) => states.push(s), view);
    fs.setEnabled(true);
    expect(fs.state).toBe("off");
    view.resize(1280, 800);
    expect(states.at(-1)).toBe("on");
    view.resize(1280, 700);
    expect(states.at(-1)).toBe("off");
    doc.fire("click");
    await tick();
    expect(doc.requests).toBe(1);
    fs.dispose();
    expect(view.resizes.size).toBe(0);
  });

  it("turning it off never tries to leave a full screen the page didn't make", () => {
    const doc = new FakeDoc();
    const view = new FakeView();
    view.modes.add("(display-mode: fullscreen)");
    const fs = new KioskFullscreen(doc, null, () => {}, view);
    fs.setEnabled(true);
    fs.setEnabled(false);
    expect(doc.exits).toBe(0);
    expect(fs.state).toBe("on"); // still truly full: fs=1, no badge
  });
});
