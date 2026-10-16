//! Rank the device's built-in voices — the voice every terminal and the TV
//! use by default (the house Mac's Chrome lists the macOS voices). Quality
//! varies wildly: the "premium" / "enhanced" downloads on an iPad and
//! Edge's online "Natural" voices are close to a real speaker; the old
//! eSpeak-style defaults are not. The terminal's setup screen lists them
//! best first and lets the operator override.
//!
//! The character (Trabolta) and the house announcements must not
//! sound alike: the character's voice prefers a male voice
//! (`CHARACTER_VOICE`), an announcement a female one (`ANNOUNCE_VOICE`, like
//! the house Mac's `say_voice: Samantha`) — on a stock Mac that is Daniel
//! vs Samantha. A voice picked in ⚙ always wins.

export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
  voiceURI: string;
}

/** Names known to be the good ones, in preference order. */
const FAVOURITES = [
  // Microsoft Edge — neural, streamed; the best free voices on any tablet.
  /\(natural\)/i,
  /aria|guy|davis|jenny|ryan|sonia/i,
  // Apple — the premium downloads, then the classic system voices.
  /premium/i,
  /enhanced/i,
  /\b(daniel|samantha|alex|tom|evan|nathan|aaron|oliver|ava|zoe|allison|susan|nicky)\b/i,
  // Google (Chrome / Android).
  /google (us|uk) english/i,
];

/** Voices known to be male / female by name (Apple, Microsoft, Google);
 *  anything else is neither — a preference never drops a voice, it ranks. */
const MALE =
  /\b(daniel|alex|tom|evan|nathan|aaron|oliver|arthur|gordon|lee|reed|rishi|rocko|eddy|grandpa|guy|davis|ryan|david|mark|andrew|brian|christopher|eric|roger|steffan|thomas|james|william|liam|jacques|thierry)\b|(^|[^e])male\b/i;
const FEMALE =
  /\b(samantha|ava|zoe|allison|susan|nicky|karen|moira|tessa|victoria|fiona|kathy|aria|jenny|sonia|serena|kate|flo|sandy|shelley|emma|michelle|libby|natasha|clara|kimberly|joanna|salli|ivy|kendra|catherine|veena|amelie|female)\b|^google us english$/i;

/** Which way a voice's name leans (null: unknown). */
export function voiceGender(v: Pick<VoiceLike, "name">): "male" | "female" | null {
  if (FEMALE.test(v.name)) return "female";
  if (MALE.test(v.name)) return "male";
  return null;
}

/** What a queue would like its voice to be: a language, and a lean
 *  (`male: true` = male first, `false` = female first, absent = either). */
export interface VoicePrefer {
  lang?: string;
  male?: boolean;
}

/** The character's voice (Trabolta): male first, so it never sounds like
 *  the house announcements. */
export const CHARACTER_VOICE: VoicePrefer = { male: true };
/** A house announcement: female first, like the house Mac's. */
export const ANNOUNCE_VOICE: VoicePrefer = { male: false };

/** How much a matching / opposite lean moves a voice — enough to put a
 *  decent other-accent voice (Daniel, en-GB) over the default Samantha. */
const LEAN = 45;

/** A score: higher is better. Exported for tests + the setup screen's list. */
export function scoreVoice(v: VoiceLike, prefer: VoicePrefer = {}): number {
  let s = 0;
  const lang = v.lang.toLowerCase().replace("_", "-");
  const want = (prefer.lang ?? "en-us").toLowerCase();
  if (lang === want) s += 40;
  else if (lang.startsWith(want.slice(0, 2))) s += 25;
  else return -1; // never a different language
  FAVOURITES.forEach((re, i) => {
    if (re.test(v.name)) s += 60 - i * 8;
  });
  if (/compact|espeak|novelty|whisper|bells|cellos|bad news|good news|bubbles|zarvox|trinoids|boing|deranged|hysterical|organ|wobble|jester|fred|junior|kathy|ralph|albert|bahh/i.test(v.name)) s -= 80;
  if (!v.localService) s += 5; // the streamed neural ones
  if (v.default) s += 1;
  if (s < 0 || prefer.male === undefined) return s; // a novelty voice stays out
  const g = voiceGender(v);
  if (g === null) return s;
  return Math.max(0, s + ((g === "male") === prefer.male ? LEAN : -LEAN)); // a lean ranks, never drops
}

/** Best first; unusable voices (other languages, novelty) dropped. */
export function rankVoices<T extends VoiceLike>(voices: readonly T[], prefer: VoicePrefer = {}): T[] {
  return voices
    .map((v) => ({ v, s: scoreVoice(v, prefer) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.v.name.localeCompare(b.v.name))
    .map((x) => x.v);
}

/** The voice to use: an explicit choice by URI / name if it still exists, else the best. */
export function pickVoice<T extends VoiceLike>(voices: readonly T[], chosen: string | null, prefer: VoicePrefer = {}): T | null {
  if (chosen !== null && chosen !== "") {
    const hit = voices.find((v) => v.voiceURI === chosen || v.name === chosen);
    if (hit !== undefined) return hit;
  }
  return rankVoices(voices, prefer)[0] ?? null;
}
