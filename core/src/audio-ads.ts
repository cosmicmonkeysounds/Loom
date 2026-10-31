// The audio ads (wave 59a, docs/loom-w59-ads-contract.md): the fourteen MP3s, how
// they are paced and who may hear one. Browser-safe and pure: the server's `AdsHub`
// (server/audio-ads.ts) keeps the state and draws the dice, the terminals and the
// phones only ever draw and play what it says.

/** Where the MP3s are served (Caddy's `/media/`; `server.ts` with no proxy). */
export const AD_MEDIA_BASE = "/media/ads/";

export interface AudioAd {
  /** 1 to 14: the file's number. Nothing plays in this order. */
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

/** The gap from one pop to the next, start to start (story ms): a fresh draw each time. */
export const ADS_GAP_MIN_MS = 3 * 60_000;
export const ADS_GAP_MAX_MS = 10 * 60_000;
/** Every screen is told this long ahead, so a wall's 2 s poll still starts on the beat. */
export const AD_LEAD_MS = 3_000;
/** A house announcement holds the ads this long from when it is said. */
export const AD_ANNOUNCE_HOLD_MS = 15_000;
/** A slide the walls keep up holds them this long from its cue, then no longer: the
 *  Y2K clock stands for the whole final hour. */
export const AD_STANDING_SLIDE_HOLD_MS = 5 * 60_000;
/** A phone that can't take an ad is replaced only while this much of it is left. */
export const AD_REPLACE_LEFT_MS = 20_000;
/** Too little of an ad left to be worth joining (ms). */
export const AD_JOIN_LEFT_MS = 8_000;
/** At least this many phones a pop, where there are that many. */
export const AD_PHONES_MIN = 2;
/** At most this many walls a pop. */
export const AD_WALLS_MAX = 3;
/** A wall counts as there this long after its last poll. */
export const AD_WALL_ONLINE_MS = 8_000;

/** Journaled: an ad went on the air. No story hook hears it. */
export const AD_AIRED_SIGNAL = "audio_ad_aired";
/** Journaled: a director's 📢 On / Off. No story hook hears it. */
export const ADS_SWITCH_SIGNAL = "audio_ads_switched";

/** The window, on the story's `Night.step`: from 📓 the second hunt on, and shut for
 *  good by the final reveal (the costume reads the same step). An ending shuts it too. */
export const ADS_FROM_STEP = 8;
export const ADS_UNTIL_STEP = 16;

/** Sacred (the user's word): no ad, whatever the state, a saved ⚙ or a link say. */
const NEVER_VIEWS: readonly string[] = ["tv", "mirror", "reinstall"];
/** Each a prefix, so `server-room` is the kiosk and the Server Door both. */
const NEVER_SPOTS: readonly string[] = ["desktop-tv", "tent", "server-room"];

/**
 * THE rule for where an ad may ever play: the TV, the tent, the server room, the
 * reinstall games and a mirror never, on the view and the spot both, and a terminal
 * that doesn't say where it is never. A room terminal is the server room's. The
 * server asks it before it picks a wall or sends one the state, the terminal again
 * before it plays, and nothing else decides.
 */
export function adTerminal(t: { view: string; spot: string; room?: string | undefined }): boolean {
  const spot = t.spot.trim().toLowerCase();
  if (spot === "" || (t.room ?? "").trim() !== "") return false;
  return !NEVER_VIEWS.includes(t.view.trim().toLowerCase()) && !NEVER_SPOTS.some((s) => spot.startsWith(s));
}

/** How many of `phones` hear a pop: a quarter, at least `AD_PHONES_MIN`, never more than there are. */
export function adPhoneCount(phones: number): number {
  return Math.min(phones, Math.max(AD_PHONES_MIN, Math.ceil(phones / 4)));
}

/** How many of `walls` play a pop: 1 to `AD_WALLS_MAX`, by `draw` in [0, 1). */
export function adWallCount(walls: number, draw: number): number {
  return Math.min(walls, 1 + Math.floor(draw * AD_WALLS_MAX));
}

/** Why nothing may start now, and what stops one on the air. */
export type AdHold = "doors" | "talk" | "reading" | "speaking" | "announcement" | "cutscene" | "blackout";

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

/** One phone's turn, in server ms: a phone that wakes with this queued reads the
 *  real offset, and drops it once `until` has passed. `now` is when it was sent. */
export interface AdOffer {
  seq: number;
  n: number;
  name: string;
  url: string;
  at: number;
  until: number;
  now: number;
}

/** The `ad` stream frame: one phone's turn, everyone stops, or (on a stream's open,
 *  with `stop` when nothing is on the air) only the server's time. Every frame
 *  carries `now`, which is all the phone's clock has. Words ride the frame, so an
 *  old phone that ignores it loses nothing. */
export type AdFrame = AdOffer | { stop?: true; now: number };

/** What Run → Terminals reads. */
export interface AdsStatus {
  on: boolean;
  /** How many have gone out tonight. */
  aired: number;
  /** How many there are. */
  total: number;
  /** The name on the air, or null. */
  playing: string | null;
  /** The window is open: from the second hunt to the final reveal or an ending. */
  running: boolean;
  /** Why nothing may start now, or null. */
  hold: AdHold | null;
}
