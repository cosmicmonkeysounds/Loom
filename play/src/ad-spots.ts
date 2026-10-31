// The audio ads on a phone (wave 59a, docs/loom-w59-ads-contract.md C4, C5). The
// server picks the phones and says `ad`; this store plays one, or says it can't.
// One per session, like the teleprompter's: never a module global, so Run →
// Players' panes (which never arm) stay silent.

import { AD_JOIN_LEFT_MS, type AdFrame, type AdOffer } from "../../core/src/audio-ads.ts";
import { AdPlayer, pageAudio, type AdAudio, type AdSound } from "./ad-player.ts";

export type { AdOffer };

/** The pop-up, while one is up. */
export interface AdShown {
  seq: number;
  n: number;
  name: string;
  /** The phone refused to play it: the pop-up offers ▶. */
  refused: boolean;
}

/** A pop-up whose `ended` never came closes this long after its time (ms). */
const AD_OVERRUN_MS = 3_000;

export class AdSpots {
  private shownNow: AdShown | null = null;
  private busy = false;
  private tell: ((seq: number) => void) | null = null;
  private offer: AdOffer | null = null;
  /** Server ms minus this phone's: the largest seen (`clock`). */
  private skew: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closer: ReturnType<typeof setTimeout> | null = null;
  private readonly subs = new Set<() => void>();
  private readonly player: AdPlayer;

  constructor(audio: () => AdAudio | null = pageAudio) {
    this.player = new AdPlayer(audio, (s, done) => this.heard(s, done));
  }

  readonly subscribe = (f: () => void): (() => void) => {
    this.subs.add(f);
    return () => this.subs.delete(f);
  };

  readonly shown = (): AdShown | null => this.shownNow;

  private show(s: AdShown | null): void {
    this.shownNow = s;
    for (const f of [...this.subs]) f();
  }

  private heard(s: AdSound, done: boolean): void {
    if (done) this.end();
    else if (this.shownNow !== null) this.show({ ...this.shownNow, refused: s === "refused" });
  }

  /** The app's slot is mounted: this phone takes ads. `tell` says it can't take
   *  one. Its first tap, anywhere, unlocks the element; returns the disarm. */
  arm(tell: (seq: number) => void): () => void {
    this.tell = tell;
    const tap = () => this.player.unlock();
    // A page that goes hidden is busy like any other (C4): no sound nobody asked for
    // from a pocket. One still in its lead tells the server at `begin`.
    const seen = () => {
      if (document.hidden && this.shownNow !== null) this.end();
    };
    const ask = { capture: true, passive: true };
    document.addEventListener("touchend", tap, ask);
    document.addEventListener("click", tap, ask);
    document.addEventListener("visibilitychange", seen);
    return () => {
      this.tell = null;
      this.end();
      document.removeEventListener("touchend", tap, ask);
      document.removeEventListener("click", tap, ask);
      document.removeEventListener("visibilitychange", seen);
    };
  }

  /** What is on screen now: busy, this phone takes nothing, and a pop-up up goes. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    if (busy) this.end();
  }

  private cannot(): boolean {
    return this.busy || (typeof document !== "undefined" && document.hidden);
  }

  /** Every frame says the server's time. A frame that sat in a sleeping phone's
   *  queue reads far below the rest, so the largest gap is the true one. */
  private clock(sent: number): void {
    const skew = sent - Date.now();
    if (this.skew === null || skew > this.skew) this.skew = skew;
  }

  private serverNow(): number {
    return Date.now() + (this.skew ?? 0);
  }

  /** The stream's `ad` frame. Nothing armed: not this phone's to answer. */
  take(f: AdFrame): void {
    this.clock(f.now);
    if (!("seq" in f)) {
      if (f.stop === true) this.end();
      return;
    }
    if (this.tell === null) return;
    // A frame this phone slept through: the ad is over, or as good as, so nothing
    // starts alone with nothing on the air, and nobody needs telling.
    const now = this.serverNow();
    if (f.until - now < AD_JOIN_LEFT_MS) return;
    if (this.cannot()) return this.tell(f.seq);
    this.end();
    this.offer = f;
    this.timer = setTimeout(() => this.begin(f), Math.max(0, f.at - now));
  }

  private begin(f: AdOffer): void {
    this.timer = null;
    const now = this.serverNow();
    if (f.until - now < AD_JOIN_LEFT_MS) {
      this.offer = null;
      return;
    }
    if (this.cannot()) {
      this.offer = null;
      this.tell?.(f.seq);
      return;
    }
    this.show({ seq: f.seq, n: f.n, name: f.name, refused: false });
    this.closer = setTimeout(() => this.end(), f.until - now + AD_OVERRUN_MS);
    this.player.start(f.url, Math.max(0, now - f.at) / 1000);
  }

  /** ▶, inside a tap: where the ad has got to by now. */
  retry(): void {
    const f = this.offer;
    if (f !== null) this.player.start(f.url, Math.max(0, this.serverNow() - f.at) / 1000);
  }

  /** × , the track's end, a stop, a sign-out: silence, and no pop-up. */
  end(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.closer !== null) clearTimeout(this.closer);
    this.timer = null;
    this.closer = null;
    this.offer = null;
    this.player.stop();
    if (this.shownNow !== null) this.show(null);
  }
}

// An open card: nothing floats over it, and the moments engine doesn't hold for
// one, so the tray says so here. Only a real phone plays, so one count will do.
let cards = 0;
const cardSubs = new Set<() => void>();

/** A card opened; returns its close. */
export function adCardOpen(): () => void {
  cards += 1;
  for (const f of [...cardSubs]) f();
  return () => {
    cards -= 1;
    for (const f of [...cardSubs]) f();
  };
}

export const adCardsOpen = (): boolean => cards > 0;

export function onAdCards(f: () => void): () => void {
  cardSubs.add(f);
  return () => void cardSubs.delete(f);
}
