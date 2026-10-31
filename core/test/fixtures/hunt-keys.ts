//! The judge's tests and the night's tests need questions judged, and they pin
//! how a key is judged, never what the show's key is. So they run on these
//! made-up keys, whatever the show's are: no test waits for a real answer or
//! spells one. H1 to H6 here, but for the two aliases that are old documents' codes,
//! read from the file like F1 and F2's guarded words; F3 stays the show's.

import type { Question } from "../../src/facts.ts";

const KEYS: Record<string, Pick<Question, "answer" | "accept">> = {
  H1: { answer: "Eleven years", accept: ["11 years", "eleven", "11"] },
  H2: { answer: "Mister Pickles", accept: ["pickles", "harbour tabby", "tabby"] },
  H3: { answer: "9:00 a.m.", accept: ["9am", "9 am", "9 a.m.", "9:00", "9:00am", "9:00 am", "nine a.m.", "nine am", "9 o'clock", "nine o'clock", "nine in the morning"] },
  H4: { answer: "1978", accept: ["nineteen seventy eight", "nineteen seventy-eight"] },
  H5: { answer: "Hopelessly Devoted to You", accept: ["hopelessly devoted"] },
  H6: { answer: ": Loose Ends (Do Not Print)", accept: ["appendix", "loose ends", "do not print"] },
};

/** What each key takes from its old document's code, as a guest would say it. */
const FROM_CODE: Record<string, (said: string) => Partial<Pick<Question, "answer">> & { accept: string[] }> = {
  H4: (said) => ({ accept: [said, said.replace(" ", ". ")] }),
  H6: (said) => ({ answer: `${said}${KEYS["H6"]!.answer}`, accept: [said, `${said} loose ends`] }),
};

/** A facts.json's text with H1–H3 on the made-up keys. */
export function withTestKeys(text: string): string {
  const f = JSON.parse(text) as { questions: Array<Question & Record<string, unknown>>; documents?: Array<{ was: string; guard?: string[]; codex?: { code: string } }> };
  for (const q of f.questions) {
    const doc = f.documents?.find((d) => d.was === q.id);
    const key = KEYS[q.id] ?? (doc?.guard === undefined ? undefined : { answer: doc.guard[0]!, accept: doc.guard.slice(1) });
    if (key === undefined) continue;
    const coded = doc?.codex === undefined ? undefined : FROM_CODE[q.id]?.(doc.codex.code.replace("-", " ").toLowerCase());
    q.answer = coded?.answer ?? key.answer;
    q.accept = [...key.accept, ...(coded?.accept ?? [])];
    delete q.placeholder;
  }
  return JSON.stringify(f);
}
