// The audio ads on a phone (wave 59a, docs/loom-w59-ads-contract.md C4, C5). The
// server picks the phones and says `ad`; this store plays one, or says it can't.
// One per session, like the teleprompter's: never a module global, so Run →
// Players' panes (which never arm) stay silent.

import type { AdFrame } from "../../core/src/audio-ads.ts";
import { AdPlayer, pageAudio, type AdAudio, type AdSound } from "./ad-player.ts";

export type AdOffer = Exclude<AdFrame, { stop: true }>;

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
  private startedAt = 0;
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
    const ask = { capture: true, passive: true };
    document.addEventListener("touchend", tap, ask);
    document.addEventListener("click", tap, ask);
    return () => {
      this.tell = null;
      this.end();
      document.removeEventListener("touchend", tap, ask);
      document.removeEventListener("click", tap, ask);
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

  /** The stream's `ad` frame. Nothing armed: not this phone's to answer. */
  take(f: AdFrame): void {
    if ("stop" in f) return this.end();
    if (this.tell === null) return;
    if (this.cannot()) return this.tell(f.seq);
    this.end();
    this.offer = f;
    this.timer = setTimeout(() => this.begin(f), f.in);
  }

  private begin(f: AdOffer): void {
    this.timer = null;
    if (this.cannot()) {
      this.offer = null;
      this.tell?.(f.seq);
      return;
    }
    this.startedAt = Date.now();
    this.show({ seq: f.seq, n: f.n, name: f.name, refused: false });
    this.closer = setTimeout(() => this.end(), f.left + AD_OVERRUN_MS);
    this.player.start(f.url, f.from);
  }

  /** ▶, inside a tap: where the ad has got to by now. */
  retry(): void {
    const f = this.offer;
    if (f !== null) this.player.start(f.url, f.from + (Date.now() - this.startedAt) / 1000);
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
