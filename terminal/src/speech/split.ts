//! Cut a reply into speakable pieces. Speech starts on the first sentence
//! while the rest is still being synthesised, so a long reply doesn't sit
//! silent for seconds — and the transcript reveals sentence by sentence as
//! each one is spoken. Also strips what a voice shouldn't read aloud
//! (markdown asterisks, `*stage directions*`, bare URLs) and expands the
//! few spellings a model uses that sound wrong when said.

/** Longest chunk handed to the synthesiser in one go. */
const MAX_CHUNK = 220;

/** What the voice actually says for a line (the transcript shows the original). */
export function speakable(text: string): string {
  return (
    text
      // *stage directions* / _emphasis_ / **bold** → the words, unmarked
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
      .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      // links → "link"
      .replace(/https?:\/\/\S+/g, "link")
      // an ellipsis reads as a pause, not "dot dot dot"
      .replace(/\.{3,}|…/g, ", ")
      // a run of the same punctuation
      .replace(/([!?]){2,}/g, "$1")
      // emoji + other symbols the voice would name aloud
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      // a line that trailed off ("I wonder…") shouldn't end on a comma
      .replace(/[,;:\s]+$/, "")
  );
}

/** Split into sentences, then re-split anything still too long at a clause. */
export function splitSentences(text: string, max = MAX_CHUNK): string[] {
  const clean = speakable(text);
  if (clean === "") return [];
  // Sentence ends: . ! ? followed by whitespace, or a hard break.
  const rough = clean.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s !== "");
  const out: string[] = [];
  for (const s of rough) {
    if (s.length <= max) {
      out.push(s);
      continue;
    }
    // Too long: break at clause punctuation, then at spaces as a last resort.
    let rest = s;
    while (rest.length > max) {
      const window = rest.slice(0, max);
      let cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(": "), window.lastIndexOf(" — "));
      if (cut < max / 3) cut = window.lastIndexOf(" ");
      if (cut <= 0) cut = max;
      out.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest !== "") out.push(rest);
  }
  // Tiny fragments ("Hm." / "Yes." / "No.") ride with their neighbour so
  // the voice doesn't stutter between synth calls. A short real sentence
  // ("Sit down.") stays its own beat.
  const TINY = 8;
  const merged: string[] = [];
  for (const s of out) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && prev.length + s.length + 1 <= max && (s.length < TINY || prev.length < TINY)) merged[merged.length - 1] = `${prev} ${s}`;
    else merged.push(s);
  }
  return merged;
}

/**
 * How far into `text` (in characters of the *original*) each spoken chunk
 * ends — so the transcript can reveal up to the chunk being said. Works by
 * locating each chunk's last word in the original, left to right.
 */
export function revealOffsets(text: string, chunks: string[]): number[] {
  const offsets: number[] = [];
  let from = 0;
  for (const chunk of chunks) {
    const words = chunk.split(" ").filter((w) => w !== "");
    const last = words[words.length - 1]?.replace(/[^\p{L}\p{N}]+$/u, "") ?? "";
    let at = last === "" ? -1 : text.indexOf(last, from);
    if (at === -1) {
      // Fall back: proportional to the chunk's share of the text.
      at = Math.min(text.length, from + chunk.length);
      offsets.push(at);
      from = at;
      continue;
    }
    at += last.length;
    // Take the trailing punctuation with it.
    while (at < text.length && /[^\s\p{L}\p{N}]/u.test(text[at]!)) at++;
    offsets.push(at);
    from = at;
  }
  if (offsets.length > 0) offsets[offsets.length - 1] = text.length;
  return offsets;
}
