//! The audio ads on the server (wave 59a, `docs/loom-w59-ads-contract.md`):
//! transport-free, clock and dice injected, so tests drive it with no HTTP. It
//! answers what goes on the air, when, and who gets it; `EventRuntime` journals the
//! answer, carries it to the phones (the `ad` stream frame) and to the walls (the
//! screen state's `ad`, to the walls this pop picked).
//!
//! Random three ways: which ad (none repeats until all 14 have played), the gap to
//! the next (3 to 10 minutes, drawn fresh), and who hears it (1 to 3 walls, a quarter
//! of the phones, drawn fresh). A pop that can't start waits and starts as soon as it
//! can; it doesn't skip a gap.
//!
//! What is journaled: each ad that goes on the air and each 📢 On / Off, as `signal`s
//! no story hook hears, so a server restart keeps the pass and the switch (the replay
//! calls `replayAired` / `replaySwitched`) and a story reload clears them (`reset`).
//! Memory only: what is on the air and who got it (a restart cuts it, and a stop goes
//! to each stream as it reopens), the drawn gap (a restart draws again from the last
//! pop) and the announcement hold.
//!
//! Story time paces it: it stops with the doors, and it is what a replay lands on.
//! Nothing here reaches the story, Trabolta's worker or the chat.

import { ADS_GAP_MAX_MS, ADS_GAP_MIN_MS, AD_LEAD_MS, AD_MEDIA_BASE, AD_REPLACE_LEFT_MS, AUDIO_ADS, adPhoneCount, adWallCount, type AdFrame, type AdHold, type AdOffer, type AdOnAir, type AdsStatus, type AudioAd } from "../src/audio-ads.ts";

/** A phone says it can't take the ad it was offered. */
export const AD_BUSY_ROUTE = "/api/ad/busy";
/** A director's 📢 On / Off. */
export const ADS_MOD_ROUTE = "/api/mod/screen/ads";

export interface AdsNow {
  /** Server ms. */
  now: number;
  /** The story clock (ms). */
  story: number;
  /** The window is open: the second hunt on, before the final reveal or an ending. */
  running: boolean;
  /** What holds them now, or null. */
  hold: AdHold | null;
  /** The walls that could play one now, by name. */
  walls: readonly string[];
  /** The phones that could take one now. */
  phones: readonly string[];
}

export type AdStep = { kind: "start"; ad: AdOnAir; phones: string[] } | { kind: "stop" } | null;

export interface AdsGap {
  min: number;
  max: number;
}

/** `LOOM_ADS_GAP_S=20-40`: a scratch server's short gaps, so `scripts/sim/ads.spec.ts`
 *  can see several pops. Anything else, or nothing, is the show's 3 to 10 minutes. */
export function adsGapOf(env: string | undefined): AdsGap {
  const m = /^(\d+)-(\d+)$/u.exec(env ?? "");
  const [min, max] = [Number(m?.[1]), Number(m?.[2])];
  return m !== null && min >= 1 && max >= min ? { min: min * 1000, max: max * 1000 } : { min: ADS_GAP_MIN_MS, max: ADS_GAP_MAX_MS };
}

/** `k` of `list`, at random, in no order. */
function sample<T>(list: readonly T[], k: number, rand: () => number): T[] {
  const pool = [...list];
  const out: T[] = [];
  while (out.length < k && pool.length > 0) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
  return out;
}

export class AdsHub {
  /** The kill switch. */
  on = true;
  /** How many have gone out tonight. */
  aired = 0;
  /** What is on the air now. */
  air: AdOnAir | null = null;
  /** What has played in this pass: none repeats until all 14 have. */
  private readonly played = new Set<number>();
  /** The last one played, so a new pass doesn't open on it. */
  private lastN: number | null = null;
  /** The story clock at the last start. */
  private lastAt: number | null = null;
  /** The story clock when this process first saw the window open. */
  private openedAt: number | null = null;
  /** The story clock the next is due at: drawn once, from the last pop. */
  private dueAt: number | null = null;
  /** The walls this pop picked. */
  private readonly walls = new Set<string>();
  /** Who has been offered the ad on the air. */
  private readonly offered = new Set<string>();

  constructor(
    private readonly rand: () => number = Math.random,
    private readonly gap: AdsGap = { min: ADS_GAP_MIN_MS, max: ADS_GAP_MAX_MS },
  ) {}

  /** One beat of the clock: what changes on the air now. */
  tick(n: AdsNow): AdStep {
    if (this.air !== null && n.now >= this.air.until) this.clearAir();
    if (!n.running) {
      this.openedAt = null;
      this.dueAt = null;
      return this.cut();
    }
    this.openedAt ??= n.story;
    if (n.hold !== null || !this.on) return this.cut();
    if (this.air !== null) return null;
    this.dueAt ??= (this.lastAt ?? this.openedAt) + this.gap.min + this.rand() * (this.gap.max - this.gap.min);
    if (n.story < this.dueAt || (n.walls.length === 0 && n.phones.length === 0)) return null;
    return this.start(n);
  }

  private start(n: AdsNow): AdStep {
    const ad = this.nextAd();
    const at = n.now + AD_LEAD_MS;
    this.note(ad.n, n.story);
    this.air = { seq: at, n: ad.n, name: ad.name, url: `${AD_MEDIA_BASE}${ad.file}`, at, until: at + Math.round(ad.seconds * 1000) };
    for (const w of sample(n.walls, adWallCount(n.walls.length, this.rand()), this.rand)) this.walls.add(w);
    const phones = sample(n.phones, adPhoneCount(n.phones.length), this.rand);
    for (const p of phones) this.offered.add(p);
    return { kind: "start", ad: this.air, phones };
  }

  /** At random from what this pass hasn't played; a new pass, once all have. */
  private nextAd(): AudioAd {
    const left = AUDIO_ADS.filter((a) => !this.played.has(a.n));
    const pool = left.length > 0 ? left : AUDIO_ADS.filter((a) => a.n !== this.lastN);
    return pool[Math.floor(this.rand() * pool.length)]!;
  }

  private note(n: number, story: number): void {
    if (this.played.size >= AUDIO_ADS.length) this.played.clear();
    this.played.add(n);
    this.aired += 1;
    this.lastN = n;
    this.lastAt = story;
    this.dueAt = null;
  }

  /** Stop what is on the air. It stays spent. */
  cut(): AdStep {
    if (this.air === null) return null;
    this.clearAir();
    return { kind: "stop" };
  }

  /** The director's switch. On: the next as soon as its time has come. */
  setOn(on: boolean): void {
    this.on = on;
    if (!on) this.cut();
  }

  /** A journaled ad, replayed: `n` went out at story time `at`. */
  replayAired(n: number, at: number): void {
    if (Number.isInteger(n) && n >= 1 && n <= AUDIO_ADS.length) this.note(n, at);
  }

  /** A journaled switch, replayed. */
  replaySwitched(on: boolean): void {
    this.on = on;
  }

  /** A story reload: a new night, switched on. */
  reset(): void {
    this.on = true;
    this.aired = 0;
    this.played.clear();
    this.lastN = null;
    this.lastAt = null;
    this.openedAt = null;
    this.dueAt = null;
    this.clearAir();
  }

  /** The ad on the air, if this pop picked this wall. */
  onWall(name: string): AdOnAir | null {
    return this.walls.has(name) ? this.air : null;
  }

  /**
   * `who` can't take the ad on the air: another phone at random, not yet offered
   * this one, takes over. Null: none left, it is too late, or `who` was never
   * offered this ad (`seq`).
   */
  replace(who: string, seq: number, phones: readonly string[], now: number): string | null {
    const air = this.air;
    if (air === null || air.seq !== seq || !this.offered.has(who) || air.until - now < AD_REPLACE_LEFT_MS) return null;
    const next = sample(phones.filter((id) => !this.offered.has(id)), 1, this.rand)[0];
    if (next === undefined) return null;
    this.offered.add(next);
    return next;
  }

  /** The frame that hands the ad on the air to a phone. */
  frame(now: number): AdOffer | null {
    const a = this.air;
    return a === null ? null : { seq: a.seq, n: a.n, name: a.name, url: a.url, at: a.at, until: a.until, now };
  }

  /** The frame a stream opens on: the server's time, and with nothing on the air a
   *  stop, so a phone a restart forgot about falls silent. */
  hello(now: number): AdFrame {
    return this.air === null ? { stop: true, now } : { now };
  }

  /** Run → Terminals. The window and the hold are read when it asks: nothing ticks
   *  behind paused doors. */
  status(running: boolean, hold: AdHold | null): AdsStatus {
    return { on: this.on, aired: this.aired, total: AUDIO_ADS.length, playing: this.air?.name ?? null, running, hold };
  }

  private clearAir(): void {
    this.air = null;
    this.offered.clear();
    this.walls.clear();
  }
}
