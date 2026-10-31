// The audio ads' one audio element (wave 59a, docs/loom-w59-ads-contract.md C5),
// the phone's and the wall terminal's: an iPhone lets an element play by itself
// only once a tap has played it, so a page keeps one element and swaps its
// source. A refused play is never an error: `refused`, and a tap can try again.

export type AdSound = "idle" | "playing" | "refused";

/** What it asks of an `HTMLAudioElement`. */
export interface AdAudio {
  src: string;
  preload: string;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play(): Promise<void> | undefined;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
}

/** A sliver of silence, for the first tap (the CSP's `media-src data:`). */
export const AD_SILENCE =
  "data:audio/wav;base64,UklGRoQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YWAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=";

/** This page's element, or null where there is none (a test, an old page). */
export function pageAudio(): AdAudio | null {
  return typeof Audio === "function" ? (new Audio() as unknown as AdAudio) : null;
}

export class AdPlayer {
  private el: AdAudio | null = null;
  private run = 0;
  private unlocked = false;
  private sound: AdSound = "idle";
  private readonly make: () => AdAudio | null;
  private readonly told: (s: AdSound, done: boolean) => void;

  /** `told`: the sound changed, or (`done`) it is over: the track ended, or its file failed. */
  constructor(make: () => AdAudio | null, told: (s: AdSound, done: boolean) => void) {
    this.make = make;
    this.told = told;
  }

  private audio(): AdAudio | null {
    if (this.el === null) {
      this.el = this.make();
      if (this.el !== null) this.el.preload = "none";
    }
    return this.el;
  }

  private set(s: AdSound, done = false): void {
    this.sound = s;
    this.told(s, done);
  }

  /** Call inside a tap. Nothing is heard; the element may play by itself from now on. */
  unlock(): void {
    if (this.unlocked || this.sound !== "idle") return;
    const a = this.audio();
    if (a === null) return;
    try {
      a.src = AD_SILENCE;
      const p = a.play();
      if (p === undefined) this.unlocked = true;
      else void p.then(() => void (this.unlocked = true), () => {});
    } catch {
      /* the next tap tries again */
    }
  }

  /** Play `url` from `from` seconds in. */
  start(url: string, from = 0): void {
    const run = ++this.run;
    const a = this.audio();
    if (a === null) return this.set("refused");
    const over = () => {
      if (run === this.run) this.set("idle", true);
    };
    a.onended = over;
    a.onerror = over;
    a.src = from >= 1 ? `${url}#t=${from.toFixed(1)}` : url;
    let p: Promise<void> | undefined;
    try {
      p = a.play();
    } catch {
      return this.set("refused");
    }
    if (p === undefined) return this.set("playing");
    void p.then(
      () => {
        if (run === this.run) this.set("playing");
      },
      (e: unknown) => {
        if (run !== this.run) return;
        // No gesture yet: a tap can try again. Anything else (no file): over, quietly.
        if ((e as { name?: unknown } | null)?.name === "NotAllowedError") this.set("refused");
        else this.set("idle", true);
      },
    );
  }

  /** Silence, now. The element stays this page's, ready for the next one. */
  stop(): void {
    this.run += 1;
    const a = this.el;
    if (a !== null) {
      a.onended = null;
      a.onerror = null;
      try {
        a.pause();
        a.removeAttribute("src");
        a.load();
      } catch {
        /* an element going away is silent anyway */
      }
    }
    this.sound = "idle";
  }
}
