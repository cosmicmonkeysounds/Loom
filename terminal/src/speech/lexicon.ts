//! How a word is *said* (wave 26, V3; contract C10): the shared
//! pronunciation table `pronounce.json`, applied at the engine boundary
//! (`SpeechQueue.prepare`) so every voice on the page says "Anti Virus" while
//! every screen keeps the written "Antivirus" (the transcript, the caption,
//! `revealOffsets` all read the original text).
//!
//! The same JSON is copied byte for byte to stagehand
//! (`stagehand/src/stagehand/pronounce.json`, the house router and Alexa)
//! and to the VR game (`reinstall/vr/config/pronounce.json`); a test pins
//! the three copies. Every implementation applies it the same way:
//!
//! - a whole word, case-insensitive, where a word boundary is any character
//!   that is not `[A-Za-z0-9]` (so `Anti-Virus` and `Norton Anti-Virus`
//!   never match, and the possessive `Antivirus'` does);
//! - the longest `word` wins at a position;
//! - `say` replaces it exactly as written.
//!
//! No regex lookbehind (Chrome 87 / Safari 14): a plain left-to-right scan.

import table from "./pronounce.json";

export interface PronounceWord {
  word: string;
  say: string;
}

export interface PronounceTable {
  version: number;
  words: readonly PronounceWord[];
}

/** The shared table (`pronounce.json`). */
export const PRONOUNCE: PronounceTable = table as PronounceTable;

/** A word character for the boundary rule: ASCII letters and digits only. */
function isWordChar(c: string | undefined): boolean {
  if (c === undefined) return false;
  const k = c.charCodeAt(0);
  return (k >= 48 && k <= 57) || (k >= 65 && k <= 90) || (k >= 97 && k <= 122);
}

/** `text` with every table word replaced by how it is said (pure). */
export function pronounce(text: string, t: PronounceTable = PRONOUNCE): string {
  // Longest first, so `Antiviruses` wins over `Antivirus` at one position.
  const words = t.words
    .filter((w) => typeof w.word === "string" && w.word !== "" && typeof w.say === "string")
    .map((w) => ({ lower: w.word.toLowerCase(), say: w.say }))
    .sort((a, b) => b.lower.length - a.lower.length);
  if (words.length === 0 || text === "") return text;
  const lower = text.toLowerCase();
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (!isWordChar(text[i - 1])) {
      const hit = words.find((w) => lower.startsWith(w.lower, i) && !isWordChar(text[i + w.lower.length]));
      if (hit !== undefined) {
        out += hit.say;
        i += hit.lower.length;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return out;
}
