// The audio ads (wave 59a, docs/loom-w59-ads-contract.md): the fourteen MP3s in
// their order, how they are paced and who hears them. Browser-safe and pure: the
// server's `AdsHub` (server/audio-ads.ts) keeps the state, the terminals and the
// phones only ever draw and play what it says.

/** Where the MP3s are served (Caddy's `/media/`; `server.ts` with no proxy). */
export const AD_MEDIA_BASE = "/media/ads/";

export interface AudioAd {
  /** 1 to 14: the running order. */
  n: number;
  /** What the pop-up calls it. */
  name: string;
  /** In `~/loom-media/ads` (`scripts/ops/ads-media.sh`). */
  file: string;
  /** How long it is (ffprobe), so a device that never hears `ended` still closes. */
  seconds: number;
}

export const AUDIO_ADS: readonly AudioAd[] = [
  { n: 1, name: "Mommy Intro", file: "ad-01-mommy-intro.mp3", seconds: 83.6 },
  { n: 2, name: "Adobe", file: "ad-02-adobe.mp3", seconds: 73.5 },
  { n: 3, name: "Mizz Butter", file: "ad-03-mizz-butter.mp3", seconds: 64.9 },
  { n: 4, name: "Draft King", file: "ad-04-draft-king.mp3", seconds: 80.6 },
  { n: 5, name: "Mommy Interlude 1", file: "ad-05-mommy-interlude-1.mp3", seconds: 59.8 },
  { n: 6, name: "Ableton Live", file: "ad-06-ableton-live.mp3", seconds: 91.8 },
  { n: 7, name: "Horton Norton", file: "ad-07-horton-norton.mp3", seconds: 54.9 },
  { n: 8, name: "Tippi", file: "ad-08-tippi.mp3", seconds: 63.5 },
  { n: 9, name: "Mommy Interlude 2", file: "ad-09-mommy-interlude-2.mp3", seconds: 102 },
  { n: 10, name: "V", file: "ad-10-v.mp3", seconds: 68.7 },
  { n: 11, name: "Splenda Daddy", file: "ad-11-splenda-daddy.mp3", seconds: 89.5 },
  { n: 12, name: "Steve.exe", file: "ad-12-steve-exe.mp3", seconds: 112.4 },
  { n: 13, name: "Bambi", file: "ad-13-bambi.mp3", seconds: 88.9 },
  { n: 14, name: "Mommy Outro", file: "ad-14-mommy-outro.mp3", seconds: 91.9 },
];

/** The first ad starts at least this long into the hunt (story ms). */
export const ADS_FIRST_MS = 60_000;
/** One starts about this often (story ms): start to start, so 14 fit the hour. */
export const ADS_EVERY_MS = 210_000;
/** Every screen is told this long ahead, so a wall's 2 s poll still starts on the beat. */
export const AD_LEAD_MS = 3_000;
/** A house announcement holds the ads this long from when it is said. */
export const AD_ANNOUNCE_HOLD_MS = 15_000;
/** How long a read on the teleprompter may hold them: a phone left on a finished
 *  script must not keep the whole list off the air. */
export const AD_READING_HOLD_MS = 5 * 60_000;
/** A phone that can't take an ad is replaced only while this much of it is left. */
export const AD_REPLACE_LEFT_MS = 20_000;
/** At least this many phones an ad, where there are that many. */
export const AD_PHONES_MIN = 3;

/** Journaled: an ad went on the air. No story hook hears it. */
export const AD_AIRED_SIGNAL = "audio_ad_aired";
/** Journaled: a director's 📢 On / Off. No story hook hears it. */
export const ADS_SWITCH_SIGNAL = "audio_ads_switched";

/** The story's phase the ads run in (the second hunt's hour). */
export const ADS_PHASE = "hunt_2";

/** Spots that never play one: the TV's sound is Trabolta's channel on every house
 *  speaker, and the server room is his. */
export const AD_QUIET_SPOTS: readonly string[] = ["desktop-tv", "server-room"];

/** A terminal the server offers an ad to, whatever its own ⚙ says. */
export function adTerminal(t: { view: string; spot: string; room?: string | undefined }): boolean {
  return t.view !== "tv" && t.view !== "mirror" && (t.room ?? "") === "" && !AD_QUIET_SPOTS.includes(t.spot.trim());
}

/** How many of `phones` hear an ad: a third, at least `AD_PHONES_MIN`, never more than there are. */
export function adPhoneCount(phones: number): number {
  return Math.min(phones, Math.max(AD_PHONES_MIN, Math.ceil(phones / 3)));
}

/** Why nothing may start now, and what stops one on the air. */
export type AdHold = "doors" | "talk" | "reading" | "announcement" | "cutscene" | "blackout" | "truther";

/** One ad on the air, as a terminal reads it off the screen state. `seq` is its
 *  start in server ms, so it is unique across restarts and story reloads. */
export interface AdOnAir {
  seq: number;
  n: number;
  name: string;
  url: string;
  /** When the sound starts (server ms). */
  at: number;
  /** When it is over (server ms). */
  until: number;
}

/** The `ad` stream frame: one phone's turn, or everyone stops. Words ride the
 *  frame, so an old phone that ignores it loses nothing. */
export type AdFrame = { stop: true } | { seq: number; n: number; name: string; url: string; in: number; from: number; left: number };

/** What Run → Terminals reads. */
export interface AdsStatus {
  on: boolean;
  /** How many have gone out. */
  aired: number;
  total: number;
  /** The name on the air, or null. */
  playing: string | null;
  /** The hunt's hour is running. */
  running: boolean;
  /** Why the next one waits, or null. */
  hold: AdHold | null;
}
