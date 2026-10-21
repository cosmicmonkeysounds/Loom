//! Full screen by default (wave 17, D7). A browser enters full screen only
//! from a user gesture, and drops it on a reload, a navigation or Esc — so
//! **every** gesture while not full screen asks again (a capture-phase
//! listener that outlives the wake tap), with the `webkit` spellings for
//! Safari / older WebViews. Fully Kiosk's JavaScript Interface, where the
//! page runs inside it, is asked to hide the system bars too (feature
//! checks only: older Fully builds lack some calls). The TV's Chrome still
//! launches with `--kiosk` (`docs/trapped/kiosk.md`): that is the only
//! no-gesture route.
//!
//! Stored per terminal (`TerminalConfig.fullscreen`, on by default, ⚙ to
//! turn off — a director testing on a laptop wants Esc to stick). The state
//! rides on `<html data-fullscreen="on|fully|off|disabled|unsupported">` and
//! the poll's health (`fs=1|0`, `health.ts`). Pure over injected seams like
//! `ScreenWake`, so it tests without a DOM.

/** The element full screen is asked for (the page's root). */
export interface FullscreenTarget {
  requestFullscreen?: (opts?: { navigationUI?: "hide" | "show" | "auto" }) => Promise<void> | void;
  webkitRequestFullscreen?: () => void;
}

/** The slice of `document` used here. */
export interface FullscreenDoc {
  readonly fullscreenElement?: unknown;
  readonly webkitFullscreenElement?: unknown;
  readonly fullscreenEnabled?: boolean;
  readonly webkitFullscreenEnabled?: boolean;
  readonly documentElement: FullscreenTarget;
  /** The focused element: a tap that opens the keyboard is left alone. */
  readonly activeElement?: { tagName?: string } | null;
  exitFullscreen?: () => Promise<void> | void;
  webkitExitFullscreen?: () => void;
  addEventListener(type: string, listener: (e: GestureLike) => void, capture?: boolean): void;
  removeEventListener(type: string, listener: (e: GestureLike) => void, capture?: boolean): void;
}

/** What a listener reads off an event. */
export interface GestureLike {
  type: string;
  key?: string;
  pointerType?: string;
}

/** Fully Kiosk's JS Interface calls this may use (each one checked before calling). */
export interface FullyLike {
  hideStatusBar?: () => void;
  hideNavigationBar?: () => void;
  showStatusBar?: () => void;
  showNavigationBar?: () => void;
}

export type FullscreenState = "on" | "fully" | "off" | "disabled" | "unsupported";

/** The gestures that carry user activation (pointerdown counts only for a
 *  mouse; a finger's is pointerup / touchend / click). */
export const GESTURES = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
const CHANGES = ["fullscreenchange", "webkitfullscreenchange"] as const;
const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export class KioskFullscreen {
  private enabled = false;
  private listening = false;
  private pending: Promise<boolean> | null = null;
  private fullyAsked = false;
  private readonly onGesture = (e: GestureLike): void => {
    if (e.type === "keydown" && e.key === "Escape") return; // Esc is the way out, not back in
    // A finger's pointerdown carries no activation: its pointerup / touchend will.
    if (e.type === "pointerdown" && e.pointerType !== undefined && e.pointerType !== "mouse") return;
    void this.request();
  };
  private readonly onChanged = (): void => this.report();

  constructor(
    private readonly doc: FullscreenDoc,
    private readonly fully: FullyLike | null = null,
    /** Told the state whenever it may have moved. */
    private readonly onChange: (s: FullscreenState) => void = () => {},
  ) {
    for (const t of CHANGES) doc.addEventListener(t, this.onChanged);
    this.report();
  }

  /** Can this page go full screen at all (the API, or Fully's bars)? */
  get supported(): boolean {
    const el = this.doc.documentElement;
    const api = typeof el.requestFullscreen === "function" || typeof el.webkitRequestFullscreen === "function";
    const allowed = this.doc.fullscreenEnabled !== false || this.doc.webkitFullscreenEnabled === true;
    return (api && allowed) || this.hasFully;
  }

  /** Is the page full screen right now (the API's element, or Fully's bars hidden)? */
  get active(): boolean {
    return this.isFull() || (this.hasFully && this.fullyAsked);
  }

  get state(): FullscreenState {
    if (!this.supported) return "unsupported";
    if (!this.enabled) return this.isFull() ? "on" : "disabled";
    if (this.isFull()) return "on";
    return this.hasFully && this.fullyAsked ? "fully" : "off";
  }

  /** On (the default): ask on every gesture from now on. Off: stop asking and leave full screen. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on && !this.listening) {
      for (const g of GESTURES) this.doc.addEventListener(g, this.onGesture, true);
      this.listening = true;
    } else if (!on && this.listening) {
      for (const g of GESTURES) this.doc.removeEventListener(g, this.onGesture, true);
      this.listening = false;
    }
    if (!on) {
      if (this.isFull()) this.exit();
      if (this.fullyAsked) this.showFullyBars();
    }
    this.report();
  }

  /**
   * Ask for full screen — call from a gesture (a tap, a key). Resolves to
   * whether the page is full screen after. Never throws: outside a gesture
   * the browser just refuses, and the next tap asks again.
   */
  request(): Promise<boolean> {
    if (!this.enabled || !this.supported) return Promise.resolve(this.isFull());
    this.hideFullyBars();
    if (this.isFull()) return Promise.resolve(true);
    const typing = this.doc.activeElement?.tagName;
    if (typing !== undefined && TYPING.has(typing.toUpperCase())) return Promise.resolve(false);
    if (this.pending !== null) return this.pending;
    const el = this.doc.documentElement;
    let asked: Promise<void> | void;
    try {
      if (typeof el.requestFullscreen === "function") asked = el.requestFullscreen({ navigationUI: "hide" });
      else if (typeof el.webkitRequestFullscreen === "function") asked = el.webkitRequestFullscreen();
      else {
        this.report();
        return Promise.resolve(this.active);
      }
    } catch {
      this.report();
      return Promise.resolve(false);
    }
    this.pending = Promise.resolve(asked)
      .then(
        () => this.isFull() || typeof el.requestFullscreen !== "function", // webkit answers later, by event
        () => false,
      )
      .finally(() => {
        this.pending = null;
        this.report();
      });
    return this.pending;
  }

  /** Stop listening (tests; a page that goes away). */
  dispose(): void {
    if (this.listening) for (const g of GESTURES) this.doc.removeEventListener(g, this.onGesture, true);
    for (const t of CHANGES) this.doc.removeEventListener(t, this.onChanged);
    this.listening = false;
  }

  private get hasFully(): boolean {
    return this.fully !== null && (typeof this.fully.hideStatusBar === "function" || typeof this.fully.hideNavigationBar === "function");
  }

  private isFull(): boolean {
    const d = this.doc;
    return (d.fullscreenElement !== undefined && d.fullscreenElement !== null) || (d.webkitFullscreenElement !== undefined && d.webkitFullscreenElement !== null);
  }

  private exit(): void {
    try {
      if (typeof this.doc.exitFullscreen === "function") void Promise.resolve(this.doc.exitFullscreen()).catch(() => {});
      else if (typeof this.doc.webkitExitFullscreen === "function") this.doc.webkitExitFullscreen();
    } catch {
      /* already out */
    }
  }

  private hideFullyBars(): void {
    if (!this.hasFully || this.fullyAsked) return;
    this.fullyAsked = true;
    try {
      this.fully?.hideStatusBar?.();
      this.fully?.hideNavigationBar?.();
    } catch {
      /* an older Fully: its own settings hide the bars */
    }
  }

  private showFullyBars(): void {
    this.fullyAsked = false;
    try {
      this.fully?.showStatusBar?.();
      this.fully?.showNavigationBar?.();
    } catch {
      /* fine */
    }
  }

  private report(): void {
    this.onChange(this.state);
  }
}

let shared: KioskFullscreen | null = null;

/** The page's one full-screen keeper; its state rides on `<html data-fullscreen>`. */
export function kioskFullscreen(): KioskFullscreen {
  if (shared === null) {
    const root = document.documentElement;
    const fully = (window as unknown as { fully?: FullyLike }).fully ?? null;
    shared = new KioskFullscreen(document as unknown as FullscreenDoc, fully, (s) => {
      root.dataset.fullscreen = s;
    });
  }
  return shared;
}

/**
 * A state as the poll's health flag: full screen (true), asked for and not
 * full screen (false — worth a badge), else null: it can't be
 * (`unsupported`) or a director turned it off (`disabled`), so no `fs` is sent.
 */
export function fullscreenFlagOf(s: FullscreenState): boolean | null {
  if (s === "on" || s === "fully") return true;
  return s === "off" ? false : null;
}

/** For the poll's health: `fullscreenFlagOf` the page's keeper (null before it starts). */
export function fullscreenFlag(): boolean | null {
  return shared === null ? null : fullscreenFlagOf(shared.state);
}
