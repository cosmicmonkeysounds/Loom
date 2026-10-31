//! The audio ads on a wall (wave 59a, `docs/loom-w59-ads-contract.md` C4, C5):
//! the screen state's `ad` says what is on the air, the same instant on every
//! screen, and this says what this screen does about it. `WallAd` is a page
//! singleton: the screen layer can remount between views and the sound must not
//! care. Pure but for the audio element, injected for the tests.

import { AdPlayer, pageAudio, type AdAudio } from "@loom/play/ad-player.ts";
import { AD_JOIN_LEFT_MS, adTerminal, type AdOnAir } from "../../core/src/audio-ads.ts";
import { bleepsOn, roomOf, type TerminalConfig } from "./config.ts";

export { AD_JOIN_LEFT_MS };

/** May this terminal play one at all? The one sacred rule, and this tablet's own
 *  `bleepsOn`: a wall ⚙ turned quiet stays quiet. */
export function adsHere(c: TerminalConfig): boolean {
  return bleepsOn(c) && adTerminal({ view: c.view, spot: c.spot, room: roomOf(c) ?? "" });
}

/** What on this screen stops an ad here. Never a slide: a story slide is the server's
 *  hold everywhere, and one still up when the server lets an ad go (the Y2K clock
 *  stands for an hour) is the room's wallpaper by then. */
export function adCovered(l: { overlay: unknown; glitch: unknown; burst: unknown }): boolean {
  return l.overlay !== null || l.glitch !== null || l.burst !== null;
}

export interface WallAdShown {
  seq: number;
  n: number;
  name: string;
  /** The page refused the sound: the pop-up offers ▶. */
  refused: boolean;
}

export type AdMove = { kind: "start"; ad: AdOnAir; from: number } | { kind: "stop" } | null;

/** What this screen does this beat (pure). */
export class AdMachine {
  private on: number | null = null;
  /** The last ad this screen sat out, or is done with. */
  private spent: number | null = null;

  step(ad: AdOnAir | null, busy: boolean, now: number): AdMove {
    if (this.on !== null && ad?.seq !== this.on) {
      this.on = null;
      return { kind: "stop" };
    }
    if (ad === null || ad.seq === this.spent) return null;
    if (this.on === ad.seq) {
      if (!busy) return null;
      this.on = null;
      this.spent = ad.seq;
      return { kind: "stop" };
    }
    if (busy) {
      // A line up as it starts: this one is skipped, not joined halfway.
      if (now >= ad.at) this.spent = ad.seq;
      return null;
    }
    if (now < ad.at) return null;
    if (ad.until - now < AD_JOIN_LEFT_MS) {
      this.spent = ad.seq;
      return null;
    }
    this.on = ad.seq;
    return { kind: "start", ad, from: Math.max(0, now - ad.at) / 1000 };
  }

  /** × or the track's end: this ad is over on this screen. */
  closed(): void {
    if (this.on !== null) this.spent = this.on;
    this.on = null;
  }
}

export class WallAd {
  shown: WallAdShown | null = null;
  private readonly machine = new AdMachine();
  private readonly player: AdPlayer;
  private readonly subs = new Set<() => void>();
  private playing: { url: string; at: number } | null = null;

  constructor(audio: () => AdAudio | null = pageAudio) {
    this.player = new AdPlayer(audio, (s, done) => {
      if (done) this.close();
      else if (this.shown !== null) this.show({ ...this.shown, refused: s === "refused" });
    });
  }

  readonly subscribe = (f: () => void): (() => void) => {
    this.subs.add(f);
    return () => void this.subs.delete(f);
  };

  readonly current = (): WallAdShown | null => this.shown;

  private show(s: WallAdShown | null): void {
    this.shown = s;
    for (const f of [...this.subs]) f();
  }

  /** One beat: the screen state's ad, and whether this screen is in use. */
  step(ad: AdOnAir | null, busy: boolean, now: number): void {
    const move = this.machine.step(ad, busy, now);
    if (move === null) return;
    this.player.stop();
    if (move.kind === "stop") {
      this.playing = null;
      this.show(null);
      return;
    }
    this.playing = { url: move.ad.url, at: move.ad.at };
    this.show({ seq: move.ad.seq, n: move.ad.n, name: move.ad.name, refused: false });
    this.player.start(move.ad.url, move.from);
  }

  /** ▶, inside a tap: where the ad has got to by `now`. */
  retry(now: number): void {
    if (this.playing !== null) this.player.start(this.playing.url, Math.max(0, now - this.playing.at) / 1000);
  }

  /** ×, or the track's end. */
  close(): void {
    this.machine.closed();
    this.player.stop();
    this.playing = null;
    this.show(null);
  }
}

/** The page's one. */
export const wallAd = new WallAd();

// A board or a hand up (`ChessTerminal`, `CasinoTerminal`: lazy chunks, each with
// its session inside): said here, like `moment-bus.ts`.
let table = false;

export function adTable(on: boolean): void {
  table = on;
}

export function adTableUp(): boolean {
  return table;
}
