//! The audio ads on the server (wave 59a, `docs/loom-w59-ads-contract.md`):
//! transport-free, clock injected, so tests drive it with no HTTP. It answers
//! what goes on the air and when; `EventRuntime` journals the answer, carries it
//! to the phones (the `ad` stream frame) and to the walls (the screen state).
//!
//! What is journaled: each ad that goes on the air and each 📢 On / Off, as
//! `signal`s no story hook hears, so a server restart resumes the list (the
//! replay calls `aired` / `switched`) and a story reload clears it (`reset`).
//! Memory only: what is on the air (a restart cuts it; the next comes at its
//! pace), the phones' rotation (a restart starts it again) and the announcement
//! and reading holds.
//!
//! Story time paces the list: it stops with the doors, and it is what a replay
//! lands on. Nothing here reaches the story, Trabolta's worker or the chat.

import { ADS_EVERY_MS, ADS_FIRST_MS, AD_LEAD_MS, AD_MEDIA_BASE, AD_REPLACE_LEFT_MS, AUDIO_ADS, adPhoneCount, type AdFrame, type AdHold, type AdOnAir, type AdsStatus } from "../src/audio-ads.ts";

/** A phone says it can't take the ad it was offered. */
export const AD_BUSY_ROUTE = "/api/ad/busy";
/** A director's 📢 On / Off. */
export const ADS_MOD_ROUTE = "/api/mod/screen/ads";

export interface AdsNow {
  /** Server ms. */
  now: number;
  /** The story clock (ms). */
  story: number;
  /** The second hunt's hour is on, before the summons. */
  running: boolean;
  /** What holds them now, or null. */
  hold: AdHold | null;
}

export type AdStep = { kind: "start"; ad: AdOnAir } | { kind: "stop" } | null;

export class AdsHub {
  /** The kill switch. */
  on = true;
  /** How many have gone out: the next is `AUDIO_ADS[aired]`. */
  aired = 0;
  /** What is on the air now. */
  air: AdOnAir | null = null;
  /** The story clock at the last start. */
  private lastAt: number | null = null;
  /** The story clock when this process first saw the hour running. */
  private openedAt: number | null = null;
  /** Each phone's last turn: the ad's `n`. A phone that never had one goes first. */
  private readonly turns = new Map<string, number>();
  /** Who has been offered the ad on the air. */
  private readonly offered = new Set<string>();
  private last: { running: boolean; hold: AdHold | null } = { running: false, hold: null };

  /** One beat of the clock: what changes on the air now. */
  tick(n: AdsNow): AdStep {
    this.last = { running: n.running, hold: n.hold };
    if (this.air !== null && n.now >= this.air.until) this.clearAir();
    if (!n.running) {
      this.openedAt = null;
      return this.cut();
    }
    this.openedAt ??= n.story;
    if (n.hold !== null || !this.on) return this.cut();
    if (this.air !== null || this.aired >= AUDIO_ADS.length) return null;
    const due = this.lastAt === null ? this.openedAt + ADS_FIRST_MS : this.lastAt + ADS_EVERY_MS;
    if (n.story < due) return null;
    const ad = AUDIO_ADS[this.aired]!;
    const at = n.now + AD_LEAD_MS;
    this.aired += 1;
    this.lastAt = n.story;
    this.air = { seq: at, n: ad.n, name: ad.name, url: `${AD_MEDIA_BASE}${ad.file}`, at, until: at + Math.round(ad.seconds * 1000) };
    return { kind: "start", ad: this.air };
  }

  /** Stop what is on the air. It stays spent: the list moves on. */
  cut(): AdStep {
    if (this.air === null) return null;
    this.clearAir();
    return { kind: "stop" };
  }

  /** The director's switch (`on` = the next in the list, at its pace). */
  setOn(on: boolean): AdStep {
    this.on = on;
    return on ? null : this.cut();
  }

  /** A journaled ad, replayed: `n` is out, at story time `at`. */
  replayAired(n: number, at: number): void {
    if (!Number.isInteger(n) || n < 1 || n > AUDIO_ADS.length) return;
    this.aired = Math.max(this.aired, n);
    this.lastAt = at;
  }

  /** A journaled switch, replayed. */
  replaySwitched(on: boolean): void {
    this.on = on;
  }

  /** A story reload: the list starts over, switched on. */
  reset(): void {
    this.on = true;
    this.aired = 0;
    this.lastAt = null;
    this.openedAt = null;
    this.turns.clear();
    this.last = { running: false, hold: null };
    this.clearAir();
  }

  /** The phones whose turn it is, out of `phones` (those that can take one now). */
  pick(phones: readonly string[]): string[] {
    const air = this.air;
    if (air === null) return [];
    const order = phones.map((id, i) => ({ id, i, turn: this.turns.get(id) ?? 0 })).sort((a, b) => a.turn - b.turn || a.i - b.i);
    const chosen = order.slice(0, adPhoneCount(phones.length)).map((p) => p.id);
    for (const id of chosen) this.give(id, air);
    return chosen;
  }

  /**
   * `who` can't take the ad on the air: it keeps its place in the line, and
   * the next phone that hasn't been offered this one takes over. Null: none
   * left, it is too late, or `who` was never offered this ad (`seq`).
   */
  replace(who: string, seq: number, phones: readonly string[], now: number): string | null {
    const air = this.air;
    if (air === null || air.seq !== seq || !this.offered.has(who)) return null;
    this.turns.set(who, 0);
    if (air.until - now < AD_REPLACE_LEFT_MS) return null;
    const next = phones.filter((id) => !this.offered.has(id)).sort((a, b) => (this.turns.get(a) ?? 0) - (this.turns.get(b) ?? 0))[0];
    if (next === undefined) return null;
    this.give(next, air);
    return next;
  }

  /** The frame that hands the ad on the air to a phone now. */
  frame(now: number): AdFrame | null {
    const a = this.air;
    if (a === null) return null;
    return { seq: a.seq, n: a.n, name: a.name, url: a.url, in: Math.max(0, a.at - now), from: Math.max(0, now - a.at) / 1000, left: Math.max(0, a.until - Math.max(now, a.at)) };
  }

  /** Run → Terminals. */
  status(): AdsStatus {
    return { on: this.on, aired: this.aired, total: AUDIO_ADS.length, playing: this.air?.name ?? null, running: this.last.running, hold: this.last.hold };
  }

  private give(id: string, air: AdOnAir): void {
    this.offered.add(id);
    this.turns.set(id, air.n);
  }

  private clearAir(): void {
    this.air = null;
    this.offered.clear();
  }
}
