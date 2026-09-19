//! Rank the browser's built-in voices for the fallback engine. Quality
//! varies wildly: the "premium" / "enhanced" downloads on an iPad and
//! Edge's online "Natural" voices are close to a real speaker; the old
//! eSpeak-style defaults are not. The terminal's setup screen lists them
//! best first and lets the operator override.

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
  /\b(daniel|samantha|alex|tom|evan|nathan|aaron|oliver)\b/i,
  // Google (Chrome / Android).
  /google (us|uk) english/i,
];

/** A score: higher is better. Exported for tests + the setup screen's list. */
export function scoreVoice(v: VoiceLike, prefer: { lang?: string; male?: boolean } = {}): number {
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
  return s;
}

/** Best first; unusable voices (other languages, novelty) dropped. */
export function rankVoices<T extends VoiceLike>(voices: readonly T[], prefer: { lang?: string } = {}): T[] {
  return voices
    .map((v) => ({ v, s: scoreVoice(v, prefer) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.v.name.localeCompare(b.v.name))
    .map((x) => x.v);
}

/** The voice to use: an explicit choice by URI / name if it still exists, else the best. */
export function pickVoice<T extends VoiceLike>(voices: readonly T[], chosen: string | null, prefer: { lang?: string } = {}): T | null {
  if (chosen !== null && chosen !== "") {
    const hit = voices.find((v) => v.voiceURI === chosen || v.name === chosen);
    if (hit !== undefined) return hit;
  }
  return rankVoices(voices, prefer)[0] ?? null;
}
